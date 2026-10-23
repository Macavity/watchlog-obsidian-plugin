import { App, Modal } from 'obsidian';
import type { Book, Manga, AirtimeSchedule, AirtimeRecurrence } from './types';
import {
	type ScheduleFormState,
	isScheduleValid,
	renderCounterRow,
	renderSaveRow,
	renderScheduleForm,
} from './ui/ScheduleForm';

type ReadingRecurringKind = Exclude<AirtimeRecurrence, 'once'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Book releases once, manga usually serializes — both overridable. */
function defaultMode(kind: 'book' | 'manga'): 'single' | 'recurring' {
	return kind === 'book' ? 'single' : 'recurring';
}

/**
 * mode: an explicit initialMode wins (the tick confirm's "Switch to Recurring chapters"); otherwise
 * an existing schedule decides — auto-imported entries arrive as 'once'. Without one, default by kind.
 */
function initialMode(
	kind: 'book' | 'manga',
	s: AirtimeSchedule | null,
	explicit?: 'single' | 'recurring',
): 'single' | 'recurring' {
	return explicit ?? (s ? (s.recurrence === 'once' ? 'single' : 'recurring') : defaultMode(kind));
}

function validIsoDate(value: string | null | undefined): string {
	return value && ISO_DATE.test(value) ? value : '';
}

/** Weekly default: serials usually keep their premiere weekday, so derive it from the release date before falling back to Saturday. */
function defaultWeekday(releaseDate: string): number {
	return releaseDate ? new Date(releaseDate + 'T00:00:00').getDay() : 6;
}

function initialRecurrence(s: AirtimeSchedule | null): string {
	return s && s.recurrence !== 'once' ? s.recurrence : 'weekly';
}

function initialDayOfWeek(s: AirtimeSchedule | null, releaseDate: string): number {
	return s?.dayOfWeek ?? defaultWeekday(releaseDate);
}

function initialDayOfMonth(s: AirtimeSchedule | null): number {
	return s?.dayOfMonth ?? 1;
}

function initialForm(
	item: Book | Manga,
	kind: 'book' | 'manga',
	s: AirtimeSchedule | null,
	explicitMode?: 'single' | 'recurring',
): ScheduleFormState {
	const releaseDate = s?.releaseDate ?? validIsoDate(item.releaseDate);
	return {
		mode: initialMode(kind, s, explicitMode),
		recurrence: initialRecurrence(s),
		releaseDate,
		releaseTime: '',
		dayOfWeek: initialDayOfWeek(s, releaseDate),
		dayOfMonth: initialDayOfMonth(s),
	};
}

/**
 * Schedule modal for Reading titles (Books & Manga). Mirrors AirtimeScheduleModal — Single release /
 * Recurring toggle, date picker, schedule built fresh from the visible fields at Save — but with no
 * time field and chapter/volume counters instead of episode/season ones.
 *
 * The counters map onto the shared AirtimeEntry slots:
 *   current volume  ↔ currentSeason   total volumes  ↔ totalSeasons
 *   current chapter ↔ currentEpisode  total chapters ↔ totalEpisodes
 * so reading entries reuse the existing scheduler/countdown machinery unchanged.
 */
export class ReadingScheduleModal extends Modal {
	private kind: 'book' | 'manga';
	// UI state — Save assembles a fresh AirtimeSchedule from the fields the active mode actually shows
	// (buildSchedule), so a value left over from another mode can never leak in.
	// releaseDate is YYYY-MM-DD ('' = unset) — same format the Reading auto-import writes
	private form: ScheduleFormState;
	private currentVolume: number | null;
	private currentChapter: number | null;
	private totalVolumes: number | null;
	private totalChapters: number | null;
	private saveBtn: HTMLButtonElement | null = null;
	private onSave: (
		schedule: AirtimeSchedule,
		volume: number | null,
		chapter: number | null,
		totalVolumes: number | null,
		totalChapters: number | null,
	) => Promise<void>;

	constructor(
		app: App,
		item: Book | Manga,
		kind: 'book' | 'manga',
		existingSchedule: AirtimeSchedule | null,
		currentVolume: number | null,
		currentChapter: number | null,
		totalVolumes: number | null,
		totalChapters: number | null,
		onSave: (
			schedule: AirtimeSchedule,
			volume: number | null,
			chapter: number | null,
			totalVolumes: number | null,
			totalChapters: number | null,
		) => Promise<void>,
		initialMode?: 'single' | 'recurring',
	) {
		super(app);
		this.kind = kind;
		this.onSave = onSave;
		this.form = initialForm(item, kind, existingSchedule, initialMode);
		this.currentVolume = currentVolume;
		this.currentChapter = currentChapter;
		// pre-fill totals from the item's tracked counts when not yet set
		const itemTotalChapters = item.totalChapters ?? 0;
		const itemTotalVolumes = kind === 'manga' ? ((item as Manga).totalVolumes ?? 0) : 0;
		this.totalChapters = totalChapters ?? (itemTotalChapters > 0 ? itemTotalChapters : null);
		this.totalVolumes = totalVolumes ?? (itemTotalVolumes > 0 ? itemTotalVolumes : null);
	}

	onOpen(): void {
		this.titleEl.setText('Set reading schedule');
		this.contentEl.addClass('wl-add-modal');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Single release needs a date; recurring is always saveable (its inputs can't hold an invalid value). */
	private isValid(): boolean {
		return isScheduleValid(this.form);
	}

	private updateSaveState(): void {
		if (this.saveBtn) this.saveBtn.disabled = !this.isValid();
	}

	/**
	 * The schedule handed to onSave: built fresh from the visible fields. Reading never carries a
	 * releaseTime.
	 */
	private buildSchedule(): AirtimeSchedule {
		const f = this.form;
		if (f.mode === 'single') {
			return { recurrence: 'once', releaseDate: f.releaseDate };
		}
		const recurrence = f.recurrence as ReadingRecurringKind;
		return {
			recurrence,
			...(recurrence === 'weekly' ? { dayOfWeek: f.dayOfWeek } : {}),
			...(recurrence === 'monthly' ? { dayOfMonth: f.dayOfMonth } : {}),
		};
	}

	/** Progress: Manga → Volume [2] of [12] · Chapter [12] of [120]. Books track only chapters. */
	private renderCounters(parent: HTMLElement): void {
		const groups = [];
		if (this.kind === 'manga') {
			groups.push({
				label: 'Volume',
				current: { aria: 'Current volume', value: this.currentVolume, onInput: (v: number | null) => { this.currentVolume = v; } },
				total: { aria: 'Total volumes', value: this.totalVolumes, onInput: (v: number | null) => { this.totalVolumes = v; } },
			});
		}
		groups.push({
			label: 'Chapter',
			current: { aria: 'Next chapter', value: this.currentChapter, onInput: (v: number | null) => { this.currentChapter = v; } },
			total: { aria: 'Total chapters', value: this.totalChapters, onInput: (v: number | null) => { this.totalChapters = v; } },
		});
		renderCounterRow(parent, groups);
	}

	private hintFor(mode: 'single' | 'recurring'): string {
		if (mode === 'single') return "Saving also updates this title's release date.";
		return this.kind === 'manga'
			? "Saving also updates this title's total chapters and volumes."
			: "Saving also updates this title's total chapters.";
	}

	private renderForm(): void {
		const content = this.contentEl;
		content.empty();

		renderScheduleForm(content, this.form, {
			withTime: false,
			withRecurring: true,
			recurrenceLabel: 'Releases',
			recurrenceOptions: [
				{ value: 'daily', label: 'Daily' },
				{ value: 'weekly', label: 'Weekly' },
				{ value: 'monthly', label: 'Monthly' },
			],
			modeLabels: ['Single release', 'Recurring chapters'],
			hint: (mode) => this.hintFor(mode),
			renderCounters: (parent) => this.renderCounters(parent),
			onChange: () => this.updateSaveState(),
			onModeChange: () => this.renderForm(),
		});

		this.saveBtn = renderSaveRow(content, {
			isValid: () => this.isValid(),
			onCancel: () => this.close(),
			onSave: async () => {
				await this.onSave(
					this.buildSchedule(),
					this.currentVolume,
					this.currentChapter,
					this.totalVolumes,
					this.totalChapters,
				);
				this.close();
			},
		});
		this.updateSaveState();
	}
}

import { App, Modal } from 'obsidian';
import type { Book, Manga, AirtimeSchedule } from './types';
import {
	type ScheduleFormState,
	RECURRENCE_OPTIONS,
	buildScheduleFromState,
	counterField,
	initialScheduleState,
	renderCounterRow,
	renderScheduleModal,
	resolveScheduleMode,
} from './ui/ScheduleForm';

/** Book releases once, manga usually serializes — both overridable. */
function defaultMode(kind: 'book' | 'manga'): 'single' | 'recurring' {
	return kind === 'book' ? 'single' : 'recurring';
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
		this.form = initialScheduleState(
			existingSchedule,
			item.releaseDate,
			resolveScheduleMode(existingSchedule, initialMode, defaultMode(kind)),
		);
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

	/** Progress: Manga → Volume [2] of [12] · Chapter [12] of [120]. Books track only chapters. */
	private renderCounters(parent: HTMLElement): void {
		const groups = [];
		if (this.kind === 'manga') {
			groups.push({
				label: 'Volume',
				current: counterField('Current volume', this.currentVolume, (v) => { this.currentVolume = v; }),
				total: counterField('Total volumes', this.totalVolumes, (v) => { this.totalVolumes = v; }),
			});
		}
		groups.push({
			label: 'Chapter',
			current: counterField('Next chapter', this.currentChapter, (v) => { this.currentChapter = v; }),
			total: counterField('Total chapters', this.totalChapters, (v) => { this.totalChapters = v; }),
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
		renderScheduleModal(this.contentEl, this.form, {
			withTime: false,
			withRecurring: true,
			recurrenceLabel: 'Releases',
			recurrenceOptions: RECURRENCE_OPTIONS,
			modeLabels: ['Single release', 'Recurring chapters'],
			hint: (mode) => this.hintFor(mode),
			renderCounters: (parent) => this.renderCounters(parent),
			modal: this,
			onSave: async () => {
				await this.onSave(
					buildScheduleFromState(this.form, false),
					this.currentVolume,
					this.currentChapter,
					this.totalVolumes,
					this.totalChapters,
				);
			},
		});
	}
}

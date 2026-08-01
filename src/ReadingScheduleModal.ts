import { App, Modal } from 'obsidian';
import type { Book, Manga, AirtimeSchedule, AirtimeRecurrence } from './types';
import { createDatePicker } from './DatePicker';

type ReadingRecurringKind = Exclude<AirtimeRecurrence, 'once'>;

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
	// (buildSchedule), so a value left over from another mode can never leak in
	private mode: 'single' | 'recurring';
	private recurrence: ReadingRecurringKind;
	private releaseDate: string; // YYYY-MM-DD ('' = unset) — same format the Reading auto-import writes
	private dayOfWeek: number;
	private dayOfMonth: number;
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
		const s = existingSchedule;
		// mode: an explicit initialMode wins (the tick confirm's "Switch to Recurring chapters"); otherwise
		// an existing schedule decides — auto-imported entries arrive as 'once'. Without one, default by
		// kind: books release once, manga usually serialize — both overridable.
		this.mode = initialMode ?? (s
			? (s.recurrence === 'once' ? 'single' : 'recurring')
			: (kind === 'book' ? 'single' : 'recurring'));
		this.recurrence = s && s.recurrence !== 'once' ? s.recurrence : 'weekly';
		this.releaseDate =
			s?.releaseDate ??
			(item.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(item.releaseDate) ? item.releaseDate : '');
		// weekly default: serials usually keep their premiere weekday, so derive it from the release date
		// before falling back to Saturday
		this.dayOfWeek = s?.dayOfWeek ??
			(this.releaseDate ? new Date(this.releaseDate + 'T00:00:00').getDay() : 6);
		this.dayOfMonth = s?.dayOfMonth ?? 1;
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
		return this.mode !== 'single' || this.releaseDate !== '';
	}

	private updateSaveState(): void {
		if (this.saveBtn) this.saveBtn.disabled = !this.isValid();
	}

	/**
	 * The schedule handed to onSave: built fresh from the visible fields. Reading never carries a
	 * releaseTime.
	 */
	private buildSchedule(): AirtimeSchedule {
		if (this.mode === 'single') {
			return { recurrence: 'once', releaseDate: this.releaseDate };
		}
		return {
			recurrence: this.recurrence,
			...(this.recurrence === 'weekly' ? { dayOfWeek: this.dayOfWeek } : {}),
			...(this.recurrence === 'monthly' ? { dayOfMonth: this.dayOfMonth } : {}),
		};
	}

	private renderForm(): void {
		const content = this.contentEl;
		content.empty();

		const makeRow = (parent: HTMLElement, label: string): HTMLElement => {
			const row = parent.createDiv({ cls: 'wl-modal-row' });
			row.createSpan({ cls: 'wl-modal-label', text: label });
			return row;
		};

		// mode toggle
		const modeRow = content.createDiv({ cls: 'wl-schedule-mode-row' });
		const makeModeBtn = (label: string, value: 'single' | 'recurring'): void => {
			const btn = modeRow.createEl('button', {
				cls: `wl-btn wl-btn-sm wl-schedule-mode-btn${this.mode === value ? ' is-active' : ''}`,
				text: label,
			});
			btn.addEventListener('click', () => {
				if (this.mode === value) return;
				this.mode = value;
				this.renderForm();
			});
		};
		makeModeBtn('Single release', 'single');
		makeModeBtn('Recurring chapters', 'recurring');

		if (this.mode === 'single') {
			// single release: just a date
			const dateRow = makeRow(content, 'Release date');
			createDatePicker({
				parent: dateRow,
				inputCls: 'wl-modal-input wl-date-input',
				value: this.releaseDate || null,
				lenient: true,
				onChange: (iso) => {
					// the picker only ever commits YYYY-MM-DD or null — no silent-failure path
					this.releaseDate = iso ?? '';
					this.updateSaveState();
				},
			});
		} else {
			// recurring: cadence + its one extra field
			const recRow = makeRow(content, 'Releases');
			const recSelect = recRow.createEl('select', { cls: 'wl-select' });
			const recOptions: Array<[ReadingRecurringKind, string]> = [
				['daily', 'Daily'],
				['weekly', 'Weekly'],
				['monthly', 'Monthly'],
			];
			for (const [val, label] of recOptions) {
				const opt = recSelect.createEl('option', { text: label, value: val });
				if (val === this.recurrence) opt.selected = true;
			}

			const extraEl = content.createDiv();
			const renderExtra = (): void => {
				extraEl.empty();
				if (this.recurrence === 'weekly') {
					const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
					const r = makeRow(extraEl, 'Day of week');
					const daySelect = r.createEl('select', { cls: 'wl-select' });
					DAYS.forEach((d, i) => {
						const opt = daySelect.createEl('option', { text: d, value: String(i) });
						if (i === this.dayOfWeek) opt.selected = true;
					});
					daySelect.addEventListener('change', () => {
						this.dayOfWeek = parseInt(daySelect.value, 10);
					});
				}
				if (this.recurrence === 'monthly') {
					const r = makeRow(extraEl, 'Day of month');
					const inp = r.createEl('input', {
						cls: 'wl-modal-input wl-modal-input-sm',
						attr: { type: 'number', min: '1', max: '31', placeholder: '1' },
					});
					inp.value = String(this.dayOfMonth);
					inp.addEventListener('input', () => {
						const v = parseInt(inp.value, 10);
						this.dayOfMonth = isNaN(v) ? 1 : Math.min(31, Math.max(1, v));
					});
				}
			};
			recSelect.addEventListener('change', () => {
				this.recurrence = recSelect.value as ReadingRecurringKind;
				renderExtra();
			});
			renderExtra();

			// progress: Manga → Volume [2] of [12] · Chapter [12] of [120]. Books track only chapters, so the
			// volume half is omitted.
			const progRow = content.createDiv({ cls: 'wl-modal-row wl-schedule-progress-row' });
			const makeNum = (
				value: number | null,
				aria: string,
				onInput: (v: number | null) => void,
			): void => {
				const inp = progRow.createEl('input', {
					cls: 'wl-modal-input wl-schedule-num',
					attr: { type: 'number', min: '0', placeholder: '—', 'aria-label': aria },
				});
				if (value !== null) inp.value = String(value);
				inp.addEventListener('input', () => onInput(parseInt(inp.value, 10) || null));
			};
			if (this.kind === 'manga') {
				progRow.createSpan({ cls: 'wl-modal-label', text: 'Volume' });
				makeNum(this.currentVolume, 'Current volume', (v) => { this.currentVolume = v; });
				progRow.createSpan({ cls: 'wl-schedule-progress-sep', text: 'of' });
				makeNum(this.totalVolumes, 'Total volumes', (v) => { this.totalVolumes = v; });
				progRow.createSpan({ cls: 'wl-schedule-progress-sep wl-schedule-progress-dot', text: '·' });
			}
			progRow.createSpan({ cls: 'wl-modal-label', text: 'Chapter' });
			makeNum(this.currentChapter, 'Next chapter', (v) => { this.currentChapter = v; });
			progRow.createSpan({ cls: 'wl-schedule-progress-sep', text: 'of' });
			makeNum(this.totalChapters, 'Total chapters', (v) => { this.totalChapters = v; });
		}

		// the save side-effects, stated instead of silent
		content.createDiv({
			cls: 'wl-modal-info wl-schedule-hint',
			text: this.mode === 'single'
				? "Saving also updates this title's release date."
				: this.kind === 'manga'
					? "Saving also updates this title's total chapters and volumes."
					: "Saving also updates this title's total chapters.",
		});

		// cancel / save
		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-mr', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' });
		this.saveBtn.addEventListener('click', () => {
			if (!this.isValid()) return;
			void (async () => {
				await this.onSave(
					this.buildSchedule(),
					this.currentVolume,
					this.currentChapter,
					this.totalVolumes,
					this.totalChapters,
				);
				this.close();
			})();
		});
		this.updateSaveState();
	}
}

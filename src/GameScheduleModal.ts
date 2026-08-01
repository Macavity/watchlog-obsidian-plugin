import { App, Modal } from 'obsidian';
import type { Game, AirtimeSchedule } from './types';
import { createDatePicker } from './DatePicker';

/**
 * Schedule modal for Games — the single-release branch of AirtimeScheduleModal. A game releases
 * once, so there is no Single/Recurring toggle and no unit counters (games track a completion
 * percentage). Just a date picker; the schedule is built fresh from the visible field at Save.
 */
export class GameScheduleModal extends Modal {
	private releaseDate: string; // YYYY-MM-DD ('' = unset) — same format the Games auto-import writes
	private saveBtn: HTMLButtonElement | null = null;
	private onSave: (schedule: AirtimeSchedule) => Promise<void>;

	constructor(
		app: App,
		game: Game,
		existingSchedule: AirtimeSchedule | null,
		onSave: (schedule: AirtimeSchedule) => Promise<void>,
	) {
		super(app);
		this.onSave = onSave;
		this.releaseDate =
			existingSchedule?.releaseDate ??
			(game.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate) ? game.releaseDate : '');
	}

	onOpen(): void {
		this.titleEl.setText('Set release schedule');
		this.contentEl.addClass('wl-add-modal');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private isValid(): boolean {
		return this.releaseDate !== '';
	}

	private updateSaveState(): void {
		if (this.saveBtn) this.saveBtn.disabled = !this.isValid();
	}

	private renderForm(): void {
		const content = this.contentEl;
		content.empty();

		const dateRow = content.createDiv({ cls: 'wl-modal-row' });
		dateRow.createSpan({ cls: 'wl-modal-label', text: 'Release date' });
		createDatePicker({
			parent: dateRow,
			inputCls: 'wl-modal-input wl-date-input',
			value: this.releaseDate || null,
			lenient: true,
			onChange: (iso) => {
				// the picker only ever commits YYYY-MM-DD or null
				this.releaseDate = iso ?? '';
				this.updateSaveState();
			},
		});

		// the save side-effect, stated instead of silent
		content.createDiv({
			cls: 'wl-modal-info wl-schedule-hint',
			text: "Saving also updates this game's release date.",
		});

		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-mr', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' });
		this.saveBtn.addEventListener('click', () => {
			if (!this.isValid()) return;
			void (async () => {
				await this.onSave({ recurrence: 'once', releaseDate: this.releaseDate });
				this.close();
			})();
		});
		this.updateSaveState();
	}
}

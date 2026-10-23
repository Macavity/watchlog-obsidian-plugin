import { App, Modal } from 'obsidian';
import type { Game, AirtimeSchedule } from './types';
import {
	type ScheduleFormState,
	buildScheduleFromState,
	initialScheduleState,
	renderScheduleModal,
} from './ui/ScheduleForm';

/**
 * Schedule modal for Games — the single-release branch of AirtimeScheduleModal. A game releases
 * once, so there is no Single/Recurring toggle and no unit counters (games track a completion
 * percentage). Just a date picker; the schedule is built fresh from the visible field at Save.
 */
export class GameScheduleModal extends Modal {
	private form: ScheduleFormState; // releaseDate: YYYY-MM-DD ('' = unset) — same format the Games auto-import writes
	private onSave: (schedule: AirtimeSchedule) => Promise<void>;

	constructor(
		app: App,
		game: Game,
		existingSchedule: AirtimeSchedule | null,
		onSave: (schedule: AirtimeSchedule) => Promise<void>,
	) {
		super(app);
		this.onSave = onSave;
		this.form = initialScheduleState(existingSchedule, game.releaseDate, 'single');
	}

	onOpen(): void {
		this.titleEl.setText('Set release schedule');
		this.contentEl.addClass('wl-add-modal');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderForm(): void {
		renderScheduleModal(this.contentEl, this.form, {
			withTime: false,
			withRecurring: false,
			// the save side-effect, stated instead of silent
			hint: () => "Saving also updates this game's release date.",
			modal: this,
			onSave: () => this.onSave(buildScheduleFromState(this.form, false)),
		});
	}
}

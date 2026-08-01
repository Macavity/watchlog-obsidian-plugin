import { App, Modal } from 'obsidian';

/**
 * Optional third action between Confirm and Cancel — an alternative way out (e.g. "Switch to
 * Recurring episodes" on the single-release tick confirm). Clicking it closes the modal first.
 */
export interface ConfirmExtraButton {
	label: string;
	onClick: () => void;
}

export class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;
	private extraButton: ConfirmExtraButton | null;

	constructor(app: App, message: string, onConfirm: () => void, extraButton?: ConfirmExtraButton) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.extraButton = extraButton ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createDiv({ cls: 'wl-confirm-msg', text: this.message });
		const btnRow = contentEl.createDiv({ cls: 'wl-modal-btn-row' });
		btnRow.createEl('button', { cls: 'wl-btn wl-btn-danger', text: 'Confirm' })
			.addEventListener('click', () => { this.close(); this.onConfirm(); });
		if (this.extraButton) {
			const extra = this.extraButton;
			btnRow.createEl('button', { cls: 'wl-btn', text: extra.label })
				.addEventListener('click', () => { this.close(); extra.onClick(); });
		}
		btnRow.createEl('button', { cls: 'wl-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

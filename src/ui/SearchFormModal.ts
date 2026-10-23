import { Modal, type App } from 'obsidian';
import type { SearchPicker } from './SearchPicker';

/**
 * Skeleton of the add modals: a search picker above an editable form. The subclass creates
 * `picker` in its constructor and renders the form in renderForm().
 */
export abstract class SearchFormModal extends Modal {
	protected picker!: SearchPicker;
	protected formEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly modalClasses: string[],
	) {
		super(app);
	}

	protected abstract renderForm(): void;

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.addClass(...this.modalClasses);
		this.contentEl.empty();
		this.picker.mount(this.contentEl);
		this.formEl = this.contentEl.createDiv({ cls: 'wl-modal-form' });
		this.renderForm();
		// a prefilled query searches right away; an empty one is a no-op
		void this.picker.search();
	}

	onClose(): void {
		this.contentEl.empty();
		this.picker.destroy();
	}
}

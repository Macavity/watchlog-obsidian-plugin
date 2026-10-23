import { Modal, type App } from 'obsidian';
import { createSearchPicker, type SearchPicker, type SearchPickerConfig } from './SearchPicker';

/** Picker settings that are not callbacks into the modal. */
export type SearchPickerOptions<R> = Omit<
	SearchPickerConfig<R>,
	'search' | 'noApiMessage' | 'renderResult' | 'onSelect'
>;

/**
 * Skeleton of the add modals: a search picker above an editable form. The subclass supplies the
 * picker options, the API callbacks, the result card and the form.
 */
export abstract class SearchFormModal<R> extends Modal {
	protected formEl: HTMLElement | null = null;
	private picker: SearchPicker | null = null;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly modalClasses: string[],
	) {
		super(app);
	}

	/** Read when the modal opens. */
	protected abstract pickerOptions(): SearchPickerOptions<R>;
	/** Throws on API errors (shown in the results panel). */
	protected abstract search(query: string, year: string): Promise<R[]>;
	/** Text for the "no API" panel, or null when the API is available. */
	protected abstract noApiMessage(): string | null;
	protected abstract renderResult(host: HTMLElement, result: R, select: (itemEl: HTMLElement) => void): HTMLElement;
	/** isCurrent() turns false once a newer search or selection started. */
	protected abstract selectResult(result: R, isCurrent: () => boolean): void | Promise<void>;
	protected abstract renderForm(): void;

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.addClass(...this.modalClasses);
		this.contentEl.empty();
		const picker = createSearchPicker<R>({
			...this.pickerOptions(),
			search: (query, year) => this.search(query, year),
			noApiMessage: () => this.noApiMessage(),
			renderResult: (host, result, select) => this.renderResult(host, result, select),
			onSelect: (result, isCurrent) => this.selectResult(result, isCurrent),
		});
		this.picker = picker;
		picker.mount(this.contentEl);
		this.formEl = this.contentEl.createDiv({ cls: 'wl-modal-form' });
		this.renderForm();
		// a prefilled query searches right away; an empty one is a no-op
		void picker.search();
	}

	onClose(): void {
		this.contentEl.empty();
		this.picker?.destroy();
	}
}

import { Modal, setIcon, type App } from 'obsidian';

export interface SearchBoxOptions {
	value: string;
	placeholder: string;
	/** Fires on every keystroke and on clear; the tab stores the query. */
	onChange: (query: string) => void;
	/** Fires after the debounce (immediately on clear); the tab re-renders its content. */
	onCommit: () => void;
	/** Adds extra controls (the "?" help button) between input and clear button. */
	help?: (host: HTMLElement) => void;
	debounceMs?: number;
}

/** Compact inline search with a clear button that shows only while there is text. */
export function renderSearchBox(parent: HTMLElement, opts: SearchBoxOptions): HTMLInputElement {
	const searchWrap = parent.createDiv({ cls: 'wl-reading-search-wrap' });
	const input = searchWrap.createEl('input', {
		cls: 'wl-reading-search-input',
		attr: { type: 'text', placeholder: opts.placeholder },
	});
	input.value = opts.value;
	opts.help?.(searchWrap);
	const clearBtn = searchWrap.createEl('button', {
		cls: 'wl-search-clear',
		attr: { type: 'button', 'aria-label': 'Clear search' },
	});
	setIcon(clearBtn, 'x');
	const syncClear = () => clearBtn.toggleClass('is-visible', input.value.length > 0);
	syncClear();
	let debounce = 0;
	input.addEventListener('input', () => {
		opts.onChange(input.value);
		syncClear();
		window.clearTimeout(debounce);
		debounce = window.setTimeout(opts.onCommit, opts.debounceMs ?? 250);
	});
	clearBtn.addEventListener('click', () => {
		window.clearTimeout(debounce);
		input.value = '';
		opts.onChange('');
		syncClear();
		input.focus();
		opts.onCommit();
	});
	return input;
}

/** Modal with one text input; Save (or Enter) hands the trimmed name over when it changed. */
export function openRenameGroupPrompt(app: App, current: string, onSave: (name: string) => void): void {
	const modal = new Modal(app);
	modal.titleEl.setText('Rename group');
	const input = modal.contentEl.createEl('input', {
		cls: 'wl-input',
		attr: { type: 'text', value: current, placeholder: 'Group name' },
	});
	const btnRow = modal.contentEl.createDiv({ cls: 'wl-modal-btn-row' });
	const submit = (): void => {
		const newName = input.value.trim();
		if (newName && newName !== current) onSave(newName);
		modal.close();
	};
	btnRow
		.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' })
		.addEventListener('click', submit);
	btnRow
		.createEl('button', { cls: 'wl-btn', text: 'Cancel' })
		.addEventListener('click', () => modal.close());
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') submit();
		else if (e.key === 'Escape') modal.close();
	});
	modal.open();
	window.setTimeout(() => {
		input.focus();
		input.select();
	}, 0);
}

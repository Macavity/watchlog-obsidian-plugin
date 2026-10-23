import { Modal, setIcon, type App } from 'obsidian';
import type { ShelfSelect } from '../RowsView';

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

/** Applies/removes wl-card-selected on every rendered card; `idOf` reads the selection id off a card. */
export function syncSelectionClasses(
	container: HTMLElement,
	selected: Set<string>,
	idOf: (card: HTMLElement) => string | undefined,
): void {
	container.querySelectorAll<HTMLElement>('.wl-card').forEach((card) => {
		const id = idOf(card);
		card.classList.toggle('wl-card-selected', !!id && selected.has(id));
	});
}

/**
 * Flips `id` in the selection and mirrors the new state onto every card matching `cardSelector`
 * (a card can render more than once). Returns the new state.
 */
export function toggleCardSelected(
	container: HTMLElement,
	selected: Set<string>,
	id: string,
	cardSelector: string,
): boolean {
	if (selected.has(id)) {
		selected.delete(id);
	} else {
		selected.add(id);
	}
	const now = selected.has(id);
	container
		.querySelectorAll<HTMLElement>(cardSelector)
		.forEach((el) => el.classList.toggle('wl-card-selected', now));
	return now;
}

/**
 * Select-all spec for one Rows section; undefined outside selection mode, which keeps the box out
 * of the header. Ids, not DOM: the grid sections are virtualised. `afterToggle` repaints the card
 * classes and the toolbar once the set has changed.
 */
export function buildShelfSelect(
	enabled: boolean,
	ids: string[],
	selected: Set<string>,
	refreshers: Array<() => void>,
	afterToggle: () => void,
): ShelfSelect | undefined {
	if (!enabled) return undefined;
	return {
		ids,
		selected,
		onToggle: (sectionIds, selectAll) => {
			for (const id of sectionIds) {
				if (selectAll) { selected.add(id); } else { selected.delete(id); }
			}
			afterToggle();
		},
		register: (refresh) => refreshers.push(refresh),
	};
}

/** The "Saved filter" preset button; `active` marks it while the preset is applied. */
function renderSavedFilterButton(
	parent: HTMLElement,
	active: boolean,
	onClick: () => void,
): HTMLButtonElement {
	const btn = parent.createEl('button', {
		cls: `wl-btn wl-btn-sm${active ? ' wl-btn-preset-active' : ''}`,
		text: 'Saved filter',
	});
	btn.addEventListener('click', onClick);
	return btn;
}

export interface SelectionButtonsOptions {
	selectionMode: boolean;
	hasSelection: boolean;
	/** Select all visible, or clear when something is selected. */
	onToggleAll: () => void;
	onToggleMode: () => void;
}

/** In selection mode: the All/None button, then the Select/Cancel button that enters/leaves it. */
export function renderSelectionButtons(parent: HTMLElement, opts: SelectionButtonsOptions): void {
	if (opts.selectionMode) {
		const selAllBtn = parent.createEl('button', {
			cls: 'wl-btn wl-btn-sm',
			text: opts.hasSelection ? 'None' : 'All',
		});
		selAllBtn.title = opts.hasSelection ? 'Deselect all' : 'Select all visible';
		selAllBtn.addEventListener('click', opts.onToggleAll);
	}
	// in selection mode the button is the way out: red Cancel
	const selBtn = parent.createEl('button', {
		cls: `wl-btn wl-btn-sm${opts.selectionMode ? ' wl-btn-cancel' : ''}`,
		text: opts.selectionMode ? 'Cancel' : 'Select',
	});
	selBtn.addEventListener('click', opts.onToggleMode);
}

export interface ToolbarCoreOptions {
	/** The stored filter preset; null hides the "Saved filter" button. */
	preset: { active: boolean; onApply: () => void } | null;
	renderFilters: (parent: HTMLElement) => void;
	renderSorting: (parent: HTMLElement) => void;
	/** Batch action bar; only passed while items are selected. */
	renderActionBar?: (parent: HTMLElement) => void;
	selection: SelectionButtonsOptions;
}

/**
 * The shared left part of a tab's toolbar: saved filter, Filters, Sorting, optional action bar and
 * the selection buttons. Returns the saved-filter button (or null) so the tab can restyle it.
 */
export function renderToolbarCore(controls: HTMLElement, opts: ToolbarCoreOptions): HTMLButtonElement | null {
	const savedBtn = opts.preset
		? renderSavedFilterButton(controls, opts.preset.active, opts.preset.onApply)
		: null;
	opts.renderFilters(controls);
	opts.renderSorting(controls);
	opts.renderActionBar?.(controls);
	renderSelectionButtons(controls, opts.selection);
	return savedBtn;
}

/** The green "+ add" button in its wrapper, far right on the toolbar row. */
export function renderAddButton(parent: HTMLElement, onClick: () => void): HTMLButtonElement {
	const wrap = parent.createDiv({ cls: 'wl-add-btn-wrap' });
	const btn = wrap.createEl('button', { cls: 'wl-add-btn wl-btn-success', text: '+ add' });
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onClick();
	});
	return btn;
}

/** Re-syncs every registered Rows header select-all box with the current selection. */
export function refreshShelfSelects(refreshers: Array<() => void>): void {
	for (const refresh of refreshers) refresh();
}

import type { App } from 'obsidian';
import { ConfirmModal } from '../ConfirmModal';

export interface DeleteSelectedOptions {
	/** Tooltip on the ✕ button. */
	title: string;
	/** The tab's live selection; its size is read when the button is clicked. */
	selected: Set<string>;
	/** Confirmation text for the current selection size. */
	message: (count: number) => string;
	/** Runs after the user confirmed. */
	onConfirm: () => Promise<void>;
}

/** The selection action bar with its red ✕, which asks for confirmation before running `onConfirm`. */
export function renderActionBar(parent: HTMLElement, app: App, opts: DeleteSelectedOptions): HTMLElement {
	const bar = parent.createDiv({ cls: 'wl-action-bar' });
	const deleteBtn = bar.createEl('button', {
		cls: 'wl-group-action-btn wl-group-action-btn-delete wl-btn-danger',
		text: '✕',
	});
	deleteBtn.title = opts.title;
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		new ConfirmModal(app, opts.message(opts.selected.size), () => { void opts.onConfirm(); }).open();
	});
	return bar;
}

/** "Status…" select for batch status changes; resets itself after `onPick` finished. */
export function renderBatchStatusSelect(
	bar: HTMLElement,
	statusNames: string[],
	onPick: (status: string) => Promise<void>,
): void {
	const statusSelect = bar.createEl('select', { cls: 'wl-select wl-select-sm' });
	statusSelect.createEl('option', { text: 'Status…', value: '' });
	for (const name of statusNames) {
		statusSelect.createEl('option', { text: name, value: name });
	}
	statusSelect.addEventListener('change', () => {
		void (async () => {
			const newStatus = statusSelect.value;
			if (!newStatus) return;
			await onPick(newStatus);
			statusSelect.value = '';
		})();
	});
}

export interface MoveToGroupOptions {
	groups: Array<{ id: string; name: string }>;
	/** A group is selected: groups cannot be moved into other groups. */
	disabled: boolean;
	/** Moves the selected items into an existing group. */
	onMove: (groupId: string) => Promise<void>;
	/** Creates a group from the inline name input and moves the selected items into it. */
	onCreate: (name: string) => Promise<void>;
	/** Leaves the inline input (Escape or ✕); the tab restores its toolbar. */
	onCancel: () => void;
}

/** "Group…" select with "Create new group…", which swaps the select for an inline name input. */
export function renderMoveToGroupSelect(bar: HTMLElement, opts: MoveToGroupOptions): void {
	const moveSelect = bar.createEl('select', { cls: 'wl-select wl-select-sm' });
	if (opts.disabled) {
		moveSelect.disabled = true;
		moveSelect.title = 'A group is selected; cannot move groups into other groups';
	}
	moveSelect.createEl('option', { text: 'Group…', value: '' });
	for (const g of opts.groups) {
		moveSelect.createEl('option', { text: g.name, value: g.id });
	}
	moveSelect.createEl('option', { text: 'Create new group…', value: '__new__' });
	moveSelect.addEventListener('change', () => {
		const value = moveSelect.value;
		if (!value) return;
		if (value === '__new__') {
			moveSelect.value = '';
			moveSelect.hide();
			renderInlineGroupInput(bar, opts);
			return;
		}
		void opts.onMove(value).then(() => { moveSelect.value = ''; });
	});
}

/** Inline input — prompt() is unavailable in Obsidian/Electron. */
function renderInlineGroupInput(bar: HTMLElement, opts: MoveToGroupOptions): void {
	const nameInput = bar.createEl('input', {
		cls: 'wl-modal-input wl-group-name-input',
		attr: { type: 'text', placeholder: 'Group name…', maxlength: '64' },
	});
	const confirmBtn = bar.createEl('button', { cls: 'wl-group-action-btn', text: '✓' });
	confirmBtn.title = 'Create group';
	const cancelBtn = bar.createEl('button', { cls: 'wl-group-action-btn', text: '✕' });
	cancelBtn.title = 'Cancel';

	// Enter twice (or Enter + ✓) while onCreate awaits the store would build two identical groups
	let creating = false;
	const doCreate = async () => {
		const name = nameInput.value.trim();
		if (!name || creating) return;
		creating = true;
		confirmBtn.disabled = true;
		try {
			await opts.onCreate(name);
		} finally {
			creating = false;
			confirmBtn.disabled = false;
		}
	};
	confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); void doCreate(); });
	// cancel only needs the toolbar back
	cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onCancel(); });
	nameInput.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter') void doCreate();
		if (e.key === 'Escape') opts.onCancel();
	});
	nameInput.addEventListener('click', (e) => e.stopPropagation());
	window.setTimeout(() => nameInput.focus(), 0);
}

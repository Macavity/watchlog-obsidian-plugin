// StatusDropdown — shared "coloured dot + label" selection popover, extracted from the duplicated
// status dropdowns in TitleDetailModal / ReadingDetailModal. It assumes nothing about where colours
// come from: the caller supplies `getOptionColor(value)`, and null falls back to the neutral dot.
//
// Also exports renderTagPill — the clickable coloured badge that opens the dropdown, shared by the
// Watchlist / Games detail modals so their status / type / priority pills are one implementation —
// and renderTagChips, the multi-select chip row used by the Games platform pickers.

import type { TagDefinition } from './types';

export interface StatusDropdownOption {
	value: string;
	/** Display label; defaults to `value`. */
	label?: string;
}

export interface StatusDropdownOptions {
	/** Element the dropdown is positioned beneath (the badge / cell). */
	anchor: HTMLElement;
	/** Element the dropdown is appended to. Positioned `fixed`, so any container
	 *  works; also scopes the "remove existing dropdown" cleanup and owns the
	 *  document used for the dismiss listener. */
	container: HTMLElement;
	/** Options to render, as plain strings or `{ value, label }`. */
	options: (string | StatusDropdownOption)[];
	/** Resolves the dot colour for an option value. Return null/undefined to use
	 *  the default neutral dot. */
	getOptionColor?: (value: string) => string | null | undefined;
	/** Called with the chosen value. The dropdown closes itself first. */
	onSelect: (value: string) => void;
	/** Called when the dropdown is dismissed without a selection (outside click). */
	onClose?: () => void;
}

/**
 * Opens the shared status-selection dropdown beneath `anchor`. Any dropdown already open in
 * `container` is removed first.
 */
export function openStatusDropdown(opts: StatusDropdownOptions): void {
	const { anchor, container, options, getOptionColor, onSelect, onClose } = opts;

	container.querySelectorAll('.wl-reading-status-dropdown').forEach((el) => el.remove());

	const rect = anchor.getBoundingClientRect();
	const dropdown = container.createDiv({ cls: 'wl-reading-status-dropdown' });
	dropdown.style.top = `${rect.bottom + 4}px`;
	dropdown.style.left = `${rect.left}px`;
	// capture the owning document once so add/remove can't desync across popout windows
	const doc = container.ownerDocument;

	let picked = false;

	for (const entry of options) {
		const value = typeof entry === 'string' ? entry : entry.value;
		const label = typeof entry === 'string' ? entry : (entry.label ?? entry.value);
		const opt = dropdown.createDiv({ cls: 'wl-reading-status-option' });
		const dot = opt.createSpan({ cls: 'wl-reading-status-option-dot' });
		const color = getOptionColor?.(value);
		// no colour → leave the dot to its default CSS appearance
		if (color) dot.style.backgroundColor = color;
		opt.createSpan({ text: label });
		opt.addEventListener('click', () => {
			picked = true;
			dropdown.remove();
			doc.removeEventListener('mousedown', closeListener, true);
			onSelect(value);
		});
	}

	const closeListener = (e: MouseEvent): void => {
		if (!dropdown.contains(e.target as Node)) {
			dropdown.remove();
			doc.removeEventListener('mousedown', closeListener, true);
			if (!picked) onClose?.();
		}
	};
	window.setTimeout(() => doc.addEventListener('mousedown', closeListener, true), 0);
}

export interface TagPillOptions {
	/** Container the pill is rendered into; emptied first, so the caller can
	 *  re-render a single pill by calling this again with the same wrap. */
	wrap: HTMLElement;
	/** Current value; '' renders the muted placeholder pill. */
	value: string;
	/** Text for the empty value (e.g. 'No priority'). */
	emptyLabel?: string;
	/** Fill colour for the current value; null/undefined ⇒ muted placeholder. */
	color?: string | null;
	/** Render the colour dot inside the pill (the Games modal look). */
	showDot?: boolean;
	/** Hover tooltip, e.g. 'Click to change status'. */
	tooltip?: string;
	/** Dropdown host element (usually the modal's contentEl). */
	container: HTMLElement;
	options: (string | StatusDropdownOption)[];
	getOptionColor?: (value: string) => string | null | undefined;
	onSelect: (value: string) => void;
}

/**
 * The editable status/type/priority pill shared by the detail modals: a colour-filled rounded badge
 * that opens `openStatusDropdown` on click. One implementation, so Watchlist, Reading and Games stay
 * identical — `showDot` is the only per-caller variation.
 */
export function renderTagPill(opts: TagPillOptions): HTMLElement {
	const { wrap, value, color, container, options, getOptionColor, onSelect } = opts;
	wrap.empty();

	const badge = wrap.createSpan({
		cls: `wl-reading-detail-status${color ? '' : ' wl-detail-priority-empty'}`,
	});
	if (opts.showDot) badge.createSpan({ cls: 'wl-detail-status-dot' });
	badge.createSpan({ text: value || (opts.emptyLabel ?? 'None') });
	if (color) badge.style.backgroundColor = color;
	if (opts.tooltip) badge.title = opts.tooltip;

	badge.addEventListener('click', (e) => {
		e.stopPropagation();
		openStatusDropdown({
			anchor: badge,
			container,
			options,
			getOptionColor,
			onSelect,
		});
	});
	return badge;
}

export interface TagChipsOptions {
	/** Container for the chip row; emptied first so it can be re-rendered. */
	wrap: HTMLElement;
	/** The configurable list (name + colour) the chips are drawn from. */
	tags: TagDefinition[];
	/** Names currently selected. */
	selected: string[];
	/** Fired with the new selection whenever a chip is toggled. */
	onToggle: (selected: string[]) => void;
}

/**
 * A multi-select row of colour-filled toggle chips, used for the Games platform pickers. Unlike
 * `renderTagPill` (single value, opens a dropdown) these are independent toggles, but they take
 * their fill from the same `TagDefinition.color` the settings editor writes.
 *
 * Selected chips are filled with their own colour; unselected ones stay muted and carry it only as
 * a tint, driven by `--wl-chip-color` so the CSS stays static.
 */
export function renderTagChips(opts: TagChipsOptions): void {
	const { wrap, tags, onToggle } = opts;
	wrap.empty();
	let selected = [...opts.selected];

	for (const tag of tags) {
		const chip = wrap.createEl('button', {
			cls: 'wl-game-modal-platform',
			text: tag.name,
			attr: { type: 'button' },
		});
		chip.setCssProps({ '--wl-chip-color': tag.color });
		const sync = (): void => chip.toggleClass('is-active', selected.includes(tag.name));
		sync();
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			selected = selected.includes(tag.name)
				? selected.filter((p) => p !== tag.name)
				: [...selected, tag.name];
			sync();
			onToggle([...selected]);
		});
	}
}

export interface SegmentedToggleOptions<T extends string> {
	/** Container the pill is appended to (not emptied). */
	parent: HTMLElement;
	/** The mutually exclusive choices, in display order. */
	options: Array<{ value: T; label: string; title?: string }>;
	/** Currently active value. */
	value: T;
	/** Fired only when a *different* segment is picked. */
	onPick: (value: T) => void;
	/** Accent for the active segment. Defaults to the accent purple. */
	color?: string;
}

/**
 * A compact single-select segmented pill — the Settings `wl-sg-seg` look without its accent-triple
 * dependency, so it works anywhere. Used for the Pages/Words switch in the Reading modals.
 */
export function renderSegmentedToggle<T extends string>(opts: SegmentedToggleOptions<T>): HTMLElement {
	const seg = opts.parent.createDiv({ cls: 'wl-seg-toggle' });
	seg.setCssProps({ '--wl-seg-color': opts.color ?? '#8b5cf6' });

	for (const option of opts.options) {
		const btn = seg.createEl('button', {
			cls: 'wl-seg-toggle-btn',
			text: option.label,
			attr: { type: 'button', title: option.title ?? option.label },
		});
		const active = option.value === opts.value;
		btn.toggleClass('is-active', active);
		btn.setAttr('aria-pressed', String(active));
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (option.value === opts.value) return;
			opts.onPick(option.value);
		});
	}

	return seg;
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusDropdown — shared "colored dot + label" selection popover.
//
// Extracted from the duplicated status dropdowns in TitleDetailModal /
// ReadingDetailModal so the same component serves user-configurable status
// colours (Watchlist / Reading) and Custom Lists per-option colours. The
// component makes NO assumption about where colours come from: the caller
// supplies them via `getOptionColor(value)`. Options whose colour resolves to
// null/undefined fall back to the dropdown's default (neutral) dot appearance.
//
// Open/position/dismiss behaviour and the dot + label rendering match the
// original Reading status dropdown exactly (it reuses the same CSS classes).
// ─────────────────────────────────────────────────────────────────────────────

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
 * Opens the shared status-selection dropdown beneath `anchor`. Any dropdown
 * already open in `container` is removed first.
 */
export function openStatusDropdown(opts: StatusDropdownOptions): void {
	const { anchor, container, options, getOptionColor, onSelect, onClose } = opts;

	container.querySelectorAll('.wl-reading-status-dropdown').forEach((el) => el.remove());

	const rect = anchor.getBoundingClientRect();
	const dropdown = container.createDiv({ cls: 'wl-reading-status-dropdown' });
	dropdown.style.top = `${rect.bottom + 4}px`;
	dropdown.style.left = `${rect.left}px`;
	// Capture the owning document once so add/remove can't desync across popout windows.
	const doc = container.ownerDocument;

	let picked = false;

	for (const entry of options) {
		const value = typeof entry === 'string' ? entry : entry.value;
		const label = typeof entry === 'string' ? entry : (entry.label ?? entry.value);
		const opt = dropdown.createDiv({ cls: 'wl-reading-status-option' });
		const dot = opt.createSpan({ cls: 'wl-reading-status-option-dot' });
		const color = getOptionColor?.(value);
		// No colour → leave the dot to its default CSS appearance.
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

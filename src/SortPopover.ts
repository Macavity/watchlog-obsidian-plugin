/**
 * The shared "Sorting ▼" popover: a "Sort by" row and a "Then by" row (with None), each a key
 * select plus an ↑/↓ direction button. Picking a key resets its direction to that key's default;
 * any change closes the panel and reports the full new state. Used by ListTab and GamesTab.
 */

export interface SortState {
	key: string;
	dir: 'asc' | 'desc';
}

export interface SortPopoverConfig {
	/** The button wrap — the panel is appended inside it. */
	wrap: HTMLElement;
	/** The Sorting button (mobile positioning anchor). */
	anchor: HTMLElement;
	/** Display labels, in menu order. */
	options: string[];
	labelToKey: (label: string) => string;
	/** Default direction applied when a key is newly selected. */
	defaultDirs: Record<string, 'asc' | 'desc'>;
	primary: SortState;
	secondary: SortState;
	/** Persist + re-render; the panel has already closed. */
	onChange: (primary: SortState, secondary: SortState) => void;
	/**
	 * Hands the caller a teardown to run on re-render / view close (the tab's `activeCleanups`
	 * array). Without it a popover left open when its tab goes away keeps a document-level click
	 * listener alive until the next click anywhere.
	 */
	registerCleanup?: (fn: () => void) => void;
}

/** Opens the panel inside the wrap, or closes an already-open one (toggle). */
export function toggleSortPopover(cfg: SortPopoverConfig): void {
	const existing = cfg.wrap.querySelector('.wl-dropdown');
	if (existing) { existing.remove(); return; }

	const panel = cfg.wrap.createDiv({ cls: 'wl-dropdown wl-sorting-panel' });

	if (window.innerWidth <= 600) {
		const rect = cfg.anchor.getBoundingClientRect();
		panel.addClass('wl-sorting-panel-mobile');
		panel.style.top = `${rect.bottom + 4}px`;
	}

	// working copy — committed through onChange on every interaction
	const state = {
		primary: { ...cfg.primary },
		secondary: { ...cfg.secondary },
	};

	// guards the deferred listener attach below and makes closePanel idempotent, so a teardown that
	// beats the timeout can never leave an orphan listener on the document
	let closed = false;
	const closePanel = (): void => {
		if (closed) return;
		closed = true;
		panel.remove();
		activeDocument.removeEventListener('click', closer, true);
	};

	const addSortRow = (labelText: string, current: SortState, isPrimary: boolean): void => {
		const row = panel.createDiv({ cls: 'wl-filter-row' });
		row.createSpan({ cls: 'wl-filter-label', text: labelText });
		const sel = row.createEl('select', { cls: 'wl-select' });

		if (!isPrimary) {
			const noneOpt = sel.createEl('option', { text: 'None', value: 'none' });
			noneOpt.selected = current.key === 'none';
		}
		for (const opt of cfg.options) {
			const el = sel.createEl('option', { text: opt, value: opt });
			if (cfg.labelToKey(opt) === current.key) el.selected = true;
		}

		const dirBtn = row.createEl('button', {
			cls: 'wl-btn wl-btn-sm wl-sort-dir-btn',
			text: current.dir === 'asc' ? '↑' : '↓',
		});
		dirBtn.title = current.dir === 'asc'
			? 'Ascending; click to switch to descending'
			: 'Descending; click to switch to ascending';

		sel.addEventListener('change', () => {
			const newKey = sel.value === 'none' ? 'none' : cfg.labelToKey(sel.value);
			const target = isPrimary ? state.primary : state.secondary;
			target.key = newKey;
			target.dir = cfg.defaultDirs[newKey] ?? 'asc';
			closePanel();
			cfg.onChange(state.primary, state.secondary);
		});

		dirBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			const target = isPrimary ? state.primary : state.secondary;
			target.dir = target.dir === 'asc' ? 'desc' : 'asc';
			closePanel();
			cfg.onChange(state.primary, state.secondary);
		});
	};

	addSortRow('Sort by', state.primary, true);
	addSortRow('Then by', state.secondary, false);

	const closer = (ev: MouseEvent): void => {
		if (!cfg.wrap.contains(ev.target as Node)) {
			closePanel();
		}
	};
	// deferred so the click that opened the panel doesn't immediately close it
	window.setTimeout(() => {
		if (!closed) activeDocument.addEventListener('click', closer, true);
	}, 0);
	cfg.registerCleanup?.(closePanel);
}

// RowsView — shared building blocks for a Rows view (the horizontal-shelves layout): shelf headers
// and the single non-wrapping card strip. The shelf *logic* (which items, what order) stays with
// the tab; only the DOM shape is shared. The virtualised per-section grids a Rows view mixes in are
// driven by VirtualGrid + VirtualScroller, not by this module.

/**
 * Per-section select-all box, shown in the header while selection mode is on. Ids rather than DOM,
 * because the grid sections are virtualised: most cards of a section are not rendered.
 */
export interface ShelfSelect {
	/** every item id the section covers */
	ids: string[];
	/** the tab's live selection set */
	selected: Set<string>;
	/** add or remove all of `ids`, then repaint */
	onToggle: (ids: string[], selectAll: boolean) => void;
	/**
	 * Hands back a refresher so the tab can re-sync this box when the selection changes
	 * elsewhere (a single card, the global All/None). Tabs that re-render wholesale skip it.
	 */
	register?: (refresh: () => void) => void;
}

/** Tri-state box: all / none / some of the section's ids selected. */
function renderShelfSelect(parent: HTMLElement, label: string, spec: ShelfSelect): void {
	const box = parent.createEl('button', { cls: 'wl-shelf-select' });
	const countSelected = (): number => spec.ids.reduce((n, id) => n + (spec.selected.has(id) ? 1 : 0), 0);

	const refresh = (): void => {
		const sel = countSelected();
		const all = sel === spec.ids.length;
		const partial = sel > 0 && !all;
		box.toggleClass('is-all', all);
		box.toggleClass('is-partial', partial);
		box.setText(all ? '✓' : partial ? '–' : '');
		box.setAttribute('aria-label', `${all ? 'Deselect' : 'Select'} all in ${label}`);
	};

	box.addEventListener('click', (e) => {
		e.stopPropagation();
		spec.onToggle(spec.ids, countSelected() !== spec.ids.length);
		refresh();
	});
	refresh();
	spec.register?.(refresh);
}

/** Shelf/section header: label + muted "(N)" count of the rendered items. */
export function renderShelfTitle(
	parent: HTMLElement,
	label: string,
	count: number,
	select?: ShelfSelect,
): void {
	const titleEl = parent.createDiv({ cls: 'wl-rows-shelf-title' });
	if (select && select.ids.length > 0) renderShelfSelect(titleEl, label, select);
	titleEl.createSpan({ text: label });
	titleEl.createSpan({ cls: 'wl-rows-shelf-count', text: `(${count})` });
}

/**
 * One horizontal shelf: header + a single non-wrapping strip of poster cards. With `hideWhenEmpty`
 * (an active search/filter) an empty shelf renders nothing at all.
 */
export function renderShelf<T>(
	parent: HTMLElement,
	label: string,
	items: T[],
	emptyMsg: string,
	hideWhenEmpty: boolean,
	renderCard: (strip: HTMLElement, item: T) => void,
	select?: ShelfSelect,
): void {
	if (items.length === 0 && hideWhenEmpty) return;
	const shelf = parent.createDiv({ cls: 'wl-rows-shelf' });
	renderShelfTitle(shelf, label, items.length, select);
	if (items.length === 0) {
		shelf.createDiv({ cls: 'wl-rows-shelf-empty', text: emptyMsg });
		return;
	}
	const strip = shelf.createDiv({ cls: 'wl-rows-strip' });
	for (const item of items) {
		renderCard(strip, item);
	}
}

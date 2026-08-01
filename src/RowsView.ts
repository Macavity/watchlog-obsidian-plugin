// RowsView — shared building blocks for a Rows view (the horizontal-shelves layout): shelf headers
// and the single non-wrapping card strip. The shelf *logic* (which items, what order) stays with
// the tab; only the DOM shape is shared. The virtualised per-section grids a Rows view mixes in are
// driven by VirtualGrid + VirtualScroller, not by this module.

/** Shelf/section header: label + muted "(N)" count of the rendered items. */
export function renderShelfTitle(parent: HTMLElement, label: string, count: number): void {
	const titleEl = parent.createDiv({ cls: 'wl-rows-shelf-title' });
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
): void {
	if (items.length === 0 && hideWhenEmpty) return;
	const shelf = parent.createDiv({ cls: 'wl-rows-shelf' });
	renderShelfTitle(shelf, label, items.length);
	if (items.length === 0) {
		shelf.createDiv({ cls: 'wl-rows-shelf-empty', text: emptyMsg });
		return;
	}
	const strip = shelf.createDiv({ cls: 'wl-rows-strip' });
	for (const item of items) {
		renderCard(strip, item);
	}
}

// VirtualGrid — shared window-diffing core for the virtualised poster grids: the Cards view's
// single full-height grid and each Rows-view "By type" grid. One instance owns one spacer (whose
// height reserves the full scroll extent) and one absolutely-positioned grid (holding only the
// materialised rows). The caller owns the scroll listener, geometry reads and the poster observer;
// this only diffs the visible window and mutates the DOM.
//
// Deliberately Obsidian-free (plain DOM) so it can run standalone in the headless-Chromium CLS
// harness.

export interface GridMetrics {
	cols: number;
	cardWidth: number;
	cardHeight: number;
	rowHeight: number;
}

const GRID_GAP = 12;
const MIN_CARD_WIDTH = 160;
const OVERSCAN_ROWS = 2;

/**
 * "Card size" step → minimum card width. Index = step + 3 (steps run −3..+3); step 0 is the 160px
 * default (the pre-2.3 scale survives as the lower steps, so the old 140px default is exactly one
 * step down). Spaced ~15% apart so each step reliably changes the column count — cards stretch to
 * fill their column, so a smaller nudge would often change nothing.
 */
export const CARD_SIZE_WIDTHS = [100, 120, 140, 160, 185, 215, 250] as const;

/** Resolve a stored card-size step (may be missing/out-of-range) to its minimum card width. */
export function cardSizeToMinWidth(step: number | undefined): number {
	const idx = Math.round(step ?? 0) + 3;
	return CARD_SIZE_WIDTHS[Math.max(0, Math.min(CARD_SIZE_WIDTHS.length - 1, idx))] ?? MIN_CARD_WIDTH;
}

/**
 * Column/card geometry for a poster grid of the given container width — mirrors the CSS
 * `minmax(<min>, 1fr)` auto-fill columns and the 2:3 ratio. `minCardWidth` comes from the card-size
 * setting (default 160px).
 */
export function computeGridMetrics(containerWidth: number, minCardWidth = MIN_CARD_WIDTH): GridMetrics {
	const cols = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (minCardWidth + GRID_GAP)));
	const cardWidth = (containerWidth - GRID_GAP * (cols - 1)) / cols;
	const cardHeight = cardWidth * 1.5;
	return { cols, cardWidth, cardHeight, rowHeight: cardHeight + GRID_GAP };
}

/**
 * Publish the grid-mirrored card width on a Rows scroll container — the `--wl-rows-card-width` the
 * shelf cards size from. Shelves track the *computed* grid card width, not the raw minimum, so
 * shelf and grid cards match at any pane width. No-ops on an unchanged value (this runs on every
 * scroll tick) and on degenerate widths (a hidden pane measures 0).
 */
export function setRowsCardWidth(scroll: HTMLElement, cardWidth: number): void {
	if (!(cardWidth > 0)) return;
	const px = `${Math.round(cardWidth)}px`;
	if (scroll.style.getPropertyValue('--wl-rows-card-width') !== px) {
		scroll.style.setProperty('--wl-rows-card-width', px);
	}
}

export interface VirtualGridCallbacks {
	/** Build the card for item `index`; return its root element (not attached). */
	buildItem(index: number, cardWidth: number, cardHeight: number): HTMLElement | null;
	/** Detach one previously built card (unobserve from the poster observer, remove from the DOM). */
	removeItem(el: HTMLElement): void;
}

export interface VirtualGridOptions {
	/**
	 * CSS custom properties the grid's stylesheet reads for column count and card height. Defaults are
	 * the Cards-view names; the Reading grid passes its own.
	 */
	colsVar?: string;
	cardHeightVar?: string;
}

export class VirtualGrid {
	private spacer: HTMLElement;
	private grid: HTMLElement;
	private cb: VirtualGridCallbacks;
	private colsVar: string;
	private cardHeightVar: string;
	readonly itemCount: number;

	// materialised item window (inclusive). (-1, -1) = never rendered; an empty window (grid fully
	// outside the viewport) is (0, -1).
	private lastFirst = -1;
	private lastLast = -1;
	// last-applied layout-write inputs — used to skip the spacer/padding/CSS-var writes when neither
	// the scroll offset nor the geometry changed, so a same-window scroll tick doesn't dirty layout
	private lastFirstRow = -1;
	private lastCols = -1;
	private lastCardHeight = -1;
	private lastTotalRows = -1;

	constructor(
		spacer: HTMLElement,
		grid: HTMLElement,
		itemCount: number,
		cb: VirtualGridCallbacks,
		options?: VirtualGridOptions,
	) {
		this.spacer = spacer;
		this.grid = grid;
		this.itemCount = itemCount;
		this.cb = cb;
		this.colsVar = options?.colsVar ?? '--wl-cards-cols';
		this.cardHeightVar = options?.cardHeightVar ?? '--wl-card-height';
	}

	/**
	 * Reserve the grid's full height for the given geometry without rendering anything. Lets the Rows
	 * view size every spacer up-front, so offsets measured before the first update() are already final
	 * (zero CLS).
	 */
	reserveHeight(metrics: GridMetrics): void {
		const totalRows = Math.ceil(this.itemCount / metrics.cols);
		this.spacer.style.height = `${totalRows * metrics.rowHeight}px`;
	}

	/**
	 * Re-window the grid for the given scroll position. `localScrollTop` is relative to the grid's own
	 * top edge — negative while the grid is below the viewport, past its height once scrolled by (both
	 * happen in the Rows view, where several grids share one scroller). Returns true when the
	 * materialised card set changed, so the caller can re-register the poster observer.
	 */
	update(localScrollTop: number, viewportHeight: number, metrics: GridMetrics): boolean {
		const { cols, cardWidth, cardHeight, rowHeight } = metrics;
		const totalRows = Math.ceil(this.itemCount / cols);

		let firstVisibleRow = Math.max(0, Math.floor(localScrollTop / rowHeight) - OVERSCAN_ROWS);
		const lastVisibleRow = Math.min(
			totalRows - 1,
			Math.ceil((localScrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
		);

		let firstIndex: number;
		let lastIndex: number;
		if (lastVisibleRow < firstVisibleRow || this.itemCount === 0) {
			// grid entirely outside the viewport (± overscan) — empty window
			firstVisibleRow = 0;
			firstIndex = 0;
			lastIndex = -1;
		} else {
			firstIndex = firstVisibleRow * cols;
			lastIndex = Math.min(this.itemCount - 1, (lastVisibleRow + 1) * cols - 1);
		}

		const oldFirst = this.lastFirst;
		const oldLast = this.lastLast;
		const windowUnchanged = firstIndex === oldFirst && lastIndex === oldLast;

		// the four layout writes below depend only on these inputs (rowHeight is cardHeight plus a fixed
		// gap). When none changed, the writes would be no-ops that still dirty layout — so skip them.
		const layoutUnchanged =
			firstVisibleRow === this.lastFirstRow &&
			cols === this.lastCols &&
			cardHeight === this.lastCardHeight &&
			totalRows === this.lastTotalRows;

		// same window and same geometry — bail before any DOM write, so a scroll within the current row
		// window stays free
		if (windowUnchanged && layoutUnchanged) return false;

		if (!layoutUnchanged) {
			this.spacer.style.height = `${totalRows * rowHeight}px`;
			// Offset the grid with padding-top, NOT transform: translateY. With a transform, every row advance
			// (remove top row + append bottom row + transform bump in one frame) makes Chromium's layout-shift
			// tracker report a full row of stationary cards as shifted (previousRect 0×0 → poster rect) — the
			// CLS that climbed on every scroll. Padding replaces the removed row in layout, so each surviving
			// card's rect is literally unchanged. (Verified in a headless-Chromium harness: transform ≈ 0.14
			// CLS per row advance; padding-top = 0. ReadingTab avoids it differently, by rebuilding the whole
			// window — inserted-only content is never counted as a shift.)
			this.grid.style.paddingTop = `${firstVisibleRow * rowHeight}px`;
			this.grid.style.setProperty(this.colsVar, String(cols));
			this.grid.style.setProperty(this.cardHeightVar, `${cardHeight}px`);
			this.lastFirstRow = firstVisibleRow;
			this.lastCols = cols;
			this.lastCardHeight = cardHeight;
			this.lastTotalRows = totalRows;
		}

		if (windowUnchanged) return false;

		const isInitial = oldFirst === -1 && oldLast === -1;
		const oldEmpty = oldLast < oldFirst;
		const newEmpty = lastIndex < firstIndex;
		const hasOverlap =
			!isInitial && !oldEmpty && !newEmpty && firstIndex <= oldLast && lastIndex >= oldFirst;

		this.lastFirst = firstIndex;
		this.lastLast = lastIndex;

		if (!hasOverlap) {
			this.removeAllCards();
			const fragment = this.grid.ownerDocument.createDocumentFragment();
			for (let i = firstIndex; i <= lastIndex; i++) {
				const card = this.cb.buildItem(i, cardWidth, cardHeight);
				if (card) fragment.appendChild(card);
			}
			this.grid.appendChild(fragment);
			return true;
		}

		// incremental update — trim from the edges, then add what's new
		if (firstIndex > oldFirst) {
			const removeCount = firstIndex - oldFirst;
			for (let i = 0; i < removeCount; i++) {
				const el = this.grid.firstElementChild as HTMLElement | null;
				if (!el) break;
				this.cb.removeItem(el);
			}
		}
		if (lastIndex < oldLast) {
			const removeCount = oldLast - lastIndex;
			for (let i = 0; i < removeCount; i++) {
				const el = this.grid.lastElementChild as HTMLElement | null;
				if (!el) break;
				this.cb.removeItem(el);
			}
		}
		if (firstIndex < oldFirst) {
			const addEnd = Math.min(oldFirst - 1, lastIndex);
			const fragment = this.grid.ownerDocument.createDocumentFragment();
			for (let i = firstIndex; i <= addEnd; i++) {
				const card = this.cb.buildItem(i, cardWidth, cardHeight);
				if (card) fragment.appendChild(card);
			}
			this.grid.insertBefore(fragment, this.grid.firstChild);
		}
		if (lastIndex > oldLast) {
			const addStart = Math.max(oldLast + 1, firstIndex);
			const fragment = this.grid.ownerDocument.createDocumentFragment();
			for (let i = addStart; i <= lastIndex; i++) {
				const card = this.cb.buildItem(i, cardWidth, cardHeight);
				if (card) fragment.appendChild(card);
			}
			this.grid.appendChild(fragment);
		}

		return true;
	}

	private removeAllCards(): void {
		let el = this.grid.firstElementChild as HTMLElement | null;
		while (el) {
			const next = el.nextElementSibling as HTMLElement | null;
			this.cb.removeItem(el);
			el = next;
		}
	}
}

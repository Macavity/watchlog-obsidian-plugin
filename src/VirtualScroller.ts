// VirtualScroller — shared scroll driver for the virtualised poster grids: one scroll container
// holding one or more VirtualGrid sections. Cards view is the one-section case; the Rows "By type"
// grids and the Upcoming month sections are the many-sections case. Owns everything the tabs used
// to duplicate: the passive rAF-coalesced scroll listener with a half-row movement threshold, the
// ResizeObserver remeasure, each spacer's cached offset from the content top, up-front height
// reservation (so offsets are final before any window materialises — zero layout shift by
// construction), and scroll restore across re-renders.
//
// The caller supplies geometry (`metrics`) and reacts to window changes (`onWindowChanged`,
// typically re-registering its lazy poster observer). Obsidian-free, like VirtualGrid.

import type { VirtualGrid, GridMetrics } from './VirtualGrid';

export interface VirtualScrollerOptions {
	scroll: HTMLElement;
	/** Grid geometry for the scroller's current clientWidth. */
	metrics: (width: number) => GridMetrics;
	/**
	 * Fired after an update in which any section's materialised card set changed — new cards may need
	 * lazy-poster observation.
	 */
	onWindowChanged?: () => void;
	/** Fired on every scroll with the current scrollTop, so the owner can persist it across re-renders. */
	onScrollPos?: (scrollTop: number) => void;
}

interface Section {
	vgrid: VirtualGrid;
	spacer: HTMLElement;
	// spacer offset from the scroller's content top (scrollTop coords), re-measured on resize —
	// offsets shift when cols/heights change
	top: number;
}

export class VirtualScroller {
	private opts: VirtualScrollerOptions;
	private sections: Section[] = [];
	private scrollHandler: (() => void) | null = null;
	private raf: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private needsRemeasure = false;
	private lastScrollTop = 0;
	private rowHeight = 0;

	constructor(opts: VirtualScrollerOptions) {
		this.opts = opts;
	}

	/** Register one virtualised grid section. Call once per section, before attach(). */
	addSection(vgrid: VirtualGrid, spacer: HTMLElement): void {
		this.sections.push({ vgrid, spacer, top: 0 });
	}

	/**
	 * Install the scroll listener + resize observer, reserve every section's full height, restore the
	 * given scroll position, and materialise the initial windows. Call once all sections are added and
	 * the DOM is attached (offsets are measured from the live layout).
	 */
	attach(restoreScrollTop = 0): void {
		const scroll = this.opts.scroll;

		const metrics = this.opts.metrics(scroll.clientWidth);
		this.rowHeight = metrics.rowHeight;
		// reserve all heights first, then the single batched offset read pass (writes-then-reads, one
		// forced layout) — offsets measured here are final, so sections materialising later move nothing
		for (const s of this.sections) s.vgrid.reserveHeight(metrics);
		this.measureOffsets();

		this.scrollHandler = () => {
			const scrollTop = scroll.scrollTop;
			this.opts.onScrollPos?.(scrollTop);
			// below half a row of movement the visible range cannot change
			const threshold = this.rowHeight > 0 ? this.rowHeight / 2 : 50;
			if (Math.abs(scrollTop - this.lastScrollTop) < threshold) return;
			this.lastScrollTop = scrollTop;
			this.schedule();
		};
		scroll.addEventListener('scroll', this.scrollHandler, { passive: true });

		// a width change moves cols, every spacer height and every offset — remeasure and re-window in one
		// rAF (a resize can fire a burst, e.g. scrollbar appear/disappear)
		this.resizeObserver = new ResizeObserver(() => {
			this.needsRemeasure = true;
			this.schedule();
		});
		this.resizeObserver.observe(scroll);

		// heights are already reserved, so the assignment sticks
		if (restoreScrollTop > 0) {
			scroll.scrollTop = restoreScrollTop;
			this.lastScrollTop = scroll.scrollTop;
		}
		this.updateWindows();
	}

	destroy(): void {
		if (this.raf !== null) {
			window.cancelAnimationFrame(this.raf);
			this.raf = null;
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.scrollHandler) {
			this.opts.scroll.removeEventListener('scroll', this.scrollHandler);
			this.scrollHandler = null;
		}
		this.sections = [];
		this.needsRemeasure = false;
		this.lastScrollTop = 0;
		this.rowHeight = 0;
	}

	private schedule(): void {
		if (this.raf !== null) return;
		this.raf = window.requestAnimationFrame(() => {
			this.raf = null;
			this.updateWindows();
		});
	}

	/**
	 * Cache each spacer's offset from the scroller's content top. One batched read pass — no
	 * interleaved writes.
	 */
	private measureOffsets(): void {
		const scroll = this.opts.scroll;
		const contentTop = scroll.getBoundingClientRect().top - scroll.scrollTop;
		for (const s of this.sections) {
			s.top = s.spacer.getBoundingClientRect().top - contentTop;
		}
	}

	private updateWindows(): void {
		const scroll = this.opts.scroll;
		if (this.sections.length === 0) return;
		const viewportHeight = scroll.clientHeight;
		const width = scroll.clientWidth;
		if (width <= 0 || viewportHeight <= 0) return;

		const metrics = this.opts.metrics(width);
		if (this.needsRemeasure || metrics.rowHeight !== this.rowHeight) {
			this.needsRemeasure = false;
			this.rowHeight = metrics.rowHeight;
			// new geometry: write all spacer heights first, then the single batched offset re-read
			for (const s of this.sections) s.vgrid.reserveHeight(metrics);
			this.measureOffsets();
		}

		const scrollTop = scroll.scrollTop;
		let windowChanged = false;
		for (const s of this.sections) {
			// each section windows against its own local offset — negative while below the viewport, past its
			// height once scrolled by
			if (s.vgrid.update(scrollTop - s.top, viewportHeight, metrics)) {
				windowChanged = true;
			}
		}
		if (windowChanged) this.opts.onWindowChanged?.();
	}
}

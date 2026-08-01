// LazyCardObserver — shared IntersectionObserver lifecycle for lazy poster/cover fetching: cards
// flagged with a data attribute are observed, and the first time one enters the viewport it is
// unobserved and handed to the owner's callback in a batch. Extracted from the three per-tab copies
// (Watchlist cards, Reading covers, Upcoming tracker cells).
//
// One instance per rendered view (the root is the view's scroll container); destroy() on teardown.
// Cards leaving a virtual window are detached through unobserveAndRemove (VirtualGrid's removeItem).

export class LazyCardObserver {
	private observer: IntersectionObserver | null = null;
	private observed: Set<HTMLElement> = new Set();
	private selector: string;
	private onVisible: (cards: HTMLElement[]) => void;

	/**
	 * @param selector matches the cards that still need their image, e.g.
	 *   `.wl-card[data-needs-poster="true"]`
	 * @param onVisible called with each batch of cards that entered the
	 *   viewport (already unobserved — a card is handed over exactly once)
	 */
	constructor(selector: string, onVisible: (cards: HTMLElement[]) => void) {
		this.selector = selector;
		this.onVisible = onVisible;
	}

	/**
	 * Observe any not-yet-observed matching cards inside `scope` (defaults to `root`). The observer is
	 * created on first call with `root` as its viewport. Call after every render/window change that may
	 * add cards.
	 */
	observeNew(root: HTMLElement, scope?: HTMLElement): void {
		if (!this.observer) {
			this.observer = new IntersectionObserver(
				(entries) => {
					const visible: HTMLElement[] = [];
					for (const entry of entries) {
						if (!entry.isIntersecting) continue;
						const el = entry.target as HTMLElement;
						this.observer?.unobserve(el);
						this.observed.delete(el);
						visible.push(el);
					}
					if (visible.length > 0) this.onVisible(visible);
				},
				{ root, rootMargin: '0px', threshold: 0 },
			);
		}
		(scope ?? root).querySelectorAll(this.selector).forEach((card) => {
			const el = card as HTMLElement;
			if (!this.observed.has(el)) {
				this.observer!.observe(el);
				this.observed.add(el);
			}
		});
	}

	/**
	 * VirtualGrid removeItem hook: unobserve + detach one card. `el` may be a wrapper cell (text-under
	 * cards) whose observed card is a descendant — drop those too, or the observed set would hold
	 * removed cards until destroy().
	 */
	unobserveAndRemove(el: HTMLElement): void {
		const drop = (t: HTMLElement): void => {
			this.observer?.unobserve(t);
			this.observed.delete(t);
		};
		if (this.observed.has(el)) drop(el);
		for (const t of Array.from(this.observed)) {
			if (el.contains(t)) drop(t);
		}
		el.remove();
	}

	destroy(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		this.observed.clear();
	}
}

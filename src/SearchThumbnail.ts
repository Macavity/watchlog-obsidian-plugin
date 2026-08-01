/**
 * Renders a ~40×60 (2:3) cover thumbnail for an add-flow search-result row.
 *
 * Mirrors the Cards-view fallback: a gray placeholder div with an icon sits underneath, and a lazily
 * loaded <img> layers on top when a URL is present. A missing or failed image removes itself,
 * revealing the placeholder — so callers never special-case the no-image branch.
 *
 * Returns the thumbnail (already appended to `parent`).
 */
export function renderSearchThumbnail(
	parent: HTMLElement,
	url: string | undefined,
	alt: string,
	fallbackIcon: string,
): HTMLElement {
	const thumb = parent.createDiv({ cls: 'wl-result-thumb' });
	thumb.createSpan({ cls: 'wl-result-thumb-icon', text: fallbackIcon });
	if (url) {
		const img = thumb.createEl('img', {
			cls: 'wl-result-thumb-img',
			attr: { src: url, alt, loading: 'lazy' },
		});
		img.onerror = () => { img.remove(); };
	}
	return thumb;
}

/** Spec for one add-flow search-result row. */
interface SearchResultRowSpec {
	/** Cover URL; falls back to `fallbackIcon` when absent or on load failure. */
	thumbUrl: string | undefined;
	fallbackIcon: string;
	title: string;
	/** Secondary muted line (e.g. "12 eps · 2021", "2020 · PC, PS5"). */
	meta: string;
	/** Library already holding this item ("Games", "Books", …), or null/absent when it is new. */
	inLibrary?: string | null;
	/** Invoked on click; receives the row element so callers can toggle `is-selected`. */
	onClick: (itemEl: HTMLElement) => void;
}

/**
 * Renders one search-result card (cover on top · title · meta beneath) shared by every add-flow
 * modal, so the card's look lives in one place. The parent `.wl-modal-results` lays these out as a
 * grid. Appends to `container` and returns the card.
 */
export function renderSearchResultRow(
	container: HTMLElement,
	spec: SearchResultRowSpec,
): HTMLElement {
	const item = container.createDiv({ cls: 'wl-result-card' });
	const thumb = renderSearchThumbnail(item, spec.thumbUrl, spec.title, spec.fallbackIcon);
	if (spec.inLibrary) {
		// badge after the img so it paints on top; the card still adds normally
		item.addClass('is-in-library');
		const badge = thumb.createDiv({ cls: 'wl-result-owned-badge' });
		badge.createSpan({ cls: 'wl-result-owned-check', text: '✓' });
		badge.createSpan({ text: spec.inLibrary });
		item.title = `Already in ${spec.inLibrary}`;
	}
	const text = item.createDiv({ cls: 'wl-result-text' });
	text.createDiv({ cls: 'wl-result-title', text: spec.title });
	text.createDiv({ cls: 'wl-result-meta', text: spec.meta });
	item.addEventListener('click', () => spec.onClick(item));
	return item;
}

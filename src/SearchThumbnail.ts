/**
 * Renders a ~40×60 (2:3 poster) cover thumbnail for an add-flow search-result row.
 *
 * Mirrors the Cards-view fallback approach: a gray placeholder div carrying an icon
 * sits underneath, and a lazily-loaded <img> is layered on top when a URL is present.
 * If the image is missing or fails to load the <img> removes itself, revealing the
 * placeholder — so callers never need to special-case the no-image branch.
 *
 * Returns the thumbnail element (already appended to `parent`) so callers can place
 * the title/meta column after it.
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

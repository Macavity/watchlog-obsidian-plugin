/**
 * Generic group-card collage helper.
 *
 * Agnostic to Watch vs Reading: callers pass the group's items plus an accessor resolving each
 * item's cover URL.
 *
 * Selection: the first up-to-3 items with a valid cover (skipping empty / 'none'); the strip count
 * equals the covers found (1–3). None found ⇒ the letter fallback.
 *
 * Covers are painted as CSS background-images, not <img>, so a cover loading never reflows the card
 * inside the virtual-scrolled grids.
 */
export function renderGroupCollage<T>(
	parent: HTMLElement,
	items: readonly T[],
	getCover: (item: T) => string,
	fallback: { letter: string; color: string },
): HTMLElement {
	const covers: string[] = [];
	for (const item of items) {
		const url = getCover(item);
		if (url && url !== 'none' && url.trim() !== '') {
			covers.push(url);
			if (covers.length === 3) break;
		}
	}

	if (covers.length === 0) {
		const placeholder = parent.createDiv({ cls: 'wl-card-poster-placeholder' });
		placeholder.style.backgroundColor = fallback.color;
		placeholder.createSpan({ text: fallback.letter });
		return placeholder;
	}

	const collage = parent.createDiv({ cls: 'wl-card-collage' });
	for (const url of covers) {
		const strip = collage.createDiv({ cls: 'wl-card-collage-strip' });
		// escape double quotes so a URL can't break out of the CSS url("…")
		strip.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
	}
	return collage;
}

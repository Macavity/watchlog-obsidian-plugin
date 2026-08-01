// Shared star-rating control — one renderer for every star input (TitleDetailModal, EditTitleModal,
// ReadingDetailModal, AddReadingModal, ListTab, GameDetailModal). Draws 5 stars, shows `.5` values
// as half-filled, previews the hovered value, and emits via onChange. Clicking the selected value
// clears the rating (emits 0).
//
// Colour + label come from the five-tier rating system: every filled star takes the *current
// value's* tier colour — a 5-star rating paints all five in tier 5's colour — and an optional
// trailing label shows that tier's text. N and N.5 share tier N; 0 is the unrated state.

import type { RatingTier } from './types';

/** Text shown for the unrated (0) state — not part of the editable five tiers. */
export const UNRATED_LABEL = 'Not rated';

/**
 * Maps a rating to its tier index: 0 when unrated, else 1–5. A whole star shares a tier with the
 * half-step *below* it, so we ceil: 0.5 & 1 → 1, … 4.5 & 5 → 5. Never exceeds 5.
 */
export function ratingTierIndex(rating: number): number {
	if (!(rating > 0)) return 0;
	return Math.min(5, Math.ceil(rating));
}

/** Tier colour for a rating, or '' when unrated. */
export function ratingColor(rating: number, tiers: RatingTier[]): string {
	const idx = ratingTierIndex(rating);
	return idx === 0 ? '' : (tiers[idx - 1]?.color ?? '');
}

/** Tier label for a rating, or the unrated label when 0. */
export function ratingLabel(rating: number, tiers: RatingTier[]): string {
	const idx = ratingTierIndex(rating);
	return idx === 0 ? UNRATED_LABEL : (tiers[idx - 1]?.label ?? '');
}

export interface StarRatingOptions {
	/** When true, the left half of a star selects `.5` and the right half the whole star. */
	allowHalf: boolean;
	/** The five rating tiers (settings.ratingSystem) — drives per-star colour and the label. */
	tiers: RatingTier[];
	/** When true, a trailing text label ("Poor" … "Masterpiece") is rendered after the stars. */
	showLabel?: boolean;
	/** Called with the chosen value (0–5, in 0.5 steps when allowHalf is on). */
	onChange: (value: number) => void;
}

export function renderStarRating(
	container: HTMLElement,
	currentValue: number,
	options: StarRatingOptions,
): void {
	container.empty();
	container.addClass('wl-star-rating');

	const starsWrap = container.createSpan({ cls: 'wl-star-rating-stars' });
	const stars: HTMLElement[] = [];
	for (let i = 1; i <= 5; i++) {
		stars.push(starsWrap.createSpan({ cls: 'wl-star', text: '★' }));
	}

	const labelEl = options.showLabel
		? container.createSpan({ cls: 'wl-star-rating-label' })
		: null;

	const paint = (value: number): void => {
		// every filled star takes the current value's tier colour, so the whole row recolours as the tier
		// changes on hover
		const color = ratingColor(value, options.tiers);
		container.style.setProperty('--wl-rating-color', color || 'var(--text-faint)');
		stars.forEach((star, idx) => {
			const i = idx + 1;
			star.toggleClass('is-active', value >= i);
			star.toggleClass('is-half', value === i - 0.5);
		});
		if (labelEl) {
			labelEl.textContent = ratingLabel(value, options.tiers);
			labelEl.toggleClass('is-unrated', ratingTierIndex(value) === 0);
			labelEl.style.color = ratingColor(value, options.tiers) || '';
		}
	};
	paint(currentValue);

	// allowHalf=false constrains NEW input only — a stored `.5` still displays as a half star and is
	// never rounded or rewritten
	const valueFromEvent = (star: HTMLElement, i: number, e: MouseEvent): number => {
		if (!options.allowHalf) return i;
		const rect = star.getBoundingClientRect();
		return e.clientX - rect.left < rect.width / 2 ? i - 0.5 : i;
	};

	stars.forEach((star, idx) => {
		const i = idx + 1;
		star.addEventListener('mousemove', (e) => paint(valueFromEvent(star, i, e)));
		star.addEventListener('click', (e) => {
			const chosen = valueFromEvent(star, i, e);
			options.onChange(chosen === currentValue ? 0 : chosen);
		});
	});
	// assignment, not addEventListener — callers re-render into the same container, so assignment
	// replaces the stale handler instead of stacking
	container.onmouseleave = () => paint(currentValue);
}

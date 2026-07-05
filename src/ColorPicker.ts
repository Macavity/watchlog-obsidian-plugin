import { FIELD_COLORS, DEFAULT_FIELD_COLOR } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// ColorPicker — shared swatch-picker UI + fill/border colour derivation.
//
// The Reading subsystem historically stored a colour as the "600 stop" hex and
// looked up a paired "50 stop" light tint from a hardcoded table. That only
// worked for the 8 presets. These helpers derive the fill/border variants from
// ANY hex (so custom colours render correctly) while keeping the exact preset
// tints for the 8 built-ins — behaviour for presets is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize hex input to lowercase `#rrggbb`, expanding `#rgb`. Returns the
 *  default field colour for anything unparseable. */
function normalizeHex(input: string): string {
	const hex = (input ?? '').trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
	return DEFAULT_FIELD_COLOR.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const n = normalizeHex(hex);
	return {
		r: parseInt(n.slice(1, 3), 16),
		g: parseInt(n.slice(3, 5), 16),
		b: parseInt(n.slice(5, 7), 16),
	};
}

function toHexComponent(v: number): string {
	return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
}

/** Mix a colour toward white. `amount` is the fraction of the colour kept. */
function mixWithWhite(hex: string, amount: number): string {
	const { r, g, b } = hexToRgb(hex);
	const mix = (c: number): number => 255 * (1 - amount) + c * amount;
	return `#${toHexComponent(mix(r))}${toHexComponent(mix(g))}${toHexComponent(mix(b))}`;
}

/**
 * Light fill tint for a given colour. For the 8 presets this returns the exact
 * authored `color50` so existing fields render identically; for any other hex
 * it derives a light tint programmatically.
 */
export function deriveFillColor(color: string): string {
	const norm = normalizeHex(color);
	for (const { color600, color50 } of FIELD_COLORS) {
		if (normalizeHex(color600) === norm) return color50;
	}
	return mixWithWhite(norm, 0.12);
}

/**
 * Border / strong-accent colour for a given colour. This is the colour itself
 * (the historical "600 stop"), normalized so it works for arbitrary hex input.
 */
export function deriveBorderColor(color: string): string {
	return normalizeHex(color);
}

export interface ColorPickerOptions {
	/** Element the palette is positioned beneath. */
	anchor: HTMLElement;
	/** Element the palette is appended to (positioned `fixed`, so any container works). */
	container: HTMLElement;
	/** Currently selected colour. */
	current: string;
	/** When true, offer a full-spectrum custom-colour swatch in addition to the 8 presets. */
	allowCustom: boolean;
	/** Called with the chosen colour (a `#rrggbb` hex), or `null` when the user
	 *  picks the clear/"no colour" swatch (consumer should revert to its unset state). */
	onPick: (color: string | null) => void;
}

/**
 * Opens the shared colour-swatch picker — the 8 presets plus, when enabled, a
 * custom full-spectrum swatch (native colour input / hex). Matches the visual
 * style of the original Reading swatch palette.
 */
export function openColorPicker(opts: ColorPickerOptions): void {
	const { anchor, container, current, allowCustom, onPick } = opts;

	// Remove any palette already open in this container.
	container.querySelectorAll('.wl-reading-col-palette').forEach((el) => el.remove());

	const rect = anchor.getBoundingClientRect();
	const palette = container.createDiv({ cls: 'wl-reading-col-palette' });
	palette.style.top = `${rect.bottom + 4}px`;
	palette.style.left = `${rect.left}px`;
	// Capture the owning document once so add/remove can't desync across popout windows.
	const doc = container.ownerDocument;
	const normCurrent = normalizeHex(current);

	const close = (e: MouseEvent): void => {
		if (!palette.contains(e.target as Node) && e.target !== anchor) {
			palette.remove();
			doc.removeEventListener('mousedown', close, true);
		}
	};
	const dismiss = (): void => {
		palette.remove();
		doc.removeEventListener('mousedown', close, true);
	};

	let matchedPreset = false;
	for (const { color600, color50 } of FIELD_COLORS) {
		const swatch = palette.createEl('button', { cls: 'wl-reading-col-palette-swatch' });
		swatch.style.backgroundColor = color50;
		swatch.style.borderColor = color600;
		if (normalizeHex(color600) === normCurrent) {
			swatch.addClass('is-active');
			matchedPreset = true;
		}
		swatch.title = color600;
		swatch.addEventListener('click', (e) => {
			e.stopPropagation();
			dismiss();
			onPick(color600);
		});
	}

	if (allowCustom) {
		const customSwatch = palette.createEl('button', {
			cls: 'wl-reading-col-palette-swatch wl-color-custom-swatch',
		});
		customSwatch.title = 'Custom color…';
		if (matchedPreset) {
			// Current colour is a preset: present the custom swatch as a rainbow invite.
			customSwatch.addClass('wl-color-custom-rainbow');
		} else {
			// Current colour is custom: show it, marked active.
			customSwatch.addClass('is-active');
			customSwatch.style.backgroundColor = deriveFillColor(normCurrent);
			customSwatch.style.borderColor = deriveBorderColor(normCurrent);
		}

		const colorInput = customSwatch.createEl('input', {
			cls: 'wl-color-custom-input',
			attr: { type: 'color' },
		});
		colorInput.value = normCurrent;
		customSwatch.addEventListener('click', (e) => {
			e.stopPropagation();
			colorInput.click();
		});
		colorInput.addEventListener('change', (e) => {
			e.stopPropagation();
			const picked = normalizeHex(colorInput.value);
			dismiss();
			onPick(picked);
		});
	}

	// Clear / "no colour" swatch — reverts the consumer to its default appearance.
	const clearSwatch = palette.createEl('button', {
		cls: 'wl-reading-col-palette-swatch wl-color-clear-swatch',
	});
	clearSwatch.title = 'No color (reset to default)';
	clearSwatch.addEventListener('click', (e) => {
		e.stopPropagation();
		dismiss();
		onPick(null);
	});

	window.setTimeout(() => doc.addEventListener('mousedown', close, true), 0);
}

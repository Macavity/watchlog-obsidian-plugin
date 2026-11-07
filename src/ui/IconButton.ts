import { setIcon, setTooltip } from 'obsidian';

/**
 * `framed` adds a border (rating row refresh); `sm` is the 16px inline affordance next to
 * text (add / remove on a credits row). Anything else sizes itself with its own
 * `button.wl-x` rule (card menus, row actions).
 */
export type IconButtonVariant = 'framed' | 'sm';

export interface IconButtonOptions {
	/** Lucide icon name, e.g. `refresh-cw`. */
	icon: string;
	/** Already translated; becomes the accessible name and Obsidian's tooltip (`aria-label`, no `title`). */
	label: string;
	/** Extra context classes, space separated. */
	cls?: string;
	variant?: IconButtonVariant;
}

/**
 * The one way to build an icon-only button: `button.wl-icon-btn` (styles.css) with a Lucide icon.
 * Element-qualified CSS keeps core's `button:not(.clickable-icon)` from restyling it.
 */
export function createIconButton(parent: HTMLElement, opts: IconButtonOptions): HTMLButtonElement {
	const classes = ['wl-icon-btn'];
	if (opts.variant) classes.push(`wl-icon-btn-${opts.variant}`);
	if (opts.cls) classes.push(opts.cls);
	const btn = parent.createEl('button', {
		cls: classes.join(' '),
		attr: { type: 'button', 'aria-label': opts.label },
	});
	// Obsidian's own tooltip reads aria-label; a `title` on top would add a second, native one
	setTooltip(btn, opts.label);
	setIcon(btn, opts.icon);
	return btn;
}

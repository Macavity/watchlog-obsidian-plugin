import { setIcon } from 'obsidian';

/**
 * `framed` adds a border (rating row refresh); `lg` is the 28px card-menu size;
 * `sm` is the 16px inline affordance next to text (add / remove on a credits row).
 */
export type IconButtonVariant = 'framed' | 'lg' | 'sm';

export interface IconButtonOptions {
	/** Lucide icon name, e.g. `refresh-cw`. */
	icon: string;
	/** Already translated; becomes `aria-label` and `title`. */
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
		attr: { type: 'button', 'aria-label': opts.label, title: opts.label },
	});
	setIcon(btn, opts.icon);
	return btn;
}

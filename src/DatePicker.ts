/**
 * The shared date input: a text field rendered in the user's `dateFormat` plus a calendar popover.
 * Replaces both older patterns — hand-rolled `DD/MM/YYYY` text inputs (setting-aware, no calendar)
 * and native `<input type="date">` pickers (calendar, but locale-locked, since Chromium paints that
 * field from the OS locale).
 *
 * - Values in and out are always storage format (`YYYY-MM-DD`) or null; display format is handled
 *   here alone.
 * - No wrapper element is inserted: the input is created directly in the caller's parent with the
 *   caller's own classes, and the popover renders into `activeDocument.body` as a fixed-position
 *   layer — so the ~12 existing call sites' layouts and CSS stay valid.
 * - Invalid typed text never reaches `onChange`: the field is marked `wl-input-error` and the last
 *   committed value is kept, so a typo can no longer write a non-ISO string into the data.
 */

import { setIcon } from 'obsidian';
import {
	dateFormatHint,
	dateFormatMask,
	formatDateDisplay,
	getActiveDateFormat,
	parseDateInput,
	parseReleaseDateInput,
	todayIso,
} from './types';

export interface DatePickerConfig {
	/** Element the input is appended to. */
	parent: HTMLElement;
	/** Classes for the input, so each call site keeps its existing appearance. */
	inputCls?: string;
	/** Initial value in storage format (`YYYY-MM-DD`) or null. */
	value: string | null;
	/**
	 * Accept raw ISO in addition to the active format when typing. Set for release-date fields, which
	 * are also filled from APIs.
	 */
	lenient?: boolean;
	/** Called with storage format (or null when cleared). Never called for invalid text. */
	onChange: (iso: string | null) => void;
	/** Swallow clicks on the input/popover — expanded rows collapse otherwise. */
	stopClickPropagation?: boolean;
	/** Tooltip on the input when the value is valid. */
	title?: string;
}

export interface DatePickerHandle {
	inputEl: HTMLInputElement;
	getValue(): string | null;
	/** Sets the value and re-renders the text; fires `onChange` unless silent. */
	setValue(iso: string | null, silent?: boolean): void;
	/** Re-renders the text from the current value (after a format change). */
	refresh(): void;
	destroy(): void;
}

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

/** Only the American format starts its weeks on Sunday. */
function weekStartsMonday(): boolean {
	return getActiveDateFormat() !== 'american';
}

function isoOf(y: number, m: number, d: number): string {
	return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function createDatePicker(cfg: DatePickerConfig): DatePickerHandle {
	let value: string | null = cfg.value && /^\d{4}-\d{2}-\d{2}$/.test(cfg.value) ? cfg.value : null;
	// non-ISO leftovers (a legacy release date) are shown but not treated as a selectable value — the
	// calendar opens on today instead
	const passthrough = !value && cfg.value ? cfg.value : '';

	const input = cfg.parent.createEl('input', {
		cls: `wl-datepicker-input${cfg.inputCls ? ` ${cfg.inputCls}` : ''}`,
		attr: {
			type: 'text',
			placeholder: dateFormatMask(),
			maxlength: '10',
			// users still type here, so this is a hint, not a lock
			'aria-label': `Date (${dateFormatMask()})`,
		},
	});
	input.value = value ? formatDateDisplay(value) : passthrough;
	if (cfg.title) input.title = cfg.title;

	let panel: HTMLElement | null = null;
	let cleanup: (() => void) | null = null;
	// month the grid is showing, independent of the committed value
	let viewYear = 0;
	let viewMonth = 0;

	const parse = (raw: string): string | null =>
		cfg.lenient ? parseReleaseDateInput(raw) : parseDateInput(raw);

	const renderText = (): void => {
		input.value = value ? formatDateDisplay(value) : '';
	};

	const commit = (iso: string | null, silent = false): void => {
		value = iso;
		renderText();
		input.removeClass('wl-input-error');
		input.title = cfg.title ?? '';
		if (!silent) cfg.onChange(iso);
	};

	// Calendar popover

	const closePanel = (): void => {
		if (panel) { panel.remove(); panel = null; }
		if (cleanup) { cleanup(); cleanup = null; }
	};

	const position = (el: HTMLElement): void => {
		const rect = input.getBoundingClientRect();
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const height = el.offsetHeight || 300;
		const width = el.offsetWidth || 260;
		// flip above the field when there isn't room below
		const below = rect.bottom + 4;
		const top = below + height > vh - 8 && rect.top - 4 - height > 8
			? rect.top - 4 - height
			: below;
		const left = Math.max(8, Math.min(rect.left, vw - width - 8));
		el.setCssProps({ '--wl-dp-top': `${top}px`, '--wl-dp-left': `${left}px` });
	};

	const buildGrid = (body: HTMLElement): void => {
		body.empty();

		const head = body.createDiv({ cls: 'wl-datepicker-head' });
		const prev = head.createEl('button', {
			cls: 'wl-datepicker-nav',
			attr: { 'aria-label': 'Previous month' },
		});
		setIcon(prev, 'chevron-left');
		head.createSpan({
			cls: 'wl-datepicker-month',
			text: `${MONTH_NAMES[viewMonth]} ${viewYear}`,
		});
		const next = head.createEl('button', {
			cls: 'wl-datepicker-nav',
			attr: { 'aria-label': 'Next month' },
		});
		setIcon(next, 'chevron-right');

		prev.addEventListener('click', (ev) => {
			ev.stopPropagation();
			viewMonth -= 1;
			if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
			buildGrid(body);
		});
		next.addEventListener('click', (ev) => {
			ev.stopPropagation();
			viewMonth += 1;
			if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
			buildGrid(body);
		});

		const monday = weekStartsMonday();
		const names = monday ? WEEKDAYS_MON : WEEKDAYS_SUN;
		const dow = body.createDiv({ cls: 'wl-datepicker-dow' });
		for (const n of names) dow.createSpan({ text: n });

		const grid = body.createDiv({ cls: 'wl-datepicker-grid' });
		const first = new Date(viewYear, viewMonth, 1);
		// getDay() is 0=Sunday; shift by one when weeks start on Monday
		const lead = monday ? (first.getDay() + 6) % 7 : first.getDay();
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		for (let i = 0; i < lead; i++) grid.createSpan({ cls: 'wl-datepicker-pad' });

		const today = todayIso();
		for (let d = 1; d <= daysInMonth; d++) {
			const iso = isoOf(viewYear, viewMonth, d);
			const cell = grid.createEl('button', {
				cls: 'wl-datepicker-day',
				text: String(d),
			});
			if (iso === today) cell.addClass('is-today');
			if (iso === value) cell.addClass('is-selected');
			cell.addEventListener('click', (ev) => {
				ev.stopPropagation();
				// close first: onChange may trigger a re-render that replaces the input this panel is anchored to
				closePanel();
				commit(iso);
			});
		}

		const foot = body.createDiv({ cls: 'wl-datepicker-foot' });
		const todayBtn = foot.createEl('button', { cls: 'wl-btn wl-btn-sm', text: 'Today' });
		const clearBtn = foot.createEl('button', { cls: 'wl-btn wl-btn-sm', text: 'Clear' });
		todayBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			closePanel();
			commit(today);
		});
		clearBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			closePanel();
			commit(null);
		});
	};

	const openPanel = (): void => {
		if (panel) { closePanel(); return; }
		// open on the committed month, else on today
		const base = value ?? todayIso();
		viewYear = parseInt(base.slice(0, 4), 10);
		viewMonth = parseInt(base.slice(5, 7), 10) - 1;

		const el = activeDocument.body.createDiv({ cls: 'wl-datepicker-panel' });
		panel = el;
		if (cfg.stopClickPropagation) {
			el.addEventListener('click', (ev) => ev.stopPropagation());
		}
		buildGrid(el);
		position(el);

		const onDocClick = (ev: MouseEvent): void => {
			const t = ev.target as Node;
			if (el.contains(t) || t === input) return;
			closePanel();
		};
		const onKey = (ev: KeyboardEvent): void => {
			if (ev.key === 'Escape') { closePanel(); input.focus(); }
		};
		// also the teardown hook: if the field was removed (tab switch, modal close, virtual-grid recycle)
		// the floating panel would otherwise be orphaned in body
		const onReflow = (): void => {
			if (!panel) return;
			if (!input.isConnected) { closePanel(); return; }
			position(panel);
		};
		// capture phase: scroll events from the virtualised grids don't bubble
		window.setTimeout(() => activeDocument.addEventListener('click', onDocClick), 0);
		activeDocument.addEventListener('keydown', onKey);
		activeDocument.addEventListener('scroll', onReflow, true);
		window.addEventListener('resize', onReflow);
		cleanup = () => {
			activeDocument.removeEventListener('click', onDocClick);
			activeDocument.removeEventListener('keydown', onKey);
			activeDocument.removeEventListener('scroll', onReflow, true);
			window.removeEventListener('resize', onReflow);
		};
	};

	// Typed input

	input.addEventListener('click', (ev) => {
		if (cfg.stopClickPropagation) ev.stopPropagation();
		openPanel();
	});

	input.addEventListener('change', () => {
		const raw = input.value.trim();
		if (!raw) { commit(null); return; }
		const parsed = parse(raw);
		if (!parsed) {
			input.addClass('wl-input-error');
			input.title = dateFormatHint();
			return;
		}
		commit(parsed);
	});

	// Enter commits without waiting for blur
	input.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			closePanel();
			input.dispatchEvent(new Event('change'));
		}
	});

	return {
		inputEl: input,
		getValue: () => value,
		setValue: (iso, silent = false) => {
			commit(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null, silent);
		},
		refresh: () => {
			input.setAttr('placeholder', dateFormatMask());
			renderText();
		},
		destroy: closePanel,
	};
}

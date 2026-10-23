import { createDatePicker } from '../DatePicker';
import type { AirtimeSchedule, AirtimeRecurrence } from '../types';

export type ScheduleMode = 'single' | 'recurring';

/** Mutable form state; the form writes into it in place. */
export interface ScheduleFormState {
	mode: ScheduleMode;
	recurrence: string;
	releaseDate: string; // YYYY-MM-DD, '' = unset
	releaseTime: string; // HH:MM, '' = unset; only used when options.withTime
	dayOfWeek: number;
	dayOfMonth: number;
}

export interface ScheduleFormOptions {
	withTime: boolean;
	withRecurring: boolean;
	/** Label of the recurrence select row (e.g. "Airs"). */
	recurrenceLabel: string;
	recurrenceOptions: Array<{ value: string; label: string }>;
	/** Labels of the Single / Recurring toggle buttons. */
	modeLabels: [string, string];
	hint: (mode: ScheduleMode) => string;
	/** Text next to the time input (e.g. a JST conversion); only used with withTime. */
	timeNote?: (time: string) => string;
	/** Rendered in recurring mode between the recurrence fields and the hint. */
	renderCounters?: (parent: HTMLElement) => void;
	/** After every input; the modal updates its save state. */
	onChange: () => void;
	/** After the mode toggle changed state.mode; the modal re-renders. */
	onModeChange: () => void;
}

export interface CounterField {
	aria: string;
	value: number | null;
	onInput: (v: number | null) => void;
	min?: number;
}

export interface CounterGroup {
	label: string;
	current: CounterField;
	total: CounterField;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Single release needs a date; recurring is always saveable. */
function isScheduleValid(state: ScheduleFormState): boolean {
	return state.mode !== 'single' || state.releaseDate !== '';
}

function makeRow(parent: HTMLElement, label: string): HTMLElement {
	const row = parent.createDiv({ cls: 'wl-modal-row' });
	row.createSpan({ cls: 'wl-modal-label', text: label });
	return row;
}

function renderModeToggle(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const modeRow = parent.createDiv({ cls: 'wl-schedule-mode-row' });
	const makeModeBtn = (label: string, value: ScheduleMode): void => {
		const btn = modeRow.createEl('button', {
			cls: `wl-btn wl-btn-sm wl-schedule-mode-btn${state.mode === value ? ' is-active' : ''}`,
			text: label,
		});
		btn.addEventListener('click', () => {
			if (state.mode === value) return;
			state.mode = value;
			options.onModeChange();
		});
	};
	makeModeBtn(options.modeLabels[0], 'single');
	makeModeBtn(options.modeLabels[1], 'recurring');
}

function renderDateRow(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const dateRow = makeRow(parent, 'Release date');
	createDatePicker({
		parent: dateRow,
		inputCls: 'wl-modal-input wl-date-input',
		value: state.releaseDate || null,
		lenient: true,
		onChange: (iso) => {
			// the picker only ever commits YYYY-MM-DD or null — no silent-failure path
			state.releaseDate = iso ?? '';
			options.onChange();
		},
	});
}

/** Native time input + optional note label (e.g. live JST converter). */
function renderTimeRow(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const row = parent.createDiv({ cls: 'wl-modal-row wl-modal-row-mt' });
	row.createSpan({ cls: 'wl-modal-label', text: 'Time (optional)' });
	const inp = row.createEl('input', {
		cls: 'wl-modal-input wl-time-input',
		attr: { type: 'time' },
	});
	inp.value = state.releaseTime;
	const note = options.timeNote ? row.createSpan({ cls: 'wl-jst-clock' }) : null;
	const updateNote = (): void => {
		if (note && options.timeNote) note.textContent = options.timeNote(state.releaseTime);
	};
	updateNote();
	inp.addEventListener('input', () => {
		state.releaseTime = inp.value;
		updateNote();
		options.onChange();
	});
}

function renderWeekdayRow(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const r = makeRow(parent, 'Day of week');
	const daySelect = r.createEl('select', { cls: 'wl-select' });
	DAYS.forEach((d, i) => {
		const opt = daySelect.createEl('option', { text: d, value: String(i) });
		if (i === state.dayOfWeek) opt.selected = true;
	});
	daySelect.addEventListener('change', () => {
		state.dayOfWeek = parseInt(daySelect.value, 10);
		options.onChange();
	});
}

function renderMonthdayRow(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const r = makeRow(parent, 'Day of month');
	const inp = r.createEl('input', {
		cls: 'wl-modal-input wl-modal-input-sm',
		attr: { type: 'number', min: '1', max: '31', placeholder: '1' },
	});
	inp.value = String(state.dayOfMonth);
	inp.addEventListener('input', () => {
		const v = parseInt(inp.value, 10);
		state.dayOfMonth = isNaN(v) ? 1 : Math.min(31, Math.max(1, v));
		options.onChange();
	});
}

/** Cadence select + its one extra field (+ time). */
function renderRecurringFields(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	const recRow = makeRow(parent, options.recurrenceLabel);
	const recSelect = recRow.createEl('select', { cls: 'wl-select' });
	for (const { value, label } of options.recurrenceOptions) {
		const opt = recSelect.createEl('option', { text: label, value });
		if (value === state.recurrence) opt.selected = true;
	}

	const extraEl = parent.createDiv();
	const renderExtra = (): void => {
		extraEl.empty();
		if (state.recurrence === 'weekly') renderWeekdayRow(extraEl, state, options);
		if (state.recurrence === 'monthly') renderMonthdayRow(extraEl, state, options);
		if (options.withTime) renderTimeRow(extraEl, state, options);
	};
	recSelect.addEventListener('change', () => {
		state.recurrence = recSelect.value;
		renderExtra();
		options.onChange();
	});
	renderExtra();
}

function renderSingleFields(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	renderDateRow(parent, state, options);
	if (options.withTime) renderTimeRow(parent, state, options);
}

function renderModeFields(parent: HTMLElement, state: ScheduleFormState, options: ScheduleFormOptions): void {
	if (state.mode === 'single') {
		renderSingleFields(parent, state, options);
		return;
	}
	renderRecurringFields(parent, state, options);
	options.renderCounters?.(parent);
}

/** Renders mode toggle, date / recurrence fields, counters (via options) and the hint into parent. */
function renderScheduleForm(
	parent: HTMLElement,
	state: ScheduleFormState,
	options: ScheduleFormOptions,
): void {
	if (options.withRecurring) renderModeToggle(parent, state, options);
	renderModeFields(parent, state, options);

	// the save side-effects, stated instead of silent
	parent.createDiv({
		cls: 'wl-modal-info wl-schedule-hint',
		text: options.hint(state.mode),
	});
}

/** One compact row: Label [cur] of [total] · Label [cur] of [total] */
export function renderCounterRow(parent: HTMLElement, groups: CounterGroup[]): void {
	const progRow = parent.createDiv({ cls: 'wl-modal-row wl-schedule-progress-row' });
	const makeNum = (field: CounterField): void => {
		const inp = progRow.createEl('input', {
			cls: 'wl-modal-input wl-schedule-num',
			attr: { type: 'number', min: String(field.min ?? 0), placeholder: '—', 'aria-label': field.aria },
		});
		if (field.value !== null) inp.value = String(field.value);
		inp.addEventListener('input', () => field.onInput(parseInt(inp.value, 10) || null));
	};
	groups.forEach((group, i) => {
		if (i > 0) progRow.createSpan({ cls: 'wl-schedule-progress-sep wl-schedule-progress-dot', text: '·' });
		progRow.createSpan({ cls: 'wl-modal-label', text: group.label });
		makeNum(group.current);
		progRow.createSpan({ cls: 'wl-schedule-progress-sep', text: 'of' });
		makeNum(group.total);
	});
}

interface SaveRowOptions {
	isValid: () => boolean;
	onCancel: () => void;
	/** Runs when Save is clicked on a valid form; the modal saves and closes. */
	onSave: () => Promise<void>;
}

/**
 * Cancel / Save button row. Returns a refresh function that syncs the Save button's disabled state
 * with isValid (already applied once).
 */
function renderSaveRow(parent: HTMLElement, options: SaveRowOptions): () => void {
	const btnRow = parent.createDiv({ cls: 'wl-modal-btn-row' });
	const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-mr', text: 'Cancel' });
	cancelBtn.addEventListener('click', options.onCancel);

	const saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' });
	saveBtn.addEventListener('click', () => {
		if (!options.isValid()) return;
		void options.onSave();
	});
	const refresh = (): void => {
		saveBtn.disabled = !options.isValid();
	};
	refresh();
	return refresh;
}

function timePart(state: ScheduleFormState, withTime: boolean): Partial<AirtimeSchedule> {
	return withTime && state.releaseTime ? { releaseTime: state.releaseTime } : {};
}

function recurringPart(state: ScheduleFormState): Partial<AirtimeSchedule> {
	if (state.recurrence === 'weekly') return { dayOfWeek: state.dayOfWeek };
	if (state.recurrence === 'monthly') return { dayOfMonth: state.dayOfMonth };
	return {};
}

/** The schedule handed to onSave: built fresh from the fields the active mode shows. */
export function buildScheduleFromState(state: ScheduleFormState, withTime: boolean): AirtimeSchedule {
	if (state.mode === 'single') {
		return { recurrence: 'once', releaseDate: state.releaseDate, ...timePart(state, withTime) };
	}
	return {
		recurrence: state.recurrence as Exclude<AirtimeRecurrence, 'once'>,
		...recurringPart(state),
		...timePart(state, withTime),
	};
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string | null | undefined): string {
	return value && ISO_DATE.test(value) ? value : '';
}

/** Weekly default: titles usually keep their premiere weekday, so derive it from the release date before falling back to Saturday. */
function defaultWeekday(releaseDate: string): number {
	return releaseDate ? new Date(releaseDate + 'T00:00:00').getDay() : 6;
}

function initialRecurrence(s: AirtimeSchedule | null): string {
	return s && s.recurrence !== 'once' ? s.recurrence : 'weekly';
}

function initialDayOfWeek(s: AirtimeSchedule | null, releaseDate: string): number {
	return s?.dayOfWeek ?? defaultWeekday(releaseDate);
}

function initialReleaseTime(s: AirtimeSchedule | null): string {
	return s?.releaseTime ?? '';
}

function initialDayOfMonth(s: AirtimeSchedule | null): number {
	return s?.dayOfMonth ?? 1;
}

/** Form state for an existing schedule (or none), falling back to the item's own release date. */
export function initialScheduleState(
	s: AirtimeSchedule | null,
	itemReleaseDate: string | null | undefined,
	mode: ScheduleMode,
): ScheduleFormState {
	const releaseDate = s?.releaseDate ?? validIsoDate(itemReleaseDate);
	return {
		mode,
		recurrence: initialRecurrence(s),
		releaseDate,
		releaseTime: initialReleaseTime(s),
		dayOfWeek: initialDayOfWeek(s, releaseDate),
		dayOfMonth: initialDayOfMonth(s),
	};
}

/**
 * An explicit mode wins (the tick confirm's "Switch to Recurring"); otherwise an existing schedule
 * decides — auto-imported entries arrive as 'once'. Without one, the modal's default applies.
 */
export function resolveScheduleMode(
	s: AirtimeSchedule | null,
	explicit: ScheduleMode | undefined,
	fallback: ScheduleMode,
): ScheduleMode {
	return explicit ?? (s ? (s.recurrence === 'once' ? 'single' : 'recurring') : fallback);
}

/** Cadence choices shared by every recurring schedule modal. */
export const RECURRENCE_OPTIONS = [
	{ value: 'daily', label: 'Daily' },
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'monthly', label: 'Monthly' },
];

export function counterField(
	aria: string,
	value: number | null,
	onInput: (v: number | null) => void,
	min = 0,
): CounterField {
	return { aria, value, onInput, min };
}

export interface ScheduleModalOptions extends Omit<ScheduleFormOptions, 'onChange' | 'onModeChange'> {
	/** The hosting modal; closed on Cancel and after a successful save. */
	modal: { close: () => void };
	/** Runs when Save is clicked on a valid form; the modal is closed afterwards. */
	onSave: () => Promise<void>;
}

/**
 * The whole modal body: schedule form plus Cancel / Save row, with Save enabled only while valid.
 * Clears parent first and re-renders itself when the mode toggle changes.
 */
export function renderScheduleModal(
	parent: HTMLElement,
	state: ScheduleFormState,
	options: ScheduleModalOptions,
): void {
	parent.empty();
	let refresh = (): void => undefined;
	renderScheduleForm(parent, state, {
		...options,
		onChange: () => refresh(),
		onModeChange: () => renderScheduleModal(parent, state, options),
	});
	refresh = renderSaveRow(parent, {
		isValid: () => isScheduleValid(state),
		onCancel: () => options.modal.close(),
		onSave: async () => {
			await options.onSave();
			options.modal.close();
		},
	});
}

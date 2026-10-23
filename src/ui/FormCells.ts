import { createDatePicker } from '../DatePicker';

/** A labelled form row: [label][fields...]. */
export function makeRow(parent: HTMLElement, label: string): HTMLElement {
	const row = parent.createDiv({ cls: 'wl-modal-row' });
	row.createSpan({ cls: 'wl-modal-label', text: label });
	return row;
}

/**
 * A paired-row cell: [label][fixed-width input]. The left cell keeps the standard label width so its
 * input aligns with the full-width fields; the right cell anchors to the row's right edge.
 */
export function makeCell(row: HTMLElement, label: string, right = false): HTMLElement {
	const cell = row.createDiv({
		cls: right ? 'wl-modal-pair-cell wl-modal-pair-cell-right' : 'wl-modal-pair-cell',
	});
	cell.createSpan({ cls: 'wl-modal-label', text: label });
	return cell;
}

export interface NumberInputOptions {
	value: number;
	min?: number;
	placeholder?: string;
	cls?: string;
	onInput: (v: number) => void;
}

/** Integer input; unparsable text reads as 0. */
export function numberInput(cell: HTMLElement, opts: NumberInputOptions): HTMLInputElement {
	const attr: Record<string, string> = { type: 'number' };
	if (opts.min !== undefined) attr['min'] = String(opts.min);
	if (opts.placeholder !== undefined) attr['placeholder'] = opts.placeholder;
	const input = cell.createEl('input', { cls: opts.cls ?? 'wl-modal-input', attr });
	input.value = String(opts.value);
	input.addEventListener('input', () => opts.onInput(parseInt(input.value, 10) || 0));
	return input;
}

export interface TextInputOptions {
	value: string;
	type?: 'text' | 'url';
	placeholder?: string | undefined;
	onInput: (v: string) => void;
}

export function textInput(cell: HTMLElement, opts: TextInputOptions): HTMLInputElement {
	const attr: Record<string, string> = { type: opts.type ?? 'text' };
	if (opts.placeholder !== undefined) attr['placeholder'] = opts.placeholder;
	const input = cell.createEl('input', { cls: 'wl-modal-input', attr });
	input.value = opts.value;
	input.addEventListener('input', () => opts.onInput(input.value));
	return input;
}

/** Select over plain names; `empty` prepends a "none" option with value ''. */
export function nameSelect(
	parent: HTMLElement,
	names: string[],
	selected: string,
	onChange: (v: string) => void,
	empty = false,
): HTMLSelectElement {
	const select = parent.createEl('select', { cls: 'wl-select' });
	if (empty) select.createEl('option', { text: '— none —', value: '' });
	for (const name of names) {
		const opt = select.createEl('option', { text: name, value: name });
		if (name === selected) opt.selected = true;
	}
	select.addEventListener('change', () => onChange(select.value));
	return select;
}

/** Mutable group choice; the picker writes into it in place. */
export interface GroupPickerState {
	selectedGroupId: string;
	newGroupName: string;
}

function renderGroupSelect(
	row: HTMLElement,
	groups: Array<{ id: string; name: string }>,
	selectedId: string,
): HTMLSelectElement {
	const select = row.createEl('select', { cls: 'wl-select' });
	select.createEl('option', { text: '— none —', value: '' });
	for (const g of groups) {
		const opt = select.createEl('option', { text: g.name, value: g.id });
		if (g.id === selectedId) opt.selected = true;
	}
	return select;
}

/**
 * "Add to group" dropdown plus "Or create new group" input. The two are mutually exclusive: filling
 * one clears and disables the other.
 */
export function renderGroupPicker(
	parent: HTMLElement,
	groups: Array<{ id: string; name: string }>,
	state: GroupPickerState,
): void {
	const groupSelect = renderGroupSelect(makeRow(parent, 'Add to group'), groups, state.selectedGroupId);
	const newGroupInput = textInput(makeRow(parent, 'Or create new group'), {
		value: state.newGroupName,
		placeholder: 'New group name...',
		onInput: (v) => {
			state.newGroupName = v;
			const filled = v.trim() !== '';
			if (filled) {
				state.selectedGroupId = '';
				groupSelect.value = '';
			}
			groupSelect.disabled = filled;
		},
	});

	groupSelect.addEventListener('change', () => {
		state.selectedGroupId = groupSelect.value;
		const chosen = state.selectedGroupId !== '';
		if (chosen) {
			state.newGroupName = '';
			newGroupInput.value = '';
		}
		newGroupInput.disabled = chosen;
	});

	newGroupInput.disabled = state.selectedGroupId !== '';
	groupSelect.disabled = state.newGroupName.trim() !== '';
}

/** "Title" row with a text input. */
export function titleField(
	form: HTMLElement,
	value: string,
	placeholder: string | undefined,
	onInput: (v: string) => void,
): void {
	textInput(makeRow(form, 'Title'), { value, placeholder, onInput });
}

/** "External link" row with a URL input. */
export function linkField(
	form: HTMLElement,
	value: string,
	placeholder: string,
	onInput: (v: string) => void,
): void {
	textInput(makeRow(form, 'External link'), { value, type: 'url', placeholder, onInput });
}

/**
 * "Release date" row. Lenient parsing: the picker refuses to commit unparsable text, so the field
 * can't store a raw non-ISO string. onChange gets '' when cleared.
 */
export function releaseDateField(form: HTMLElement, value: string, onChange: (iso: string) => void): void {
	createDatePicker({
		parent: makeRow(form, 'Release date').createDiv({ cls: 'wl-modal-input-stack' }),
		inputCls: 'wl-modal-input',
		value: value || null,
		lenient: true,
		onChange: (iso) => onChange(iso ?? ''),
	});
}

/** The core record fields of the add-title forms; renderMediaFields writes into it in place. */
export interface MediaFields {
	title: string;
	episodes: number;
	duration: number;
	releaseDate: string;
	link: string;
}

/**
 * Title, episodes, ep. duration, release date and link rows. paired puts episodes and duration
 * 50/50 on one row; otherwise they get a row each with a narrow input.
 */
export function renderMediaFields(form: HTMLElement, f: MediaFields, paired: boolean): void {
	titleField(form, f.title, 'Title name', (v) => { f.title = v; });

	const episodes = { value: f.episodes, min: 0, placeholder: '0', onInput: (v: number) => { f.episodes = v; } };
	const duration = { value: f.duration, min: 0, placeholder: '24', onInput: (v: number) => { f.duration = v; } };
	if (paired) {
		// reclaims vertical space
		const row = form.createDiv({ cls: 'wl-modal-row wl-modal-row-pair' });
		numberInput(makeCell(row, 'Episodes'), episodes);
		numberInput(makeCell(row, 'Ep. duration (min)', true), duration);
	} else {
		const cls = 'wl-modal-input wl-modal-input-sm';
		numberInput(makeRow(form, 'Episodes'), { ...episodes, cls });
		numberInput(makeRow(form, 'Ep. duration (min)'), { ...duration, cls });
	}

	releaseDateField(form, f.releaseDate, (v) => { f.releaseDate = v; });
	linkField(form, f.link, 'https://example.com', (v) => { f.link = v; });
}

/** Empties the form host and returns it; null before it is mounted. */
export function resetForm(host: HTMLElement | null): HTMLElement | null {
	host?.empty();
	return host;
}

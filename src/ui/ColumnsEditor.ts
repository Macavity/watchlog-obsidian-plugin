import { App, Notice } from 'obsidian';
import type { CustomListColumn, CustomListRow } from '../types';
import { DEFAULT_FIELD_COLOR } from '../types';
import { ConfirmModal } from '../ConfirmModal';
import { openColorPicker, deriveFillColor, deriveBorderColor } from '../ColorPicker';

/**
 * Aligns a column's option-colour map with its trimmed options on save: drops colours for
 * removed options, clears the map for non-select columns.
 */
function normalizeOptionColors(col: CustomListColumn): void {
	if (col.type !== 'select') { delete col.optionColors; return; }
	if (!col.optionColors) return;
	const opts = new Set(col.options ?? []);
	const cleaned: Record<string, string> = {};
	for (const [k, v] of Object.entries(col.optionColors)) {
		const tk = k.trim();
		if (opts.has(tk)) cleaned[tk] = v;
	}
	if (Object.keys(cleaned).length) col.optionColors = cleaned;
	else delete col.optionColors;
}

/** Shared drag state of one card list: index of the card being dragged, -1 when none. */
export interface DragState { from: number }

/** Adds the drag handle and the drag-and-drop listeners to a column card. */
export function attachCardDrag(
	card: HTMLElement,
	idx: number,
	drag: DragState,
	onReorder: (from: number, to: number) => void,
): void {
	const handle = card.createDiv({ cls: 'wl-editcol-card-handle', text: '⠿' });
	handle.title = 'Drag to reorder';
	handle.addEventListener('mousedown', () => card.setAttribute('draggable', 'true'));
	card.addEventListener('dragstart', (e) => {
		drag.from = idx;
		e.dataTransfer?.setData('text/plain', String(idx));
		card.addClass('wl-cl-dragging');
	});
	card.addEventListener('dragend', () => {
		card.removeClass('wl-cl-dragging');
		card.setAttribute('draggable', 'false');
	});
	card.addEventListener('dragover', (e) => { e.preventDefault(); card.addClass('wl-cl-drag-over'); });
	card.addEventListener('dragleave', () => card.removeClass('wl-cl-drag-over'));
	card.addEventListener('drop', (e) => {
		e.preventDefault();
		card.removeClass('wl-cl-drag-over');
		const from = drag.from;
		drag.from = -1;
		if (from !== idx && from >= 0) onReorder(from, idx);
	});
}

/** Text / number / select dropdown of a column card. */
export function renderTypeSelect(card: HTMLElement, current: CustomListColumn['type']): HTMLSelectElement {
	const typeSelect = card.createEl('select', { cls: 'wl-select wl-editcol-card-type' });
	for (const t of ['text', 'number', 'select'] as const) {
		const opt = typeSelect.createEl('option', {
			value: t,
			text: t.charAt(0).toUpperCase() + t.slice(1),
		});
		if (current === t) opt.selected = true;
	}
	return typeSelect;
}

/** Deep copy of columns (options and option colours are not shared with the source). */
export function cloneColumns(cols: CustomListColumn[]): CustomListColumn[] {
	return cols.map(c => ({
		...c,
		options: c.options ? [...c.options] : undefined,
		optionColors: c.optionColors ? { ...c.optionColors } : undefined,
	}));
}

/** Moves the column at `from` to the drop slot `to` (slot index before removal). */
export function moveColumn(cols: CustomListColumn[], from: number, to: number): void {
	const [moved] = cols.splice(from, 1);
	if (moved) cols.splice(from < to ? to - 1 : to, 0, moved);
}

/** First validation problem of a column set, or null when it can be saved. */
export function validateColumns(cols: CustomListColumn[]): string | null {
	for (const col of cols) {
		if (!col.label.trim()) return 'Column names cannot be empty.';
		if (col.type === 'select' && (!col.options || col.options.length === 0)) {
			return `Column "${col.label}" must have at least one option.`;
		}
	}
	return null;
}

/** Trims labels and options and aligns option colours; mutates the columns. */
export function normalizeColumns(cols: CustomListColumn[]): void {
	for (const col of cols) {
		col.label = col.label.trim();
		if (col.options) col.options = col.options.map(o => o.trim()).filter(o => o);
		normalizeOptionColors(col);
	}
}

export interface ColumnsEditorOptions {
	app: App;
	/** Existing rows: used to derive select options and to warn before deleting a column with data. */
	rows: CustomListRow[];
	/** Renders content above the column list. */
	renderHeader: (parent: HTMLElement) => void;
	/** Id for a freshly added column, given the current editable columns. */
	newColumnId: (cols: CustomListColumn[]) => string;
	onOptionRename?: (colId: string, oldVal: string, newVal: string) => void;
	/** Called with the validated, normalized columns. */
	onSave: (cols: CustomListColumn[]) => void;
	onCancel: () => void;
}

/** Renders the column editor (header, card list, Cancel/Save footer) into `host`. */
export function renderColumnsEditor(
	host: HTMLElement,
	state: { cols: CustomListColumn[] },
	opts: ColumnsEditorOptions,
): void {
	host.empty();
	host.addClass('wl-editcols-modal');
	opts.renderHeader(host);

	const listEl = host.createDiv({ cls: 'wl-editcols-list' });
	const rerenderAll = (): void => renderColumnsEditor(host, state, opts);
	const renderCols = (): void => {
		renderColumnList(
			listEl,
			state.cols,
			opts.rows,
			opts.app,
			(from, to) => { moveColumn(state.cols, from, to); renderCols(); },
			(idx) => { state.cols.splice(idx, 1); rerenderAll(); },
			rerenderAll,
			() => {
				state.cols.push({
					id: opts.newColumnId(state.cols),
					label: '',
					type: 'text',
					bold: false,
					italic: false,
				});
				rerenderAll();
			},
			opts.onOptionRename,
		);
	};
	renderCols();

	renderCancelSave(host.createDiv({ cls: 'wl-modal-btn-row wl-editcols-footer' }), {
		onCancel: opts.onCancel,
		onSave: () => {
			const problem = validateColumns(state.cols);
			if (problem) { new Notice(problem); return; }
			normalizeColumns(state.cols);
			opts.onSave(state.cols);
		},
	});
}

/** Cancel / Save button pair shared by the modals' footers. */
export function renderCancelSave(
	row: HTMLElement,
	handlers: { onCancel: () => void; onSave: () => void },
): void {
	row.createEl('button', { cls: 'wl-btn', text: 'Cancel' }).addEventListener('click', () => handlers.onCancel());
	row.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' }).addEventListener('click', () => handlers.onSave());
}

// Shared column list renderer (used by renderColumnsEditor)

function renderColumnList(
	listEl: HTMLElement,
	cols: CustomListColumn[],
	existingRows: CustomListRow[],
	app: App,
	onReorder: (from: number, to: number) => void,
	onDelete: (idx: number) => void,
	onTypeChange: () => void,
	onAdd?: () => void,
	onOptionRename?: (colId: string, oldVal: string, newVal: string) => void,
): void {
	listEl.empty();
	listEl.addClass('wl-editcol-card-grid');
	const drag: DragState = { from: -1 };

	// permanent auto-included columns — non-editable, non-deletable, non-draggable
	const renderAutoCard = (label: string): void => {
		const card = listEl.createDiv({ cls: 'wl-editcol-card wl-editcol-card-auto' });
		card.setAttribute('data-auto', label);
		const nameWrap = card.createDiv({ cls: 'wl-editcol-card-name-wrap' });
		nameWrap.createDiv({ cls: 'wl-editcol-card-name-label', text: label });
		card.createDiv({ cls: 'wl-editcol-card-type-locked', text: 'Auto' });
		card.createDiv({ cls: 'wl-editcol-card-spacer' });
	};
	renderAutoCard('#');
	renderAutoCard('Name');

	cols.forEach((col, idx) => {
		const card = listEl.createDiv({ cls: 'wl-editcol-card' });

		attachCardDrag(card, idx, drag, onReorder);

		const nameInput = card.createEl('input', {
			cls: 'wl-modal-input wl-editcol-card-name',
			attr: { type: 'text', placeholder: 'Column name', value: col.label },
		});
		nameInput.addEventListener('input', () => { col.label = nameInput.value; });

		const typeSelect = renderTypeSelect(card, col.type);
		typeSelect.addEventListener('change', () => {
			const newType = typeSelect.value as CustomListColumn['type'];
			if (newType === 'select') {
				// rebuild the option list from the distinct non-empty values already in this column's cells, in
				// order of first appearance. Replaces any stored options (so stale ones don't resurrect) and
				// leaves the cell values untouched.
				const seen = new Set<string>();
				const derived: string[] = [];
				for (const row of existingRows) {
					const raw = (row as Record<string, unknown>)[col.id];
					if (typeof raw !== 'string' && typeof raw !== 'number') continue;
					const val = String(raw).trim();
					if (!val || seen.has(val)) continue;
					seen.add(val);
					derived.push(val);
				}
				col.options = derived;
			}
			col.type = newType;
			onTypeChange();
		});

		if (col.type === 'text' || col.type === 'number') {
			const toggles = card.createDiv({ cls: 'wl-editcol-card-toggles' });
			const boldBtn = toggles.createEl('button', {
				cls: `wl-btn wl-btn-sm wl-editcol-card-toggle wl-editcols-bold-btn${col.bold ? ' is-active' : ''}`,
				text: 'B',
			});
			boldBtn.addEventListener('click', () => {
				col.bold = !col.bold;
				boldBtn.toggleClass('is-active', !!col.bold);
			});
			const italicBtn = toggles.createEl('button', {
				cls: `wl-btn wl-btn-sm wl-editcol-card-toggle wl-editcols-italic-btn${col.italic ? ' is-active' : ''}`,
				text: 'I',
			});
			italicBtn.addEventListener('click', () => {
				col.italic = !col.italic;
				italicBtn.toggleClass('is-active', !!col.italic);
			});

			if (col.type === 'number') {
				const autoTimeBtn = toggles.createEl('button', {
					cls: `wl-btn wl-btn-sm wl-editcol-card-toggle wl-editcols-autotime-btn${col.autoTime ? ' is-active' : ''}`,
					text: '⏱',
					attr: { title: 'Auto-populate with remaining watch time from Watchlist' },
				});
				autoTimeBtn.addEventListener('click', () => {
					col.autoTime = !col.autoTime;
					autoTimeBtn.toggleClass('is-active', !!col.autoTime);
				});
			}
		}

		const delBtn = card.createEl('button', {
			cls: 'wl-btn wl-btn-sm wl-editcol-card-del',
			text: '×',
		});
		delBtn.title = 'Delete this column';
		delBtn.addEventListener('click', () => {
			const hasData = existingRows.some(r => {
				const val = (r as Record<string, unknown>)[col.id];
				return val !== undefined && val !== '' && val !== null;
			});
			if (hasData) {
				new ConfirmModal(app, `Delete column "${col.label}"? This will remove all data in this column.`, () => {
					onDelete(idx);
				}).open();
			} else {
				onDelete(idx);
			}
		});

		if (col.type === 'select') {
			const optsArea = card.createDiv({ cls: 'wl-editcol-card-opts' });
			const renderOpts = (): void => {
				optsArea.empty();
				(col.options ?? []).forEach((opt, oi) => {
					const optRow = optsArea.createDiv({ cls: 'wl-editcol-card-opt-row' });

					// per-option colour dot — reuses the shared picker + derivation helpers
					const colorDot = optRow.createEl('button', {
						cls: 'wl-reading-col-color-dot wl-editcol-opt-color-dot',
					});
					colorDot.title = 'Option color';
					const syncDot = (): void => {
						const c = col.optionColors?.[col.options?.[oi] ?? ''];
						if (c) {
							colorDot.removeClass('is-unset');
							// colours flow through CSS vars; .is-unset gates whether they apply
							colorDot.setCssProps({ '--wl-dot-fill': deriveFillColor(c), '--wl-dot-border': deriveBorderColor(c) });
						} else {
							colorDot.addClass('is-unset');
						}
					};
					syncDot();
					colorDot.addEventListener('click', (e) => {
						e.stopPropagation();
						const key = col.options?.[oi] ?? '';
						if (!key) return; // can't colour a blank option
						openColorPicker({
							anchor: colorDot,
							container: listEl,
							current: col.optionColors?.[key] ?? DEFAULT_FIELD_COLOR,
							allowCustom: true,
							onPick: (color) => {
								if (color === null) {
									if (col.optionColors) delete col.optionColors[key];
								} else {
									if (!col.optionColors) col.optionColors = {};
									col.optionColors[key] = color;
								}
								syncDot();
							},
						});
					});

					const optInput = optRow.createEl('input', {
						cls: 'wl-modal-input wl-editcol-card-opt-input',
						attr: { type: 'text', value: opt, placeholder: 'Option' },
					});
					let prevVal = opt;
					optInput.addEventListener('input', () => {
						if (!col.options) col.options = [];
						const nextVal = optInput.value;
						if (nextVal !== prevVal) {
							// keep any assigned colour attached to the renamed value
							if (col.optionColors) {
								const moved = col.optionColors[prevVal];
								if (moved !== undefined) {
									if (nextVal) col.optionColors[nextVal] = moved;
									delete col.optionColors[prevVal];
								}
							}
							// record the rename so row cells can be migrated at save time
							onOptionRename?.(col.id, prevVal, nextVal);
						}
						col.options[oi] = nextVal;
						prevVal = nextVal;
					});
					const delOpt = optRow.createEl('button', {
						cls: 'wl-btn wl-btn-sm wl-editcol-card-opt-del',
						text: '×',
						attr: { title: 'Remove this option' },
					});
					delOpt.addEventListener('click', () => {
						const key = col.options?.[oi];
						col.options?.splice(oi, 1);
						if (key && col.optionColors) delete col.optionColors[key];
						renderOpts();
					});
				});
				const addOpt = optsArea.createEl('button', {
					cls: 'wl-btn wl-btn-sm wl-editcol-card-opt-add',
					text: '+ option',
				});
				addOpt.addEventListener('click', () => {
					if (!col.options) col.options = [];
					col.options.push('');
					renderOpts();
				});
			};
			renderOpts();
		}
	});

	if (onAdd) {
		const addCard = listEl.createDiv({ cls: 'wl-editcol-card wl-editcol-card-add' });
		addCard.createDiv({ cls: 'wl-editcol-card-add-label', text: '+ add column' });
		addCard.addEventListener('click', () => onAdd());
	}
}

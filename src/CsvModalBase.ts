import { App, Modal, Notice } from 'obsidian';
import { escapeCsvField, parseCSV, parseCsvDate } from './csv/csvCore';
import { t, type TranslationKey } from './i18n';
import type WatchLogPlugin from './main';

/** Fields every importable entry carries; the modals narrow `status` to their own set. */
export interface CsvEntryBase {
	title?: string;
	status?: string;
	rating?: number;
}

export type CsvCoercion = 'string' | 'int' | 'rating' | 'date' | 'none';

export interface CsvFieldDef {
	key: string;
	labelKey: TranslationKey;
	coercion: CsvCoercion;
	autoDetect: string[];
}

export interface CsvImportRow<E> {
	entry: E;
	isDuplicate: boolean;
	selected: boolean;
}

export interface CsvExportRow {
	id: string;
	title: string;
	meta: string;
}

interface CsvUnknowns {
	statuses: string[];
	types: string[];
	ratings: string[];
}

export interface CsvSelectOption {
	value: string;
	label: string;
}

const COERCE: Record<CsvCoercion, (raw: string) => unknown> = {
	string: (raw) => raw,
	int: (raw) => parseInt(raw, 10) || 0,
	rating: (raw) => Math.max(0, Math.min(5, parseFloat(raw) || 0)),
	date: (raw) => parseCsvDate(raw) || undefined,
	none: () => undefined,
};

const CHUNK_SIZE = 10;

/** One CSV cell per column, escaped and comma-joined, with a header line. */
export function rowsToCsv<T>(columns: readonly string[], items: T[], cell: (item: T, col: string) => unknown): string {
	const rows = items.map((it) =>
		columns.map((col) => escapeCsvField(cell(it, col) as string | number | null | undefined)).join(','),
	);
	return [columns.join(','), ...rows].join('\n');
}

function downloadCsv(csv: string, prefix: string): void {
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = createEl('a');
	const today = new Date();
	const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	a.href = url;
	a.download = `${prefix}-export-${dateStr}.csv`;
	a.click();
	URL.revokeObjectURL(url);
}

function autoMapFields(fields: readonly CsvFieldDef[], headers: string[]): Record<string, string> {
	const mapping: Record<string, string> = {};
	for (const field of fields) {
		const match = headers.find((h) => field.autoDetect.includes(h.toLowerCase()));
		mapping[field.key] = match ?? '';
	}
	return mapping;
}

/** Value of each raw key's select ('' when missing). */
function selectedValues(raws: string[], selects: Record<string, HTMLSelectElement>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const raw of raws) result[raw] = selects[raw]?.value ?? '';
	return result;
}

/** One `"raw" → select` row, the select being filled by the caller. */
function createValueMapRow(el: HTMLElement, raw: string): HTMLSelectElement {
	const row = el.createDiv({ cls: 'wl-csv-valmap-row' });
	row.createSpan({ cls: 'wl-csv-valmap-orig', text: `"${raw}"` });
	row.createSpan({ cls: 'wl-csv-valmap-arrow', text: '→' });
	return row.createEl('select', { cls: 'wl-select wl-csv-valmap-select' });
}

/**
 * Shared export / import wizard of the watchlist and reading CSV modals: file pick, column
 * mapping, value mapping, preview, chunked import with progress. Subclasses supply the entity
 * schema (fields, rows, labels, notices) and the actual persistence.
 */
export abstract class CsvModalBase<E extends CsvEntryBase> extends Modal {
	private selectedIds = new Set<string>();

	private csvRows: string[][] = [];
	private csvHeaders: string[] = [];
	private columnMapping: Record<string, string> = {};
	protected importRows: CsvImportRow<E>[] = [];

	private statusValueMap: Record<string, string> = {};  // csvValue → resolved status ('' = leave blank)
	protected typeValueMap: Record<string, string> = {};  // csvValue → resolved type; unused by reading
	private ratingValueMap: Record<string, string> = {};  // csvValue → '1'–'5' or '' (leave blank)

	private stepUpload: HTMLElement | null = null;
	private stepMapping: HTMLElement | null = null;
	private stepValueMap: HTMLElement | null = null;
	private stepPreview: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;
	protected cancelBtn: HTMLButtonElement | null = null;

	protected isImporting = false;
	protected importCancelled = false;
	private progressWrap: HTMLElement | null = null;
	private progressBarFill: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;

	constructor(app: App, protected plugin: WatchLogPlugin, private mode: 'export' | 'import') {
		super(app);
	}

	// Entity hooks

	protected abstract exportHeading(): string;
	protected abstract exportRows(): CsvExportRow[];
	/** CSV text for the selected ids, plus how many entries it holds. */
	protected abstract exportSelection(ids: Set<string>): { csv: string; count: number };
	protected abstract exportFilePrefix(): string;
	protected abstract noneSelectedNotice(): string;
	protected abstract exportedNotice(count: number): string;

	protected abstract importHeading(): string;
	protected abstract importFields(): readonly CsvFieldDef[];
	protected abstract mapDescription(): string;
	protected abstract mapNote(): string;
	protected abstract valuesDescription(): string;
	protected abstract existingTitles(): { title: string }[];
	/** Entry for one CSV row via `get(fieldKey)`; null skips the row. */
	protected abstract buildEntry(get: (fieldKey: string) => string): E | null;
	protected abstract isKnownStatus(status: string): boolean;
	protected abstract statusChoices(): CsvSelectOption[];
	protected abstract previewMeta(entry: E): string;

	/** Unknown type values; reading has no types. */
	protected collectUnknownTypes(): string[] {
		return [];
	}

	/** Value-map section for unknown types; returns the selects by raw value. */
	protected renderTypeSection(_el: HTMLElement, _types: string[]): Record<string, HTMLSelectElement> {
		return {};
	}

	protected applyTypeValueMap(_entry: E): void {
		// reading entries have no type
	}

	protected afterValueMaps(_row: CsvImportRow<E>): void {
		// hook for post-resolution checks
	}

	/** Entry with every mapped, non-empty field coerced per its definition. */
	protected coerceFields(get: (fieldKey: string) => string): Record<string, unknown> {
		const entry: Record<string, unknown> = {};
		for (const field of this.importFields()) {
			const raw = get(field.key);
			const value = raw ? COERCE[field.coercion](raw) : undefined;
			if (value !== undefined) entry[field.key] = value;
		}
		return entry;
	}

	// Lifecycle

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wl-csv-modal');
		if (this.mode === 'export') this.renderExport(contentEl);
		else this.renderImport(contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// Export

	private renderExport(el: HTMLElement): void {
		el.createEl('h2', { cls: 'wl-modal-title', text: this.exportHeading() });

		const items = this.exportRows();
		items.forEach((it) => this.selectedIds.add(it.id));

		const ctrlRow = el.createDiv({ cls: 'wl-csv-ctrl-row' });
		const selectAllBtn = ctrlRow.createEl('button', { cls: 'wl-btn', text: t('csv.selectAll') });
		const selectNoneBtn = ctrlRow.createEl('button', { cls: 'wl-btn', text: t('csv.selectNone') });
		const countEl = ctrlRow.createSpan({ cls: 'wl-csv-count', text: t('csv.selected', { count: items.length }) });

		const listEl = el.createDiv({ cls: 'wl-csv-list' });
		const checkboxes: HTMLInputElement[] = [];

		const updateCount = (): void => {
			countEl.textContent = t('csv.selected', { count: this.selectedIds.size });
		};

		for (const item of items) {
			const row = listEl.createDiv({ cls: 'wl-csv-row' });
			const cb = row.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = true;
			checkboxes.push(cb);
			row.createSpan({ cls: 'wl-csv-row-title', text: item.title });
			if (item.meta) row.createSpan({ cls: 'wl-csv-row-meta', text: item.meta });

			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedIds.add(item.id);
				else this.selectedIds.delete(item.id);
				updateCount();
			});
		}

		selectAllBtn.addEventListener('click', () => {
			items.forEach((it) => this.selectedIds.add(it.id));
			checkboxes.forEach((cb) => { cb.checked = true; });
			updateCount();
		});

		selectNoneBtn.addEventListener('click', () => {
			this.selectedIds.clear();
			checkboxes.forEach((cb) => { cb.checked = false; });
			updateCount();
		});

		const btnRow = el.createDiv({ cls: 'wl-modal-btn-row wl-csv-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn', text: t('common.cancel') });
		const exportBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: t('csv.exportButton') });

		cancelBtn.addEventListener('click', () => this.close());
		exportBtn.addEventListener('click', () => {
			const { csv, count } = this.exportSelection(this.selectedIds);
			if (count === 0) {
				new Notice(this.noneSelectedNotice());
				return;
			}
			downloadCsv(csv, this.exportFilePrefix());
			new Notice(this.exportedNotice(count));
			this.close();
		});
	}

	// Import shell: steps, progress, file pick

	private renderImport(el: HTMLElement): void {
		el.createEl('h2', { cls: 'wl-modal-title', text: this.importHeading() });

		this.stepUpload = el.createDiv({ cls: 'wl-csv-step' });
		const dropZone = this.stepUpload.createDiv({ cls: 'wl-csv-drop-zone' });
		dropZone.createDiv({ cls: 'wl-csv-drop-label', text: t('csv.pickFile') });
		const fileInput = dropZone.createEl('input', {
			attr: { type: 'file', accept: '.csv' },
			cls: 'wl-csv-file-input',
		});

		this.stepMapping = el.createDiv({ cls: 'wl-csv-step' });
		this.stepMapping.hide();
		this.stepValueMap = el.createDiv({ cls: 'wl-csv-step' });
		this.stepValueMap.hide();
		this.stepPreview = el.createDiv({ cls: 'wl-csv-step' });
		this.stepPreview.hide();

		const btnRow = el.createDiv({ cls: 'wl-modal-btn-row wl-csv-btn-row' });

		// background-import note (hidden until the import starts)
		this.progressWrap = btnRow.createDiv({ cls: 'wl-csv-progress-wrap' });
		this.progressWrap.hide();
		this.progressWrap.createSpan({ cls: 'wl-csv-bg-note', text: t('csv.bgNote') });
		const progressTrack = this.progressWrap.createDiv({ cls: 'wl-csv-progress-track' });
		this.progressBarFill = progressTrack.createDiv({ cls: 'wl-csv-progress-fill' });
		this.progressText = this.progressWrap.createSpan({ cls: 'wl-csv-progress-text', text: '0 / 0' });

		this.cancelBtn = btnRow.createEl('button', { cls: 'wl-btn', text: t('common.cancel') });
		this.importBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: t('csv.importSelected') });
		this.importBtn.disabled = true;
		this.importBtn.hide();

		this.cancelBtn.addEventListener('click', () => {
			if (this.isImporting) {
				this.importCancelled = true;
				if (this.cancelBtn) {
					this.cancelBtn.disabled = true;
					this.cancelBtn.textContent = t('csv.cancelling');
				}
			} else {
				this.close();
			}
		});
		this.importBtn.addEventListener('click', () => void this.doImport());

		fileInput.addEventListener('change', () => {
			const file = fileInput.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const text = ev.target?.result as string;
				this.csvRows = parseCSV(text);
				this.csvHeaders = (this.csvRows[0] ?? []).map((h) => h.trim());
				this.columnMapping = autoMapFields(this.importFields(), this.csvHeaders);
				this.showMappingStep();
			};
			reader.readAsText(file);
		});
	}

	// Step: column mapping

	private showMappingStep(): void {
		if (!this.stepUpload || !this.stepMapping) return;
		this.stepUpload.hide();
		this.stepMapping.show();
		this.renderMappingStep(this.stepMapping);
	}

	private renderMappingStep(el: HTMLElement): void {
		el.empty();
		el.createDiv({ cls: 'wl-csv-step-title', text: t('csv.map.title') });
		el.createDiv({ cls: 'wl-csv-step-desc', text: this.mapDescription() });
		el.createDiv({ cls: 'wl-csv-info-note', text: this.mapNote() });

		const SKIP_VALUE = '';
		const grid = el.createDiv({ cls: 'wl-csv-map-grid' });
		const selectEls: Record<string, HTMLSelectElement> = {};
		const fields = this.importFields();

		for (const field of fields) {
			const row = grid.createDiv({ cls: 'wl-csv-map-row' });
			row.createSpan({ cls: 'wl-csv-map-label', text: t(field.labelKey) });
			const sel = row.createEl('select', { cls: 'wl-select wl-csv-map-select' });
			selectEls[field.key] = sel;
			sel.createEl('option', { value: SKIP_VALUE, text: t('csv.skip') });
			for (const col of this.csvHeaders) {
				sel.createEl('option', { value: col, text: col });
			}
			sel.value = this.columnMapping[field.key] ?? SKIP_VALUE;
		}

		const previewBtn = el.createEl('button', {
			cls: 'wl-btn wl-btn-primary wl-csv-preview-btn',
			text: t('csv.next'),
		});
		previewBtn.addEventListener('click', () => {
			for (const field of fields) {
				this.columnMapping[field.key] = selectEls[field.key]?.value ?? '';
			}
			this.importRows = this.applyMapping().map((r) => ({ ...r, selected: !r.isDuplicate }));

			const unknowns = this.collectUnknowns();
			if (unknowns.statuses.length > 0 || unknowns.types.length > 0 || unknowns.ratings.length > 0) {
				this.showValueMapStep(unknowns);
			} else {
				this.showPreviewStep();
			}
		});
	}

	private applyMapping(): { entry: E; isDuplicate: boolean }[] {
		if (this.csvRows.length < 2) return [];
		const existing = this.existingTitles();

		return this.csvRows.slice(1)
			.filter((r) => r.some((c) => c.trim()))
			.map((values): { entry: E; isDuplicate: boolean } | null => {
				const entry = this.buildEntry((fieldKey) => {
					const colName = this.columnMapping[fieldKey];
					if (!colName) return '';
					const idx = this.csvHeaders.indexOf(colName);
					return idx >= 0 ? (values[idx] ?? '').trim() : '';
				});
				if (!entry) return null;
				const isDuplicate = !!existing.find(
					(it) => it.title.toLowerCase() === (entry.title ?? '').toLowerCase(),
				);
				return { entry, isDuplicate };
			})
			.filter((r): r is { entry: E; isDuplicate: boolean } => r !== null);
	}

	/** Raw rating cell of an import row, or '' when no rating column is mapped. */
	private rawRatingAt(row: CsvImportRow<E>): string {
		const ratingColName = this.columnMapping['rating'];
		const ratingIdx = ratingColName ? this.csvHeaders.indexOf(ratingColName) : -1;
		if (ratingIdx < 0) return '';
		const rawValues = this.csvRows[this.importRows.indexOf(row) + 1] ?? [];
		return (rawValues[ratingIdx] ?? '').trim();
	}

	private collectUnknowns(): CsvUnknowns {
		const statuses: string[] = [];
		const ratings: string[] = [];
		const seenStatuses = new Set<string>();
		const seenRatings = new Set<string>();

		for (const r of this.importRows) {
			const sv = r.entry.status?.trim();
			if (sv && !this.isKnownStatus(sv) && !seenStatuses.has(sv)) {
				statuses.push(sv);
				seenStatuses.add(sv);
			}
			// non-numeric ratings: parseFloat leaves the entry rating at 0
			const rawRating = this.rawRatingAt(r);
			if (rawRating && isNaN(parseFloat(rawRating)) && !seenRatings.has(rawRating)) {
				ratings.push(rawRating);
				seenRatings.add(rawRating);
			}
		}
		return { statuses, types: this.collectUnknownTypes(), ratings };
	}

	// Step: value mapping

	private showValueMapStep(unknowns: CsvUnknowns): void {
		if (!this.stepMapping || !this.stepValueMap) return;
		this.stepMapping.hide();
		this.stepValueMap.show();
		this.renderValueMapStep(this.stepValueMap, unknowns);
	}

	/** Section title plus one select per unknown value; `fill` adds the options and pre-selection. */
	protected renderValueSection(
		el: HTMLElement,
		titleKey: TranslationKey,
		values: string[],
		fill: (sel: HTMLSelectElement, raw: string) => void,
	): Record<string, HTMLSelectElement> {
		const selects: Record<string, HTMLSelectElement> = {};
		if (values.length === 0) return selects;
		el.createDiv({ cls: 'wl-csv-valmap-section-title', text: t(titleKey) });
		for (const raw of values) {
			const sel = createValueMapRow(el, raw);
			selects[raw] = sel;
			sel.createEl('option', { value: '', text: t('csv.leaveBlank') });
			fill(sel, raw);
		}
		return selects;
	}

	private renderValueMapStep(el: HTMLElement, unknowns: CsvUnknowns): void {
		el.empty();
		el.createDiv({ cls: 'wl-csv-step-title', text: t('csv.values.title') });
		el.createDiv({ cls: 'wl-csv-step-desc', text: this.valuesDescription() });

		const choices = this.statusChoices();
		const statusSelects = this.renderValueSection(el, 'csv.fields.status', unknowns.statuses, (sel, sv) => {
			for (const c of choices) sel.createEl('option', { value: c.value, text: c.label });
			// pre-fill with the closest match (case-insensitive)
			const lc = sv.toLowerCase();
			const match = choices.find((c) => c.value.toLowerCase() === lc);
			if (match) sel.value = match.value;
		});
		const typeSelects = this.renderTypeSection(el, unknowns.types);
		const ratingSelects = this.renderValueSection(el, 'csv.fields.rating', unknowns.ratings, (sel) => {
			for (let i = 1; i <= 5; i++) {
				sel.createEl('option', { value: String(i), text: `${i}/5` });
			}
		});

		const btnRow = el.createDiv({ cls: 'wl-csv-valmap-btn-row' });
		const backBtn = btnRow.createEl('button', { cls: 'wl-btn', text: t('csv.back') });
		const confirmBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: t('csv.preview') });

		backBtn.addEventListener('click', () => {
			if (!this.stepValueMap || !this.stepMapping) return;
			this.stepValueMap.hide();
			this.stepMapping.show();
		});

		confirmBtn.addEventListener('click', () => {
			this.statusValueMap = selectedValues(unknowns.statuses, statusSelects);
			this.typeValueMap = selectedValues(unknowns.types, typeSelects);
			this.ratingValueMap = selectedValues(unknowns.ratings, ratingSelects);
			this.applyValueMapsToRows();
			this.showPreviewStep();
		});
	}

	private applyValueMapsToRows(): void {
		for (const r of this.importRows) {
			this.applyStatusValueMap(r.entry);
			this.applyTypeValueMap(r.entry);
			this.applyRatingValueMap(r);
			this.afterValueMaps(r);
		}
	}

	private applyStatusValueMap(entry: CsvEntryBase): void {
		const sv = entry.status?.trim() ?? '';
		if (sv && Object.prototype.hasOwnProperty.call(this.statusValueMap, sv)) {
			entry.status = this.statusValueMap[sv] || undefined;
		}
	}

	/** Maps a non-numeric rating cell to its numeric choice. */
	private applyRatingValueMap(r: CsvImportRow<E>): void {
		const rawRating = this.rawRatingAt(r);
		if (rawRating && Object.prototype.hasOwnProperty.call(this.ratingValueMap, rawRating)) {
			const resolved = this.ratingValueMap[rawRating] ?? '';
			(r.entry as CsvEntryBase).rating = resolved ? parseInt(resolved, 10) : 0;
		}
	}

	// Step: preview

	private showPreviewStep(): void {
		if (!this.stepValueMap || !this.stepMapping || !this.stepPreview || !this.importBtn) return;
		this.stepValueMap.hide();
		this.stepMapping.hide();
		this.stepPreview.show();
		this.importBtn.show();
		this.importBtn.disabled = this.importRows.filter((r) => r.selected).length === 0;
		this.renderPreviewStep(this.stepPreview);
	}

	private renderPreviewStep(el: HTMLElement): void {
		el.empty();

		const dupeCount = this.importRows.filter((r) => r.isDuplicate).length;
		if (dupeCount > 0) {
			el.createDiv({ cls: 'wl-csv-dupe-warning', text: t('csv.duplicates', { count: dupeCount }) });
		}

		const ctrlRow = el.createDiv({ cls: 'wl-csv-ctrl-row' });
		const backBtn = ctrlRow.createEl('button', { cls: 'wl-btn', text: t('csv.back') });
		const selectAllBtn = ctrlRow.createEl('button', { cls: 'wl-btn', text: t('csv.selectAll') });
		const selectNoneBtn = ctrlRow.createEl('button', { cls: 'wl-btn', text: t('csv.selectNone') });
		const countEl = ctrlRow.createSpan({ cls: 'wl-csv-count', text: '' });

		backBtn.addEventListener('click', () => {
			if (!this.stepPreview || !this.stepValueMap || !this.stepMapping || !this.importBtn) return;
			this.stepPreview.hide();
			this.importBtn.hide();
			this.importBtn.disabled = true;
			// back to the value-map step when it was shown, else column mapping
			const hadValueMap = Object.keys(this.statusValueMap).length > 0
				|| Object.keys(this.typeValueMap).length > 0
				|| Object.keys(this.ratingValueMap).length > 0;
			if (hadValueMap) this.stepValueMap.show();
			else this.stepMapping.show();
		});

		const listEl = el.createDiv({ cls: 'wl-csv-list' });
		const checkboxes: HTMLInputElement[] = [];

		const updateCount = (): void => {
			const sel = this.importRows.filter((r) => r.selected).length;
			countEl.textContent = t('csv.selectedOf', { selected: sel, total: this.importRows.length });
			if (this.importBtn) this.importBtn.disabled = sel === 0;
		};

		for (let i = 0; i < this.importRows.length; i++) {
			const r = this.importRows[i]!;
			const row = listEl.createDiv({ cls: `wl-csv-row${r.isDuplicate ? ' wl-csv-row-dupe' : ''}` });
			const cb = row.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = r.selected;
			checkboxes.push(cb);
			row.createSpan({ cls: 'wl-csv-row-title', text: r.entry.title ?? t('csv.noTitle') });
			const metaParts = this.previewMeta(r.entry);
			if (metaParts) row.createSpan({ cls: 'wl-csv-row-meta', text: metaParts });
			if (r.isDuplicate) row.createSpan({ cls: 'wl-csv-dupe-badge', text: t('csv.duplicate') });
			const idx = i;
			cb.addEventListener('change', () => {
				this.importRows[idx]!.selected = cb.checked;
				updateCount();
			});
		}

		selectAllBtn.addEventListener('click', () => {
			this.importRows.forEach((r) => { r.selected = true; });
			checkboxes.forEach((cb) => { cb.checked = true; });
			updateCount();
		});

		selectNoneBtn.addEventListener('click', () => {
			this.importRows.forEach((r) => { r.selected = false; });
			checkboxes.forEach((cb) => { cb.checked = false; });
			updateCount();
		});

		updateCount();
	}

	// Import run

	protected abstract doImport(): Promise<void>;

	/** Selected rows with a title; null (after a notice) when there are none. */
	protected rowsToImport(emptyNotice: string): CsvImportRow<E>[] | null {
		const toImport = this.importRows.filter((r) => r.selected && r.entry.title?.trim());
		if (toImport.length === 0) {
			new Notice(emptyNotice);
			return null;
		}
		return toImport;
	}

	protected startImportUi(total: number): void {
		this.isImporting = true;
		this.importCancelled = false;
		if (this.importBtn) this.importBtn.disabled = true;
		if (this.cancelBtn) this.cancelBtn.textContent = t('csv.cancelImport');
		if (this.progressWrap) this.progressWrap.show();
		if (this.progressText) this.progressText.textContent = `0 / ${total}`;
		if (this.progressBarFill) this.progressBarFill.style.width = `0%`;
	}

	/**
	 * Builds and stores the rows in chunks, honouring cancel between entries; returns how many were
	 * added.
	 */
	protected async importInChunks<X>(
		toImport: CsvImportRow<E>[],
		build: (row: CsvImportRow<E>) => X,
		addBatch: (chunk: X[]) => Promise<void>,
		onProgress?: (added: number) => void,
	): Promise<number> {
		let added = 0;
		for (let chunkStart = 0; chunkStart < toImport.length; chunkStart += CHUNK_SIZE) {
			if (this.importCancelled) break;
			const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, toImport.length);
			const chunk: X[] = [];
			for (let i = chunkStart; i < chunkEnd; i++) {
				if (this.importCancelled) break;
				chunk.push(build(toImport[i]!));
			}
			if (chunk.length === 0) break;
			await addBatch(chunk);
			added += chunk.length;

			onProgress?.(added);
			const pct = Math.round((added / toImport.length) * 100);
			if (this.progressBarFill) this.progressBarFill.style.width = `${pct}%`;
			if (this.progressText) this.progressText.textContent = `${added} / ${toImport.length}`;
		}
		return added;
	}

	/** Final progress text, button state and notice; closes the modal unless cancelled. */
	protected finishImportUi(added: number, total: number, notices: { cancelled: string; done: string }): void {
		const cancelled = this.importCancelled;
		if (this.progressText) {
			this.progressText.textContent = cancelled
				? t('csv.cancelled', { done: added, total })
				: t('csv.done', { count: added });
		}
		if (this.cancelBtn) {
			this.cancelBtn.disabled = false;
			this.cancelBtn.textContent = t('common.close');
		}
		new Notice(cancelled ? notices.cancelled : notices.done);
		if (!cancelled) this.close();
	}
}

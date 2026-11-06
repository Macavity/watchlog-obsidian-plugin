import type { App } from 'obsidian';
import { CsvModalBase, rowsToCsv, type CsvExportRow, type CsvFieldDef, type CsvSelectOption } from './CsvModalBase';
import { safeTypeName } from './storage/VaultLayout';
import { t } from './i18n';
import { statusLabel, typeLabel } from './i18n/labels';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { WatchLogTitle } from './types';
import { getTitleCredits, normalizeManualCredits } from './types';

/** studio list ⇄ one CSV cell; semicolons, since studio names contain commas */
const STUDIO_SEP = '; ';

function studioToCsv(t: WatchLogTitle): string {
	return getTitleCredits(t, 'studio').join(STUDIO_SEP);
}

function studioFromCsv(cell: string | undefined): string[] {
	return normalizeManualCredits((cell ?? '').split(/[;,]/));
}

// CSV helpers

const CSV_COLUMNS = [
	'title', 'type', 'status', 'priority', 'rating',
	'totalEpisodes', 'episodeDuration',
	'dateStarted', 'dateFinished', 'releaseDate', 'dateAdded',
	'externalLink', 'notes', 'studio',
] as const;


function titlesToCsv(titles: WatchLogTitle[]): string {
	return rowsToCsv(CSV_COLUMNS, titles, (t, col) =>
		col === 'studio'
			? studioToCsv(t)
			: (t as unknown as Record<string, string | number | null | undefined>)[col],
	);
}

// Field mapping definitions

const WL_IMPORT_FIELDS: CsvFieldDef[] = [
	{ key: 'title',          labelKey: 'csv.fields.name',          coercion: 'string', autoDetect: ['title', 'name'] },
	{ key: 'type',           labelKey: 'csv.fields.type',          coercion: 'string', autoDetect: ['type'] },
	{ key: 'status',         labelKey: 'csv.fields.status',        coercion: 'string', autoDetect: ['status'] },
	{ key: 'priority',       labelKey: 'csv.fields.priority',      coercion: 'string', autoDetect: ['priority'] },
	{ key: 'rating',         labelKey: 'csv.fields.rating',        coercion: 'rating', autoDetect: ['rating', 'score'] },
	{ key: 'totalEpisodes',  labelKey: 'csv.fields.episodes',      coercion: 'int', autoDetect: ['episodes', 'totalepisodes', 'total episodes', 'episode count', 'ep count'] },
	{ key: 'episodeDuration',labelKey: 'csv.fields.duration',coercion: 'int', autoDetect: ['duration', 'episodeduration', 'episode duration', 'minutes', 'runtime'] },
	{ key: 'dateStarted',    labelKey: 'csv.fields.dateStarted',  coercion: 'date', autoDetect: ['started', 'datestarted', 'date started', 'date_started', 'start date'] },
	{ key: 'dateFinished',   labelKey: 'csv.fields.dateFinished', coercion: 'date', autoDetect: ['finished', 'datefinished', 'date finished', 'date_finished', 'end date', 'finish date', 'completed date'] },
	{ key: 'releaseDate',    labelKey: 'csv.fields.releaseDate',  coercion: 'date', autoDetect: ['releasedate', 'release date', 'release_date', 'air date', 'airdate'] },
	{ key: 'externalLink',   labelKey: 'csv.fields.link',          coercion: 'string', autoDetect: ['link', 'externallink', 'external link', 'external_link', 'url'] },
	{ key: 'notes',          labelKey: 'csv.fields.notes',         coercion: 'string', autoDetect: ['notes', 'note', 'comment', 'comments'] },
	{ key: 'studio',         labelKey: 'csv.fields.studio',        coercion: 'none', autoDetect: ['studio', 'studios', 'network', 'production', 'production company'] },
];


// fields that make an imported row non-empty (priority alone does not)
const NON_EMPTY_KEYS = [
	'type', 'status', 'rating', 'totalEpisodes', 'episodeDuration',
	'dateStarted', 'dateFinished', 'releaseDate', 'externalLink', 'notes',
] as const;

// sentinel for "create new type" in value mapping
const CREATE_NEW_TYPE = '__create__';

// theme-aware random colors for auto-created types
const TYPE_AUTO_COLORS: Record<string, string[]> = {
	default:   ['#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#10B981', '#3B82F6', '#EF4444'],
	nightfall: ['#7B2CBF', '#9D4EDD', '#C77DFF', '#5A189A', '#E040FB', '#B388FF', '#CE93D8', '#9C27B0'],
	bluez:     ['#2C7DA0', '#468FAF', '#61A5C2', '#1B6A8A', '#0077B6', '#00B4D8', '#48CAE4', '#90E0EF'],
};

function randomAutoColor(theme: string): string {
	const palette = TYPE_AUTO_COLORS[theme] ?? TYPE_AUTO_COLORS['default']!;
	return palette[Math.floor(Math.random() * palette.length)] ?? '#888780';
}


/** Complete title from a mapped CSV entry; a Completed status marks all episodes watched. */
export function buildImportedTitle(entry: Partial<WatchLogTitle>, id: string, defaultType: string | undefined): WatchLogTitle {
	const titleName = entry.title!.trim();
	const result: WatchLogTitle = {
		id,
		title: titleName,
		type: entry.type?.trim() || defaultType || 'Anime',
		status: entry.status || 'Plan to watch',
		priority: entry.priority || 'Medium',
		review: '',
		rating: entry.rating ?? 0,
		notes: entry.notes ?? '',
		dateStarted: entry.dateStarted ?? null,
		dateFinished: entry.dateFinished ?? null,
		dateAdded: new Date().toISOString(),
		dateModified: new Date().toISOString(),
		totalEpisodes: entry.totalEpisodes ?? 0,
		episodeDuration: entry.episodeDuration ?? 0,
		releaseDate: entry.releaseDate ?? null,
		externalLink: entry.externalLink ?? '',
		seasons: [],
		watchedEpisodes: [],
		favorite: false,
	};
	if (entry.manualStudio?.length) result.manualStudio = entry.manualStudio;
	if (result.status === 'Completed' && result.totalEpisodes > 0) {
		result.watchedEpisodes = Array.from({ length: result.totalEpisodes }, (_, k) => k + 1);
	}
	return result;
}

/** Type names the import must create: unknown entry types plus those the value map marks for creation. */
export function missingTypeNames(
	entries: { type?: string }[],
	existingTypes: string[],
	typeValueMap: Record<string, string>,
): Set<string> {
	const existing = new Set(existingTypes.map((n) => n.toLowerCase()));
	const missing = new Set<string>();
	for (const e of entries) {
		const typeName = e.type?.trim();
		if (typeName && !existing.has(typeName.toLowerCase())) missing.add(typeName);
	}
	for (const [orig, resolved] of Object.entries(typeValueMap)) {
		const name = safeTypeName(orig);
		if (resolved === CREATE_NEW_TYPE && !existing.has(name.toLowerCase())) missing.add(name);
	}
	return missing;
}

// Modal

export class CsvModal extends CsvModalBase<Partial<WatchLogTitle>> {
	constructor(
		app: App,
		plugin: WatchLogPlugin,
		private dataManager: DataManager,
		mode: 'export' | 'import',
	) {
		super(app, plugin, mode);
	}

	// Export

	protected exportHeading(): string {
		return t('csv.exportTitle');
	}

	protected exportRows(): CsvExportRow[] {
		return this.dataManager.getTitles().map((title) => ({
			id: title.id,
			title: title.title,
			meta: `${typeLabel(title.type)} · ${statusLabel(title.status)}`,
		}));
	}

	protected exportSelection(ids: Set<string>): { csv: string; count: number } {
		const toExport = this.dataManager.getTitles().filter((t) => ids.has(t.id));
		return { csv: titlesToCsv(toExport), count: toExport.length };
	}

	protected exportFilePrefix(): string {
		return 'watchlog';
	}

	protected noneSelectedNotice(): string {
		return t('csv.notice.noTitlesSelected');
	}

	protected exportedNotice(count: number): string {
		return t('csv.notice.exportedTitles', { count });
	}

	// Import schema

	protected importHeading(): string {
		return t('csv.importTitle');
	}

	protected importFields(): readonly CsvFieldDef[] {
		return WL_IMPORT_FIELDS;
	}

	protected mapDescription(): string {
		return t('csv.map.descWatch');
	}

	protected mapNote(): string {
		return t('csv.map.noteWatch');
	}

	protected valuesDescription(): string {
		return t('csv.values.descWatch');
	}

	protected existingTitles(): { title: string }[] {
		return this.dataManager.getTitles();
	}

	protected buildEntry(get: (fieldKey: string) => string): Partial<WatchLogTitle> | null {
		const entry = this.coerceFields(get) as Partial<WatchLogTitle>;
		// imported studios are user data — the manual slot, so a later fetch still runs
		const studioVal = studioFromCsv(get('studio'));
		if (studioVal.length > 0) entry.manualStudio = studioVal;

		// skip rows where all mapped fields resolved to empty
		const isEmpty = !entry.title?.trim() && !entry.manualStudio && NON_EMPTY_KEYS.every((k) => !entry[k]);
		return isEmpty ? null : entry;
	}

	protected previewMeta(entry: Partial<WatchLogTitle>): string {
		return [
			entry.type ? typeLabel(entry.type) : '',
			entry.status ? statusLabel(entry.status) : '',
		].filter(Boolean).join(' · ');
	}

	// Value mapping: statuses and types come from the user's settings

	protected isKnownStatus(status: string): boolean {
		return this.plugin.settings.statuses.some((s) => s.name === status);
	}

	protected statusChoices(): CsvSelectOption[] {
		return this.plugin.settings.statuses.map((s) => ({ value: s.name, label: statusLabel(s.name) }));
	}

	protected collectUnknownTypes(): string[] {
		const existing = new Set(this.plugin.settings.types.map((t) => t.name));
		const unknown: string[] = [];
		const seen = new Set<string>();
		for (const r of this.importRows) {
			const tv = r.entry.type?.trim();
			if (tv && !existing.has(tv) && !seen.has(tv)) {
				unknown.push(tv);
				seen.add(tv);
			}
		}
		return unknown;
	}

	protected renderTypeSection(el: HTMLElement, types: string[]): Record<string, HTMLSelectElement> {
		const existingTypes = this.plugin.settings.types.map((t) => t.name);
		return this.renderValueSection(el, 'csv.fields.type', types, (sel, tv) => {
			for (const name of existingTypes) {
				sel.createEl('option', { value: name, text: typeLabel(name) });
			}
			sel.createEl('option', { value: CREATE_NEW_TYPE, text: t('csv.createType') });
			const lc = tv.toLowerCase();
			sel.value = existingTypes.find((t) => t.toLowerCase() === lc) ?? CREATE_NEW_TYPE;
		});
	}

	protected applyTypeValueMap(entry: Partial<WatchLogTitle>): void {
		// keep the CREATE_NEW_TYPE sentinel; doImport handles it
		const tv = entry.type?.trim() ?? '';
		if (tv && Object.prototype.hasOwnProperty.call(this.typeValueMap, tv)) {
			const resolved = this.typeValueMap[tv] ?? '';
			// keep the original value (made folder-safe) for creation, else the picked type
			entry.type = resolved === CREATE_NEW_TYPE ? safeTypeName(tv) : resolved || undefined;
		}
	}

	protected afterValueMaps(r: { entry: Partial<WatchLogTitle>; isDuplicate: boolean }): void {
		// re-check duplicate status after value resolution
		r.isDuplicate = !!this.dataManager.getTitles().find(
			(t) => t.title.toLowerCase() === (r.entry.title ?? '').toLowerCase()
		);
	}

	// Import

	/** Creates the types the import introduces (marked CREATE_NEW_TYPE or missing); returns how many. */
	private async createMissingTypes(toImport: { entry: Partial<WatchLogTitle> }[]): Promise<number> {
		const theme = this.plugin.settings.colorTheme ?? 'default';
		const existing = this.plugin.settings.types.map((t) => t.name);
		const typesToCreate = missingTypeNames(toImport.map((r) => r.entry), existing, this.typeValueMap);

		if (typesToCreate.size > 0) {
			for (const typeName of typesToCreate) {
				this.plugin.settings.types.push({ name: typeName, color: randomAutoColor(theme) });
			}
			await this.plugin.saveSettings();
		}
		return typesToCreate.size;
	}

	protected async doImport(): Promise<void> {
		const toImport = this.rowsToImport(t('csv.notice.noTitlesToImport'));
		if (!toImport) return;

		this.startImportUi(toImport.length);

		// expose progress to the Watchlist header
		const cancelFn = (): void => { this.importCancelled = true; };
		this.plugin.importProgress = { current: 0, total: toImport.length, cancel: cancelFn };

		const newTypes = await this.createMissingTypes(toImport);

		let added = 0;
		try {
			added = await this.importInChunks(
				toImport,
				(r) => buildImportedTitle(
						r.entry,
						this.dataManager.generateId(r.entry.title!.trim()),
						this.plugin.settings.types[0]?.name,
					),
				(chunk) => this.dataManager.addTitleBatch(chunk),
				(done) => {
					this.plugin.importProgress = { current: done, total: toImport.length, cancel: cancelFn };
				},
			);
		} finally {
			this.isImporting = false;
			this.plugin.importProgress = null;
			this.dataManager.notifyChange();
		}

		this.finishImportUi(added, toImport.length, {
			cancelled: t('csv.notice.importCancelledTitles', { count: added }),
			done: newTypes > 0
				? t('csv.notice.importedTitlesNewTypes', { count: added, types: t('csv.notice.newTypes', { count: newTypes }) })
				: t('csv.notice.importedTitles', { count: added }),
		});
	}
}

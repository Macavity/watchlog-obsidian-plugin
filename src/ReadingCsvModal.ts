import type { App } from 'obsidian';
import { CsvModalBase, rowsToCsv, type CsvFieldDef, type CsvExportRow, type CsvSelectOption } from './CsvModalBase';
import { t } from './i18n';
import { readingStatusLabel } from './i18n/labels';
import type WatchLogPlugin from './main';
import type { Book, Manga, ReadingStatus } from './types';
import { READING_STATUSES, SELECTABLE_READING_STATUSES } from './types';
import type { ReadingCsvKind } from './ReadingCsvChoiceModal';

// Schemas (Books and Manga kept fully separate)

// export column order (dateAdded is export-only)
const BOOK_EXPORT_COLUMNS = [
	'title', 'author', 'status', 'rating',
	'progressUnit', 'pagesRead', 'totalPages', 'wordsRead', 'totalWords',
	'chaptersRead', 'totalChapters',
	'dateStarted', 'dateFinished', 'releaseDate', 'dateAdded',
	'externalLink', 'googleBooksId',
] as const;

const MANGA_EXPORT_COLUMNS = [
	'title', 'author', 'status', 'rating',
	'chaptersRead', 'totalChapters', 'volumesRead', 'totalVolumes',
	'dateStarted', 'dateFinished', 'releaseDate', 'dateAdded',
	'externalLink', 'malId',
] as const;

// import targets — export minus dateAdded (auto-set on insert)
const COMMON_HEAD: CsvFieldDef[] = [
	{ key: 'title',  labelKey: 'csv.fields.title',  coercion: 'string', autoDetect: ['title', 'name'] },
	{ key: 'author', labelKey: 'csv.fields.author', coercion: 'string', autoDetect: ['author', 'writer', 'by'] },
	{ key: 'status', labelKey: 'csv.fields.status', coercion: 'string', autoDetect: ['status'] },
	{ key: 'rating', labelKey: 'csv.fields.rating', coercion: 'rating', autoDetect: ['rating', 'score'] },
];

const COMMON_TAIL: CsvFieldDef[] = [
	{ key: 'dateStarted',  labelKey: 'csv.fields.dateStarted',  coercion: 'date',   autoDetect: ['started', 'datestarted', 'date started', 'date_started', 'start date'] },
	{ key: 'dateFinished', labelKey: 'csv.fields.dateFinished', coercion: 'date',   autoDetect: ['finished', 'datefinished', 'date finished', 'date_finished', 'end date', 'finish date', 'completed date'] },
	{ key: 'releaseDate',  labelKey: 'csv.fields.releaseDate',  coercion: 'date',   autoDetect: ['releasedate', 'release date', 'release_date', 'published', 'publish date'] },
	{ key: 'externalLink', labelKey: 'csv.fields.link',          coercion: 'string', autoDetect: ['link', 'externallink', 'external link', 'external_link', 'url'] },
];

const BOOK_IMPORT_FIELDS: CsvFieldDef[] = [
	...COMMON_HEAD,
	{ key: 'progressUnit',  labelKey: 'csv.fields.progressUnit',  coercion: 'string', autoDetect: ['progressunit', 'progress unit', 'unit'] },
	{ key: 'pagesRead',     labelKey: 'csv.fields.pagesRead',     coercion: 'int', autoDetect: ['pagesread', 'pages read', 'read pages', 'page'] },
	{ key: 'totalPages',    labelKey: 'csv.fields.totalPages',    coercion: 'int', autoDetect: ['totalpages', 'total pages', 'pages', 'page count'] },
	{ key: 'wordsRead',     labelKey: 'csv.fields.wordsRead',     coercion: 'int', autoDetect: ['wordsread', 'words read', 'read words', 'word'] },
	{ key: 'totalWords',    labelKey: 'csv.fields.totalWords',    coercion: 'int', autoDetect: ['totalwords', 'total words', 'words', 'word count'] },
	{ key: 'chaptersRead',  labelKey: 'csv.fields.chaptersRead',  coercion: 'int', autoDetect: ['chaptersread', 'chapters read', 'read chapters'] },
	{ key: 'totalChapters', labelKey: 'csv.fields.totalChapters', coercion: 'int', autoDetect: ['totalchapters', 'total chapters', 'chapters', 'chapter count'] },
	...COMMON_TAIL,
	{ key: 'googleBooksId', labelKey: 'csv.fields.googleBooksId', coercion: 'string', autoDetect: ['googlebooksid', 'google books id', 'gbid', 'volumeid'] },
];

const MANGA_IMPORT_FIELDS: CsvFieldDef[] = [
	...COMMON_HEAD,
	{ key: 'chaptersRead',  labelKey: 'csv.fields.chaptersRead',  coercion: 'int', autoDetect: ['chaptersread', 'chapters read', 'read chapters'] },
	{ key: 'totalChapters', labelKey: 'csv.fields.totalChapters', coercion: 'int', autoDetect: ['totalchapters', 'total chapters', 'chapters', 'chapter count'] },
	{ key: 'volumesRead',   labelKey: 'csv.fields.volumesRead',   coercion: 'int', autoDetect: ['volumesread', 'volumes read', 'read volumes'] },
	{ key: 'totalVolumes',  labelKey: 'csv.fields.totalVolumes',  coercion: 'int', autoDetect: ['totalvolumes', 'total volumes', 'volumes', 'volume count'] },
	...COMMON_TAIL,
	{ key: 'malId',         labelKey: 'csv.fields.malId',         coercion: 'string', autoDetect: ['malid', 'mal id', 'myanimelist id', 'mal'] },
];

interface ReadingSchema {
	exportColumns: readonly string[];
	importFields: CsvFieldDef[];
}

function schemaFor(kind: ReadingCsvKind): ReadingSchema {
	return kind === 'book'
		? { exportColumns: BOOK_EXPORT_COLUMNS, importFields: BOOK_IMPORT_FIELDS }
		: { exportColumns: MANGA_EXPORT_COLUMNS, importFields: MANGA_IMPORT_FIELDS };
}


// Modal

type ReadingEntry = Partial<Book & Manga>;

export class ReadingCsvModal extends CsvModalBase<ReadingEntry> {
	private schema: ReadingSchema;

	private get kindLabel(): string {
		return t(`csv.library.${this.kind}`);
	}

	constructor(app: App, plugin: WatchLogPlugin, private kind: ReadingCsvKind, mode: 'export' | 'import') {
		super(app, plugin, mode);
		this.schema = schemaFor(kind);
	}

	private getItems(): (Book | Manga)[] {
		return this.kind === 'book'
			? this.plugin.readingDataManager.getBooks()
			: this.plugin.readingDataManager.getMangaList();
	}

	// Export

	protected exportHeading(): string {
		return t('csv.exportTitleKind', { library: this.kindLabel });
	}

	protected exportRows(): CsvExportRow[] {
		return this.getItems().map((item) => ({
			id: item.id,
			title: item.title,
			meta: [item.author, readingStatusLabel(item.status)].filter(Boolean).join(' · '),
		}));
	}

	protected exportSelection(ids: Set<string>): { csv: string; count: number } {
		const toExport = this.getItems().filter((it) => ids.has(it.id));
		const csv = rowsToCsv(this.schema.exportColumns, toExport, (it, col) =>
			(it as unknown as Record<string, string | number | null | undefined>)[col]);
		return { csv, count: toExport.length };
	}

	protected exportFilePrefix(): string {
		return `watchlog-${this.kind === 'book' ? 'books' : 'manga'}`;
	}

	protected noneSelectedNotice(): string {
		return t(`csv.notice.noItemsSelected.${this.kind}`);
	}

	protected exportedNotice(count: number): string {
		return t(`csv.notice.exportedItems.${this.kind}`, { count });
	}

	// Import schema

	protected importHeading(): string {
		return t('csv.importTitleKind', { library: this.kindLabel });
	}

	protected importFields(): readonly CsvFieldDef[] {
		return this.schema.importFields;
	}

	protected mapDescription(): string {
		return t('csv.map.descReading', { kind: t(`csv.kind.${this.kind}`) });
	}

	protected mapNote(): string {
		return t('csv.map.noteReading');
	}

	protected valuesDescription(): string {
		return t('csv.values.descReading');
	}

	protected existingTitles(): { title: string }[] {
		return this.getItems();
	}

	protected buildEntry(get: (fieldKey: string) => string): ReadingEntry | null {
		const entry = this.coerceFields(get) as ReadingEntry;
		return entry.title && entry.title.trim() ? entry : null;
	}

	protected previewMeta(entry: ReadingEntry): string {
		return [entry.author, entry.status ? readingStatusLabel(entry.status) : ''].filter(Boolean).join(' · ');
	}

	// Value mapping: reading statuses are a fixed set, with no "create new" option as for watch types

	protected isKnownStatus(status: string): boolean {
		return (READING_STATUSES as string[]).includes(status);
	}

	protected statusChoices(): CsvSelectOption[] {
		return SELECTABLE_READING_STATUSES.map((name) => ({ value: name, label: readingStatusLabel(name) }));
	}

	// Import

	private buildBook(entry: ReadingEntry, defaultStatus: ReadingStatus): Book {
		const titleName = entry.title!.trim();
		const now = new Date().toISOString();
		return {
			id: this.plugin.readingDataManager.generateBookId(titleName),
			title: titleName,
			author: entry.author ?? '',
			status: (entry.status) || defaultStatus,
			rating: entry.rating ?? 0,
			// an explicit Progress Unit column wins; otherwise a CSV carrying only word counts is taken to be
			// words-tracked
			progressUnit: entry.progressUnit === 'words' ? 'words'
				: entry.progressUnit === 'pages' ? 'pages'
				: ((entry.totalWords ?? 0) > 0 || (entry.wordsRead ?? 0) > 0) ? 'words'
				: 'pages',
			pagesRead: entry.pagesRead ?? 0,
			totalPages: entry.totalPages ?? 0,
			wordsRead: entry.wordsRead ?? 0,
			totalWords: entry.totalWords ?? 0,
			chaptersRead: entry.chaptersRead ?? 0,
			totalChapters: entry.totalChapters ?? 0,
			coverUrl: '',
			googleBooksId: entry.googleBooksId ?? '',
			externalLink: entry.externalLink ?? '',
			vaultPage: '',
			dateStarted: entry.dateStarted ?? null,
			dateFinished: entry.dateFinished ?? null,
			releaseDate: entry.releaseDate ?? null,
			dateAdded: now,
			dateModified: now,
			customFields: {},
		};
	}

	private buildManga(entry: ReadingEntry, defaultStatus: ReadingStatus): Manga {
		const titleName = entry.title!.trim();
		const now = new Date().toISOString();
		return {
			id: this.plugin.readingDataManager.generateMangaId(titleName),
			title: titleName,
			author: entry.author ?? '',
			status: (entry.status) || defaultStatus,
			rating: entry.rating ?? 0,
			chaptersRead: entry.chaptersRead ?? 0,
			totalChapters: entry.totalChapters ?? 0,
			volumesRead: entry.volumesRead ?? 0,
			totalVolumes: entry.totalVolumes ?? 0,
			coverUrl: '',
			malId: entry.malId ?? '',
			externalLink: entry.externalLink ?? '',
			vaultPage: '',
			dateStarted: entry.dateStarted ?? null,
			dateFinished: entry.dateFinished ?? null,
			releaseDate: entry.releaseDate ?? null,
			dateAdded: now,
			dateModified: now,
			customFields: {},
		};
	}

	protected async doImport(): Promise<void> {
		const toImport = this.rowsToImport(t(`csv.notice.noItemsToImport.${this.kind}`));
		if (!toImport) return;

		this.startImportUi(toImport.length);

		const reading = this.plugin.readingDataManager;
		const defaultStatus: ReadingStatus = reading.getSettings().defaultStatus ?? 'Plan to Read';

		let added = 0;
		try {
			added = this.kind === 'book'
				? await this.importInChunks(
					toImport,
					(r) => this.buildBook(r.entry, defaultStatus),
					(chunk) => reading.addBookBatch(chunk),
				)
				: await this.importInChunks(
					toImport,
					(r) => this.buildManga(r.entry, defaultStatus),
					(chunk) => reading.addMangaBatch(chunk),
				);
		} finally {
			this.isImporting = false;
			reading.notifyChange();
		}

		this.finishImportUi(added, toImport.length, {
			cancelled: t(`csv.notice.importCancelledItems.${this.kind}`, { count: added }),
			done: t(`csv.notice.importedItems.${this.kind}`, { count: added }),
		});
	}
}

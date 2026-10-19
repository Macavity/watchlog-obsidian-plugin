import { Notice, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type { App } from 'obsidian';
import type WatchLogPlugin from './main';
import type { HistoryManager } from './HistoryManager';
import type { DataStores } from './DataManager';
import type { EntryIndex } from './storage/EntryIndex';
import type { LocalStore } from './storage/LocalStore';
import { getBaseline, setBaseline } from './storage/baseline';
import type { SharedConfigStore } from './storage/SharedConfigStore';
import type { VaultLayout } from './storage/VaultLayout';
import { FOLDERS } from './storage/VaultLayout';
import { decodeBook, decodeManga, encodeBook, encodeManga } from './storage/readingCodec';
import {
	Book,
	Manga,
	ReadingCustomColumn,
	ReadingData,
	ReadingSettings,
	DEFAULT_READING_SETTINGS,
	isReleaseDateFuture,
	todayIso,
	READING_STATUSES,
	DEFAULT_READING_STATUS_COLORS,
} from './types';

export type ReadingKind = 'book' | 'manga';

type Item = Book | Manga;
type Fm = Record<string, unknown>;

/** Keys both kinds can emit; the full rewrite deletes the ones the encoder omits. */
const COMMON_KEYS = [
	'title', 'author', 'status', 'favorite', 'dateFavorited', 'rating', 'dateStarted', 'dateFinished',
	'releaseDate', 'dateAdded', 'dateModified', 'coverUrl', 'externalLink', 'groups', 'externalId', 'type',
	'airtimeRecurrence', 'airtimeDay', 'airtimeTime', 'airtimeSeason', 'airtimeEpisode', 'airtimeAcknowledged',
];
const KIND_KEYS: Record<ReadingKind, string[]> = {
	book: [...COMMON_KEYS, 'pagesRead', 'totalPages', 'progressUnit', 'wordsRead', 'totalWords', 'chaptersRead', 'totalChapters', 'googleBooksId'],
	manga: [...COMMON_KEYS, 'chaptersRead', 'totalChapters', 'volumesRead', 'totalVolumes', 'malId'],
};

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

const encode = (kind: ReadingKind, item: Item): Fm =>
	kind === 'book' ? encodeBook(item as Book) : encodeManga(item as Manga);

/**
 * Books and manga, backed by one note each. Reads come from the EntryIndex (frontmatter); writes go
 * to the note via processFrontMatter and only touch keys whose encoded value changed. Reading
 * settings and table columns live in the shared config (WatchLog.base).
 */
export class ReadingDataManager {
	private plugin: WatchLogPlugin;
	private app: App;
	private index: EntryIndex;
	private local: LocalStore;
	private shared: SharedConfigStore;
	private layout: () => VaultLayout;
	private changeListeners: Array<() => void> = [];
	private historyManager: HistoryManager | null = null;

	private settings: ReadingSettings = { ...DEFAULT_READING_SETTINGS };
	private bookColumns: ReadingCustomColumn[] = [];
	private mangaColumns: ReadingCustomColumn[] = [];

	// Mutable copies handed to the UI, one per id. `src` is the index entry the copy was made from:
	// the baseline a write diffs against, so only fields the user changed reach the note.
	private views: Map<string, { src: Item; view: Item }> = new Map();
	// ids changed via the *Silent updaters, written on the next saveAndNotify()
	private dirty: Set<string> = new Set();

	constructor(plugin: WatchLogPlugin, stores: DataStores) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.index = stores.index;
		this.local = stores.local;
		this.shared = stores.shared;
		this.layout = stores.layout;
	}

	setHistoryManager(hm: HistoryManager): void {
		this.historyManager = hm;
	}

	/** After index.build() and shared.load(): follows index and shared-config changes. */
	async init(): Promise<void> {
		this.readShared();
		this.index.onChange((ids) => {
			let touched = false;
			for (const id of ids) {
				if (id.startsWith(`${FOLDERS.book}/`) || id.startsWith(`${FOLDERS.manga}/`)) {
					// a pending silent edit keeps its copy until written
					if (!this.dirty.has(id)) this.views.delete(id);
					touched = true;
				}
			}
			if (touched) this.notifyListeners();
		});
		this.shared.onChange(() => {
			this.readShared();
			this.notifyListeners();
		});
		// additive reconcile: every future-dated item gets an Upcoming entry. Never removes, so
		// manually-scheduled recurring entries survive reloads.
		const dm = this.plugin.dataManager;
		if (dm) {
			for (const b of this.getBooks()) if (isReleaseDateFuture(b.releaseDate)) await dm.autoAddReadingToUpcoming(b, 'book');
			for (const m of this.getMangaList()) if (isReleaseDateFuture(m.releaseDate)) await dm.autoAddReadingToUpcoming(m, 'manga');
		}
		this.notifyListeners();
	}

	/** Re-reads settings and drops cached copies (backup restore, external reload). */
	async load(): Promise<void> {
		this.readShared();
		this.views.clear();
		this.notifyListeners();
	}

	// Settings + columns (shared config)

	/** Normalizes `settings.reading` of the shared config into memory; never writes. */
	private readShared(): void {
		const raw = (this.shared.get().settings.reading ?? {}) as Partial<ReadingSettings> & {
			bookColumns?: ReadingCustomColumn[];
			mangaColumns?: ReadingCustomColumn[];
		};
		const { bookColumns, mangaColumns, ...rest } = raw;
		const settings: ReadingSettings = { ...DEFAULT_READING_SETTINGS, ...rest };
		// "On Hold" was removed; never leave it as the default for new entries
		if ((settings.defaultStatus as string) === 'On Hold') settings.defaultStatus = 'Plan to Read';
		// status colours are user-editable — seed missing keys from the shipped defaults
		const colors: Record<string, string> = { ...DEFAULT_READING_STATUS_COLORS, ...(settings.statusColors ?? {}) };
		for (const status of READING_STATUSES) {
			if (typeof colors[status] !== 'string') colors[status] = DEFAULT_READING_STATUS_COLORS[status];
		}
		settings.statusColors = colors as ReadingSettings['statusColors'];
		this.settings = settings;
		const clean = (cols: unknown): ReadingCustomColumn[] =>
			(Array.isArray(cols) ? (cols as ReadingCustomColumn[]) : []).map((c) => ({
				...c,
				options: Array.isArray(c.options) ? c.options : [],
				color: c.color || '#5F5E5A',
			}));
		this.bookColumns = clean(bookColumns);
		this.mangaColumns = clean(mangaColumns);
	}

	private async saveShared(): Promise<void> {
		const rest: Partial<ReadingSettings> = { ...this.settings };
		delete rest.defaultFolder;
		await this.shared.update({
			reading: { ...rest, bookColumns: this.bookColumns, mangaColumns: this.mangaColumns },
		});
	}

	/** Current dataset as a backup snapshot. */
	exportSnapshot(): ReadingData {
		return {
			books: this.getBooks(),
			manga: this.getMangaList(),
			bookColumns: this.bookColumns,
			mangaColumns: this.mangaColumns,
			settings: this.settings,
		};
	}

	getSettings(): ReadingSettings {
		return this.settings;
	}

	async updateSettings(patch: Partial<ReadingSettings>): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		await this.save();
	}

	/**
	 * Persist without notifying — for state the rendering tab wrote itself (the rows layout): it
	 * re-renders on its own.
	 */
	persistQuiet(): void {
		void this.saveShared().catch((e) => console.warn('[WL] ReadingDataManager.save failed:', e));
	}

	private async save(): Promise<void> {
		try {
			await this.saveShared();
		} catch (e) {
			console.warn('[WL] ReadingDataManager.save failed:', e);
		}
		this.notifyListeners();
	}

	/** Writes items changed via the silent updaters, then notifies. */
	async saveAndNotify(): Promise<void> {
		await this.writeDirty();
		this.notifyListeners();
	}

	private async writeDirty(): Promise<void> {
		const ids = [...this.dirty];
		this.dirty.clear();
		for (const id of ids) {
			const kind = this.kindOf(id);
			const slot = this.views.get(id);
			if (kind && slot) {
				try { await this.writeItem(kind, slot.view); } catch (e) { console.warn('[WL] reading note write failed:', e); }
			} else {
				new Notice(`An edit of "${id}" was not saved: its note can no longer be read.`);
			}
		}
	}

	/** Writes pending silent edits now, without notifying (plugin unload). */
	async flushPending(): Promise<void> {
		await this.writeDirty();
	}

	/**
	 * Silent favorite toggle: note only, deliberately no dateModified stamp — a favorite is not a
	 * content edit and must not bubble the item up recently-modified orderings.
	 */
	async setFavorite(kind: ReadingKind, id: string, favorite: boolean): Promise<void> {
		const item = kind === 'book' ? this.getBook(id) : this.getManga(id);
		if (!item) return;
		item.favorite = favorite;
		// stamp drives the Favorites shelf order (newest first); cleared on unfavorite
		if (favorite) item.dateFavorited = new Date().toISOString();
		else delete item.dateFavorited;
		try { await this.writeItem(kind, item); } catch (e) {
			console.warn('[WL] setFavorite note write failed:', e);
		}
	}

	// Listeners

	onChange(listener: () => void): void {
		this.changeListeners.push(listener);
	}

	offChange(listener: () => void): void {
		this.changeListeners = this.changeListeners.filter((l) => l !== listener);
	}

	notifyChange(): void {
		this.notifyListeners();
	}

	private notifyListeners(): void {
		for (const listener of this.changeListeners) {
			listener();
		}
	}

	/**
	 * Restores settings, columns and entries from a backup. Entries whose note already exists (same
	 * title) are left alone; the rest get a fresh note.
	 */
	async restore(data: ReadingData): Promise<void> {
		const { books = [], manga = [] } = data;
		const { settings, bookColumns, mangaColumns } = data;
		this.settings = { ...DEFAULT_READING_SETTINGS, ...(settings ?? {}) };
		this.bookColumns = Array.isArray(bookColumns) ? bookColumns : [];
		this.mangaColumns = Array.isArray(mangaColumns) ? mangaColumns : [];
		await this.saveShared();
		this.readShared();
		const layout = this.layout();
		for (const [kind, list] of [['book', books], ['manga', manga]] as const) {
			for (const item of list as Item[]) {
				if (this.app.vault.getAbstractFileByPath(layout.notePath(kind, item.title))) continue;
				await this.createNote(kind, { ...item });
			}
		}
		this.notifyListeners();
	}

	// Silent cover updates

	/**
	 * Silent cover URL update for the lazy Cards re-fetch: memory and cache only, never the note (E9),
	 * no notify — the card swaps its own <img>, so the grid is not rebuilt and scroll survives.
	 */
	updateCoverUrl(kind: ReadingKind, id: string, url: string): void {
		const item = kind === 'book' ? this.getBook(id) : this.getManga(id);
		if (!item) return;
		if (!item.coverOverride) item.coverUrl = url;
		this.local.setCache(id, { coverUrl: url });
	}

	/**
	 * Like updateCoverUrl, for a cover found by a title-based lookup (CSV-imported entries without
	 * cover or ID). The resolved source ID is identity data of the note, which a background fetch does
	 * not write; only the cover is kept.
	 */
	updateCoverAndSource(kind: ReadingKind, id: string, url: string, _sourceId: string): void {
		this.updateCoverUrl(kind, id, url);
	}

	/** A cover that is not a note override is API data and lives in the cache only (E9). */
	private syncCover(item: Item): void {
		if (item.coverOverride) return;
		if ((this.local.getCache(item.id)?.coverUrl ?? '') === item.coverUrl) return;
		this.local.setCache(item.id, { coverUrl: item.coverUrl });
	}

	// Reading → Upcoming and release status

	/**
	 * Forces "To be released" when the release date is in the future and reverts to "Plan to Read"
	 * once it passes or is cleared. Returns true if the status changed.
	 */
	private applyReleaseStatus(item: Item): boolean {
		const future = isReleaseDateFuture(item.releaseDate);
		if (future) {
			if (item.status !== 'To be released') {
				item.status = 'To be released';
				return true;
			}
		} else if (item.status === 'To be released') {
			item.status = 'Plan to Read';
			return true;
		}
		return false;
	}

	/**
	 * Mirrors the watchlist auto-add: a reading item with a future release date joins the shared
	 * Upcoming tracker and leaves once the date passes or is cleared.
	 */
	private async syncUpcoming(item: Item, kind: ReadingKind): Promise<void> {
		const dm = this.plugin.dataManager;
		if (!dm) return;
		if (isReleaseDateFuture(item.releaseDate)) {
			await dm.autoAddReadingToUpcoming(item, kind);
		} else {
			await dm.removeReadingAirtimeEntries(item.id);
		}
	}

	// Views

	private kindOf(id: string): ReadingKind | null {
		const k = this.index.get(id)?.kind;
		return k === 'book' || k === 'manga' ? k : null;
	}

	/** UI copy of an index entry: stable while the entry is unchanged, full vault path, release status applied. */
	private viewOf(src: Item): Item {
		const slot = this.views.get(src.id);
		if (slot && slot.src === src) return slot.view;
		const view = {
			...src,
			customFields: { ...(src.customFields ?? {}) },
			...(src.groups ? { groups: [...src.groups] } : {}),
			vaultPage: this.layout().pathFromId(src.id),
		} as Item;
		if (!view.coverOverride) view.coverUrl = this.local.getCache(src.id)?.coverUrl ?? '';
		this.applyReleaseStatus(view);
		this.views.set(src.id, { src, view });
		setBaseline(view, src);
		return view;
	}

	// Books CRUD

	getBooks(): Book[] {
		return this.index.books().map((b) => this.viewOf(b) as Book);
	}

	getBook(id: string): Book | undefined {
		const e = this.index.get(id);
		return e?.kind === 'book' ? (this.viewOf(e.entry) as Book) : undefined;
	}

	async addBook(book: Book): Promise<void> {
		this.applyReleaseStatus(book);
		await this.createNote('book', book);
		this.notifyListeners();
		await this.syncUpcoming(book, 'book');
		void this.historyManager?.log(
			`${book.title} (Book) was added`,
			{ source: 'Reading', action: 'added', titleName: book.title },
		);
	}

	async addBookSilent(book: Book): Promise<void> {
		this.applyReleaseStatus(book);
		await this.createNote('book', book);
	}

	async updateBook(updated: Book): Promise<void> {
		await this.updateItem('book', updated, 'Book');
	}

	updateBookSilent(updated: Book): void {
		this.updateSilent(updated);
	}

	async removeBook(id: string): Promise<void> {
		await this.removeItem('book', id, 'Book');
	}

	/**
	 * Insert many books in one shot: notes first, then per-item Upcoming reconcile and history
	 * (mirrors addTitleBatch). Used by the chunked CSV import.
	 */
	async addBookBatch(books: Book[]): Promise<void> {
		for (const book of books) {
			this.applyReleaseStatus(book);
			try { await this.createNote('book', book); } catch (e) { console.warn('[WL] reading note create failed:', e); continue; }
			await this.syncUpcoming(book, 'book');
			void this.historyManager?.log(
				`${book.title} (Book) was added`,
				{ source: 'Reading', action: 'added', titleName: book.title },
			);
		}
	}

	async removeBooksBatch(ids: string[]): Promise<void> {
		await this.removeBatch('book', ids, 'Book');
	}

	/** Id a new book titled `title` would get (its note path below the root). */
	generateBookId(title: string): string {
		return this.predictId('book', title);
	}

	// Manga CRUD

	getMangaList(): Manga[] {
		return this.index.manga().map((m) => this.viewOf(m) as Manga);
	}

	getManga(id: string): Manga | undefined {
		const e = this.index.get(id);
		return e?.kind === 'manga' ? (this.viewOf(e.entry) as Manga) : undefined;
	}

	async addManga(manga: Manga): Promise<void> {
		this.applyReleaseStatus(manga);
		await this.createNote('manga', manga);
		this.notifyListeners();
		await this.syncUpcoming(manga, 'manga');
		void this.historyManager?.log(
			`${manga.title} (Manga) was added`,
			{ source: 'Reading', action: 'added', titleName: manga.title },
		);
	}

	async addMangaSilent(manga: Manga): Promise<void> {
		this.applyReleaseStatus(manga);
		await this.createNote('manga', manga);
	}

	async updateManga(updated: Manga): Promise<void> {
		await this.updateItem('manga', updated, 'Manga');
	}

	updateMangaSilent(updated: Manga): void {
		this.updateSilent(updated);
	}

	async removeManga(id: string): Promise<void> {
		await this.removeItem('manga', id, 'Manga');
	}

	async removeMangaBatch(ids: string[]): Promise<void> {
		await this.removeBatch('manga', ids, 'Manga');
	}

	/**
	 * Insert many manga in one shot: notes first, then per-item Upcoming reconcile and history.
	 * Used by the chunked CSV import.
	 */
	async addMangaBatch(mangaList: Manga[]): Promise<void> {
		for (const manga of mangaList) {
			this.applyReleaseStatus(manga);
			try { await this.createNote('manga', manga); } catch (e) { console.warn('[WL] reading note create failed:', e); continue; }
			await this.syncUpcoming(manga, 'manga');
			void this.historyManager?.log(
				`${manga.title} (Manga) was added`,
				{ source: 'Reading', action: 'added', titleName: manga.title },
			);
		}
	}

	/** Id a new manga titled `title` would get (its note path below the root). */
	generateMangaId(title: string): string {
		return this.predictId('manga', title);
	}

	private predictId(kind: ReadingKind, title: string): string {
		const layout = this.layout();
		return layout.idFromPath(this.freePath(layout.notePath(kind, title)));
	}

	// Shared update/remove flows

	private async updateItem(kind: ReadingKind, updated: Item, label: string): Promise<void> {
		const src = this.sourceOf(kind, updated.id);
		if (!src) return;
		updated.dateModified = new Date().toISOString();
		this.applyReleaseStatus(updated);
		const name = updated.title;
		if (src.status !== updated.status) {
			const act = updated.status === 'Completed' ? 'completed' as const : 'status' as const;
			// mirror the watch behavior: stamp today's finish date on the transition to Completed
			if (updated.status === 'Completed' && this.plugin.settings.setFinishDateAutomatically && !updated.dateFinished) {
				updated.dateFinished = todayIso();
			}
			void this.historyManager?.log(
				`${name} (${label}) status changed to ${updated.status}`,
				{ source: 'Reading', action: act, titleName: name },
			);
		}
		if (src.rating !== updated.rating) {
			void this.historyManager?.log(
				`${name} (${label}) Rating → ${updated.rating}/5`,
				{ source: 'Reading', action: 'rating', titleName: name },
			);
		}
		const oldReleaseDate = src.releaseDate;
		try { await this.writeItem(kind, updated); } catch (e) { console.warn('[WL] reading note write failed:', e); }
		this.notifyListeners();
		// reconcile Upcoming only when the release date actually changed, so rating/status/progress edits
		// never disturb a manual recurring entry
		if (oldReleaseDate !== updated.releaseDate) await this.syncUpcoming(updated, kind);
	}

	private updateSilent(updated: Item): void {
		const id = updated.id;
		const slot = this.views.get(id);
		const src = getBaseline(updated) ?? slot?.src ?? this.sourceOf(this.kindOf(id) ?? 'book', id);
		if (!src) return;
		updated.dateModified = new Date().toISOString();
		this.applyReleaseStatus(updated);
		this.views.set(id, { src, view: updated });
		setBaseline(updated, src);
		this.dirty.add(id);
	}

	private async removeItem(kind: ReadingKind, id: string, label: string): Promise<void> {
		const item = kind === 'book' ? this.getBook(id) : this.getManga(id);
		await this.deleteNote(id);
		this.notifyListeners();
		await this.plugin.dataManager?.removeReadingAirtimeEntries(id);
		if (item) {
			void this.historyManager?.log(
				`${item.title} (${label}) was deleted`,
				{ source: 'Reading', action: 'deleted', titleName: item.title },
			);
		}
	}

	private async removeBatch(kind: ReadingKind, ids: string[], label: string): Promise<void> {
		const items = ids.map((id) => (kind === 'book' ? this.getBook(id) : this.getManga(id))).filter((x): x is Item => !!x);
		for (const id of ids) await this.deleteNote(id).catch(() => {});
		this.notifyListeners();
		for (const id of ids) await this.plugin.dataManager?.removeReadingAirtimeEntries(id);
		for (const item of items) {
			void this.historyManager?.log(
				`${item.title} (${label}) was deleted`,
				{ source: 'Reading', action: 'deleted', titleName: item.title },
			);
		}
	}

	/** Index entry (the stored state) for an id, or the baseline of an existing view. */
	private sourceOf(kind: ReadingKind, id: string): Item | undefined {
		const e = this.index.get(id);
		return e?.kind === kind ? e.entry : this.views.get(id)?.src;
	}

	// Custom columns CRUD

	getBookColumns(): ReadingCustomColumn[] {
		return this.bookColumns;
	}

	getMangaColumns(): ReadingCustomColumn[] {
		return this.mangaColumns;
	}

	private columnsFor(kind: ReadingKind): ReadingCustomColumn[] {
		return kind === 'book' ? this.bookColumns : this.mangaColumns;
	}

	async addColumn(kind: ReadingKind, column: ReadingCustomColumn): Promise<void> {
		this.columnsFor(kind).push(column);
		await this.save();
	}

	async updateColumn(kind: ReadingKind, updated: ReadingCustomColumn): Promise<void> {
		const cols = this.columnsFor(kind);
		const idx = cols.findIndex((c) => c.id === updated.id);
		if (idx >= 0) {
			cols[idx] = updated;
			await this.save();
		}
	}

	async removeColumn(kind: ReadingKind, id: string): Promise<void> {
		if (kind === 'book') this.bookColumns = this.bookColumns.filter((c) => c.id !== id);
		else this.mangaColumns = this.mangaColumns.filter((c) => c.id !== id);
		const items: Item[] = kind === 'book' ? this.getBooks() : this.getMangaList();
		for (const item of items) {
			if (item.customFields && Object.prototype.hasOwnProperty.call(item.customFields, id)) {
				delete item.customFields[id];
				try { await this.writeItem(kind, item); } catch (e) { console.warn('[WL] reading note write failed:', e); }
			}
		}
		await this.save();
	}

	generateColumnId(kind: ReadingKind, name: string): string {
		const base = `col-${slugify(name) || 'field'}`;
		const existing = new Set(this.columnsFor(kind).map((c) => c.id));
		if (!existing.has(base)) return base;
		let counter = 2;
		while (existing.has(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	async reorderColumns(kind: ReadingKind, fromIdx: number, toIdx: number): Promise<void> {
		const cols = this.columnsFor(kind);
		if (fromIdx < 0 || fromIdx >= cols.length || toIdx < 0 || toIdx >= cols.length) return;
		const [moved] = cols.splice(fromIdx, 1);
		if (!moved) return;
		cols.splice(toIdx, 0, moved);
		await this.save();
	}

	// Custom field values

	async setCustomField(
		kind: ReadingKind,
		itemId: string,
		columnId: string,
		value: string | number | null,
	): Promise<void> {
		const item = kind === 'book' ? this.getBook(itemId) : this.getManga(itemId);
		if (!item) return;
		if (!item.customFields) item.customFields = {};
		if (value === null || value === '') {
			delete item.customFields[columnId];
		} else {
			item.customFields[columnId] = value;
		}
		item.dateModified = new Date().toISOString();
		try { await this.writeItem(kind, item); } catch (e) { console.warn('[WL] reading note write failed:', e); }
		this.notifyListeners();
	}

	// Reading note files

	/** Path of the note for `title`: the existing entry's note when there is one, else the path a new one gets. */
	noteFilePath(kind: ReadingKind, title: string): string {
		const layout = this.layout();
		const list: Item[] = kind === 'book' ? this.index.books() : this.index.manga();
		const hit = list.find((e) => e.title === title);
		return hit ? layout.pathFromId(hit.id) : layout.notePath(kind, title);
	}

	private fileOf(id: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.layout().pathFromId(id));
		return f instanceof TFile ? f : null;
	}

	/** First free `<name>.md`, `<name> 2.md`, … */
	private freePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const base = path.slice(0, -3);
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${base} ${n}.md`)) n++;
		return `${base} ${n}.md`;
	}

	private parentOf(path: string): string {
		const i = path.lastIndexOf('/');
		return i < 0 ? '' : path.slice(0, i);
	}

	private async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (!normalized || normalized === '/') return;
		if (!this.app.vault.getAbstractFileByPath(normalized)) {
			try {
				await this.app.vault.createFolder(normalized);
			} catch {
				// folder may already exist
			}
		}
	}

	/** Cache + optimistic index update after an own write; `item` stays the UI's copy. */
	private afterWrite(kind: ReadingKind, item: Item, fm: Fm): void {
		this.syncCover(item);
		const stored = kind === 'book' ? decodeBook(item.id, fm).entry : decodeManga(item.id, fm).entry;
		this.index.applyLocal(kind === 'book'
			? { kind: 'book', entry: stored as Book }
			: { kind: 'manga', entry: stored as Manga });
		item.vaultPage = this.layout().pathFromId(item.id);
		this.views.set(item.id, { src: stored, view: item });
		setBaseline(item, stored);
	}

	/**
	 * processFrontMatter, then the optimistic index update — inside the callback, so it lands before
	 * the write's `changed` event can be seen. False (and a notice) on unreadable YAML.
	 */
	private async processFrontMatter(
		file: TFile,
		kind: ReadingKind,
		item: Item,
		fn: (fm: Fm) => void,
	): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(file, (fm: Fm) => {
				fn(fm);
				this.afterWrite(kind, item, { ...fm });
			});
			return true;
		} catch (e) {
			console.warn(`WatchLog: could not update frontmatter of ${file.path}`, e);
			new Notice(`Could not update "${file.basename}": its frontmatter is not valid YAML.`);
			return false;
		}
	}

	/** Creates the note for a new entry; the entry's id becomes the note path. */
	private async createNote(kind: ReadingKind, item: Item): Promise<void> {
		const layout = this.layout();
		const path = this.freePath(layout.notePath(kind, item.title));
		await this.ensureFolder(this.parentOf(path));
		const fm = encode(kind, item);
		item.id = layout.idFromPath(path);
		// index first, so the create event finds nothing new
		this.afterWrite(kind, item, fm);
		try {
			await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n## Notes\n\n\n## Quotes\n`);
		} catch (e) {
			this.index.removeLocal(item.id);
			this.views.delete(item.id);
			throw e;
		}
	}

	/**
	 * Writes an entry to its note: renames the file on a title change, then sets only the frontmatter
	 * keys whose encoded value differs from the stored state (so unreadable or foreign fields stay
	 * untouched unless this edit changes exactly that field). Creates the note when missing.
	 */
	private async writeItem(kind: ReadingKind, item: Item): Promise<void> {
		let file = this.fileOf(item.id);
		if (!file) {
			await this.createNote(kind, item);
			return;
		}
		const src = getBaseline(item) ?? this.views.get(item.id)?.src ?? this.sourceOf(kind, item.id);

		if (src && item.title !== src.title) {
			const target = this.layout().notePath(kind, item.title);
			if (target !== file.path) {
				if (this.app.vault.getAbstractFileByPath(target)) {
					new Notice(`"${target}" already exists; the note keeps its old file name.`);
				} else {
					await this.ensureFolder(this.parentOf(target));
					await this.app.fileManager.renameFile(file, target);
					const from = item.id;
					const to = this.layout().idFromPath(target);
					this.index.removeLocal(from);
					this.views.delete(from);
					if (this.dirty.delete(from)) this.dirty.add(to);
					item.id = to;
					file = this.fileOf(to) ?? file;
				}
			}
		}

		const before = src ? encode(kind, src) : {};
		const after = encode(kind, item);
		const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((k) => !sameJson(before[k], after[k]));
		if (changed.length > 0) {
			const ok = await this.processFrontMatter(file, kind, item, (raw) => {
				for (const key of changed) {
					if (key in after) raw[key] = after[key];
					else delete raw[key];
				}
			});
			// the copy now holds what the note holds for every field it knows
			if (ok) setBaseline(item, structuredClone(item));
		} else {
			this.syncCover(item);
			if (src) this.views.set(item.id, { src, view: item });
		}
	}

	private async deleteNote(id: string): Promise<void> {
		const file = this.fileOf(id);
		if (file) await this.app.fileManager.trashFile(file);
		this.index.removeLocal(id);
		this.views.delete(id);
		this.dirty.delete(id);
	}

	/** Writes (creates or updates) the note file. Returns its path. */
	async writeReadingNote(kind: ReadingKind, item: Item): Promise<string> {
		await this.writeItem(kind, item);
		return this.layout().pathFromId(item.id);
	}

	async ensureReadingNote(kind: ReadingKind, item: Item): Promise<string> {
		if (this.fileOf(item.id)) return this.layout().pathFromId(item.id);
		return this.writeReadingNote(kind, item);
	}

	/** Creates the note file only if missing; true when one was created. */
	async createReadingNoteIfMissing(kind: ReadingKind, item: Item): Promise<boolean> {
		if (this.fileOf(item.id)) return false;
		await this.createNote(kind, item);
		return true;
	}

	/**
	 * Rewrites every plugin-owned frontmatter key of an existing reading note, body verbatim. Keys the
	 * encoder omits are removed, except fields the decoder could not read. Does NOT create the file
	 * when missing — returns false. Used by the bulk "Rewrite all frontmatter" action.
	 */
	async rewriteFrontmatterIfExists(kind: ReadingKind, item: Item): Promise<boolean> {
		const file = this.fileOf(item.id);
		if (!file) return false;
		const out = encode(kind, item);
		const keep = new Set(this.index.invalidFields(item.id));
		return this.processFrontMatter(file, kind, item, (raw) => {
			for (const key of KIND_KEYS[kind]) {
				if (key in out) {
					if (!keep.has(key) || !(key in raw)) raw[key] = out[key];
				} else if (!keep.has(key)) {
					delete raw[key];
				}
			}
			for (const key of Object.keys(raw)) {
				if (key.startsWith('cf_') && !(key in out) && !keep.has(key)) delete raw[key];
			}
		});
	}

	async readReadingNote(_kind: ReadingKind, item: Item): Promise<string | null> {
		const file = this.fileOf(item.id);
		return file ? this.app.vault.read(file) : null;
	}

	/** Appends a `> [!quote]` callout to the ## Quotes section, creating it if missing. */
	async appendQuote(
		kind: ReadingKind,
		item: Item,
		text: string,
		reference: string,
	): Promise<void> {
		await this.ensureReadingNote(kind, item);
		const file = this.fileOf(item.id);
		if (!file) return;

		const refTrim = reference.trim();
		const titlePart = refTrim ? ` ${refTrim}` : '';
		const bodyLines = text
			.split(/\r?\n/)
			.map((l) => `> ${l}`)
			.join('\n');
		const callout = `> [!quote]${titlePart}\n${bodyLines}`;

		await this.app.vault.process(file, (current) => {
			const quotesMatch = current.match(/(^|\n)## Quotes[ \t]*\r?\n/);
			if (quotesMatch && quotesMatch.index !== undefined) {
				const insertAt = quotesMatch.index + quotesMatch[0].length;
				const before = current.slice(0, insertAt);
				const after = current.slice(insertAt);
				const needsLeadingNl = before.length > 0 && !before.endsWith('\n\n');
				return `${before}${needsLeadingNl ? '\n' : ''}${callout}\n${after.startsWith('\n') ? '' : '\n'}${after}`;
			}
			const sep = current.endsWith('\n') ? '' : '\n';
			return `${current}${sep}\n## Quotes\n\n${callout}\n`;
		});
	}

	async deleteReadingNote(_kind: ReadingKind, item: Item): Promise<void> {
		await this.deleteNote(item.id);
	}
}

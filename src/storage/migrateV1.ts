import { TFile, TFolder, normalizePath, type App } from 'obsidian';
import {
	DEFAULT_READING_SETTINGS, GAME_TBA_STATUS, defaultGamesSettings, getDisplayPoster, getDisplayTrailer, getTitleCredits,
	parsePlaytimeInput,
} from '../types';
import type {
	AirtimeEntry, Book, EntryAirtime, Game, GamesData, GamesSettings, Manga, ReadingData, ReadingStatus,
	RecommendedDaily, TagDefinition, WatchLogData, WatchLogTitle,
} from '../types';
import type { HistoryEntry } from '../HistoryManager';
import type { LocalStore } from './LocalStore';
import { SHARED_SETTING_KEYS, type SharedConfigStore } from './SharedConfigStore';
import { historyKey, type HistoryStore } from './HistoryStore';
import type { VaultLayout } from './VaultLayout';
import type { EntryCache, LocalData, YamlIO } from './storageTypes';
import { encodeTitle, splitCache } from './titleCodec';
import { encodeBook, encodeManga } from './readingCodec';
import { encodeGame } from './gameCodec';
import { externalIdFromLink } from './externalId';
import { hasWatchlogKey } from './baseFile';

export interface MigrationReport {
	notesCreated: number;
	notesFilled: number;
	foldersMoved: string[];
	skipped: string[];
	errors: string[];
}

export interface ImportContext {
	app: App;
	local: LocalStore;
	shared: SharedConfigStore;
	history: HistoryStore;
	yaml: YamlIO;
	/** Root: folder of an existing `watchlog:` base, else `legacyRoot(legacy)`. */
	layout: VaultLayout;
}

export interface MigrationContext extends ImportContext {
	plugin: { manifest: { dir?: string } };
	legacy: WatchLogData;
}

type Fm = Record<string, unknown>;

const BACKUP_FILE = 'data.v1-backup.json';
const CUSTOM_LIST_DATA = /^## Data\r?\n```json/m;
/** A second device must not re-add what the first one migrated (and the user may have changed since). */
const JOINED_KEYS = ['watched', 'skipped', 'seasons'];
const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(\r?\n|$)/;
const UNSAFE = /[*"\\/<>:|?]/g;
/** Settings dropped in schema 2 (the folders are central now). */
const REMOVED_SETTINGS = ['rootFolder', 'customListsFolder'];
const WISHLIST = 'Wishlist';
const ON_HOLD = 'On Hold';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Frontmatter value equality across YAML scalars and lists (7.5 and "7.5" alike). */
const sameValue = (a: unknown, b: unknown): boolean => {
	const scalar = (v: unknown): unknown => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v ?? null);
	const norm = (v: unknown): string => JSON.stringify(Array.isArray(v) ? v.map(scalar) : scalar(v));
	return norm(a) === norm(b);
};

/** Root folder of a schema-1 install: the old `rootFolder` setting. */
export function legacyRoot(legacy: WatchLogData): string {
	const root = (legacy.settings as Record<string, unknown> | undefined)?.rootFolder;
	return normalizePath(typeof root === 'string' && root.trim() ? root : 'WatchLog');
}

/**
 * Converts a schema-1 data.json into notes, the base, History.md and a schema-2 data.json. Every
 * step checks the current state, so a rerun (or a second device with the same legacy data) changes
 * nothing. Existing note values are never overwritten. On an error data.json stays schema 1.
 */
export async function migrateV1(ctx: MigrationContext): Promise<MigrationReport> {
	const report: MigrationReport = { notesCreated: 0, notesFilled: 0, foldersMoved: [], skipped: [], errors: [] };
	try {
		await new Migration(ctx, ctx.legacy, report, ctx.plugin.manifest.dir).run();
	} catch (e) {
		report.errors.push(e instanceof Error ? e.message : String(e));
	}
	return report;
}

/**
 * Imports a legacy data object (a restored v1-v3 backup) into the vault: notes are created or
 * only filled, groups, airtime and history are applied, the base is filled when empty and the
 * cache is merged. Writes no data.v1-backup.json, moves no folders, leaves schemaVersion alone and
 * only fills missing device-local settings.
 */
export async function importLegacy(legacy: WatchLogData, ctx: ImportContext): Promise<MigrationReport> {
	const report: MigrationReport = { notesCreated: 0, notesFilled: 0, foldersMoved: [], skipped: [], errors: [] };
	try {
		await new Migration(ctx, legacy, report, undefined).importOnly();
	} catch (e) {
		report.errors.push(e instanceof Error ? e.message : String(e));
	}
	return report;
}

/** Legacy id -> new id (note path relative to root) per kind, plus group id -> name. */
interface IdMaps {
	title: Map<string, string>;
	book: Map<string, string>;
	manga: Map<string, string>;
	game: Map<string, string>;
	group: Map<string, string>;
}

class Migration {
	private cache: Record<string, EntryCache> = {};
	private claimed = new Set<string>();
	/** A base with `watchlog:` existed before this run: another device migrated already. */
	private joined = false;
	private ids: IdMaps = { title: new Map(), book: new Map(), manga: new Map(), game: new Map(), group: new Map() };

	constructor(
		private ctx: ImportContext,
		private legacy: WatchLogData,
		private report: MigrationReport,
		private pluginDir: string | undefined,
	) {}

	async run(): Promise<void> {
		await this.backup();
		this.joined = await this.baseExists();
		const data = await this.prepare(true);
		await this.centralizeFolders(data);
		await this.importData(data);
		await this.ctx.local.adoptV2(this.localData(data));
	}

	/** Restore path: the notes, base, history and cache part of `run`, nothing else. */
	async importOnly(): Promise<void> {
		const data = await this.prepare(false);
		await this.importData(data);
		const { local } = this.ctx;
		for (const [id, cache] of Object.entries(this.cache)) {
			local.data.cache[id] = { ...cache, ...local.data.cache[id] };
		}
		// device-local settings (API keys): fill what is missing, never overwrite, never into vault files
		for (const [k, v] of Object.entries(data.settings)) {
			if (SHARED_SETTING_KEYS.includes(k) || REMOVED_SETTINGS.includes(k)) continue;
			const cur = local.data.settings[k];
			if (cur === undefined || cur === null || cur === '') local.data.settings[k] = v;
		}
		local.queueSave();
	}

	private async importData(data: WatchLogData): Promise<void> {
		await this.importEntries(data);
		await this.importHistory(data);
		// last: an interrupted run must not look like a finished migration on the retry
		await this.ensureBase(data);
	}

	private async baseExists(): Promise<boolean> {
		const { vault } = this.ctx.app;
		const base = vault.getAbstractFileByPath(this.ctx.layout.basePath);
		return base instanceof TFile && hasWatchlogKey(await vault.read(base));
	}

	private dir(): string {
		const dir = this.pluginDir;
		if (!dir) throw new Error('plugin folder unknown, no backup of data.json written');
		return dir;
	}

	/** Copies data.json to data.v1-backup.json once. */
	private async backup(): Promise<void> {
		const adapter = this.ctx.app.vault.adapter;
		const dir = this.dir();
		const target = normalizePath(`${dir}/${BACKUP_FILE}`);
		if (await adapter.exists(target)) return;
		const source = normalizePath(`${dir}/data.json`);
		const content = (await adapter.exists(source))
			? await adapter.read(source)
			: JSON.stringify(this.legacy, null, '\t');
		await adapter.write(target, content);
	}

	/** A normalized copy of the legacy data with the old load-time corrections applied. */
	private async prepare(mergeFiles: boolean): Promise<WatchLogData> {
		const data = structuredClone(this.legacy);
		data.settings = isRecord(data.settings) ? data.settings : {};
		if (mergeFiles) await this.mergeLegacyFiles(data);
		data.titles = (Array.isArray(data.titles) ? data.titles : []).map(normalizeTitle);
		data.groups = Array.isArray(data.groups) ? data.groups : [];
		data.reading = normalizeReading(data.reading);
		data.games = normalizeGames(data.games);
		return data;
	}

	/** Very old installs kept reading.json / history.json beside data.json. */
	private async mergeLegacyFiles(data: WatchLogData): Promise<void> {
		if (data.migratedReadingHistory === true) return;
		const adapter = this.ctx.app.vault.adapter;
		const readJson = async (name: string): Promise<unknown> => {
			const path = normalizePath(`${this.dir()}/${name}`);
			return (await adapter.exists(path)) ? JSON.parse(await adapter.read(path)) as unknown : null;
		};
		const reading = await readJson('reading.json');
		const hasReading = (data.reading?.books?.length ?? 0) > 0 || (data.reading?.manga?.length ?? 0) > 0;
		if (isRecord(reading) && !hasReading) data.reading = reading as unknown as ReadingData;
		const history = await readJson('history.json');
		if (isRecord(history) && Array.isArray(history.entries) && !data.history?.length) {
			data.history = history.entries as HistoryEntry[];
		}
	}

	// Folders

	private holdsRoot(folder: string): boolean {
		const root = this.ctx.layout.root;
		return folder === '' || root === folder || root.startsWith(`${folder}/`);
	}

	private async centralizeFolders(data: WatchLogData): Promise<void> {
		const layout = this.ctx.layout;
		const reading = data.reading as ReadingData;
		const games = data.games as GamesData;
		const readingRoot = normalizePath(reading.settings.defaultFolder || 'WatchLog/Reading');
		const gamesFolder = normalizePath(games.settings.defaultFolder || 'WatchLog/Games');
		const lists = (data.settings as Record<string, unknown>).customListsFolder;
		const listsFolder = normalizePath(typeof lists === 'string' && lists ? lists : 'WatchLog/CustomLists');

		const legacyPaths = (folder: string, titles: string[], fallback: string): Set<string> =>
			new Set(titles.map((t) => normalizePath(`${folder}/${t.replace(UNSAFE, '-').trim() || fallback}.md`)));
		const books = normalizePath(`${readingRoot}/Books`);
		const manga = normalizePath(`${readingRoot}/Manga`);
		await this.moveFolder(books, layout.folderFor('book'), legacyPaths(books, reading.books.map((b) => b.title), 'book'));
		await this.moveFolder(manga, layout.folderFor('manga'), legacyPaths(manga, reading.manga.map((m) => m.title), 'manga'));
		await this.moveFolder(gamesFolder, layout.folderFor('game'), legacyPaths(gamesFolder, games.games.map((g) => g.title), 'game'));
		await this.moveFolder(listsFolder, layout.customListsFolder, 'lists');
		await this.pruneEmpty(readingRoot);
	}

	/**
	 * Moves the files of `from` into `to`; a file whose name exists there stays and is reported. Only
	 * the legacy notes move (for the custom lists: files with a `## Data` JSON block), foreign files stay.
	 */
	private async moveFolder(from: string, to: string, legacyNotes: Set<string> | 'lists'): Promise<void> {
		if (from === to) return;
		const { vault, fileManager } = this.ctx.app;
		const src = vault.getAbstractFileByPath(from);
		if (!(src instanceof TFolder)) return;
		const files: TFile[] = [];
		for (const c of src.children) {
			if (!(c instanceof TFile)) continue;
			const own = legacyNotes === 'lists'
				? c.extension === 'md' && CUSTOM_LIST_DATA.test(await vault.read(c))
				: legacyNotes.has(c.path);
			if (own) files.push(c);
		}
		let moved = false;
		for (const file of files) {
			const target = normalizePath(`${to}/${file.name}`);
			if (vault.getAbstractFileByPath(target)) {
				this.report.skipped.push(`${file.path}: ${target} already exists`);
				continue;
			}
			await this.ensureFolder(to);
			await fileManager.renameFile(file, target);
			moved = true;
		}
		if (moved) this.report.foldersMoved.push(`${from} → ${to}`);
		await this.pruneEmpty(from);
	}

	private async pruneEmpty(path: string): Promise<void> {
		const folder = this.ctx.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder) || folder.children.length > 0 || this.holdsRoot(path)) return;
		await this.ctx.app.fileManager.trashFile(folder);
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path || this.ctx.app.vault.getAbstractFileByPath(path)) return;
		try {
			await this.ctx.app.vault.createFolder(path);
		} catch {
			// created concurrently
		}
	}

	// Base

	/** Creates the base, or fills an empty `watchlog:` block; the store whitelists out every secret. */
	private async ensureBase(data: WatchLogData): Promise<void> {
		const { app, shared, layout } = this.ctx;
		const reading = data.reading as ReadingData;
		const initial: Record<string, unknown> = {
			...data.settings,
			reading: { ...reading.settings, bookColumns: reading.bookColumns, mangaColumns: reading.mangaColumns },
			games: (data.games as GamesData).settings,
		};
		await shared.load();
		if (!(app.vault.getAbstractFileByPath(layout.basePath) instanceof TFile)) {
			await this.ensureFolder(layout.root);
			await shared.createBase(initial);
		} else if (Object.keys(shared.get().settings).length === 0) {
			await shared.update(initial);
		}
	}

	// Entries

	/** A free note path for this run: legacy duplicates (same title and type) get " 2", " 3", … */
	private claim(path: string): string {
		let p = path;
		for (let n = 2; this.claimed.has(p); n++) p = `${path.slice(0, -3)} ${n}.md`;
		this.claimed.add(p);
		return p;
	}

	private async importEntries(data: WatchLogData): Promise<void> {
		const layout = this.ctx.layout;
		const reading = data.reading as ReadingData;
		const games = data.games as GamesData;

		const groupsOf = new Map<string, string[]>();
		const addGroup = (key: string, name: string): void => {
			const list = groupsOf.get(key) ?? [];
			if (!list.includes(name)) list.push(name);
			groupsOf.set(key, list);
		};
		for (const g of data.groups) {
			if (typeof g.name !== 'string' || !g.name) continue;
			this.ids.group.set(g.id, g.name);
			for (const id of g.titleIds ?? []) addGroup(`title:${id}`, g.name);
		}
		for (const g of games.groups) {
			if (typeof g.name !== 'string' || !g.name) continue;
			for (const id of g.gameIds ?? []) addGroup(`game:${id}`, g.name);
		}

		// 'once' entries are derived from releaseDate now (E1); only recurring schedules move into notes
		const airtime = new Map<string, EntryAirtime>();
		for (const e of data.airtime ?? []) {
			if (!e?.schedule || e.schedule.recurrence === 'once') continue;
			const kind = e.source === 'game' ? 'game' : e.source === 'reading' ? (e.readingKind ?? 'book') : 'title';
			airtime.set(`${kind}:${e.titleId}`, toEntryAirtime(e));
		}
		const extras = <T extends { groups?: string[]; airtime?: EntryAirtime }>(item: T, key: string): T => {
			if (this.joined) return item;
			const groups = groupsOf.get(key);
			if (groups) item.groups = groups;
			const a = airtime.get(key);
			if (a) item.airtime = a;
			return item;
		};

		for (const t of data.titles) {
			const path = this.claim(layout.notePath('title', t.title, t.type));
			const title = extras({ ...t, id: layout.idFromPath(path) }, `title:${t.id}`);
			this.ids.title.set(t.id, title.id);
			await this.writeTitle(path, title);
		}
		for (const m of data.maybe ?? []) {
			const path = layout.notePath('title', m.title, m.type);
			if (this.claimed.has(path)) {
				this.report.skipped.push(`maybe "${m.title}": already in the library`);
				continue;
			}
			this.claim(path);
			if (this.joined && this.ctx.app.vault.getAbstractFileByPath(path)) {
				this.report.skipped.push(`maybe "${m.title}": ${path} already exists`);
				continue;
			}
			const title = normalizeTitle({
				title: m.title, type: m.type, status: 'Plan to watch', priority: '', dateAdded: m.dateAdded,
				dateModified: m.dateAdded, totalEpisodes: m.totalEpisodes, episodeDuration: m.episodeDuration,
				releaseDate: m.releaseDate, externalLink: m.externalLink, maybe: true,
			});
			title.id = layout.idFromPath(path);
			this.ids.title.set(m.id, title.id);
			await this.writeTitle(path, title);
		}
		for (const b of reading.books) {
			const path = this.claim(layout.notePath('book', b.title));
			const id = layout.idFromPath(path);
			this.ids.book.set(b.id, id);
			const book = extras({ ...b, id, vaultPage: `${id}.md` }, `book:${b.id}`);
			await this.writeEntry(path, id, encodeBook(book), b.coverUrl, '## Notes\n\n\n## Quotes\n');
		}
		for (const m of reading.manga) {
			const path = this.claim(layout.notePath('manga', m.title));
			const id = layout.idFromPath(path);
			this.ids.manga.set(m.id, id);
			const manga = extras({ ...m, id, vaultPage: `${id}.md` }, `manga:${m.id}`);
			await this.writeEntry(path, id, encodeManga(manga), m.coverUrl, '## Notes\n\n\n## Quotes\n');
		}
		for (const g of games.games) {
			const path = this.claim(layout.notePath('game', g.title));
			const id = layout.idFromPath(path);
			this.ids.game.set(g.id, id);
			const game = extras({ ...g, id, vaultPage: `${id}.md` }, `game:${g.id}`);
			await this.writeEntry(path, id, encodeGame(game), g.coverUrl, '## Notes\n');
		}
	}

	/**
	 * Book, manga or game: the legacy cover goes to the cache (E9). On a second device only the cover
	 * the original plugin wrote is removed from an existing note; no note is created or filled.
	 */
	private async writeEntry(path: string, id: string, fm: Fm, coverUrl: string, body: string): Promise<void> {
		const legacy: Fm = coverUrl ? { coverUrl } : {};
		if (coverUrl) this.cache[id] = { coverUrl };
		if (!this.joined) await this.writeNote(path, fm, body, legacy);
		else if (this.ctx.app.vault.getAbstractFileByPath(path) instanceof TFile) await this.writeNote(path, {}, body, legacy);
	}

	private async writeTitle(path: string, title: WatchLogTitle): Promise<void> {
		// without an API identity nothing can refetch the seasons: they belong in the note
		const fetchable = !!title.tmdbId || !!title.malId || !!title.anilistId || externalIdFromLink(title.externalLink) !== null;
		if (!fetchable && title.seasons.length > 0) title.seasonsOverride = true;
		const fm = encodeTitle(title, progressOf(title));
		if (this.joined && !title.maybe) {
			// another device migrated: only progress for notes that exist, the cache for those
			if (!(this.ctx.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
				this.report.skipped.push(`${path}: no note, not recreated`);
				return;
			}
			for (const k of Object.keys(fm)) if (!JOINED_KEYS.includes(k)) delete fm[k];
		}
		const cache = splitCache(title);
		if (Object.keys(cache).length > 0) this.cache[title.id] = cache;
		await this.writeNote(path, fm, `## Notes\n\n${title.notes}\n`, legacyApiValues(title));
	}

	/**
	 * Creates the note, or adds only the keys it lacks; existing values are never overwritten. A key
	 * of `legacy` (API values the original plugin wrote) is removed when the note still holds exactly
	 * that value: it lives in the cache now, and a differing value stays as the user's override (E9).
	 */
	private async writeNote(path: string, fm: Fm, body: string, legacy: Fm = {}): Promise<void> {
		const { vault, fileManager } = this.ctx.app;
		const file = vault.getAbstractFileByPath(path);
		if (!file) {
			await this.ensureFolder(path.slice(0, Math.max(0, path.lastIndexOf('/'))));
			await vault.create(path, `---\n${this.ctx.yaml.stringify(fm)}---\n\n${body}`);
			this.report.notesCreated++;
			return;
		}
		if (!(file instanceof TFile)) {
			this.report.skipped.push(`${path}: not a file`);
			return;
		}
		let current: Fm;
		try {
			current = this.frontmatter(await vault.read(file));
		} catch {
			this.report.skipped.push(`${path}: frontmatter is not valid YAML`);
			return;
		}
		const written = (k: string): boolean => sameValue(current[k], legacy[k]) && !(k in fm && sameValue(current[k], fm[k]));
		const stale = Object.keys(legacy).filter((k) => k in current && written(k));
		const missing = Object.keys(fm).filter((k) => !(k in current) || stale.includes(k));
		if (missing.length === 0 && stale.length === 0) return;
		await fileManager.processFrontMatter(file, (raw: Fm) => {
			for (const k of stale) if (sameValue(raw[k], legacy[k])) delete raw[k];
			for (const k of missing) if (!(k in raw)) raw[k] = fm[k];
		});
		this.report.notesFilled++;
	}

	private frontmatter(content: string): Fm {
		const m = FM_RE.exec(content);
		if (!m) return {};
		const parsed = this.ctx.yaml.parse(m[1] ?? '');
		return isRecord(parsed) ? parsed : {};
	}

	// History

	/** Legacy history plus one `group-created` per group; events already in History.md are skipped. */
	private async importHistory(data: WatchLogData): Promise<void> {
		const { history } = this.ctx;
		const seen = new Set((await history.load()).map(historyKey));
		const candidates: HistoryEntry[] = [];
		for (const e of data.history ?? []) {
			if (!isRecord(e) || typeof e.message !== 'string') continue;
			const timestamp = isoOf(e.timestamp);
			if (timestamp) candidates.push({ ...e, timestamp });
		}
		const groupEvents = (groups: { id: string; name: string; dateAdded: string }[], source: HistoryEntry['source']): void => {
			for (const g of groups) {
				const timestamp = isoOf(g.dateAdded);
				if (!timestamp || !g.name) continue;
				candidates.push({ id: `group-${g.id}`, timestamp, message: `Group "${g.name}" was created`, source });
			}
		};
		groupEvents(data.groups, undefined);
		groupEvents((data.games as GamesData).groups, 'Games');
		const fresh = candidates
			.filter((e) => {
				const key = historyKey(e);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		await history.appendMany(fresh);
	}

	// data.json

	private localData(data: WatchLogData): LocalData {
		const settings: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data.settings)) {
			if (!SHARED_SETTING_KEYS.includes(k) && !REMOVED_SETTINGS.includes(k)) settings[k] = v;
		}
		// 'Wishlist' is a flag now; a stored exclude would linger as a filter without a checkbox
		const filters = settings.gamesFilters;
		if (isRecord(filters) && Array.isArray(filters.statusExclude)) {
			filters.statusExclude = (filters.statusExclude as unknown[]).filter((n) => n !== WISHLIST);
		}

		const translate = (map: Map<string, string>, ids: unknown): string[] =>
			(Array.isArray(ids) ? ids : []).flatMap((id) => {
				const next = typeof id === 'string' ? map.get(id) : undefined;
				return next === undefined ? [] : [next];
			});
		const daily = (rec: RecommendedDaily | undefined, map: Map<string, string>): RecommendedDaily | undefined =>
			isRecord(rec) ? { date: typeof rec.date === 'string' ? rec.date : '', ids: translate(map, rec.ids) } : undefined;

		const ui: LocalData['ui'] & { gamesRecommendedDaily?: RecommendedDaily } = {};
		if (typeof data.pinnedGroupId === 'string') ui.pinnedGroup = this.ids.group.get(data.pinnedGroupId) ?? null;
		if (data.savedFilterPreset !== undefined) ui.savedFilterPreset = data.savedFilterPreset;
		const recommended = daily(data.recommendedDaily, this.ids.title);
		if (recommended) ui.recommendedDaily = recommended;
		const gamesRecommended = daily(data.games?.recommendedDaily, this.ids.game);
		if (gamesRecommended) ui.gamesRecommendedDaily = gamesRecommended;
		const collapsed = (data as { collapsedSeasons?: unknown }).collapsedSeasons;
		if (isRecord(collapsed)) {
			const out: Record<string, number[]> = {};
			for (const [id, seasons] of Object.entries(collapsed)) {
				const next = this.ids.title.get(id);
				if (next !== undefined && Array.isArray(seasons)) out[next] = seasons as number[];
			}
			ui.collapsedSeasons = out;
		}

		const local: LocalData = { schemaVersion: 2, settings, cache: this.cache, ui };
		if (data.drafts) local.drafts = data.drafts;
		return local;
	}
}

// Legacy normalization

function isoOf(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Mirrors DataManager's schedule -> note mapping; the 'once' date lives in releaseDate. */
function toEntryAirtime(e: AirtimeEntry): EntryAirtime {
	const s = e.schedule;
	const a: EntryAirtime = { recurrence: s.recurrence };
	const day = s.recurrence === 'weekly' ? s.dayOfWeek : s.recurrence === 'monthly' ? s.dayOfMonth : undefined;
	if (day !== undefined) a.day = day;
	if (s.releaseTime) a.time = s.releaseTime;
	if (e.currentSeason !== undefined) a.season = e.currentSeason;
	if (e.currentEpisode !== undefined) a.episode = e.currentEpisode;
	if (e.lastAcknowledgedDate) a.acknowledged = e.lastAcknowledgedDate;
	return a;
}

/** API-derived keys the original plugin wrote into a title note, with the values it wrote. */
function legacyApiValues(t: WatchLogTitle): Fm {
	const out: Fm = {};
	if (t.communityRating !== undefined) out.communityRating = t.communityRating;
	if (t.communityVotes !== undefined) out.communityVotes = t.communityVotes;
	if (t.communitySource) out.communitySource = t.communitySource;
	for (const field of ['director', 'cast', 'studio'] as const) {
		const names = getTitleCredits(t, field);
		if (names.length > 0) out[field] = names;
	}
	const poster = getDisplayPoster(t);
	if (poster && poster !== 'none') out.poster = poster;
	const trailer = getDisplayTrailer(t);
	if (trailer) out.trailer = trailer;
	return out;
}

function progressOf(t: WatchLogTitle): number {
	const skipped = t.seasons.reduce((n, s) => n + (s.skippedEpisodes?.length ?? 0), 0);
	const effective = Math.max(0, t.totalEpisodes - skipped);
	return effective === 0 ? 0 : Math.min(100, Math.round((t.watchedEpisodes.length / effective) * 100));
}

function normalizeTitle(raw: Partial<WatchLogTitle>): WatchLogTitle {
	const t: WatchLogTitle = {
		id: '', title: '', type: 'TV Show', status: 'Plan to watch', priority: 'Medium', review: '', rating: 0,
		notes: '', dateStarted: null, dateFinished: null, dateAdded: '', dateModified: '', totalEpisodes: 0,
		episodeDuration: 0, releaseDate: null, externalLink: '', seasons: [], watchedEpisodes: [],
		...raw,
	};
	if (!Array.isArray(t.seasons)) t.seasons = [];
	if (!Array.isArray(t.watchedEpisodes)) t.watchedEpisodes = [];
	if (typeof t.notes !== 'string') t.notes = '';
	if (typeof t.externalLink !== 'string') t.externalLink = '';
	return t;
}

function readingStatus<T extends { status: ReadingStatus }>(item: T): T {
	if ((item.status as string) === ON_HOLD) item.status = 'Plan to Read';
	return item;
}

function normalizeReading(raw: ReadingData | undefined): ReadingData {
	const settings = { ...DEFAULT_READING_SETTINGS, ...(isRecord(raw?.settings) ? raw.settings : {}) };
	if ((settings.defaultStatus as string) === ON_HOLD) settings.defaultStatus = 'Plan to Read';
	const common = {
		author: '', status: 'Plan to Read' as ReadingStatus, rating: 0, chaptersRead: 0, totalChapters: 0,
		coverUrl: '', vaultPage: '', dateStarted: null, dateFinished: null, releaseDate: null, dateAdded: '',
		dateModified: '',
	};
	const bookDefaults = {
		...common, progressUnit: 'pages' as const, pagesRead: 0, totalPages: 0, wordsRead: 0, totalWords: 0, googleBooksId: '',
	};
	const mangaDefaults = { ...common, volumesRead: 0, totalVolumes: 0, malId: '' };
	const books = (Array.isArray(raw?.books) ? raw.books : []).map((b): Book => readingStatus({
		...bookDefaults, ...b, customFields: isRecord(b.customFields) ? b.customFields : {},
	}));
	const manga = (Array.isArray(raw?.manga) ? raw.manga : []).map((m): Manga => readingStatus({
		...mangaDefaults, ...m, customFields: isRecord(m.customFields) ? m.customFields : {},
	}));
	return {
		books,
		manga,
		bookColumns: Array.isArray(raw?.bookColumns) ? raw.bookColumns : [],
		mangaColumns: Array.isArray(raw?.mangaColumns) ? raw.mangaColumns : [],
		settings,
	};
}

/** Applies GameDataManager's former load-time migration: platform strings, the retired Wishlist status, playtime. */
function normalizeGames(raw: GamesData | undefined): GamesData {
	const defaults = defaultGamesSettings();
	const s: GamesSettings = { ...defaults, ...(isRecord(raw?.settings) ? raw.settings : {}) };
	if (!Array.isArray(s.statuses) || s.statuses.length === 0) s.statuses = defaults.statuses;
	if (!Array.isArray(s.types) || s.types.length === 0) s.types = defaults.types;
	s.platforms = Array.isArray(s.platforms)
		? (s.platforms as unknown[]).map((p): TagDefinition => typeof p === 'string'
			? { name: p, color: defaults.platforms.find((d) => d.name === p)?.color ?? '#888780' }
			: p as TagDefinition)
		: defaults.platforms;
	const wishlistIdx = s.statuses.findIndex((st) => st.name === WISHLIST);
	if (wishlistIdx !== -1) {
		if (s.statuses.some((st) => st.name === GAME_TBA_STATUS)) s.statuses.splice(wishlistIdx, 1);
		else s.statuses[wishlistIdx] = { name: GAME_TBA_STATUS, color: '#EAB308' };
	}
	if (s.defaultStatus === WISHLIST) s.defaultStatus = 'Not started';
	if (s.savedFilterPreset) {
		s.savedFilterPreset = {
			...s.savedFilterPreset,
			statusExclude: (s.savedFilterPreset.statusExclude ?? []).filter((n) => n !== WISHLIST),
		};
	}
	const unwished = s.defaultStatus || 'Not started';
	const gameDefaults = {
		developer: '', publisher: '', type: '', status: unwished, priority: '', favorite: false, wishlist: false,
		rating: 0, progress: 0, playtimeMinutes: 0, achievementsEarned: 0, achievementsTotal: 0,
		singleplayer: false, coop: false, multiplayer: false, coverUrl: '', apiId: '', steamAppId: '',
		lastPlayed: null, storeUrl: '', externalLink: '', vaultPage: '', releaseDate: null, dateStarted: null,
		dateFinished: null, dateAdded: '', dateModified: '',
	};

	const games = (Array.isArray(raw?.games) ? raw.games : []).map((src): Game => {
		const legacy = src as Game & { playtime?: unknown };
		const { playtime, ...rest } = legacy;
		const g: Game = {
			...gameDefaults,
			...rest,
			platforms: Array.isArray(rest.platforms) ? rest.platforms : [],
			apiSource: rest.apiSource === 'rawg' || rest.apiSource === 'igdb' ? rest.apiSource : '',
		};
		if (typeof legacy.playtimeMinutes !== 'number') {
			g.playtimeMinutes = typeof playtime === 'string' ? parsePlaytimeInput(playtime) : 0;
		}
		if (g.status === WISHLIST) {
			g.wishlist = true;
			g.status = unwished;
		}
		return g;
	});
	return {
		games,
		groups: Array.isArray(raw?.groups) ? raw.groups : [],
		settings: s,
		recommendedDaily: raw?.recommendedDaily,
	};
}

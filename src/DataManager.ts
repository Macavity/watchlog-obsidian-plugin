import { App, Notice, TAbstractFile, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DraftPersistState, Season, WatchLogTitle, WatchLogGroup, AirtimeEntry, AirtimeSchedule, EntryAirtime, MaybeTitle, RecommendedDaily, SavedFilterPreset, Book, Manga, Game } from './types';
import type { HistoryManager } from './HistoryManager';
import { formatHistoryDate } from './HistoryManager';
import { pruneManualCredits, normalizeManualCredits, isReleaseDateFuture, todayIso, GAME_AUTO_STATUS } from './types';
import type { CreditsField } from './types';
import type { AnyEntry, EntryIndex } from './storage/EntryIndex';
import { getBaseline, sameStoredState, setBaseline } from './storage/baseline';
import type { ApiOutcome } from './ApiService';
import { ApiCheckQueue } from './apiCheckQueue';
import type { LocalStore } from './storage/LocalStore';
import type { ApiCheckResult, EntryCache } from './storage/storageTypes';
import type { SharedConfigStore } from './storage/SharedConfigStore';
import type { VaultLayout } from './storage/VaultLayout';
import { TITLE_CACHE_KEYS, decodeTitle, encodeTitle, isMovie, seasonsPending, splitCache } from './storage/titleCodec';
import { externalIdFromLink } from './storage/externalId';
import { decodeBook, decodeManga, encodeAirtime } from './storage/readingCodec';
import { decodeGame } from './storage/gameCodec';

export interface DataStores {
	index: EntryIndex;
	local: LocalStore;
	shared: SharedConfigStore;
	layout: () => VaultLayout;
}

const AIRTIME_KEYS: readonly string[] = [
	'airtimeRecurrence', 'airtimeDay', 'airtimeTime', 'airtimeSeason', 'airtimeEpisode', 'airtimeAcknowledged',
];

/** Every frontmatter key encodeTitle can emit (plus the older manual*Url names); the full rewrite deletes the ones it omits. */
const TITLE_KEYS: readonly string[] = [
	'title', 'type', 'status', 'priority', 'review', 'rating', 'progress', 'totalEpisodes', 'episodeDuration',
	'dateStarted', 'dateFinished', 'dateAdded', 'dateModified', 'releaseDate', 'malId', 'anilistId',
	'communityRating', 'communityVotes', 'communitySource', 'director', 'cast', 'studio', 'poster', 'trailer',
	'externalLink', 'pinned', 'favorite', 'dateFavorited', 'externalId', 'groups', 'maybe', 'watched', 'skipped',
	'seasons', 'manualPosterUrl', 'manualTrailerUrl', 'manualDirector', 'manualCast', 'manualStudio',
	...AIRTIME_KEYS,
];

function isLegacyCachedPoster(url: string | undefined): boolean {
	return !!url && url !== 'none';
}

/** The note-side schedule of an Upcoming entry; the 'once' date lives in the note's releaseDate. */
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

function scheduleOf(a: EntryAirtime, releaseDate: string | null): AirtimeSchedule {
	const s: AirtimeSchedule = { recurrence: a.recurrence };
	if (a.recurrence === 'once' && releaseDate) s.releaseDate = releaseDate;
	if (a.time) s.releaseTime = a.time;
	if (a.day !== undefined && a.recurrence === 'weekly') s.dayOfWeek = a.day;
	if (a.day !== undefined && a.recurrence === 'monthly') s.dayOfMonth = a.day;
	return s;
}

const NOTES_RE = /(^|\n)## Notes[ \t]*\r?\n([\s\S]*?)(?=\n## |\n# |$)/;

/** Minimum gap between two API refreshes of a title's airing pointer, unless forced. */
/** Retry deadline per outcome of a background API check; a missing key waits until a key changes. */
const API_CHECK_TTL_MS = { ok: 6 * 3_600_000, transient: 3_600_000, notfound: 7 * 24 * 3_600_000 };
type ApiCheckKind = 'airing' | 'seasons';

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `## Notes` body of a note; null when the section is absent. */
function extractNotes(content: string): string | null {
	const match = content.match(NOTES_RE);
	if (!match) return null;
	// strip the template's leading blank line and trailing whitespace, keep internal breaks
	return (match[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * Replaces the `## Notes` body, preserving the heading, every other section, the frontmatter and
 * any prose outside it. Appends the heading when missing (never duplicated). The boundary matches
 * extractNotes, so read-then-write round-trips cleanly.
 */
function replaceNotesSection(existing: string, notesBody: string): string {
	const headingMatch = existing.match(/(^|\n)## Notes[ \t]*\r?\n/);
	if (!headingMatch || headingMatch.index === undefined) {
		const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
		return `${existing}${sep}\n## Notes\n\n${notesBody}\n`;
	}
	const bodyStart = headingMatch.index + headingMatch[0].length;
	const after = existing.slice(bodyStart);
	const nextHeading = after.match(/\n(?:## |# )/);
	const bodyEnd =
		nextHeading && nextHeading.index !== undefined
			? bodyStart + nextHeading.index
			: existing.length;
	const before = existing.slice(0, bodyStart);
	const rest = existing.slice(bodyEnd);
	return `${before}\n${notesBody}\n${rest}`;
}

/**
 * Watchlist titles, backed by one note per title. Reads come from the EntryIndex (frontmatter) plus
 * the LocalStore cache; writes go to the note via processFrontMatter and only touch what changed.
 */
export class DataManager {
	private plugin: WatchLogPlugin;
	private app: App;
	private index: EntryIndex;
	private local: LocalStore;
	private shared: SharedConfigStore;
	private layout: () => VaultLayout;
	private changeListeners: Array<() => void> = [];
	private historyManager: HistoryManager | null = null;

	// Mutable copies handed to the UI, one per id. `src` is the index entry the copy was made from:
	// it is the default baseline a write diffs against; a copy carries its own (see storage/baseline.ts),
	// so a stale or spread copy cannot revert a field changed elsewhere in between.
	private views: Map<string, { src: WatchLogTitle; view: WatchLogTitle }> = new Map();
	// `## Notes` body per id as last read from / written to the note
	private notes: Map<string, string> = new Map();
	// titles changed via updateTitleSilent, written on the next save()
	private dirty: Set<string> = new Set();
	// ids already handed to the poster queue this session
	private posterRequested: Set<string> = new Set();
	// background API checks (airing, seasons) share one throttled queue; results persist in the cache
	private apiQueue = new ApiCheckQueue();
	private seasonsInFlight: Set<string> = new Set();
	private seasonsRunning = 0;
	private seasonsChanged = false;
	/** Titles whose "API key needed" notice was shown this session. */
	private noKeyNoticeShown: Set<string> = new Set();

	// debounced save for high-frequency edits (rapid episode clicks): memory now, note coalesced
	private pendingSaveTimer: number | null = null;
	private pendingMdTitleIds: Set<string> = new Set();
	private readonly EPISODE_SAVE_DEBOUNCE_MS = 500;

	// debounced batched poster saves: memory now, data.json ~every 5s
	private posterSaveTimer: number | null = null;
	private readonly POSTER_SAVE_DEBOUNCE_MS = 5000;

	private airingInFlight: Set<string> = new Set();

	setHistoryManager(hm: HistoryManager): void {
		this.historyManager = hm;
	}

	constructor(plugin: WatchLogPlugin, stores: DataStores) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.index = stores.index;
		this.local = stores.local;
		this.shared = stores.shared;
		this.layout = stores.layout;
	}

	getLayout(): VaultLayout {
		return this.layout();
	}

	/** After index.build(): reads note bodies and follows index/vault changes. */
	async init(): Promise<void> {
		await Promise.all(this.index.titles().map((t) => this.readNotes(t.id)));
		this.index.onChange((ids) => {
			const changed = [...ids].map((id) => this.getTitle(id)).filter((t): t is WatchLogTitle => !!t);
			this.queueMissingPosters(changed);
			this.queueMissingSeasons(changed);
			this.notifyListeners();
		});
		const { vault } = this.app;
		this.plugin.registerEvent(vault.on('modify', (f) => void this.refreshNotes(f)));
		this.plugin.registerEvent(vault.on('create', (f) => void this.refreshNotes(f)));
		this.plugin.registerEvent(vault.on('rename', (f, oldPath) => this.onVaultRename(f, oldPath)));
		this.queueMissingPosters(this.getTitles());
		this.queueMissingSeasons(this.getTitles());
		this.notifyListeners();
	}

	/**
	 * Hands titles with an API identity but no cached poster (a fresh device, a note from elsewhere)
	 * to the poster queue, once per id and session.
	 */
	private queueMissingPosters(titles: WatchLogTitle[]): void {
		const service = this.plugin.posterService;
		if (!service) return;
		for (const t of titles) {
			if (t.maybe || this.posterRequested.has(t.id)) continue;
			// a cached URL is legacy (posters live in the note): queue it so the note gets it
			if (t.posterUrl && !isLegacyCachedPoster(this.local.getCache(t.id)?.posterUrl)) continue;
			const identified = !!t.tmdbId || !!t.malId || !!t.anilistId || externalIdFromLink(t.externalLink) !== null;
			if (!identified) continue;
			this.posterRequested.add(t.id);
			void service.enqueue(t);
		}
	}

	/**
	 * Seasons not known yet: an API identity, no seasons in note or cache, not a movie (a fresh device,
	 * a note from elsewhere), and the fetch has not found nothing or lacked a key (those use an implicit
	 * S01). Episode toggles wait for the refill.
	 */
	private seasonsPending(t: WatchLogTitle): boolean {
		return seasonsPending(t, this.local.getCache(t.id)?.apiCheck?.seasons?.result);
	}

	/** Seasons not known for a series with an API identity, whatever the last fetch returned. */
	private seasonsMissing(t: WatchLogTitle): boolean {
		return seasonsPending(t, undefined);
	}

	/** Queues a season fetch for titles that lack seasons and whose last check is past its deadline. */
	private queueMissingSeasons(titles: WatchLogTitle[]): void {
		if (!this.plugin.apiService) return;
		for (const t of titles) {
			if (t.maybe || this.seasonsInFlight.has(t.id) || !this.seasonsMissing(t) || !this.apiCheckDue(t.id, 'seasons', false)) continue;
			void this.refillSeasons(t);
		}
	}

	/**
	 * Stores fetched seasons in the cache only (no note write); the notes are re-decoded once the queue is
	 * idle, also after "not found" or "no key" (the implicit S01 applies then).
	 */
	private async refillSeasons(t: WatchLogTitle): Promise<void> {
		this.seasonsInFlight.add(t.id);
		this.seasonsRunning++;
		try {
			let outcome: ApiOutcome<Season[]> = { status: 'transient' };
			try {
				outcome = await this.apiQueue.enqueue(() => this.plugin.apiService.fetchSeasons(t));
			} catch {
				// stays pending until the deadline
			}
			if (!this.index.get(t.id)) return;
			const seasons = outcome.status === 'ok' ? outcome.value.map((x) => ({ name: x.name, episodes: x.episodes, offset: x.offset })) : [];
			const filled = seasons.length > 0;
			const result = outcome.status === 'ok' && !filled ? 'notfound' : outcome.status;
			this.recordApiCheck(t.id, 'seasons', result, filled ? { seasons } : {});
			if (result !== 'transient') this.seasonsChanged = true;
		} finally {
			this.seasonsInFlight.delete(t.id);
			// decoding happens in the index; a rebuild picks up the new cache and emits the changed ids
			if (--this.seasonsRunning === 0 && this.seasonsChanged) {
				this.seasonsChanged = false;
				await this.index.rebuild();
			}
		}
	}

	/** True when the last check of this kind is past its deadline (never checked, or forced). */
	private apiCheckDue(id: string, kind: ApiCheckKind, force: boolean): boolean {
		if (force) return true;
		const cache = this.local.getCache(id);
		const check = cache?.apiCheck?.[kind];
		if (!check) {
			const legacy = kind === 'airing' ? Date.parse(cache?.airing?.refreshedAt ?? '') : NaN;
			return isNaN(legacy) || Date.now() - legacy >= API_CHECK_TTL_MS.ok;
		}
		if (check.result === 'nokey') return false;
		const at = Date.parse(check.at);
		return isNaN(at) || Date.now() - at >= API_CHECK_TTL_MS[check.result];
	}

	private recordApiCheck(id: string, kind: ApiCheckKind, result: ApiCheckResult, patch: Partial<EntryCache> = {}): void {
		const apiCheck = { ...this.local.getCache(id)?.apiCheck, [kind]: { at: new Date().toISOString(), result } };
		this.local.setCache(id, { ...patch, apiCheck });
	}

	/** An API key changed: checks that failed for want of a key may run again. */
	resetNoKeyChecks(): void {
		let changed = false;
		for (const entry of Object.values(this.local.data.cache)) {
			for (const kind of ['airing', 'seasons'] as const) {
				if (entry.apiCheck?.[kind]?.result !== 'nokey') continue;
				delete entry.apiCheck[kind];
				changed = true;
			}
		}
		if (!changed) return;
		this.noKeyNoticeShown.clear();
		this.local.queueSave();
		this.queueMissingSeasons(this.index.titles());
	}

	/**
	 * True (and a notice) when an episode toggle must wait for the season refill. Without an API key the
	 * toggle goes on the implicit S01, with a one-time hint.
	 */
	private blockedBySeasonRefill(t: WatchLogTitle): boolean {
		if (!this.seasonsPending(t)) {
			const noKey = this.local.getCache(t.id)?.apiCheck?.seasons?.result === 'nokey';
			if (noKey && this.seasonsMissing(t) && !this.noKeyNoticeShown.has(t.id)) {
				this.noKeyNoticeShown.add(t.id);
				new Notice('API key needed to load episodes');
			}
			return false;
		}
		new Notice(`Episodes of "${t.title}" are still loading.`);
		this.queueMissingSeasons([t]);
		return true;
	}

	// Rows-view daily recommendations

	getRecommendedDaily(): RecommendedDaily {
		return this.local.data.ui.recommendedDaily ?? { date: '', ids: [] };
	}

	/**
	 * Silent daily-recommendation save — no listener notify; the Rows view that rolled the picks
	 * renders them itself.
	 */
	setRecommendedDaily(rec: RecommendedDaily): void {
		this.local.data.ui.recommendedDaily = rec;
		this.local.queueSave();
	}

	/**
	 * Silent poster update, no notify — the card that triggered the fetch updates its own <img>.
	 * A URL goes into the note's `poster` field, but only when it is empty (E12), unless `overwrite`
	 * (the explicit refresh). 'none' (nothing found) is a cache marker for a title without a poster.
	 */
	async updatePosterUrl(titleId: string, url: string, overwrite = false): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		const hasPoster = !!title.posterUrl && title.posterUrl !== 'none';
		if (url === 'none') {
			if (hasPoster) return;
			title.posterUrl = url;
			this.local.data.cache[titleId] = { ...this.local.getCache(titleId), posterUrl: url };
			this.schedulePosterSave();
			return;
		}
		if (!url || (hasPoster && !overwrite && !isLegacyCachedPoster(this.local.getCache(titleId)?.posterUrl))) return;
		if (this.dirty.has(titleId) || this.pendingMdTitleIds.has(titleId)) {
			// the pending write carries it
			title.posterUrl = url;
			return;
		}
		const file = this.fileOf(titleId);
		if (!file) return;
		await this.processFrontMatter(file, title, (raw) => {
			const own = [raw.poster, raw.manualPosterUrl].find((v): v is string => typeof v === 'string' && v.trim() !== '');
			if (own && !overwrite) {
				title.posterUrl = own;
				return;
			}
			raw.poster = url;
			delete raw.manualPosterUrl;
			title.posterUrl = url;
		}, !overwrite);
		const cached = this.local.getCache(titleId);
		if (isLegacyCachedPoster(cached?.posterUrl)) {
			const rest = { ...cached };
			delete rest.posterUrl;
			this.local.data.cache[titleId] = rest;
			this.local.queueSave();
		}
	}

	/** Silent TMDB id + collection cache. tmdbId null = not a movie, keep the verdict only. */
	updateTmdbIdentity(id: string, tmdbId: number | null, collectionId: number): void {
		const title = this.getTitle(id);
		if (!title) return;
		const nextTmdbId = tmdbId ?? title.tmdbId;
		if (title.tmdbId === nextTmdbId && title.collectionId === collectionId) return;
		// only ever a movie id here — the collections lookup rejects everything else
		if (nextTmdbId !== undefined) {
			title.tmdbId = nextTmdbId;
			title.tmdbMediaType = 'movie';
		}
		title.collectionId = collectionId;
		this.syncCache(title);
	}

	/** Silent community-rating update: memory + cache, no notify. The caller refreshes its own UI. */
	updateCommunityRating(
		id: string,
		rating: number,
		votes: number,
		source: '' | 'imdb' | 'mal' | 'anilist' | 'tmdb',
	): void {
		const title = this.getTitle(id);
		if (!title) return;
		title.communityRating = rating;
		title.communityVotes = votes;
		title.communitySource = source;
		title.communityRatingLastFetched = new Date().toISOString();
		this.syncCache(title);
	}

	/**
	 * Silent trailer URL update (manual refresh): memory + cache, no notify — the caller re-renders
	 * its own row.
	 */
	updateTrailerUrl(titleId: string, url: string): void {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.trailerUrl = url;
		this.syncCache(title);
	}

	/**
	 * Persists a director/cast backfill to the cache only: API values never reach the note (E9), and
	 * a background backfill is no user edit (no dateModified stamp). User-added credits stay as they
	 * are; the merged view drops names the fetch now returns.
	 */
	async updateCredits(titleId: string, director: string[], cast: string[]): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.director = director;
		title.cast = cast;
		this.syncCache(title);
		this.notifyListeners();
	}

	/** Studio backfill; cache only, like updateCredits. Caches the TMDB id it resolved. */
	async updateStudio(
		titleId: string,
		studio: string[],
		tmdbId?: number,
		tmdbMediaType?: 'movie' | 'tv',
	): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.studio = studio;
		if (tmdbId && tmdbMediaType) {
			title.tmdbId = tmdbId;
			title.tmdbMediaType = tmdbMediaType;
		}
		this.syncCache(title);
		this.notifyListeners();
	}

	/**
	 * Replaces one field's user-added credits (the add modal commits additions and removals in one
	 * call). Uncapped by design — the API cap trims a fetched cast, not user input. Like
	 * updateCredits: no dateModified stamp.
	 */
	async updateManualCredits(titleId: string, field: CreditsField, names: string[]): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		const fetched =
			(field === 'director' ? title.director : field === 'cast' ? title.cast : title.studio) ?? [];
		const cleaned = pruneManualCredits(normalizeManualCredits(names), fetched);
		if (field === 'director') title.manualDirector = cleaned;
		else if (field === 'cast') title.manualCast = cleaned;
		else title.manualStudio = cleaned;
		await this.writeTitle(title);
		this.notifyListeners();
	}

	/**
	 * Silent favorite toggle: note only, no notify — the detail modal updates its own button and
	 * flags the change for the on-close refresh. No dateModified stamp.
	 */
	async setFavorite(id: string, favorite: boolean): Promise<void> {
		const title = this.getTitle(id);
		if (!title) return;
		title.favorite = favorite;
		// stamp drives the Favorites shelf order (newest first); cleared on unfavorite
		if (favorite) title.dateFavorited = new Date().toISOString();
		else delete title.dateFavorited;
		await this.writeTitle(title);
	}

	private schedulePosterSave(): void {
		if (this.posterSaveTimer !== null) return;
		this.posterSaveTimer = window.setTimeout(() => {
			this.posterSaveTimer = null;
			this.local.queueSave();
		}, this.POSTER_SAVE_DEBOUNCE_MS);
	}

	/** Flush a pending debounced poster save now (e.g. on plugin unload). */
	flushPosterSave(): void {
		if (this.posterSaveTimer !== null) {
			window.clearTimeout(this.posterSaveTimer);
			this.posterSaveTimer = null;
			this.local.queueSave();
		}
	}

	/** Flush a pending poster save during plugin unload. */
	flushPosterSaveSync(): void {
		this.flushPosterSave();
		void this.local.flush();
	}

	/** Drafts-tab state (device-local). */
	getDrafts(): Partial<DraftPersistState> | undefined {
		return this.local.data.drafts;
	}

	setDrafts(state: DraftPersistState): void {
		this.local.data.drafts = state;
		this.local.queueSave();
	}

	/** Shared settings of the base file; never holds API keys. */
	getSharedSettings(): Record<string, unknown> {
		return structuredClone(this.shared.get().settings);
	}

	/** Backup restore: writes the shared settings into the base file. */
	async restoreSharedSettings(settings: Record<string, unknown>): Promise<void> {
		await this.shared.update(settings);
	}

	/** Centralized debounced save for cross-cutting paths (settings, drafts, lists). */
	queueSave(): void {
		this.local.queueSave();
	}

	flushQueuedSaveSync(): void {
		void this.local.flush();
	}

	/** Writes data.json now. Reading, games and history route their saves through here. */
	async persist(): Promise<void> {
		this.local.queueSave();
		await this.local.flush();
	}

	/**
	 * Writes titles changed via updateTitleSilent (and pending episode toggles), syncs in-memory API
	 * data to the cache, then notifies.
	 */
	async save(): Promise<void> {
		// an immediate save supersedes any pending debounced one
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
			this.pendingSaveTimer = null;
		}
		await this.writePending();
		// a copy from before a change underneath (season refill, external edit) holds outdated API data
		for (const { view } of this.views.values()) if (this.basedOnStored(view)) this.syncCache(view);
		this.notifyListeners();
	}

	/**
	 * Schedule a debounced silent note write (no notify, no re-render). Later calls reset the timer;
	 * callers own any targeted DOM updates.
	 */
	scheduleEpisodeSave(titleIdForMd: string): void {
		this.pendingMdTitleIds.add(titleIdForMd);
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
		}
		this.pendingSaveTimer = window.setTimeout(() => {
			void this.flushPendingSave();
		}, this.EPISODE_SAVE_DEBOUNCE_MS);
	}

	/** Flush a pending debounced save now (e.g. on view close / plugin unload). */
	async flushPendingSave(): Promise<void> {
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
			this.pendingSaveTimer = null;
		}
		await this.writePending();
	}

	/** Writes the titles with pending silent or episode edits. */
	private async writePending(): Promise<void> {
		const ids = new Set([...this.dirty, ...this.pendingMdTitleIds]);
		this.dirty.clear();
		this.pendingMdTitleIds.clear();
		for (const id of ids) {
			const t = this.getTitle(id);
			if (t) await this.writeTitle(t);
			else new Notice(`An edit of "${id}" was not saved: its note can no longer be read.`);
		}
	}

	/** Starts a pending episode write during plugin unload (cannot be awaited there). */
	flushPendingSaveSync(): void {
		void this.flushPendingSave();
	}

	// Reads

	/** Mutable copy of an index entry; stable per id until the note changes underneath. */
	private viewOf(src: WatchLogTitle): WatchLogTitle {
		const slot = this.views.get(src.id);
		if (slot && slot.src === src) return slot.view;
		// a pending silent edit keeps its copy until written
		if (slot && (this.dirty.has(src.id) || this.pendingMdTitleIds.has(src.id))) return slot.view;
		const view = structuredClone(src);
		view.notes = this.notes.get(src.id) ?? '';
		// nothing cached yet: '' (not undefined) lets the lazy poster fetch pick it up
		if (view.posterUrl === undefined) view.posterUrl = '';
		this.views.set(src.id, { src, view });
		setBaseline(view, src);
		return view;
	}

	/** Library titles; Maybe notes are listed by getMaybeTitles. */
	getTitles(): WatchLogTitle[] {
		return this.index.titles().filter((t) => !t.maybe).map((t) => this.viewOf(t));
	}

	getTitle(id: string): WatchLogTitle | undefined {
		const e = this.index.get(id);
		return e?.kind === 'title' ? this.viewOf(e.entry) : undefined;
	}

	async addTitle(title: WatchLogTitle): Promise<void> {
		// a fresh title needs posterUrl '' (not undefined) so the Cards needs-poster gate enqueues an
		// auto-fetch on first render
		if (title.posterUrl === undefined) title.posterUrl = '';
		if (title.trailerUrl === undefined) title.trailerUrl = '';
		if (title.manualTrailerUrl === undefined) title.manualTrailerUrl = '';
		// a future release date makes it "To be released", which puts it in Upcoming
		if (this.canAutoAddToUpcoming(title)) title.status = 'To be released';
		await this.insertNote(title);
		this.notifyListeners();
		const now = new Date().toISOString();
		void this.historyManager?.log(
			`${title.title} (${title.type}) was added on ${formatHistoryDate(now)}`,
			{ source: 'Watchlist', action: 'added', titleName: title.title, titleId: title.id },
		);
	}

	/** Add without re-rendering. Caller must call notifyChange() after the batch. */
	async addTitleSilent(title: WatchLogTitle): Promise<void> {
		if (this.canAutoAddToUpcoming(title)) title.status = 'To be released';
		await this.insertNote(title);
	}

	/**
	 * Creates the title's note, or takes over a Maybe note at the same path: same note, `maybe`
	 * dropped, fields from `title`; its `## Notes` survive when `title` brings none.
	 */
	private async insertNote(title: WatchLogTitle): Promise<void> {
		const layout = this.layout();
		const id = layout.idFromPath(layout.notePath('title', title.title, title.type));
		const maybe = this.index.get(id);
		if (maybe?.kind !== 'title' || !maybe.entry.maybe) {
			await this.createNote(title);
			return;
		}
		title.id = id;
		delete title.maybe;
		if (!title.notes) title.notes = this.notes.get(id) ?? '';
		this.views.set(id, { src: maybe.entry, view: title });
		setBaseline(title, maybe.entry);
		await this.writeTitle(title);
	}

	/** Batch-add: one note per title; ids are rewritten to the created note paths. */
	async addTitleBatch(titles: WatchLogTitle[]): Promise<void> {
		for (const title of titles) {
			await this.addTitleSilent(title);
		}
	}

	/** Batch-update via mutator. Single notify; notes updated. */
	async batchUpdate(ids: string[], mutator: (t: WatchLogTitle) => void): Promise<void> {
		let updated = 0;
		for (const id of ids) {
			const t = this.getTitle(id);
			if (!t) continue;
			mutator(t);
			t.dateModified = new Date().toISOString();
			await this.writeTitle(t);
			updated++;
		}
		if (updated > 0) this.notifyListeners();
	}

	/** Remove multiple titles in one batch: single notify, notes trashed in chunks of 10. */
	async removeTitlesBatch(ids: string[]): Promise<void> {
		const CHUNK_SIZE = 10;
		for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
			const chunk = ids.slice(i, i + CHUNK_SIZE);
			await Promise.all(chunk.map((id) => this.deleteNote(id)));
		}
		this.notifyListeners();
	}

	canAutoAddToUpcoming(title: WatchLogTitle): boolean {
		if (!title.releaseDate) return false;
		// only auto-add with a full YYYY-MM-DD date
		if (!/^\d{4}-\d{2}-\d{2}$/.test(title.releaseDate)) return false;
		const release = new Date(title.releaseDate + 'T12:00:00');
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return release > today;
	}

	/** Upcoming is derived from "To be released" + releaseDate (see getAirtimeEntries): nothing to add. */
	async autoAddToUpcoming(_title: WatchLogTitle): Promise<void> {}

	/**
	 * Reconciles the auto "To be released" status with a release-date edit; Upcoming follows from it.
	 * A future full date forces the status; a past or cleared date reverts a "To be released" title
	 * to "Plan to watch" and drops its manual schedule.
	 *
	 * Call after `releaseDate` has been written and persisted.
	 */
	async applyReleaseDateChange(title: WatchLogTitle): Promise<void> {
		const releaseDate = title.releaseDate;
		const isFullDate = !!releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate);
		if (isFullDate && isReleaseDateFuture(releaseDate)) {
			if (title.status !== 'To be released') {
				title.status = 'To be released';
				await this.updateTitle(title);
			}
		} else if ((isFullDate || !releaseDate) && title.status === 'To be released') {
			// date is past/today or cleared — the auto status no longer applies
			title.status = 'Plan to watch';
			delete title.airtime;
			await this.updateTitle(title);
		}
	}

	/** Drops a title's manual Upcoming schedule (e.g. when the date goes past). */
	async removeAirtimeEntriesForTitle(titleId: string): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title?.airtime) return;
		delete title.airtime;
		await this.writeTitle(title);
		this.notifyListeners();
	}

	// Reading / Games → Upcoming bridge. Their schedules live on their own notes; a future release
	// date shows up on its own, so the auto-add calls are no-ops.

	async autoAddReadingToUpcoming(_item: Book | Manga, _kind: 'book' | 'manga'): Promise<void> {}

	/** Drops a reading item's manual schedule (release date gone past, or item deleted). */
	async removeReadingAirtimeEntries(itemId: string): Promise<void> {
		await this.removeNoteAirtime(itemId);
	}

	generateReadingAirtimeId(itemId: string): string {
		return `airtime-reading-${itemId}`;
	}

	async autoAddGameToUpcoming(_game: Game): Promise<void> {}

	/** Drops a game's manual schedule (release date gone past, or game deleted). */
	async removeGameAirtimeEntries(gameId: string): Promise<void> {
		await this.removeNoteAirtime(gameId);
	}

	generateGameAirtimeId(gameId: string): string {
		return `airtime-game-${gameId}`;
	}

	private async removeNoteAirtime(id: string): Promise<void> {
		const e = this.index.get(id);
		if (!e?.entry.airtime) return;
		if (e.kind === 'title') await this.removeAirtimeEntriesForTitle(id);
		else if (await this.writeAirtime(e, undefined, null)) this.notifyListeners();
	}

	/** Logs rating / completion changes against the stored state. */
	private logChanges(updated: WatchLogTitle): void {
		const old = this.baselineOf(updated);
		if (!old) return;
		const now = new Date().toISOString();
		if (old.rating !== updated.rating) {
			void this.historyManager?.log(
				`${updated.title} (${updated.type}) was reviewed on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'rating', titleName: updated.title, titleId: updated.id },
			);
		}
		if (old.status !== updated.status && updated.status === 'Completed') {
			void this.historyManager?.log(
				`${updated.title} (${updated.type}) was marked as watched on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'completed', titleName: updated.title, titleId: updated.id },
			);
		}
	}

	async updateTitle(updated: WatchLogTitle): Promise<void> {
		if (!this.getTitle(updated.id)) return;
		updated.dateModified = new Date().toISOString();
		if (updated.status === 'Completed') {
			updated.priority = '';
		}
		this.logChanges(updated);
		this.dirty.delete(updated.id);
		await this.writeTitle(updated);
		this.notifyListeners();
	}

	/**
	 * Update without writing or notifying. Caller must save() once after the batch (or write the note
	 * itself via updateMarkdownFile).
	 */
	updateTitleSilent(updated: WatchLogTitle): void {
		const slot = this.views.get(updated.id);
		if (!slot) return;
		updated.dateModified = new Date().toISOString();
		if (updated.status === 'Completed') {
			updated.priority = '';
		}
		this.logChanges(updated);
		const base = this.baselineOf(updated);
		if (base) setBaseline(updated, base);
		slot.view = updated;
		this.dirty.add(updated.id);
	}

	async removeTitle(id: string): Promise<void> {
		const title = this.getTitle(id);
		if (title) {
			const now = new Date().toISOString();
			void this.historyManager?.log(
				`${title.title} (${title.type}) was deleted on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'deleted', titleName: title.title, titleId: title.id },
			);
		}
		await this.deleteNote(id);
		this.notifyListeners();
	}

	// Groups: derived from the titles' `groups` property; a group's id is its name

	getGroups(): WatchLogGroup[] {
		const byName = new Map<string, WatchLogGroup>();
		for (const t of this.index.titles()) {
			if (t.maybe) continue;
			for (const name of t.groups ?? []) {
				let g = byName.get(name);
				if (!g) {
					g = { id: name, name, titleIds: [], dateAdded: t.dateAdded };
					byName.set(name, g);
				}
				g.titleIds.push(t.id);
				// a group is as old as its oldest member
				if (t.dateAdded && (!g.dateAdded || t.dateAdded < g.dateAdded)) g.dateAdded = t.dateAdded;
			}
		}
		return [...byName.values()].sort((a, b) => a.dateAdded.localeCompare(b.dateAdded) || a.name.localeCompare(b.name));
	}

	getGroup(id: string): WatchLogGroup | undefined {
		return this.getGroups().find((g) => g.id === id);
	}

	/** Writes the group name onto its members. A group without members only leaves a history line. */
	async addGroup(group: WatchLogGroup): Promise<void> {
		if (!this.getGroup(group.name)) {
			void this.historyManager?.log(`Group "${group.name}" was created`, { source: 'Watchlist' });
		}
		group.id = group.name;
		for (const id of group.titleIds) {
			await this.setTitleGroups(id, (names) => [...names, group.name]);
		}
		this.notifyListeners();
	}

	/** Applies a rename (new `name`, same `id`) and membership changes to the members' `groups`. */
	async updateGroup(updated: WatchLogGroup): Promise<void> {
		const old = this.getGroup(updated.id);
		if (!old) return;
		const keep = new Set(updated.titleIds);
		for (const id of new Set([...old.titleIds, ...updated.titleIds])) {
			await this.setTitleGroups(id, (names) => {
				const i = names.indexOf(old.name);
				const rest = names.filter((n) => n !== old.name);
				if (!keep.has(id)) return rest;
				rest.splice(i < 0 ? rest.length : i, 0, updated.name);
				return rest;
			});
		}
		if (old.name !== updated.name && this.local.data.ui.pinnedGroup === old.id) {
			this.local.data.ui.pinnedGroup = updated.name;
			this.local.queueSave();
		}
		this.notifyListeners();
	}

	async removeGroup(id: string): Promise<void> {
		const group = this.getGroup(id);
		if (!group) return;
		for (const titleId of group.titleIds) {
			await this.setTitleGroups(titleId, (names) => names.filter((n) => n !== group.name));
		}
		this.notifyListeners();
	}

	async addTitleToGroup(groupId: string, titleId: string): Promise<void> {
		await this.setTitleGroups(titleId, (names) => [...names, groupId]);
		this.notifyListeners();
	}

	/** Rewrites one title's `groups` (deduplicated); no dateModified stamp, like the other backfills. */
	private async setTitleGroups(id: string, fn: (names: string[]) => string[]): Promise<void> {
		const title = this.getTitle(id);
		if (!title) return;
		const before = title.groups ?? [];
		const next = [...new Set(fn([...before]))];
		if (sameJson(before, next)) return;
		if (next.length > 0) title.groups = next;
		else delete title.groups;
		await this.writeTitle(title);
	}

	getGroupedTitleIds(): Set<string> {
		const ids = new Set<string>();
		for (const group of this.getGroups()) {
			for (const id of group.titleIds) {
				ids.add(id);
			}
		}
		return ids;
	}

	/** A group's id is its name; an existing name joins that group. */
	generateGroupId(name: string): string {
		return name.trim();
	}

	// Pinned group (device-local UI state)

	getPinnedGroupId(): string | null {
		return this.local.data.ui.pinnedGroup ?? null;
	}

	async setPinnedGroupId(id: string | null): Promise<void> {
		this.local.data.ui.pinnedGroup = id;
		await this.persist();
		this.notifyListeners();
	}

	// Saved filter preset (device-local UI state)

	getSavedFilterPreset(): SavedFilterPreset | null {
		return this.local.data.ui.savedFilterPreset ?? null;
	}

	async setSavedFilterPreset(preset: SavedFilterPreset | null): Promise<void> {
		this.local.data.ui.savedFilterPreset = preset;
		await this.persist();
		this.notifyListeners();
	}

	// Upcoming: manual schedules from the notes' airtime keys, plus a derived 'once' entry for every
	// "To be released" entry with a release date. One entry per note, with a stable id.

	getAirtimeEntries(): AirtimeEntry[] {
		const out: AirtimeEntry[] = [];
		for (const t of this.index.titles()) {
			if (t.maybe) continue;
			const e = this.airtimeEntryOf({ kind: 'title', entry: t });
			if (e) out.push(e);
		}
		for (const kind of ['book', 'manga', 'game'] as const) {
			const list = kind === 'book' ? this.index.books() : kind === 'manga' ? this.index.manga() : this.index.games();
			for (const entry of list) {
				const e = this.airtimeEntryOf({ kind, entry } as AnyEntry);
				if (e) out.push(e);
			}
		}
		return out;
	}

	private airtimeEntryOf(e: AnyEntry): AirtimeEntry | null {
		const item = e.entry;
		const base: AirtimeEntry =
			e.kind === 'title'
				? { id: this.generateAirtimeId(item.id), titleId: item.id, schedule: { recurrence: 'once' }, dateAdded: item.dateAdded }
				: e.kind === 'game'
					? { id: this.generateGameAirtimeId(item.id), titleId: item.id, source: 'game', schedule: { recurrence: 'once' }, dateAdded: item.dateAdded }
					: { id: this.generateReadingAirtimeId(item.id), titleId: item.id, source: 'reading', readingKind: e.kind, schedule: { recurrence: 'once' }, dateAdded: item.dateAdded };
		const a = item.airtime;
		if (a) {
			base.schedule = scheduleOf(a, item.releaseDate);
			if (a.season !== undefined) base.currentSeason = a.season;
			if (a.episode !== undefined) base.currentEpisode = a.episode;
			if (a.acknowledged) base.lastAcknowledgedDate = a.acknowledged;
			// the API pointer wins over the note's: a tick only acknowledges it
			const airing = this.airingOf(e);
			if (airing?.nextEpisode !== undefined) {
				base.currentEpisode = airing.nextEpisode;
				if (airing.nextSeason !== undefined) base.currentSeason = airing.nextSeason;
			}
			return base;
		}
		if (!this.isAwaitingRelease(e) || !item.releaseDate) return null;
		base.schedule.releaseDate = item.releaseDate;
		return base;
	}

	/**
	 * "To be released" with a release date. Reading and Games force that status while the date is
	 * in the future, so a future date counts there even before the status is written.
	 */
	private isAwaitingRelease(e: AnyEntry): boolean {
		const { status, releaseDate } = e.entry;
		if (!releaseDate) return false;
		if (e.kind === 'title') return status === 'To be released';
		const auto = e.kind === 'game' ? GAME_AUTO_STATUS : 'To be released';
		return status === auto || isReleaseDateFuture(releaseDate);
	}

	/** Cached API airing data of a recurring watch schedule; other entries have none. */
	private airingOf(e: AnyEntry): EntryCache['airing'] | undefined {
		if (e.kind !== 'title' || !e.entry.airtime || e.entry.airtime.recurrence === 'once') return undefined;
		return this.local.getCache(e.entry.id)?.airing;
	}

	/** True when the entry's episode pointer comes from the API cache instead of the note. */
	isAiringTracked(entry: AirtimeEntry): boolean {
		const e = this.index.get(entry.titleId);
		return !!e && this.airingOf(e)?.nextEpisode !== undefined;
	}

	/**
	 * Tick on an aired unit: records the acknowledgement so the countdown resets. Without an API
	 * pointer it also advances the note's unit; with one, the API moves the pointer.
	 */
	async tickAirtimeEntry(entry: AirtimeEntry, date: string): Promise<void> {
		const e = this.index.get(entry.titleId);
		if (e?.entry.airtime && this.isAiringTracked(entry)) {
			if (await this.writeAirtime(e, { ...e.entry.airtime, acknowledged: date }, null)) this.notifyListeners();
			return;
		}
		await this.updateAirtimeEntry({ ...entry, currentEpisode: (entry.currentEpisode ?? 1) + 1, lastAcknowledgedDate: date });
	}

	/**
	 * Reloads the airing pointer of a title from its API into the cache through the shared queue.
	 * The persisted last check (apiCheck.airing) sets the deadline; `force` skips only that. Never writes the note.
	 */
	async refreshAiring(id: string, force = false): Promise<void> {
		const e = this.index.get(id);
		if (e?.kind !== 'title' || this.airingInFlight.has(id) || !this.apiCheckDue(id, 'airing', force)) return;
		this.airingInFlight.add(id);
		try {
			const outcome = await this.apiQueue.enqueue(() => this.plugin.apiService.fetchAiring(e.entry));
			if (this.index.get(id)?.kind !== 'title') return;
			this.recordApiCheck(id, 'airing', outcome.status, outcome.status === 'ok' ? { airing: outcome.value } : {});
			if (outcome.status === 'ok') this.notifyListeners();
		} catch (err) {
			console.warn(`WatchLog: could not refresh airing data of ${id}`, err);
		} finally {
			this.airingInFlight.delete(id);
		}
	}

	/** True when removing this entry clears the item's release date: only the derived card does. */
	removeClearsReleaseDate(entry: AirtimeEntry): boolean {
		const e = this.index.get(entry.titleId);
		return !!e && !e.entry.airtime && this.isAwaitingRelease(e);
	}

	async addAirtimeEntry(entry: AirtimeEntry): Promise<void> {
		await this.updateAirtimeEntry(entry);
	}

	/** Writes the entry's schedule to its note; a 'once' date goes to the note's releaseDate. */
	async updateAirtimeEntry(updated: AirtimeEntry): Promise<void> {
		const e = this.index.get(updated.titleId);
		if (!e) return;
		const releaseDate = updated.schedule.recurrence === 'once' ? updated.schedule.releaseDate ?? null : null;
		if (await this.writeAirtime(e, toEntryAirtime(updated), releaseDate)) this.notifyListeners();
	}

	async removeAirtimeEntry(id: string): Promise<void> {
		await this.removeAirtimeEntriesBatch([id]);
	}

	/**
	 * Removes what the card shows: a manual schedule drops only its airtime keys (the release date
	 * stays, so a "To be released" item falls back to its derived premiere card); a derived card
	 * clears the release date, and the status follows from the usual release-date rules.
	 */
	async removeAirtimeEntriesBatch(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const remove = new Set(ids);
		for (const entry of this.getAirtimeEntries().filter((x) => remove.has(x.id))) {
			const e = this.index.get(entry.titleId);
			if (!e) continue;
			if (e.entry.airtime) {
				await this.writeAirtime(e, undefined, null);
			} else if (e.kind === 'title') {
				const title = this.getTitle(e.entry.id);
				if (!title) continue;
				title.releaseDate = null;
				await this.writeTitle(title);
				await this.applyReleaseDateChange(title);
			} else {
				await this.clearReleaseDate(e);
			}
		}
		this.notifyListeners();
	}

	/** Reading / game release date removal through their managers (history, release-status rules). */
	private async clearReleaseDate(e: AnyEntry): Promise<void> {
		if (e.kind === 'book' || e.kind === 'manga') {
			const rdm = this.plugin.readingDataManager;
			const item = e.kind === 'book' ? rdm?.getBook(e.entry.id) : rdm?.getManga(e.entry.id);
			if (!rdm || !item) return;
			item.releaseDate = null;
			if (e.kind === 'book') await rdm.updateBook(item as Book);
			else await rdm.updateManga(item as Manga);
		} else if (e.kind === 'game') {
			const gdm = this.plugin.gameDataManager;
			const game = gdm?.getGame(e.entry.id);
			if (!gdm || !game) return;
			game.releaseDate = null;
			await gdm.updateGame(game);
		}
	}

	/**
	 * Sets (or with undefined removes) the airtime keys of an entry's note, plus the 'once' release
	 * date when given. Titles go through writeTitle; other notes get just these keys.
	 */
	private async writeAirtime(e: AnyEntry, airtime: EntryAirtime | undefined, releaseDate: string | null): Promise<boolean> {
		if (e.kind === 'title') {
			const title = this.getTitle(e.entry.id);
			if (!title) return false;
			if (airtime) title.airtime = airtime;
			else delete title.airtime;
			if (releaseDate) title.releaseDate = releaseDate;
			await this.writeTitle(title);
			return true;
		}
		const file = this.fileOf(e.entry.id);
		if (!file) return false;
		const id = e.entry.id;
		const kind = e.kind;
		try {
			await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => {
				for (const key of AIRTIME_KEYS) delete raw[key];
				encodeAirtime(airtime, raw);
				if (releaseDate) raw.releaseDate = releaseDate;
				const fm = { ...raw };
				this.index.applyLocal(
					kind === 'game'
						? { kind, entry: decodeGame(id, fm).entry }
						: kind === 'book'
							? { kind, entry: decodeBook(id, fm).entry }
							: { kind, entry: decodeManga(id, fm).entry },
				);
			});
			return true;
		} catch (err) {
			console.warn(`WatchLog: could not update frontmatter of ${file.path}`, err);
			new Notice(`Could not update "${file.basename}": its frontmatter is not valid YAML.`);
			return false;
		}
	}

	// Maybe: title notes flagged `maybe: true`, kept out of getTitles()

	getMaybeTitles(): MaybeTitle[] {
		return this.index.titles()
			.filter((t) => t.maybe)
			.map((t) => ({
				id: t.id,
				title: t.title,
				type: t.type,
				releaseDate: t.releaseDate,
				externalLink: t.externalLink,
				totalEpisodes: t.totalEpisodes,
				episodeDuration: t.episodeDuration,
				dateAdded: t.dateAdded,
			}));
	}

	/** Creates the Maybe note; `title.id` is rewritten to its path. */
	async addMaybeTitle(title: MaybeTitle): Promise<void> {
		const note: WatchLogTitle = {
			id: title.id,
			title: title.title,
			type: title.type,
			status: 'Plan to watch',
			priority: '',
			review: '',
			rating: 0,
			notes: '',
			dateStarted: null,
			dateFinished: null,
			dateAdded: title.dateAdded,
			dateModified: title.dateAdded,
			totalEpisodes: title.totalEpisodes,
			episodeDuration: title.episodeDuration,
			releaseDate: title.releaseDate,
			externalLink: title.externalLink,
			seasons: [],
			watchedEpisodes: [],
			maybe: true,
		};
		await this.createNote(note);
		title.id = note.id;
		this.notifyListeners();
	}

	async removeMaybeTitle(id: string): Promise<void> {
		const e = this.index.get(id);
		if (e?.kind !== 'title' || !e.entry.maybe) return;
		await this.deleteNote(id);
		this.notifyListeners();
	}

	/** Provisional id; the note path replaces it in addMaybeTitle. */
	generateMaybeId(titleName: string): string {
		return 'maybe-' + titleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	generateAirtimeId(titleId: string): string {
		return `airtime-${titleId}`;
	}

	// Time calculations

	calcTimeWatched(title: WatchLogTitle): number {
		if (title.episodeDuration <= 0) return 0;
		// "To be released" titles haven't been watched yet
		if (title.status === 'To be released') return 0;
		if (title.type === 'Movie') {
			return title.watchedEpisodes.includes(1) ? title.episodeDuration : 0;
		}
		if (title.status === 'Completed') {
			return this.getEffectiveTotal(title) * title.episodeDuration;
		}
		return title.watchedEpisodes.length * title.episodeDuration;
	}

	calcTimeRemaining(title: WatchLogTitle): number {
		if (title.episodeDuration <= 0) return 0;
		if (title.status === 'Dropped') return 0;
		// "To be released" doesn't count toward time remaining — not yet available
		if (title.status === 'To be released') return 0;
		if (title.type === 'Movie') {
			return title.watchedEpisodes.includes(1) ? 0 : title.episodeDuration;
		}
		const effective = this.getEffectiveTotal(title);
		if (title.status === 'Plan to watch') {
			return Math.max(0, effective - title.watchedEpisodes.length) * title.episodeDuration;
		}
		if (title.status === 'Watching') {
			return Math.max(0, effective - title.watchedEpisodes.length) * title.episodeDuration;
		}
		return 0;
	}

	calcTimeRemainingForModal(title: WatchLogTitle): number {
		if (title.episodeDuration <= 0) return 0;
		if (title.status === 'To be released') return 0;
		if (title.type === 'Movie') {
			return title.watchedEpisodes.includes(1) ? 0 : title.episodeDuration;
		}
		const effective = this.getEffectiveTotal(title);
		if (title.status === 'Dropped') {
			return Math.max(0, effective - title.watchedEpisodes.length) * title.episodeDuration;
		}
		if (title.status === 'Plan to watch') {
			return Math.max(0, effective - title.watchedEpisodes.length) * title.episodeDuration;
		}
		if (title.status === 'Watching') {
			return Math.max(0, effective - title.watchedEpisodes.length) * title.episodeDuration;
		}
		return 0;
	}

	getTotalTimeWatched(): number {
		return this.getTitles().reduce((sum, t) => sum + this.calcTimeWatched(t), 0);
	}

	getTotalTimeRemaining(): number {
		return this.getTitles().reduce((sum, t) => sum + this.calcTimeRemaining(t), 0);
	}

	// Listeners

	onChange(listener: () => void): void {
		this.changeListeners.push(listener);
	}

	offChange(listener: () => void): void {
		this.changeListeners = this.changeListeners.filter((l) => l !== listener);
	}

	/** Public trigger for external callers (e.g. CsvModal) that need to force a UI refresh. */
	notifyChange(): void {
		this.notifyListeners();
	}

	private notifyListeners(): void {
		for (const listener of this.changeListeners) {
			listener();
		}
		activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
	}

	// Season collapse persistence (device-local UI state)

	getCollapsedSeasonsForTitle(titleId: string): Set<number> {
		return new Set<number>(this.local.data.ui.collapsedSeasons?.[titleId] ?? []);
	}

	async persistCollapsedSeasons(titleId: string, seasons: Set<number>): Promise<void> {
		const ui = this.local.data.ui;
		ui.collapsedSeasons = { ...ui.collapsedSeasons, [titleId]: Array.from(seasons) };
		await this.persist();
		this.notifyListeners();
	}

	// Skip helpers

	getTotalSkippedCount(title: WatchLogTitle): number {
		return title.seasons.reduce((sum, s) => sum + (s.skippedEpisodes?.length ?? 0), 0);
	}

	/** totalEpisodes minus all season-defined skipped episodes. */
	getEffectiveTotal(title: WatchLogTitle): number {
		return Math.max(0, title.totalEpisodes - this.getTotalSkippedCount(title));
	}

	/** True when absoluteEpNum falls in any season's skippedEpisodes list. */
	isEpisodeSkipped(title: WatchLogTitle, absoluteEpNum: number): boolean {
		for (const season of title.seasons) {
			const rel = absoluteEpNum - season.offset;
			if (rel >= 1 && rel <= season.episodes && (season.skippedEpisodes ?? []).includes(rel)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * In-memory toggle of an episode's watched state plus auto-complete. Schedules a debounced save
	 * and does NOT notify — the caller owns targeted DOM updates. Returns the mutated title.
	 */
	applyEpisodeWatchedToggle(
		id: string,
		episodeNumber: number,
		watched: boolean,
	): WatchLogTitle | null {
		const title = this.getTitle(id);
		if (!title || this.blockedBySeasonRefill(title)) return null;

		if (watched) {
			if (!title.watchedEpisodes.includes(episodeNumber)) {
				title.watchedEpisodes.push(episodeNumber);
				title.watchedEpisodes.sort((a, b) => a - b);
			}
			const now = new Date().toISOString();
			if (title.totalEpisodes > 1) {
				void this.historyManager?.log(
					`${title.title} (${title.type}) episode ${episodeNumber} was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title, titleId: title.id },
				);
			} else {
				void this.historyManager?.log(
					`${title.title} (${title.type}) was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title, titleId: title.id },
				);
			}
		} else {
			title.watchedEpisodes = title.watchedEpisodes.filter((e) => e !== episodeNumber);
		}

		title.dateModified = new Date().toISOString();
		this.applyAutoCompleteRules(title);
		this.scheduleEpisodeSave(id);
		return title;
	}

	/** Shared auto-complete / un-complete rules. Mutates title in place. */
	private applyAutoCompleteRules(title: WatchLogTitle): void {
		const effectiveTotal = this.getEffectiveTotal(title);
		if (
			this.plugin.settings.autoCompleteOnLastEpisode &&
			effectiveTotal > 0 &&
			title.watchedEpisodes.length >= effectiveTotal
		) {
			if (title.status !== 'Completed') {
				title.status = 'Completed';
				// match updateTitle(): completed titles drop priority
				title.priority = '';
			}
			if (this.plugin.settings.setFinishDateAutomatically && !title.dateFinished) {
				title.dateFinished = todayIso();
			}
		} else if (title.status === 'Completed' && title.watchedEpisodes.length < effectiveTotal) {
			title.status = 'Watching';
			title.dateFinished = null;
		}
	}

	// Progress helpers

	getProgress(title: WatchLogTitle): number {
		const effective = this.getEffectiveTotal(title);
		if (effective === 0) return 0;
		return Math.min(100, Math.round((title.watchedEpisodes.length / effective) * 100));
	}

	getNextUnwatchedEpisode(title: WatchLogTitle): number | null {
		const watched = new Set(title.watchedEpisodes);
		for (let i = 1; i <= title.totalEpisodes; i++) {
			if (!watched.has(i)) return i;
		}
		return null;
	}

	async markEpisodeWatched(id: string, episodeNumber: number, watched: boolean): Promise<void> {
		const title = this.getTitle(id);
		if (!title || this.blockedBySeasonRefill(title)) return;

		if (watched) {
			if (!title.watchedEpisodes.includes(episodeNumber)) {
				title.watchedEpisodes.push(episodeNumber);
				title.watchedEpisodes.sort((a, b) => a - b);
			}
			const now = new Date().toISOString();
			if (title.totalEpisodes > 1) {
				void this.historyManager?.log(
					`${title.title} (${title.type}) episode ${episodeNumber} was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title, titleId: title.id },
				);
			} else {
				void this.historyManager?.log(
					`${title.title} (${title.type}) was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title, titleId: title.id },
				);
			}
		} else {
			title.watchedEpisodes = title.watchedEpisodes.filter((e) => e !== episodeNumber);
		}

		const effectiveTotal = this.getEffectiveTotal(title);
		if (
			this.plugin.settings.autoCompleteOnLastEpisode &&
			effectiveTotal > 0 &&
			title.watchedEpisodes.length >= effectiveTotal
		) {
			title.status = 'Completed';
			if (this.plugin.settings.setFinishDateAutomatically && !title.dateFinished) {
				title.dateFinished = todayIso();
			}
		} else if (title.status === 'Completed' && title.watchedEpisodes.length < effectiveTotal) {
			title.status = 'Watching';
			title.dateFinished = null;
		}

		await this.updateTitle(title);
	}

	async markSeasonWatched(
		id: string,
		episodeNumbers: number[],
		watched: boolean,
		seasonLabel?: string,
	): Promise<void> {
		const title = this.getTitle(id);
		if (!title || this.blockedBySeasonRefill(title)) return;

		// capture season completion BEFORE the tick, to detect a not-complete → complete transition
		const before = new Set(title.watchedEpisodes);
		const wasComplete = episodeNumbers.length > 0 && episodeNumbers.every((ep) => before.has(ep));

		if (watched) {
			const set = new Set(title.watchedEpisodes);
			for (const ep of episodeNumbers) set.add(ep);
			title.watchedEpisodes = Array.from(set).sort((a, b) => a - b);
		} else {
			const remove = new Set(episodeNumbers);
			title.watchedEpisodes = title.watchedEpisodes.filter((e) => !remove.has(e));
		}

		// "tick entire season" emits ONE history entry, and only when the action makes the season newly
		// complete — not when clearing, already complete, or without a season label
		if (watched && seasonLabel) {
			const after = new Set(title.watchedEpisodes);
			const nowComplete = episodeNumbers.length > 0 && episodeNumbers.every((ep) => after.has(ep));
			if (!wasComplete && nowComplete) {
				const now = new Date().toISOString();
				void this.historyManager?.log(
					`${title.title} (${title.type}) ${seasonLabel} was fully watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title, titleId: title.id },
				);
			}
		}

		const effectiveTotal = this.getEffectiveTotal(title);
		if (
			this.plugin.settings.autoCompleteOnLastEpisode &&
			effectiveTotal > 0 &&
			title.watchedEpisodes.length >= effectiveTotal
		) {
			title.status = 'Completed';
			if (this.plugin.settings.setFinishDateAutomatically && !title.dateFinished) {
				title.dateFinished = todayIso();
			}
		} else if (title.status === 'Completed' && title.watchedEpisodes.length < effectiveTotal) {
			title.status = 'Watching';
			title.dateFinished = null;
		}

		await this.updateTitle(title);
	}

	// Folder management

	async ensureFolders(): Promise<void> {
		if (!this.plugin.settings.autoCreateFolders) return;
		const layout = this.layout();
		if (layout.root) await this.ensureFolder(layout.root);
		for (const type of this.plugin.settings.types) {
			await this.ensureFolder(layout.folderFor('title', type.name));
		}
	}

	async ensureFolder(path: string): Promise<void> {
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

	/** Path of the title's note: its id below the root. */
	getNoteFilePath(title: WatchLogTitle): string {
		return this.layout().pathFromId(title.id);
	}

	/** Writes the title's note (creates it when missing). */
	async updateMarkdownFile(title: WatchLogTitle): Promise<void> {
		await this.writeTitle(title);
	}

	/** Reads the `## Notes` body back from a title note. null when the file or section is absent. */
	async readNotesFromFile(title: WatchLogTitle): Promise<string | null> {
		const file = this.fileOf(title.id);
		if (!file) return null;
		const notes = extractNotes(await this.app.vault.read(file));
		this.notes.set(title.id, notes ?? '');
		return notes;
	}

	async createMarkdownFileIfMissing(title: WatchLogTitle): Promise<boolean> {
		if (this.fileOf(title.id)) return false;
		await this.createNote(title);
		return true;
	}

	/**
	 * Rewrites every plugin-owned frontmatter key of an existing title note, body verbatim. Keys the
	 * encoder omits are removed, except progress text kept while seasons are unknown and fields the
	 * decoder could not read. API overrides in the note are encoded, so they stay. Does NOT create the
	 * file — returns false then. Powers the bulk "Rewrite all frontmatter" action.
	 */
	async rewriteFrontmatterIfExists(title: WatchLogTitle): Promise<boolean> {
		const file = this.fileOf(title.id);
		if (!file) return false;
		const out = encodeTitle(title, this.getProgress(title), this.seasonsPending(title));
		const keep = new Set(this.index.invalidFields(title.id));
		if (!('watched' in out)) {
			keep.add('watched');
			keep.add('skipped');
			// derived from the unreadable watched text: 0% would be wrong
			if (!isMovie(title.seasons, title.totalEpisodes)) keep.add('progress');
		}
		return this.processFrontMatter(file, title, (raw) => {
			for (const key of TITLE_KEYS) {
				if (key in out) {
					if (!keep.has(key) || !(key in raw)) raw[key] = out[key];
				} else if (!keep.has(key)) {
					delete raw[key];
				}
			}
		});
	}

	// Note I/O

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

	/**
	 * processFrontMatter, then the optimistic index update for `t` — inside the callback, so it lands
	 * before the write's `changed` event can be seen. False (and a notice) on unreadable YAML.
	 * `background` marks an automatic fill (no user write).
	 */
	private async processFrontMatter(
		file: TFile,
		t: WatchLogTitle,
		fn: (fm: Record<string, unknown>) => void,
		background = false,
	): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fn(fm);
				this.afterWrite(t, { ...fm }, background);
			});
			return true;
		} catch (e) {
			console.warn(`WatchLog: could not update frontmatter of ${file.path}`, e);
			new Notice(`Could not update "${file.basename}": its frontmatter is not valid YAML.`);
			return false;
		}
	}

	/** Creates the note for a new title; the title's id becomes the note path. */
	private async createNote(title: WatchLogTitle): Promise<void> {
		const layout = this.layout();
		// without an API identity nothing can refetch the seasons: they belong in the note
		const fetchable = !!title.tmdbId || !!title.malId || !!title.anilistId
			|| externalIdFromLink(title.externalLink) !== null;
		if (!fetchable && title.seasons.length > 0) title.seasonsOverride = true;
		const path = this.freePath(layout.notePath('title', title.title, title.type));
		await this.ensureFolder(this.parentOf(path));
		const fm = encodeTitle(title, this.getProgress(title), this.seasonsPending(title));
		const notes = title.notes ?? '';
		title.id = layout.idFromPath(path);
		this.notes.set(title.id, notes);
		// index first, so the create event finds nothing new
		this.afterWrite(title, fm);
		try {
			await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n## Notes\n\n${notes}\n`);
		} catch (e) {
			this.index.removeLocal(title.id);
			this.views.delete(title.id);
			throw e;
		}
	}

	/**
	 * Writes a title to its note: renames the file on a title/type change, then sets only the
	 * frontmatter keys whose encoded value differs from the stored state (so unreadable or foreign
	 * fields stay untouched unless this edit changes exactly that field), and the `## Notes` body when
	 * it changed.
	 */
	private async writeTitle(t: WatchLogTitle): Promise<void> {
		let file = this.fileOf(t.id);
		if (!file) {
			await this.createNote(t);
			return;
		}
		const src = this.baselineOf(t);

		if (src && (t.title !== src.title || t.type !== src.type)) {
			const target = this.layout().notePath('title', t.title, t.type);
			if (target !== file.path) {
				if (this.app.vault.getAbstractFileByPath(target)) {
					new Notice(`"${target}" already exists; the note keeps its old file name.`);
				} else {
					await this.ensureFolder(this.parentOf(target));
					await this.app.fileManager.renameFile(file, target);
					this.moveId(t.id, this.layout().idFromPath(target));
					t.id = this.layout().idFromPath(target);
					file = this.fileOf(t.id) ?? file;
				}
			}
		}

		// edited seasons belong in the note, so they reach other devices (the cache stays per device)
		const seasonList = (x: WatchLogTitle): string[] => x.seasons.map((s) => `${s.name}: ${s.episodes}`);
		if (src && t.seasons.length > 0 && !sameJson(seasonList(src), seasonList(t))) t.seasonsOverride = true;
		const pending = this.seasonsPending(t);
		const before = src ? encodeTitle(src, this.getProgress(src), pending) : {};
		const after = encodeTitle(t, this.getProgress(t), pending);
		const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((k) => !sameJson(before[k], after[k]));
		if (changed.length > 0) {
			const ok = await this.processFrontMatter(file, t, (raw) => {
				for (const key of changed) {
					if (key in after) raw[key] = after[key];
					else delete raw[key];
				}
			});
			if (!ok) return;
			// a stale copy (not taken as the view) holds what the note holds for every field it knows
			if (this.views.get(t.id)?.view !== t) setBaseline(t, structuredClone(t));
		} else if (this.basedOnStored(t)) {
			// nothing for the note; API data may still have changed
			this.syncCache(t);
			const slot = this.views.get(t.id);
			if (slot) slot.view = t;
		}

		const notes = t.notes;
		if (typeof notes === 'string' && notes !== (this.notes.get(t.id) ?? '')) {
			// set first: the modify event of this write then sees no change
			this.notes.set(t.id, notes);
			await this.app.vault.process(file, (content) => replaceNotesSection(content, notes));
		}
	}

	/** Stored state a copy was made from; falls back to the current slot or index entry. */
	private baselineOf(t: WatchLogTitle): WatchLogTitle | undefined {
		const known = getBaseline(t) ?? this.views.get(t.id)?.src;
		if (known) return known;
		const indexed = this.index.get(t.id);
		return indexed?.kind === 'title' ? indexed.entry : undefined;
	}

	/** True when `t` was made from the stored state of its note (or nothing is stored yet). */
	private basedOnStored(t: WatchLogTitle): boolean {
		const current = this.index.get(t.id);
		if (current?.kind !== 'title') return true;
		const base = getBaseline(t) ?? this.views.get(t.id)?.src;
		return !!base && sameStoredState(base, current.entry);
	}

	/**
	 * Cache + optimistic index update after an own write. `t` becomes the UI's copy only when it was
	 * made from the stored state; a stale copy's fields and API data would hide what changed in between,
	 * so the next read builds a fresh copy instead.
	 */
	private afterWrite(t: WatchLogTitle, fm: Record<string, unknown>, background = false): void {
		const fresh = this.basedOnStored(t);
		if (fresh) this.syncCache(t);
		const stored = decodeTitle(t.id, fm, this.local.getCache(t.id)).entry;
		this.index.applyLocal({ kind: 'title', entry: stored }, { background });
		if (!fresh) return;
		this.views.set(t.id, { src: stored, view: t });
		setBaseline(t, stored);
	}

	/**
	 * Stores the title's API-derived fields in data.json when they changed. Merges into the entry:
	 * what is no title field (apiCheck, airing) and refilled seasons the title does not carry stay.
	 */
	private syncCache(t: WatchLogTitle): void {
		const prev = this.local.getCache(t.id) ?? {};
		const next: EntryCache = { ...prev };
		for (const key of TITLE_CACHE_KEYS) delete next[key];
		Object.assign(next, splitCache(t));
		if (!next.seasons && prev.seasons) next.seasons = prev.seasons;
		// a legacy cached poster stays until the note holds the URL
		if (isLegacyCachedPoster(prev.posterUrl) && prev.posterUrl === t.posterUrl) next.posterUrl = prev.posterUrl;
		if (sameJson(next, prev)) return;
		this.local.data.cache[t.id] = next;
		this.local.queueSave();
	}

	private async deleteNote(id: string): Promise<void> {
		const file = this.fileOf(id);
		if (file) await this.app.fileManager.trashFile(file);
		this.index.removeLocal(id);
		this.local.deleteCache(id);
		this.views.delete(id);
		this.notes.delete(id);
		this.dirty.delete(id);
		this.pendingMdTitleIds.delete(id);
		const collapsed = this.local.data.ui.collapsedSeasons;
		if (collapsed) delete collapsed[id];
		this.local.queueSave();
	}

	/** Re-keys everything held per id after a rename. */
	private moveId(from: string, to: string): void {
		if (from === to) return;
		this.local.renameCache(from, to);
		this.index.removeLocal(from);
		const notes = this.notes.get(from);
		if (notes !== undefined) {
			this.notes.delete(from);
			this.notes.set(to, notes);
		}
		this.views.delete(from);
		for (const set of [this.dirty, this.pendingMdTitleIds]) {
			if (set.delete(from)) set.add(to);
		}
		const collapsed = this.local.data.ui.collapsedSeasons;
		if (collapsed?.[from]) {
			collapsed[to] = collapsed[from];
			delete collapsed[from];
		}
		this.local.queueSave();
	}

	private async readNotes(id: string): Promise<void> {
		const file = this.fileOf(id);
		if (!file) return;
		this.notes.set(id, extractNotes(await this.app.vault.cachedRead(file)) ?? '');
	}

	/** Follows `## Notes` edits made outside the plugin. */
	private async refreshNotes(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile)) return;
		const c = this.layout().classify(file.path);
		if (c?.kind !== 'title') return;
		const next = extractNotes(await this.app.vault.read(file)) ?? '';
		const prev = this.notes.get(c.id) ?? '';
		if (next === prev) return;
		this.notes.set(c.id, next);
		const slot = this.views.get(c.id);
		if (slot && slot.view.notes === prev) slot.view.notes = next;
		this.notifyListeners();
	}

	private onVaultRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile)) return;
		const layout = this.layout();
		const from = layout.classify(oldPath)?.id;
		const to = layout.classify(file.path)?.id;
		if (from === undefined || to === undefined || from === to || !this.notes.has(from)) return;
		this.moveId(from, to);
	}

	// Dashboard helpers

	getRecentlyWatched(count: number): WatchLogTitle[] {
		return this.getTitles()
			.filter((t) => t.watchedEpisodes.length > 0 || t.status === 'Completed')
			.sort((a, b) => b.dateModified.localeCompare(a.dateModified))
			.slice(0, count);
	}

	getRecentlyAdded(count: number): WatchLogTitle[] {
		return this.getTitles()
			.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
			.slice(0, count);
	}

	getStatsByType(type: string): { watched: number; total: number } {
		const EXCLUDED = ['Dropped', 'To be released'];
		const all = this.getTitles();
		const titles = (type === 'All' ? all : all.filter((t) => t.type === type))
			.filter((t) => !EXCLUDED.includes(t.status));
		const total = titles.length;
		const watched = titles.filter((t) => t.status === 'Completed').length;
		return { watched, total };
	}

	getCompletedCount(): number {
		return this.getTitles().filter((t) => t.status === 'Completed').length;
	}

	// ID generation

	/**
	 * Provisional id for a title being built in the UI. The real id is the note path, assigned when
	 * the note is created (addTitle rewrites `title.id` in place).
	 */
	generateId(title: string): string {
		const id = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		const existing = this.getTitles().map((t) => t.id);
		if (!existing.includes(id)) return id;
		let counter = 2;
		while (existing.includes(`${id}-${counter}`)) {
			counter++;
		}
		return `${id}-${counter}`;
	}
}

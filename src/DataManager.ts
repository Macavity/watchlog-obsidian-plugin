import { App, Notice, TAbstractFile, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type WatchLogPlugin from './main';
import type { WatchLogData, WatchLogTitle, WatchLogGroup, AirtimeEntry, MaybeTitle, RecommendedDaily, SavedFilterPreset, WatchLogPluginSettings, Book, Manga, Game } from './types';
import type { HistoryManager } from './HistoryManager';
import { formatHistoryDate } from './HistoryManager';
import { pruneManualCredits, normalizeManualCredits, isReleaseDateFuture, todayIso } from './types';
import type { CreditsField } from './types';
import type { EntryIndex } from './storage/EntryIndex';
import type { LocalStore } from './storage/LocalStore';
import type { SharedConfigStore } from './storage/SharedConfigStore';
import type { VaultLayout } from './storage/VaultLayout';
import { decodeTitle, encodeTitle, splitCache } from './storage/titleCodec';
import { externalIdFromLink } from './storage/externalId';

export interface DataStores {
	index: EntryIndex;
	local: LocalStore;
	shared: SharedConfigStore;
	layout: () => VaultLayout;
}

/** Interim: groups, Upcoming and Maybe still live in data.json until they move to frontmatter. */
interface LegacyLists {
	groups?: WatchLogGroup[];
	airtime?: AirtimeEntry[];
	maybe?: MaybeTitle[];
}

/** Every frontmatter key encodeTitle can emit; the full rewrite deletes the ones it omits. */
const TITLE_KEYS: readonly string[] = [
	'title', 'type', 'status', 'priority', 'review', 'rating', 'progress', 'totalEpisodes', 'episodeDuration',
	'dateStarted', 'dateFinished', 'dateAdded', 'dateModified', 'releaseDate', 'malId', 'anilistId',
	'communityRating', 'communityVotes', 'communitySource', 'director', 'cast', 'studio', 'poster', 'trailer',
	'externalLink', 'pinned', 'favorite', 'dateFavorited', 'externalId', 'groups', 'maybe', 'watched', 'skipped',
	'seasons', 'manualPosterUrl', 'manualTrailerUrl', 'manualDirector', 'manualCast', 'manualStudio',
	'airtimeRecurrence', 'airtimeDay', 'airtimeTime', 'airtimeSeason', 'airtimeEpisode', 'airtimeAcknowledged',
];

const NOTES_RE = /(^|\n)## Notes[ \t]*\r?\n([\s\S]*?)(?=\n## |\n# |$)/;

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
	// it is the baseline a write diffs against, so only fields the user changed reach the note.
	private views: Map<string, { src: WatchLogTitle; view: WatchLogTitle }> = new Map();
	// `## Notes` body per id as last read from / written to the note
	private notes: Map<string, string> = new Map();
	// titles changed via updateTitleSilent, written on the next save()
	private dirty: Set<string> = new Set();

	// debounced save for high-frequency edits (rapid episode clicks): memory now, note coalesced
	private pendingSaveTimer: number | null = null;
	private pendingMdTitleIds: Set<string> = new Set();
	private readonly EPISODE_SAVE_DEBOUNCE_MS = 500;

	// debounced batched poster saves: memory now, data.json ~every 5s
	private posterSaveTimer: number | null = null;
	private readonly POSTER_SAVE_DEBOUNCE_MS = 5000;

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
		this.index.onChange(() => this.notifyListeners());
		const { vault } = this.app;
		this.plugin.registerEvent(vault.on('modify', (f) => void this.refreshNotes(f)));
		this.plugin.registerEvent(vault.on('create', (f) => void this.refreshNotes(f)));
		this.plugin.registerEvent(vault.on('rename', (f, oldPath) => this.onVaultRename(f, oldPath)));
		this.notifyListeners();
	}

	/** Re-reads data.json (backup restore). */
	async load(): Promise<void> {
		await this.local.load();
		this.views.clear();
		this.notifyListeners();
	}

	private get lists(): LegacyLists {
		return this.local.data as unknown as LegacyLists;
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
	 * Silent poster URL update: memory now, debounced cache save (5s). No notify — the card that
	 * triggered the fetch updates its own <img>.
	 */
	updatePosterUrl(titleId: string, url: string): void {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.posterUrl = url;
		this.local.data.cache[titleId] = { ...this.local.getCache(titleId), posterUrl: url };
		this.schedulePosterSave();
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
	 * Persists a director/cast backfill: cache AND the note's merged credit fields. Deliberately does
	 * not stamp dateModified — a background backfill is not a user edit and must not reshuffle
	 * "recently modified" sorts.
	 *
	 * Only the fetched fields are touched; user-added credits live in their own arrays. Manual
	 * entries the fetch now returns are pruned, so no name is stored twice.
	 */
	async updateCredits(titleId: string, director: string[], cast: string[]): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.director = director;
		title.cast = cast;
		title.manualDirector = pruneManualCredits(title.manualDirector ?? [], director);
		title.manualCast = pruneManualCredits(title.manualCast ?? [], cast);
		await this.writeTitle(title);
		this.notifyListeners();
	}

	/** Studio backfill; same no-dateModified rules as updateCredits. Caches the TMDB id it resolved. */
	async updateStudio(
		titleId: string,
		studio: string[],
		tmdbId?: number,
		tmdbMediaType?: 'movie' | 'tv',
	): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.studio = studio;
		title.manualStudio = pruneManualCredits(title.manualStudio ?? [], studio);
		if (tmdbId && tmdbMediaType) {
			title.tmdbId = tmdbId;
			title.tmdbMediaType = tmdbMediaType;
		}
		await this.writeTitle(title);
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

	/**
	 * data.json contents (device-local settings, cache, UI state). Reading, games and history still
	 * keep their datasets as keys on this object until they move to the vault.
	 */
	getData(): WatchLogData {
		return this.local.data as unknown as WatchLogData;
	}

	/** Centralized debounced save for cross-cutting paths (settings, drafts, lists). */
	queueSave(): void {
		this.local.queueSave();
	}

	flushQueuedSaveSync(): void {
		void this.local.flush();
	}

	/** Save settings through the centralized data path. */
	async saveSettings(settings: WatchLogPluginSettings): Promise<void> {
		this.local.data.settings = settings as unknown as Record<string, unknown>;
		await this.persist();
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
		const ids = [...this.dirty, ...this.pendingMdTitleIds];
		this.dirty.clear();
		this.pendingMdTitleIds.clear();
		for (const id of new Set(ids)) {
			const t = this.getTitle(id);
			if (t) await this.writeTitle(t);
		}
		for (const { view } of this.views.values()) this.syncCache(view);
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
		if (this.pendingMdTitleIds.size === 0) return;
		const ids = Array.from(this.pendingMdTitleIds);
		this.pendingMdTitleIds.clear();
		for (const id of ids) {
			const t = this.getTitle(id);
			if (t) await this.writeTitle(t);
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
		this.views.set(src.id, { src, view });
		return view;
	}

	getTitles(): WatchLogTitle[] {
		return this.index.titles().map((t) => this.viewOf(t));
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
		const autoUpcoming = this.canAutoAddToUpcoming(title);
		if (autoUpcoming) {
			title.status = 'To be released';
		}
		await this.createNote(title);
		if (autoUpcoming) {
			await this.autoAddToUpcoming(title);
		}
		this.notifyListeners();
		const now = new Date().toISOString();
		void this.historyManager?.log(
			`${title.title} (${title.type}) was added on ${formatHistoryDate(now)}`,
			{ source: 'Watchlist', action: 'added', titleName: title.title },
		);
	}

	/** Add without re-rendering. Caller must call notifyChange() after the batch. */
	async addTitleSilent(title: WatchLogTitle): Promise<void> {
		const autoUpcoming = this.canAutoAddToUpcoming(title);
		if (autoUpcoming) {
			title.status = 'To be released';
		}
		await this.createNote(title);
		if (autoUpcoming) {
			await this.autoAddToUpcoming(title);
		}
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

	async autoAddToUpcoming(title: WatchLogTitle): Promise<void> {
		if (!this.lists.airtime) this.lists.airtime = [];
		// avoid duplicates
		if (this.lists.airtime.some((e) => e.titleId === title.id)) return;
		const entry: AirtimeEntry = {
			id: this.generateAirtimeId(title.id),
			titleId: title.id,
			schedule: {
				recurrence: 'once',
				releaseDate: title.releaseDate ?? undefined,
			},
			dateAdded: new Date().toISOString(),
		};
		this.lists.airtime.push(entry);
		await this.persist();
	}

	/**
	 * Reconciles everything a release-date edit ripples into: an existing 'once' Upcoming entry's
	 * date, the auto "To be released" status, and whether the title belongs in Upcoming at all. A
	 * future full date forces the status and adds the entry; a past or cleared date reverts a
	 * "To be released" title to "Plan to watch" and drops its entry.
	 *
	 * Call after `releaseDate` has been written and persisted.
	 */
	async applyReleaseDateChange(title: WatchLogTitle): Promise<void> {
		// keep a one-off Upcoming entry pointing at the new date
		const existing = this.getAirtimeEntries().find((e) => e.titleId === title.id);
		if (existing && existing.schedule.recurrence === 'once') {
			const next = title.releaseDate ?? undefined;
			if (existing.schedule.releaseDate !== next) {
				existing.schedule.releaseDate = next;
				await this.updateAirtimeEntry(existing);
			}
		}

		const releaseDate = title.releaseDate;
		const isFullDate = !!releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate);

		if (isFullDate) {
			if (isReleaseDateFuture(releaseDate)) {
				if (title.status !== 'To be released') {
					title.status = 'To be released';
					await this.updateTitle(title);
				}
				if (!this.getAirtimeEntries().some((e) => e.titleId === title.id)) {
					await this.autoAddToUpcoming(title);
				}
			} else if (title.status === 'To be released') {
				// date is past/today — the auto status no longer applies
				title.status = 'Plan to watch';
				await this.updateTitle(title);
				await this.removeAirtimeEntriesForTitle(title.id);
			}
		} else if (!releaseDate && title.status === 'To be released') {
			title.status = 'Plan to watch';
			await this.updateTitle(title);
			await this.removeAirtimeEntriesForTitle(title.id);
		}
	}

	/** Remove all Upcoming entries for a title (e.g. when the date goes past). */
	async removeAirtimeEntriesForTitle(titleId: string): Promise<void> {
		const before = (this.lists.airtime ?? []).length;
		this.lists.airtime = (this.lists.airtime ?? []).filter(
			(e) => e.titleId !== titleId || (e.source !== undefined && e.source !== 'watchlist'),
		);
		if ((this.lists.airtime ?? []).length !== before) {
			await this.persist();
			this.notifyListeners();
		}
	}

	// Reading → Upcoming bridge. Reading items live under data.reading, but their Upcoming entries
	// share the airtime list with watch titles — mirroring autoAddToUpcoming.

	/** Auto-adds a reading item with a future release date to Upcoming. No-op if one exists. */
	async autoAddReadingToUpcoming(item: Book | Manga, kind: 'book' | 'manga'): Promise<void> {
		if (!this.lists.airtime) this.lists.airtime = [];
		if (this.lists.airtime.some((e) => e.source === 'reading' && e.titleId === item.id)) return;
		const entry: AirtimeEntry = {
			id: this.generateReadingAirtimeId(item.id),
			titleId: item.id,
			source: 'reading',
			readingKind: kind,
			schedule: {
				recurrence: 'once',
				releaseDate: item.releaseDate ?? undefined,
			},
			dateAdded: new Date().toISOString(),
		};
		this.lists.airtime.push(entry);
		await this.persist();
	}

	/** Remove all Upcoming entries for a reading item (book/manga id). */
	async removeReadingAirtimeEntries(itemId: string): Promise<void> {
		const before = (this.lists.airtime ?? []).length;
		this.lists.airtime = (this.lists.airtime ?? []).filter(
			(e) => !(e.source === 'reading' && e.titleId === itemId),
		);
		if ((this.lists.airtime ?? []).length !== before) {
			await this.persist();
			this.notifyListeners();
		}
	}

	generateReadingAirtimeId(itemId: string): string {
		const base = `airtime-reading-${itemId}`;
		const existing = (this.lists.airtime ?? []).map((e) => e.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	// Games → Upcoming bridge — the Reading-bridge pattern exactly.

	/** Auto-adds a game with a future release date to Upcoming. No-op if one exists. */
	async autoAddGameToUpcoming(game: Game): Promise<void> {
		if (!this.lists.airtime) this.lists.airtime = [];
		if (this.lists.airtime.some((e) => e.source === 'game' && e.titleId === game.id)) return;
		const entry: AirtimeEntry = {
			id: this.generateGameAirtimeId(game.id),
			titleId: game.id,
			source: 'game',
			schedule: {
				recurrence: 'once',
				releaseDate: game.releaseDate ?? undefined,
			},
			dateAdded: new Date().toISOString(),
		};
		this.lists.airtime.push(entry);
		await this.persist();
	}

	/** Remove all Upcoming entries for a game id. */
	async removeGameAirtimeEntries(gameId: string): Promise<void> {
		const before = (this.lists.airtime ?? []).length;
		this.lists.airtime = (this.lists.airtime ?? []).filter(
			(e) => !(e.source === 'game' && e.titleId === gameId),
		);
		if ((this.lists.airtime ?? []).length !== before) {
			await this.persist();
			this.notifyListeners();
		}
	}

	generateGameAirtimeId(gameId: string): string {
		const base = `airtime-game-${gameId}`;
		const existing = (this.lists.airtime ?? []).map((e) => e.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	/** Logs rating / completion changes against the stored state. */
	private logChanges(updated: WatchLogTitle): void {
		const old = this.views.get(updated.id)?.src;
		if (!old) return;
		const now = new Date().toISOString();
		if (old.rating !== updated.rating) {
			void this.historyManager?.log(
				`${updated.title} (${updated.type}) was reviewed on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'rating', titleName: updated.title },
			);
		}
		if (old.status !== updated.status && updated.status === 'Completed') {
			void this.historyManager?.log(
				`${updated.title} (${updated.type}) was marked as watched on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'completed', titleName: updated.title },
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
		slot.view = updated;
		this.dirty.add(updated.id);
	}

	async removeTitle(id: string): Promise<void> {
		const title = this.getTitle(id);
		if (title) {
			const now = new Date().toISOString();
			void this.historyManager?.log(
				`${title.title} (${title.type}) was deleted on ${formatHistoryDate(now)}`,
				{ source: 'Watchlist', action: 'deleted', titleName: title.title },
			);
		}
		await this.deleteNote(id);
		this.notifyListeners();
	}

	// Group CRUD

	getGroups(): WatchLogGroup[] {
		return this.lists.groups ?? [];
	}

	getGroup(id: string): WatchLogGroup | undefined {
		return (this.lists.groups ?? []).find((g) => g.id === id);
	}

	async addGroup(group: WatchLogGroup): Promise<void> {
		if (!this.lists.groups) this.lists.groups = [];
		this.lists.groups.push(group);
		await this.persist();
		this.notifyListeners();
	}

	async updateGroup(updated: WatchLogGroup): Promise<void> {
		const groups = this.lists.groups ?? [];
		const idx = groups.findIndex((g) => g.id === updated.id);
		if (idx >= 0) {
			groups[idx] = updated;
			await this.persist();
			this.notifyListeners();
		}
	}

	async removeGroup(id: string): Promise<void> {
		this.lists.groups = (this.lists.groups ?? []).filter((g) => g.id !== id);
		await this.persist();
		this.notifyListeners();
	}

	async addTitleToGroup(groupId: string, titleId: string): Promise<void> {
		const group = this.getGroup(groupId);
		if (!group) return;
		if (!group.titleIds.includes(titleId)) {
			group.titleIds.push(titleId);
			await this.updateGroup(group);
		}
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

	generateGroupId(name: string): string {
		const id =
			'group-' +
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '');
		const existing = this.getGroups().map((g) => g.id);
		if (!existing.includes(id)) return id;
		let counter = 2;
		while (existing.includes(`${id}-${counter}`)) counter++;
		return `${id}-${counter}`;
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

	// Airtime CRUD

	getAirtimeEntries(): AirtimeEntry[] {
		return this.lists.airtime ?? [];
	}

	async addAirtimeEntry(entry: AirtimeEntry): Promise<void> {
		if (!this.lists.airtime) this.lists.airtime = [];
		this.lists.airtime.push(entry);
		await this.persist();
		this.notifyListeners();
	}

	async updateAirtimeEntry(updated: AirtimeEntry): Promise<void> {
		const airtime = this.lists.airtime;
		if (!airtime) return;
		const idx = airtime.findIndex((e) => e.id === updated.id);
		if (idx >= 0) {
			airtime[idx] = updated;
			await this.persist();
			this.notifyListeners();
		}
	}

	async removeAirtimeEntry(id: string): Promise<void> {
		this.lists.airtime = (this.lists.airtime ?? []).filter((e) => e.id !== id);
		await this.persist();
		this.notifyListeners();
	}

	async removeAirtimeEntriesBatch(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const removeSet = new Set(ids);
		this.lists.airtime = (this.lists.airtime ?? []).filter((e) => !removeSet.has(e.id));
		await this.persist();
		this.notifyListeners();
	}

	// Maybe CRUD

	getMaybeTitles(): MaybeTitle[] {
		return this.lists.maybe ?? [];
	}

	async addMaybeTitle(title: MaybeTitle): Promise<void> {
		if (!this.lists.maybe) this.lists.maybe = [];
		this.lists.maybe.push(title);
		await this.persist();
		this.notifyListeners();
	}

	async removeMaybeTitle(id: string): Promise<void> {
		this.lists.maybe = (this.lists.maybe ?? []).filter((t) => t.id !== id);
		await this.persist();
		this.notifyListeners();
	}

	generateMaybeId(titleName: string): string {
		const base = 'maybe-' + titleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		const existing = (this.lists.maybe ?? []).map((t) => t.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	generateAirtimeId(titleId: string): string {
		const base = `airtime-${titleId}`;
		const existing = (this.lists.airtime ?? []).map((e) => e.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
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
		if (!title) return null;

		if (watched) {
			if (!title.watchedEpisodes.includes(episodeNumber)) {
				title.watchedEpisodes.push(episodeNumber);
				title.watchedEpisodes.sort((a, b) => a - b);
			}
			const now = new Date().toISOString();
			if (title.totalEpisodes > 1) {
				void this.historyManager?.log(
					`${title.title} (${title.type}) episode ${episodeNumber} was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title },
				);
			} else {
				void this.historyManager?.log(
					`${title.title} (${title.type}) was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title },
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
		if (!title) return;

		if (watched) {
			if (!title.watchedEpisodes.includes(episodeNumber)) {
				title.watchedEpisodes.push(episodeNumber);
				title.watchedEpisodes.sort((a, b) => a - b);
			}
			const now = new Date().toISOString();
			if (title.totalEpisodes > 1) {
				void this.historyManager?.log(
					`${title.title} (${title.type}) episode ${episodeNumber} was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title },
				);
			} else {
				void this.historyManager?.log(
					`${title.title} (${title.type}) was marked as watched on ${formatHistoryDate(now)}`,
					{ source: 'Watchlist', action: 'watched', titleName: title.title },
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
		if (!title) return;

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
					{ source: 'Watchlist', action: 'watched', titleName: title.title },
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
	 * decoder could not read. Does NOT create the file — returns false then. Powers the bulk
	 * "Rewrite all frontmatter" action.
	 */
	async rewriteFrontmatterIfExists(title: WatchLogTitle): Promise<boolean> {
		const file = this.fileOf(title.id);
		if (!file) return false;
		const out = encodeTitle(title, this.getProgress(title));
		const keep = new Set(this.index.invalidFields(title.id));
		if (title.seasons.length === 0) {
			keep.add('watched');
			keep.add('skipped');
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
	 */
	private async processFrontMatter(
		file: TFile,
		t: WatchLogTitle,
		fn: (fm: Record<string, unknown>) => void,
	): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fn(fm);
				this.afterWrite(t, { ...fm });
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
		const fm = encodeTitle(title, this.getProgress(title));
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
		const indexed = this.index.get(t.id);
		const src = this.views.get(t.id)?.src ?? (indexed?.kind === 'title' ? indexed.entry : undefined);

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

		const before = src ? encodeTitle(src, this.getProgress(src)) : {};
		const after = encodeTitle(t, this.getProgress(t));
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
		} else {
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

	/** Cache + optimistic index update after an own write; `t` stays the UI's copy. */
	private afterWrite(t: WatchLogTitle, fm: Record<string, unknown>): void {
		this.syncCache(t);
		const stored = decodeTitle(t.id, fm, this.local.getCache(t.id)).entry;
		this.index.applyLocal({ kind: 'title', entry: stored });
		this.views.set(t.id, { src: stored, view: t });
	}

	/** Stores the title's API-derived fields in data.json when they changed. */
	private syncCache(t: WatchLogTitle): void {
		const next = splitCache(t);
		if (sameJson(next, this.local.getCache(t.id) ?? {})) return;
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
		const lists = this.lists;
		for (const group of lists.groups ?? []) {
			group.titleIds = group.titleIds.filter((tid) => tid !== id);
		}
		if (lists.airtime) {
			lists.airtime = lists.airtime.filter((e) => e.titleId !== id || e.source === 'reading' || e.source === 'game');
		}
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
		const lists = this.lists;
		for (const group of lists.groups ?? []) {
			group.titleIds = group.titleIds.map((tid) => (tid === from ? to : tid));
		}
		for (const e of lists.airtime ?? []) {
			if (e.titleId === from && (e.source === undefined || e.source === 'watchlist')) e.titleId = to;
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

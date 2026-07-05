import { App, TFile, normalizePath } from 'obsidian';
import type WatchLogPlugin from './main';
import type { WatchLogData, WatchLogTitle, WatchLogGroup, AirtimeEntry, MaybeTitle, SavedFilterPreset, WatchLogPluginSettings, Book, Manga } from './types';
import type { HistoryManager } from './HistoryManager';
import { formatHistoryDate } from './HistoryManager';
import { getDisplayPoster, getDisplayTrailer, getDisplayCredits } from './types';

function isValidWatchLogData(data: unknown): data is WatchLogData {
	return (
		data !== null &&
		typeof data === 'object' &&
		Array.isArray((data as { titles?: unknown }).titles)
	);
}

export class DataManager {
	private plugin: WatchLogPlugin;
	private app: App;
	private data: WatchLogData;
	private changeListeners: Array<() => void> = [];
	private historyManager: HistoryManager | null = null;
	// Debounced save state for high-frequency edits (e.g. rapid episode clicks).
	// In-memory mutations are applied immediately; the disk write coalesces.
	private pendingSaveTimer: number | null = null;
	private pendingMdTitleIds: Set<string> = new Set();
	private readonly EPISODE_SAVE_DEBOUNCE_MS = 500;
	// Timestamp of the last self-initiated saveOnly. The 'raw' file watcher uses
	// this to ignore the echo of our own writes, which otherwise would re-load
	// data.json and notify listeners on every debounced episode-click save.
	private lastSelfSaveTime = 0;
	private readonly SELF_SAVE_ECHO_WINDOW_MS = 2000;

	// Debounced batched save for poster URL updates. Updates land in memory
	// immediately; the disk write coalesces to ~once every 5s.
	private posterSaveTimer: number | null = null;
	private readonly POSTER_SAVE_DEBOUNCE_MS = 5000;

	// Generic queued-save debounce for cross-cutting saves (settings, drafts, lists)
	private queuedSaveTimer: number | null = null;
	private readonly QUEUED_SAVE_DEBOUNCE_MS = 100;

	setHistoryManager(hm: HistoryManager): void {
		this.historyManager = hm;
	}

	constructor(plugin: WatchLogPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.data = { titles: [], groups: [], settings: {} };
	}

	async load(): Promise<void> {
		const raw: unknown = await this.plugin.loadData();
		this.data = isValidWatchLogData(raw)
			? raw
			: { titles: [], groups: [], settings: {} };
		const changed = this.migrateData();
		if (changed) {
			await this.saveOnly();
		}
	}

	private migrateData(): boolean {
		let changed = false;
		if (!Array.isArray(this.data.titles)) {
			this.data.titles = [];
			changed = true;
		}
		if (!Array.isArray((this.data as unknown as Record<string, unknown>)['groups'])) {
			this.data.groups = [];
			changed = true;
		}

		if (!Array.isArray(this.data.airtime)) {
			this.data.airtime = [];
			changed = true;
		}

		for (const title of this.data.titles) {
			if (!title.dateAdded) {
				title.dateAdded = new Date().toISOString();
				changed = true;
			} else if (!title.dateAdded.includes('T')) {
				title.dateAdded = new Date(title.dateAdded).toISOString();
				changed = true;
			}

			if (!title.dateModified) {
				const raw = title as unknown as Record<string, unknown>;
				const lastInteracted = raw['lastInteracted'];
				if (typeof lastInteracted === 'string' && lastInteracted) {
					title.dateModified = lastInteracted;
				} else {
					title.dateModified = title.dateAdded;
				}
				changed = true;
			}

			for (const season of (title.seasons ?? [])) {
				if (!Array.isArray(season.skippedEpisodes)) {
					season.skippedEpisodes = [];
					changed = true;
				}
			}

			if (title.posterUrl === undefined) { title.posterUrl = ''; changed = true; }
			if (title.manualPosterUrl === undefined) { title.manualPosterUrl = ''; changed = true; }
			if (title.trailerUrl === undefined) { title.trailerUrl = ''; changed = true; }
			if (title.manualTrailerUrl === undefined) { title.manualTrailerUrl = ''; changed = true; }
			if (title.anilistId === undefined) { title.anilistId = 0; changed = true; }
			if (title.communityRating === undefined) { title.communityRating = 0; changed = true; }
			if (title.communityVotes === undefined) { title.communityVotes = 0; changed = true; }
			if (title.communitySource === undefined) { title.communitySource = ''; changed = true; }
			if (title.communityRatingLastFetched === undefined) { title.communityRatingLastFetched = ''; changed = true; }
		}

		if (!this.data.posterRetryDone) {
			for (const title of this.data.titles) {
				if (title.posterUrl === 'none') {
					title.posterUrl = '';
				}
			}
			this.data.posterRetryDone = true;
			changed = true;
		}
		return changed;
	}

	/**
	 * Silent poster URL update. Writes the value in memory and schedules a
	 * debounced disk save (5s). Does NOT notify listeners — the card that
	 * triggered the fetch updates its own <img> directly.
	 */
	updatePosterUrl(titleId: string, url: string): void {
		const title = this.data.titles.find((t) => t.id === titleId);
		if (title) {
			title.posterUrl = url;
			this.schedulePosterSave();
		}
	}

	/**
	 * Silent community-rating update. Writes the values in memory and saves
	 * to disk without notifying listeners — the caller is responsible for
	 * any targeted UI refresh.
	 */
	updateCommunityRating(
		id: string,
		rating: number,
		votes: number,
		source: '' | 'imdb' | 'mal' | 'anilist' | 'tmdb',
	): void {
		const title = this.data.titles.find((t) => t.id === id);
		if (!title) return;
		title.communityRating = rating;
		title.communityVotes = votes;
		title.communitySource = source;
		title.communityRatingLastFetched = new Date().toISOString();
		void this.saveOnly();
	}

	/**
	 * Silent trailer URL update (manual refresh). Writes the value in memory and
	 * saves to disk without notifying listeners — the caller re-renders its own row.
	 */
	updateTrailerUrl(titleId: string, url: string): void {
		const title = this.data.titles.find((t) => t.id === titleId);
		if (!title) return;
		title.trailerUrl = url;
		void this.saveOnly();
	}

	/**
	 * Persists a director/cast backfill through the normal update path: data.json
	 * AND the title's markdown frontmatter are written in the same operation (NOT
	 * the poster-style silent save, which skips the .md file). Deliberately does
	 * not stamp dateModified — a background backfill is not a user edit and must
	 * not reshuffle "recently modified" sorts.
	 */
	async updateCredits(titleId: string, director: string[], cast: string[]): Promise<void> {
		const title = this.getTitle(titleId);
		if (!title) return;
		title.director = director;
		title.cast = cast;
		await this.save();
		await this.updateMarkdownFile(title);
	}

	private schedulePosterSave(): void {
		if (this.posterSaveTimer !== null) return;
		this.posterSaveTimer = window.setTimeout(() => {
			this.posterSaveTimer = null;
			void this.saveOnly();
		}, this.POSTER_SAVE_DEBOUNCE_MS);
	}

	/** Flush a pending debounced poster save now (e.g. on plugin unload). */
	flushPosterSave(): void {
		if (this.posterSaveTimer !== null) {
			window.clearTimeout(this.posterSaveTimer);
			this.posterSaveTimer = null;
			void this.saveOnly();
		}
	}

	/** Synchronously flush a pending poster save during plugin unload. */
	flushPosterSaveSync(): void {
		if (this.posterSaveTimer !== null) {
			window.clearTimeout(this.posterSaveTimer);
			this.posterSaveTimer = null;
			this.lastSelfSaveTime = Date.now();
			void this.plugin.saveData(this.data);
		}
	}

	/** Public access to the full in-memory data snapshot. */
	getData(): WatchLogData {
		return this.data;
	}

	/** Centralized debounced save for cross-cutting paths (settings, drafts, lists). */
	queueSave(): void {
		if (this.queuedSaveTimer !== null) {
			window.clearTimeout(this.queuedSaveTimer);
		}
		this.queuedSaveTimer = window.setTimeout(() => {
			this.queuedSaveTimer = null;
			void this.saveOnly();
		}, this.QUEUED_SAVE_DEBOUNCE_MS);
	}

	flushQueuedSaveSync(): void {
		if (this.queuedSaveTimer !== null) {
			window.clearTimeout(this.queuedSaveTimer);
			this.queuedSaveTimer = null;
			this.lastSelfSaveTime = Date.now();
			void this.plugin.saveData(this.data);
		}
	}

	/** Save settings through the centralized data path. */
	async saveSettings(settings: WatchLogPluginSettings): Promise<void> {
		this.data.settings = settings;
		await this.saveOnly();
	}

	private async saveOnly(): Promise<void> {
		this.lastSelfSaveTime = Date.now();
		await this.plugin.saveData(this.data);
		this.lastSelfSaveTime = Date.now();
	}

	/**
	 * Persist the full in-memory data object to data.json. Reading and activity-log
	 * data now live as keys (`reading` / `history`) inside this same object, so
	 * ReadingDataManager and HistoryManager route their saves through here. Going
	 * through saveOnly() also stamps lastSelfSaveTime, so the 'raw' watcher ignores
	 * the echo of these writes (no spurious reload + re-render).
	 */
	async persist(): Promise<void> {
		await this.saveOnly();
	}

	async save(): Promise<void> {
		// An immediate save supersedes any pending debounced one — the in-memory
		// state already contains those changes.
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
			this.pendingSaveTimer = null;
			this.pendingMdTitleIds.clear();
		}
		await this.saveOnly();
		this.notifyListeners();
	}

	/**
	 * Schedule a debounced silent save (no listener notification, no full re-render).
	 * Subsequent calls within the debounce window reset the timer. Callers are
	 * responsible for any targeted DOM updates.
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
		await this.saveOnly();
		for (const id of ids) {
			const t = this.getTitle(id);
			if (t) await this.updateMarkdownFile(t);
		}
	}

	/** Synchronously flush a pending episode-save during plugin unload (no awaits). */
	flushPendingSaveSync(): void {
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
			this.pendingSaveTimer = null;
		}
		if (this.pendingMdTitleIds.size === 0) return;
		const ids = Array.from(this.pendingMdTitleIds);
		this.pendingMdTitleIds.clear();
		this.lastSelfSaveTime = Date.now();
		void this.plugin.saveData(this.data);
		for (const id of ids) {
			const t = this.getTitle(id);
			if (t) void this.updateMarkdownFile(t);
		}
	}

	getTitles(): WatchLogTitle[] {
		return this.data.titles ?? [];
	}

	getTitle(id: string): WatchLogTitle | undefined {
		return (this.data.titles ?? []).find((t) => t.id === id);
	}

	async addTitle(title: WatchLogTitle): Promise<void> {
		// Ensure a freshly-added title carries an empty-string posterUrl (not undefined)
		// so the Cards "needs-poster" gate enqueues an auto-fetch on first render.
		if (title.posterUrl === undefined) title.posterUrl = '';
		if (title.trailerUrl === undefined) title.trailerUrl = '';
		if (title.manualTrailerUrl === undefined) title.manualTrailerUrl = '';
		const autoUpcoming = this.canAutoAddToUpcoming(title);
		if (autoUpcoming) {
			title.status = 'To be released';
		}
		this.data.titles.push(title);
		await this.save();
		if (autoUpcoming) {
			await this.autoAddToUpcoming(title);
		}
		await this.updateMarkdownFile(title);
		const now = new Date().toISOString();
		void this.historyManager?.log(
			`${title.title} (${title.type}) was added on ${formatHistoryDate(now)}`,
			{ source: 'Watchlist', action: 'added', titleName: title.title },
		);
	}

	/** Add without triggering a UI re-render. Caller must call notifyChange() after the batch. */
	async addTitleSilent(title: WatchLogTitle): Promise<void> {
		const autoUpcoming = this.canAutoAddToUpcoming(title);
		if (autoUpcoming) {
			title.status = 'To be released';
		}
		this.data.titles.push(title);
		await this.saveOnly();
		if (autoUpcoming) {
			await this.autoAddToUpcoming(title);
		}
		await this.updateMarkdownFile(title);
	}

	/** Batch-add: push all titles into memory, save once, then write all MD files. */
	async addTitleBatch(titles: WatchLogTitle[]): Promise<void> {
		const upcoming: WatchLogTitle[] = [];
		for (const title of titles) {
			if (this.canAutoAddToUpcoming(title)) {
				title.status = 'To be released';
				upcoming.push(title);
			}
			this.data.titles.push(title);
		}
		await this.saveOnly();
		for (const title of upcoming) {
			await this.autoAddToUpcoming(title);
		}
		for (const title of titles) {
			await this.updateMarkdownFile(title);
		}
	}

	/** Batch-update via mutator. Single save + single notify; MD files updated. */
	async batchUpdate(ids: string[], mutator: (t: WatchLogTitle) => void): Promise<void> {
		const updated: WatchLogTitle[] = [];
		for (const id of ids) {
			const t = this.getTitle(id);
			if (!t) continue;
			mutator(t);
			t.dateModified = new Date().toISOString();
			updated.push(t);
		}
		if (updated.length === 0) return;
		await this.save();
		for (const t of updated) {
			await this.updateMarkdownFile(t);
		}
	}

	/** Remove multiple titles in one batch: single save, MD files deleted in chunks of 10. */
	async removeTitlesBatch(ids: string[]): Promise<void> {
		const CHUNK_SIZE = 10;
		const titlesToDelete: WatchLogTitle[] = [];

		for (const id of ids) {
			const title = this.getTitle(id);
			if (title) titlesToDelete.push(title);
			this.data.titles = this.data.titles.filter((t) => t.id !== id);
			for (const group of this.data.groups) {
				group.titleIds = group.titleIds.filter((tid) => tid !== id);
			}
			if (this.data.airtime) {
				this.data.airtime = this.data.airtime.filter((e) => e.titleId !== id || e.source === 'reading');
			}
			const d = this.data as unknown as Record<string, unknown>;
			if (d['collapsedSeasons']) {
				delete (d['collapsedSeasons'] as Record<string, number[]>)[id];
			}
		}

		await this.save();

		for (let i = 0; i < titlesToDelete.length; i += CHUNK_SIZE) {
			const chunk = titlesToDelete.slice(i, i + CHUNK_SIZE);
			await Promise.all(chunk.map((t) => this.deleteMarkdownFile(t)));
		}
	}

	canAutoAddToUpcoming(title: WatchLogTitle): boolean {
		if (!title.releaseDate) return false;
		// Only auto-add when we have a full YYYY-MM-DD date
		if (!/^\d{4}-\d{2}-\d{2}$/.test(title.releaseDate)) return false;
		const release = new Date(title.releaseDate + 'T12:00:00');
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return release > today;
	}

	async autoAddToUpcoming(title: WatchLogTitle): Promise<void> {
		if (!this.data.airtime) this.data.airtime = [];
		// Avoid duplicates
		if (this.data.airtime.some((e) => e.titleId === title.id)) return;
		const entry: import('./types').AirtimeEntry = {
			id: this.generateAirtimeId(title.id),
			titleId: title.id,
			schedule: {
				recurrence: 'once',
				releaseDate: title.releaseDate ?? undefined,
			},
			dateAdded: new Date().toISOString(),
		};
		this.data.airtime.push(entry);
		// Persist airtime entry
		await this.plugin.saveData(this.data);
	}

	/** Remove all Upcoming entries for a given title (e.g. when date goes past). */
	async removeAirtimeEntriesForTitle(titleId: string): Promise<void> {
		const before = (this.data.airtime ?? []).length;
		this.data.airtime = (this.data.airtime ?? []).filter((e) => e.titleId !== titleId || e.source === 'reading');
		if ((this.data.airtime ?? []).length !== before) {
			await this.save();
		}
	}

	// ── Reading → Upcoming bridge ──────────────────────────────────────────────────
	// Reading items (Book/Manga) live under the data.reading key, but their Upcoming
	// entries share the same airtime list as watch titles — mirroring autoAddToUpcoming.

	/**
	 * Auto-adds a reading item with a future release date to Upcoming, mirroring
	 * the watchlist `autoAddToUpcoming`. No-op if an entry already exists.
	 */
	async autoAddReadingToUpcoming(item: Book | Manga, kind: 'book' | 'manga'): Promise<void> {
		if (!this.data.airtime) this.data.airtime = [];
		if (this.data.airtime.some((e) => e.source === 'reading' && e.titleId === item.id)) return;
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
		this.data.airtime.push(entry);
		await this.plugin.saveData(this.data);
	}

	/** Remove all Upcoming entries for a given reading item (book/manga id). */
	async removeReadingAirtimeEntries(itemId: string): Promise<void> {
		const before = (this.data.airtime ?? []).length;
		this.data.airtime = (this.data.airtime ?? []).filter(
			(e) => !(e.source === 'reading' && e.titleId === itemId),
		);
		if ((this.data.airtime ?? []).length !== before) {
			await this.save();
		}
	}

	generateReadingAirtimeId(itemId: string): string {
		const base = `airtime-reading-${itemId}`;
		const existing = (this.data.airtime ?? []).map((e) => e.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	async updateTitle(updated: WatchLogTitle): Promise<void> {
		updated.dateModified = new Date().toISOString();
		if (updated.status === 'Completed') {
			updated.priority = '';
		}
		const idx = this.data.titles.findIndex((t) => t.id === updated.id);
		if (idx >= 0) {
			const old = this.data.titles[idx]!;
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
			this.data.titles[idx] = updated;
			await this.save();
			await this.updateMarkdownFile(updated);
		}
	}

	/** Update without saving or notifying listeners. Caller must call
	 * save() (or saveOnly + notifyChange) once after the batch completes,
	 * and is responsible for updating the markdown file per title if needed. */
	updateTitleSilent(updated: WatchLogTitle): void {
		updated.dateModified = new Date().toISOString();
		if (updated.status === 'Completed') {
			updated.priority = '';
		}
		const idx = this.data.titles.findIndex((t) => t.id === updated.id);
		if (idx >= 0) {
			const old = this.data.titles[idx]!;
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
			this.data.titles[idx] = updated;
		}
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
		this.data.titles = this.data.titles.filter((t) => t.id !== id);
		// Remove from any groups
		for (const group of this.data.groups) {
			group.titleIds = group.titleIds.filter((tid) => tid !== id);
		}
		// Remove airtime entries for this title
		if (this.data.airtime) {
			this.data.airtime = this.data.airtime.filter((e) => e.titleId !== id || e.source === 'reading');
		}
		// Remove collapsed seasons for this title
		const d = this.data as unknown as Record<string, unknown>;
		if (d['collapsedSeasons']) {
			delete (d['collapsedSeasons'] as Record<string, number[]>)[id];
		}
		await this.save();
		if (title) {
			await this.deleteMarkdownFile(title);
		}
	}

	// ── Group CRUD ────────────────────────────────────────────────────────────────

	getGroups(): WatchLogGroup[] {
		return this.data.groups ?? [];
	}

	getGroup(id: string): WatchLogGroup | undefined {
		return (this.data.groups ?? []).find((g) => g.id === id);
	}

	async addGroup(group: WatchLogGroup): Promise<void> {
		this.data.groups.push(group);
		await this.save();
	}

	async updateGroup(updated: WatchLogGroup): Promise<void> {
		const idx = this.data.groups.findIndex((g) => g.id === updated.id);
		if (idx >= 0) {
			this.data.groups[idx] = updated;
			await this.save();
		}
	}

	async removeGroup(id: string): Promise<void> {
		this.data.groups = this.data.groups.filter((g) => g.id !== id);
		await this.save();
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
		for (const group of (this.data.groups ?? [])) {
			for (const id of group.titleIds) {
				ids.add(id);
			}
		}
		return ids;
	}

	generateGroupId(name: string): string {
		let id =
			'group-' +
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '');
		const existing = (this.data.groups ?? []).map((g) => g.id);
		if (!existing.includes(id)) return id;
		let counter = 2;
		while (existing.includes(`${id}-${counter}`)) counter++;
		return `${id}-${counter}`;
	}

	// ── Pinned group ──────────────────────────────────────────────────────────────

	getPinnedGroupId(): string | null {
		return this.data.pinnedGroupId ?? null;
	}

	async setPinnedGroupId(id: string | null): Promise<void> {
		this.data.pinnedGroupId = id;
		await this.save();
	}

	// ── Saved filter preset ───────────────────────────────────────────────────────

	getSavedFilterPreset(): SavedFilterPreset | null {
		return this.data.savedFilterPreset ?? null;
	}

	async setSavedFilterPreset(preset: SavedFilterPreset | null): Promise<void> {
		this.data.savedFilterPreset = preset;
		await this.save();
	}

	// ── Airtime CRUD ──────────────────────────────────────────────────────────────

	getAirtimeEntries(): AirtimeEntry[] {
		return this.data.airtime ?? [];
	}

	async addAirtimeEntry(entry: AirtimeEntry): Promise<void> {
		if (!this.data.airtime) this.data.airtime = [];
		this.data.airtime.push(entry);
		await this.save();
	}

	async updateAirtimeEntry(updated: AirtimeEntry): Promise<void> {
		if (!this.data.airtime) return;
		const idx = this.data.airtime.findIndex((e) => e.id === updated.id);
		if (idx >= 0) {
			this.data.airtime[idx] = updated;
			await this.save();
		}
	}

	async removeAirtimeEntry(id: string): Promise<void> {
		this.data.airtime = (this.data.airtime ?? []).filter((e) => e.id !== id);
		await this.save();
	}

	async removeAirtimeEntriesBatch(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const removeSet = new Set(ids);
		this.data.airtime = (this.data.airtime ?? []).filter((e) => !removeSet.has(e.id));
		await this.save();
	}

	// ── Maybe CRUD ────────────────────────────────────────────────────────────────

	getMaybeTitles(): MaybeTitle[] {
		return this.data.maybe ?? [];
	}

	async addMaybeTitle(title: MaybeTitle): Promise<void> {
		if (!this.data.maybe) this.data.maybe = [];
		this.data.maybe.push(title);
		await this.save();
	}

	async removeMaybeTitle(id: string): Promise<void> {
		this.data.maybe = (this.data.maybe ?? []).filter((t) => t.id !== id);
		await this.save();
	}

	generateMaybeId(titleName: string): string {
		let base = 'maybe-' + titleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		const existing = (this.data.maybe ?? []).map((t) => t.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	generateAirtimeId(titleId: string): string {
		const base = `airtime-${titleId}`;
		const existing = (this.data.airtime ?? []).map((e) => e.id);
		if (!existing.includes(base)) return base;
		let counter = 2;
		while (existing.includes(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	// ── Time calculations ─────────────────────────────────────────────────────────

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
		// Watching, Dropped, Plan to watch: only watched episodes
		return title.watchedEpisodes.length * title.episodeDuration;
	}

	calcTimeRemaining(title: WatchLogTitle): number {
		if (title.episodeDuration <= 0) return 0;
		if (title.status === 'Dropped') return 0;
		// "To be released" doesn't count toward time remaining (not yet available)
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
		// Completed or other: 0
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
		// Completed or other: 0
		return 0;
	}

	getTotalTimeWatched(): number {
		return (this.data.titles ?? []).reduce((sum, t) => sum + this.calcTimeWatched(t), 0);
	}

	getTotalTimeRemaining(): number {
		return (this.data.titles ?? []).reduce((sum, t) => sum + this.calcTimeRemaining(t), 0);
	}

	// ── External change watcher ───────────────────────────────────────────────────

	startWatchingExternalChanges(): void {
		// 'raw' fires when Obsidian Sync writes a file directly to disk (not via vault API).
		// It's a real runtime event but not declared in Obsidian's public type definitions.
		const ref = (
			this.app.vault as unknown as {
				on(event: 'raw', cb: (path: string) => void): import('obsidian').EventRef;
			}
		).on('raw', (path: string) => {
			if (path.endsWith('watchlog/data.json')) {
				// Suppress the echo of our own saveOnly() — Obsidian fires 'raw' for
				// any write to the plugin data file, including our debounced
				// episode-click saves. Without this guard each click cascades into
				// load() + notifyListeners(), forcing a full tab re-render.
				if (Date.now() - this.lastSelfSaveTime < this.SELF_SAVE_ECHO_WINDOW_MS) {
					return;
				}
				void (async () => {
					await this.load();
					this.notifyListeners();
					// Reading + activity-log data live inside data.json now, so a synced
					// data.json carries them too. Re-bind those managers' in-memory views
					// to the freshly-loaded object and refresh their UIs (Reading / Log tabs).
					await this.plugin.readingDataManager?.adoptExternalChange();
					this.plugin.historyManager?.adoptExternalChange();
				})();
			}
		});
		this.plugin.registerEvent(ref);
	}

	// ── Listeners ─────────────────────────────────────────────────────────────────

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

	// ── Season collapse persistence ──────────────────────────────────────────────

	getCollapsedSeasonsForTitle(titleId: string): Set<number> {
		const stored = (this.data as unknown as Record<string, unknown>)['collapsedSeasons'] as
			| Record<string, number[]>
			| undefined;
		return new Set<number>(stored?.[titleId] ?? []);
	}

	async persistCollapsedSeasons(titleId: string, seasons: Set<number>): Promise<void> {
		const d = this.data as unknown as Record<string, unknown>;
		if (!d['collapsedSeasons']) d['collapsedSeasons'] = {};
		(d['collapsedSeasons'] as Record<string, number[]>)[titleId] = Array.from(seasons);
		await this.save();
	}

	// ── Skip helpers ──────────────────────────────────────────────────────────────

	getTotalSkippedCount(title: WatchLogTitle): number {
		return title.seasons.reduce((sum, s) => sum + (s.skippedEpisodes?.length ?? 0), 0);
	}

	/** totalEpisodes minus all season-defined skipped episodes. */
	getEffectiveTotal(title: WatchLogTitle): number {
		return Math.max(0, title.totalEpisodes - this.getTotalSkippedCount(title));
	}

	/** Returns true if absoluteEpNum falls in any season's skippedEpisodes list. */
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
	 * In-memory toggle of an episode's watched state plus auto-complete logic.
	 * Schedules a debounced save and does NOT notify listeners — caller is
	 * responsible for targeted DOM updates. Returns the (mutated) title.
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
				// Match updateTitle(): completed titles drop priority.
				title.priority = '';
			}
			if (this.plugin.settings.setFinishDateAutomatically && !title.dateFinished) {
				title.dateFinished = new Date().toISOString().split('T')[0] ?? null;
			}
		} else if (title.status === 'Completed' && title.watchedEpisodes.length < effectiveTotal) {
			title.status = 'Watching';
			title.dateFinished = null;
		}
	}

	// ── Progress helpers ──────────────────────────────────────────────────────────

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
				title.dateFinished = new Date().toISOString().split('T')[0] ?? null;
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

		// Capture season-completion state BEFORE the tick, so we can detect a
		// not-complete → complete transition and log a single summary event.
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

		// "Tick entire season" summary event: emit ONE history entry (no per-episode
		// events) only when this action makes the season newly complete. Skip if the
		// season was already complete, if we're clearing, or if there's no season label.
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
				title.dateFinished = new Date().toISOString().split('T')[0] ?? null;
			}
		} else if (title.status === 'Completed' && title.watchedEpisodes.length < effectiveTotal) {
			title.status = 'Watching';
			title.dateFinished = null;
		}

		await this.updateTitle(title);
	}

	// ── Folder management ─────────────────────────────────────────────────────────

	async ensureFolders(): Promise<void> {
		if (!this.plugin.settings.autoCreateFolders) return;
		const root = this.plugin.settings.rootFolder;
		await this.ensureFolder(root);
		for (const type of this.plugin.settings.types) {
			await this.ensureFolder(`${root}/${type.name}`);
		}
	}

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (!this.app.vault.getAbstractFileByPath(normalized)) {
			try {
				await this.app.vault.createFolder(normalized);
			} catch {
				// folder may already exist
			}
		}
	}

	private lastMarkdownPathById: Map<string, string> = new Map();

	/** Resolves the per-title `.md` note path — the same scheme used to create it. */
	getNoteFilePath(title: WatchLogTitle): string {
		const root = this.plugin.settings.rootFolder;
		const safeTitle = title.title.replace(/[*"\\/<>:|?]/g, '-');
		return normalizePath(`${root}/${title.type}/${safeTitle}.md`);
	}

	async updateMarkdownFile(title: WatchLogTitle): Promise<void> {
		const root = this.plugin.settings.rootFolder;
		const folderPath = normalizePath(`${root}/${title.type}`);
		await this.ensureFolder(folderPath);
		const filePath = this.getNoteFilePath(title);
		const progress = this.getProgress(title);
		const content = this.buildMarkdownContent(title, progress);

		// If a different path was previously written for this title (rename/type change),
		// remove the stale file before writing the new one.
		const previousPath = this.lastMarkdownPathById.get(title.id);
		if (previousPath && previousPath !== filePath) {
			try {
				const oldFile = this.app.vault.getAbstractFileByPath(previousPath);
				if (oldFile instanceof TFile) {
					await this.app.fileManager.trashFile(oldFile);
				}
			} catch {
				// best-effort cleanup
			}
		}

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			// Body-preserving update: swap the leading frontmatter block, then
			// replace ONLY the `## Notes` section body with the title's notes.
			// Everything else — frontmatter aside, other headings, any prose the
			// user wrote outside `## Notes` — is kept verbatim (no append/dup).
			// Mirrors how Reading rewrites frontmatter while preserving its body.
			const current = await this.app.vault.read(existing);
			let updated = this.rebuildWithFrontmatter(current, this.buildFrontmatter(title, progress));
			updated = this.replaceNotesSection(updated, title.notes);
			if (updated !== current) {
				await this.app.vault.modify(existing, updated);
			}
		} else {
			// New file: write the full template (frontmatter + ## Notes from title.notes).
			await this.app.vault.create(filePath, content);
		}
		this.lastMarkdownPathById.set(title.id, filePath);
	}

	/**
	 * Replaces only the leading `---…---` frontmatter block, preserving the body.
	 * If the file has no frontmatter, the new block is prepended. Mirrors the
	 * Reading note path (ReadingDataManager.rebuildWithFrontmatter).
	 */
	private rebuildWithFrontmatter(existing: string, frontmatter: string): string {
		const fmMatch = existing.match(/^---\n[\s\S]*?\n---\n?/);
		if (fmMatch) {
			return frontmatter + '\n' + existing.slice(fmMatch[0].length);
		}
		// No frontmatter found — prepend it.
		return frontmatter + '\n\n' + existing;
	}

	/**
	 * Reads back the `## Notes` section body from an existing title note file.
	 * Returns null when the file or section is absent. Lets manual edits made
	 * directly in the .md file flow back into the plugin (mirrors how Reading
	 * reads its Quotes section from the file).
	 */
	async readNotesFromFile(title: WatchLogTitle): Promise<string | null> {
		const filePath = this.getNoteFilePath(title);
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			// Diagnostic: the resolved path didn't match a real file on disk — the
			// likely culprit if read-back ever stops working (sanitization / folder
			// / rename mismatch). Logged so it can be verified against the vault.
			console.warn(
				`[WatchLog] Notes read: no note file at resolved path "${filePath}" for title "${title.title}"`,
			);
			return null;
		}
		const content = await this.app.vault.read(file);
		const match = content.match(/(^|\n)## Notes[ \t]*\r?\n([\s\S]*?)(?=\n## |\n# |$)/);
		if (!match) return null;
		// Strip the leading blank line the template inserts and any trailing whitespace,
		// but keep the user's internal line breaks intact.
		return (match[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
	}

	/**
	 * Replaces the body of the `## Notes` section with `notesBody`, preserving the
	 * heading, every other section, the frontmatter, and any prose outside it. When
	 * no `## Notes` heading exists, one is appended at the end (never duplicated).
	 * The section boundary matches `readNotesFromFile` (next `## ` / `# ` heading or
	 * EOF) so a read-then-write round-trips cleanly.
	 */
	private replaceNotesSection(existing: string, notesBody: string): string {
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

	async createMarkdownFileIfMissing(title: WatchLogTitle): Promise<boolean> {
		const root = this.plugin.settings.rootFolder;
		const folderPath = normalizePath(`${root}/${title.type}`);
		const filePath = this.getNoteFilePath(title);
		if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) return false;
		await this.ensureFolder(normalizePath(root));
		await this.ensureFolder(folderPath);
		const content = this.buildMarkdownContent(title, this.getProgress(title));
		await this.app.vault.create(filePath, content);
		return true;
	}

	/**
	 * Rewrites ONLY the frontmatter block of an existing title note, preserving the
	 * entire body verbatim (`## Notes` and anything else). Does NOT create the file
	 * when missing — returns false in that case. Powers the bulk "Rewrite all
	 * frontmatter" action that applies newer frontmatter fields to old notes.
	 */
	async rewriteFrontmatterIfExists(title: WatchLogTitle): Promise<boolean> {
		const filePath = this.getNoteFilePath(title);
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;
		const current = await this.app.vault.read(file);
		const updated = this.rebuildWithFrontmatter(current, this.buildFrontmatter(title, this.getProgress(title)));
		if (updated !== current) {
			await this.app.vault.modify(file, updated);
		}
		this.lastMarkdownPathById.set(title.id, filePath);
		return true;
	}

	/**
	 * YAML-quotes a string value (escaping backslashes and double quotes) so a
	 * title or URL containing `:` can't break the frontmatter. Same helper Reading
	 * uses; empty strings become `""`.
	 */
	private yamlEscape(value: string): string {
		if (value === '') return '""';
		return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}

	/** The leading `---…---` frontmatter block (no trailing newline). */
	private buildFrontmatter(title: WatchLogTitle, progress: number): string {
		const esc = (v: string): string => this.yamlEscape(v);
		const lines: string[] = ['---'];
		// Text values are routed through yamlEscape; numbers/booleans/dates emit
		// unquoted. Optional fields are omitted when absent to avoid noise.
		lines.push(`title: ${esc(title.title)}`);
		lines.push(`type: ${esc(title.type)}`);
		lines.push(`status: ${esc(title.status)}`);
		lines.push(`priority: ${esc(title.priority)}`);
		if (title.review) lines.push(`review: ${esc(title.review)}`);
		lines.push(`rating: ${title.rating}`);
		lines.push(`progress: ${progress}%`);
		lines.push(`totalEpisodes: ${title.totalEpisodes}`);
		lines.push(`episodeDuration: ${title.episodeDuration}`);
		lines.push(`dateStarted: ${title.dateStarted ?? 'null'}`);
		lines.push(`dateFinished: ${title.dateFinished ?? 'null'}`);
		lines.push(`dateAdded: ${esc(title.dateAdded)}`);
		lines.push(`dateModified: ${esc(title.dateModified)}`);
		if (title.releaseDate) lines.push(`releaseDate: ${title.releaseDate}`);
		if (title.malId !== undefined) lines.push(`malId: ${title.malId}`);
		if (title.anilistId !== undefined) lines.push(`anilistId: ${title.anilistId}`);
		if (title.communityRating !== undefined) lines.push(`communityRating: ${title.communityRating}`);
		if (title.communityVotes !== undefined) lines.push(`communityVotes: ${title.communityVotes}`);
		if (title.communitySource) lines.push(`communitySource: ${esc(title.communitySource)}`);
		// Inline YAML arrays; unfetched and 'none' credits are both omitted.
		const director = getDisplayCredits(title.director);
		if (director.length > 0) lines.push(`director: [${director.map(esc).join(', ')}]`);
		const cast = getDisplayCredits(title.cast);
		if (cast.length > 0) lines.push(`cast: [${cast.map(esc).join(', ')}]`);
		// Single resolved poster (manual override if set, else auto-fetched).
		const poster = getDisplayPoster(title);
		if (poster && poster !== 'none') lines.push(`poster: ${esc(poster)}`);
		// Single resolved trailer (manual override if set, else auto-fetched).
		const trailer = getDisplayTrailer(title);
		if (trailer) lines.push(`trailer: ${esc(trailer)}`);
		if (title.externalLink) lines.push(`externalLink: ${esc(title.externalLink)}`);
		if (title.pinned) lines.push(`pinned: true`);
		lines.push('---');
		return lines.join('\n');
	}

	/** Full note template (frontmatter + ## Notes body). Used only when creating a new file. */
	private buildMarkdownContent(title: WatchLogTitle, progress: number): string {
		return `${this.buildFrontmatter(title, progress)}

## Notes

${title.notes}
`;
	}

	private async deleteMarkdownFile(title: WatchLogTitle): Promise<void> {
		const filePath = this.getNoteFilePath(title);
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.app.fileManager.trashFile(file);
		}
	}

	// ── Dashboard helpers ─────────────────────────────────────────────────────────

	getRecentlyWatched(count: number): WatchLogTitle[] {
		return [...(this.data.titles ?? [])]
			.filter((t) => t.watchedEpisodes.length > 0 || t.status === 'Completed')
			.sort((a, b) => b.dateModified.localeCompare(a.dateModified))
			.slice(0, count);
	}

	getRecentlyAdded(count: number): WatchLogTitle[] {
		return [...(this.data.titles ?? [])]
			.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
			.slice(0, count);
	}

	getStatsByType(type: string): { watched: number; total: number } {
		const EXCLUDED = ['Dropped', 'To be released'];
		const all = this.data.titles ?? [];
		const titles = (type === 'All' ? all : all.filter((t) => t.type === type))
    		.filter((t) => !EXCLUDED.includes(t.status));
		const total = titles.length;
		const watched = titles.filter((t) => t.status === 'Completed').length;
		return { watched, total };
	}

	getCompletedCount(): number {
		return (this.data.titles ?? []).filter((t) => t.status === 'Completed').length;
	}

	// ── ID generation ─────────────────────────────────────────────────────────────

	generateId(title: string): string {
		let id = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		const existing = (this.data.titles ?? []).map((t) => t.id);
		if (!existing.includes(id)) return id;
		let counter = 2;
		while (existing.includes(`${id}-${counter}`)) {
			counter++;
		}
		return `${id}-${counter}`;
	}
}

import { Notice, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type WatchLogPlugin from './main';
import type { HistoryManager } from './HistoryManager';
import type { DataStores } from './DataManager';
import type { EntryIndex } from './storage/EntryIndex';
import { getBaseline, setBaseline } from './storage/baseline';
import type { SharedConfigStore } from './storage/SharedConfigStore';
import type { VaultLayout } from './storage/VaultLayout';
import { decodeGame, encodeGame } from './storage/gameCodec';
import {
	Game,
	GameGroup,
	GamesData,
	GamesSettings,
	GamesSavedFilterPreset,
	RecommendedDaily,
	SteamSyncUpdate,
	defaultGamesSettings,
	GAME_AUTO_STATUS,
	GAME_FINISHED_STATUS,
	isReleaseDateFuture,
	todayIso,
} from './types';

/** Every frontmatter key encodeGame can emit; the full rewrite deletes the ones it omits. */
const GAME_KEYS: readonly string[] = [
	'title', 'developer', 'publisher', 'genre', 'status', 'priority', 'favorite', 'dateFavorited', 'wishlist',
	'rating', 'progress', 'playtime', 'achievements', 'platforms', 'singleplayer', 'coop', 'multiplayer',
	'dateStarted', 'dateFinished', 'releaseDate', 'dateAdded', 'dateModified', 'coverUrl', 'storeUrl',
	'externalLink', 'externalId', 'steamAppId', 'lastPlayed', 'groups', 'type',
	'airtimeRecurrence', 'airtimeDay', 'airtimeTime', 'airtimeSeason', 'airtimeEpisode', 'airtimeAcknowledged',
];

const NOTES_RE = /(^|\n)## Notes[ \t]*\r?\n([\s\S]*?)(?=\n## |\n# |$)/;
const GAMES_FOLDER_PREFIX = 'Games/';

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** `## Notes` body of a note; null when the section is absent. */
function extractNotes(content: string): string | null {
	const match = content.match(NOTES_RE);
	if (!match) return null;
	// strip the template's leading blank line and trailing whitespace, keep internal breaks
	return (match[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
}

/** Replaces the `## Notes` body, keeping the heading, other sections and frontmatter; appends when missing. */
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
		nextHeading && nextHeading.index !== undefined ? bodyStart + nextHeading.index : existing.length;
	return `${existing.slice(0, bodyStart)}\n${notesBody}\n${existing.slice(bodyEnd)}`;
}

/**
 * Games, backed by one note per game under `<Root>/Games`. Reads come from the EntryIndex; writes go
 * to the note via processFrontMatter and only touch keys whose encoded value changed. Settings live
 * in the shared base (`games:`), the daily picks in data.json.
 *
 * Upcoming mirrors Reading's: a game with a future release date is auto-added to the shared
 * tracker and removed when the date passes or the game is deleted; applyReleaseStatus maintains the
 * auto "To be released" status.
 */
export class GameDataManager {
	private plugin: WatchLogPlugin;
	private index: EntryIndex;
	private local: DataStores['local'];
	private shared: SharedConfigStore;
	private layout: () => VaultLayout;
	private changeListeners: Array<() => void> = [];
	private historyManager: HistoryManager | null = null;

	// Mutable copies handed to the UI, one per id. `src` is the index entry the copy was made from,
	// `base` its normalized form: the baseline a write diffs against, so only changed fields reach the note.
	private views = new Map<string, { src: Game; base: Game; view: Game }>();
	// games changed via updateGameSilent, written on the next saveAndNotify
	private dirty = new Set<string>();
	private settingsCache: GamesSettings | null = null;

	constructor(plugin: WatchLogPlugin, stores: DataStores) {
		this.plugin = plugin;
		this.index = stores.index;
		this.local = stores.local;
		this.shared = stores.shared;
		this.layout = stores.layout;
	}

	setHistoryManager(hm: HistoryManager): void {
		this.historyManager = hm;
	}

	/** After index.build() and shared.load(): follows index and base changes, reconciles Upcoming. */
	async init(): Promise<void> {
		this.index.onChange((ids) => {
			let touched = false;
			for (const id of ids) {
				if (!id.startsWith(GAMES_FOLDER_PREFIX)) continue;
				touched = true;
				if (!this.dirty.has(id)) this.views.delete(id);
			}
			if (touched) this.notifyListeners();
		});
		this.shared.onChange(() => {
			this.settingsCache = null;
			this.notifyListeners();
		});
		// additive reconcile: every future-dated game gets an Upcoming entry. Never removes, so
		// manually-scheduled entries survive reloads.
		const dm = this.plugin.dataManager;
		if (dm) {
			for (const g of this.getGames()) if (isReleaseDateFuture(g.releaseDate)) await dm.autoAddGameToUpcoming(g);
		}
		this.notifyListeners();
	}

	/** Re-reads the shared settings (backup restore) and refreshes listeners. */
	async load(): Promise<void> {
		await this.shared.load();
		this.settingsCache = null;
		this.views.clear();
		this.notifyListeners();
	}

	private async syncUpcoming(game: Game): Promise<void> {
		const dm = this.plugin.dataManager;
		if (!dm) return;
		if (isReleaseDateFuture(game.releaseDate)) await dm.autoAddGameToUpcoming(game);
		else await dm.removeGameAirtimeEntries(game.id);
	}

	/**
	 * Forces "To be released" when the release date is in the future and reverts to the default status
	 * once it passes or is cleared. Returns true if changed.
	 */
	private applyReleaseStatus(game: Game): boolean {
		const future = isReleaseDateFuture(game.releaseDate);
		if (future) {
			if (game.status !== GAME_AUTO_STATUS) {
				game.status = GAME_AUTO_STATUS;
				return true;
			}
		} else if (game.status === GAME_AUTO_STATUS) {
			game.status = this.getSettings().defaultStatus || 'Not started';
			return true;
		}
		return false;
	}

	// Settings (shared base, `games:` block)

	getSettings(): GamesSettings {
		if (this.settingsCache) return this.settingsCache;
		const defaults = defaultGamesSettings();
		const stored = (this.shared.get().settings.games ?? {}) as Partial<GamesSettings>;
		const merged: GamesSettings = { ...defaults, ...stored, defaultFolder: defaults.defaultFolder };
		if (!Array.isArray(merged.statuses) || merged.statuses.length === 0) merged.statuses = defaults.statuses;
		if (!Array.isArray(merged.types) || merged.types.length === 0) merged.types = defaults.types;
		if (!Array.isArray(merged.platforms)) merged.platforms = defaults.platforms;
		this.settingsCache = merged;
		return merged;
	}

	private async writeSettings(settings: GamesSettings): Promise<void> {
		// the shared store drops the device-local defaultFolder itself
		await this.shared.update({ games: settings });
	}

	async updateSettings(patch: Partial<GamesSettings>): Promise<void> {
		this.settingsCache = { ...this.getSettings(), ...patch };
		await this.writeSettings(this.settingsCache);
		this.notifyListeners();
	}

	/**
	 * Persist without notifying — for state the rendering tab wrote itself (rows layout): it
	 * re-renders on its own, and a notify here would double the render.
	 */
	persistQuiet(): void {
		void this.writeSettings(this.getSettings());
	}

	getSavedFilterPreset(): GamesSavedFilterPreset | null {
		return this.getSettings().savedFilterPreset ?? null;
	}

	async setSavedFilterPreset(preset: GamesSavedFilterPreset | null): Promise<void> {
		this.getSettings().savedFilterPreset = preset;
		await this.writeSettings(this.getSettings());
	}

	// Daily "Recommended" picks (device-local)

	getRecommendedDaily(): RecommendedDaily {
		return this.gamesUi().gamesRecommendedDaily ?? { date: '', ids: [] };
	}

	/** Silent — the Rows view that rolled the picks renders them itself. */
	setRecommendedDaily(rec: RecommendedDaily): void {
		this.gamesUi().gamesRecommendedDaily = rec;
		this.local.queueSave();
	}

	private gamesUi(): { gamesRecommendedDaily?: RecommendedDaily } {
		return this.local.data.ui as { gamesRecommendedDaily?: RecommendedDaily };
	}

	// Listeners

	onChange(listener: () => void): void {
		this.changeListeners.push(listener);
	}

	offChange(listener: () => void): void {
		this.changeListeners = this.changeListeners.filter((l) => l !== listener);
	}

	private notifyListeners(): void {
		for (const listener of this.changeListeners) listener();
	}

	/** Writes every pending silent edit and in-place mutation of a handed-out copy, then notifies. */
	async saveAndNotify(): Promise<void> {
		await this.flushViews();
		this.notifyListeners();
	}

	private async flushViews(): Promise<void> {
		const ids = new Set(this.dirty);
		for (const [id, slot] of this.views) {
			if (!sameJson(encodeGame(slot.view), encodeGame(getBaseline(slot.view) ?? slot.base))) ids.add(id);
		}
		this.dirty.clear();
		for (const id of ids) {
			const view = this.views.get(id)?.view;
			if (view) await this.writeGame(view);
			else new Notice(`An edit of "${id}" was not saved: its note can no longer be read.`);
		}
	}

	/** Current dataset as a backup snapshot. */
	exportSnapshot(): GamesData {
		return { games: this.getGames(), groups: this.getGroups(), settings: this.getSettings() };
	}

	/** Replaces settings and upserts every game note from a backup snapshot. */
	async restore(data: GamesData): Promise<void> {
		await this.updateSettings(data.settings);
		const byTitle = new Map(this.getGames().map((g) => [g.title, g]));
		for (const game of data.games) {
			const groups = data.groups.filter((gr) => gr.gameIds.includes(game.id)).map((gr) => gr.name);
			const existing = byTitle.get(game.title);
			const next = { ...game, groups: groups.length > 0 ? groups : game.groups };
			if (!existing) await this.createNote({ ...next });
			else {
				// existing notes stay as they are; only groups the note lacks are added
				const missing = groups.filter((name) => !existing.groups?.includes(name));
				if (missing.length > 0) await this.writeGame({ ...existing, groups: [...(existing.groups ?? []), ...missing] });
			}
		}
		this.views.clear();
		this.notifyListeners();
	}

	// Games CRUD

	getGames(): Game[] {
		return this.index.games().map((g) => this.viewOf(g));
	}

	getGame(id: string): Game | undefined {
		const e = this.index.get(id);
		return e?.kind === 'game' ? this.viewOf(e.entry) : undefined;
	}

	private normalized(src: Game): Game {
		const g = structuredClone(src);
		if (!g.status) g.status = this.getSettings().defaultStatus || 'Not started';
		g.vaultPage = this.layout().pathFromId(g.id);
		return g;
	}

	private viewOf(src: Game): Game {
		const slot = this.views.get(src.id);
		if (slot && slot.src === src) return slot.view;
		// a pending silent edit keeps its copy until written
		if (slot && this.dirty.has(src.id)) return slot.view;
		const base = this.normalized(src);
		const view = structuredClone(base);
		// a cover cached by an earlier version shows until the note is written with it
		if (!view.coverUrl) view.coverUrl = this.local.getCache(src.id)?.coverUrl ?? '';
		this.views.set(src.id, { src, base, view });
		setBaseline(view, base);
		return view;
	}

	async addGame(game: Game): Promise<void> {
		this.applyReleaseStatus(game);
		await this.createNote(game);
		this.notifyListeners();
		await this.syncUpcoming(game);
		void this.historyManager?.log(
			`${game.title} (Game) was added`,
			{ source: 'Games', action: 'added', titleName: game.title },
		);
	}

	async updateGame(updated: Game): Promise<void> {
		updated.dateModified = new Date().toISOString();
		this.applyReleaseStatus(updated);
		const slot = this.views.get(updated.id);
		const indexed = this.index.get(updated.id);
		const old = getBaseline(updated) ?? slot?.base ?? (indexed?.kind === 'game' ? this.normalized(indexed.entry) : undefined);
		if (!old) return;
		// favorite arrives as a whole-object replace — stamp/clear off the transition. Drives the
		// Favorites shelf order (newest first).
		if (old.favorite !== updated.favorite) {
			if (updated.favorite) updated.dateFavorited = new Date().toISOString();
			else delete updated.dateFavorited;
		}
		if (old.status !== updated.status) {
			const act = updated.status === GAME_FINISHED_STATUS ? 'completed' as const : 'status' as const;
			// mirror the watch behavior: stamp today's finish date on the transition to Finished
			if (updated.status === GAME_FINISHED_STATUS && this.plugin.settings.setFinishDateAutomatically && !updated.dateFinished) {
				updated.dateFinished = todayIso();
			}
			void this.historyManager?.log(
				`${updated.title} (Game) status changed to ${updated.status}`,
				{ source: 'Games', action: act, titleName: updated.title },
			);
		}
		if (old.rating !== updated.rating) {
			void this.historyManager?.log(
				`${updated.title} (Game) Rating → ${updated.rating}/5`,
				{ source: 'Games', action: 'rating', titleName: updated.title },
			);
		}
		const oldId = updated.id;
		this.dirty.delete(oldId);
		await this.writeGame(updated);
		this.notifyListeners();
		// reconcile Upcoming only on a release-date change (never on rating/status/progress edits), so
		// manually-scheduled entries survive
		if (old.releaseDate !== updated.releaseDate) await this.syncUpcoming(updated);
	}

	updateGameSilent(updated: Game): void {
		updated.dateModified = new Date().toISOString();
		this.applyReleaseStatus(updated);
		const slot = this.views.get(updated.id);
		const indexed = this.index.get(updated.id);
		if (!slot && indexed?.kind !== 'game') return;
		const src = slot?.src ?? (indexed!.entry as Game);
		const base = getBaseline(updated) ?? slot?.base ?? this.normalized(src);
		this.views.set(updated.id, { src, base, view: updated });
		setBaseline(updated, base);
		this.dirty.add(updated.id);
	}

	async removeGame(id: string): Promise<void> {
		const game = this.getGame(id);
		await this.deleteNote(id);
		await this.plugin.dataManager?.removeGameAirtimeEntries(id);
		this.notifyListeners();
		if (game) {
			void this.historyManager?.log(
				`${game.title} (Game) was deleted`,
				{ source: 'Games', action: 'deleted', titleName: game.title },
			);
		}
	}

	/** Batch delete with chunked note removal (the Reading pattern). */
	async removeGamesBatch(ids: string[]): Promise<void> {
		const CHUNK = 10;
		const toDelete: Game[] = [];
		for (const id of ids) {
			const game = this.getGame(id);
			if (game) toDelete.push(game);
		}
		for (let i = 0; i < toDelete.length; i += CHUNK) {
			await Promise.all(toDelete.slice(i, i + CHUNK).map((g) => this.deleteNote(g.id).catch(() => {})));
		}
		for (const id of ids) await this.plugin.dataManager?.removeGameAirtimeEntries(id);
		this.notifyListeners();
		for (const game of toDelete) {
			void this.historyManager?.log(
				`${game.title} (Game) was deleted`,
				{ source: 'Games', action: 'deleted', titleName: game.title },
			);
		}
	}

	/**
	 * Writes a batch of Steam sync results: playtime, achievements, last-played and the steamAppId
	 * link. Steam is authoritative for those, so they overwrite unconditionally — everything else on
	 * the game is left alone.
	 *
	 * Deliberately no dateModified stamp: a sync is not a user edit, and stamping it would shove the
	 * whole library to the top of every recently-modified ordering at once. `lastPlayed` carries the
	 * real signal. One notify for the whole batch.
	 */
	async applySteamSync(updates: SteamSyncUpdate[]): Promise<number> {
		const touched: Game[] = [];
		for (const u of updates) {
			const game = this.getGame(u.gameId);
			if (!game) continue;
			game.steamAppId = u.steamAppId;
			game.playtimeMinutes = u.playtimeMinutes;
			game.lastPlayed = u.lastPlayed;
			if (u.achievements) {
				game.achievementsTotal = u.achievements.total;
				game.achievementsEarned = u.achievements.earned;
			}
			// a game Steam has no store link for yet gets one for free
			if (game.storeUrl === '' && u.steamAppId !== '') {
				game.storeUrl = `https://store.steampowered.com/app/${u.steamAppId}/`;
			}
			touched.push(game);
		}
		if (touched.length === 0) return 0;
		for (const g of touched) await this.writeGame(g).catch((e) => console.warn('[WL] game sync write failed:', e));
		this.notifyListeners();
		return touched.length;
	}

	// Cover updates

	/**
	 * Silent cover URL update for the lazy Cards re-fetch: written to the note's `coverUrl` only when
	 * that is empty (E12), no notify — the card that triggered the fetch swaps its own <img>, so the
	 * grid is not rebuilt and the scroll position survives.
	 */
	async updateCoverUrl(id: string, url: string): Promise<void> {
		const game = this.getGame(id);
		if (!game || !url || game.coverUrl) return;
		if (this.dirty.has(id)) {
			// the pending write carries it
			game.coverUrl = url;
			return;
		}
		const file = this.fileOf(id);
		if (!file) return;
		await this.processFrontMatter(file, game, (raw) => {
			const own = typeof raw.coverUrl === 'string' ? raw.coverUrl.trim() : '';
			if (own) {
				game.coverUrl = own;
				return;
			}
			raw.coverUrl = url;
			game.coverUrl = url;
		});
	}

	/**
	 * Cover found by a title-based lookup. The resolved API source + id are identity data of the note,
	 * which a background fetch does not write; only the cover is kept.
	 */
	updateCoverAndSource(id: string, url: string, _source: 'rawg' | 'igdb', _apiId: string): Promise<void> {
		return this.updateCoverUrl(id, url);
	}

	/** Writes pending silent edits now, without notifying (plugin unload). */
	async flushPending(): Promise<void> {
		await this.flushViews();
	}

	/** Covers live in the note (E12); a cached one is legacy and goes once the note has been written. */
	private dropLegacyCover(id: string): void {
		const cached = this.local.getCache(id);
		if (cached?.coverUrl === undefined) return;
		const rest = { ...cached };
		delete rest.coverUrl;
		this.local.data.cache[id] = rest;
		this.local.queueSave();
	}

	// Groups — derived from the `groups` property of the game notes (id = name); an empty group does not exist.

	getGroups(): GameGroup[] {
		const byName = new Map<string, GameGroup>();
		for (const game of this.getGames()) {
			for (const name of game.groups ?? []) {
				const group = byName.get(name) ?? { id: name, name, gameIds: [], dateAdded: game.dateAdded };
				group.gameIds.push(game.id);
				if (game.dateAdded && game.dateAdded < group.dateAdded) group.dateAdded = game.dateAdded;
				byName.set(name, group);
			}
		}
		return [...byName.values()];
	}

	getGroup(id: string): GameGroup | undefined {
		return this.getGroups().find((g) => g.id === id);
	}

	/** Group membership is written to the members; a group without members is not stored. */
	async addGroup(group: GameGroup): Promise<void> {
		group.id = group.name;
		await this.setMembership(group.name, group.name, new Set(group.gameIds), new Set());
		this.notifyListeners();
	}

	async updateGroup(updated: GameGroup): Promise<void> {
		const existing = this.getGroup(updated.id);
		const oldName = existing?.name ?? updated.id;
		updated.id = updated.name;
		await this.setMembership(oldName, updated.name, new Set(updated.gameIds), new Set(existing?.gameIds ?? []));
		this.notifyListeners();
	}

	/** Deletes the group only — its games stay, without the name. */
	async removeGroup(id: string): Promise<void> {
		const existing = this.getGroup(id);
		if (!existing) return;
		await this.setMembership(existing.name, existing.name, new Set(), new Set(existing.gameIds));
		this.notifyListeners();
	}

	async addGameToGroup(groupId: string, gameId: string): Promise<void> {
		const group = this.getGroup(groupId);
		if (!group || group.gameIds.includes(gameId)) return;
		await this.setMembership(group.name, group.name, new Set([...group.gameIds, gameId]), new Set(group.gameIds));
	}

	/** Rewrites `groups` on every game whose membership or group name changed. */
	private async setMembership(oldName: string, newName: string, members: Set<string>, previous: Set<string>): Promise<void> {
		for (const id of new Set([...members, ...previous])) {
			const game = this.getGame(id);
			if (!game) continue;
			const groups = (game.groups ?? []).filter((n) => n !== oldName && n !== newName);
			if (members.has(id)) groups.push(newName);
			if (sameJson(groups, game.groups ?? [])) continue;
			game.groups = groups;
			await this.writeGame(game);
		}
	}

	getGroupedGameIds(): Set<string> {
		const ids = new Set<string>();
		for (const game of this.getGames()) if (game.groups?.length) ids.add(game.id);
		return ids;
	}

	/** Group id = name. */
	generateGroupId(name: string): string {
		return name.trim() || 'unnamed';
	}

	/** Provisional id for a game being built in the UI; the real id is the note path, assigned on create. */
	generateGameId(title: string): string {
		const base = slugify(title) || 'game';
		const existing = new Set(this.getGames().map((g) => g.id));
		if (!existing.has(base)) return base;
		let counter = 2;
		while (existing.has(`${base}-${counter}`)) counter++;
		return `${base}-${counter}`;
	}

	// Game note files

	/** Path of the note a game with this title would get. */
	noteFilePath(title: string): string {
		return this.layout().notePath('game', title);
	}

	private fileOf(id: string): TFile | null {
		const f = this.plugin.app.vault.getAbstractFileByPath(this.layout().pathFromId(id));
		return f instanceof TFile ? f : null;
	}

	private freePath(path: string): string {
		const { vault } = this.plugin.app;
		if (!vault.getAbstractFileByPath(path)) return path;
		const base = path.slice(0, -3);
		let n = 2;
		while (vault.getAbstractFileByPath(`${base} ${n}.md`)) n++;
		return `${base} ${n}.md`;
	}

	private async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (!normalized || normalized === '/') return;
		if (!this.plugin.app.vault.getAbstractFileByPath(normalized)) {
			try {
				await this.plugin.app.vault.createFolder(normalized);
			} catch {
				// folder may already exist
			}
		}
	}

	/** Frontmatter to store: the encoded game with the default status filled in. */
	private encode(g: Game): Record<string, unknown> {
		return encodeGame(g);
	}

	/**
	 * processFrontMatter, then the optimistic index update for `g` — inside the callback, so it lands
	 * before the write's `changed` event can be seen. False (and a notice) on unreadable YAML.
	 */
	private async processFrontMatter(file: TFile, g: Game, fn: (fm: Record<string, unknown>) => void): Promise<boolean> {
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fn(fm);
				this.afterWrite(g, { ...fm });
			});
			return true;
		} catch (e) {
			console.warn(`WatchLog: could not update frontmatter of ${file.path}`, e);
			new Notice(`Could not update "${file.basename}": its frontmatter is not valid YAML.`);
			return false;
		}
	}

	/** Cache + optimistic index update after an own write; `g` stays the UI's copy. */
	private afterWrite(g: Game, fm: Record<string, unknown>): void {
		this.dropLegacyCover(g.id);
		const stored = decodeGame(g.id, fm).entry;
		this.index.applyLocal({ kind: 'game', entry: stored });
		g.vaultPage = this.layout().pathFromId(g.id);
		const base = this.normalized(stored);
		this.views.set(g.id, { src: stored, base, view: g });
		setBaseline(g, base);
	}

	/** Creates the note for a new game; the game's id becomes the note path. */
	private async createNote(game: Game): Promise<void> {
		const layout = this.layout();
		if (!game.status) game.status = this.getSettings().defaultStatus || 'Not started';
		const path = this.freePath(layout.notePath('game', game.title));
		await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
		game.id = layout.idFromPath(path);
		const fm = this.encode(game);
		// index first, so the create event finds nothing new
		this.afterWrite(game, fm);
		try {
			await this.plugin.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n## Notes\n`);
		} catch (e) {
			this.index.removeLocal(game.id);
			this.views.delete(game.id);
			throw e;
		}
	}

	/**
	 * Writes a game to its note: renames the file on a title change, then sets only the frontmatter
	 * keys whose encoded value differs from the stored state (so unreadable or foreign fields stay
	 * untouched unless this edit changes exactly that field). Creates the note when missing.
	 */
	private async writeGame(g: Game): Promise<void> {
		let file = this.fileOf(g.id);
		if (!file) {
			await this.createNote(g);
			return;
		}
		const indexed = this.index.get(g.id);
		const src = getBaseline(g) ?? this.views.get(g.id)?.base ?? (indexed?.kind === 'game' ? this.normalized(indexed.entry) : undefined);

		if (src && g.title !== src.title) {
			const target = this.layout().notePath('game', g.title);
			if (target !== file.path) {
				if (this.plugin.app.vault.getAbstractFileByPath(target)) {
					new Notice(`"${target}" already exists; the note keeps its old file name.`);
				} else {
					const oldId = g.id;
					await this.plugin.app.fileManager.renameFile(file, target);
					this.index.removeLocal(oldId);
					this.views.delete(oldId);
					if (this.dirty.delete(oldId)) this.dirty.add(this.layout().idFromPath(target));
					g.id = this.layout().idFromPath(target);
					file = this.fileOf(g.id) ?? file;
				}
			}
		}

		const before = src ? this.encode(src) : {};
		const after = this.encode(g);
		const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((k) => !sameJson(before[k], after[k]));
		if (changed.length > 0) {
			const ok = await this.processFrontMatter(file, g, (raw) => {
				for (const key of changed) {
					if (key in after) raw[key] = after[key];
					else delete raw[key];
				}
			});
			// the copy now holds what the note holds for every field it knows
			if (ok) setBaseline(g, structuredClone(g));
		} else {
			const slot = this.views.get(g.id);
			if (slot) slot.view = g;
		}
	}

	private async deleteNote(id: string): Promise<void> {
		const file = this.fileOf(id);
		if (file) await this.plugin.app.fileManager.trashFile(file);
		this.index.removeLocal(id);
		this.views.delete(id);
		this.dirty.delete(id);
	}

	async ensureGameNote(game: Game): Promise<string> {
		if (!this.fileOf(game.id)) await this.createNote(game);
		return this.layout().pathFromId(game.id);
	}

	/** Creates the note only if missing; true when one was created. */
	async createGameNoteIfMissing(game: Game): Promise<boolean> {
		if (this.fileOf(game.id)) return false;
		await this.createNote(game);
		return true;
	}

	/** Writes the game's frontmatter (creates the note when missing); the body stays as is. */
	async writeGameNote(game: Game): Promise<string> {
		await this.writeGame(game);
		return this.layout().pathFromId(game.id);
	}

	/**
	 * Rewrites every plugin-owned frontmatter key of an existing game note, body verbatim. Keys the
	 * encoder omits are removed, except fields the decoder could not read. Does NOT create the file —
	 * returns false then. Used by the bulk "Rewrite all frontmatter" action.
	 */
	async rewriteFrontmatterIfExists(game: Game): Promise<boolean> {
		const file = this.fileOf(game.id);
		if (!file) return false;
		const out = this.encode(game);
		const keep = new Set(this.index.invalidFields(game.id));
		return this.processFrontMatter(file, game, (raw) => {
			for (const key of GAME_KEYS) {
				if (key in out) {
					if (!keep.has(key) || !(key in raw)) raw[key] = out[key];
				} else if (!keep.has(key)) {
					delete raw[key];
				}
			}
		});
	}

	async readGameNote(game: Game): Promise<string | null> {
		const file = this.fileOf(game.id);
		return file ? this.plugin.app.vault.read(file) : null;
	}

	/** Reads the `## Notes` body back from the game's note; null when the file or section is absent. */
	async readGameNotes(game: Game): Promise<string | null> {
		const content = await this.readGameNote(game);
		return content === null ? null : extractNotes(content);
	}

	/** Replaces only the `## Notes` body, creating the note first when absent. */
	async writeGameNotes(game: Game, notesBody: string): Promise<void> {
		await this.ensureGameNote(game);
		const file = this.fileOf(game.id);
		if (!file) return;
		await this.plugin.app.vault.process(file, (content) => replaceNotesSection(content, notesBody));
	}

	async deleteGameNote(game: Game): Promise<void> {
		await this.deleteNote(game.id);
	}
}

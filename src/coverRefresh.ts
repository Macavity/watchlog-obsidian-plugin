import type { ApiService, GameSearchResult } from './ApiService';
import type { ApiCheckQueue } from './apiCheckQueue';
import type { GameDataManager } from './GameDataManager';
import type { ReadingDataManager, ReadingKind } from './ReadingDataManager';
import type { PosterService } from './PosterService';
import type { DataManager } from './DataManager';
import type { Book, Game, Manga } from './types';

export interface GameCover { url: string; source: '' | 'rawg' | 'igdb'; apiId: string }

/**
 * Resolves a game cover through the games APIs: by stored id when the game has one, otherwise (unless
 * `idOnly`) a title search whose first result is taken — returning that result's source + id so the
 * caller can persist them. `source` is '' when there is nothing new to store. Never throws.
 */
export async function resolveGameCover(
	api: ApiService,
	searchSource: 'rawg' | 'igdb',
	game: Game,
	idOnly = false,
): Promise<GameCover> {
	const none: GameCover = { url: '', source: '', apiId: '' };
	try {
		if (game.apiSource && game.apiId) {
			const details = game.apiSource === 'igdb'
				? await api.getIgdbGameDetails(Number(game.apiId))
				: await api.getRawgGameDetails(Number(game.apiId));
			return details?.coverUrl ? { url: details.coverUrl, source: '', apiId: '' } : none;
		}
		if (idOnly) return none;

		// no stored id (added manually or before the field existed) — search by title
		let results: GameSearchResult[] = [];
		if (searchSource === 'igdb') {
			if (!api.hasIgdbCredentials()) return none;
			results = await api.searchIgdbGames(game.title);
		} else {
			if (!api.hasRawgKey()) return none;
			results = await api.searchRawgGames(game.title);
		}
		const first = results[0];
		if (!first || !first.coverUrl) return none;
		return { url: first.coverUrl, source: first.source, apiId: String(first.id) };
	} catch {
		return none;
	}
}

/** The cover of a book (Google Books id) or manga (MAL id); '' without id or cover. Throws on API errors. */
export async function fetchReadingCoverById(api: ApiService, kind: ReadingKind, item: Book | Manga): Promise<string> {
	if (kind === 'book') {
		const gid = (item as Book).googleBooksId;
		return gid ? (await api.getGoogleBookById(gid))?.coverUrl ?? '' : '';
	}
	const malId = (item as Manga).malId;
	return malId ? (await api.getMangaByMalId(Number(malId)))?.coverUrl ?? '' : '';
}

export interface CoverRefreshDeps {
	api: ApiService;
	gamesApiSource: 'rawg' | 'igdb';
	dataManager: Pick<DataManager, 'getTitles'>;
	posterService: Pick<PosterService, 'enqueue'>;
	readingData: Pick<ReadingDataManager, 'getBooks' | 'getMangaList' | 'getBook' | 'getManga' | 'updateBook' | 'updateManga'>;
	gameData: Pick<GameDataManager, 'getGames' | 'getGame' | 'updateGame'>;
	queue: Pick<ApiCheckQueue, 'enqueue'>;
	/** called once with the number of entries to process */
	onStart?: (total: number) => void;
}

export interface CoverRefreshResult { total: number; updated: number; unchanged: number }

/**
 * Bulk refresh: every entry's note image is replaced by the API image, but only when the fetch returned
 * a URL — a field is never cleared, a failed or empty fetch leaves the note alone. Entries without an API
 * id (books, manga, games) are skipped. Reading and games fetches go through the shared throttled queue,
 * title posters through the poster queue.
 */
export async function refreshAllCovers(d: CoverRefreshDeps): Promise<CoverRefreshResult> {
	const titles = d.dataManager.getTitles();
	const books = d.readingData.getBooks();
	const manga = d.readingData.getMangaList();
	const games = d.gameData.getGames();
	const canBooks = d.api.hasGoogleBooksKey();
	const result: CoverRefreshResult = { total: titles.length + books.length + manga.length + games.length, updated: 0, unchanged: 0 };
	d.onStart?.(result.total);

	const jobs: Array<Promise<boolean>> = [];
	for (const t of titles) {
		jobs.push((async () => {
			const before = t.posterUrl;
			const url = await d.posterService.enqueue(t, true);
			return !!url && url !== before;
		})().catch(() => false));
	}
	for (const b of books) {
		if (!b.googleBooksId || !canBooks) { jobs.push(Promise.resolve(false)); continue; }
		const prev = b.coverUrl;
		jobs.push(d.queue.enqueue(async () => {
			const url = await fetchReadingCoverById(d.api, 'book', b);
			const fresh = d.readingData.getBook(b.id);
			if (!url || !fresh) return false;
			await d.readingData.updateBook({ ...fresh, coverUrl: url });
			return url !== prev;
		}).catch(() => false));
	}
	for (const m of manga) {
		if (!m.malId) { jobs.push(Promise.resolve(false)); continue; }
		const prev = m.coverUrl;
		jobs.push(d.queue.enqueue(async () => {
			const url = await fetchReadingCoverById(d.api, 'manga', m);
			const fresh = d.readingData.getManga(m.id);
			if (!url || !fresh) return false;
			await d.readingData.updateManga({ ...fresh, coverUrl: url });
			return url !== prev;
		}).catch(() => false));
	}
	for (const g of games) {
		const prev = g.coverUrl;
		jobs.push(d.queue.enqueue(async () => {
			const res = await resolveGameCover(d.api, d.gamesApiSource, g, true);
			const fresh = d.gameData.getGame(g.id);
			if (!res.url || !fresh) return false;
			await d.gameData.updateGame({ ...fresh, coverUrl: res.url });
			return res.url !== prev;
		}).catch(() => false));
	}
	for (const changed of await Promise.all(jobs)) {
		if (changed) result.updated++;
		else result.unchanged++;
	}
	return result;
}

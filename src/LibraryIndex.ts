import type WatchLogPlugin from './main';
import type { AnimeSearchResult, MediaSearchResult } from './types';
import type { GameSearchResult, BookSearchResult, MangaSearchResult } from './ApiService';
import { imdbIdFromLink } from './types';

export type LibraryScope = 'watchlist' | 'books' | 'manga' | 'games';
export type LibraryName = 'Watchlist' | 'Books' | 'Manga' | 'Games';

// punctuation only — letters/digits of any script survive, so CJK titles still key.
// ascii, latin-1, general punctuation + dashes, minus sign, cjk and fullwidth forms.
const PUNCT = /[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u00a1-\u00bf\u00d7\u00f7\u2010-\u205e\u2212\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g;

/**
 * Comparable form of a title: diacritics folded, punctuation flattened to spaces, lowercased.
 * Articles are kept — dropping them collides too often ("The Office" vs "Office").
 * Returns '' when nothing survives; callers must skip empty keys.
 */
function normalizeTitleKey(title: string): string {
	return title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(PUNCT, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

// ID keys for one search result, in the same vocabulary the index is built with.

export function animeResultIdKeys(r: AnimeSearchResult): string[] {
	const keys = [`mal:${r.malId}`];
	if (r.anilistId) keys.push(`anilist:${r.anilistId}`);
	return keys;
}

/**
 * `MediaSearchResult.imdbId` holds whatever the active API indexes by — a real imdb id under OMDb,
 * a TMDB numeric id under TMDB — so the key depends on which one produced the row.
 */
export function mediaResultIdKeys(r: MediaSearchResult, activeApi: string): string[] {
	if (!r.imdbId) return [];
	return activeApi === 'TMDB'
		? [`tmdb:${r.mediaType}:${r.imdbId}`]
		: [`imdb:${r.imdbId}`];
}

export function gameResultIdKeys(r: GameSearchResult): string[] {
	return [`${r.source}:${r.id}`];
}

export function bookResultIdKeys(r: BookSearchResult): string[] {
	return r.googleBooksId ? [`gbooks:${r.googleBooksId}`] : [];
}

export function mangaResultIdKeys(r: MangaSearchResult): string[] {
	return [`mal:${r.malId}`];
}

/**
 * Lookup table over one or more libraries, built once and thrown away — an add modal holds it for
 * its lifetime, since nothing but the modal itself can change a library while it is open.
 *
 * Matching is exact: external ID first (unambiguous), normalized title second (catches entries added
 * by hand, with no ID to match on). Deliberately not fuzzy — a false "already added" on a sequel
 * would block a legitimate add.
 */
export class LibraryIndex {
	private byId = new Map<string, LibraryName>();
	private byTitle = new Map<string, LibraryName>();

	static build(plugin: WatchLogPlugin, scopes: LibraryScope[]): LibraryIndex {
		const idx = new LibraryIndex();

		for (const scope of scopes) {
			if (scope === 'watchlist') {
				for (const t of plugin.dataManager.getTitles()) {
					const keys: string[] = [];
					if (t.malId) keys.push(`mal:${t.malId}`);
					if (t.anilistId) keys.push(`anilist:${t.anilistId}`);
					if (t.tmdbId && t.tmdbMediaType) keys.push(`tmdb:${t.tmdbMediaType}:${t.tmdbId}`);
					const imdb = imdbIdFromLink(t.externalLink);
					if (imdb) keys.push(`imdb:${imdb}`);
					idx.add('Watchlist', t.title, keys);
				}
			} else if (scope === 'books') {
				for (const b of plugin.readingDataManager.getBooks()) {
					idx.add('Books', b.title, b.googleBooksId ? [`gbooks:${b.googleBooksId}`] : []);
				}
			} else if (scope === 'manga') {
				for (const m of plugin.readingDataManager.getMangaList()) {
					idx.add('Manga', m.title, m.malId ? [`mal:${m.malId}`] : []);
				}
			} else {
				for (const g of plugin.gameDataManager.getGames()) {
					const keys: string[] = [];
					if (g.apiSource && g.apiId) keys.push(`${g.apiSource}:${g.apiId}`);
					if (g.steamAppId) keys.push(`steam:${g.steamAppId}`);
					idx.add('Games', g.title, keys);
				}
			}
		}

		return idx;
	}

	private add(lib: LibraryName, title: string, ids: string[]): void {
		// first writer wins — a title in two libraries reports the one scanned first
		for (const id of ids) {
			if (!this.byId.has(id)) this.byId.set(id, lib);
		}
		const key = normalizeTitleKey(title);
		if (key && !this.byTitle.has(key)) this.byTitle.set(key, lib);
	}

	/** Library already holding this item, or null. */
	lookup(ids: string[], title: string): LibraryName | null {
		for (const id of ids) {
			const hit = this.byId.get(id);
			if (hit) return hit;
		}
		const key = normalizeTitleKey(title);
		if (!key) return null;
		return this.byTitle.get(key) ?? null;
	}
}

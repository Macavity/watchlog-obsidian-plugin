import type WatchLogPlugin from './main';
import type { AnimeSearchResult, MediaSearchResult } from './types';
import { getApiGroupForType } from './types';
import { SEARCH_RESULT_LIMIT } from './ApiService';

export type TitleSearchResult = AnimeSearchResult | MediaSearchResult;

export function isAnimeResult(r: TitleSearchResult): r is AnimeSearchResult {
	return 'malId' in r;
}

/** Searches the API configured for the type; null when the type has none. */
export async function searchTitles(
	plugin: WatchLogPlugin,
	type: string,
	query: string,
	year: string,
): Promise<TitleSearchResult[] | null> {
	const api = plugin.apiService;
	const apiGroup = getApiGroupForType(type, plugin.settings.typeApiMapping);
	if (apiGroup === '') return null;
	if (apiGroup === 'anime') {
		const animeSource = plugin.settings.animeApiSource ?? 'jikan';
		return animeSource === 'anilist'
			? await api.searchAniList(query, year)
			: await api.searchAnime(query, year, SEARCH_RESULT_LIMIT);
	}
	const kind = type === 'Movie' ? 'movie' : 'series';
	return (plugin.settings.activeApi ?? 'OMDb') === 'TMDB'
		? await api.searchTmdb(query, kind, year)
		: await api.searchOmdb(query, kind, year);
}

/** Full movie/TV record for a search row from the active media API. */
export function fetchMediaDetails(
	plugin: WatchLogPlugin,
	result: MediaSearchResult,
): Promise<MediaSearchResult | null> {
	const api = plugin.apiService;
	const tmdb = (plugin.settings.activeApi ?? 'OMDb') === 'TMDB';
	if (result.mediaType === 'tv') {
		return tmdb ? api.getTmdbTvDetails(result.imdbId) : api.getOmdbTvDetails(result.imdbId);
	}
	return tmdb ? api.getTmdbMovieDetails(result.imdbId) : api.getOmdbMovieDetails(result.imdbId);
}

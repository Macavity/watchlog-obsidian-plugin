import type WatchLogPlugin from './main';
import type { MediaFields } from './ui/FormCells';
import type { AnimeSearchResult, MediaSearchResult, Season } from './types';
import { getApiGroupForType } from './types';
import { animeResultIdKeys, mediaResultIdKeys } from './LibraryIndex';
import { SEARCH_PAGE_SIZE, SEARCH_RESULT_LIMIT } from './ApiService';

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

/** "12 eps", or the media type for movies and rows without an episode count. */
export function episodesLabel(result: TitleSearchResult): string {
	if (isAnimeResult(result) || result.episodes > 0) return `${result.episodes} eps`;
	return result.mediaType;
}

/** Library identity keys of a search row. */
export function resultIdKeys(result: TitleSearchResult, activeApi: string): string[] {
	return isAnimeResult(result) ? animeResultIdKeys(result) : mediaResultIdKeys(result, activeApi);
}

/** Form values taken from a search row or its detail record. */
export interface TitlePick {
	title: string;
	episodes: number;
	duration: number;
	releaseDate: string;
	link: string;
	seasons: Season[];
	trailerUrl: string;
	director: string[];
	cast: string[];
	studio: string[];
	/** Anime picks only: exactly one id is set. */
	animeIds?: { malId: number | null; anilistId: number | null };
}

function pickFromMedia(full: MediaSearchResult): TitlePick {
	return {
		title: full.title,
		episodes: full.episodes,
		duration: full.episodeDuration,
		releaseDate: full.releaseDate,
		link: full.url,
		seasons: full.seasons,
		trailerUrl: full.trailerUrl ?? '',
		director: full.director ?? [],
		cast: full.cast ?? [],
		studio: full.studio ?? [],
	};
}

type AnimePickFields = Omit<TitlePick, 'animeIds'>;

function animeFields(anime: AnimeSearchResult): AnimePickFields {
	return {
		title: anime.title,
		episodes: anime.episodes,
		duration: anime.duration,
		releaseDate: anime.releaseDate,
		link: anime.url,
		seasons: anime.seasons,
		trailerUrl: anime.trailerUrl ?? '',
		// anime sources carry no credits, so a pick clears any stale movie/TV selection
		director: [],
		cast: [],
		studio: [],
	};
}

function pickFromAnime(anime: AnimeSearchResult): TitlePick {
	const useAnilist = !!anime.anilistId && anime.anilistId > 0;
	return {
		...animeFields(anime),
		animeIds: useAnilist
			? { malId: null, anilistId: anime.anilistId ?? null }
			: { malId: anime.malId, anilistId: null },
	};
}

/** Fallback when the detail fetch failed: what the search row carried. */
function pickFromRow(result: TitleSearchResult): TitlePick {
	return isAnimeResult(result) ? animeFields(result) : pickFromMedia(result);
}

/**
 * Fetches the details for a selected row and hands the resulting pick to apply. Returns false when
 * the selection went stale and the form must not be touched. A missing detail record applies nothing.
 */
export async function resolvePick(
	plugin: WatchLogPlugin,
	result: TitleSearchResult,
	isCurrent: () => boolean,
	apply: (pick: TitlePick) => void,
): Promise<boolean> {
	if (isAnimeResult(result)) {
		apply(pickFromAnime(result));
		return true;
	}
	try {
		const full = await fetchMediaDetails(plugin, result);
		if (!isCurrent()) return false;
		if (full) apply(pickFromMedia(full));
	} catch {
		if (!isCurrent()) return false;
		apply(pickFromRow(result));
	}
	return true;
}

/** Copies the pick's core values into the form's media fields. */
export function fillMediaFields(media: MediaFields, pick: TitlePick): void {
	media.title = pick.title;
	media.episodes = pick.episodes;
	media.duration = pick.duration;
	media.releaseDate = pick.releaseDate;
	media.link = pick.link;
}

/** Picker settings shared by the add-title and add-maybe modals. */
export function titlePickerBase(
	plugin: WatchLogPlugin,
	selectedType: string,
	onTypeChange: (type: string) => void,
) {
	return {
		placeholder: 'Search for a title...',
		withYear: true,
		pageSize: SEARCH_PAGE_SIZE,
		typeSelect: {
			names: plugin.settings.types.map((t) => t.name),
			selected: selectedType,
			onChange: onTypeChange,
		},
	};
}

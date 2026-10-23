import { describe, it, expect, vi } from 'vitest';
import {
	episodesLabel,
	fillMediaFields,
	titlePickerBase,
	fetchMediaDetails,
	isAnimeResult,
	resolvePick,
	resultIdKeys,
	searchTitles,
	type TitlePick,
} from '../src/titleSearch';
import type { AnimeSearchResult, MediaSearchResult } from '../src/types';
import { SEARCH_RESULT_LIMIT } from '../src/ApiService';

function makePlugin(settings: Record<string, unknown>) {
	const api = {
		searchAniList: vi.fn().mockResolvedValue(['anilist']),
		searchAnime: vi.fn().mockResolvedValue(['jikan']),
		searchTmdb: vi.fn().mockResolvedValue(['tmdb']),
		searchOmdb: vi.fn().mockResolvedValue(['omdb']),
		getTmdbTvDetails: vi.fn().mockResolvedValue('tmdb-tv'),
		getOmdbTvDetails: vi.fn().mockResolvedValue('omdb-tv'),
		getTmdbMovieDetails: vi.fn().mockResolvedValue('tmdb-movie'),
		getOmdbMovieDetails: vi.fn().mockResolvedValue('omdb-movie'),
	};
	return { plugin: { apiService: api, settings } as never, api };
}

const media = (mediaType: 'movie' | 'tv'): MediaSearchResult => ({
	imdbId: 'tt1', title: 't', mediaType, episodes: 0, episodeDuration: 0, releaseDate: '', url: '', seasons: [],
});

describe('searchTitles', () => {
	it('returns null for a type without an API', async () => {
		const { plugin } = makePlugin({ typeApiMapping: {} });
		expect(await searchTitles(plugin, 'Books', 'q', '')).toBeNull();
	});

	it('uses the mapping for custom types', async () => {
		const { plugin, api } = makePlugin({ typeApiMapping: { Docs: 'movie' } });
		expect(await searchTitles(plugin, 'Docs', 'q', '1999')).toEqual(['omdb']);
		expect(api.searchOmdb).toHaveBeenCalledWith('q', 'series', '1999');
	});

	it('searches Jikan with the result limit by default', async () => {
		const { plugin, api } = makePlugin({});
		expect(await searchTitles(plugin, 'Anime', 'q', '2001')).toEqual(['jikan']);
		expect(api.searchAnime).toHaveBeenCalledWith('q', '2001', SEARCH_RESULT_LIMIT);
	});

	it('searches AniList when configured', async () => {
		const { plugin, api } = makePlugin({ animeApiSource: 'anilist' });
		expect(await searchTitles(plugin, 'Anime', 'q', '')).toEqual(['anilist']);
		expect(api.searchAniList).toHaveBeenCalledWith('q', '');
	});

	it('maps Movie to the movie kind on TMDB', async () => {
		const { plugin, api } = makePlugin({ activeApi: 'TMDB' });
		expect(await searchTitles(plugin, 'Movie', 'q', '')).toEqual(['tmdb']);
		expect(api.searchTmdb).toHaveBeenCalledWith('q', 'movie', '');
	});
});

describe('fetchMediaDetails', () => {
	it.each([
		['TMDB', 'tv', 'tmdb-tv'],
		['TMDB', 'movie', 'tmdb-movie'],
		['OMDb', 'tv', 'omdb-tv'],
		[undefined, 'movie', 'omdb-movie'],
	] as const)('%s %s', async (activeApi, mediaType, expected) => {
		const { plugin } = makePlugin({ activeApi });
		expect(await fetchMediaDetails(plugin, media(mediaType))).toBe(expected);
	});
});

describe('isAnimeResult', () => {
	it('detects anime rows by malId', () => {
		expect(isAnimeResult({ malId: 1 } as never)).toBe(true);
		expect(isAnimeResult(media('tv'))).toBe(false);
	});
});

const anime = (over: Partial<AnimeSearchResult> = {}): AnimeSearchResult => ({
	malId: 7, title: 'A', episodes: 12, duration: 24, releaseDate: '2020-01-01', url: 'u', seasons: [], ...over,
});

describe('episodesLabel', () => {
	it('uses the episode count, else the media type', () => {
		expect(episodesLabel(anime({ episodes: 0 }))).toBe('0 eps');
		expect(episodesLabel({ ...media('tv'), episodes: 8 })).toBe('8 eps');
		expect(episodesLabel(media('movie'))).toBe('movie');
	});
});

describe('resultIdKeys', () => {
	it('keys anime by MAL and AniList ids and media by the active API', () => {
		expect(resultIdKeys(anime({ anilistId: 3 }), 'OMDb')).toEqual(['mal:7', 'anilist:3']);
		expect(resultIdKeys(media('tv'), 'TMDB')).toEqual(['tmdb:tv:tt1']);
		expect(resultIdKeys(media('tv'), 'OMDb')).toEqual(['imdb:tt1']);
	});
});

describe('resolvePick', () => {
	const full = { ...media('tv'), title: 'Full', episodeDuration: 40, director: ['D'], studio: ['S'] };

	it('applies an anime pick without fetching', async () => {
		const { plugin, api } = makePlugin({});
		const apply = vi.fn();
		expect(await resolvePick(plugin, anime(), () => true, apply)).toBe(true);
		expect(apply.mock.calls[0]![0].animeIds).toEqual({ malId: 7, anilistId: null });
		expect(api.getOmdbTvDetails).not.toHaveBeenCalled();
	});

	it('prefers AniList ids, falls back to MAL and clears credits', async () => {
		const { plugin } = makePlugin({});
		const apply = vi.fn<(p: TitlePick) => void>();
		await resolvePick(plugin, anime({ anilistId: 3, trailerUrl: 'yt' }), () => true, apply);
		const pick = apply.mock.calls[0]![0];
		expect(pick.animeIds).toEqual({ malId: null, anilistId: 3 });
		expect(pick.trailerUrl).toBe('yt');
		expect([pick.director, pick.cast, pick.studio]).toEqual([[], [], []]);
		await resolvePick(plugin, anime({ anilistId: 0 }), () => true, apply);
		expect(apply.mock.calls[1]![0].animeIds).toEqual({ malId: 7, anilistId: null });
	});

	it('applies the detail record for movie/TV rows', async () => {
		const { plugin, api } = makePlugin({});
		api.getOmdbTvDetails.mockResolvedValue(full);
		const apply = vi.fn<(p: TitlePick) => void>();
		expect(await resolvePick(plugin, media('tv'), () => true, apply)).toBe(true);
		expect(apply.mock.calls[0]![0]).toMatchObject({ title: 'Full', duration: 40, director: ['D'], studio: ['S'], cast: [] });
		expect(apply.mock.calls[0]![0].animeIds).toBeUndefined();
	});

	it('applies nothing when the detail record is missing', async () => {
		const { plugin, api } = makePlugin({});
		api.getOmdbTvDetails.mockResolvedValue(null);
		const apply = vi.fn();
		expect(await resolvePick(plugin, media('tv'), () => true, apply)).toBe(true);
		expect(apply).not.toHaveBeenCalled();
	});

	it('reports a stale selection and applies nothing', async () => {
		const { plugin, api } = makePlugin({});
		api.getOmdbTvDetails.mockResolvedValue(full);
		const apply = vi.fn();
		expect(await resolvePick(plugin, media('tv'), () => false, apply)).toBe(false);
		expect(apply).not.toHaveBeenCalled();
	});

	it('falls back to the search row when the fetch fails', async () => {
		const { plugin, api } = makePlugin({});
		api.getOmdbMovieDetails.mockRejectedValue(new Error('x'));
		const apply = vi.fn<(p: TitlePick) => void>();
		const row = { ...media('movie'), title: 'Row', episodeDuration: 99, cast: ['C'] };
		expect(await resolvePick(plugin, row, () => true, apply)).toBe(true);
		expect(apply.mock.calls[0]![0]).toMatchObject({ title: 'Row', duration: 99, cast: ['C'] });
		expect(await resolvePick(plugin, row, () => false, apply)).toBe(false);
	});
});

describe('fillMediaFields', () => {
	it('copies the core values', () => {
		const target = { title: '', episodes: 0, duration: 0, releaseDate: '', link: '' };
		fillMediaFields(target, { ...pickOf(), title: 'T', episodes: 3, duration: 20, releaseDate: 'd', link: 'l' });
		expect(target).toEqual({ title: 'T', episodes: 3, duration: 20, releaseDate: 'd', link: 'l' });
	});
});

describe('titlePickerBase', () => {
	it('lists the configured types', () => {
		const { plugin } = makePlugin({ types: [{ name: 'Anime' }, { name: 'Movie' }] });
		const base = titlePickerBase(plugin, 'Movie', () => {});
		expect(base.typeSelect).toMatchObject({ names: ['Anime', 'Movie'], selected: 'Movie' });
		expect(base.withYear).toBe(true);
	});
});

function pickOf(): TitlePick {
	return { title: '', episodes: 0, duration: 0, releaseDate: '', link: '', seasons: [], trailerUrl: '', director: [], cast: [], studio: [] };
}

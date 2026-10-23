import { describe, it, expect, vi } from 'vitest';
import { fetchMediaDetails, isAnimeResult, searchTitles } from '../src/titleSearch';
import type { MediaSearchResult } from '../src/types';
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

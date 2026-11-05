import { describe, expect, it, vi } from 'vitest';
import { ApiService, apiSourceFromUrl } from '../src/ApiService';
import { TENRAI_BASE } from '../src/jikanBase';
import { PosterService } from '../src/PosterService';
import { DEFAULT_SETTINGS } from '../src/types';

function spyFetch(svc: any, response: unknown = { data: [] }) {
	return vi.spyOn(svc, 'fetchWithTimeout').mockResolvedValue(response);
}

describe('ApiService Jikan endpoint', () => {
	it('uses Tenrai by default for manga search', async () => {
		const svc = new ApiService('') as any;
		const fetch = spyFetch(svc);
		await svc.searchManga('berserk');
		expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/api\.tenrai\.org\/v1\/manga\?q=berserk/);
	});
	it('uses the endpoint passed to the constructor', async () => {
		const svc = new ApiService('', '', '', '', '', '', '', '', 'https://jikan.example.org/v4') as any;
		const fetch = spyFetch(svc);
		await svc.searchAnime('frieren');
		expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/jikan\.example\.org\/v4\/anime\?q=frieren/);
	});
	it('switches endpoints at runtime via setJikanBase', async () => {
		const svc = new ApiService('') as any;
		svc.setJikanBase('https://jikan.example.org/v4/');
		const fetch = spyFetch(svc);
		await svc.searchManga('berserk');
		expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/jikan\.example\.org\/v4\/manga\?q=berserk/);
		svc.setJikanBase('');
		await svc.searchManga('berserk');
		expect(fetch.mock.calls[1]![0]).toMatch(/^https:\/\/api\.tenrai\.org\/v1\/manga/);
	});
	it('pingJikan checks /anime/1 on the configured endpoint', async () => {
		const svc = new ApiService('') as any;
		const fetch = spyFetch(svc, { data: { mal_id: 1 } });
		expect(await svc.pingJikan()).toBe(true);
		expect(fetch.mock.calls[0]![0]).toBe(`${TENRAI_BASE}/anime/1`);
		fetch.mockResolvedValue({ data: {} });
		expect(await svc.pingJikan()).toBe(false);
	});
	it('classifies responses from the configured base as jikan', () => {
		expect(apiSourceFromUrl(`${TENRAI_BASE}/anime/1`, TENRAI_BASE)).toBe('jikan');
		expect(apiSourceFromUrl('https://jikan.example.org/v4/manga/1', 'https://jikan.example.org/v4')).toBe('jikan');
		expect(apiSourceFromUrl('https://api.jikan.moe/v4/anime/1', TENRAI_BASE)).toBe('unknown');
	});
});

describe('PosterService Jikan endpoint', () => {
	it('fetches anime posters from the configured endpoint', async () => {
		const settings = { ...DEFAULT_SETTINGS, jikanBaseUrl: 'https://jikan.example.org/v4' };
		const svc = new PosterService({} as any, () => settings) as any;
		const fetch = vi.spyOn(svc, 'fetchJson').mockResolvedValue({ data: { images: { jpg: { image_url: 'https://i/1.jpg' } } } });
		await svc.fetchAnimePoster({ title: 'X', malId: 5 });
		expect(fetch.mock.calls[0]![0]).toBe('https://jikan.example.org/v4/anime/5');
	});
	it('defaults to Tenrai when the setting is empty', async () => {
		const svc = new PosterService({} as any, () => ({ ...DEFAULT_SETTINGS })) as any;
		const fetch = vi.spyOn(svc, 'fetchJson').mockResolvedValue({ data: [] });
		await svc.fetchAnimePoster({ title: 'Frieren' });
		expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/api\.tenrai\.org\/v1\/anime\?q=Frieren&limit=1$/);
	});
});

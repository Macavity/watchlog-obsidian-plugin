import { describe, expect, it } from 'vitest';
import { httpsOrEmpty } from '../src/httpsUrl';
import { ApiService } from '../src/ApiService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const svc = new ApiService('') as any;

describe('httpsOrEmpty', () => {
	it('keeps https, drops everything else', () => {
		expect(httpsOrEmpty('https://a.example/x')).toBe('https://a.example/x');
		expect(httpsOrEmpty('http://a.example/x')).toBe('');
		expect(httpsOrEmpty('javascript:alert(1)')).toBe('');
		expect(httpsOrEmpty('data:text/html,x')).toBe('');
		expect(httpsOrEmpty('not a url')).toBe('');
		expect(httpsOrEmpty(undefined)).toBe('');
		expect(httpsOrEmpty(null)).toBe('');
	});
});

describe('API mappers only keep https urls', () => {
	it('Jikan anime', () => {
		const r = svc.mapJikanAnime({
			mal_id: 1, title: 'T', url: 'http://mal/1',
			images: { jpg: { large_image_url: 'javascript:x' } },
		});
		expect(r.url).toBe('');
		expect(r.posterUrl).toBeUndefined();
		const ok = svc.mapJikanAnime({ mal_id: 1, title: 'T', url: 'https://mal/1', images: { jpg: { large_image_url: 'https://i/1.jpg' } } });
		expect(ok.url).toBe('https://mal/1');
		expect(ok.posterUrl).toBe('https://i/1.jpg');
	});
	it('AniList poster', () => {
		expect(svc.mapAniListMedia({ id: 1, coverImage: { large: 'http://i/1' } }).posterUrl).toBeUndefined();
		expect(svc.mapAniListMedia({ id: 1, coverImage: { large: 'https://i/1' } }).posterUrl).toBe('https://i/1');
	});
	it('Jikan manga', () => {
		const r = svc.mapJikanManga({ mal_id: 1, title: 'M', url: 'http://m', images: { jpg: { large_image_url: 'http://c' } } });
		expect(r.url).toBe('https://myanimelist.net/manga/1');
		expect(r.coverUrl).toBe('');
	});
	it('Google Books upgrades http cover, drops other schemes', () => {
		const ok = svc.mapGoogleVolume({ id: 'a', volumeInfo: { title: 'B', imageLinks: { thumbnail: 'http://g/c?zoom=1' }, infoLink: 'https://g/i' } });
		expect(ok.coverUrl.startsWith('https://')).toBe(true);
		expect(ok.url).toBe('https://g/i');
		const bad = svc.mapGoogleVolume({ id: 'a', volumeInfo: { title: 'B', imageLinks: { thumbnail: 'javascript:x' }, infoLink: 'http://g/i' } });
		expect(bad.coverUrl).toBe('');
		expect(bad.url).toBe('');
	});
	it('RAWG and IGDB games', () => {
		const r = svc.mapRawgGame({ id: 1, name: 'G', background_image: 'http://c', slug: 's' });
		expect(r.coverUrl).toBe('');
		expect(r.url).toBe('https://rawg.io/games/s');
		const i = svc.mapIgdbGame({ id: 1, name: 'G', url: 'javascript:x' });
		expect(i.url).toBe('');
		expect(svc.mapIgdbGame({ id: 1, name: 'G', url: 'https://igdb/x' }).url).toBe('https://igdb/x');
	});
});

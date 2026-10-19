import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { isCoverOverride } from '../src/coverOverride';
import { setupReadingDataManager, makeBook, makeManga } from './helpers/setupReadingDataManager';
import { setupGames, makeGame } from './helpers/setupGameDataManager';

const fmOf = (src: string | undefined): Record<string, unknown> =>
	parse(/^---\n([\s\S]*?)\n?---/.exec(src ?? '')?.[1] ?? '') as Record<string, unknown>;

describe('typed cover urls are overrides (E9)', () => {
	it('isCoverOverride: typed differs from API prefill', () => {
		expect(isCoverOverride('https://mine', '')).toBe(true);
		expect(isCoverOverride(' https://mine ', 'https://api')).toBe(true);
		expect(isCoverOverride('https://api', 'https://api')).toBe(false);
		expect(isCoverOverride(' https://api ', 'https://api')).toBe(false);
		expect(isCoverOverride('', 'https://api')).toBe(false);
		expect(isCoverOverride('', '')).toBe(false);
	});

	it('isCoverOverride: an existing override stays while a url is set', () => {
		expect(isCoverOverride('https://api', 'https://api', true)).toBe(true);
		expect(isCoverOverride('', 'https://api', true)).toBe(false);
	});

	it('addBook / addManga: override writes coverUrl, API prefill stays cache-only', async () => {
		const { rdm, f, local } = await setupReadingDataManager({});
		await rdm.addBook(makeBook({ id: rdm.generateBookId('Dune'), title: 'Dune', coverUrl: 'https://mine', coverOverride: true }));
		await rdm.addBook(makeBook({ id: rdm.generateBookId('Emma'), title: 'Emma', coverUrl: 'https://api' }));
		await rdm.addManga(makeManga({ id: rdm.generateMangaId('Berserk'), title: 'Berserk', coverUrl: 'https://mine-m', coverOverride: true }));
		await rdm.addManga(makeManga({ id: rdm.generateMangaId('Akira'), title: 'Akira', coverUrl: 'https://api-m' }));
		await rdm.flushPending();
		const note = (name: string) => fmOf([...f.files].find(([p]) => p.endsWith(`/${name}.md`))?.[1]);
		expect(note('Dune').coverUrl).toBe('https://mine');
		expect(note('Emma')).not.toHaveProperty('coverUrl');
		expect(note('Berserk').coverUrl).toBe('https://mine-m');
		expect(note('Akira')).not.toHaveProperty('coverUrl');
		expect(local.getCache('Books/Emma')?.coverUrl).toBe('https://api');
	});

	it('addGame: override writes coverUrl, API prefill stays cache-only', async () => {
		const { gdm, f, local } = await setupGames({});
		await gdm.addGame(makeGame({ id: gdm.generateGameId('Hades'), title: 'Hades', coverUrl: 'https://mine', coverOverride: true }));
		await gdm.addGame(makeGame({ id: gdm.generateGameId('Celeste'), title: 'Celeste', coverUrl: 'https://api' }));
		await gdm.flushPending();
		const note = (name: string) => fmOf([...f.files].find(([p]) => p.endsWith(`/${name}.md`))?.[1]);
		expect(note('Hades').coverUrl).toBe('https://mine');
		expect(note('Celeste')).not.toHaveProperty('coverUrl');
		expect(local.getCache('Games/Celeste')?.coverUrl).toBe('https://api');
	});
});

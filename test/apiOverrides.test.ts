import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import legacy from './fixtures/data-v1.json';
import { decodeTitle, encodeTitle } from '../src/storage/titleCodec';
import { decodeBook, encodeBook } from '../src/storage/readingCodec';
import { decodeGame, encodeGame } from '../src/storage/gameCodec';
import { getCommunityRating, getDisplayPoster, getDisplayTrailer, getTitleCredits } from '../src/types';
import type { LocalData } from '../src/storage/storageTypes';
import { setupDataManager, makeTitle, tick } from './helpers/setupDataManager';
import { setupReadingDataManager } from './helpers/setupReadingDataManager';
import { setupGames } from './helpers/setupGameDataManager';
import { setupMigration } from './helpers/setupMigration';

const fmOf = (src: string | undefined): Record<string, unknown> =>
	parse(/^---\n([\s\S]*?)\n?---/.exec(src ?? '')?.[1] ?? '') as Record<string, unknown>;

const API_KEYS = ['director', 'cast', 'studio', 'poster', 'trailer', 'communityRating', 'communityVotes', 'communitySource'];

describe('API values live in the cache, note values override (E9)', () => {
	it('title codec: cache values are never encoded', () => {
		const { entry } = decodeTitle('Movie/A', { title: 'A', type: 'Movie' }, {
			director: ['D'], cast: ['C'], studio: ['S'], posterUrl: 'https://p', trailerUrl: 'https://t',
			communityRating: 7, communityVotes: 10, communitySource: 'tmdb',
		});
		expect(getTitleCredits(entry, 'director')).toEqual(['D']);
		expect(getDisplayPoster(entry)).toBe('https://p');
		const out = encodeTitle(entry, 0);
		for (const k of API_KEYS) expect(out, k).not.toHaveProperty(k);
	});

	it('title codec: note fields are overrides that win and round-trip', () => {
		const fm = {
			title: 'A', type: 'Movie', director: ['Mine'], cast: ['X', 'Y'], studio: 'Studio', poster: 'https://mine',
			trailer: 'https://mytrailer', communityRating: 9, communityVotes: 1, communitySource: 'imdb',
		};
		const { entry, invalidFields } = decodeTitle('Movie/A', fm, {
			director: ['D'], posterUrl: 'https://p', trailerUrl: 'https://t', communityRating: 7, communityVotes: 10, communitySource: 'tmdb',
		});
		expect(invalidFields).toEqual([]);
		expect(getTitleCredits(entry, 'director')).toEqual(['Mine']);
		expect(getTitleCredits(entry, 'studio')).toEqual(['Studio']);
		expect(getDisplayPoster(entry)).toBe('https://mine');
		expect(getDisplayTrailer(entry)).toBe('https://mytrailer');
		expect(getCommunityRating(entry)).toEqual({ rating: 9, votes: 1, source: 'imdb' });
		// the API values stay where they were
		expect(entry.director).toEqual(['D']);
		expect(entry.posterUrl).toBe('https://p');
		const out = encodeTitle(entry, 0);
		expect(out).toMatchObject({ director: ['Mine'], cast: ['X', 'Y'], studio: ['Studio'], poster: 'https://mine', trailer: 'https://mytrailer', communityRating: 9, communityVotes: 1, communitySource: 'imdb' });
	});

	it('title codec: a manual poster is written as the poster override', () => {
		const t = makeTitle({ title: 'A', type: 'Movie', posterUrl: 'https://api', manualPosterUrl: 'https://mine' });
		const out = encodeTitle(t, 0);
		expect(out.poster).toBe('https://mine');
		expect(out).not.toHaveProperty('manualPosterUrl');
		// notes written before still read
		expect(decodeTitle('Movie/A', { title: 'A', manualPosterUrl: 'https://old' }, undefined).entry.manualPosterUrl).toBe('https://old');
	});

	it('reading and game codecs: coverUrl in the note is an override, else not encoded', () => {
		const book = decodeBook('Books/Dune', { title: 'Dune', coverUrl: 'https://mine' }).entry;
		expect(book.coverOverride).toBe(true);
		expect(encodeBook(book).coverUrl).toBe('https://mine');
		const plain = decodeBook('Books/Dune', { title: 'Dune' }).entry;
		expect(encodeBook({ ...plain, coverUrl: 'https://api' })).not.toHaveProperty('coverUrl');
		const game = decodeGame('Games/Hades', { title: 'Hades' }).entry;
		expect(encodeGame({ ...game, coverUrl: 'https://api' })).not.toHaveProperty('coverUrl');
		expect(encodeGame({ ...game, coverUrl: 'https://mine', coverOverride: true }).coverUrl).toBe('https://mine');
	});

	it('credits backfill writes only the cache', async () => {
		const note = '---\ntitle: A\ntype: Movie\nexternalLink: https://www.imdb.com/title/tt1\n---\n';
		const { dm, f, local } = await setupDataManager({ 'W/Movie/A.md': note });
		await dm.updateCredits('Movie/A', ['Dir'], ['Act']);
		await dm.updateStudio('Movie/A', ['Std']);
		expect(f.files.get('W/Movie/A.md')).toBe(note);
		expect(local.getCache('Movie/A')).toMatchObject({ director: ['Dir'], cast: ['Act'], studio: ['Std'] });
		expect(getTitleCredits(dm.getTitle('Movie/A')!, 'director')).toEqual(['Dir']);
	});

	it('a note override wins over the cache and survives edits', async () => {
		const { dm, f, local } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\ndirector: [Mine]\n---\n' });
		await dm.updateCredits('Movie/A', ['Dir'], ['Act']);
		expect(getTitleCredits(dm.getTitle('Movie/A')!, 'director')).toEqual(['Mine']);
		expect(local.getCache('Movie/A')?.director).toEqual(['Dir']);
		const t = dm.getTitle('Movie/A')!;
		t.rating = 3;
		await dm.updateTitle(t);
		const fm = fmOf(f.files.get('W/Movie/A.md'));
		expect(fm.director).toEqual(['Mine']);
		expect(fm).not.toHaveProperty('cast');
	});

	it('adding a title keeps fetched values out of the note', async () => {
		const { dm, f, local } = await setupDataManager({});
		await dm.addTitle(makeTitle({ title: 'A', type: 'Movie', director: ['Dir'], posterUrl: 'https://p', trailerUrl: 'https://t', communityRating: 7, communitySource: 'tmdb' }));
		const fm = fmOf(f.files.get('W/Movie/A.md'));
		for (const k of API_KEYS) expect(fm, k).not.toHaveProperty(k);
		expect(local.getCache('Movie/A')).toMatchObject({ director: ['Dir'], posterUrl: 'https://p' });
	});

	it('lazy reading cover fetch writes no note and shows the cached cover', async () => {
		const note = '---\ntitle: Dune\nstatus: Reading\ntype: book\n---\n';
		const { rdm, f, local } = await setupReadingDataManager({ 'W/Books/Dune.md': note });
		rdm.updateCoverUrl('book', 'Books/Dune', 'https://cover');
		await rdm.flushPending();
		await tick(50);
		expect(f.files.get('W/Books/Dune.md')).toBe(note);
		expect(local.getCache('Books/Dune')?.coverUrl).toBe('https://cover');
		const book = rdm.getBook('Books/Dune')!;
		book.rating = 4;
		await rdm.updateBook(book);
		expect(fmOf(f.files.get('W/Books/Dune.md'))).not.toHaveProperty('coverUrl');
		expect(rdm.getBook('Books/Dune')?.coverUrl).toBe('https://cover');
	});

	it('lazy game cover fetch writes no note; a note cover wins', async () => {
		const hades = '---\ntitle: Hades\nstatus: Playing\ntype: game\n---\n';
		const celeste = '---\ntitle: Celeste\nstatus: Playing\ncoverUrl: https://mine\ntype: game\n---\n';
		const { gdm, f, local } = await setupGames({ 'W/Games/Hades.md': hades, 'W/Games/Celeste.md': celeste });
		gdm.updateCoverUrl('Games/Hades', 'https://cover');
		await gdm.flushPending();
		expect(f.files.get('W/Games/Hades.md')).toBe(hades);
		expect(local.getCache('Games/Hades')?.coverUrl).toBe('https://cover');
		local.setCache('Games/Celeste', { coverUrl: 'https://api' });
		expect(gdm.getGame('Games/Celeste')?.coverUrl).toBe('https://mine');
	});

	it('migration strips note values equal to the legacy API value and keeps differing ones', async () => {
		const original = (director: string, poster: string): string =>
			`---\ntitle: "A"\ntype: "Movie"\nstatus: "Completed"\nrating: 2\ndirector: [${director}]\nposter: ${poster}\n---\n\n## Notes\n`;
		for (const joined of [false, true]) {
			const files: Record<string, string> = {
				'WatchLog/Movie/A.md': original('Some Director', 'https://img.example/a.jpg'),
				'WatchLog/Movie/Das doppelte Lottchen.md': '---\ntitle: "Das doppelte Lottchen"\ntype: "Movie"\ndirector: [Mine]\n---\n',
				'WatchLog/Books/Dune.md': '---\ntitle: "Dune"\ntype: book\ncoverUrl: https://legacy-cover\n---\n',
			};
			let setup = await setupMigration(withCovers(), files);
			if (joined) {
				const first = await setupMigration(withCovers(), {});
				await first.run();
				setup = await setupMigration(withCovers(), { ...files, 'WatchLog/WatchLog.base': first.f.files.get('WatchLog/WatchLog.base')! });
			}
			const r = await setup.run();
			expect(r.errors).toEqual([]);
			const a = fmOf(setup.f.files.get('WatchLog/Movie/A.md'));
			expect(a, `joined=${joined}`).not.toHaveProperty('director');
			expect(a, `joined=${joined}`).not.toHaveProperty('poster');
			expect(fmOf(setup.f.files.get('WatchLog/Movie/Das doppelte Lottchen.md')).director).toEqual(['Mine']);
			expect(fmOf(setup.f.files.get('WatchLog/Books/Dune.md')), `joined=${joined}`).not.toHaveProperty('coverUrl');
			const data = setup.f.plugin.data as LocalData;
			expect(data.cache['Movie/A']).toMatchObject({ director: ['Some Director'], posterUrl: 'https://img.example/a.jpg' });
			expect(data.cache['Books/Dune']?.coverUrl).toBe('https://legacy-cover');
		}
	});
});

/** The fixture with a legacy cover on the book. */
function withCovers(): typeof legacy {
	const data = structuredClone(legacy);
	const dune = data.reading.books[0] as { coverUrl: string };
	dune.coverUrl = 'https://legacy-cover';
	return data;
}

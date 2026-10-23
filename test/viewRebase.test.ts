import { describe, it, expect, vi } from 'vitest';
import { setupDataManager } from './helpers/setupDataManager';
import { tick } from './helpers/common';
import { setupGames } from './helpers/setupGameDataManager';
import { setupReadingDataManager } from './helpers/setupReadingDataManager';
import type { ApiOutcome } from '../src/ApiService';
import type { Season } from '../src/types';

const DARK = '---\ntitle: Dark\ntype: TV Show\nseasons: ["Season 1: 10"]\nwatched: S01E01-E04\n---\n';

describe('views follow the stored state', () => {
	it('a stale copy saved after a toggle does not become the view', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': DARK });
		const view = dm.getTitle('TV Show/Dark')!;
		const modal = { ...view, watchedEpisodes: [...view.watchedEpisodes] };
		await dm.markEpisodeWatched('TV Show/Dark', 5, true);
		await tick();
		await dm.updateTitle({ ...modal, review: 'nice' });
		await tick();
		expect(f.files.get('W/TV Show/Dark.md')).toMatch(/watched: S01E01-E05/);
		await dm.markEpisodeWatched('TV Show/Dark', 6, true);
		await tick();
		const note = f.files.get('W/TV Show/Dark.md')!;
		expect(note).toMatch(/watched: S01E01-E06/);
		expect(note).toContain('review: nice');
	});

	it('a copy saved after an external change does not become the view', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': DARK });
		const modal = { ...dm.getTitle('TV Show/Dark')! };
		f.externalWrite('W/TV Show/Dark.md', DARK.replace('S01E01-E04', 'S01E01-E05'));
		await tick();
		await dm.updateTitle({ ...modal, review: 'x' });
		await tick();
		expect(dm.getTitle('TV Show/Dark')!.watchedEpisodes).toEqual([1, 2, 3, 4, 5]);
		await dm.markEpisodeWatched('TV Show/Dark', 6, true);
		await tick();
		expect(f.files.get('W/TV Show/Dark.md')).toMatch(/watched: S01E01-E06/);
	});

	it('a stale game copy does not become the view', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/Hades.md': '---\ntitle: Hades\ntype: game\nrating: 1\n---\n' });
		const copy = { ...gdm.getGame('Games/Hades')! };
		await gdm.updateGame({ ...gdm.getGame('Games/Hades')!, rating: 3 });
		await tick();
		await gdm.updateGame({ ...copy, progress: 50 });
		await tick();
		expect(gdm.getGame('Games/Hades')!.rating).toBe(3);
		await gdm.updateGame({ ...gdm.getGame('Games/Hades')!, priority: 'High' });
		await tick();
		const note = f.files.get('W/Games/Hades.md')!;
		expect(note).toMatch(/rating: 3/);
		expect(note).toMatch(/progress: 50/);
	});

	it('a stale reading copy does not become the view', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\npagesRead: 1\n---\n' });
		const copy = { ...rdm.getBook('Books/Dune')! };
		await rdm.updateBook({ ...rdm.getBook('Books/Dune')!, pagesRead: 5 });
		await tick();
		await rdm.updateBook({ ...copy, rating: 4 });
		await tick();
		expect(rdm.getBook('Books/Dune')!.pagesRead).toBe(5);
		await rdm.updateBook({ ...rdm.getBook('Books/Dune')!, totalPages: 100 });
		await tick();
		const note = f.files.get('W/Books/Dune.md')!;
		expect(note).toMatch(/pagesRead: 5/);
		expect(note).toMatch(/rating: 4/);
	});
});

describe('cache writes merge', () => {
	const NOTE = '---\ntitle: Dark\ntype: TV Show\nexternalId: tmdb:tv:1\n---\n';
	const check = () => ({ seasons: { at: new Date().toISOString(), result: 'notfound' as const } });

	it('a user edit keeps apiCheck and airing', async () => {
		const { dm, local } = await setupDataManager({ 'W/TV Show/Dark.md': NOTE });
		const airing = { nextEpisode: 3, refreshedAt: new Date().toISOString() };
		local.setCache('TV Show/Dark', { apiCheck: check(), airing });
		await dm.updateTitle({ ...dm.getTitle('TV Show/Dark')!, rating: 3 });
		expect(local.getCache('TV Show/Dark')?.apiCheck?.seasons?.result).toBe('notfound');
		expect(local.getCache('TV Show/Dark')?.airing).toEqual(airing);
	});

	it('save() keeps apiCheck', async () => {
		const { dm, local } = await setupDataManager({ 'W/TV Show/Dark.md': NOTE });
		local.setCache('TV Show/Dark', { apiCheck: check() });
		dm.getTitles();
		await dm.save();
		expect(local.getCache('TV Show/Dark')?.apiCheck?.seasons?.result).toBe('notfound');
	});

	it('save() with a view from before the refill keeps the refilled seasons', async () => {
		const { dm, local, index } = await setupDataManager({ 'W/TV Show/Dark.md': NOTE.replace('tmdb:tv:1\n', 'tmdb:tv:1\nwatched: S01E01-E03\n') });
		dm.getTitles();
		local.setCache('TV Show/Dark', { seasons: [{ name: 'Season 1', episodes: 10, offset: 0 }] });
		await index.rebuild();
		await dm.save();
		expect(local.getCache('TV Show/Dark')?.seasons).toEqual([{ name: 'Season 1', episodes: 10, offset: 0 }]);
	});

	for (const status of ['notfound', 'nokey'] as const) {
		it(`two toggles after a ${status} refill both persist`, async () => {
			const fetchSeasons = vi.fn(() => Promise.resolve<ApiOutcome<Season[]>>({ status }));
			const { dm, f } = await setupDataManager(
				{ 'W/TV Show/N.md': '---\ntitle: N\ntype: TV Show\nexternalId: tmdb:tv:1\ntotalEpisodes: 10\n---\n' },
				{ apiService: { fetchSeasons } },
			);
			await tick();
			await dm.markEpisodeWatched('TV Show/N', 1, true);
			await dm.markEpisodeWatched('TV Show/N', 2, true);
			expect(f.files.get('W/TV Show/N.md')).toContain('watched: S01E01-E02');
			expect(fetchSeasons).toHaveBeenCalledTimes(1);
		});
	}
});

describe('background fills are no user writes', () => {
	it('a poster fill does not count as a user write; the refresh does', async () => {
		const { dm, index } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n' });
		const cb = vi.fn();
		index.onLocalWrite(cb);
		await dm.updatePosterUrl('Movie/A', 'https://img/p.jpg');
		expect(cb).not.toHaveBeenCalled();
		await dm.updatePosterUrl('Movie/A', 'https://img/q.jpg', true);
		expect(cb).toHaveBeenCalled();
	});

	it('cover fills of games and books do not count as user writes', async () => {
		const games = await setupGames({ 'W/Games/Hades.md': '---\ntitle: Hades\ntype: game\n---\n' });
		const gcb = vi.fn();
		games.index.onLocalWrite(gcb);
		await games.gdm.updateCoverUrl('Games/Hades', 'https://img/c.jpg');
		expect(games.f.files.get('W/Games/Hades.md')).toContain('coverUrl: https://img/c.jpg');
		expect(gcb).not.toHaveBeenCalled();
		const reading = await setupReadingDataManager({ 'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\n---\n' });
		const rcb = vi.fn();
		reading.index.onLocalWrite(rcb);
		await reading.rdm.updateCoverUrl('book', 'Books/Dune', 'https://img/c.jpg');
		expect(reading.f.files.get('W/Books/Dune.md')).toContain('coverUrl: https://img/c.jpg');
		expect(rcb).not.toHaveBeenCalled();
	});

	it('a stale copy does not undo a note body edited on another device', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': DARK + '\n## Notes\n\nold\n' });
		await tick();
		const modal = { ...dm.getTitle('TV Show/Dark')! };
		expect(modal.notes).toBe('old');
		f.externalWrite('W/TV Show/Dark.md', DARK + '\n## Notes\n\nremote\n');
		await tick();
		await dm.updateTitle({ ...modal, review: 'x' });
		await tick();
		expect(f.files.get('W/TV Show/Dark.md')).toContain('remote');
		expect(f.files.get('W/TV Show/Dark.md')).not.toMatch(/\nold\n/);
		// an edit made in the copy itself still wins
		await dm.updateTitle({ ...dm.getTitle('TV Show/Dark')!, notes: 'mine' });
		await tick();
		expect(f.files.get('W/TV Show/Dark.md')).toContain('mine');
	});
});

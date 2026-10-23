import { describe, it, expect, vi } from 'vitest';
import { setupDataManager } from './helpers/setupDataManager';
import { tick } from './helpers/common';
import type { ApiOutcome } from '../src/ApiService';
import type { Season } from '../src/types';

const DARK = '---\ntitle: Dark\ntype: TV Show\nstatus: Completed\nexternalId: tmdb:tv:70523\ntotalEpisodes: 16\n'
	+ 'watched: S01E01-E08, S02E01-E08\nprogress: 100%\n---\n';
const TWO: Season[] = [{ name: 'Season 1', episodes: 8, offset: 0 }, { name: 'Season 2', episodes: 8, offset: 8 }];

describe('season refill', () => {
	it('second device: refills seasons, blocks toggles until then', async () => {
		let release!: (s: Season[]) => void;
		const fetchSeasons = vi.fn(() => new Promise<ApiOutcome<Season[]>>((r) => { release = (value) => r({ status: 'ok', value }); }));
		const { dm, f, local } = await setupDataManager({ 'W/TV Show/Dark.md': DARK }, { apiService: { fetchSeasons } });
		expect(fetchSeasons).toHaveBeenCalledTimes(1);

		// seasons unknown: a toggle changes nothing in the note
		await dm.markEpisodeWatched('TV Show/Dark', 3, false);
		await dm.markSeasonWatched('TV Show/Dark', [1, 2], false);
		expect(dm.applyEpisodeWatchedToggle('TV Show/Dark', 4, false)).toBeNull();
		await tick(700);
		expect(f.files.get('W/TV Show/Dark.md')).toBe(DARK);

		release(TWO);
		await tick();
		expect(local.getCache('TV Show/Dark')?.seasons).toEqual(TWO);
		const t = dm.getTitle('TV Show/Dark')!;
		expect(t.watchedEpisodes).toHaveLength(16);

		await dm.markEpisodeWatched('TV Show/Dark', 3, false);
		const content = f.files.get('W/TV Show/Dark.md')!;
		expect(content).toContain('watched: S01E01-E02, S01E04-E08, S02E01-E08');
		expect(content).toContain('status: Watching');
		expect(content).toContain('progress: 94%');
		expect(fetchSeasons).toHaveBeenCalledTimes(1);
	});

	it('stale cache: episodes of unknown seasons survive a toggle', async () => {
		const { dm, f, local } = await setupDataManager({});
		local.setCache('TV Show/Dark', { seasons: [{ name: 'Season 1', episodes: 8, offset: 0 }] });
		f.externalWrite('W/TV Show/Dark.md', '---\ntitle: Dark\ntype: TV Show\nstatus: Watching\nexternalId: tmdb:tv:70523\nwatched: S01E01-E08, S02E01\n---\n');
		await tick();
		await dm.markEpisodeWatched('TV Show/Dark', 1, false);
		expect(f.files.get('W/TV Show/Dark.md')).toContain('watched: S01E02-E08, S02E01');
	});

	it('stale cache: episodes beyond the cached season length survive a toggle', async () => {
		const { dm, f, local } = await setupDataManager({});
		local.setCache('TV Show/Dark', { seasons: [{ name: 'Season 1', episodes: 8, offset: 0 }] });
		f.externalWrite('W/TV Show/Dark.md', '---\ntitle: Dark\ntype: TV Show\nstatus: Watching\nexternalId: tmdb:tv:70523\nwatched: S01E01-E10\n---\n');
		await tick();
		await dm.markEpisodeWatched('TV Show/Dark', 3, false);
		expect(f.files.get('W/TV Show/Dark.md')).toContain('watched: S01E01-E02, S01E04-E10');
	});

	it('full rewrite keeps output fields the cache does not know', async () => {
		const note = '---\ntitle: Dune\ntype: Movie\nexternalId: tmdb:movie:438631\nposter: https://p/x.jpg\n'
			+ 'trailer: https://youtu.be/x\ndirector: [Denis Villeneuve]\ncast: [Zendaya]\nstudio: [Legendary]\n'
			+ 'communityRating: 8.1\ncommunityVotes: 900\ncommunitySource: tmdb\n---\n';
		const { dm, f } = await setupDataManager({ 'W/Movie/Dune.md': note });
		const t = dm.getTitle('Movie/Dune')!;
		expect(await dm.rewriteFrontmatterIfExists(t)).toBe(true);
		const content = f.files.get('W/Movie/Dune.md')!;
		for (const line of ['poster: https://p/x.jpg', 'trailer: https://youtu.be/x', 'Denis Villeneuve', 'Zendaya',
			'Legendary', 'communityRating: 8.1', 'communityVotes: 900', 'communitySource: tmdb']) {
			expect(content).toContain(line);
		}
	});

	it('full rewrite keeps progress while seasons are unknown', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': DARK });
		expect(await dm.rewriteFrontmatterIfExists(dm.getTitle('TV Show/Dark')!)).toBe(true);
		expect(f.files.get('W/TV Show/Dark.md')).toContain('progress: 100%');
	});
});

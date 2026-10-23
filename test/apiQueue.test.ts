import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupDataManager } from './helpers/setupDataManager';
import { ApiCheckQueue } from '../src/apiCheckQueue';
import { DataManager } from '../src/DataManager';
import { ApiService } from '../src/ApiService';
import type { ApiOutcome } from '../src/ApiService';
import type { EntryCache } from '../src/storage/storageTypes';
import type { Season } from '../src/types';

type Airing = NonNullable<EntryCache['airing']>;
const HOUR = 3_600_000;
// later than the real clock, so setup-time queue starts never delay the first faked one
const START = new Date('2030-10-19T12:00:00Z');
const show = (n: number) => `---\ntitle: S${n}\ntype: TV Show\nexternalId: tmdb:tv:${n + 1}\nairtimeRecurrence: daily\nseasons:\n  - 'S1: 8'\n---\n`;
const okAiring = (): ApiOutcome<Airing> => ({ status: 'ok', value: { nextEpisode: 2, refreshedAt: new Date().toISOString() } });

async function setup(files: Record<string, string>, fetchAiring: () => Promise<ApiOutcome<Airing>>) {
	const s = await setupDataManager(files, { apiService: { fetchAiring, fetchSeasons: () => Promise.resolve({ status: 'notfound' }) } });
	return s;
}

afterEach(() => {
	vi.useRealTimers();
});

describe('ApiCheckQueue', () => {
	it('runs at most 2 tasks at once, starts 250 ms apart', async () => {
		vi.useFakeTimers({ now: START });
		const queue = new ApiCheckQueue();
		const starts: number[] = [];
		let running = 0;
		let peak = 0;
		const task = async () => {
			starts.push(Date.now());
			peak = Math.max(peak, ++running);
			await new Promise((r) => setTimeout(r, 1000));
			running--;
		};
		const all = Promise.all(Array.from({ length: 10 }, () => queue.enqueue(task)));
		await vi.runAllTimersAsync();
		await all;
		expect(starts).toHaveLength(10);
		expect(peak).toBe(2);
		for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(250);
	});

	it('a failing task does not block the queue', async () => {
		const queue = new ApiCheckQueue();
		await expect(queue.enqueue(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
		await expect(queue.enqueue(() => Promise.resolve(1))).resolves.toBe(1);
	});
});

describe('API checks in DataManager', () => {
	it('200 entries: never more than 2 requests at once', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 200; i++) files[`W/TV Show/S${i}.md`] = show(i);
		let running = 0;
		let peak = 0;
		let done = 0;
		const fetchAiring = async (): Promise<ApiOutcome<Airing>> => {
			peak = Math.max(peak, ++running);
			await new Promise((r) => setTimeout(r, 600));
			running--;
			done++;
			return okAiring();
		};
		const { dm } = await setup(files, fetchAiring);
		vi.useFakeTimers({ now: START });
		const all = Promise.all(Array.from({ length: 200 }, (_, i) => dm.refreshAiring(`TV Show/S${i}`)));
		await vi.runAllTimersAsync();
		await all;
		expect(done).toBe(200);
		expect(peak).toBe(2);
	});

	it('persists a transient failure and honours it after a restart', async () => {
		const fetchAiring = vi.fn((): Promise<ApiOutcome<Airing>> => Promise.resolve({ status: 'transient' }));
		const { dm, local, plugin, index, shared, layout } = await setup({ 'W/TV Show/C.md': show(1) }, fetchAiring);
		vi.useFakeTimers({ now: START });
		await dm.refreshAiring('TV Show/C');
		expect(local.getCache('TV Show/C')?.apiCheck?.airing).toEqual({ at: START.toISOString(), result: 'transient' });

		const restarted = new DataManager(plugin, { index, local, shared, layout: () => layout });
		vi.setSystemTime(new Date(START.getTime() + 59 * 60_000));
		await restarted.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date(START.getTime() + HOUR + 1000));
		await restarted.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(2);
	});

	it('deadlines: ok 6 h, notfound 7 d, nokey until the key changes; force skips only the deadline', async () => {
		let next: ApiOutcome<Airing> = okAiring();
		const fetchAiring = vi.fn(() => Promise.resolve(next));
		const { dm, local } = await setup({ 'W/TV Show/C.md': show(1) }, fetchAiring);
		vi.useFakeTimers({ now: START });
		const at = (ms: number) => vi.setSystemTime(new Date(START.getTime() + ms));

		await dm.refreshAiring('TV Show/C');
		at(5 * HOUR);
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(1);
		at(6 * HOUR + 1000);
		next = { status: 'notfound' };
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(2);
		expect(local.getCache('TV Show/C')?.airing?.nextEpisode).toBe(2);

		at(6 * HOUR + 1000 + 6 * 24 * HOUR);
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(2);
		await dm.refreshAiring('TV Show/C', true);
		expect(fetchAiring).toHaveBeenCalledTimes(3);

		at(6 * HOUR + 1000 + 14 * 24 * HOUR);
		next = { status: 'nokey' };
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(4);
		at(60 * 24 * HOUR);
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(4);
		dm.resetNoKeyChecks();
		next = okAiring();
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(5);
	});

	it('season refill: failure is persisted, not retried within the deadline, even after a restart', async () => {
		const fetchSeasons = vi.fn((): Promise<ApiOutcome<Season[]>> => Promise.resolve({ status: 'transient' }));
		const note = '---\ntitle: Dark\ntype: TV Show\nexternalId: tmdb:tv:70523\nwatched: S01E01\n---\n';
		const { dm, local, plugin, index, shared, layout } = await setupDataManager({ 'W/TV Show/Dark.md': note }, { apiService: { fetchSeasons } });
		await vi.waitFor(() => expect(local.getCache('TV Show/Dark')?.apiCheck?.seasons?.result).toBe('transient'));
		expect(fetchSeasons).toHaveBeenCalledTimes(1);
		await dm.markEpisodeWatched('TV Show/Dark', 3, false);
		expect(fetchSeasons).toHaveBeenCalledTimes(1);
		const restarted = new DataManager(plugin, { index, local, shared, layout: () => layout });
		await restarted.init();
		await new Promise((r) => setTimeout(r, 50));
		expect(fetchSeasons).toHaveBeenCalledTimes(1);
	});
});

describe('ApiService outcomes', () => {
	it('fetchAiring: nokey without TMDB key, notfound without a source', async () => {
		const api = new ApiService('', '');
		expect(await api.fetchAiring({ tmdbId: 1, tmdbMediaType: 'tv' })).toEqual({ status: 'nokey' });
		expect(await api.fetchAiring({})).toEqual({ status: 'notfound' });
	});

	it('fetchSeasons: nokey for TMDB without key, notfound for movies and no identity', async () => {
		const api = new ApiService('', '');
		expect(await api.fetchSeasons({ tmdbId: 1, tmdbMediaType: 'tv', externalLink: '' })).toEqual({ status: 'nokey' });
		expect(await api.fetchSeasons({ tmdbId: 1, tmdbMediaType: 'movie', externalLink: '' })).toEqual({ status: 'notfound' });
		expect(await api.fetchSeasons({ externalLink: '' })).toEqual({ status: 'notfound' });
	});
});

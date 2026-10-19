import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupDataManager } from './helpers/setupDataManager';
import { runAirtimeScheduler } from '../src/airtimeScheduler';
import type { EntryCache } from '../src/storage/storageTypes';

const SHOW = 'W/TV Show/C.md';
const showNote = (extra = '') =>
	`---\ntitle: C\ntype: TV Show\nexternalId: tmdb:tv:1399\nairtimeRecurrence: daily\nairtimeTime: 20:15\nairtimeSeason: 2\nairtimeEpisode: 5\n${extra}---\n`;

async function setup(files: Record<string, string>, fetchAiring = vi.fn((): Promise<EntryCache['airing'] | null> => Promise.resolve(null))) {
	const s = await setupDataManager(files);
	(s.plugin as unknown as Record<string, unknown>).apiService = { fetchAiring };
	return { ...s, fetchAiring };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('airing pointer from the API cache', () => {
	it('shows the cached next episode over the note pointer', async () => {
		const { dm, local } = await setup({ [SHOW]: showNote() });
		local.setCache('TV Show/C', { airing: { nextSeason: 3, nextEpisode: 7, refreshedAt: new Date().toISOString() } });
		expect(dm.getAirtimeEntries()[0]).toMatchObject({ currentSeason: 3, currentEpisode: 7 });
	});

	it('keeps the note pointer without an airing cache', async () => {
		const { dm } = await setup({ [SHOW]: showNote() });
		expect(dm.getAirtimeEntries()[0]).toMatchObject({ currentSeason: 2, currentEpisode: 5 });
	});

	it('tick on an API entry writes only airtimeAcknowledged', async () => {
		const { dm, f, local } = await setup({ [SHOW]: showNote() });
		local.setCache('TV Show/C', { airing: { nextSeason: 3, nextEpisode: 7, refreshedAt: new Date().toISOString() } });
		const before = f.files.get(SHOW)!;
		await dm.tickAirtimeEntry(dm.getAirtimeEntries()[0]!, '2026-10-19');
		const after = f.files.get(SHOW)!;
		expect(after).toMatch(/airtimeAcknowledged: 2026-10-19/);
		expect(after.replace(/airtimeAcknowledged: 2026-10-19\n/, '')).toBe(before);
		expect(dm.getAirtimeEntries()[0]).toMatchObject({ currentEpisode: 7, lastAcknowledgedDate: '2026-10-19' });
	});

	it('tick without API advances airtimeEpisode', async () => {
		const { dm, f } = await setup({ [SHOW]: showNote() });
		await dm.tickAirtimeEntry(dm.getAirtimeEntries()[0]!, '2026-10-19');
		expect(f.files.get(SHOW)).toMatch(/airtimeEpisode: 6/);
		expect(f.files.get(SHOW)).toMatch(/airtimeAcknowledged: 2026-10-19/);
	});

	it('refreshes at most every 6 h unless forced, writing only the cache', async () => {
		const airing = { nextSeason: 3, nextEpisode: 8, refreshedAt: '' };
		const fetchAiring = vi.fn(() => Promise.resolve({ ...airing, refreshedAt: new Date().toISOString() }));
		const { dm, f, local } = await setup({ [SHOW]: showNote() }, fetchAiring);
		const before = new Map(f.files);
		vi.useFakeTimers({ now: new Date('2026-10-19T12:00:00Z') });
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(1);
		expect(local.getCache('TV Show/C')?.airing?.nextEpisode).toBe(8);
		await dm.refreshAiring('TV Show/C');
		vi.setSystemTime(new Date('2026-10-19T17:59:00Z'));
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(1);
		await dm.refreshAiring('TV Show/C', true);
		expect(fetchAiring).toHaveBeenCalledTimes(2);
		vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(3);
		expect(f.files).toEqual(before);
	});

	it('does not retry a failed refresh within 6 h', async () => {
		const { dm, fetchAiring } = await setup({ [SHOW]: showNote() });
		vi.useFakeTimers({ now: new Date('2026-10-19T12:00:00Z') });
		await dm.refreshAiring('TV Show/C');
		await dm.refreshAiring('TV Show/C');
		expect(fetchAiring).toHaveBeenCalledTimes(1);
	});

	it('keeps the airing cache when the title is written', async () => {
		const { dm, local } = await setup({ [SHOW]: showNote() });
		local.setCache('TV Show/C', { airing: { nextEpisode: 7, refreshedAt: '2026-10-19T00:00:00Z' } });
		const t = dm.getTitle('TV Show/C')!;
		await dm.updateTitle({ ...t, rating: 4 });
		expect(local.getCache('TV Show/C')?.airing?.nextEpisode).toBe(7);
	});
});

describe('airtime scheduler', () => {
	it('notifies and force-refreshes at the airing minute without touching any note', async () => {
		const { dm, f, fetchAiring } = await setup({ [SHOW]: showNote() });
		const before = new Map(f.files);
		const notify = vi.fn();
		const refresh = vi.spyOn(dm, 'refreshAiring');
		const deps = { dataManager: dm, readingDataManager: { getBook: () => undefined, getManga: () => undefined }, gameDataManager: { getGame: () => undefined }, notify };
		const notified = new Set<string>();
		runAirtimeScheduler(deps, notified, new Date(2026, 9, 19, 20, 15));
		runAirtimeScheduler(deps, notified, new Date(2026, 9, 19, 20, 15, 30));
		await new Promise((r) => setTimeout(r, 0));
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith('C');
		expect(refresh).toHaveBeenCalledWith('TV Show/C', true);
		expect(fetchAiring).toHaveBeenCalled();
		await dm.flushPendingSave();
		expect(f.files).toEqual(before);
	});
});

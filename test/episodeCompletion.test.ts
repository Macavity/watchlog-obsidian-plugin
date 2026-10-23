import { describe, it, expect } from 'vitest';
import { setupDataManager } from './helpers/setupDataManager';

const NOTE = '---\ntitle: S\ntype: TV Show\ntotalEpisodes: 2\nstatus: Watching\npriority: High\n---\n';
const DONE = '---\ntitle: S\ntype: TV Show\ntotalEpisodes: 2\nstatus: Completed\ndateFinished: 2026-01-01\nwatched: S01E01-E02\n---\n';
const ID = 'TV Show/S';

async function setup(note: string, auto = true, finishDate = true) {
	const ctx = await setupDataManager({ 'W/TV Show/S.md': note });
	ctx.settings.autoCompleteOnLastEpisode = auto;
	ctx.settings.setFinishDateAutomatically = finishDate;
	return ctx;
}

describe('episode completion rules', () => {
	it('markEpisodeWatched completes on the last episode and sets the finish date', async () => {
		const { dm } = await setup(NOTE);
		await dm.markEpisodeWatched(ID, 1, true);
		expect(dm.getTitle(ID)!.status).toBe('Watching');
		await dm.markEpisodeWatched(ID, 2, true);
		const t = dm.getTitle(ID)!;
		expect(t.status).toBe('Completed');
		expect(t.dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(t.priority).toBe('');
	});

	it('does not set the finish date when the setting is off', async () => {
		const { dm } = await setup(NOTE, true, false);
		await dm.markEpisodeWatched(ID, 1, true);
		await dm.markEpisodeWatched(ID, 2, true);
		const t = dm.getTitle(ID)!;
		expect(t.status).toBe('Completed');
		expect(t.dateFinished).toBeNull();
	});

	it('does not complete when autoCompleteOnLastEpisode is off', async () => {
		const { dm } = await setup(NOTE, false);
		await dm.markEpisodeWatched(ID, 1, true);
		await dm.markEpisodeWatched(ID, 2, true);
		expect(dm.getTitle(ID)!.status).toBe('Watching');
	});

	it('markEpisodeWatched un-completes a completed title', async () => {
		const { dm } = await setup(DONE);
		await dm.markEpisodeWatched(ID, 2, false);
		const t = dm.getTitle(ID)!;
		expect(t.status).toBe('Watching');
		expect(t.dateFinished).toBeNull();
		expect(t.watchedEpisodes).toEqual([1]);
	});

	it('applyEpisodeWatchedToggle completes and un-completes', async () => {
		const { dm } = await setup(NOTE);
		dm.applyEpisodeWatchedToggle(ID, 2, true);
		dm.applyEpisodeWatchedToggle(ID, 1, true);
		let t = dm.getTitle(ID)!;
		expect(t.watchedEpisodes).toEqual([1, 2]);
		expect(t.status).toBe('Completed');
		expect(t.dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(t.priority).toBe('');
		dm.applyEpisodeWatchedToggle(ID, 1, false);
		t = dm.getTitle(ID)!;
		expect(t.status).toBe('Watching');
		expect(t.dateFinished).toBeNull();
		await dm.flushPendingSave();
	});

	it('markSeasonWatched completes and un-completes', async () => {
		const { dm } = await setup(NOTE);
		await dm.markSeasonWatched(ID, [1, 2], true);
		let t = dm.getTitle(ID)!;
		expect(t.status).toBe('Completed');
		expect(t.dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(t.priority).toBe('');
		await dm.markSeasonWatched(ID, [1, 2], false);
		t = dm.getTitle(ID)!;
		expect(t.status).toBe('Watching');
		expect(t.dateFinished).toBeNull();
		expect(t.watchedEpisodes).toEqual([]);
	});
});

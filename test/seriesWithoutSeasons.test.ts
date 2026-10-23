import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import legacyJson from './fixtures/data-v1.json';
import { setupDataManager } from './helpers/setupDataManager';
import { tick } from './helpers/common';
import { setupMigration } from './helpers/setupMigration';
import type { ApiOutcome } from '../src/ApiService';
import type { Season } from '../src/types';

const shown = (Notice as unknown as { shown: string[] }).shown;
const NOTE = '---\ntitle: N\ntype: TV Show\nexternalId: tmdb:tv:1\ntotalEpisodes: 10\n---\n';

describe('series without a season list', () => {
	beforeEach(() => { shown.length = 0; });

	it('toggles on a title without seasons persist and survive a reload', async () => {
		const { dm, f, index } = await setupDataManager({ 'W/TV Show/N.md': '---\ntitle: N\ntype: TV Show\ntotalEpisodes: 10\n---\n' });
		await dm.markEpisodeWatched('TV Show/N', 3, true);
		expect(f.files.get('W/TV Show/N.md')).toContain('watched: S01E03');
		f.externalWrite('W/TV Show/N.md', f.files.get('W/TV Show/N.md')! + '\n');
		await index.rebuild();
		expect(dm.getTitle('TV Show/N')!.watchedEpisodes).toEqual([3]);
	});

	it('refill notfound: implicit season, toggles allowed', async () => {
		const fetchSeasons = vi.fn(() => Promise.resolve<ApiOutcome<Season[]>>({ status: 'notfound' }));
		const { dm, f } = await setupDataManager({ 'W/TV Show/N.md': NOTE }, { apiService: { fetchSeasons } });
		await tick();
		expect(fetchSeasons).toHaveBeenCalledTimes(1);
		await dm.markEpisodeWatched('TV Show/N', 2, true);
		expect(f.files.get('W/TV Show/N.md')).toContain('watched: S01E02');
		expect(shown).not.toContain('Episodes of "N" are still loading.');
	});

	it('refill nokey: own notice, toggles allowed', async () => {
		const fetchSeasons = vi.fn(() => Promise.resolve<ApiOutcome<Season[]>>({ status: 'nokey' }));
		const { dm, f } = await setupDataManager({ 'W/TV Show/N.md': NOTE }, { apiService: { fetchSeasons } });
		await tick();
		await dm.markEpisodeWatched('TV Show/N', 2, true);
		expect(f.files.get('W/TV Show/N.md')).toContain('watched: S01E02');
		expect(shown).toContain('API key needed to load episodes');
	});

	it('refill transient: toggles wait', async () => {
		const fetchSeasons = vi.fn(() => Promise.resolve<ApiOutcome<Season[]>>({ status: 'transient' }));
		const { dm, f } = await setupDataManager({ 'W/TV Show/N.md': NOTE }, { apiService: { fetchSeasons } });
		await tick();
		await dm.markEpisodeWatched('TV Show/N', 2, true);
		await tick(700);
		expect(f.files.get('W/TV Show/N.md')).toBe(NOTE);
		expect(shown).toContain('Episodes of "N" are still loading.');
	});

	it('edited seasons go to the note', async () => {
		const { dm, f, local } = await setupDataManager({});
		local.setCache('TV Show/Dark', { seasons: [{ name: 'Season 1', episodes: 8, offset: 0 }] });
		f.externalWrite('W/TV Show/Dark.md', '---\ntitle: Dark\ntype: TV Show\nexternalId: tmdb:tv:70523\ntotalEpisodes: 8\n---\n');
		await tick();
		const t = dm.getTitle('TV Show/Dark')!;
		await dm.updateTitle({ ...t, totalEpisodes: 18, seasons: [{ name: 'Season 1', episodes: 10, offset: 0 }, { name: 'Season 2', episodes: 8, offset: 10 }] });
		const content = f.files.get('W/TV Show/Dark.md')!;
		expect(content).toContain('Season 1: 10');
		expect(content).toContain('Season 2: 8');
	});
});

describe('migration of series without a season list', () => {
	it('keeps watched episodes of a title without seasons', async () => {
		const legacy = structuredClone(legacyJson) as any;
		legacy.titles.push({ ...legacy.titles.find((t: any) => t.id === 'dark'), id: 'x', title: 'NoSeasons', externalLink: '', seasons: [],
			totalEpisodes: 10, watchedEpisodes: [1, 2, 3, 4, 5], tmdbId: undefined, malId: undefined, anilistId: undefined });
		const { run, f } = await setupMigration(legacy, {});
		const r = await run();
		expect(r.errors).toEqual([]);
		expect(f.files.get('WatchLog/TV Show/NoSeasons.md')).toContain('watched: S01E01-E05');
	});

	it.each([['https://youtu.be/api'], ['https://youtu.be/mine']])('second device keeps a manual trailer (API: %s)', async (api) => {
		const legacy = structuredClone(legacyJson) as any;
		const a = legacy.titles.find((t: any) => t.id === 'a');
		a.manualTrailerUrl = 'https://youtu.be/mine';
		a.trailerUrl = api;
		const { run, rerunFromLegacy, f } = await setupMigration(legacy, {});
		await run();
		expect(f.files.get('WatchLog/Movie/A.md')).toContain('trailer: https://youtu.be/mine');
		await rerunFromLegacy();
		expect(f.files.get('WatchLog/Movie/A.md')).toContain('trailer: https://youtu.be/mine');
	});

	it('second device removes a trailer the API wrote', async () => {
		const legacy = structuredClone(legacyJson) as any;
		const a = legacy.titles.find((t: any) => t.id === 'a');
		a.trailerUrl = 'https://youtu.be/api';
		const { run, f } = await setupMigration(legacy, {});
		const path = 'WatchLog/Movie/A.md';
		await run();
		// the original plugin had written the fetched trailer into the note
		f.externalWrite(path, f.files.get(path)!.replace('---\n', '---\ntrailer: https://youtu.be/api\n'));
		f.plugin.data = structuredClone(legacy);
		await run();
		expect(f.files.get(path)).not.toContain('trailer:');
	});
});

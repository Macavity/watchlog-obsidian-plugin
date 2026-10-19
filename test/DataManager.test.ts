import { describe, it, expect, vi } from 'vitest';
import { ReadingDataManager } from '../src/ReadingDataManager';
import { GameDataManager } from '../src/GameDataManager';
import { setupDataManager, makeTitle, tick } from './helpers/setupDataManager';

describe('DataManager on vault storage', () => {
	it('adds a title as a note and keeps it out of data.json', async () => {
		const { dm, f, local } = await setupDataManager({});
		await dm.addTitle(makeTitle({ title: 'Dark', type: 'TV Show', status: 'Watching', seasons: [{ name: 'Season 1', episodes: 10, offset: 0 }] }));
		await local.flush();
		expect(f.files.get('W/TV Show/Dark.md')).toContain('title: Dark');
		expect(JSON.stringify(f.plugin.data ?? {})).not.toContain('"titles"');
		expect(dm.getTitle('TV Show/Dark')).toBeDefined();
	});

	it('writes watched episodes in S/E notation', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': '---\ntitle: Dark\ntype: TV Show\nseasons: ["Season 1: 10"]\n---\n' });
		await dm.markEpisodeWatched('TV Show/Dark', 3, true); await dm.flushPendingSave();
		expect(f.files.get('W/TV Show/Dark.md')).toMatch(/watched: S01E03/);
	});

	it('debounces episode toggles into one note write', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/Dark.md': '---\ntitle: Dark\ntype: TV Show\nseasons: ["Season 1: 10"]\n---\n' });
		dm.applyEpisodeWatchedToggle('TV Show/Dark', 1, true);
		dm.applyEpisodeWatchedToggle('TV Show/Dark', 2, true);
		expect(f.files.get('W/TV Show/Dark.md')).not.toContain('watched');
		await dm.flushPendingSave();
		expect(f.files.get('W/TV Show/Dark.md')).toMatch(/watched: S01E01-E02/);
	});

	it('renames the note when the title changes', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n\n## Notes\nkeep\n' });
		const t = dm.getTitle('Movie/A')!;
		await dm.updateTitle({ ...t, title: 'A2' });
		expect(f.files.has('W/Movie/A.md')).toBe(false);
		expect(f.files.get('W/Movie/A2.md')).toContain('keep');
		expect(dm.getTitle('Movie/A2')?.title).toBe('A2');
		expect(dm.getTitle('Movie/A')).toBeUndefined();
	});

	it('does not overwrite an invalid field it did not change', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nrating: great\n---\n' });
		await dm.setFavorite('Movie/A', true);
		expect(f.files.get('W/Movie/A.md')).toContain('rating: great');
		expect(f.files.get('W/Movie/A.md')).toContain('favorite: true');
	});

	it('reads notes from the body and writes only the Notes section', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n\n## Notes\n\nold\n\n## Quotes\nq\n' });
		const t = dm.getTitle('Movie/A')!;
		expect(t.notes).toBe('old');
		t.notes = 'new';
		await dm.updateTitle(t);
		const content = f.files.get('W/Movie/A.md')!;
		expect(content).toContain('new');
		expect(content).not.toContain('old');
		expect(content).toContain('## Quotes\nq');
	});

	it('leaves unknown keys and the body alone on edits', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nmyKey: 1\n---\nbody text\n' });
		const t = dm.getTitle('Movie/A')!;
		t.rating = 4;
		await dm.updateTitle(t);
		const content = f.files.get('W/Movie/A.md')!;
		expect(content).toContain('myKey: 1');
		expect(content).toContain('rating: 4');
		expect(content).toContain('body text');
	});

	it('removes the note and its cache entry', async () => {
		const { dm, f, local } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n' });
		dm.updatePosterUrl('Movie/A', 'p');
		await dm.removeTitle('Movie/A');
		expect(f.files.has('W/Movie/A.md')).toBe(false);
		expect(local.getCache('Movie/A')).toBeUndefined();
		expect(dm.getTitles()).toEqual([]);
	});

	it('keeps API data in the cache, not the note', async () => {
		const { dm, f, local } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n' });
		dm.updatePosterUrl('Movie/A', 'https://img/p.jpg');
		dm.flushPosterSave();
		await local.flush();
		expect(local.getCache('Movie/A')?.posterUrl).toBe('https://img/p.jpg');
		expect(f.files.get('W/Movie/A.md')).not.toContain('img/p.jpg');
		expect(dm.getTitle('Movie/A')?.posterUrl).toBe('https://img/p.jpg');
	});

	it('picks up external edits and notifies listeners', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nrating: 1\n---\n' });
		let calls = 0;
		dm.onChange(() => calls++);
		f.externalWrite('W/Movie/A.md', '---\ntitle: A\ntype: Movie\nrating: 5\n---\n');
		await tick();
		expect(dm.getTitle('Movie/A')?.rating).toBe(5);
		expect(calls).toBeGreaterThan(0);
	});

	it('flushes silent batch updates on save()', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n', 'W/Movie/B.md': '---\ntitle: B\ntype: Movie\n---\n' });
		for (const id of ['Movie/A', 'Movie/B']) {
			const t = dm.getTitle(id)!;
			t.status = 'Watching';
			dm.updateTitleSilent(t);
		}
		await dm.save();
		expect(f.files.get('W/Movie/A.md')).toContain('status: Watching');
		expect(f.files.get('W/Movie/B.md')).toContain('status: Watching');
	});

	it('keeps the UI copy and ignores the echo of its own write', async () => {
		const { dm } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n' });
		const t = dm.getTitle('Movie/A')!;
		t.rating = 3;
		await dm.updateTitle(t);
		let calls = 0;
		dm.onChange(() => calls++);
		await tick();
		expect(calls).toBe(0);
		expect(dm.getTitle('Movie/A')).toBe(t);
	});

	it('full rewrite drops stale keys but keeps progress text without seasons', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/X.md': '---\ntitle: X\ntype: TV Show\nwatched: S01E01-E03\nmaybe: true\nfoo: bar\n---\n' });
		const t = dm.getTitle('TV Show/X')!;
		delete t.maybe;
		expect(await dm.rewriteFrontmatterIfExists(t)).toBe(true);
		const content = f.files.get('W/TV Show/X.md')!;
		expect(content).toContain('watched: S01E01-E03');
		expect(content).toContain('foo: bar');
		expect(content).not.toContain('maybe');
		expect(content).toContain('status: Plan to watch');
	});

	it('derives maybe, groups and airtime', async () => {
		const { dm } = await setupDataManager({
			'W/Movie/A.md': '---\ntitle: A\ntype: Movie\ngroups: [Marvel]\n---\n',
			'W/Movie/B.md': '---\ntitle: B\ntype: Movie\nmaybe: true\nreleaseDate: 2099-01-01\n---\n',
			'W/TV Show/C.md': '---\ntitle: C\ntype: TV Show\nairtimeRecurrence: weekly\nairtimeDay: 3\n---\n' });
		expect(dm.getTitles().map(t => t.id).sort()).toEqual(['Movie/A', 'TV Show/C']);
		expect(dm.getMaybeTitles().map(m => m.title)).toEqual(['B']);
		expect(dm.getGroups()).toEqual([expect.objectContaining({ id: 'Marvel', name: 'Marvel', titleIds: ['Movie/A'] })]);
		expect(dm.getAirtimeEntries().find(e => e.titleId === 'TV Show/C')?.schedule).toMatchObject({ recurrence: 'weekly', dayOfWeek: 3 });
	});

	it('derives a once entry from "To be released" + releaseDate; removing it clears the date and sets the plan status', async () => {
		const { dm, f } = await setupDataManager({
			'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nstatus: To be released\nreleaseDate: 2099-01-01\n---\n',
			'W/Movie/B.md': '---\ntitle: B\ntype: Movie\nstatus: Plan to watch\nreleaseDate: 2099-01-01\n---\n',
		});
		const entries = dm.getAirtimeEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ titleId: 'Movie/A', schedule: { recurrence: 'once', releaseDate: '2099-01-01' } });
		await dm.removeAirtimeEntry(entries[0]!.id);
		expect(f.files.get('W/Movie/A.md')).toContain('status: Plan to watch');
		expect(f.files.get('W/Movie/A.md')).not.toContain('releaseDate');
		expect(f.files.get('W/Movie/A.md')).not.toContain('airtime');
		expect(dm.getAirtimeEntries()).toEqual([]);
	});

	it('removing a derived book or game entry clears its release date', async () => {
		const { dm, f, plugin, index, shared, local, layout } = await setupDataManager({
			'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\nstatus: To be released\nreleaseDate: 2099-01-01\n---\n',
			'W/Games/Halo.md': '---\ntitle: Halo\ntype: game\nstatus: To be released\nreleaseDate: 2099-01-01\n---\n',
		});
		const deps = { index, local, shared, layout: () => layout };
		const p = plugin as unknown as Record<string, unknown>;
		p.readingDataManager = new ReadingDataManager(plugin, deps);
		p.gameDataManager = new GameDataManager(plugin, deps);
		await (p.readingDataManager as ReadingDataManager).init();
		await (p.gameDataManager as GameDataManager).init();
		const entries = dm.getAirtimeEntries();
		expect(entries).toHaveLength(2);
		for (const entry of entries) {
			expect(dm.removeClearsReleaseDate(entry)).toBe(true);
			await dm.removeAirtimeEntry(entry.id);
		}
		const book = f.files.get('W/Books/Dune.md')!;
		const game = f.files.get('W/Games/Halo.md')!;
		expect(book).not.toContain('2099');
		expect(book).toContain('status: Plan to Read');
		expect(game).not.toContain('2099');
		expect(game).not.toContain('To be released');
		expect(dm.getAirtimeEntries()).toEqual([]);
	});

	it('removing a manual weekly entry keeps the release date', async () => {
		const { dm, f } = await setupDataManager({
			'W/TV Show/C.md': '---\ntitle: C\ntype: TV Show\nstatus: Watching\nreleaseDate: 2020-01-01\nairtimeRecurrence: weekly\nairtimeDay: 2\n---\n',
		});
		const [entry] = dm.getAirtimeEntries();
		expect(dm.removeClearsReleaseDate(entry!)).toBe(false);
		await dm.removeAirtimeEntry(entry!.id);
		expect(f.files.get('W/TV Show/C.md')).toContain('releaseDate: 2020-01-01');
		expect(f.files.get('W/TV Show/C.md')).not.toContain('airtime');
	});

	it('removing a manual weekly card of a "To be released" title keeps the date and shows the premiere card', async () => {
		const { dm, f } = await setupDataManager({
			'W/TV Show/C.md': '---\ntitle: C\ntype: TV Show\nstatus: To be released\nreleaseDate: 2099-01-01\nairtimeRecurrence: weekly\nairtimeDay: 2\n---\n',
		});
		const [entry] = dm.getAirtimeEntries();
		expect(entry!.schedule.recurrence).toBe('weekly');
		expect(dm.removeClearsReleaseDate(entry!)).toBe(false);
		await dm.removeAirtimeEntry(entry!.id);
		const note = f.files.get('W/TV Show/C.md')!;
		expect(note).not.toContain('airtime');
		expect(note).toContain('releaseDate: 2099-01-01');
		expect(note).toContain('status: To be released');
		expect(dm.getAirtimeEntries()).toEqual([expect.objectContaining({ titleId: 'TV Show/C', schedule: { recurrence: 'once', releaseDate: '2099-01-01' } })]);
		// the derived card is what clears the date
		expect(dm.removeClearsReleaseDate(dm.getAirtimeEntries()[0]!)).toBe(true);
	});

	it('removing a manual card of a future book keeps its release date', async () => {
		const { dm, f, plugin, index, shared, local, layout } = await setupDataManager({
			'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\nstatus: To be released\nreleaseDate: 2099-01-01\nairtimeRecurrence: monthly\nairtimeDay: 5\n---\n',
		});
		const deps = { index, local, shared, layout: () => layout };
		const p = plugin as unknown as Record<string, unknown>;
		p.readingDataManager = new ReadingDataManager(plugin, deps);
		await (p.readingDataManager as ReadingDataManager).init();
		const [entry] = dm.getAirtimeEntries();
		expect(entry!.schedule.recurrence).toBe('monthly');
		expect(dm.removeClearsReleaseDate(entry!)).toBe(false);
		await dm.removeAirtimeEntry(entry!.id);
		const note = f.files.get('W/Books/Dune.md')!;
		expect(note).not.toContain('airtime');
		expect(note).toContain('releaseDate: 2099-01-01');
		expect(dm.getAirtimeEntries()).toEqual([expect.objectContaining({ schedule: { recurrence: 'once', releaseDate: '2099-01-01' } })]);
	});

	it('writes manual schedules as airtime keys and removes them again', async () => {
		const { dm, f } = await setupDataManager({ 'W/TV Show/C.md': '---\ntitle: C\ntype: TV Show\n---\n' });
		await dm.addAirtimeEntry({
			id: dm.generateAirtimeId('TV Show/C'), titleId: 'TV Show/C',
			schedule: { recurrence: 'weekly', dayOfWeek: 2, releaseTime: '20:15' },
			currentSeason: 1, currentEpisode: 4, dateAdded: '2026-01-01',
		});
		expect(f.files.get('W/TV Show/C.md')).toMatch(/airtimeRecurrence: weekly[\s\S]*airtimeDay: 2/);
		const [entry] = dm.getAirtimeEntries();
		expect(entry).toMatchObject({ titleId: 'TV Show/C', currentSeason: 1, currentEpisode: 4, schedule: { releaseTime: '20:15' } });
		entry!.currentEpisode = 5;
		entry!.lastAcknowledgedDate = '2026-10-19';
		await dm.updateAirtimeEntry(entry!);
		expect(f.files.get('W/TV Show/C.md')).toMatch(/airtimeEpisode: 5/);
		expect(f.files.get('W/TV Show/C.md')).toMatch(/airtimeAcknowledged: 2026-10-19/);
		await dm.removeAirtimeEntry(entry!.id);
		expect(f.files.get('W/TV Show/C.md')).not.toContain('airtime');
		expect(dm.getAirtimeEntries()).toEqual([]);
	});

	it('stores a reading schedule in the book note', async () => {
		const { dm, f } = await setupDataManager({ 'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\nstatus: Reading\n---\n' });
		await dm.addAirtimeEntry({
			id: dm.generateReadingAirtimeId('Books/Dune'), titleId: 'Books/Dune', source: 'reading', readingKind: 'book',
			schedule: { recurrence: 'monthly', dayOfMonth: 15 }, currentEpisode: 7, dateAdded: '2026-01-01',
		});
		const content = f.files.get('W/Books/Dune.md')!;
		expect(content).toMatch(/airtimeRecurrence: monthly/);
		expect(content).toMatch(/airtimeDay: 15/);
		expect(content).toMatch(/airtimeEpisode: 7/);
		expect(dm.getAirtimeEntries()).toEqual([expect.objectContaining({
			titleId: 'Books/Dune', source: 'reading', readingKind: 'book', currentEpisode: 7,
			schedule: expect.objectContaining({ recurrence: 'monthly', dayOfMonth: 15 }),
		})]);
		expect(JSON.stringify(f.plugin.data ?? {})).not.toContain('airtime');
	});

	it('derives reading and game entries from their release status', async () => {
		const { dm } = await setupDataManager({
			'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\nstatus: To be released\nreleaseDate: 2099-01-01\n---\n',
			'W/Games/Hades.md': '---\ntitle: Hades\nstatus: To be released\nreleaseDate: 2099-02-01\n---\n',
		});
		const entries = dm.getAirtimeEntries();
		expect(entries.find((e) => e.titleId === 'Books/Dune')).toMatchObject({ source: 'reading', readingKind: 'book', schedule: { recurrence: 'once', releaseDate: '2099-01-01' } });
		expect(entries.find((e) => e.titleId === 'Games/Hades')).toMatchObject({ source: 'game', schedule: { recurrence: 'once', releaseDate: '2099-02-01' } });
	});

	it('adds a maybe title as a note and adopts it without a second note', async () => {
		const { dm, f } = await setupDataManager({});
		await dm.addMaybeTitle({ id: dm.generateMaybeId('B'), title: 'B', type: 'Movie', releaseDate: '2099-01-01', externalLink: '', totalEpisodes: 1, episodeDuration: 120, dateAdded: '2026-01-01' });
		expect(f.files.get('W/Movie/B.md')).toContain('maybe: true');
		expect(dm.getMaybeTitles().map((m) => m.id)).toEqual(['Movie/B']);
		expect(dm.getTitles()).toEqual([]);
		await dm.addTitle(makeTitle({ title: 'B', type: 'Movie', status: 'Watching', rating: 4 }));
		expect(f.files.has('W/Movie/B 2.md')).toBe(false);
		const content = f.files.get('W/Movie/B.md')!;
		expect(content).not.toContain('maybe');
		expect(content).toContain('rating: 4');
		expect(dm.getMaybeTitles()).toEqual([]);
		expect(dm.getTitles().map((t) => t.id)).toEqual(['Movie/B']);
	});

	it('removes a maybe title by trashing its note', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/B.md': '---\ntitle: B\ntype: Movie\nmaybe: true\n---\n' });
		await dm.removeMaybeTitle('Movie/B');
		expect(f.files.has('W/Movie/B.md')).toBe(false);
		expect(dm.getMaybeTitles()).toEqual([]);
	});

	it('writes group membership to the groups property', async () => {
		const { dm, f } = await setupDataManager({
			'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n',
			'W/Movie/B.md': '---\ntitle: B\ntype: Movie\n---\n',
		});
		const log = vi.fn(() => Promise.resolve());
		dm.setHistoryManager({ log } as never);
		await dm.addGroup({ id: dm.generateGroupId('Marvel'), name: 'Marvel', titleIds: ['Movie/A'], dateAdded: '' });
		expect(f.files.get('W/Movie/A.md')).toMatch(/groups:\n\s+- Marvel/);
		await dm.addTitleToGroup('Marvel', 'Movie/B');
		expect(dm.getGroup('Marvel')?.titleIds.sort()).toEqual(['Movie/A', 'Movie/B']);
		await dm.updateGroup({ ...dm.getGroup('Marvel')!, name: 'MCU', titleIds: ['Movie/B'] });
		expect(f.files.get('W/Movie/A.md')).not.toContain('groups');
		expect(f.files.get('W/Movie/B.md')).toMatch(/- MCU/);
		expect(dm.getGroups().map((g) => g.id)).toEqual(['MCU']);
		await dm.removeGroup('MCU');
		expect(f.files.get('W/Movie/B.md')).not.toContain('groups');
		expect(dm.getGroups()).toEqual([]);
		expect(JSON.stringify(f.plugin.data ?? {})).not.toContain('Marvel');
	});

	it('logs group-created for a group without members', async () => {
		const { dm } = await setupDataManager({});
		const log = vi.fn(() => Promise.resolve());
		dm.setHistoryManager({ log } as never);
		await dm.addGroup({ id: 'Empty', name: 'Empty', titleIds: [], dateAdded: '' });
		expect(log).toHaveBeenCalledWith('Group "Empty" was created', expect.anything());
	});

	it('queues poster fetches for identified titles without a cached poster', async () => {
		const { dm, f, posterQueue } = await setupDataManager({
			'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nexternalId: tmdb:movie:603\n---\n',
			'W/Movie/B.md': '---\ntitle: B\ntype: Movie\n---\n',
		});
		expect(posterQueue).toEqual(['Movie/A']);
		expect(dm.getTitle('Movie/A')?.posterUrl).toBe('');
		f.externalWrite('W/Movie/C.md', '---\ntitle: C\ntype: Movie\nexternalId: tmdb:movie:604\n---\n');
		await tick();
		expect(posterQueue).toEqual(['Movie/A', 'Movie/C']);
	});

	it('keeps an external change when a stale copy edits another field', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nrating: 1\n---\n\n## Notes\n' });
		const t = dm.getTitle('Movie/A')!;
		f.externalWrite('W/Movie/A.md', '---\ntitle: A\ntype: Movie\nrating: 5\n---\n\n## Notes\n');
		await tick();
		dm.getTitles();
		t.review = 'nice';
		await dm.updateTitle(t);
		const c = f.files.get('W/Movie/A.md')!;
		expect(c).toContain('rating: 5');
		expect(c).toContain('review: nice');
	});

	it('flushes pending silent edits on flushPendingSave', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\n---\n' });
		const t = dm.getTitle('Movie/A')!;
		t.status = 'Watching';
		dm.updateTitleSilent(t);
		await dm.flushPendingSave();
		expect(f.files.get('W/Movie/A.md')).toContain('status: Watching');
	});

	it('keeps an external change when a spread copy edits another field', async () => {
		const { dm, f } = await setupDataManager({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nrating: 1\n---\n\n## Notes\n' });
		const t = dm.getTitle('Movie/A')!;
		f.externalWrite('W/Movie/A.md', '---\ntitle: A\ntype: Movie\nrating: 5\n---\n\n## Notes\n');
		await tick();
		dm.getTitles();
		await dm.updateTitle({ ...t, review: 'nice' });
		const c = f.files.get('W/Movie/A.md')!;
		expect(c).toContain('rating: 5');
		expect(c).toContain('review: nice');
	});
});

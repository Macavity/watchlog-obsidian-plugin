import { describe, it, expect } from 'vitest';
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
});

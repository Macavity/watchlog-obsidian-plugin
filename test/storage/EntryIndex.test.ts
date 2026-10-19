import { describe, it, expect, vi } from 'vitest';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { EntryIndex } from '../../src/storage/EntryIndex';
const note = (fm: string) => `---\n${fm}\n---\n\n## Notes\n`;
async function setup(files: Record<string, string>) {
	const f = createFakeApp(files);
	const local = new LocalStore(f.plugin); await local.load();
	const idx = new EntryIndex(f.app, () => new VaultLayout('W', () => ['Movie', 'TV Show']), local, () => {});
	await idx.build(); idx.start();
	const cb = vi.fn(); idx.onChange(cb);
	return { f, local, idx, cb };
}
const tick = () => new Promise(r => setTimeout(r, 200));
describe('EntryIndex', () => {
	it('builds from notes and skips non-entries', async () => {
		const { idx } = await setup({ 'W/Movie/A.md': note('title: A\ntype: Movie'), 'W/Books/B.md': note('title: B\ntype: book'),
			'W/History.md': '- x', 'W/Movie/broken.md': '---\n: : :\n---\n' });
		expect(idx.titles().map(t => t.id)).toEqual(['Movie/A']);
		expect(idx.books().map(b => b.id)).toEqual(['Books/B']);
	});
	it('picks up external changes, deletes and renames', async () => {
		const { f, idx, local, cb } = await setup({ 'W/Movie/A.md': note('title: A\nrating: 1') });
		local.setCache('Movie/A', { posterUrl: 'p' });
		f.externalWrite('W/Movie/A.md', note('title: A\nrating: 5')); await tick();
		expect((idx.get('Movie/A')!.entry as { rating: number }).rating).toBe(5);
		f.externalRename('W/Movie/A.md', 'W/Movie/A2.md'); await tick();
		expect(idx.get('Movie/A')).toBeUndefined();
		expect(local.getCache('Movie/A2')).toEqual({ posterUrl: 'p' });
		f.externalDelete('W/Movie/A2.md'); await tick();
		expect(idx.titles()).toEqual([]);
		expect(cb).toHaveBeenCalled();
	});
	it('ignores the echo of its own writes', async () => {
		const { f, idx, cb } = await setup({ 'W/Movie/A.md': note('title: A\nrating: 1') });
		const cur = idx.get('Movie/A')!;
		idx.applyLocal({ kind: 'title', entry: { ...(cur.entry as never), rating: 3 } });
		await f.app.fileManager.processFrontMatter(f.app.vault.getAbstractFileByPath('W/Movie/A.md') as never, fm => { fm.rating = 3; });
		await tick();
		expect(cb).not.toHaveBeenCalled();
	});
	it('batches bursts', async () => {
		const files: Record<string, string> = {};
		const { f, cb } = await setup(files);
		for (let i = 0; i < 300; i++) f.externalWrite(`W/Movie/M${i}.md`, note(`title: M${i}`));
		await tick();
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb.mock.calls[0]![0].size).toBe(300);
	});
});

describe('EntryIndex edge cases', () => {
	it('treats moves out of / into entry folders as delete / add', async () => {
		const { f, idx, cb } = await setup({ 'W/Movie/A.md': note('title: A'), 'W/Inbox/B.md': note('title: B') });
		f.externalRename('W/Movie/A.md', 'W/Inbox/A.md');
		f.externalRename('W/Inbox/B.md', 'W/Movie/B.md');
		await tick();
		expect(idx.titles().map(t => t.id)).toEqual(['Movie/B']);
		expect(cb).toHaveBeenCalledTimes(1);
		expect([...cb.mock.calls[0]![0]].sort()).toEqual(['Movie/A', 'Movie/B']);
	});
	it('takes kind from the folder, not the type key', async () => {
		const { idx } = await setup({ 'W/Games/G.md': note('title: G\ntype: book'), 'W/Manga/M.md': note('title: M') });
		expect(idx.games().map(g => g.id)).toEqual(['Games/G']);
		expect(idx.manga().map(m => m.id)).toEqual(['Manga/M']);
		expect(idx.books()).toEqual([]);
	});
	it('keeps the cache on delete and never writes', async () => {
		const { f, idx, local } = await setup({ 'W/Movie/A.md': note('title: A') });
		local.setCache('Movie/A', { posterUrl: 'p' });
		const before = new Map(f.files);
		await idx.rebuild();
		expect(f.files).toEqual(before);
		f.externalDelete('W/Movie/A.md'); await tick();
		expect(idx.get('Movie/A')).toBeUndefined();
		expect(local.getCache('Movie/A')).toEqual({ posterUrl: 'p' });
	});
	it('adds notes that metadataCache reports later', async () => {
		const { f, idx } = await setup({});
		f.externalWrite('W/Movie/Late.md', note('title: Late'));
		await tick();
		expect(idx.get('Movie/Late')?.kind).toBe('title');
	});
});

import { describe, it, expect } from 'vitest';
import { setupReadingDataManager, makeBook, makeManga, tick } from './helpers/setupReadingDataManager';

describe('ReadingDataManager on vault storage', () => {
	it('stores books as notes and columns in the base, not in data.json', async () => {
		const { rdm, f, local } = await setupReadingDataManager({});
		await rdm.addBook(makeBook({ title: 'Dune', author: 'Frank Herbert', status: 'Reading', pagesRead: 10, totalPages: 600 }));
		await rdm.addColumn('book', { id: 'c1', name: 'Format', type: 'text', options: [] });
		await local.flush();
		expect(f.files.get('W/Books/Dune.md')).toMatch(/pagesRead: 10/);
		expect(f.files.get('W/WatchLog.base')).toContain('Format');
		expect(JSON.stringify(f.plugin.data ?? {})).not.toContain('Dune');
		expect(rdm.getBook('Books/Dune')?.vaultPage).toBe('W/Books/Dune.md');
		expect(rdm.getBookColumns()).toHaveLength(1);
	});

	it('writes progress changes to frontmatter and keeps unknown keys and body', async () => {
		const { rdm, f } = await setupReadingDataManager({
			'W/Books/Dune.md': '---\ntitle: Dune\ntype: book\npagesRead: 1\nmyKey: 1\nrating: great\n---\n\n## Notes\n\nkeep\n',
		});
		const b = rdm.getBook('Books/Dune')!;
		await rdm.updateBook({ ...b, pagesRead: 42 });
		const c = f.files.get('W/Books/Dune.md')!;
		expect(c).toMatch(/pagesRead: 42/);
		expect(c).toContain('myKey: 1');
		expect(c).toContain('rating: great');
		expect(c).toContain('keep');
	});

	it('picks up external changes and notifies', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Manga/Berserk.md': '---\ntitle: Berserk\ntype: manga\nchaptersRead: 1\n---\n' });
		let n = 0;
		rdm.onChange(() => n++);
		await f.app.vault.modify(f.app.vault.getAbstractFileByPath('W/Manga/Berserk.md') as never, '---\ntitle: Berserk\ntype: manga\nchaptersRead: 9\n---\n');
		await tick();
		expect(rdm.getManga('Manga/Berserk')?.chaptersRead).toBe(9);
		expect(n).toBeGreaterThan(0);
	});

	it('own writes do not notify', async () => {
		const { rdm } = await setupReadingDataManager({});
		await rdm.addManga(makeManga({ title: 'Akira' }));
		let n = 0;
		rdm.onChange(() => n++);
		await tick();
		expect(n).toBe(0);
	});

	it('renames the note on title change and deletes via trash', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\n---\n\n## Notes\nx\n' });
		await rdm.updateBook({ ...rdm.getBook('Books/A')!, title: 'B' });
		expect(f.files.has('W/Books/A.md')).toBe(false);
		expect(f.files.get('W/Books/B.md')).toContain('x');
		await rdm.removeBook('Books/B');
		expect(f.files.has('W/Books/B.md')).toBe(false);
		expect(rdm.getBooks()).toHaveLength(0);
	});

	it('removing a column clears its custom field in notes', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\ncf_c1: hi\n---\n' });
		await rdm.addColumn('book', { id: 'c1', name: 'F', type: 'text', options: [] });
		expect(rdm.getBook('Books/A')?.customFields).toEqual({ c1: 'hi' });
		await rdm.removeColumn('book', 'c1');
		expect(f.files.get('W/Books/A.md')).not.toContain('cf_c1');
	});

	it('splits settings: default status to the base, UI state and colors to data.json', async () => {
		const { rdm, f } = await setupReadingDataManager({});
		await rdm.updateSettings({ defaultStatus: 'Reading', defaultSubTab: 'manga', statusColors: { Reading: '#ABCDEF' }, defaultFolder: 'X' });
				const base = f.files.get('W/WatchLog.base')!;
		expect(base).toContain('defaultStatus: Reading');
		for (const k of ['defaultSubTab', 'ABCDEF', 'defaultFolder']) expect(base).not.toContain(k);
		expect(rdm.getSettings().defaultSubTab).toBe('manga');
		expect(rdm.getSettings().statusColors?.Reading).toBe('#ABCDEF');
	});

	it('appends quotes to the Quotes section', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\n---\n\n## Notes\n\n\n## Quotes\n' });
		await rdm.appendQuote('book', rdm.getBook('Books/A')!, 'line', 'p. 1');
		expect(f.files.get('W/Books/A.md')).toContain('> [!quote] p. 1\n> line');
	});

	it('keeps an external change when a stale copy edits another field', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\npagesRead: 1\n---\n' });
		const b = rdm.getBook('Books/A')!;
		f.externalWrite('W/Books/A.md', '---\ntitle: A\ntype: book\npagesRead: 5\n---\n');
		await tick();
		rdm.getBooks();
		b.author = 'X';
		await rdm.updateBook(b);
		const c = f.files.get('W/Books/A.md')!;
		expect(c).toContain('pagesRead: 5');
		expect(c).toContain('author: X');
	});

	it('flushes dirty silent edits via flushPending', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\n---\n' });
		const b = rdm.getBook('Books/A')!;
		rdm.updateBookSilent({ ...b, author: 'Y' });
		await rdm.flushPending();
		expect(f.files.get('W/Books/A.md')).toContain('author: Y');
	});

	it('keeps an external change when a spread copy edits another field', async () => {
		const { rdm, f } = await setupReadingDataManager({ 'W/Books/A.md': '---\ntitle: A\ntype: book\npagesRead: 1\n---\n' });
		const b = rdm.getBook('Books/A')!;
		f.externalWrite('W/Books/A.md', '---\ntitle: A\ntype: book\npagesRead: 5\n---\n');
		await tick();
		rdm.getBooks();
		await rdm.updateBook({ ...b, author: 'X' });
		const c = f.files.get('W/Books/A.md')!;
		expect(c).toContain('pagesRead: 5');
		expect(c).toContain('author: X');
	});
});

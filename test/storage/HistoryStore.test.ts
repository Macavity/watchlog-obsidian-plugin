import { describe, it, expect, vi } from 'vitest';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { HistoryStore } from '../../src/storage/HistoryStore';

const layout = () => new VaultLayout('W', () => []);
const entry = (i: number, extra = {}) => ({
	id: '', timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), message: `m${i}`,
	action: 'added' as const, titleName: `T${i}`, ...extra,
});
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('HistoryStore', () => {
	it('appends, caps and keeps foreign lines', async () => {
		const f = createFakeApp({ 'W/History.md': '# My log\n' });
		const h = new HistoryStore(f.app, layout);
		for (let i = 0; i < 1001; i++) await h.append(entry(i));
		const all = await h.load();
		expect(all.length).toBe(1000);
		expect(all[0]!.message).toBe('m1');
		expect(f.files.get('W/History.md')!.startsWith('# My log\n')).toBe(true);
	});

	it('roundtrips entries incl. source, wikilink and ids', async () => {
		const f = createFakeApp();
		const h = new HistoryStore(f.app, layout, (n) => n === 'T1');
		await h.append(entry(1, { source: 'Reading' }));
		await h.append(entry(2));
		expect(f.files.get('W/History.md')).toContain('[[T1]]');
		expect(f.files.get('W/History.md')).not.toContain('[[T2]]');
		const all = await h.load();
		expect(all.map((e) => [e.titleName, e.message, e.source, e.action])).toEqual([
			['T1', 'm1', 'Reading', 'added'], ['T2', 'm2', undefined, 'added']]);
		expect(all[0]!.id).toMatch(/^2026-01-01T00:00:01\.000Z#\d+$/);
	});

	it('skips unreadable lines on load and maps group-created', async () => {
		const f = createFakeApp({ 'W/History.md': '# x\nnotes\n- 2026-01-01T00:00:00.000Z · group-created · Favs\n- bad line\n' });
		const h = new HistoryStore(f.app, layout);
		const all = await h.load();
		expect(all).toHaveLength(1);
		expect(all[0]!.message).toBe('Group "Favs" was created');
		await h.replaceAll(all);
		const txt = f.files.get('W/History.md')!;
		expect(txt).toContain('group-created · Favs');
		expect(txt).toContain('notes\n');
		expect(txt).toContain('- bad line');
	});

	it('replaceAll replaces entries and keeps foreign lines', async () => {
		const f = createFakeApp({ 'W/History.md': '# x\n' });
		const h = new HistoryStore(f.app, layout);
		await h.append(entry(1)); await h.append(entry(2));
		await h.replaceAll([entry(2)]);
		expect((await h.load()).map((e) => e.message)).toEqual(['m2']);
		expect(f.files.get('W/History.md')!.startsWith('# x\n')).toBe(true);
	});

	it('notifies on external change, not on own writes', async () => {
		const f = createFakeApp({ 'W/History.md': '# x\n' });
		const h = new HistoryStore(f.app, layout);
		const cb = vi.fn();
		h.start(cb);
		await h.append(entry(1));
		await tick();
		expect(cb).not.toHaveBeenCalled();
		f.externalWrite('W/History.md', f.files.get('W/History.md')! + '- 2026-01-02T00:00:00.000Z · added · Z\n');
		await tick();
		expect(cb).toHaveBeenCalledTimes(1);
	});
	it('links to the note path and loads the plain title name', async () => {
		const f = createFakeApp({ 'W/TV Show/Dark.md': '---\ntype: TV Show\n---\n' });
		const h = new HistoryStore(f.app, () => new VaultLayout('W', () => ['TV Show']), (n) => n === 'Dark');
		await h.append(entry(1, { titleName: 'Dark' }));
		expect(f.files.get('W/History.md')).toContain('[[TV Show/Dark]]');
		expect((await h.load())[0]!.titleName).toBe('Dark');
	});
});

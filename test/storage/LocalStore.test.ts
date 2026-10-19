import { describe, it, expect } from 'vitest';
import { LocalStore } from '../../src/storage/LocalStore';
const plugin = (data: unknown) => { const p = { data, loadData: async () => p.data, saveData: async (d: unknown) => { p.data = d; } }; return p; };
describe('LocalStore', () => {
	it('detects schema 1', async () => {
		const r = await new LocalStore(plugin({ titles: [], groups: [], settings: {} })).load();
		expect(r.schema).toBe(1);
	});
	it('initialises empty data as schema 2', async () => {
		const p = plugin(null); const s = new LocalStore(p);
		expect((await s.load()).schema).toBe(2);
		expect(s.data).toMatchObject({ schemaVersion: 2, cache: {}, ui: {} });
	});
	it('merges, renames and deletes cache entries', async () => {
		const p = plugin({ schemaVersion: 2, settings: {}, cache: {}, ui: {} }); const s = new LocalStore(p);
		await s.load();
		s.setCache('Movie/A', { posterUrl: 'u' }); s.setCache('Movie/A', { trailerUrl: 't' });
		s.renameCache('Movie/A', 'Movie/B');
		expect(s.getCache('Movie/B')).toEqual({ posterUrl: 'u', trailerUrl: 't' });
		s.deleteCache('Movie/B'); await s.flush();
		expect((p.data as { cache: object }).cache).toEqual({});
	});
	it('keeps legacy data untouched until adoptV2', async () => {
		const legacy = { titles: [], groups: [], settings: {} };
		const p = plugin(legacy); const s = new LocalStore(p);
		const r = await s.load();
		expect(r).toEqual({ schema: 1, legacy });
		await s.flush();
		expect(p.data).toBe(legacy);
		await s.adoptV2({ schemaVersion: 2, settings: {}, cache: {}, ui: {} });
		expect(p.data).toMatchObject({ schemaVersion: 2 });
	});
});

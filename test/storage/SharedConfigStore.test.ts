import { describe, it, expect, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
const yaml = { parse, stringify };
const mk = (files: Record<string, string>) => {
	const f = createFakeApp(files);
	const s = new SharedConfigStore(f.app, () => new VaultLayout('W', () => []), yaml);
	return { f, s };
};
describe('SharedConfigStore', () => {
	it('never writes secrets', async () => {
		const { f, s } = mk({ 'W/WatchLog.base': 'filters:\n  and:\n    - file.inFolder("W")\n' });
		await s.load();
		await s.update({ statuses: [{ name: 'A', color: '#000' }], tmdbApiKey: 'SECRET' });
		expect(f.files.get('W/WatchLog.base')).not.toContain('SECRET');
		expect(s.get().settings.statuses).toEqual([{ name: 'A', color: '#000' }]);
	});
	it('strips secrets nested in reading/games', async () => {
		const { f, s } = mk({ 'W/WatchLog.base': 'filters:\n  and:\n    - file.inFolder("W")\n' });
		await s.load();
		await s.update({ games: { steamId: 'S1', defaultFolder: 'X', keep: 1 } });
		const out = f.files.get('W/WatchLog.base')!;
		expect(out).not.toContain('S1');
		expect(out).not.toContain('defaultFolder');
		expect(out).toContain('keep: 1');
	});
	it('fixes a stale inFolder line', async () => {
		const { f, s } = mk({ 'W/WatchLog.base': 'filters:\n  and:\n    - file.inFolder("Old")\n' });
		expect(await s.ensureFilter()).toBe('fixed');
		expect(f.files.get('W/WatchLog.base')).toContain('file.inFolder("W")');
	});
	it('reports missing base / filter', async () => {
		expect((await mk({}).s.ensureFilter())).toBe('missing');
		expect((await mk({ 'W/WatchLog.base': 'views: []\n' }).s.ensureFilter())).toBe('missing');
	});
	it('reloads on external change', async () => {
		const { f, s } = mk({ 'W/WatchLog.base': 'watchlog:\n  version: 1\n' });
		await s.load(); s.start();
		const cb = vi.fn(); s.onChange(cb);
		f.externalWrite('W/WatchLog.base', 'watchlog:\n  version: 1\n  halfStarRatings: true\n');
		await new Promise(r => setTimeout(r, 0));
		expect(cb).toHaveBeenCalled();
		expect(s.get().settings.halfStarRatings).toBe(true);
	});
	it('ignores the echo of its own writes', async () => {
		const { s } = mk({ 'W/WatchLog.base': 'watchlog:\n  version: 1\n' });
		await s.load(); s.start();
		const cb = vi.fn(); s.onChange(cb);
		await s.update({ halfStarRatings: true });
		await new Promise(r => setTimeout(r, 0));
		expect(cb).not.toHaveBeenCalled();
	});
	it('creates a base without secrets', async () => {
		const { f, s } = mk({});
		await s.createBase({ halfStarRatings: true, steamId: 'X' });
		const out = f.files.get('W/WatchLog.base')!;
		expect(out).toContain('file.inFolder("W")');
		expect(out).toContain('halfStarRatings: true');
		expect(out).not.toContain('steamId');
		expect(s.get().settings.halfStarRatings).toBe(true);
	});
});

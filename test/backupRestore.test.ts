import { describe, it, expect } from 'vitest';
import { setupBackup } from './helpers/setupBackup';
import { inferHistoryAction } from '../src/HistoryManager';
import { buildBackup, parseBackup, restoreBackup } from '../src/backup';

const BASE = 'watchlog:\n  version: 1\n  statuses:\n    - name: Rewatch\n      color: "#123456"\n';

describe('backup/restore', () => {
	it('round-trips through an empty vault', async () => {
		const a = await setupBackup({
			'W/WatchLog.base': BASE,
			'W/TV Show/Dark.md': '---\ntitle: Dark\ntype: TV Show\nwatched: S01E01-E03\ngroups: [X]\nseasons: ["Season 1: 10"]\n---\n',
		});
		a.local.data.settings = { tmdbApiKey: 'SECRET' };
		const json = JSON.stringify(buildBackup(a));
		expect(json).not.toContain('SECRET');

		const parsed = parseBackup(json);
		if ('error' in parsed) throw new Error(parsed.error);
		const b = await setupBackup({});
		await restoreBackup(b, parsed.backup);

		const t = b.dataManager.getTitle('TV Show/Dark');
		expect(t?.watchedEpisodes).toEqual([1, 2, 3]);
		expect(b.dataManager.getGroups().map((g) => g.name)).toEqual(['X']);
		expect(b.shared.get().settings.statuses).toEqual(a.shared.get().settings.statuses);
	});

	it('rejects foreign formats', () => {
		expect('error' in parseBackup('{"version":3,"watch":{}}')).toBe(true);
		expect('error' in parseBackup('nope')).toBe(true);
	});
});

describe('history actions', () => {
	it('shows group creation as its own action', () => {
		const e = { id: '1', timestamp: '2026-01-01T00:00:00Z', message: 'Group "X" was created' };
		expect(inferHistoryAction(e)).toBe('group');
	});
});

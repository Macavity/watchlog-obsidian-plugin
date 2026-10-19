import { describe, it, expect } from 'vitest';
import { setupBackup } from './helpers/setupBackup';
import { inferHistoryAction } from '../src/HistoryManager';
import { buildBackup, parseBackup, restoreBackup, restoreLegacyBackup } from '../src/backup';
import legacy from './fixtures/data-v1.json';

const BASE = 'watchlog:\n  version: 1\n  statuses:\n    - name: Rewatch\n      color: "#123456"\n';

describe('backup/restore', () => {
	it('round-trips through an empty vault', async () => {
		const a = await setupBackup({
			'W/WatchLog.base': BASE,
			'W/TV Show/Dark.md': '---\ntitle: Dark\ntype: TV Show\nwatched: S01E01-E03\ngroups: [X]\nseasons: ["Season 1: 10"]\n---\n',
		});
		a.local.data.settings = { tmdbApiKey: 'SECRET' };
		const json = JSON.stringify(buildBackup(a));
		expect(JSON.parse(json).local.tmdbApiKey).toBe('SECRET');

		const parsed = parseBackup(json);
		if ('error' in parsed) throw new Error(parsed.error);
		const b = await setupBackup({});
		await restoreBackup(b, parsed.backup);

		const t = b.dataManager.getTitle('TV Show/Dark');
		expect(t?.watchedEpisodes).toEqual([1, 2, 3]);
		expect(b.dataManager.getGroups().map((g) => g.name)).toEqual(['X']);
		expect(b.shared.get().settings.statuses).toEqual(a.shared.get().settings.statuses);
		// the key lands in data.json only, never in the vault
		expect(b.local.data.settings.tmdbApiKey).toBe('SECRET');
		for (const [path, content] of b.f.files) expect(content, path).not.toContain('SECRET');
	});

	it('imports a v3 backup without touching existing values or schemaVersion', async () => {
		const { reading, games, history, ...watch } = legacy as Record<string, unknown>;
		const parsed = parseBackup(JSON.stringify({ version: 3, exportedAt: 'x', watch, reading, games, history }));
		if (!('legacy' in parsed)) throw new Error('expected a legacy backup');
		const b = await setupBackup({ 'W/Movie/A.md': '---\ntitle: A\ntype: Movie\nrating: 5\n---\n' });
		const schema = b.local.data.schemaVersion;
		const errors = await restoreLegacyBackup(b, parsed.legacy);
		expect(errors).toEqual([]);
		expect(b.f.files.get('W/Movie/A.md')).toMatch(/rating: 5/);
		expect(b.f.files.has('W/TV Show/Dark.md')).toBe(true);
		expect(b.f.files.has('W/Books/Dune.md')).toBe(true);
		expect(b.dataManager.getTitle('TV Show/Dark')).toBeDefined();
		expect(b.f.adapterFiles.has('.obsidian/plugins/watchlog/data.v1-backup.json')).toBe(false);
		expect(b.local.data.schemaVersion).toBe(schema);
		expect(b.local.data.settings.tmdbApiKey).toBeUndefined();
		for (const [path, content] of b.f.files) expect(content, path).not.toMatch(/SecretValue/);
	});

	it('maps v1 and v2 files and validates them', () => {
		const v1 = parseBackup(JSON.stringify(legacy));
		expect('legacy' in v1).toBe(true);
		const { reading, ...watch } = legacy as Record<string, unknown>;
		expect('legacy' in parseBackup(JSON.stringify({ version: 2, watch, reading, history: [] }))).toBe(true);
		expect('error' in parseBackup(JSON.stringify({ version: 3, watch, reading, history: [] }))).toBe(true);
		expect('error' in parseBackup(JSON.stringify({ version: 2, watch: {}, reading, history: [] }))).toBe(true);
	});

	it('rejects foreign formats', () => {
		expect('error' in parseBackup('{"version":3,"watch":{}}')).toBe(true);
		expect('error' in parseBackup('{"version":9}')).toBe(true);
		expect('error' in parseBackup('nope')).toBe(true);
	});
});

describe('history actions', () => {
	it('shows group creation as its own action', () => {
		const e = { id: '1', timestamp: '2026-01-01T00:00:00Z', message: 'Group "X" was created' };
		expect(inferHistoryAction(e)).toBe('group');
	});
});

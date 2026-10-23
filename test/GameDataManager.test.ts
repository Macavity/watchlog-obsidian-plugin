import { describe, it, expect } from 'vitest';
import { setupGames, makeGame } from './helpers/setupGameDataManager';
import { tick } from './helpers/setupDataManager';

describe('GameDataManager on vault storage', () => {
	it('stores games as notes and settings in the base, not data.json', async () => {
		const { gdm, f, local } = await setupGames({});
		await gdm.addGame(makeGame({ title: 'Hades', playtimeMinutes: 90, status: 'Playing' }));
		await local.flush();
		const content = f.files.get('W/Games/Hades.md')!;
		expect(content).toMatch(/playtime: 1h 30m/);
		expect(content).toContain('## Notes');
		expect(JSON.stringify(f.plugin.data ?? {})).not.toContain('Hades');
		const g = gdm.getGame('Games/Hades')!;
		expect(g.playtimeMinutes).toBe(90);
		expect(g.vaultPage).toBe('W/Games/Hades.md');
	});

	it('splits settings: vocabulary to the base, layout and filters to data.json', async () => {
		const { gdm, f } = await setupGames({ 'W/WatchLog.base': 'watchlog:\n  version: 1\nfilters: {}\n' });
		await gdm.updateSettings({ defaultStatus: 'Playing', rowsLayout: [{ id: 'recent', enabled: false }] });
		const base = f.files.get('W/WatchLog.base')!;
		expect(base).toContain('Playing');
		for (const k of ['defaultFolder', 'rowsLayout']) expect(base).not.toContain(k);
		expect(gdm.getSettings().defaultStatus).toBe('Playing');
		expect(gdm.getSettings().rowsLayout).toEqual([{ id: 'recent', enabled: false }]);
	});

	it('substitutes the default status for a note without status', async () => {
		const { gdm } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\n---\n' });
		expect(gdm.getGame('Games/A')?.status).toBe('Not started');
	});

	it('renames the note on title change and keeps the body', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\n---\n\n## Notes\n\nkeep\n' });
		const g = gdm.getGame('Games/A')!;
		await gdm.updateGame({ ...g, title: 'B' });
		expect(f.files.has('W/Games/A.md')).toBe(false);
		expect(f.files.get('W/Games/B.md')).toContain('keep');
		expect(gdm.getGame('Games/B')?.title).toBe('B');
	});

	it('does not overwrite an invalid field it did not change', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\nplaytime: lots\nmyKey: 1\n---\n' });
		const g = gdm.getGame('Games/A')!;
		await gdm.updateGame({ ...g, rating: 4 });
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toContain('playtime: lots');
		expect(c).toContain('myKey: 1');
		expect(c).toMatch(/rating: 4/);
	});

	it('reads and writes the Notes section only', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\n---\n\n## Notes\n\nold\n\n## Quotes\nq\n' });
		const g = gdm.getGame('Games/A')!;
		expect(await gdm.readGameNotes(g)).toBe('old');
		await gdm.writeGameNotes(g, 'new');
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toContain('new');
		expect(c).not.toContain('old');
		expect(c).toContain('## Quotes\nq');
	});

	it('shows external edits', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\nrating: 1\n---\n' });
		let n = 0;
		gdm.onChange(() => n++);
		const file = f.app.vault.getAbstractFileByPath('W/Games/A.md') as never;
		await f.app.vault.modify(file, '---\ntitle: A\ntype: game\nrating: 5\n---\n');
		await tick();
		expect(gdm.getGame('Games/A')?.rating).toBe(5);
		expect(n).toBeGreaterThan(0);
	});

	it('applies a Steam sync as frontmatter and trashes on delete', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\n---\n' });
		const n = await gdm.applySteamSync([{ gameId: 'Games/A', steamAppId: '12', playtimeMinutes: 61, lastPlayed: '2026-01-01', achievements: { earned: 2, total: 5 } }]);
		expect(n).toBe(1);
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toMatch(/playtime: 1h 1m/);
		expect(c).toMatch(/achievements: 2\/5/);
		expect(c).toMatch(/steamAppId: ["']?12["']?/);
		await gdm.removeGame('Games/A');
		expect(f.files.has('W/Games/A.md')).toBe(false);
		expect(gdm.getGame('Games/A')).toBeUndefined();
	});

	it('derives groups from the groups property', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\ngroups: [Souls]\n---\n', 'W/Games/B.md': '---\ntitle: B\ntype: game\n---\n' });
		expect(gdm.getGroups()).toEqual([expect.objectContaining({ id: 'Souls', name: 'Souls', gameIds: ['Games/A'] })]);
		await gdm.addGameToGroup('Souls', 'Games/B');
		expect(f.files.get('W/Games/B.md')).toMatch(/groups:\n\s+- Souls/);
		await gdm.removeGroup('Souls');
		expect(f.files.get('W/Games/A.md')).not.toContain('groups');
	});

	it('bridges a future release date to Upcoming', async () => {
		const { gdm, airtime } = await setupGames({});
		await gdm.addGame(makeGame({ title: 'Soon', releaseDate: '2999-01-01' }));
		expect(gdm.getGame('Games/Soon')?.status).toBe('To be released');
		expect(airtime.added).toContain('Games/Soon');
	});

	it('keeps an external change when a stale copy edits another field', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\nrating: 1\n---\n' });
		const g = gdm.getGame('Games/A')!;
		f.externalWrite('W/Games/A.md', '---\ntitle: A\ntype: game\nrating: 5\n---\n');
		await tick();
		gdm.getGames();
		g.playtimeMinutes = 60;
		await gdm.updateGame(g);
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toContain('rating: 5');
		expect(c).toContain('playtime: 1h');
	});

	it('restore leaves existing notes untouched', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\nrating: 4\n---\n' });
		const g = gdm.getGame('Games/A')!;
		await gdm.restore({ games: [{ ...g, rating: 1, status: 'Playing' }], groups: [], settings: gdm.getSettings() });
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toContain('rating: 4');
		expect(c).not.toContain('Playing');
	});

	it('restore adds missing groups to an existing note', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\n---\n' });
		const g = gdm.getGame('Games/A')!;
		await gdm.restore({ games: [g], groups: [{ id: 'G', name: 'Fav', gameIds: [g.id] }] as never, settings: gdm.getSettings() });
		expect(f.files.get('W/Games/A.md')).toContain('Fav');
	});

	it('keeps an external change when a spread copy edits another field', async () => {
		const { gdm, f } = await setupGames({ 'W/Games/A.md': '---\ntitle: A\ntype: game\nrating: 1\n---\n' });
		const g = gdm.getGame('Games/A')!;
		f.externalWrite('W/Games/A.md', '---\ntitle: A\ntype: game\nrating: 5\n---\n');
		await tick();
		gdm.getGames();
		await gdm.updateGame({ ...g, playtimeMinutes: 60 });
		const c = f.files.get('W/Games/A.md')!;
		expect(c).toContain('rating: 5');
		expect(c).toContain('playtime: 1h');
	});
});

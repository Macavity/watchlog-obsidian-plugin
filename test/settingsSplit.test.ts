import { describe, it, expect } from 'vitest';
import { parse, stringify } from 'yaml';
import type { TFile } from 'obsidian';
import { createFakeApp } from './fakes/fakeApp';
import { LocalStore } from '../src/storage/LocalStore';
import { SharedConfigStore } from '../src/storage/SharedConfigStore';
import { VaultLayout } from '../src/storage/VaultLayout';
import { composeSettings, persistSettings } from '../src/settingsSplit';

async function setup(files: Record<string, string>) {
	const f = createFakeApp(files);
	const local = new LocalStore(f.plugin);
	await local.load();
	const layout = new VaultLayout('W', () => []);
	const shared = new SharedConfigStore(f.app, () => layout, { parse, stringify });
	await shared.load();
	return { f, local, shared };
}

describe('settings split', () => {
	it('keeps secrets local and shared settings in the base', async () => {
		const { f, local, shared } = await setup({ 'W/WatchLog.base': 'watchlog:\n  version: 1\n' });
		const settings = composeSettings(local.data.settings, shared.get().settings);
		settings.tmdbApiKey = 'SECRET';
		settings.statuses = [{ name: 'Rewatch', color: '#123456' }];
		await persistSettings(settings, local, shared);
		await local.flush();
		expect(f.files.get('W/WatchLog.base')).toContain('Rewatch');
		expect(f.files.get('W/WatchLog.base')).not.toContain('SECRET');
		expect(JSON.stringify(f.plugin.data)).toContain('SECRET');
		expect(JSON.stringify(f.plugin.data)).not.toContain('Rewatch');
	});

	it('writes nothing when no shared key changed', async () => {
		const src = 'watchlog:\n  version: 1\n  futureKey: 1\n';
		const { f, local, shared } = await setup({ 'W/WatchLog.base': src });
		const settings = composeSettings(local.data.settings, shared.get().settings);
		settings.tmdbApiKey = 'K';
		await persistSettings(settings, local, shared);
		expect(f.files.get('W/WatchLog.base')).toBe(src);
	});

	it('writes only the changed shared key', async () => {
		const { f, local, shared } = await setup({ 'W/WatchLog.base': 'watchlog:\n  version: 1\n' });
		const settings = composeSettings(local.data.settings, shared.get().settings);
		settings.halfStarRatings = !settings.halfStarRatings;
		await persistSettings(settings, local, shared);
		const out = f.files.get('W/WatchLog.base')!;
		expect(out).toContain('halfStarRatings');
		expect(out).not.toContain('statuses');
	});

	it('lets shared keys win over local and drops removed folder settings', async () => {
		const { local, shared } = await setup({
			'W/WatchLog.base': 'watchlog:\n  version: 1\n  statuses:\n    - name: Shared\n      color: "#111111"\n',
		});
		local.data.settings = { statuses: [{ name: 'Local', color: '#222222' }], rootFolder: 'X', tmdbApiKey: 'K' };
		const s = composeSettings(local.data.settings, shared.get().settings);
		expect(s.statuses.some((t) => t.name === 'Shared')).toBe(true);
		expect(s.tmdbApiKey).toBe('K');
		expect('rootFolder' in s).toBe(false);
	});

	it('picks up external base changes', async () => {
		const { f, local, shared } = await setup({ 'W/WatchLog.base': 'watchlog:\n  version: 1\n' });
		shared.start();
		let changed = 0;
		shared.onChange(() => { changed++; });
		await f.app.vault.modify(f.app.vault.getAbstractFileByPath('W/WatchLog.base') as TFile, 'watchlog:\n  version: 1\n  statuses:\n    - name: Ext\n      color: "#333333"\n');
		await new Promise((r) => setTimeout(r, 50));
		expect(changed).toBe(1);
		expect(composeSettings(local.data.settings, shared.get().settings).statuses[0]?.name).toBe('Ext');
	});
});

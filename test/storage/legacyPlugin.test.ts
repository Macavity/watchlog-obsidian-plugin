import { describe, it, expect } from 'vitest';
import { loadOwnOrOriginal } from '../../src/storage/legacyPlugin';

const src = (files: Record<string, string>) => ({
	configDir: '.obsidian',
	adapter: {
		exists: async (p: string) => p in files,
		read: async (p: string) => {
			if (!(p in files)) throw new Error('ENOENT');
			return files[p]!;
		},
	},
});

describe('loadOwnOrOriginal', () => {
	it('prefers own data', async () => {
		const own = { schemaVersion: 2, settings: {} };
		const r = await loadOwnOrOriginal(async () => own, src({ '.obsidian/plugins/watchlog/data.json': '{"titles":[]}' }));
		expect(r).toEqual({ raw: own });
	});

	it('adopts the original plugin data while own is empty', async () => {
		for (const own of [null, undefined, {}]) {
			const r = await loadOwnOrOriginal(async () => own, src({ '.obsidian/plugins/watchlog/data.json': '{"titles":[{"id":"a"}]}' }));
			expect(r).toEqual({ raw: { titles: [{ id: 'a' }] }, dir: '.obsidian/plugins/watchlog' });
		}
	});

	it('returns own data when the original is missing, empty or broken', async () => {
		expect(await loadOwnOrOriginal(async () => null, src({}))).toEqual({ raw: null });
		expect(await loadOwnOrOriginal(async () => null, src({ '.obsidian/plugins/watchlog/data.json': '{}' }))).toEqual({ raw: null });
		expect(await loadOwnOrOriginal(async () => null, src({ '.obsidian/plugins/watchlog/data.json': '{broken' }))).toEqual({ raw: null });
	});
});

// FakeApp + storage stores + DataManager wired like main.ts: root 'W', watch types Movie / TV Show.
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
import { EntryIndex } from '../../src/storage/EntryIndex';
import { DataManager } from '../../src/DataManager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { WatchLogTitle } from '../../src/types';
import type WatchLogPlugin from '../../src/main';

// browser globals the manager touches
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.activeDocument ??= { dispatchEvent: () => true };

export async function setupDataManager(files: Record<string, string>, extra: Record<string, unknown> = {}) {
	const f = createFakeApp(files);
	const settings = {
		...DEFAULT_SETTINGS,
		types: [{ name: 'Movie', color: '#000' }, { name: 'TV Show', color: '#000' }],
	};
	// ids handed to the poster fetch queue
	const posterQueue: string[] = [];
	const plugin = {
		app: f.app,
		settings,
		manifest: f.plugin.manifest,
		registerEvent: f.plugin.registerEvent,
		posterService: {
			enqueue: (t: WatchLogTitle) => { posterQueue.push(t.id); return Promise.resolve(null); },
		},
		...extra,
	} as unknown as WatchLogPlugin;
	const local = new LocalStore(f.plugin);
	await local.load();
	const layout = new VaultLayout('W', () => settings.types.map((t) => t.name));
	const shared = new SharedConfigStore(f.app, () => layout, { parse, stringify });
	const index = new EntryIndex(f.app, () => layout, local, f.plugin.registerEvent);
	await index.build();
	index.start();
	const dm = new DataManager(plugin, { index, local, shared, layout: () => layout });
	await dm.init();
	return { dm, f, local, index, settings, posterQueue, plugin, shared, layout };
}

export function makeTitle(over: Partial<WatchLogTitle>): WatchLogTitle {
	const now = new Date().toISOString();
	return {
		id: 'tmp',
		title: 'Untitled',
		type: 'Movie',
		status: 'Plan to watch',
		priority: 'Medium',
		review: '',
		rating: 0,
		notes: '',
		dateStarted: null,
		dateFinished: null,
		dateAdded: now,
		dateModified: now,
		totalEpisodes: 0,
		episodeDuration: 0,
		releaseDate: null,
		externalLink: '',
		seasons: [],
		watchedEpisodes: [],
		...over,
	};
}

export const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// All managers + HistoryManager (memory-only) sharing one FakeApp, wired like main.ts (root 'W').
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
import { EntryIndex } from '../../src/storage/EntryIndex';
import { DataManager } from '../../src/DataManager';
import { ReadingDataManager } from '../../src/ReadingDataManager';
import { GameDataManager } from '../../src/GameDataManager';
import { HistoryManager } from '../../src/HistoryManager';
import { HistoryStore } from '../../src/storage/HistoryStore';
import { DEFAULT_SETTINGS } from '../../src/types';
import type WatchLogPlugin from '../../src/main';

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.activeDocument ??= { dispatchEvent: () => true };

export async function setupBackup(files: Record<string, string>) {
	const f = createFakeApp(files);
	const settings = {
		...DEFAULT_SETTINGS,
		types: [{ name: 'Movie', color: '#000' }, { name: 'TV Show', color: '#000' }],
	};
	const plugin = {
		app: f.app,
		settings,
		manifest: f.plugin.manifest,
		registerEvent: f.plugin.registerEvent,
		posterService: { enqueue: () => Promise.resolve(null) },
	} as unknown as WatchLogPlugin;
	const local = new LocalStore(f.plugin);
	await local.load();
	const layout = new VaultLayout('W', () => settings.types.map((t) => t.name));
	const shared = new SharedConfigStore(f.app, () => layout, { parse, stringify });
	await shared.load();
	const index = new EntryIndex(f.app, () => layout, local, f.plugin.registerEvent);
	await index.build();
	index.start();
	const stores = { index, local, shared, layout: () => layout };
	const dataManager = new DataManager(plugin, stores);
	const readingDataManager = new ReadingDataManager(plugin, stores);
	const gameDataManager = new GameDataManager(plugin, stores);
	const historyManager = new HistoryManager(plugin, null);
	const p = plugin as unknown as Record<string, unknown>;
	p.dataManager = dataManager;
	p.readingDataManager = readingDataManager;
	p.gameDataManager = gameDataManager;
	p.historyManager = historyManager;
	await dataManager.init();
	await readingDataManager.init();
	await gameDataManager.init();
	const storage = {
		local,
		shared,
		importContext: () => ({
			app: f.app, local, shared, layout, yaml: { parse, stringify },
			history: new HistoryStore(f.app, () => layout),
		}),
	};
	return { f, local, shared, dataManager, readingDataManager, gameDataManager, historyManager, storage };
}

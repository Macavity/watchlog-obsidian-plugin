// All managers + HistoryManager (memory-only) sharing one FakeApp, wired like main.ts (root 'W').
import { parse, stringify } from 'yaml';
import { createStores } from './common';
import { DataManager } from '../../src/DataManager';
import { ReadingDataManager } from '../../src/ReadingDataManager';
import { GameDataManager } from '../../src/GameDataManager';
import { HistoryManager } from '../../src/HistoryManager';
import { HistoryStore } from '../../src/storage/HistoryStore';

export async function setupBackup(files: Record<string, string>) {
	const { f, plugin, local, layout, shared, stores } = await createStores(files, {
		types: ['Movie', 'TV Show'],
		loadShared: true,
		pluginExtra: { posterService: { enqueue: () => Promise.resolve(null) } },
	});
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

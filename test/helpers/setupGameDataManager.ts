// FakeApp + storage stores + GameDataManager wired like main.ts (root 'W'); DataManager stubbed to the airtime bridge.
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
import { EntryIndex } from '../../src/storage/EntryIndex';
import { GameDataManager } from '../../src/GameDataManager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { Game } from '../../src/types';
import type WatchLogPlugin from '../../src/main';

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.activeDocument ??= { dispatchEvent: () => true };

export async function setupGames(files: Record<string, string>) {
	const f = createFakeApp(files);
	const settings = { ...DEFAULT_SETTINGS, types: [{ name: 'Movie', color: '#000' }] };
	const airtime = { added: [] as string[], removed: [] as string[] };
	const plugin = {
		app: f.app,
		settings,
		manifest: f.plugin.manifest,
		registerEvent: f.plugin.registerEvent,
		dataManager: {
			autoAddGameToUpcoming: async (game: Game) => { airtime.added.push(game.id); },
			removeGameAirtimeEntries: async (id: string) => { airtime.removed.push(id); },
		},
	} as unknown as WatchLogPlugin;
	const local = new LocalStore(f.plugin);
	await local.load();
	const layout = new VaultLayout('W', () => settings.types.map((t) => t.name));
	const shared = new SharedConfigStore(f.app, () => layout, { parse, stringify });
	const index = new EntryIndex(f.app, () => layout, local, f.plugin.registerEvent);
	await index.build();
	index.start();
	await shared.load();
	const gdm = new GameDataManager(plugin, { index, local, shared, layout: () => layout });
	await gdm.init();
	return { gdm, f, local, index, shared, airtime };
}

export function makeGame(over: Partial<Game>): Game {
	const now = new Date().toISOString();
	return {
		id: 'tmp', title: 'Untitled', developer: '', publisher: '', type: '', status: 'Not started', priority: '',
		favorite: false, wishlist: false, rating: 0, progress: 0, playtimeMinutes: 0,
		achievementsEarned: 0, achievementsTotal: 0, platforms: [], singleplayer: false, coop: false, multiplayer: false,
		coverUrl: '', apiSource: '', apiId: '', steamAppId: '', lastPlayed: null, storeUrl: '', externalLink: '',
		vaultPage: '', releaseDate: null, dateStarted: null, dateFinished: null, dateAdded: now, dateModified: now,
		...over,
	};
}

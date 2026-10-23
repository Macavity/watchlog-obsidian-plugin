// FakeApp + storage stores + GameDataManager wired like main.ts (root 'W'); DataManager stubbed to the airtime bridge.
import { createStores } from './common';
import { GameDataManager } from '../../src/GameDataManager';
import type { Game } from '../../src/types';

export async function setupGames(files: Record<string, string>) {
	const airtime = { added: [] as string[], removed: [] as string[] };
	const { f, plugin, local, shared, index, stores } = await createStores(files, {
		loadShared: true,
		pluginExtra: {
			dataManager: {
				autoAddGameToUpcoming: async (game: Game) => { airtime.added.push(game.id); },
				removeGameAirtimeEntries: async (id: string) => { airtime.removed.push(id); },
			},
		},
	});
	const gdm = new GameDataManager(plugin, stores);
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

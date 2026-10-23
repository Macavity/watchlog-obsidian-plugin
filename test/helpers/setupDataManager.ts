// FakeApp + storage stores + DataManager wired like main.ts: root 'W', watch types Movie / TV Show.
import { createStores } from './common';
import { DataManager } from '../../src/DataManager';
import type { WatchLogTitle } from '../../src/types';

// browser globals the manager touches
export async function setupDataManager(files: Record<string, string>, extra: Record<string, unknown> = {}) {
	// ids handed to the poster fetch queue
	const posterQueue: string[] = [];
	const { f, plugin, settings, local, layout, shared, index, stores } = await createStores(files, {
		types: ['Movie', 'TV Show'],
		pluginExtra: {
			posterService: {
				enqueue: (t: WatchLogTitle) => { posterQueue.push(t.id); return Promise.resolve(null); },
			},
			...extra,
		},
	});
	const dm = new DataManager(plugin, stores);
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

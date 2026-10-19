// FakeApp + storage stores + ReadingDataManager wired like main.ts (root 'W', base file present).
import { parse, stringify } from 'yaml';
import { createFakeApp } from '../fakes/fakeApp';
import { VaultLayout } from '../../src/storage/VaultLayout';
import { LocalStore } from '../../src/storage/LocalStore';
import { SharedConfigStore } from '../../src/storage/SharedConfigStore';
import { EntryIndex } from '../../src/storage/EntryIndex';
import { ReadingDataManager } from '../../src/ReadingDataManager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { Book, Manga } from '../../src/types';
import type WatchLogPlugin from '../../src/main';

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.activeDocument ??= { dispatchEvent: () => true };

export async function setupReadingDataManager(files: Record<string, string>) {
	const f = createFakeApp(files);
	const settings = { ...DEFAULT_SETTINGS, types: [{ name: 'Movie', color: '#000' }] };
	const plugin = {
		app: f.app,
		settings,
		manifest: f.plugin.manifest,
		registerEvent: f.plugin.registerEvent,
	} as unknown as WatchLogPlugin;
	const local = new LocalStore(f.plugin);
	await local.load();
	const layout = new VaultLayout('W', () => settings.types.map((t) => t.name));
	const shared = new SharedConfigStore(f.app, () => layout, { parse, stringify });
	if (!f.files.has('W/WatchLog.base')) await shared.createBase({});
	await shared.load();
	const index = new EntryIndex(f.app, () => layout, local, f.plugin.registerEvent);
	await index.build();
	index.start();
	const rdm = new ReadingDataManager(plugin, { index, local, shared, layout: () => layout });
	await rdm.init();
	return { rdm, f, local, index, shared };
}

export function makeBook(over: Partial<Book>): Book {
	const now = new Date().toISOString();
	return {
		id: 'tmp', title: 'Untitled', author: '', status: 'Plan to Read', rating: 0, progressUnit: 'pages',
		pagesRead: 0, totalPages: 0, wordsRead: 0, totalWords: 0, chaptersRead: 0, totalChapters: 0,
		coverUrl: '', googleBooksId: '', vaultPage: '', dateStarted: null, dateFinished: null,
		releaseDate: null, dateAdded: now, dateModified: now, customFields: {}, ...over,
	} as Book;
}

export function makeManga(over: Partial<Manga>): Manga {
	const now = new Date().toISOString();
	return {
		id: 'tmp', title: 'Untitled', author: '', status: 'Plan to Read', rating: 0, chaptersRead: 0,
		totalChapters: 0, volumesRead: 0, totalVolumes: 0, coverUrl: '', malId: '', vaultPage: '',
		dateStarted: null, dateFinished: null, releaseDate: null, dateAdded: now, dateModified: now,
		customFields: {}, ...over,
	} as Manga;
}

export const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

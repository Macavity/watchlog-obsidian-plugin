import { normalizePath } from 'obsidian';
import type { EntryKind } from './storageTypes';

export const BASE_FILE = 'WatchLog.base';
export const HISTORY_FILE = 'History.md';
export const FOLDERS = { book: 'Books', manga: 'Manga', game: 'Games', customLists: 'CustomLists' } as const;

const UNSAFE = /[*"\\/<>:|?]/g;

/** Folder structure below the vault root; entry id = note path relative to root, without `.md`. */
export class VaultLayout {
	readonly root: string;

	constructor(root: string, private watchTypes: () => string[]) {
		this.root = normalizePath(root);
	}

	/** Root = folder of the first (path-sorted) `.base` with a `watchlog:` key. */
	static findRoot(bases: { path: string; hasWatchlogKey: boolean }[]): string | null {
		const first = bases.filter((b) => b.hasWatchlogKey).map((b) => b.path).sort()[0];
		if (first === undefined) return null;
		const i = first.lastIndexOf('/');
		return i < 0 ? '' : first.slice(0, i);
	}

	get basePath(): string { return this.join(BASE_FILE); }
	get historyPath(): string { return this.join(HISTORY_FILE); }
	get customListsFolder(): string { return this.join(FOLDERS.customLists); }

	folderFor(kind: EntryKind, type?: string): string {
		return this.join(kind === 'title' ? (type ?? '') : FOLDERS[kind]);
	}

	notePath(kind: EntryKind, title: string, type?: string): string {
		// Titles keep the legacy untrimmed form; other kinds trim and fall back like their managers.
		const safe = kind === 'title'
			? title.replace(UNSAFE, '-')
			: title.replace(UNSAFE, '-').trim() || kind;
		return normalizePath(`${this.folderFor(kind, type)}/${safe}.md`);
	}

	idFromPath(path: string): string {
		const p = normalizePath(path);
		const rel = this.root && p.startsWith(this.root + '/') ? p.slice(this.root.length + 1) : p;
		return rel.replace(/\.md$/, '');
	}

	pathFromId(id: string): string {
		return this.join(`${id}.md`);
	}

	classify(path: string): { kind: EntryKind; id: string; type?: string } | null {
		const p = normalizePath(path);
		if (this.root && !p.startsWith(this.root + '/')) return null;
		const parts = (this.root ? p.slice(this.root.length + 1) : p).split('/');
		if (parts.length !== 2) return null;
		const [folder, file] = parts as [string, string];
		if (!file.endsWith('.md')) return null;
		const id = `${folder}/${file.slice(0, -3)}`;
		if (folder === FOLDERS.customLists) return null;
		if (folder === FOLDERS.book) return { kind: 'book', id };
		if (folder === FOLDERS.manga) return { kind: 'manga', id };
		if (folder === FOLDERS.game) return { kind: 'game', id };
		if (this.watchTypes().includes(folder)) return { kind: 'title', id, type: folder };
		return null;
	}

	private join(rel: string): string {
		return normalizePath(this.root ? `${this.root}/${rel}` : rel);
	}
}

import { normalizePath } from 'obsidian';
import type { EntryKind } from './storageTypes';

const BASE_FILE = 'WatchLog.base';
const HISTORY_FILE = 'History.md';
export const FOLDERS = { book: 'Books', manga: 'Manga', game: 'Games', customLists: 'CustomLists' } as const;

const UNSAFE = /[*"\\/<>:|?]/g;
/** Obsidian ignores dot-files; Windows refuses these device names. */
const LEADING_DOTS = /^\.+/;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const RESERVED_FOLDERS = new Set(Object.values(FOLDERS).map((f) => f.toLowerCase()));

/** A note or folder name that every OS and Obsidian accept; the legacy `UNSAFE` form plus the above. */
function safeFileName(name: string): string {
	const safe = name.replace(UNSAFE, '-').replace(LEADING_DOTS, (d) => '-'.repeat(d.length));
	return WINDOWS_RESERVED.test(safe) ? `${safe}-` : safe;
}

/** Type names double as folder names below the root, so they must be safe and must not collide with the fixed folders. */
export function safeTypeName(name: string): string {
	const safe = safeFileName(name.trim());
	return RESERVED_FOLDERS.has(safe.toLowerCase()) ? `${safe} (type)` : safe;
}

/** Why a type name cannot be used as entered, or null when it can. */
export function typeNameError(name: string): string | null {
	const safe = safeTypeName(name);
	if (safe === name.trim()) return null;
	if (RESERVED_FOLDERS.has(name.trim().toLowerCase())) return `"${name.trim()}" is a reserved folder name.`;
	return `"${name.trim()}" cannot be used as a folder name; try "${safe}".`;
}

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
			? safeFileName(title)
			: safeFileName(title).trim() || kind;
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

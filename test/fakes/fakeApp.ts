// In-memory stand-in for Obsidian's App, mimicking vault/metadataCache semantics for tests.
import type { App } from 'obsidian';
import { parse, stringify } from 'yaml';
import { TAbstractFile, TFile, TFolder } from '../obsidianStub';

type Cb = (...args: any[]) => unknown;
interface Ref { emitter: Emitter; name: string; cb: Cb }

class Emitter {
	private handlers = new Map<string, Set<Cb>>();
	on(name: string, cb: Cb): Ref {
		if (!this.handlers.has(name)) this.handlers.set(name, new Set());
		this.handlers.get(name)!.add(cb);
		return { emitter: this, name, cb };
	}
	off(name: string, cb: Cb): void { this.handlers.get(name)?.delete(cb); }
	offref(ref: Ref): void { ref.emitter.off(ref.name, ref.cb); }
	// Async like Obsidian; handlers resolved at fire time, skipped if removed meanwhile.
	fire(name: string, ...args: unknown[]): void {
		const cbs = [...(this.handlers.get(name) ?? [])];
		queueMicrotask(() => {
			for (const cb of cbs) if (this.handlers.get(name)?.has(cb)) cb(...args);
		});
	}
}

const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(\r?\n|$)/;

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
	const m = FM_RE.exec(content);
	if (!m) return undefined;
	try {
		const v = parse(m[1] ?? '');
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

export function createFakeApp(initial: Record<string, string> = {}) {
	const files = new Map<string, string>();
	const adapterFiles = new Map<string, string>();
	const nodes = new Map<string, TAbstractFile>();
	const vaultEvents = new Emitter();
	const cacheEvents = new Emitter();

	const root = new TFolder();
	nodes.set('', root);

	function ensureFolder(path: string): TFolder {
		const existing = nodes.get(path);
		if (existing) return existing as TFolder;
		const folder = new TFolder();
		folder.path = path;
		folder.name = path.slice(path.lastIndexOf('/') + 1);
		const parent = ensureFolder(dirOf(path));
		folder.parent = parent;
		parent.children.push(folder);
		nodes.set(path, folder);
		return folder;
	}

	function place(file: TFile, path: string): void {
		file.path = path;
		file.name = path.slice(path.lastIndexOf('/') + 1);
		const dot = file.name.lastIndexOf('.');
		file.extension = dot < 0 ? '' : file.name.slice(dot + 1);
		file.basename = dot < 0 ? file.name : file.name.slice(0, dot);
		const parent = ensureFolder(dirOf(path));
		file.parent = parent;
		parent.children.push(file);
		nodes.set(path, file);
	}

	function unplace(file: TFile): void {
		const parent = file.parent;
		if (parent) parent.children = parent.children.filter((c) => c !== file);
		nodes.delete(file.path);
	}

	function touch(file: TFile): void {
		const c = files.get(file.path) ?? '';
		file.stat = { ctime: file.stat.ctime, mtime: Date.now(), size: c.length };
	}

	function createFile(path: string, content: string): TFile {
		if (files.has(path)) throw new Error('File already exists.');
		const file = new TFile();
		files.set(path, content);
		place(file, path);
		file.stat.ctime = Date.now();
		touch(file);
		vaultEvents.fire('create', file);
		cacheEvents.fire('changed', file, content, fileCache(file));
		return file;
	}

	function writeFile(file: TFile, content: string): void {
		if (!files.has(file.path)) throw new Error('File does not exist.');
		files.set(file.path, content);
		touch(file);
		vaultEvents.fire('modify', file);
		cacheEvents.fire('changed', file, content, fileCache(file));
	}

	function deleteFile(file: TFile): void {
		files.delete(file.path);
		unplace(file);
		vaultEvents.fire('delete', file);
		cacheEvents.fire('deleted', file, fileCache(file));
	}

	function renameFile(file: TFile, newPath: string): void {
		if (files.has(newPath)) throw new Error('Destination file already exists!');
		const oldPath = file.path;
		const content = files.get(oldPath) ?? '';
		files.delete(oldPath);
		unplace(file);
		files.set(newPath, content);
		place(file, newPath);
		vaultEvents.fire('rename', file, oldPath);
	}

	function fileCache(file: TFile): { frontmatter?: Record<string, unknown> } {
		const fm = parseFrontmatter(files.get(file.path) ?? '');
		return fm ? { frontmatter: fm } : {};
	}

	function need(path: string): TFile {
		const f = nodes.get(path);
		if (!(f instanceof TFile)) throw new Error(`File not found: ${path}`);
		return f;
	}

	for (const [path, content] of Object.entries(initial)) {
		const file = new TFile();
		files.set(path, content);
		place(file, path);
		touch(file);
	}

	const vault = {
		on: (name: string, cb: Cb) => vaultEvents.on(name, cb),
		off: (name: string, cb: Cb) => vaultEvents.off(name, cb),
		offref: (ref: Ref) => vaultEvents.offref(ref),
		getRoot: () => root,
		getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
		getFiles: () => [...nodes.values()].filter((n): n is TFile => n instanceof TFile),
		getMarkdownFiles: () => vault.getFiles().filter((f) => f.extension === 'md'),
		read: async (file: TFile) => files.get(file.path) ?? '',
		cachedRead: async (file: TFile) => files.get(file.path) ?? '',
		create: async (path: string, content: string) => createFile(path, content),
		createFolder: async (path: string) => { ensureFolder(path); },
		modify: async (file: TFile, content: string) => writeFile(file, content),
		process: async (file: TFile, fn: (data: string) => string) => {
			const next = fn(files.get(file.path) ?? '');
			writeFile(file, next);
			return next;
		},
		adapter: {
			exists: async (path: string) => adapterFiles.has(path) || nodes.has(path),
			read: async (path: string) => {
				const v = adapterFiles.get(path) ?? files.get(path);
				if (v === undefined) throw new Error(`ENOENT: ${path}`);
				return v;
			},
			write: async (path: string, data: string) => { adapterFiles.set(path, data); },
		},
	};

	const metadataCache = {
		resolved: true,
		on: (name: string, cb: Cb) => cacheEvents.on(name, cb),
		off: (name: string, cb: Cb) => cacheEvents.off(name, cb),
		offref: (ref: Ref) => cacheEvents.offref(ref),
		getFileCache: (file: TFile) => (files.has(file.path) ? fileCache(file) : null),
	};

	const fileManager = {
		processFrontMatter: async (file: TFile, fn: (fm: Record<string, any>) => void) => {
			const content = files.get(file.path) ?? '';
			const m = FM_RE.exec(content);
			let fm: Record<string, any> = {};
			if (m) {
				const v = parse(m[1] ?? ''); // invalid YAML throws, like Obsidian
				if (v && typeof v === 'object' && !Array.isArray(v)) fm = v;
			}
			fn(fm);
			const yaml = Object.keys(fm).length ? stringify(fm) : '';
			const head = `---\n${yaml}---${m ? m[2] || '\n' : '\n'}`;
			writeFile(file, head + (m ? content.slice(m[0].length) : content));
		},
		renameFile: async (file: TAbstractFile, newPath: string) => renameFile(file as TFile, newPath),
		trashFile: async (file: TAbstractFile) => deleteFile(file as TFile),
	};

	const plugin = {
		manifest: { id: 'watchlog', dir: '.obsidian/plugins/watchlog' },
		data: undefined as unknown,
		registered: [] as unknown[],
		loadData: async () => plugin.data,
		saveData: async (d: unknown) => { plugin.data = d; },
		registerEvent: (r: unknown) => { plugin.registered.push(r); },
	};

	const app = {
		vault,
		metadataCache,
		fileManager,
		workspace: { onLayoutReady: (cb: () => void) => cb() },
	} as unknown as App;

	return {
		app: app as App & { vault: typeof vault; metadataCache: typeof metadataCache; fileManager: typeof fileManager },
		files,
		adapterFiles,
		plugin,
		externalWrite(path: string, content: string): void {
			const f = nodes.get(path);
			if (f instanceof TFile) writeFile(f, content);
			else createFile(path, content);
		},
		externalDelete(path: string): void { deleteFile(need(path)); },
		externalRename(from: string, to: string): void { renameFile(need(from), to); },
	};
}

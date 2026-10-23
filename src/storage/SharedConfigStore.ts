import { Notice, TFile, type App, type EventRef } from 'obsidian';
import type { SharedConfig, YamlIO } from './storageTypes';
import type { VaultLayout } from './VaultLayout';
import {
	createBaseFile, findInFolderPath, hasWatchlogKey, readWatchlogBlock, replaceInFolderPath, writeWatchlogBlock,
} from './baseFile';

/**
 * Whitelist of settings synced via the base: the vocabulary and schema every device needs to read
 * and write the same notes, plus the write behaviour that shapes them. Colors, palettes, layouts,
 * filters and secrets stay local.
 */
export const SHARED_SETTING_KEYS: readonly string[] = [
	'types', 'statuses', 'reviews', 'priorities', 'halfStarRatings',
	'typeApiMapping', 'episodeNumbering',
	'defaultCustomColumns', 'autoCompleteOnLastEpisode', 'setFinishDateAutomatically',
	'reading', 'games',
];

/** Same split inside the `reading:` and `games:` objects; everything else in them is device-local. */
export const NESTED_SHARED_KEYS: Readonly<Record<'reading' | 'games', readonly string[]>> = {
	reading: ['defaultStatus', 'bookColumns', 'mangaColumns'],
	games: ['defaultStatus', 'statuses', 'types', 'platforms'],
};

/** Keys once synced, now local; dropped from the block on the next write. */
const RETIRED_KEYS = ['ratingSystem', 'seasonPalette', 'readingTypeColors'];
const VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Splits a `reading`/`games` object into its synced and its device-local part. */
export function splitNested(key: keyof typeof NESTED_SHARED_KEYS, obj: Record<string, unknown>):
	{ shared: Record<string, unknown>; local: Record<string, unknown> } {
	const shared: Record<string, unknown> = {};
	const local: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || k === 'defaultFolder') continue;
		(NESTED_SHARED_KEYS[key].includes(k) ? shared : local)[k] = v;
	}
	return { shared, local };
}

function pick(src: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of SHARED_SETTING_KEYS) {
		if (!(k in src) || src[k] === undefined) continue;
		out[k] = (k === 'reading' || k === 'games') && isRecord(src[k]) ? splitNested(k, src[k]).shared : src[k];
	}
	return out;
}

/** Key-order independent serialization, to compare parsed blocks. */
function canon(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
	if (v && typeof v === 'object') {
		const e = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
		return `{${e.map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`).join(',')}}`;
	}
	return JSON.stringify(v) ?? 'null';
}

/** Fresh install without a base: it is created on the first write; a synced one is adopted. */
export interface DeferredBase {
	/** Creates the base (folder, file); called at most once. */
	create(): Promise<void>;
	/** A base with a `watchlog:` block appeared (sync): adopt root and settings. */
	appeared(): Promise<void> | void;
}

export class SharedConfigStore {
	private deferred: DeferredBase | null = null;
	private config: SharedConfig = { version: VERSION, settings: {} };
	private listeners: (() => void)[] = [];
	private modifyRef: EventRef | null = null;
	private createRef: EventRef | null = null;

	constructor(
		private app: App,
		private layout: () => VaultLayout,
		private yaml: YamlIO,
		private register: (ref: EventRef) => void = () => {},
	) {}

	private file(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.layout().basePath);
		return f instanceof TFile ? f : null;
	}

	private parseBlock(src: string): SharedConfig | null {
		let block: Record<string, unknown> | null;
		try {
			block = readWatchlogBlock(src, this.yaml);
		} catch {
			return null;
		}
		if (!block) return null;
		const { version, ...rest } = block;
		return { version: typeof version === 'number' ? version : VERSION, settings: pick(rest) };
	}

	async load(): Promise<SharedConfig> {
		const f = this.file();
		const parsed = f ? this.parseBlock(await this.app.vault.read(f)) : null;
		this.config = parsed ?? { version: VERSION, settings: {} };
		return this.config;
	}

	get(): SharedConfig {
		return this.config;
	}

	/** Picked (whitelisted) entries of `patch` that differ from the loaded config. */
	diff(patch: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(pick(patch))) {
			if (canon(v) !== canon(this.config.settings[k])) out[k] = v;
		}
		return out;
	}

	/** Patches the given keys into the current `watchlog:` block; other keys and the file stay as they are. */
	async update(patch: Record<string, unknown>): Promise<void> {
		const changes = pick(patch);
		if (Object.keys(changes).length === 0) return;
		const next: SharedConfig = { version: this.config.version, settings: { ...this.config.settings, ...changes } };
		const f = this.file();
		if (!f) {
			// no base yet: memory only, until the first write creates it
			this.config = next;
			await this.ensureBase();
			return;
		}
		const version = next.version;
		let written = true;
		await this.app.vault.process(f, (src) => {
			let current: Record<string, unknown> | null = null;
			if (hasWatchlogKey(src)) {
				try {
					current = readWatchlogBlock(src, this.yaml);
				} catch {
					current = null;
				}
				if (!current) {
					written = false;
					return src;
				}
			}
			const block: Record<string, unknown> = { version, ...current, ...changes };
			for (const k of RETIRED_KEYS) delete block[k];
			return writeWatchlogBlock(src, block, this.yaml);
		});
		if (!written) {
			console.warn('[WL] unreadable watchlog block in the base; settings not written');
			new Notice('Watchlog: the settings block in WatchLog.base is unreadable; settings were not saved.');
			return;
		}
		// only after a successful write, so the next save diffs against the file state and retries
		this.config = next;
	}

	/** Without a base and with a deferred creator: creates the base now (first write). */
	async ensureBase(): Promise<void> {
		const d = this.deferred;
		if (!d || this.file()) return;
		this.deferred = null;
		try {
			await d.create();
		} catch (e) {
			// another device created the base meanwhile (sync): adopt it
			const f = this.file();
			if (f && hasWatchlogKey(await this.app.vault.read(f))) {
				await d.appeared();
				return;
			}
			this.deferred = d;
			throw e;
		}
	}

	/** Marks the base as missing: created on the first write, or adopted when one syncs in. */
	deferBase(d: DeferredBase): void {
		this.deferred = d;
	}

	async ensureFilter(): Promise<'ok' | 'fixed' | 'missing'> {
		const f = this.file();
		if (!f) return 'missing';
		const src = await this.app.vault.read(f);
		const current = findInFolderPath(src);
		if (current === null) return 'missing';
		const root = this.layout().root;
		if (current === root) return 'ok';
		let result: 'fixed' | 'missing' = 'fixed';
		await this.app.vault.process(f, (s) => {
			const next = replaceInFolderPath(s, root);
			if (next === null) { result = 'missing'; return s; }
			return next;
		});
		return result;
	}

	async createBase(initial: Record<string, unknown>): Promise<void> {
		const layout = this.layout();
		const settings = pick(initial);
		const content = createBaseFile(layout.root, { version: VERSION, ...settings }, this.yaml);
		this.config = { version: VERSION, settings };
		await this.app.vault.create(layout.basePath, content);
	}

	start(): void {
		this.modifyRef = this.app.vault.on('modify', (file: unknown) => {
			if (!(file instanceof TFile)) return;
			if (this.deferred) void this.checkAppeared(file);
			if (file.path !== this.layout().basePath) return;
			void this.reload(file);
		});
		this.register(this.modifyRef);
		this.createRef = this.app.vault.on('create', (file: unknown) => void this.checkAppeared(file));
		this.register(this.createRef);
	}

	/** A `.base` with a `watchlog:` block shows up while the base is deferred (sync). */
	private async checkAppeared(file: unknown): Promise<void> {
		if (!this.deferred || !(file instanceof TFile) || file.extension !== 'base') return;
		if (!hasWatchlogKey(await this.app.vault.read(file))) return;
		const d = this.deferred;
		if (!d) return;
		this.deferred = null;
		await d.appeared();
	}

	stop(): void {
		if (this.modifyRef) this.app.vault.offref(this.modifyRef);
		this.modifyRef = null;
		if (this.createRef) this.app.vault.offref(this.createRef);
		this.createRef = null;
	}

	onChange(cb: () => void): void {
		this.listeners.push(cb);
	}

	private async reload(file: TFile): Promise<void> {
		const parsed = this.parseBlock(await this.app.vault.read(file));
		if (!parsed) return;
		// own writes echo back identical content: no reload
		if (canon(parsed.settings) === canon(this.config.settings)) return;
		this.config = parsed;
		for (const cb of this.listeners) cb();
	}
}

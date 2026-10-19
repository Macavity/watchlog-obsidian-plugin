import { TFile, type App } from 'obsidian';
import type { SharedConfig, YamlIO } from './storageTypes';
import type { VaultLayout } from './VaultLayout';
import {
	createBaseFile, findInFolderPath, readWatchlogBlock, replaceInFolderPath, writeWatchlogBlock,
} from './baseFile';

/** Whitelist of settings synced via the base. Everything else (API keys, secrets, ids) stays local. */
export const SHARED_SETTING_KEYS: readonly string[] = [
	'types', 'statuses', 'reviews', 'priorities', 'ratingSystem', 'halfStarRatings',
	'typeApiMapping', 'episodeNumbering', 'seasonPalette', 'readingTypeColors',
	'defaultCustomColumns', 'autoCompleteOnLastEpisode', 'setFinishDateAutomatically',
	'reading', 'games',
];

const NESTED_KEYS = new Set(['reading', 'games']);
const SECRET_RE = /api.?key|secret|steam.?id|client.?id|token/i;
const VERSION = 1;

/** Drops secret-looking keys and `defaultFolder` (device-local) from nested settings, recursively. */
function scrub(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(scrub);
	if (v && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			if (k === 'defaultFolder' || SECRET_RE.test(k)) continue;
			out[k] = scrub(val);
		}
		return out;
	}
	return v;
}

function pick(src: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of SHARED_SETTING_KEYS) {
		if (!(k in src) || src[k] === undefined) continue;
		out[k] = NESTED_KEYS.has(k) ? scrub(src[k]) : src[k];
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

export class SharedConfigStore {
	private config: SharedConfig = { version: VERSION, settings: {} };
	private listeners: (() => void)[] = [];

	constructor(private app: App, private layout: () => VaultLayout, private yaml: YamlIO) {}

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

	async update(patch: Record<string, unknown>): Promise<void> {
		const settings = { ...this.config.settings, ...pick(patch) };
		this.config = { version: this.config.version, settings };
		const f = this.file();
		if (!f) return; // no base yet: memory only, creation is separate
		const next = this.config;
		await this.app.vault.process(f, (src) =>
			writeWatchlogBlock(src, { version: next.version, ...next.settings }, this.yaml));
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
		this.app.vault.on('modify', (file: unknown) => {
			if (!(file instanceof TFile) || file.path !== this.layout().basePath) return;
			void this.reload(file);
		});
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

import type { WatchLogData } from '../types';
import type { EntryCache, LocalData } from './storageTypes';

export type LoadResult = { schema: 2 } | { schema: 1; legacy: WatchLogData };

interface DataPlugin {
	loadData(): Promise<unknown>;
	saveData(d: unknown): Promise<void>;
}

const SAVE_DEBOUNCE_MS = 100;

const emptyData = (): LocalData => ({ schemaVersion: 2, settings: {}, cache: {}, ui: {} });

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Device-local store behind data.json (settings, API keys, cache, UI state).
 * Writes only via plugin.saveData (plugin folder), never into the vault: it holds secrets.
 */
export class LocalStore {
	data: LocalData = emptyData();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;

	constructor(private readonly plugin: DataPlugin) {}

	async load(): Promise<LoadResult> {
		const raw = await this.plugin.loadData();
		if (isRecord(raw) && raw.schemaVersion === undefined && Array.isArray(raw.titles)) {
			// legacy stays in memory only; data stays empty and unsaved until adoptV2
			return { schema: 1, legacy: raw as unknown as WatchLogData };
		}
		if (isRecord(raw) && raw.schemaVersion === 2) {
			const d = raw as unknown as LocalData;
			this.data = { ...d, settings: d.settings ?? {}, cache: d.cache ?? {}, ui: d.ui ?? {} };
		} else {
			this.data = emptyData();
		}
		return { schema: 2 };
	}

	async adoptV2(data: LocalData): Promise<void> {
		this.data = data;
		this.clearTimer();
		await this.save();
	}

	getCache(id: string): EntryCache | undefined {
		return this.data.cache[id];
	}

	setCache(id: string, patch: Partial<EntryCache>): void {
		this.data.cache[id] = { ...this.data.cache[id], ...patch };
		this.queueSave();
	}

	deleteCache(id: string): void {
		if (!(id in this.data.cache)) return;
		delete this.data.cache[id];
		this.queueSave();
	}

	renameCache(from: string, to: string): void {
		const entry = this.data.cache[from];
		if (entry === undefined || from === to) return;
		delete this.data.cache[from];
		this.data.cache[to] = entry;
		this.queueSave();
	}

	queueSave(): void {
		this.dirty = true;
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.save();
		}, SAVE_DEBOUNCE_MS);
	}

	/** Write pending changes now (onunload). */
	async flush(): Promise<void> {
		this.clearTimer();
		if (this.dirty) await this.save();
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private async save(): Promise<void> {
		this.dirty = false;
		await this.plugin.saveData(this.data);
	}
}

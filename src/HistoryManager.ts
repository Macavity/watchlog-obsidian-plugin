import type WatchLogPlugin from './main';
import { formatDateDisplay } from './types';

export type HistorySource = 'Watchlist' | 'Reading' | 'Games';
export type HistoryAction = 'added' | 'completed' | 'deleted' | 'status' | 'rating' | 'watched';

export interface HistoryEntry {
	id: string;
	timestamp: string;
	message: string;
	source?: HistorySource;
	action?: HistoryAction;
	titleName?: string;
}

/**
 * Resolve an entry's action: structured metadata when present, else parsed from the legacy message
 * string. Shared by the Log tab and the Rows view's Recently Watched shelf.
 */
export function inferHistoryAction(entry: HistoryEntry): HistoryAction {
	if (entry.action) return entry.action;
	const m = entry.message.toLowerCase();
	if (m.includes('was added')) return 'added';
	if (m.includes('was deleted')) return 'deleted';
	if (m.includes('was reviewed') || m.includes('rating changed')) return 'rating';
	if (m.includes('episode') && m.includes('watched')) return 'watched';
	if (m.includes('was marked as watched') || m.includes('completed')) return 'completed';
	if (m.includes('status')) return 'status';
	return 'added';
}

/** Entries logged before structured metadata are all Watchlist events. */
export function inferHistorySource(entry: HistoryEntry): HistorySource {
	return entry.source ?? 'Watchlist';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Renders a log timestamp in the user's date format. This is baked into `message` at write time, so
 * entries keep whatever format was active when logged — the Log tab renders from the structured
 * metadata and its own timestamp, so old entries still display consistently.
 */
export function formatHistoryDate(isoTs: string): string {
	const d = new Date(isoTs);
	const day = DAYS[d.getDay()] ?? '';
	const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const hh = String(d.getHours()).padStart(2, '0');
	const min = String(d.getMinutes()).padStart(2, '0');
	return `${day} ${formatDateDisplay(local)} at ${hh}:${min}`;
}

export class HistoryManager {
	private plugin: WatchLogPlugin;
	private entries: HistoryEntry[] = [];
	private readonly MAX_ENTRIES = 1000;

	constructor(plugin: WatchLogPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Loads the activity log from the shared `data.history` key (in memory, not a file) and binds
	 * `master.history` to our canonical array so appends reach what DataManager persists.
	 */
	async load(): Promise<void> {
		const master = this.plugin.dataManager.getData();
		const h = master.history;
		this.entries = Array.isArray(h) ? h : [];
		if (this.entries.length > this.MAX_ENTRIES) {
			this.entries = this.entries.slice(-this.MAX_ENTRIES);
		}
		master.history = this.entries;
	}

	/** Re-bind to a freshly synced data.json (DataManager's 'raw' watcher). */
	adoptExternalChange(): void {
		const master = this.plugin.dataManager.getData();
		const h = master.history;
		this.entries = Array.isArray(h) ? h : [];
		if (this.entries.length > this.MAX_ENTRIES) {
			this.entries = this.entries.slice(-this.MAX_ENTRIES);
		}
		master.history = this.entries;
	}

	async log(
		message: string,
		meta?: { source?: HistorySource; action?: HistoryAction; titleName?: string },
	): Promise<void> {
		const entry: HistoryEntry = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			timestamp: new Date().toISOString(),
			message,
			source: meta?.source,
			action: meta?.action,
			titleName: meta?.titleName,
		};
		this.entries.push(entry);
		if (this.entries.length > this.MAX_ENTRIES) {
			this.entries = this.entries.slice(-this.MAX_ENTRIES);
		}
		await this.save();
	}

	getEntries(): HistoryEntry[] {
		return [...this.entries].reverse();
	}

	/** Drop one entry by id. No-op when the id is gone (external reload). */
	async deleteEntry(id: string): Promise<void> {
		const next = this.entries.filter((e) => e.id !== id);
		if (next.length === this.entries.length) return;
		this.entries = next;
		await this.save();
	}

	/** Raw stored entries (oldest-first), for a full backup. */
	exportEntries(): HistoryEntry[] {
		return [...this.entries];
	}

	/** Replace the entire audit log (full-snapshot restore). */
	async restore(entries: HistoryEntry[]): Promise<void> {
		const list = Array.isArray(entries) ? entries : [];
		this.entries = list.length > this.MAX_ENTRIES ? list.slice(-this.MAX_ENTRIES) : list;
		await this.save();
	}

	private async save(): Promise<void> {
		try {
			// the log lives inside data.json now (Sync-replicated) — re-bind the master reference (an external
			// reload may have replaced the object), then persist the whole file
			this.plugin.dataManager.getData().history = this.entries;
			await this.plugin.dataManager.persist();
		} catch {
			// write errors are non-fatal
		}
	}
}

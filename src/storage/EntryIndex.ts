import { TFile } from 'obsidian';
import type { App, EventRef, TAbstractFile } from 'obsidian';
import type { Book, Game, Manga, WatchLogTitle } from '../types';
import type { LocalStore } from './LocalStore';
import type { VaultLayout } from './VaultLayout';
import { decodeTitle } from './titleCodec';
import { decodeBook, decodeManga } from './readingCodec';
import { decodeGame } from './gameCodec';

export type AnyEntry =
	| { kind: 'title'; entry: WatchLogTitle }
	| { kind: 'book'; entry: Book }
	| { kind: 'manga'; entry: Manga }
	| { kind: 'game'; entry: Game };

type EntryOf<K extends AnyEntry['kind']> = Extract<AnyEntry, { kind: K }>['entry'];

interface Slot { value: AnyEntry; invalid: string[] }

const CHANGE_DEBOUNCE_MS = 150;

/** Deep equality ignoring key order; keys with `undefined` count as absent. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
	}
	const ra = a as Record<string, unknown>;
	const rb = b as Record<string, unknown>;
	const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
	const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
	return ka.length === kb.length && ka.every((k) => k in rb && sameValue(ra[k], rb[k]));
}

/** Derived in-memory map id → entry, fed by metadataCache/vault events. Never writes to the vault. */
export class EntryIndex {
	private entries = new Map<string, Slot>();
	private listeners: ((ids: Set<string>) => void)[] = [];
	private localWriteCbs: (() => void)[] = [];
	private pending = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly app: App,
		private readonly layout: () => VaultLayout,
		private readonly local: LocalStore,
		private readonly register: (ref: EventRef) => void,
	) {}

	async build(): Promise<void> {
		await this.layoutReady();
		this.entries = this.scan();
	}

	start(): void {
		const { vault, metadataCache } = this.app;
		this.register(metadataCache.on('changed', (file) => this.upsert(file)));
		this.register(vault.on('delete', (file) => this.onDelete(file)));
		this.register(vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
	}

	/** Drops a pending change notification (plugin unload). */
	stop(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.pending.clear();
	}

	titles(): WatchLogTitle[] { return this.ofKind('title'); }
	books(): Book[] { return this.ofKind('book'); }
	manga(): Manga[] { return this.ofKind('manga'); }
	games(): Game[] { return this.ofKind('game'); }

	get(id: string): AnyEntry | undefined {
		return this.entries.get(id)?.value;
	}

	invalidFields(id: string): string[] {
		return this.entries.get(id)?.invalid ?? [];
	}

	/** Optimistic update after an own write; the echo `changed` event then finds no difference. */
	applyLocal(e: AnyEntry): void {
		for (const cb of this.localWriteCbs) cb();
		this.entries.set(e.entry.id, { value: e, invalid: this.invalidFields(e.entry.id) });
	}

	removeLocal(id: string): void {
		this.entries.delete(id);
	}

	/** Fires on every own entry write (before the optimistic update). */
	onLocalWrite(cb: () => void): void {
		this.localWriteCbs.push(cb);
	}

	onChange(cb: (ids: Set<string>) => void): void {
		this.listeners.push(cb);
	}

	/** Re-scan after root or watch-type changes; emits ids whose entry changed. */
	async rebuild(): Promise<void> {
		await this.layoutReady();
		const next = this.scan();
		for (const [id, slot] of this.entries) {
			if (!sameValue(slot.value, next.get(id)?.value)) this.queue(id);
		}
		for (const id of next.keys()) if (!this.entries.has(id)) this.queue(id);
		this.entries = next;
	}

	private layoutReady(): Promise<void> {
		return new Promise((resolve) => this.app.workspace.onLayoutReady(resolve));
	}

	private ofKind<K extends AnyEntry['kind']>(kind: K): EntryOf<K>[] {
		const out: EntryOf<K>[] = [];
		for (const { value } of this.entries.values()) {
			if (value.kind === kind) out.push(value.entry as EntryOf<K>);
		}
		return out;
	}

	private scan(): Map<string, Slot> {
		const map = new Map<string, Slot>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const slot = this.decode(file);
			if (slot) map.set(slot.value.entry.id, slot);
		}
		return map;
	}

	/** Decodes an entry note; null for non-entries, missing frontmatter or decoder errors. */
	private decode(file: TFile): Slot | null {
		const c = this.layout().classify(file.path);
		if (!c) return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!fm || Object.keys(fm).length === 0) return null;
		try {
			switch (c.kind) {
				case 'title': {
					const d = decodeTitle(c.id, fm, this.local.getCache(c.id));
					return { value: { kind: 'title', entry: d.entry }, invalid: d.invalidFields };
				}
				case 'book': {
					const d = decodeBook(c.id, fm);
					return { value: { kind: 'book', entry: d.entry }, invalid: d.invalidFields };
				}
				case 'manga': {
					const d = decodeManga(c.id, fm);
					return { value: { kind: 'manga', entry: d.entry }, invalid: d.invalidFields };
				}
				case 'game': {
					const d = decodeGame(c.id, fm);
					return { value: { kind: 'game', entry: d.entry }, invalid: d.invalidFields };
				}
			}
		} catch (err) {
			console.warn(`WatchLog: skipping unreadable note ${file.path}`, err);
			return null;
		}
	}

	private upsert(file: TFile): void {
		const id = this.layout().classify(file.path)?.id;
		if (id === undefined) return;
		const next = this.decode(file);
		const cur = this.entries.get(id);
		if (!next) {
			if (cur) { this.entries.delete(id); this.queue(id); }
			return;
		}
		if (cur && sameValue(cur.value, next.value)) {
			cur.invalid = next.invalid;
			return;
		}
		this.entries.set(id, next);
		this.queue(id);
	}

	private onDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		const id = this.layout().classify(file.path)?.id;
		if (id !== undefined && this.entries.delete(id)) this.queue(id); // cache stays (spec)
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile)) return;
		const layout = this.layout();
		const oldId = layout.classify(oldPath)?.id;
		const newId = layout.classify(file.path)?.id;
		if (oldId !== undefined && this.entries.delete(oldId)) this.queue(oldId);
		if (newId === undefined) return; // moved out of entry folders: acts as delete
		if (oldId !== undefined) this.local.renameCache(oldId, newId);
		this.upsert(file);
	}

	private queue(id: string): void {
		this.pending.add(id);
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), CHANGE_DEBOUNCE_MS);
	}

	private flush(): void {
		this.timer = null;
		const ids = this.pending;
		this.pending = new Set();
		for (const cb of this.listeners) cb(ids);
	}
}

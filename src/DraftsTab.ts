import Fuse from 'fuse.js';
import type { EventRef } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { DraftPersistState } from './types';
import { openAddForTitle } from './AddRouter';

/** Libraries a draft can already live in — used for the "In …" duplicate label. */
type DraftLibrary = 'Watchlist' | 'Books' | 'Manga' | 'Games';

interface DraftLibraryEntry {
	title: string;
	library: DraftLibrary;
}

interface LiveDraftEntry {
	titleKey: string;
	titleDisplay: string;
	sources: string[];
	firstSeen: string;
	added: boolean;
}

export class DraftsTab {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private containerEl: HTMLElement;
	private onCountChange: (count: number) => void;

	private eventRef: EventRef | null = null;
	private destroyed = false;
	private scanDebounceTimer: number | null = null;
	private lastScanEntries: LiveDraftEntry[] = [];
	private persistState: DraftPersistState = {
		dismissed: [],
		added: [],
		firstSeen: {},
		titleDisplay: {},
	};

	constructor(
		containerEl: HTMLElement,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		onCountChange: (count: number) => void,
	) {
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.onCountChange = onCountChange;
	}

	async render(): Promise<void> {
		this.destroyed = false;
		await this.loadPersistState();
		if (this.destroyed) return;

		const entries = await this.scanVault();
		if (this.destroyed) return;

		this.renderUI(entries);
		this.registerChangeListener();
	}

	destroy(): void {
		this.destroyed = true;
		if (this.scanDebounceTimer) {
			window.clearTimeout(this.scanDebounceTimer);
			this.scanDebounceTimer = null;
		}
		if (this.eventRef) {
			this.plugin.app.metadataCache.offref(this.eventRef);
			this.eventRef = null;
		}
	}

	// Persistence

	private async loadPersistState(): Promise<void> {
		const data = this.plugin.dataManager.getData() as unknown as Record<string, unknown>;
		const drafts = data['drafts'] as Partial<DraftPersistState> | undefined;
		if (drafts) {
			this.persistState = {
				dismissed: drafts.dismissed ?? [],
				added: drafts.added ?? [],
				firstSeen: drafts.firstSeen ?? {},
				titleDisplay: drafts.titleDisplay ?? {},
			};
		}
	}

	private async savePersistState(): Promise<void> {
		const data = this.plugin.dataManager.getData() as unknown as Record<string, unknown>;
		data['drafts'] = this.persistState;
		this.plugin.dataManager.queueSave();
	}

	// Vault scanning

	private getTag(): string {
		return this.plugin.settings.draftsVaultTag ?? '#watchlog';
	}

	/**
	 * Scans the vault for inline-tag draft mentions, returning lowercase title key →
	 * { sources, displayTitle }. Pure (no persistState side effects), so it backs both the full render
	 * and the count-only badge scan. Inline tags only — frontmatter tags are ignored.
	 */
	private static async scanTaggedFiles(
		plugin: WatchLogPlugin,
		tag: string,
	): Promise<Map<string, { sources: Set<string>; displayTitle: string }>> {
		const files = plugin.app.vault.getMarkdownFiles();
		const liveMap: Map<string, { sources: Set<string>; displayTitle: string }> = new Map();

		for (const file of files) {
			const cache = plugin.app.metadataCache.getFileCache(file);
			const hasTag = cache?.tags?.some((t) => t.tag === tag) ?? false;
			if (!hasTag) continue;

			try {
				const content = await plugin.app.vault.cachedRead(file);
				const lines = content.split('\n');
				for (const line of lines) {
					if (!line.includes(tag)) continue;
					const tagIdx = line.indexOf(tag);
					const afterTag = line.slice(tagIdx + tag.length).trim();
					if (!afterTag) continue;

					// each comma-separated segment after the tag is a separate title
					const segments = afterTag.split(',');
					for (const seg of segments) {
						const displayTitle = seg.trim();
						if (!displayTitle || displayTitle.length > 100) continue;
						const titleKey = displayTitle.toLowerCase();
						if (!liveMap.has(titleKey)) {
							liveMap.set(titleKey, { sources: new Set(), displayTitle });
						}
						liveMap.get(titleKey)!.sources.add(file.basename);
					}
				}
			} catch {
				// skip unreadable files
			}
		}

		return liveMap;
	}

	private async scanVault(): Promise<LiveDraftEntry[]> {
		const tag = this.getTag();
		const liveMap = await DraftsTab.scanTaggedFiles(this.plugin, tag);

		// record firstSeen and displayTitle for newly discovered entries
		let stateChanged = false;
		const now = new Date().toISOString();
		for (const [key, { displayTitle }] of liveMap) {
			if (!this.persistState.firstSeen[key]) {
				this.persistState.firstSeen[key] = now;
				stateChanged = true;
			}
			if (!this.persistState.titleDisplay[key]) {
				this.persistState.titleDisplay[key] = displayTitle;
				stateChanged = true;
			}
		}
		if (stateChanged) {
			await this.savePersistState();
		}

		// dismissed entries are excluded entirely
		const entries: LiveDraftEntry[] = [];
		for (const [key, { sources }] of liveMap) {
			if (this.persistState.dismissed.includes(key)) continue;
			entries.push({
				titleKey: key,
				titleDisplay: this.persistState.titleDisplay[key] ?? key,
				sources: Array.from(sources),
				firstSeen: this.persistState.firstSeen[key] ?? now,
				added: this.persistState.added.includes(key),
			});
		}

		// oldest-first (FIFO queue)
		entries.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
		this.lastScanEntries = entries;
		return entries;
	}

	// Event listener

	private triggerDebouncedRender(): void {
		if (this.scanDebounceTimer) window.clearTimeout(this.scanDebounceTimer);
		this.scanDebounceTimer = window.setTimeout(() => {
			this.scanDebounceTimer = null;
			void this.render();
		}, 500);
	}

	private registerChangeListener(): void {
		if (this.eventRef) {
			this.plugin.app.metadataCache.offref(this.eventRef);
		}
		this.eventRef = this.plugin.app.metadataCache.on('changed', (_file) => {
			this.triggerDebouncedRender();
		});
	}

	// Fuzzy match helper

	/**
	 * Fuse index over every library a draft can be routed into — Watchlist, Books, Manga and Games — so
	 * a draft already added anywhere counts as a duplicate. Each entry carries its library so the card
	 * can name it ("In Games", "In Books", …).
	 */
	private static buildFuse(plugin: WatchLogPlugin): Fuse<DraftLibraryEntry> {
		const entries: DraftLibraryEntry[] = [
			...plugin.dataManager.getTitles().map((t) => ({ title: t.title, library: 'Watchlist' as const })),
			...plugin.readingDataManager.getBooks().map((b) => ({ title: b.title, library: 'Books' as const })),
			...plugin.readingDataManager.getMangaList().map((m) => ({ title: m.title, library: 'Manga' as const })),
			...plugin.gameDataManager.getGames().map((g) => ({ title: g.title, library: 'Games' as const })),
		];
		return new Fuse(entries, {
			keys: ['title'],
			threshold: 0.35,
			includeScore: true,
		});
	}

	/** The library holding a matching entry, or null when the draft is new. */
	private static findLibraryMatch(displayTitle: string, fuse: Fuse<DraftLibraryEntry>): DraftLibrary | null {
		const results = fuse.search(displayTitle);
		const best = results[0];
		if (!best || (best.score ?? 1) > 0.35) return null;
		return best.item.library;
	}

	/**
	 * Count-only drafts scan for the tab badge — mirrors renderUI's pending-count logic without touching
	 * the DOM or persistState. "Pending" = tagged, not dismissed, not marked added, and not already in
	 * Watchlist / Reading / Games (exact key or fuzzy title). Cheap: only tagged files are read.
	 */
	static async computePendingCount(plugin: WatchLogPlugin, _dataManager: DataManager): Promise<number> {
		const tag = plugin.settings.draftsVaultTag ?? '#watchlog';
		const liveMap = await DraftsTab.scanTaggedFiles(plugin, tag);

		const data = plugin.dataManager.getData() as unknown as Record<string, unknown>;
		const drafts = data['drafts'] as Partial<DraftPersistState> | undefined;
		const dismissed = new Set(drafts?.dismissed ?? []);
		const added = new Set(drafts?.added ?? []);
		const titleDisplay = drafts?.titleDisplay ?? {};

		const fuse = DraftsTab.buildFuse(plugin);

		let pending = 0;
		for (const [key, { displayTitle }] of liveMap) {
			if (dismissed.has(key) || added.has(key)) continue;
			const display = titleDisplay[key] ?? displayTitle;
			if (!DraftsTab.findLibraryMatch(display, fuse)) pending++;
		}
		return pending;
	}

	// Rendering

	private renderUI(entries: LiveDraftEntry[]): void {
		const el = this.containerEl;
		el.empty();

		const tag = this.getTag();
		const fuse = DraftsTab.buildFuse(this.plugin);

		// resolve the matching library once per entry and cache it (null = new draft)
		const fuzzyCache = new Map<string, DraftLibrary | null>();
		for (const entry of entries) {
			if (entry.added) {
				fuzzyCache.set(entry.titleKey, null);
			} else {
				fuzzyCache.set(entry.titleKey, DraftsTab.findLibraryMatch(entry.titleDisplay, fuse));
			}
		}

		// pending = not added AND not already present in any library
		const pendingCount = entries.filter((e) => {
			if (e.added) return false;
			return !fuzzyCache.get(e.titleKey);
		}).length;
		this.onCountChange(pendingCount);

		if (this.plugin.settings.showHintBanners) {
			el.createDiv({
				cls: 'wl-drafts-notice',
				text: `⚠ Write ${tag} Title in any note and it appears here automatically. Hit Add when you're ready to send it to your Watchlist, Books, Manga or Games.`,
			});
		}

		const countWrap = el.createDiv({ cls: 'wl-list-title-wrap' });
		countWrap.createSpan({ cls: 'wl-list-count', text: String(pendingCount) });
		countWrap.createSpan({
			cls: 'wl-drafts-count-label',
			text: ` Pending draft${pendingCount !== 1 ? 's' : ''}`,
		});

		if (entries.length === 0) {
			el.createDiv({
				cls: 'wl-drafts-empty',
				text: `No drafts found. Add ${tag} followed by a title in any vault note.`,
			});
			return;
		}

		// entries not yet in a library first (oldest-first), already-present ones last
		entries.sort((a, b) => {
			const aDup = fuzzyCache.get(a.titleKey) != null;
			const bDup = fuzzyCache.get(b.titleKey) != null;
			if (aDup !== bDup) return aDup ? 1 : -1;
			return a.firstSeen.localeCompare(b.firstSeen);
		});

		const cards = el.createDiv({ cls: 'wl-drafts-cards' });
		for (const entry of entries) {
			this.renderCard(cards, entry, fuzzyCache.get(entry.titleKey) ?? null);
		}
	}

	private renderCard(cards: HTMLElement, entry: LiveDraftEntry, dupLibrary: DraftLibrary | null): void {
		const isDuplicate = dupLibrary !== null;

		// dim rows already in a library; style added rows
		let cls = 'wl-drafts-card';
		if (isDuplicate) cls += ' wl-drafts-card-watchlist';
		if (entry.added) cls += ' wl-drafts-card-added';

		const card = cards.createDiv({ cls });

		card.createDiv({ cls: 'wl-drafts-card-title', text: entry.titleDisplay });

		const sourceEl = card.createDiv({ cls: 'wl-drafts-card-source' });
		if (entry.sources.length > 0) {
			const primaryNote = entry.sources[0]!;
			const link = sourceEl.createSpan({
				cls: 'wl-drafts-source-link',
				text: `[[${primaryNote}]]`,
			});
			link.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.plugin.app.workspace.openLinkText(primaryNote, '');
			});
			if (entry.sources.length > 1) {
				sourceEl.createSpan({
					cls: 'wl-drafts-source-count',
					text: ` (${entry.sources.length})`,
					attr: { title: entry.sources.join('\n') },
				});
			}
		}

		// "In <library>" indicator, only when applicable
		const dupEl = card.createDiv({ cls: 'wl-drafts-card-dup' });
		if (dupLibrary) {
			const where = dupLibrary === 'Watchlist' ? 'your Watchlist' : `your ${dupLibrary} library`;
			dupEl.createSpan({
				text: `In ${dupLibrary}`,
				attr: { title: `This title already exists in ${where}` },
			});
		}

		const actions = card.createDiv({ cls: 'wl-drafts-card-actions' });

		if (entry.added || isDuplicate) {
			actions.createSpan({ cls: 'wl-drafts-added-label', text: 'Added' });
		} else {
			const addBtn = actions.createEl('button', {
				cls: 'wl-btn wl-btn-sm wl-btn-primary',
				text: 'Add',
			});
			addBtn.addEventListener('click', () => this.openAddModal(entry));
		}

		const dismissBtn = actions.createEl('button', {
			cls: 'wl-btn wl-btn-sm wl-drafts-dismiss',
			text: '✕',
			attr: { title: 'Dismiss' },
		});
		dismissBtn.addEventListener('click', () => void this.dismissEntry(entry.titleKey));
	}

	private rerenderFromCache(): void {
		const entries = this.lastScanEntries
			.filter((e) => !this.persistState.dismissed.includes(e.titleKey))
			.map((e) => ({
				...e,
				added: this.persistState.added.includes(e.titleKey),
			}));
		this.renderUI(entries);
	}

	// Actions

	private async dismissEntry(titleKey: string): Promise<void> {
		if (!this.persistState.dismissed.includes(titleKey)) {
			this.persistState.dismissed.push(titleKey);
		}
		this.persistState.added = this.persistState.added.filter((k) => k !== titleKey);
		await this.savePersistState();
		this.rerenderFromCache();
	}

	private openAddModal(entry: LiveDraftEntry): void {
		openAddForTitle({
			plugin: this.plugin,
			dataManager: this.dataManager,
			title: entry.titleDisplay,
			onAdded: () => void this.afterAdded(entry.titleKey),
		});
	}

	private async afterAdded(titleKey: string): Promise<void> {
		const behavior = this.plugin.settings.draftsAfterAdding ?? 'keep';
		if (behavior === 'remove') {
			await this.dismissEntry(titleKey);
		} else {
			if (!this.persistState.added.includes(titleKey)) {
				this.persistState.added.push(titleKey);
			}
			await this.savePersistState();
			this.rerenderFromCache();
		}
	}
}

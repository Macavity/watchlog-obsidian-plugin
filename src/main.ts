import { App, Editor, FuzzySuggestModal, MarkdownView, Notice, Platform, Plugin, normalizePath, parseYaml, setIcon, stringifyYaml } from 'obsidian';
import { DEFAULT_SETTINGS, LAST_USED_TYPE_SENTINEL, WatchLogPluginSettings, AirtimeSchedule, setActiveDateFormat } from './types';
import { cardSizeToMinWidth } from './VirtualGrid';
import type { ReadingData, CardStyleTab, WatchLogData } from './types';
import type { HistoryEntry } from './HistoryManager';
import { DataManager } from './DataManager';
import { ReadingDataManager } from './ReadingDataManager';
import { GameDataManager } from './GameDataManager';
import { ApiService } from './ApiService';
import { HistoryManager } from './HistoryManager';
import { PosterService } from './PosterService';
import { WatchLogView, WATCHLOG_VIEW_TYPE, TabName } from './WatchLogView';
import { AirtimeTab } from './AirtimeTab';
import { WatchLogSettingsTab } from './SettingsTab';
import { AddTitleModal } from './AddTitleModal';
import { TitleDetailModal } from './TitleDetailModal';
import { InsertWidgetModal } from './InsertWidgetModal';
import { WidgetRenderer } from './WidgetRenderer';
import { VaultLayout } from './storage/VaultLayout';
import { LocalStore } from './storage/LocalStore';
import { SharedConfigStore } from './storage/SharedConfigStore';
import { EntryIndex } from './storage/EntryIndex';
import { HistoryStore } from './storage/HistoryStore';
import { hasWatchlogKey } from './storage/baseFile';
import { composeSettings, persistSettings } from './settingsSplit';

/** Root folder created on a fresh install (no `.base` with a `watchlog:` key found). */
const DEFAULT_ROOT = 'WatchLog';

export default class WatchLogPlugin extends Plugin {
	settings: WatchLogPluginSettings = DEFAULT_SETTINGS;
	// schema-1 data.json awaiting migration; while set, data.json is never written
	private legacyData: WatchLogData | null = null;
	private layout = new VaultLayout(DEFAULT_ROOT, () => this.settings.types.map((t) => t.name));
	private local = new LocalStore({
		loadData: () => this.loadData(),
		saveData: (d) => (this.legacyData ? Promise.resolve() : this.saveData(d)),
	});
	private shared = new SharedConfigStore(
		this.app,
		() => this.layout,
		{ parse: parseYaml, stringify: stringifyYaml },
		(ref) => this.registerEvent(ref),
	);
	private index = new EntryIndex(this.app, () => this.layout, this.local, (ref) => this.registerEvent(ref));
	dataManager: DataManager = new DataManager(this, {
		index: this.index,
		local: this.local,
		shared: this.shared,
		layout: () => this.layout,
	});
	readingDataManager: ReadingDataManager = new ReadingDataManager(this, {
		index: this.index,
		local: this.local,
		shared: this.shared,
		layout: () => this.layout,
	});
	gameDataManager: GameDataManager = new GameDataManager(this, {
		index: this.index,
		local: this.local,
		shared: this.shared,
		layout: () => this.layout,
	});
	apiService: ApiService = new ApiService('', '');
	historyManager: HistoryManager = new HistoryManager(this, new HistoryStore(
		this.app,
		() => this.layout,
		(name) => this.dataManager.getTitles().some((t) => t.title === name),
		(ref) => this.registerEvent(ref),
	));
	posterService!: PosterService;
	widgetRenderer?: WidgetRenderer;

	// runtime import progress state (not persisted)
	importProgress: { current: number; total: number; cancel: () => void } | null = null;

	// which entry+day combos have already fired a notification
	private notifiedEntries: Set<string> = new Set();

	// status-bar Upcoming "due" counter (desktop only; null on mobile)
	private statusBarEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		const loaded = await this.local.load();
		if (loaded.schema === 1) {
			// migration (Task 16): convert the legacy data.json here. Until then it is kept in memory and
			// on disk untouched (saves are suppressed) while the plugin runs like a fresh install.
			this.legacyData = loaded.legacy;
		}
		// local + defaults only; shared keys are re-composed once the base is loaded (startVaultStorage)
		await this.loadSettings();
		// the card-size CSS var must be live before any view or modal renders a grid
		this.applyCardSizeCssVar();
		this.register(() => activeDocument.body.style.removeProperty('--wl-card-min-width'));

		// one-time migration: pull legacy reading.json / history.json into data.json so Sync replicates
		// them. After data.json loads, before the reading/history managers bind. Idempotent — gated by a
		// flag in data.json.
		await this.migrateReadingHistory();

		this.apiService = new ApiService(
			this.settings.omdbApiKey,
			this.settings.tmdbApiKey,
			this.settings.googleBooksApiKey,
			this.settings.rawgApiKey,
			this.settings.igdbClientId,
			this.settings.igdbClientSecret,
			this.settings.steamApiKey,
			this.settings.steamId,
		);
		this.dataManager.setHistoryManager(this.historyManager);
		this.readingDataManager.setHistoryManager(this.historyManager);
		this.gameDataManager.setHistoryManager(this.historyManager);
		// history binds first so any reading-load logging has a live target
		await this.historyManager.load();

		this.posterService = new PosterService(
			this.dataManager,
			() => this.settings,
		);

		this.startAirtimeScheduler();
		// notes are read once the vault and metadata cache are ready
		this.app.workspace.onLayoutReady(() => void this.startVaultStorage());

		this.registerView(WATCHLOG_VIEW_TYPE, (leaf) => {
			return new WatchLogView(leaf, this, this.dataManager);
		});

		this.widgetRenderer = new WidgetRenderer(this, this.dataManager);

		this.addRibbonIcon('tv', 'Watchlog', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-panel',
			name: 'Open panel',
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: 'add-title',
			name: 'Add title',
			callback: () => {
				new AddTitleModal(this.app, this, this.dataManager, (entry) => {
					// setting off = just reveal whatever tab was open, no modal
					if (!(this.settings.openWatchlistAfterAdd ?? true)) {
						void this.activateView();
						return;
					}
					void this.activateView('watchlist').then(() => {
						// re-read: addTitle may have forced "To be released"
						const fresh = this.dataManager.getTitle(entry.id) ?? entry;
						new TitleDetailModal(this.app, this, fresh).open();
					});
				}).open();
			},
		});

		this.addCommand({
			id: 'insert-widget',
			name: 'Insert widget',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				this.openWidgetPalette(editor);
			},
		});

		this.addCommand({
			id: 'search-title',
			name: 'Search title',
			callback: () => {
				const titles = this.dataManager.getTitles();
				new InsertWidgetModal(this.app, titles, (title) => {
					void this.activateView().then(() => {
						new Notice(`"${title.title}" · ${title.type} · ${title.status}`);
					});
				}).open();
			},
		});

		this.addSettingTab(new WatchLogSettingsTab(this.app, this));

		this.setupStatusBar();
		// keep the status bar in sync with data edits (no new timer — the 60s airtime interval drives the
		// time-based refresh). 'watchlog-data-changed' is a custom event, so register the listener directly.
		const statusBarListener = (): void => this.updateStatusBar();
		activeDocument.addEventListener('watchlog-data-changed', statusBarListener);
		this.register(() => activeDocument.removeEventListener('watchlog-data-changed', statusBarListener));
	}

	onunload(): void {
		// synchronously flush pending debounced saves so no in-memory edits are lost
		this.dataManager.flushPendingSaveSync();
		this.dataManager.flushPosterSaveSync();
		this.dataManager.flushQueuedSaveSync();
		this.readingDataManager?.flushCoverSave();
		this.gameDataManager?.flushCoverSave();
		this.posterService?.destroy();
		this.widgetRenderer?.cleanup();
		this.index.stop();
		this.shared.stop();
		void this.local.flush();
	}

	/**
	 * Locates the root (folder of the first `.base` with a `watchlog:` key), creates the base on a
	 * fresh install, loads the shared config and builds the entry index from the notes.
	 */
	private async startVaultStorage(): Promise<void> {
		try {
			const root = await this.findRoot();
			this.layout = new VaultLayout(root ?? DEFAULT_ROOT, () => this.settings.types.map((t) => t.name));
			if (root === null && !this.legacyData) {
				await this.dataManager.ensureFolder(this.layout.root);
				await this.shared.createBase(this.settings as unknown as Record<string, unknown>);
			}
			await this.shared.load();
			await this.applySharedSettings();
			this.shared.onChange(() => void this.applySharedSettings());
			if (root !== null && (await this.shared.ensureFilter()) === 'missing') {
				new Notice('Watchlog: the folder filter in WatchLog.base was not found; the base view may list other notes.');
			}
			this.shared.start();
			await this.index.build();
			this.index.start();
			await this.historyManager.start();
			await this.dataManager.init();
			await this.readingDataManager.init();
			await this.gameDataManager.init();
			await this.dataManager.ensureFolders();
		} catch (e) {
			console.error('[WL] vault storage failed to start', e);
			new Notice('Watchlog could not load its notes. See the developer console for details.');
		}
	}

	/** Current vault layout (root and central folders). */
	getLayout(): VaultLayout {
		return this.layout;
	}

	/** Re-composes settings from the (re)loaded base, then refreshes derived state and views. */
	private async applySharedSettings(): Promise<void> {
		await this.loadSettings();
		this.applyCardSizeCssVar();
		activeDocument.dispatchEvent(new CustomEvent('watchlog-data-changed'));
	}

	private async findRoot(): Promise<string | null> {
		const { vault } = this.app;
		const bases = await Promise.all(
			vault.getFiles()
				.filter((f) => f.extension === 'base')
				.map(async (f) => ({ path: f.path, hasWatchlogKey: hasWatchlogKey(await vault.cachedRead(f)) })),
		);
		return VaultLayout.findRoot(bases);
	}

	private startAirtimeScheduler(): void {
		this.checkAirtimeNotifications();
		this.registerInterval(window.setInterval(() => {
			this.checkAirtimeNotifications();
		}, 60000));
	}

	/** Lets AirtimeTab prevent the scheduler from double-firing after a manual tick. */
	markAirtimeHandled(key: string): void {
		this.notifiedEntries.add(key);
	}

	private checkAirtimeNotifications(): void {
		const now = new Date();
		const currentHHMM =
			`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
		const today =
			`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

		const entries = this.dataManager.getAirtimeEntries();
		for (const entry of entries) {
			// only fire when the entry has a specific time set and it matches now
			if (!entry.schedule.releaseTime) continue;
			if (entry.schedule.releaseTime !== currentHHMM) continue;

			// direct day-of-week / date check, avoiding the getAirtimeCountdown rollover bug
			if (!this.isScheduledForToday(entry.schedule)) continue;

			// deduplicate: only fire once per entry per day
			const notifKey = `${entry.id}-${today}`;
			if (this.notifiedEntries.has(notifKey)) continue;
			this.notifiedEntries.add(notifKey);

			// resolve the entry's subject — a watch title, a reading item, or a game
			let name: string;
			let maxUnits: number;
			if (entry.source === 'game') {
				const game = this.gameDataManager.getGame(entry.titleId);
				if (!game) continue;
				name = game.title;
				maxUnits = 0; // games are single releases — nothing to auto-increment
			} else if (entry.source === 'reading') {
				const kind = entry.readingKind ?? 'book';
				const item = kind === 'book'
					? this.readingDataManager.getBook(entry.titleId)
					: this.readingDataManager.getManga(entry.titleId);
				if (!item) continue;
				name = item.title;
				maxUnits = entry.totalEpisodes ?? item.totalChapters ?? 0;
			} else {
				const title = this.dataManager.getTitle(entry.titleId);
				if (!title) continue;
				name = title.title;
				maxUnits = entry.totalEpisodes ?? title.totalEpisodes;
			}
			new Notice(name, 8000);

			// auto-increment the unit for recurring schedules — a single release ('once') has no next unit
			if (entry.schedule.recurrence !== 'once' && maxUnits > 1 && entry.currentEpisode !== undefined) {
				const nextEp = entry.currentEpisode + 1;
				if (nextEp <= maxUnits) {
					entry.currentEpisode = nextEp;
					void this.dataManager.updateAirtimeEntry(entry);
				}
				// final unit: leave in Upcoming, handled via the tick button
			}
		}

		// the due count is time-based, so refresh the status bar on every tick
		this.updateStatusBar();
	}

	// Status bar: Upcoming "due" counter
	private setupStatusBar(): void {
		// the status bar doesn't exist on mobile — skip entirely there
		if (Platform.isMobile) return;
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass('wl-statusbar-upcoming');
		this.statusBarEl.setAttribute('aria-label', 'WatchLog: Upcoming due');
		this.statusBarEl.addEventListener('click', () => void this.activateView('upcoming'));
		this.updateStatusBar();
	}

	/** Refreshes the status-bar Upcoming counter. Hidden when off or when 0 due. */
	updateStatusBar(): void {
		const el = this.statusBarEl;
		if (!el) return;
		if (!this.settings.showUpcomingStatusBar) {
			el.hide();
			return;
		}
		const count =
			AirtimeTab.getAiredDueCount(this.dataManager, this.readingDataManager, this.gameDataManager) +
			AirtimeTab.getMaybeDueCount(this.dataManager);
		if (count <= 0) {
			el.hide();
			return;
		}
		el.empty();
		el.show();
		// orange icon + "N due" (colour from .wl-statusbar-upcoming), reusing the ribbon's 'tv' icon
		const icon = el.createSpan({ cls: 'wl-statusbar-icon' });
		setIcon(icon, 'tv');
		el.createSpan({ cls: 'wl-statusbar-text', text: `${count} due` });
	}

	/**
	 * True when today is a day the given schedule fires. Avoids the rollover in
	 * getAirtimeNextDate/getAirtimeCountdown.
	 */
	private isScheduledForToday(schedule: AirtimeSchedule): boolean {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		if (schedule.recurrence === 'daily') return true;

		if (schedule.recurrence === 'weekly') {
			return schedule.dayOfWeek === now.getDay();
		}

		if (schedule.recurrence === 'monthly') {
			return now.getDate() === (schedule.dayOfMonth ?? -1);
		}

		if (schedule.recurrence === 'once' && schedule.releaseDate) {
			const rel = new Date(schedule.releaseDate + 'T00:00:00');
			const relDay = new Date(rel.getFullYear(), rel.getMonth(), rel.getDate());
			return relDay.getTime() === today.getTime();
		}

		return false;
	}

	/**
	 * Minimum card width (px) for every poster/cover grid and shelf, from the card-size step for this
	 * device class (desktop vs mobile).
	 */
	getCardMinWidth(): number {
		return cardSizeToMinWidth(
			Platform.isMobile ? this.settings.cardSizeMobile : this.settings.cardSize,
		);
	}

	/**
	 * Whether a tab's poster cards show their text under the poster (the per-tab cardTextStyles
	 * setting; 'under' is the default for data saved before it existed).
	 */
	isCardTextUnder(tab: CardStyleTab): boolean {
		return this.settings.cardTextStyles?.[tab] !== 'inside';
	}

	/**
	 * Publish the resolved card size as a body-level CSS var, so the plain-CSS grids (detail-modal
	 * member grids, non-virtual fallbacks) track the setting too. Called on load and on every change.
	 */
	applyCardSizeCssVar(): void {
		activeDocument.body.style.setProperty('--wl-card-min-width', `${this.getCardMinWidth()}px`);
	}

	/** Composes settings from defaults, data.json and the shared base (shared keys win). */
	async loadSettings(): Promise<void> {
		// a schema-1 data.json is not adopted yet: its settings are the local part until migration
		const localSettings = this.legacyData?.settings ?? this.local.data.settings;
		this.settings = composeSettings(
			localSettings as Record<string, unknown>,
			this.shared.get().settings,
		);
		// mirror into types.ts so the pure formatters render in the chosen order without a settings ref
		setActiveDateFormat(this.settings.dateFormat);
	}

	async saveSettings(): Promise<void> {
		// keep the date formatters in step with the setting on every save
		setActiveDateFormat(this.settings.dateFormat);
		await persistSettings(this.settings, this.local, this.shared);
	}

	/**
	 * Type slug the Add modal preselects. The sentinel → the last added type if it still exists, else
	 * the first available; a real, still-existing type → itself; otherwise the first available. Never
	 * returns a non-existent type while at least one exists.
	 */
	resolveDefaultAddType(): string {
		const types = this.settings.types ?? [];
		const firstAvailable = types[0]?.name ?? '';
		const exists = (name: string): boolean => !!name && types.some((t) => t.name === name);
		const choice = this.settings.defaultAddType ?? LAST_USED_TYPE_SENTINEL;
		if (choice === LAST_USED_TYPE_SENTINEL) {
			return exists(this.settings.lastAddedType) ? this.settings.lastAddedType : firstAvailable;
		}
		return exists(choice) ? choice : firstAvailable;
	}

	/**
	 * One-time migration of legacy `reading.json` / `history.json` into `data.json`.
	 *
	 * Obsidian Sync replicates data.json (the saveData channel) but NOT the raw adapter-written files,
	 * so their contents are copied into the single saveData object.
	 *
	 * Gated by `data.migratedReadingHistory`. Flag and migrated data are written together in ONE atomic
	 * saveData(), so an interrupted load simply re-runs the idempotent migration. The flag is only set
	 * when both legacy reads succeeded (an absent file counts as success); a parse failure leaves it
	 * unset to preserve a recovery chance. Legacy files are left on disk as a backup.
	 */
	private async migrateReadingHistory(): Promise<void> {
		const master = this.dataManager.getData();
		if (master.migratedReadingHistory === true) {
			return;
		}

		const adapter = this.app.vault.adapter;
		const dir = `${this.app.vault.configDir}/plugins/watchlog`;
		const readingPath = normalizePath(`${dir}/reading.json`);
		const historyPath = normalizePath(`${dir}/history.json`);

		// read legacy reading.json
		let readingOk = false;
		let readingData: ReadingData | null = null;
		try {
			if (await adapter.exists(readingPath)) {
				const raw = await adapter.read(readingPath);
				readingData = JSON.parse(raw) as ReadingData;
				readingOk = true;
			} else {
				readingOk = true; // absent = nothing to migrate (still a success)
			}
		} catch (e) {
			readingOk = false;
			console.warn('[WL] reading.json read/parse failed; migration will retry next load:', e);
		}

		// read legacy history.json
		let historyOk = false;
		let historyEntries: HistoryEntry[] | null = null;
		try {
			if (await adapter.exists(historyPath)) {
				const raw = await adapter.read(historyPath);
				const parsed = JSON.parse(raw) as { entries?: HistoryEntry[] };
				historyEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
				historyOk = true;
			} else {
				historyOk = true;
			}
		} catch (e) {
			historyOk = false;
			console.warn('[WL] history.json read/parse failed; migration will retry next load:', e);
		}

		// copy into the saveData object (with the don't-overwrite-with-empty belt)
		if (readingOk && readingData) {
			const legacyHasReading =
				(readingData.books?.length ?? 0) > 0 || (readingData.manga?.length ?? 0) > 0 ||
				(readingData.bookColumns?.length ?? 0) > 0 || (readingData.mangaColumns?.length ?? 0) > 0;
			const masterHasReading = !!master.reading &&
				(((master.reading.books?.length ?? 0) > 0) || ((master.reading.manga?.length ?? 0) > 0));
			if (legacyHasReading || !masterHasReading) {
				master.reading = readingData;
			}
		}

		if (historyOk && historyEntries) {
			const masterHasHistory = Array.isArray(master.history) && master.history.length > 0;
			if (historyEntries.length > 0 || !masterHasHistory) {
				master.history = historyEntries;
			}
		}

		// only mark migrated when both reads succeeded; otherwise retry next load
		if (readingOk && historyOk) {
			master.migratedReadingHistory = true;
		}

		// single atomic write: migrated data AND flag together
		await this.dataManager.persist();
	}

	private openWidgetPalette(editor: Editor): void {
		const widgets = [
			{ name: 'wl-todo: Track a title (full)', id: 'wl-todo' },
			{ name: 'wl-todo mini: Track a title (compact)', id: 'wl-todo:mini' },
			{ name: 'wl-stat: watched: Time watched (mini)', id: 'wl-stat:watched' },
			{ name: 'wl-stat: completed: Completed titles (mini)', id: 'wl-stat:completed' },
			{ name: 'wl-stat: remaining: Time remaining (mini)', id: 'wl-stat:remaining' },
			{ name: 'wl-stat: time: Watched + remaining (mini)', id: 'wl-stat:time' },
			{ name: 'wl-upcoming: next: Next upcoming (mini)', id: 'wl-upcoming:next' },
			{ name: 'wl-stat: time completed full: Time · Remaining · Completed card', id: 'wl-stat:time completed full' },
			{ name: 'wl-now-next: Now Watching + Up Next card', id: 'wl-now-next' },
		];

		new WidgetSelectModal(this.app, widgets, (selected) => {
			if (selected.id === 'wl-todo' || selected.id === 'wl-todo:mini') {
				const titles = this.dataManager.getTitles();
				if (titles.length === 0) {
					new Notice('No titles in your watchlog library yet.');
					return;
				}
				const isMini = selected.id === 'wl-todo:mini';
				new InsertWidgetModal(this.app, titles, (title) => {
					if (isMini) {
						editor.replaceSelection(`\`\`\`wl-todo\n${title.title}\nmini\n\`\`\``);
					} else {
						editor.replaceSelection(`\`\`\`wl-todo\n${title.title}\n\`\`\``);
					}
				}).open();
			} else if (selected.id === 'wl-stat:watched') {
				editor.replaceSelection('```wl-stat\nwatched\n```');
			} else if (selected.id === 'wl-stat:completed') {
				editor.replaceSelection('```wl-stat\ncompleted\n```');
			} else if (selected.id === 'wl-stat:remaining') {
				editor.replaceSelection('```wl-stat\nremaining\n```');
			} else if (selected.id === 'wl-stat:time') {
				editor.replaceSelection('```wl-stat\ntime\n```');
			} else if (selected.id === 'wl-upcoming:next') {
				editor.replaceSelection('```wl-upcoming\nnext\n```');
			} else if (selected.id === 'wl-stat:time completed full') {
				editor.replaceSelection('```wl-stat\ntime completed full\n```');
			} else if (selected.id === 'wl-now-next') {
				editor.replaceSelection('```wl-now-next\n```');
			}
		}).open();
	}

	private async activateView(tab?: TabName): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(WATCHLOG_VIEW_TYPE);
		if (existing.length > 0) {
			const leaf = existing[0]!;
			void workspace.revealLeaf(leaf);
			if (tab && leaf.view instanceof WatchLogView) leaf.view.setActiveTab(tab);
			return;
		}

		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: WATCHLOG_VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);
		if (tab && leaf.view instanceof WatchLogView) leaf.view.setActiveTab(tab);
	}
}

// Widget selection modal

interface WidgetItem { name: string; id: string; }

class WidgetSelectModal extends FuzzySuggestModal<WidgetItem> {
	private items: WidgetItem[];
	private onSelect: (item: WidgetItem) => void;

	constructor(app: App, items: WidgetItem[], onSelect: (item: WidgetItem) => void) {
		super(app);
		this.items = items;
		this.onSelect = onSelect;
		this.setPlaceholder('Select a widget to insert...');
	}

	getItems(): WidgetItem[] { return this.items; }
	getItemText(item: WidgetItem): string { return item.name; }
	onChooseItem(item: WidgetItem): void { this.onSelect(item); }
}

import { ItemView, Platform, setIcon, WorkspaceLeaf } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import { DashboardTab } from './DashboardTab';
import { ListTab } from './ListTab';
import { AirtimeTab } from './AirtimeTab';
import { CustomListsTab } from './CustomListsTab';
import { DraftsTab } from './DraftsTab';
import { ReadingTab } from './ReadingTab';
import { GamesTab } from './GamesTab';
import { LogTab } from './LogTab';

export const WATCHLOG_VIEW_TYPE = 'watchlog-view';

export type TabName = 'dashboard' | 'watchlist' | 'upcoming' | 'reading' | 'games' | 'custom-lists' | 'drafts' | 'log';

const TAB_CLASSES = ['wl-dashboard', 'wl-list', 'wl-airtime', 'wl-reading-tab', 'wl-games-tab', 'wl-custom-lists', 'wl-log-tab'];

export class WatchLogView extends ItemView {
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private activeTab: TabName;
	private dashboardTab: DashboardTab | null = null;
	private listTab: ListTab | null = null;
	private airtimeTab: AirtimeTab | null = null;
	private readingTab: ReadingTab | null = null;
	private gamesTab: GamesTab | null = null;
	private customListsTab: CustomListsTab | null = null;
	private draftsTab: DraftsTab | null = null;
	private logTab: LogTab | null = null;
	private airtimeBtn: HTMLButtonElement | null = null;
	private draftsBtn: HTMLButtonElement | null = null;
	private tabButtons: Partial<Record<TabName, HTMLButtonElement>> = {};
	private tabContentEl: HTMLElement | null = null;
	private dataChangeListener: () => void;
	private mobileResizeObserver: ResizeObserver | null = null;
	private mobileSizerRaf: number | null = null;
	private lastAppliedTabHeight = -1;
	// mobile keyboard "edit pin" state (see the edit-pin block below)
	private editPinActive = false;
	private smallestEditHeight = -1;
	private pinReleaseTimer: number | null = null;
	private focusListenersBound = false;

	constructor(leaf: WorkspaceLeaf, plugin: WatchLogPlugin, dataManager: DataManager) {
		super(leaf);
		this.plugin = plugin;
		this.dataManager = dataManager;
		// the panel always opens on the Dashboard tab
		this.activeTab = 'dashboard';
		// re-render in place so tab instances (and their state) are preserved
		this.dataChangeListener = () => {
			this.refreshActiveTab();
		};
	}

	getViewType(): string {
		return WATCHLOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Watchlog';
	}

	getIcon(): string {
		return 'tv';
	}

	async onOpen(): Promise<void> {
		await super.onOpen();
		this.dataManager.onChange(this.dataChangeListener);
		this.buildUI();

		if (Platform.isMobile) {
			this.setupTabContentSizer();
		}
	}

	// Mobile keyboard layout fix. When the keyboard opens, this WebView freezes .wl-tab-content at its
	// content height instead of distributing .wl-view's free space via flex-grow, leaving the tab the
	// wrong size until a reflow forces it. Fix: observe .wl-view and, on every settle (keyboard
	// open/close, rotation, split resize), imperatively set an explicit px height (+ flex:none
	// !important) on the *current* .wl-tab-content — re-queried in the callback so it survives
	// tab-content rebuilds.
	private setupTabContentSizer(): void {
		// never run more than one observer (onOpen could run again)
		this.mobileResizeObserver?.disconnect();
		this.mobileResizeObserver = new ResizeObserver(() => {
			// coalesce resize bursts (keyboard animation fires many) into one write per frame
			if (this.mobileSizerRaf !== null) return;
			this.mobileSizerRaf = window.requestAnimationFrame(() => {
				this.mobileSizerRaf = null;
				this.applyTabContentHeight();
			});
		});
		this.mobileResizeObserver.observe(this.contentEl);

		// layer 2, focus listeners: detect an inline editor inside the scroller gaining or losing focus, so
		// the scroller height can be pinned/released. Bound once.
		if (!this.focusListenersBound) {
			this.registerDomEvent(this.contentEl, 'focusin', (e: FocusEvent) => this.onScrollerFocusIn(e));
			this.registerDomEvent(this.contentEl, 'focusout', (e: FocusEvent) => this.onScrollerFocusOut(e));
			this.focusListenersBound = true;
		}
	}

	// Mobile keyboard fix — edit pin. On short lists (notably Custom Lists) inline-editing a cell opens
	// the keyboard, but some resize readings during that window momentarily report the FULL
	// no-keyboard height; honouring them re-expands .wl-tab-content and exposes a dark band under the
	// content. Fix: while an editor inside the scroller is focused, pin to the SMALLEST clientHeight
	// observed and ignore any larger reading. Release is guaranteed on focusout (after a grace window,
	// so cell-to-cell navigation doesn't flicker), with a safety net in applyTabContentHeight().

	/** True when `target` is an input/textarea/contenteditable inside .wl-tab-content. */
	private isEditorInScroller(target: EventTarget | null): boolean {
		const node = target as HTMLElement | null;
		if (!node || typeof node.tagName !== 'string') return false;
		const tabContent = this.contentEl.querySelector(':scope > .wl-tab-content');
		if (!tabContent || !tabContent.contains(node)) return false;
		const tag = node.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || node.isContentEditable === true;
	}

	private onScrollerFocusIn(e: FocusEvent): void {
		if (!Platform.isMobile || !this.isEditorInScroller(e.target)) return;
		// re-focusing within the grace window (cell navigation) — keep the pin
		if (this.pinReleaseTimer !== null) {
			window.clearTimeout(this.pinReleaseTimer);
			this.pinReleaseTimer = null;
		}
		// start a fresh editing session: re-measure the smallest height
		if (!this.editPinActive) this.smallestEditHeight = -1;
		this.editPinActive = true;
		// force the next reading (keyboard-shrunk) to be applied & pinned
		this.lastAppliedTabHeight = -1;
		this.applyTabContentHeight();
	}

	private onScrollerFocusOut(e: FocusEvent): void {
		if (!this.isEditorInScroller(e.target)) return;
		if (this.pinReleaseTimer !== null) window.clearTimeout(this.pinReleaseTimer);
		// grace window: only release once focus has truly left every editor in the scroller
		this.pinReleaseTimer = window.setTimeout(() => {
			this.pinReleaseTimer = null;
			const active = this.contentEl.ownerDocument.activeElement;
			if (this.isEditorInScroller(active)) return;
			this.releaseEditPin();
		}, 250);
	}

	/** Drops the pin and hands sizing back to the ResizeObserver (full height). */
	private releaseEditPin(): void {
		if (!this.editPinActive) return;
		this.editPinActive = false;
		this.smallestEditHeight = -1;
		const tabContent = this.contentEl.querySelector<HTMLElement>(':scope > .wl-tab-content');
		// remove the pinned height and let the observer re-assert the full height now the keyboard closed
		tabContent?.removeClass('wl-tab-content-pinned');
		this.lastAppliedTabHeight = -1;
		this.applyTabContentHeight();
	}

	private applyTabContentHeight(): void {
		const viewContent = this.contentEl;
		if (!viewContent) return;
		const tabBar = viewContent.querySelector<HTMLElement>(':scope > .wl-tab-bar');
		const tabContent = viewContent.querySelector<HTMLElement>(':scope > .wl-tab-content');
		if (!tabContent) return;

		const wlViewClientHeight = viewContent.clientHeight;
		const tabBarHeight = tabBar ? tabBar.offsetHeight : 0;
		let target = wlViewClientHeight - tabBarHeight;

		// guard: don't write until wl-view has a real measured height
		if (target <= 0) return;

		// edit pin layer
		if (this.editPinActive) {
			// safety net: focus left the scroller without a focusout firing (e.g. the editor was removed on
			// save) — release so it doesn't stay pinned at the keyboard-shrunk height
			if (!this.isEditorInScroller(this.contentEl.ownerDocument.activeElement)) {
				this.releaseEditPin();
				return;
			}
			// track the smallest height seen while editing and pin to it, ignoring larger (no-keyboard)
			// readings during this window
			if (this.smallestEditHeight < 0 || target < this.smallestEditHeight) {
				this.smallestEditHeight = target;
			}
			target = this.smallestEditHeight;
		}

		// guard: skip redundant writes when the height hasn't changed
		if (target === this.lastAppliedTabHeight) return;
		this.lastAppliedTabHeight = target;

		// the pinned class sets an explicit px height (via CSS variable) + flex:none, beating the
		// `flex: 1 1 0%` base rule this WebView fails to distribute. min-height:0 / overflow-y stay intact.
		tabContent.addClass('wl-tab-content-pinned');
		tabContent.setCssProps({ '--wl-pinned-tab-height': `${target}px` });
	}

	/** Called after tab content changes on mobile to re-apply the height. */
	refreshMobileLayout(): void {
		if (!Platform.isMobile || !this.mobileResizeObserver) return;
		// a tab switch recreates .wl-tab-content with no inline height; force a re-apply even when the
		// wl-view height itself hasn't changed
		this.lastAppliedTabHeight = -1;
		this.applyTabContentHeight();
	}

	async onClose(): Promise<void> {
		await super.onClose();
		this.dataManager.offChange(this.dataChangeListener);
		this.overflowObserver?.disconnect();
		this.overflowObserver = null;
		if (this.mobileResizeObserver) {
			this.mobileResizeObserver.disconnect();
			this.mobileResizeObserver = null;
		}
		if (this.mobileSizerRaf !== null) {
			window.cancelAnimationFrame(this.mobileSizerRaf);
			this.mobileSizerRaf = null;
		}
		// clear edit-pin timer/state (focus listeners auto-removed via registerDomEvent)
		if (this.pinReleaseTimer !== null) {
			window.clearTimeout(this.pinReleaseTimer);
			this.pinReleaseTimer = null;
		}
		this.editPinActive = false;
		this.smallestEditHeight = -1;
		// clear the explicit sizing the mobile keyboard fix applied to wl-tab-content
		const tabContent = this.contentEl.querySelector<HTMLElement>('.wl-tab-content');
		if (tabContent) {
			tabContent.removeClass('wl-tab-content-pinned');
			tabContent.style.removeProperty('--wl-pinned-tab-height');
		}
		this.destroyDraftsTab();
		this.customListsTab?.destroy();
		this.listTab?.destroy();
		this.airtimeTab?.destroy();
		this.readingTab?.destroy();
		this.readingTab = null;
		this.gamesTab?.destroy();
		this.gamesTab = null;
		this.logTab?.destroy();
		this.logTab = null;
	}

	/** Reapplies the active colour theme and rebuilds the UI. Used by SettingsTab. */
	refreshUI(): void {
		this.applyColorTheme(this.contentEl);
		this.buildUI();
	}

	private applyColorTheme(root: HTMLElement): void {
		const colorTheme = this.plugin.settings.colorTheme ?? 'default';
		if (colorTheme === 'default') {
			root.removeAttribute('data-theme');
		} else {
			root.setAttribute('data-theme', colorTheme);
		}
	}

	private destroyDraftsTab(): void {
		if (this.draftsTab) {
			this.draftsTab.destroy();
			this.draftsTab = null;
		}
	}

	private buildUI(): void {
		// destroy any live drafts listener before rebuilding the UI
		this.destroyDraftsTab();

		const root = this.contentEl;
		root.empty();
		root.addClass('wl-view');
		// mobile gets icon-only tabs and the container-responsive dashboard grid; desktop keeps text
		// labels and the fixed 3-column layout. Toggled via this class so styling keys off Platform.isMobile,
		// not a viewport media query.
		root.toggleClass('wl-mobile', Platform.isMobile);
		this.applyColorTheme(root);

		const tabBar = root.createDiv({ cls: 'wl-tab-bar' });
		const dashBtn = this.makeTabBtn(tabBar, 'dashboard', 'Dashboard', 'layout-dashboard');
		const listBtn = this.makeTabBtn(tabBar, 'watchlist', 'Watchlist', 'tv');
		const readingBtn = this.makeTabBtn(tabBar, 'reading', 'Reading', 'book-open');
		const gamesBtn = this.makeTabBtn(tabBar, 'games', 'Games', 'gamepad-2');
		this.airtimeBtn = this.makeTabBtn(tabBar, 'upcoming', 'Upcoming', 'calendar');
		const customListsBtn = this.makeTabBtn(tabBar, 'custom-lists', 'Custom lists', 'list');
		this.draftsBtn = this.makeTabBtn(tabBar, 'drafts', 'Drafts', 'square-pen');
		const logBtn = this.makeTabBtn(tabBar, 'log', 'Log', 'history');

		const allBtns = [dashBtn, listBtn, this.airtimeBtn, readingBtn, gamesBtn, customListsBtn, this.draftsBtn, logBtn];
		this.tabButtons = {
			dashboard: dashBtn,
			watchlist: listBtn,
			upcoming: this.airtimeBtn,
			reading: readingBtn,
			games: gamesBtn,
			'custom-lists': customListsBtn,
			drafts: this.draftsBtn,
			log: logBtn,
		};

		dashBtn.addEventListener('click', () => {
			if (this.activeTab === 'dashboard') return;
			this.destroyDraftsTab();
			this.activeTab = 'dashboard';
			allBtns.forEach((b) => b.removeClass('is-active'));
			dashBtn.addClass('is-active');
			this.renderTabContent();
		});

		listBtn.addEventListener('click', () => {
			if (this.activeTab === 'watchlist') return;
			this.destroyDraftsTab();
			this.activeTab = 'watchlist';
			allBtns.forEach((b) => b.removeClass('is-active'));
			listBtn.addClass('is-active');
			this.renderTabContent();
		});

		this.airtimeBtn.addEventListener('click', () => {
			if (this.activeTab === 'upcoming') return;
			this.destroyDraftsTab();
			this.activeTab = 'upcoming';
			allBtns.forEach((b) => b.removeClass('is-active'));
			this.airtimeBtn!.addClass('is-active');
			this.renderTabContent();
		});

		readingBtn.addEventListener('click', () => {
			if (this.activeTab === 'reading') return;
			this.destroyDraftsTab();
			this.activeTab = 'reading';
			allBtns.forEach((b) => b.removeClass('is-active'));
			readingBtn.addClass('is-active');
			this.renderTabContent();
		});

		gamesBtn.addEventListener('click', () => {
			if (this.activeTab === 'games') return;
			this.destroyDraftsTab();
			this.activeTab = 'games';
			allBtns.forEach((b) => b.removeClass('is-active'));
			gamesBtn.addClass('is-active');
			this.renderTabContent();
		});

		customListsBtn.addEventListener('click', () => {
			if (this.activeTab === 'custom-lists') return;
			this.destroyDraftsTab();
			this.activeTab = 'custom-lists';
			allBtns.forEach((b) => b.removeClass('is-active'));
			customListsBtn.addClass('is-active');
			this.renderTabContent();
		});

		this.draftsBtn.addEventListener('click', () => {
			if (this.activeTab === 'drafts') return;
			this.activeTab = 'drafts';
			allBtns.forEach((b) => b.removeClass('is-active'));
			this.draftsBtn!.addClass('is-active');
			this.renderTabContent();
		});

		logBtn.addEventListener('click', () => {
			if (this.activeTab === 'log') return;
			this.destroyDraftsTab();
			this.activeTab = 'log';
			allBtns.forEach((b) => b.removeClass('is-active'));
			logBtn.addClass('is-active');
			this.renderTabContent();
		});

		this.tabContentEl = root.createDiv({ cls: 'wl-tab-content' });
		this.renderTabContent();

		this.updateUpcomingBadge();

		// the Drafts count needs a count-only vault scan, so it is only correct once the metadata cache is
		// ready — gate on 'resolved' (which also fires for changes made while Obsidian was closed, avoiding
		// a stale count). The direct call covers an already-resolved cache, where 'resolved' won't fire.
		void this.updateDraftsBadge();
		this.registerEvent(this.plugin.app.metadataCache.on('resolved', () => {
			void this.updateDraftsBadge();
		}));
	}

	/**
	 * Tab-bar button. Mobile renders icon-only (Lucide via setIcon) with the label as the accessible
	 * name; desktop shows the text label.
	 */
	private makeTabBtn(tabBar: HTMLElement, tab: TabName, label: string, icon: string): HTMLButtonElement {
		const btn = tabBar.createEl('button', {
			cls: `wl-tab-btn${this.activeTab === tab ? ' is-active' : ''}`,
		});
		if (Platform.isMobile) {
			btn.addClass('wl-tab-btn-icon');
			setIcon(btn, icon);
			btn.setAttribute('aria-label', label);
		} else {
			btn.setText(label);
		}
		return btn;
	}

	/**
	 * Count badge on a tab button. Desktop shows "Label (N)"; mobile (icon mode) can't overwrite the
	 * icon, so it toggles a small purple dot.
	 */
	private setTabBadge(btn: HTMLButtonElement | null, label: string, count: number): void {
		if (!btn) return;
		if (Platform.isMobile) {
			btn.toggleClass('wl-tab-has-badge', count > 0);
		} else {
			btn.textContent = count > 0 ? `${label} (${count})` : label;
		}
	}

	/**
	 * Programmatically switch tabs (e.g. from the status-bar Upcoming counter). Mirrors a tab-button
	 * click: updates active state and re-renders the content.
	 */
	setActiveTab(tab: TabName): void {
		if (this.activeTab === tab) return;
		// UI not built yet — record the intent so the initial render reflects it
		if (!this.tabContentEl) { this.activeTab = tab; return; }
		if (tab !== 'drafts') this.destroyDraftsTab();
		this.activeTab = tab;
		for (const b of Object.values(this.tabButtons)) b?.removeClass('is-active');
		this.tabButtons[tab]?.addClass('is-active');
		this.renderTabContent();
	}

	private renderTabContent(): void {
		if (!this.tabContentEl) return;
		// tear down inline editors / document listeners from the previous tab
		this.customListsTab?.destroy();
		if (this.activeTab !== 'reading') {
			this.readingTab?.destroy();
			this.readingTab = null;
		}
		if (this.activeTab !== 'games') {
			this.gamesTab?.destroy();
			this.gamesTab = null;
		}
		if (this.activeTab !== 'log') {
			this.logTab?.destroy();
			this.logTab = null;
		}
		this.tabContentEl.empty();
		for (const cls of TAB_CLASSES) this.tabContentEl.removeClass(cls);

		if (this.activeTab === 'dashboard') {
			this.dashboardTab = new DashboardTab(this.tabContentEl, this.plugin, this.dataManager, this.plugin.readingDataManager);
			this.dashboardTab.render();
		} else if (this.activeTab === 'watchlist') {
			// always a new instance when switching to the Watchlist tab so the container element is correct;
			// state (filters, expandedId) survives on this.listTab during data-change refreshes
			this.listTab?.destroy();
			this.listTab = new ListTab(this.tabContentEl, this.plugin, this.dataManager);
			this.listTab.render();
		} else if (this.activeTab === 'upcoming') {
			this.airtimeTab?.destroy();
			this.airtimeTab = new AirtimeTab(this.tabContentEl, this.plugin, this.dataManager, (count) => {
				this.setTabBadge(this.airtimeBtn, 'Upcoming', count);
			});
			this.airtimeTab.render();
		} else if (this.activeTab === 'reading') {
			this.readingTab?.destroy();
			this.readingTab = new ReadingTab(
				this.tabContentEl,
				this.plugin,
				this.plugin.readingDataManager,
			);
			this.readingTab.render();
		} else if (this.activeTab === 'games') {
			this.gamesTab?.destroy();
			this.gamesTab = new GamesTab(this.tabContentEl, this.plugin, this.plugin.gameDataManager);
			this.gamesTab.render();
		} else if (this.activeTab === 'drafts') {
			this.draftsTab = new DraftsTab(
				this.tabContentEl,
				this.plugin,
				this.dataManager,
				(count) => this.setDraftsBadge(count),
			);
			void this.draftsTab.render();
		} else if (this.activeTab === 'log') {
			this.logTab = new LogTab(this.tabContentEl, this.plugin);
			this.logTab.render();
		} else {
			// custom-lists
			this.customListsTab = new CustomListsTab(this.tabContentEl, this.plugin, this.dataManager);
			void this.customListsTab.render();
		}
		this.guardOverflow();
		this.refreshMobileLayout();
	}

	/**
	 * Called by the data change listener. Re-renders the active tab without destroying the ListTab
	 * instance, so expandedId and filter state survive.
	 */
	private refreshActiveTab(): void {
		this.applyColorTheme(this.contentEl);
		if (this.tabContentEl) {
			for (const cls of TAB_CLASSES) this.tabContentEl.removeClass(cls);
		}
		if (this.activeTab === 'watchlist' && this.listTab) {
			this.listTab.render();
		} else if (this.activeTab === 'dashboard' && this.dashboardTab) {
			this.dashboardTab.render();
		} else if (this.activeTab === 'upcoming' && this.airtimeTab) {
			this.airtimeTab.render();
		} else if (this.activeTab === 'reading' && this.readingTab) {
			this.readingTab.render();
		} else if (this.activeTab === 'games' && this.gamesTab) {
			this.gamesTab.render();
		} else if (this.activeTab === 'custom-lists' && this.customListsTab) {
			void this.customListsTab.render();
		} else if (this.activeTab === 'drafts' && this.draftsTab) {
			void this.draftsTab.render();
		} else if (this.activeTab === 'log' && this.logTab) {
			this.logTab.render();
		} else {
			this.renderTabContent();
			return;
		}
		this.guardOverflow();
		this.updateUpcomingBadge();
	}

	private overflowObserver: MutationObserver | null = null;

	private guardOverflow(): void {
		if (!this.tabContentEl) return;
		this.overflowObserver?.disconnect();

		const el = this.tabContentEl;
		const renderTime = Date.now();

		this.overflowObserver = new MutationObserver(() => {
			if (Date.now() - renderTime > 300) return;
			const computed = window.getComputedStyle(el).overflow;
			if (computed === 'hidden') {
				// strip any inline override so the class rule below wins without !important
				el.style.removeProperty('overflow');
				el.addClass('wl-force-overflow-auto');
			}
		});
		this.overflowObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
	}

	private updateUpcomingBadge(): void {
		if (!this.airtimeBtn) return;
		const count = AirtimeTab.getAiredDueCount(this.dataManager, this.plugin.readingDataManager, this.plugin.gameDataManager) + AirtimeTab.getMaybeDueCount(this.dataManager);
		this.setTabBadge(this.airtimeBtn, 'Upcoming', count);
	}

	private setDraftsBadge(count: number): void {
		this.setTabBadge(this.draftsBtn, 'Drafts', count);
	}

	/** Count-only drafts scan, so the tab badge is correct before the Drafts tab is opened. */
	private async updateDraftsBadge(): Promise<void> {
		if (!this.draftsBtn) return;
		const count = await DraftsTab.computePendingCount(this.plugin, this.dataManager);
		this.setDraftsBadge(count);
	}
}


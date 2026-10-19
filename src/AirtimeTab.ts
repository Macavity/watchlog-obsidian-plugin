import { App, Modal, Notice, setIcon } from 'obsidian';
import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { ReadingDataManager } from './ReadingDataManager';
import type { GameDataManager } from './GameDataManager';
import type { WatchLogTitle, AirtimeEntry, AirtimeSchedule, AirtimeRecurrence, MaybeTitle, Book, Manga, Game } from './types';
import { getAirtimeScheduleString, getThemedColor, getReadingTypeColor, getDisplayPoster, isReleaseDateFuture, formatDateDisplay, todayIso, toIsoDate, GAME_AUTO_STATUS } from './types';
import { createDatePicker } from './DatePicker';
import { rawgResizedCover } from './ApiService';
import { VirtualGrid, computeGridMetrics, type GridMetrics } from './VirtualGrid';
import { VirtualScroller } from './VirtualScroller';
import { LazyCardObserver } from './LazyCardObserver';
import { openCardMenu } from './PosterCard';
import { ConfirmModal } from './ConfirmModal';
import { MaybeAddModal } from './MaybeAddModal';
import { ReadingScheduleModal } from './ReadingScheduleModal';
import { GameScheduleModal } from './GameScheduleModal';
import { UpcomingFinderModal, type UpcomingFinderItem } from './UpcomingFinderModal';

/**
 * A normalized Upcoming card subject — a watchlist title, a reading item or a game — so the
 * tracker renders and acts on all three through one path.
 */
type ResolvedUpcoming = {
	source: 'watchlist' | 'reading' | 'game';
	id: string;
	title: string;
	/** Badge text: a watch type ("Anime", "Movie", …), "Book" / "Manga", or "Game". */
	typeName: string;
	/** Colored-badge color, or null for a plain badge (reading/games). */
	typeColor: string | null;
	externalLink: string;
	/** True for a single release (movie/book/game): 0 or 1 total units. */
	isSingle: boolean;
	/** Total episodes (watch) or chapters (reading). Games have none (0). */
	totalUnits: number;
	/** Lowercase incrementing unit: "episode" | "chapter". */
	unitNoun: string;
	/** Capitalized incrementing unit: "Episode" | "Chapter". */
	unitNounCap: string;
	/** Short form for the cramped progress badge only ("Ep"). */
	unitNounBadge: string;
	/** Capitalized grouping unit: "Season" | "Volume". */
	groupNounCap: string;
	/** Badge tail: "Airing next" | "Reading next". */
	nextLabel: string;
	/** Status to revert to on a single-release tick. */
	planStatus: string;
};

// Helpers

function formatDaysWithMonths(days: number): string {
	if (days < 30) return `in ${days} days`;
	const months = Math.round(days / 30);
	return `in ${days} days (${months} month${months !== 1 ? 's' : ''})`;
}

// Card state helpers

type DetailedCountdown = {
	kind: 'future' | 'today-before' | 'aired' | 'due';
	label: string;
	daysUntil: number;
};

/** One renderable tracker entry: the airtime entry, its resolved subject and its countdown state. */
type TrackerCardData = { entry: AirtimeEntry; r: ResolvedUpcoming; countdown: DetailedCountdown };

/**
 * True when the scheduled HH:MM has already passed today. No releaseTime ⇒ the whole day counts
 * as passed (show aired/due).
 */
function isAirtimePassedNow(schedule: AirtimeSchedule): boolean {
	if (!schedule.releaseTime) return true;
	const now = new Date();
	const [hStr, mStr] = schedule.releaseTime.split(':');
	const h = parseInt(hStr ?? '0', 10);
	const m = parseInt(mStr ?? '0', 10);
	return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

/**
 * Countdown state for a card, handling the "airtime passed today" case that getAirtimeCountdown
 * rolls over to next week. `lastAcknowledgedDate` makes recurring cards reset to the next
 * occurrence right after you tick an episode.
 */
function getDetailedCountdown(
	schedule: AirtimeSchedule,
	isMovie: boolean,
	lastAcknowledgedDate?: string,
): DetailedCountdown {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	const acknowledgedToday = lastAcknowledgedDate === todayStr;

	if (schedule.recurrence === 'once') {
		if (!schedule.releaseDate) return { kind: 'future', label: '—', daysUntil: 9999 };
		const rel = new Date(schedule.releaseDate + 'T00:00:00');
		const relDay = new Date(rel.getFullYear(), rel.getMonth(), rel.getDate());

		if (relDay.getTime() < today.getTime()) {
			return isMovie ? { kind: 'due', label: 'Due', daysUntil: 0 } : { kind: 'aired', label: 'Aired', daysUntil: 0 };
		}
		if (relDay.getTime() === today.getTime()) {
			if (isAirtimePassedNow(schedule)) {
				return isMovie ? { kind: 'due', label: 'Due', daysUntil: 0 } : { kind: 'aired', label: 'Aired', daysUntil: 0 };
			}
			return { kind: 'today-before', label: 'Today', daysUntil: 0 };
		}
		const daysUntil = Math.round((relDay.getTime() - today.getTime()) / 86400000);
		if (daysUntil === 1) return { kind: 'future', label: 'Tomorrow', daysUntil: 1 };
		return { kind: 'future', label: formatDaysWithMonths(daysUntil), daysUntil };
	}

	if (schedule.recurrence === 'daily') {
		const passed = isAirtimePassedNow(schedule);
		// already ticked today → advance to tomorrow
		if (passed && acknowledgedToday) return { kind: 'future', label: 'Tomorrow', daysUntil: 1 };
		if (passed) return { kind: 'aired', label: 'Aired', daysUntil: 0 };
		return { kind: 'today-before', label: 'Today', daysUntil: 0 };
	}

	if (schedule.recurrence === 'weekly' && schedule.dayOfWeek !== undefined) {
		const currentDay = now.getDay();
		const isScheduledDay = currentDay === schedule.dayOfWeek;
		if (isScheduledDay && !acknowledgedToday) {
			if (isAirtimePassedNow(schedule)) return { kind: 'aired', label: 'Aired', daysUntil: 0 };
			return { kind: 'today-before', label: 'Today', daysUntil: 0 };
		}
		// acknowledged on the scheduled day → force 7 days until the next occurrence
		let daysUntil = (isScheduledDay && acknowledgedToday)
			? 7
			: (schedule.dayOfWeek - currentDay + 7) % 7;
		if (daysUntil === 0) daysUntil = 7;
		if (daysUntil === 1) return { kind: 'future', label: 'Tomorrow', daysUntil: 1 };
		return { kind: 'future', label: formatDaysWithMonths(daysUntil), daysUntil };
	}

	if (schedule.recurrence === 'monthly' && schedule.dayOfMonth) {
		const currentDate = now.getDate();
		const isScheduledDay = currentDate === schedule.dayOfMonth;
		if (isScheduledDay && !acknowledgedToday) {
			if (isAirtimePassedNow(schedule)) return { kind: 'aired', label: 'Aired', daysUntil: 0 };
			return { kind: 'today-before', label: 'Today', daysUntil: 0 };
		}
		// acknowledged on the scheduled day → advance to next month
		let nextDate: Date;
		if (isScheduledDay && acknowledgedToday) {
			nextDate = new Date(now.getFullYear(), now.getMonth() + 1, schedule.dayOfMonth);
		} else {
			nextDate = new Date(now.getFullYear(), now.getMonth(), schedule.dayOfMonth);
			if (nextDate.getTime() <= today.getTime()) {
				nextDate = new Date(now.getFullYear(), now.getMonth() + 1, schedule.dayOfMonth);
			}
		}
		const daysUntil = Math.round((nextDate.getTime() - today.getTime()) / 86400000);
		if (daysUntil === 1) return { kind: 'future', label: 'Tomorrow', daysUntil: 1 };
		return { kind: 'future', label: formatDaysWithMonths(daysUntil), daysUntil };
	}

	return { kind: 'future', label: '—', daysUntil: 9999 };
}

// "X days ago" label

function formatDaysAgo(releaseDateStr: string): string {
	const release = new Date(releaseDateStr + 'T00:00:00');
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const diffDays = Math.floor((today.getTime() - release.getTime()) / 86400000);
	if (diffDays <= 0) return 'Today';
	if (diffDays === 1) return 'Yesterday';
	return `${diffDays} days ago`;
}

// AirtimeTab

export class AirtimeTab {
	private container: HTMLElement;
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private readingDataManager: ReadingDataManager;
	private gameDataManager: GameDataManager;
	private onCountChange?: (count: number) => void;

	currentSubTab: 'tracker' | 'history' | 'maybe' = 'tracker';

	selectionMode = false;
	selectedItems: Set<string> = new Set(); // AirtimeEntry ids

	searchQuery = '';

	// tracker presentation (List rows / Cards grid) — persisted in settings
	trackerView: 'list' | 'cards' = 'list';

	// one VirtualGrid per month section, all on the shared VirtualScroller
	private trackerScroller: VirtualScroller | null = null;
	// survives re-renders (tick, search, data change) within this tab instance
	private _trackerPersistentScrollTop = 0;

	// watchlist titles only — reading items already carry their coverUrl
	private trackerObserver: LazyCardObserver | null = null;

	// document-level click handlers for transient card menus, cleaned on render
	private activeCleanups: (() => void)[] = [];

	constructor(
		container: HTMLElement,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		onCountChange?: (count: number) => void,
	) {
		this.container = container;
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.readingDataManager = plugin.readingDataManager;
		this.gameDataManager = plugin.gameDataManager;
		this.onCountChange = onCountChange;
		this.trackerView = plugin.settings.upcomingTrackerView === 'cards' ? 'cards' : 'list';
	}

	/**
	 * Normalizes an airtime entry into a renderable subject, resolving the underlying title or
	 * reading item. null for orphan entries.
	 */
	private resolveEntry(entry: AirtimeEntry): ResolvedUpcoming | null {
		if (entry.source === 'reading') {
			const kind = entry.readingKind ?? 'book';
			const item: Book | Manga | undefined =
				kind === 'book' ? this.readingDataManager.getBook(entry.titleId) : this.readingDataManager.getManga(entry.titleId);
			if (!item) return null;
			const totalUnits = entry.totalEpisodes ?? item.totalChapters ?? 0;
			return {
				source: 'reading',
				id: item.id,
				title: item.title,
				typeName: kind === 'book' ? 'Book' : 'Manga',
				typeColor: this.plugin.settings.coloredTypeBadges
					? getReadingTypeColor(kind, this.plugin.settings)
					: null,
				externalLink: item.externalLink ?? '',
				// the schedule's mode decides single vs recurring — a multi-chapter item scheduled as a one-off
				// release date still ticks like one
				isSingle: entry.schedule.recurrence === 'once',
				totalUnits,
				unitNoun: 'chapter',
				unitNounCap: 'Chapter',
				unitNounBadge: 'Chapter',
				groupNounCap: 'Volume',
				nextLabel: 'Reading next',
				planStatus: 'Plan to Read',
			};
		}

		if (entry.source === 'game') {
			const game = this.gameDataManager.getGame(entry.titleId);
			if (!game) return null;
			return {
				source: 'game',
				id: game.id,
				title: game.title,
				typeName: 'Game',
				// games have no per-source badge color setting — always plain
				typeColor: null,
				// store page first (the GameDetailModal priority), then external link
				externalLink: game.storeUrl || game.externalLink,
				// games are always single releases — no episode/chapter counters
				isSingle: true,
				totalUnits: 0,
				unitNoun: 'release',
				unitNounCap: 'Release',
				unitNounBadge: 'Release',
				groupNounCap: 'Season',
				nextLabel: 'Releasing next',
				planStatus: this.gameDataManager.getSettings().defaultStatus || 'Not started',
			};
		}

		const title = this.dataManager.getTitle(entry.titleId);
		if (!title) return null;
		const typeDef = this.plugin.settings.types.find((t) => t.name === title.type);
		const colored = this.plugin.settings.coloredTypeBadges;
		return {
			source: 'watchlist',
			id: title.id,
			title: title.title,
			typeName: title.type,
			typeColor: colored && typeDef
				? getThemedColor(title.type, typeDef.color, this.plugin.settings.colorTheme)
				: null,
			externalLink: title.externalLink,
			// same rule as reading: the schedule's mode decides, so a series set to "Single release" gets the
			// movie-style due/tick flow
			isSingle: entry.schedule.recurrence === 'once',
			totalUnits: entry.totalEpisodes ?? title.totalEpisodes,
			unitNoun: 'episode',
			unitNounCap: 'Episode',
			unitNounBadge: 'Ep',
			groupNounCap: 'Season',
			nextLabel: 'Airing next',
			planStatus: 'Plan to watch',
		};
	}

	/** Count of Due entries in the Maybe list — usable without rendering the tab. */
	static getMaybeDueCount(dataManager: DataManager): number {
		const todayStr = todayIso();
		return dataManager.getMaybeTitles().filter(
			(mt) => !!mt.releaseDate && mt.releaseDate <= todayStr,
		).length;
	}

	/** Count of Aired/Due entries — usable without rendering the tab. */
	static getAiredDueCount(dataManager: DataManager, readingDataManager?: ReadingDataManager, gameDataManager?: GameDataManager): number {
		const allEntries = dataManager.getAirtimeEntries();
		const titles = dataManager.getTitles();
		const titleMap = new Map(titles.map((t) => [t.id, t]));
		let count = 0;
		for (const entry of allEntries) {
			if (entry.source === 'reading') {
				// verify the reading item still exists (skip orphans) when we have the manager
				if (readingDataManager) {
					const kind = entry.readingKind ?? 'book';
					const item = kind === 'book'
						? readingDataManager.getBook(entry.titleId)
						: readingDataManager.getManga(entry.titleId);
					if (!item) continue;
				}
			} else if (entry.source === 'game') {
				// same orphan check for games
				if (gameDataManager && !gameDataManager.getGame(entry.titleId)) continue;
			} else {
				const title = titleMap.get(entry.titleId);
				if (!title) continue;
			}
			// same rule as resolveEntry, so the due count matches what the cards/rows show
			const isSingle = entry.schedule.recurrence === 'once';
			const cd = getDetailedCountdown(entry.schedule, isSingle, entry.lastAcknowledgedDate);
			if (cd.kind === 'aired' || cd.kind === 'due') count++;
		}
		return count;
	}

	/**
	 * Tear down document-level listeners and the Cards virtual-scroll machinery. Called by
	 * WatchLogView when the tab instance is replaced or the view closes.
	 */
	destroy(): void {
		this.activeCleanups.forEach((fn) => fn());
		this.activeCleanups = [];
		this.destroyTrackerVirtual();
	}

	render(): void {
		this.activeCleanups.forEach((fn) => fn());
		this.activeCleanups = [];
		this.destroyTrackerVirtual();
		this.container.empty();
		this.container.addClass('wl-airtime');
		if (this.onCountChange) {
			this.onCountChange(AirtimeTab.getAiredDueCount(this.dataManager, this.readingDataManager, this.gameDataManager) + AirtimeTab.getMaybeDueCount(this.dataManager));
		}
		this.renderInnerTabBar();
		if (this.currentSubTab === 'tracker') {
			this.renderTracker();
		} else if (this.currentSubTab === 'history') {
			this.renderHistory();
		} else {
			this.renderMaybe();
		}
	}

	private renderInnerTabBar(): void {
		const bar = this.container.createDiv({ cls: 'wl-inner-tab-bar' });
		const trackerCount = AirtimeTab.getAiredDueCount(this.dataManager, this.readingDataManager, this.gameDataManager);
		const maybeCount = AirtimeTab.getMaybeDueCount(this.dataManager);
		const tabs: Array<{ key: 'tracker' | 'history' | 'maybe'; label: string; badge: number }> = [
			{ key: 'tracker', label: 'Tracker', badge: trackerCount },
			{ key: 'history', label: 'Log', badge: 0 },
			{ key: 'maybe',   label: 'Maybe',   badge: maybeCount },
		];
		for (const { key, label, badge } of tabs) {
			const text = badge > 0 ? `${label} (${badge})` : label;
			const btn = bar.createEl('button', {
				cls: `wl-inner-tab-btn${this.currentSubTab === key ? ' is-active' : ''}`,
				text,
			});
			btn.addEventListener('click', () => {
				if (this.currentSubTab === key) return;
				this.currentSubTab = key;
				this.selectionMode = false;
				this.selectedItems.clear();
				this.searchQuery = '';
				this.render();
			});
		}
	}

	private renderTracker(): void {
		if (this.plugin.settings.showHintBanners) {
			this.container.createDiv({
				cls: 'wl-cl-draft-banner',
				text: '⚠ All titles with a release date in the future will be automatically marked as "To be released" in Watchlist and added here.',
			});
		}
		this.renderHeader();
		this.renderSearch();
		if (this.trackerView === 'cards') {
			this.renderTrackerCardsGrid();
		} else {
			this.renderCards();
		}
	}

	private renderHistory(): void {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStr = toIsoDate(today);

		const cutoff = new Date(today);
		cutoff.setMonth(cutoff.getMonth() - 6);
		const cutoffStr = toIsoDate(cutoff);

		const pastTitles = this.dataManager.getTitles()
			.filter((t) => !!t.releaseDate && t.releaseDate <= todayStr && t.releaseDate >= cutoffStr)
			.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));

		if (pastTitles.length === 0) {
			this.container.createDiv({ cls: 'wl-empty-state', text: 'No past releases yet.' });
			return;
		}

		const cardsEl = this.container.createDiv({ cls: 'wl-airtime-cards' });
		for (const title of pastTitles) {
			this.renderHistoryCard(cardsEl, title);
		}
	}

	private renderHistoryCard(parent: HTMLElement, title: WatchLogTitle): void {
		const card = parent.createDiv({ cls: 'wl-airtime-card wl-airtime-history-card' });

		const left = card.createDiv({ cls: 'wl-airtime-card-left' });
		left.createDiv({ cls: 'wl-airtime-card-title', text: title.title });

		const metaRow = left.createDiv({ cls: 'wl-airtime-card-meta' });
		const typeDef = this.plugin.settings.types.find((t) => t.name === title.type);
		const colored = this.plugin.settings.coloredTypeBadges;
		const typeBadge = metaRow.createSpan({ cls: colored ? 'wl-badge wl-badge-sm' : 'wl-badge-plain', text: title.type });
		if (colored && typeDef) typeBadge.style.backgroundColor = getThemedColor(title.type, typeDef.color, this.plugin.settings.colorTheme);
		if (title.releaseDate) {
			metaRow.createSpan({ cls: 'wl-airtime-schedule', text: formatDateDisplay(title.releaseDate) });
		}

		const right = card.createDiv({ cls: 'wl-airtime-card-right wl-airtime-history-right' });
		if (title.releaseDate) {
			right.createDiv({ cls: 'wl-airtime-pill wl-airtime-pill-aired', text: formatDaysAgo(title.releaseDate) });
		}

		const globeBtn = right.createEl('button', { cls: 'wl-airtime-action-btn', text: '🌐' });
		globeBtn.title = 'Open page';
		globeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (title.externalLink) activeWindow.open(title.externalLink, '_blank');
			else new Notice('No external link set for this title.');
		});

		const deleteBtn = right.createEl('button', { cls: 'wl-airtime-action-btn wl-airtime-action-btn-delete wl-btn-danger', text: '✕' });
		deleteBtn.title = 'Remove from watchlist';
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new ConfirmModal(this.plugin.app, `Remove "${title.title}" from Watchlist?`, () => {
				void this.dataManager.removeTitle(title.id).then(() => this.render());
			}).open();
		});
	}

	private renderMaybe(): void {
		const maybeTitles = this.dataManager.getMaybeTitles();

		const headerEl = this.container.createDiv({ cls: 'wl-list-header' });
		if (maybeTitles.length > 0) {
			headerEl.createSpan({ cls: 'wl-list-count', text: String(maybeTitles.length) });
		}
		const controls = headerEl.createDiv({ cls: 'wl-header-controls' });
		const rightGroup = controls.createDiv({ cls: 'wl-header-controls-right' });
		const addBtnWrap = rightGroup.createDiv({ cls: 'wl-add-btn-wrap' });
		const addBtn = addBtnWrap.createEl('button', { cls: 'wl-add-btn wl-btn-success', text: '+ add' });
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new MaybeAddModal(this.plugin.app, this.plugin, this.dataManager, () => this.render()).open();
		});

		if (maybeTitles.length === 0) {
			this.container.createDiv({ cls: 'wl-empty-state', text: 'No "Maybe" titles yet. Click + Add to track something you\'re considering.' });
			return;
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const cardsEl = this.container.createDiv({ cls: 'wl-airtime-cards' });
		const sorted = [...maybeTitles].sort((a, b) => {
			const ra = a.releaseDate ?? '';
			const rb = b.releaseDate ?? '';
			if (!ra && !rb) return a.dateAdded.localeCompare(b.dateAdded);
			if (!ra) return 1;
			if (!rb) return -1;
			return ra.localeCompare(rb);
		});

		for (const mt of sorted) {
			this.renderMaybeCard(cardsEl, mt, today);
		}
	}

	private renderMaybeCard(parent: HTMLElement, mt: MaybeTitle, today: Date): void {
		const schedule: AirtimeSchedule = { recurrence: 'once', releaseDate: mt.releaseDate ?? undefined };
		const countdown = getDetailedCountdown(schedule, true);

		let cardCls = 'wl-maybe-card';
		if (countdown.kind === 'due') cardCls += ' wl-airtime-card-aired is-due';

		const card = parent.createDiv({ cls: cardCls });

		const left = card.createDiv({ cls: 'wl-maybe-card-left' });

		left.createSpan({ cls: 'wl-maybe-card-title', text: mt.title });

		const typeDef = this.plugin.settings.types.find((t) => t.name === mt.type);
		const colored = this.plugin.settings.coloredTypeBadges;
		const typeBadge = left.createSpan({ cls: colored ? 'wl-badge wl-badge-sm' : 'wl-badge-plain', text: mt.type });
		if (colored && typeDef) typeBadge.style.backgroundColor = getThemedColor(mt.type, typeDef.color, this.plugin.settings.colorTheme);

		const pillClsMap: Record<DetailedCountdown['kind'], string> = {
			'today-before': 'wl-airtime-pill wl-airtime-pill-today-series',
			'future': 'wl-airtime-pill wl-airtime-pill-days',
			'aired': 'wl-airtime-pill wl-airtime-pill-aired',
			'due': 'wl-airtime-pill wl-airtime-pill-due',
		};
		const pillCls = countdown.kind === 'future' && countdown.label === 'Tomorrow'
			? 'wl-airtime-pill wl-airtime-pill-tomorrow'
			: pillClsMap[countdown.kind];
		const right = card.createDiv({ cls: 'wl-maybe-card-right' });
		right.createDiv({ cls: pillCls, text: mt.releaseDate ? countdown.label : '—' });
		const globeBtn = right.createEl('button', { cls: 'wl-airtime-action-btn', text: '🌐' });
		globeBtn.title = 'Open page';
		globeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (mt.externalLink) activeWindow.open(mt.externalLink, '_blank');
			else new Notice('No external link set.');
		});
		const deleteBtn = right.createEl('button', { cls: 'wl-airtime-action-btn wl-airtime-action-btn-delete wl-btn-danger', text: '✕' });
		deleteBtn.title = 'Remove from maybe';
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new ConfirmModal(this.plugin.app, `Remove "${mt.title}" from Maybe?`, () => {
				void this.dataManager.removeMaybeTitle(mt.id).then(() => this.render());
			}).open();
		});
	}

	private renderSearch(): void {
		const searchWrap = this.container.createDiv({ cls: 'wl-search-wrap' });
		const input = searchWrap.createEl('input', {
			cls: 'wl-search-input',
			attr: { type: 'text', placeholder: 'Search upcoming...' },
		});
		input.value = this.searchQuery;
		let debounceTimer: number | null = null;
		input.addEventListener('input', () => {
			this.searchQuery = input.value;
			if (debounceTimer !== null) window.clearTimeout(debounceTimer);
			debounceTimer = window.setTimeout(() => {
				debounceTimer = null;
				this.rerenderCards();
			}, 250);
		});
	}

	private rerenderCards(): void {
		const existing = this.container.querySelector('.wl-airtime-cards');
		const emptyState = this.container.querySelector('.wl-empty-state');
		if (existing) existing.remove();
		if (emptyState) emptyState.remove();
		if (this.trackerView === 'cards') {
			this.destroyTrackerVirtual();
			this.container.querySelector('.wl-tracker-scroll')?.remove();
			this.renderTrackerCardsGrid();
		} else {
			this.renderCards();
		}
	}

	// Header

	private renderHeader(): void {
		const header = this.container.createDiv({ cls: 'wl-list-header' });

		// only entries that still resolve to a watchlist or reading item
		const count = this.dataManager.getAirtimeEntries().filter(
			(e) => this.resolveEntry(e) !== null,
		).length;
		if (count > 0) {
			header.createSpan({ cls: 'wl-list-count', text: String(count) });
		}

		const controls = header.createDiv({ cls: 'wl-header-controls' });

		// action bar — selection mode with items selected
		if (this.selectionMode && this.selectedItems.size > 0) {
			this.renderActionBar(controls);
		}

		if (this.selectionMode) {
			const hasAny = this.selectedItems.size > 0;
			const selAllBtn = controls.createEl('button', { cls: 'wl-btn wl-btn-sm', text: hasAny ? 'None' : 'All' });
			selAllBtn.title = hasAny ? 'Deselect all' : 'Select all visible';
			selAllBtn.addEventListener('click', () => {
				if (this.selectedItems.size > 0) {
					this.selectedItems.clear();
				} else {
					for (const entry of this.dataManager.getAirtimeEntries()) {
						this.selectedItems.add(entry.id);
					}
				}
				this.render();
			});
		}

		const rightGroup = controls.createDiv({ cls: 'wl-header-controls-right' });

		const selBtn = rightGroup.createEl('button', {
			cls: `wl-btn wl-btn-sm${this.selectionMode ? ' is-active' : ''}`,
			text: 'Select',
		});
		selBtn.addEventListener('click', () => {
			this.selectionMode = !this.selectionMode;
			this.selectedItems.clear();
			this.render();
		});

		this.renderViewDropdown(rightGroup);

		const addBtnWrap = rightGroup.createDiv({ cls: 'wl-add-btn-wrap' });
		const addBtn = addBtnWrap.createEl('button', { cls: 'wl-add-btn wl-btn-success', text: '+ add' });
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openAddFlow();
		});
	}

	/** The Watchlist view popover, reduced to List / Cards. Persisted in upcomingTrackerView. */
	private renderViewDropdown(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'wl-add-btn-wrap' });
		const btn = wrap.createEl('button', { cls: 'wl-btn wl-btn-sm wl-view-btn' });
		setIcon(btn, this.trackerView === 'cards' ? 'layout-grid' : 'list');
		btn.title = 'View';

		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const existing = wrap.querySelector('.wl-dropdown');
			if (existing) { existing.remove(); return; }

			const panel = wrap.createDiv({ cls: 'wl-dropdown wl-view-panel' });

			const options: { key: 'cards' | 'list'; label: string; icon: string }[] = [
				{ key: 'cards', label: 'Cards', icon: 'layout-grid' },
				{ key: 'list', label: 'List', icon: 'list' },
			];
			for (const opt of options) {
				const active = this.trackerView === opt.key;
				const row = panel.createDiv({ cls: `wl-view-option-row${active ? ' is-active' : ''}` });
				const iconEl = row.createSpan({ cls: 'wl-view-option-icon' });
				setIcon(iconEl, opt.icon);
				row.createSpan({ cls: 'wl-view-option-label', text: opt.label });
				if (active) {
					const checkEl = row.createSpan({ cls: 'wl-view-option-check' });
					setIcon(checkEl, 'check');
				}
				row.addEventListener('click', (ev) => {
					ev.stopPropagation();
					panel.remove();
					activeDocument.removeEventListener('click', closer, true);
					if (this.trackerView === opt.key) return;
					this.trackerView = opt.key;
					this._trackerPersistentScrollTop = 0;
					this.plugin.settings.upcomingTrackerView = opt.key;
					void this.plugin.saveSettings();
					this.render();
				});
			}

			const closer = (ev: MouseEvent) => {
				if (!wrap.contains(ev.target as Node)) {
					panel.remove();
					activeDocument.removeEventListener('click', closer, true);
				}
			};
			window.setTimeout(() => activeDocument.addEventListener('click', closer, true), 0);
			this.activeCleanups.push(() => activeDocument.removeEventListener('click', closer, true));
		});
	}

	private renderActionBar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: 'wl-action-bar' });

		const deleteBtn = bar.createEl('button', {
			cls: 'wl-group-action-btn wl-group-action-btn-delete wl-btn-danger',
			text: '✕',
		});
		deleteBtn.title = 'Remove from upcoming';
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const count = this.selectedItems.size;
			new ConfirmModal(
				this.plugin.app,
				`Remove ${count} selected item${count !== 1 ? 's' : ''} from Upcoming? This cannot be undone.`,
				() => {
					void (async () => {
						await this.dataManager.removeAirtimeEntriesBatch(Array.from(this.selectedItems));
						this.selectedItems.clear();
						this.render();
					})();
				},
			).open();
		});
	}

	// Add flow

	private openAddFlow(): void {
		const entries = this.dataManager.getAirtimeEntries();
		// already-added keys, kept per source so a watchlist id and a reading id that happen to match
		// don't shadow each other
		const addedWatch = new Set(entries.filter((e) => e.source === undefined || e.source === 'watchlist').map((e) => e.titleId));
		const addedReading = new Set(entries.filter((e) => e.source === 'reading').map((e) => e.titleId));
		const addedGame = new Set(entries.filter((e) => e.source === 'game').map((e) => e.titleId));

		const items: UpcomingFinderItem[] = [];
		for (const t of this.dataManager.getTitles()) {
			if (addedWatch.has(t.id)) continue;
			items.push({ source: 'watchlist', id: t.id, title: t.title, typeLabel: t.type });
		}
		for (const b of this.readingDataManager.getBooks()) {
			if (addedReading.has(b.id)) continue;
			items.push({ source: 'reading', kind: 'book', id: b.id, title: b.title, typeLabel: 'Book' });
		}
		for (const m of this.readingDataManager.getMangaList()) {
			if (addedReading.has(m.id)) continue;
			items.push({ source: 'reading', kind: 'manga', id: m.id, title: m.title, typeLabel: 'Manga' });
		}
		for (const g of this.gameDataManager.getGames()) {
			if (addedGame.has(g.id)) continue;
			items.push({ source: 'game', id: g.id, title: g.title, typeLabel: 'Game' });
		}

		if (this.dataManager.getTitles().length === 0 &&
			this.readingDataManager.getBooks().length === 0 &&
			this.readingDataManager.getMangaList().length === 0 &&
			this.gameDataManager.getGames().length === 0) {
			new Notice('No titles in your watchlog, reading or games library yet.');
			return;
		}
		if (items.length === 0) {
			new Notice('Everything is already in upcoming.');
			return;
		}

		new UpcomingFinderModal(this.plugin.app, items, (item) => {
			if (item.source === 'reading') {
				const kind = item.kind ?? 'book';
				const readItem = kind === 'book'
					? this.readingDataManager.getBook(item.id)
					: this.readingDataManager.getManga(item.id);
				if (readItem) this.startAddWithReading(readItem, kind);
			} else if (item.source === 'game') {
				const game = this.gameDataManager.getGame(item.id);
				if (game) this.startAddWithGame(game);
			} else {
				const title = this.dataManager.getTitle(item.id);
				if (title) void this.startAddWithTitle(title);
			}
		}).open();
	}

	private startAddWithGame(game: Game): void {
		const prefilled: AirtimeSchedule | null =
			game.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate)
				? { recurrence: 'once', releaseDate: game.releaseDate }
				: null;

		new GameScheduleModal(this.plugin.app, game, prefilled, async (schedule) => {
			const entry: AirtimeEntry = {
				id: this.dataManager.generateGameAirtimeId(game.id),
				titleId: game.id,
				source: 'game',
				schedule,
				dateAdded: new Date().toISOString(),
			};
			await this.dataManager.addAirtimeEntry(entry);
			await this.syncGameFromSchedule(game.id, schedule);
			this.render();
		}).open();
	}

	/**
	 * Push the scheduled release date back onto the game — future dates only, so a past/due date
	 * doesn't auto-remove the just-added entry.
	 */
	private async syncGameFromSchedule(gameId: string, schedule: AirtimeSchedule): Promise<void> {
		const g = this.gameDataManager.getGame(gameId);
		if (!g) return;
		if (schedule.recurrence === 'once' && isReleaseDateFuture(schedule.releaseDate)) {
			const newDate = schedule.releaseDate ?? null;
			if (g.releaseDate !== newDate) {
				g.releaseDate = newDate;
				await this.gameDataManager.updateGame(g);
			}
		}
	}

	private startAddWithReading(item: Book | Manga, kind: 'book' | 'manga'): void {
		const prefilled: AirtimeSchedule | null =
			item.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(item.releaseDate)
				? { recurrence: 'once', releaseDate: item.releaseDate }
				: null;

		new ReadingScheduleModal(
			this.plugin.app,
			item,
			kind,
			prefilled,
			null,
			null,
			null,
			null,
			async (schedule, volume, chapter, totalVolumes, totalChapters) => {
				const entry: AirtimeEntry = {
					id: this.dataManager.generateReadingAirtimeId(item.id),
					titleId: item.id,
					source: 'reading',
					readingKind: kind,
					schedule,
					currentSeason: volume ?? undefined,
					currentEpisode: chapter ?? undefined,
					totalSeasons: totalVolumes ?? undefined,
					totalEpisodes: totalChapters ?? undefined,
					dateAdded: new Date().toISOString(),
				};
				await this.dataManager.addAirtimeEntry(entry);
				await this.syncReadingItemFromSchedule(item.id, kind, schedule, totalVolumes, totalChapters);
				this.render();
			},
		).open();
	}

	/** Pushes schedule-derived totals / release date back onto the reading item. */
	private async syncReadingItemFromSchedule(
		itemId: string,
		kind: 'book' | 'manga',
		schedule: AirtimeSchedule,
		totalVolumes: number | null,
		totalChapters: number | null,
	): Promise<void> {
		if (kind === 'book') {
			const b = this.readingDataManager.getBook(itemId);
			if (!b) return;
			let changed = false;
			if (totalChapters !== null && totalChapters !== b.totalChapters) { b.totalChapters = totalChapters; changed = true; }
			// only write a future 'once' date back (it drives the auto "To be released"); a past/due date is
			// left alone so the just-added entry isn't auto-removed
			if (schedule.recurrence === 'once' && isReleaseDateFuture(schedule.releaseDate)) {
				const newDate = schedule.releaseDate ?? null;
				if (b.releaseDate !== newDate) { b.releaseDate = newDate; changed = true; }
			}
			if (changed) await this.readingDataManager.updateBook(b);
		} else {
			const m = this.readingDataManager.getManga(itemId);
			if (!m) return;
			let changed = false;
			if (totalChapters !== null && totalChapters !== m.totalChapters) { m.totalChapters = totalChapters; changed = true; }
			if (totalVolumes !== null && totalVolumes !== m.totalVolumes) { m.totalVolumes = totalVolumes; changed = true; }
			// only write a future 'once' date back (it drives the auto "To be released"); a past/due date is
			// left alone so the just-added entry isn't auto-removed
			if (schedule.recurrence === 'once' && isReleaseDateFuture(schedule.releaseDate)) {
				const newDate = schedule.releaseDate ?? null;
				if (m.releaseDate !== newDate) { m.releaseDate = newDate; changed = true; }
			}
			if (changed) await this.readingDataManager.updateManga(m);
		}
	}

	/** On a single-release tick, revert the item's auto "To be released" back to its plan status. */
	private async revertToBeReleasedStatus(entry: AirtimeEntry, r: ResolvedUpcoming): Promise<void> {
		if (r.source === 'reading') {
			const kind = entry.readingKind ?? 'book';
			if (kind === 'book') {
				const b = this.readingDataManager.getBook(entry.titleId);
				if (b && b.status === 'To be released') { b.status = 'Plan to Read'; await this.readingDataManager.updateBook(b); }
			} else {
				const m = this.readingDataManager.getManga(entry.titleId);
				if (m && m.status === 'To be released') { m.status = 'Plan to Read'; await this.readingDataManager.updateManga(m); }
			}
		} else if (r.source === 'game') {
			const g = this.gameDataManager.getGame(entry.titleId);
			if (g && g.status === GAME_AUTO_STATUS) {
				g.status = this.gameDataManager.getSettings().defaultStatus || 'Not started';
				await this.gameDataManager.updateGame(g);
			}
		} else {
			const t = this.dataManager.getTitle(entry.titleId);
			if (t && t.status === 'To be released') { t.status = 'Plan to watch'; await this.dataManager.updateTitle(t); }
		}
	}

	private async startAddWithTitle(title: WatchLogTitle): Promise<void> {
		let prefilled: AirtimeSchedule | null = null;

		// try Jikan auto-fill for Anime with a known malId
		if (title.type === 'Anime' && title.malId) {
			try {
				const sched = await this.plugin.apiService.getAnimeScheduleByMalId(title.malId);
				if (sched) {
					prefilled = { recurrence: 'weekly', dayOfWeek: sched.dayOfWeek, releaseTime: sched.time };
					new Notice('Schedule auto-filled from myanimelist.');
				}
			} catch {
				// ignore — fields stay empty for manual entry
			}
		}

		if (!prefilled && title.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(title.releaseDate)) {
			prefilled = { recurrence: 'once', releaseDate: title.releaseDate };
		}

		new AirtimeScheduleModal(
			this.plugin.app,
			title,
			prefilled,
			null,
			null,
			null,
			null,
			async (schedule, season, episode, totalSeasons, totalEpisodes) => {
				const entry: AirtimeEntry = {
					id: this.dataManager.generateAirtimeId(title.id),
					titleId: title.id,
					schedule,
					currentSeason: season ?? undefined,
					currentEpisode: episode ?? undefined,
					totalSeasons: totalSeasons ?? undefined,
					totalEpisodes: totalEpisodes ?? undefined,
					dateAdded: new Date().toISOString(),
				};
				await this.dataManager.addAirtimeEntry(entry);

				// sync back to the Watchlist title
				const t = this.dataManager.getTitle(title.id);
				if (t) {
					let changed = false;
					if (totalEpisodes !== null && totalEpisodes !== t.totalEpisodes) {
						t.totalEpisodes = totalEpisodes;
						changed = true;
					}
					// sync releaseDate when the schedule is 'once'
					if (schedule.recurrence === 'once') {
						const newDate = schedule.releaseDate ?? null;
						if (t.releaseDate !== newDate) {
							t.releaseDate = newDate;
							changed = true;
						}
					}
					if (changed) await this.dataManager.updateTitle(t);
				}

				this.render();
			},
		).open();
	}

	// Card list

	/**
	 * Resolved + search-filtered + sorted tracker entries — shared by the List rows and the Cards
	 * grid, so both show the same data in the same order.
	 */
	private computeTrackerCardData(): TrackerCardData[] {
		const q = this.searchQuery.trim().toLowerCase();
		return this.dataManager.getAirtimeEntries()
			.map((entry) => {
				const r = this.resolveEntry(entry);
				if (!r) return null;
				if (q && !r.title.toLowerCase().includes(q)) return null;
				const countdown = getDetailedCountdown(entry.schedule, r.isSingle, entry.lastAcknowledgedDate);
				return { entry, r, countdown };
			})
			.filter((d): d is TrackerCardData => d !== null)
			.sort((a, b) => {
				// aired/due → first; today → second; future → last
				const rankKind = (k: DetailedCountdown['kind']) =>
					k === 'aired' || k === 'due' ? 0 : k === 'today-before' ? 1 : 2;
				const ra = rankKind(a.countdown.kind);
				const rb = rankKind(b.countdown.kind);
				if (ra !== rb) return ra - rb;
				return a.countdown.daysUntil - b.countdown.daysUntil;
			});
	}

	private renderCards(): void {
		if (this.dataManager.getAirtimeEntries().length === 0) {
			this.container.createDiv({
				cls: 'wl-empty-state',
				text: 'No titles in Upcoming. Click + Add to track airing schedules.',
			});
			return;
		}

		const cardData = this.computeTrackerCardData();

		if (cardData.length === 0) {
			this.container.createDiv({ cls: 'wl-empty-state', text: 'No upcoming titles match your search.' });
			return;
		}

		const cardsEl = this.container.createDiv({ cls: 'wl-airtime-cards' });
		for (const { entry, r, countdown } of cardData) {
			this.renderCard(cardsEl, entry, r, countdown);
		}
	}

	// Single card

	private renderCard(
		parent: HTMLElement,
		entry: AirtimeEntry,
		r: ResolvedUpcoming,
		countdown: DetailedCountdown,
	): void {
		const isMovie = r.isSingle;
		const totalEps = r.totalUnits;
		const isFinalEpisode =
			!isMovie &&
			entry.currentEpisode !== undefined &&
			totalEps > 0 &&
			entry.currentEpisode >= totalEps;

		const showTick =
			(isMovie && countdown.kind === 'due') ||
			(!isMovie && countdown.kind === 'aired');

		let cardCls = 'wl-airtime-card';
		if (countdown.kind === 'aired' || countdown.kind === 'due') {
			cardCls += ' wl-airtime-card-aired';
		}
		if (countdown.kind === 'aired') cardCls += ' is-aired';
		if (countdown.kind === 'due') cardCls += ' is-due';
		if (this.selectionMode && this.selectedItems.has(entry.id)) {
			cardCls += ' wl-row-selected';
		}
		const card = parent.createDiv({ cls: cardCls });

		if (this.selectionMode) {
			const cb = card.createEl('input', { attr: { type: 'checkbox' } });
			cb.addClass('wl-airtime-select-cb');
			cb.checked = this.selectedItems.has(entry.id);
			cb.addEventListener('click', (e) => e.stopPropagation());
			cb.addEventListener('change', () => {
				if (cb.checked) { this.selectedItems.add(entry.id); }
				else { this.selectedItems.delete(entry.id); }
				this.render();
			});
			card.addEventListener('click', () => {
				if (this.selectedItems.has(entry.id)) { this.selectedItems.delete(entry.id); }
				else { this.selectedItems.add(entry.id); }
				this.render();
			});
		}

		// left
		const left = card.createDiv({ cls: 'wl-airtime-card-left' });
		left.createDiv({ cls: 'wl-airtime-card-title', text: r.title });

		// type badge + schedule string; reading entries render plain, watch entries may be colored
		const metaRow = left.createDiv({ cls: 'wl-airtime-card-meta' });
		const typeBadge = metaRow.createSpan({
			cls: r.typeColor ? 'wl-badge wl-badge-sm' : 'wl-badge-plain',
			text: r.typeName,
		});
		if (r.typeColor) typeBadge.style.backgroundColor = r.typeColor;
		metaRow.createSpan({ cls: 'wl-airtime-schedule', text: getAirtimeScheduleString(entry.schedule) });

		// progress badge — multi-part titles only (series / manga)
		if (!isMovie && (entry.currentSeason !== undefined || entry.currentEpisode !== undefined)) {
			const badgeParts: string[] = [];
			if (entry.currentSeason !== undefined) badgeParts.push(`${r.groupNounCap} ${entry.currentSeason}`);
			if (entry.currentEpisode !== undefined) badgeParts.push(`${r.unitNounBadge} ${entry.currentEpisode}`);
			badgeParts.push(r.nextLabel);
			const badgeCls = isFinalEpisode
				? 'wl-ep-badge wl-ep-badge-final'
				: 'wl-ep-badge';
			left.createDiv({ cls: badgeCls, text: badgeParts.join(' · ') });
		}

		// right
		const right = card.createDiv({ cls: 'wl-airtime-card-right' });

		const pillClsMap: Record<DetailedCountdown['kind'], string> = {
			'today-before': 'wl-airtime-pill wl-airtime-pill-today-series',
			'future':       'wl-airtime-pill wl-airtime-pill-days',
			'aired':        'wl-airtime-pill wl-airtime-pill-aired',
			'due':          'wl-airtime-pill wl-airtime-pill-due',
		};
		// "Tomorrow" within 'future' gets its own style
		const pillCls =
			countdown.kind === 'future' && countdown.label === 'Tomorrow'
				? 'wl-airtime-pill wl-airtime-pill-tomorrow'
				: pillClsMap[countdown.kind];
		right.createDiv({ cls: pillCls, text: countdown.label });

		const actions = right.createDiv({ cls: 'wl-airtime-actions' });

		// green tick, shown once the airtime/release passes
		if (showTick) {
			const tickBtn = actions.createEl('button', {
				cls: 'wl-airtime-action-btn wl-airtime-action-btn-tick',
				text: '✓',
			});
			tickBtn.title = isMovie ? 'Mark as released' : (isFinalEpisode ? `Final ${r.unitNoun}: mark done` : `Mark ${r.unitNoun} as aired`);
			tickBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.confirmTick(entry, r);
			});
		}

		const globeBtn = actions.createEl('button', { cls: 'wl-airtime-action-btn', text: '🌐' });
		globeBtn.title = 'Open page';
		globeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (r.externalLink) {
				activeWindow.open(r.externalLink, '_blank');
			} else {
				new Notice('No external link set for this title.');
			}
		});

		const editBtn = actions.createEl('button', { cls: 'wl-airtime-action-btn', text: '✏' });
		editBtn.title = 'Edit schedule';
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (r.source === 'reading') {
				this.openEditReadingSchedule(entry);
			} else if (r.source === 'game') {
				this.openEditGameSchedule(entry);
			} else {
				this.openEditWatchSchedule(entry);
			}
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'wl-airtime-action-btn wl-airtime-action-btn-delete wl-btn-danger',
			text: '✕',
		});
		deleteBtn.title = 'Remove from upcoming';
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.confirmRemove(entry, r);
		});
	}

	/** An entry that is only there because its item awaits release leaves by clearing its release date. */
	private confirmRemove(entry: AirtimeEntry, r: ResolvedUpcoming): void {
		const msg = this.dataManager.removeClearsReleaseDate(entry)
			? `Remove "${r.title}" from Upcoming and clear its release date?`
			: `Remove "${r.title}" from Upcoming?`;
		new ConfirmModal(this.plugin.app, msg, () => {
			void this.dataManager.removeAirtimeEntry(entry.id).then(() => this.render());
		}).open();
	}

	/** Tick confirm + apply, shared by the List row button and the Cards overlay button/menu. */
	private confirmTick(entry: AirtimeEntry, r: ResolvedUpcoming): void {
		const isMovie = r.isSingle;
		const totalEps = r.totalUnits;
		const isFinalEpisode =
			!isMovie &&
			entry.currentEpisode !== undefined &&
			totalEps > 0 &&
			entry.currentEpisode >= totalEps;

		const confirmMsg = isMovie
			? `"${r.title}" has been released.\nRemove from Upcoming and set status to ${r.planStatus}?`
			: isFinalEpisode
				? `Final ${r.unitNoun} of "${r.title}".\nRemove from Upcoming? (status unchanged)`
				: this.dataManager.isAiringTracked(entry)
					? `${r.unitNounCap} ${entry.currentEpisode ?? ''} of "${r.title}" is out.\nMark as seen in Upcoming?`
					: `${r.unitNounCap} ${entry.currentEpisode ?? ''} of "${r.title}".\nMark and track next ${r.unitNoun}?`;

		// single releases get an escape hatch: a due title that turns out to be a serial jumps into the
		// schedule modal in Recurring mode instead of being removed. Games have no recurring units.
		const extraButton = isMovie && r.source !== 'game'
			? {
				label: r.source === 'reading' ? 'Switch to Recurring chapters' : 'Switch to Recurring episodes',
				onClick: () => {
					if (r.source === 'reading') this.openEditReadingSchedule(entry, 'recurring');
					else this.openEditWatchSchedule(entry, 'recurring');
				},
			}
			: undefined;

		new ConfirmModal(this.plugin.app, confirmMsg, () => {
			void (async () => {
				const today = new Date();
				const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
				// prevent a scheduler double-fire for the same airtime
				this.plugin.markAirtimeHandled(`${entry.id}-${todayStr}`);

				if (isMovie) {
					await this.dataManager.removeAirtimeEntry(entry.id);
					await this.revertToBeReleasedStatus(entry, r);
				} else if (isFinalEpisode) {
					// final unit: remove from Upcoming, do NOT change status
					await this.dataManager.removeAirtimeEntry(entry.id);
				} else {
					// non-final: acknowledge so the countdown resets; without an API pointer also advance the unit
					await this.dataManager.tickAirtimeEntry(entry, todayStr);
				}
				this.render();
			})();
		}, extraButton).open();
	}

	// Cards view (poster grid, month-grouped)

	/**
	 * Extra height under the 2:3 poster for title + release line + episode badge. Must match
	 * .wl-tracker-card-info in styles.css.
	 */
	private static readonly TRACKER_CARD_TEXT_H = 74;

	/**
	 * Month bucket for a card: today + daysUntil (what drives the List countdown). Entries with no
	 * usable date go to a trailing group.
	 */
	private static monthGroupOf(daysUntil: number): { key: string; label: string } {
		if (daysUntil >= 9999) return { key: 'none', label: 'No date' };
		const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + daysUntil);
		return { key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
	}

	private renderTrackerCardsGrid(): void {
		if (this.dataManager.getAirtimeEntries().length === 0) {
			this.container.createDiv({
				cls: 'wl-empty-state',
				text: 'No titles in Upcoming. Click + Add to track airing schedules.',
			});
			return;
		}

		const cardData = this.computeTrackerCardData();
		if (cardData.length === 0) {
			this.container.createDiv({ cls: 'wl-empty-state', text: 'No upcoming titles match your search.' });
			return;
		}

		// sequential grouping — the sort is monotonic in next-occurrence date (aired/due resolve to
		// today), so one pass preserves card order
		const groups: Array<{ label: string; items: TrackerCardData[] }> = [];
		let lastKey = '';
		for (const d of cardData) {
			const { key, label } = AirtimeTab.monthGroupOf(d.countdown.daysUntil);
			if (groups.length === 0 || key !== lastKey) {
				groups.push({ label, items: [] });
				lastKey = key;
			}
			groups[groups.length - 1]!.items.push(d);
		}

		const scroll = this.container.createDiv({ cls: 'wl-tracker-scroll' });

		const observer = new LazyCardObserver(
			'.wl-tracker-cell[data-needs-poster="true"]',
			(cells) => this.handleTrackerCardsVisible(cells),
		);
		this.trackerObserver = observer;
		const scroller = new VirtualScroller({
			scroll,
			metrics: (w) => this.trackerMetrics(w),
			onWindowChanged: () => observer.observeNew(scroll),
			onScrollPos: (top) => { this._trackerPersistentScrollTop = top; },
		});
		this.trackerScroller = scroller;

		for (const group of groups) {
			const titleEl = scroll.createDiv({ cls: 'wl-tracker-month-title' });
			titleEl.createSpan({ text: group.label });
			titleEl.createSpan({ cls: 'wl-rows-shelf-count', text: `(${group.items.length})` });

			const spacer = scroll.createDiv({ cls: 'wl-tracker-month-spacer' });
			const grid = spacer.createDiv({ cls: 'wl-cards-grid wl-cards-grid-virtual' });
			const items = group.items;
			const vgrid = new VirtualGrid(spacer, grid, items.length, {
				buildItem: (i, w) => {
					const item = items[i];
					return item ? this.buildTrackerCard(item, w) : null;
				},
				removeItem: (el) => observer.unobserveAndRemove(el),
			});
			scroller.addSection(vgrid, spacer);
		}

		// attach() reserves every section's full height up-front, so offsets are final before any window
		// materialises (zero layout shift by construction)
		scroller.attach(this._trackerPersistentScrollTop);
	}

	/**
	 * Cards geometry: the Watchlist poster metrics, plus the fixed text block below each poster when
	 * the card text style is 'under'; in 'inside' mode the cell is the bare 2:3 card.
	 */
	private trackerMetrics(containerWidth: number): GridMetrics {
		const base = computeGridMetrics(containerWidth, this.plugin.getCardMinWidth());
		if (!this.plugin.isCardTextUnder('upcoming')) return base;
		const cardHeight = base.cardHeight + AirtimeTab.TRACKER_CARD_TEXT_H;
		return { cols: base.cols, cardWidth: base.cardWidth, cardHeight, rowHeight: cardHeight + 12 };
	}

	private destroyTrackerVirtual(): void {
		this.trackerScroller?.destroy();
		this.trackerScroller = null;
		this.trackerObserver?.destroy();
		this.trackerObserver = null;
		// same hygiene as the Watchlist Cards teardown: stale pending fetches would just be re-enqueued
		this.plugin.posterService?.clearQueue();
	}

	// Cards view: single card

	private buildTrackerCard(data: TrackerCardData, cardWidth: number): HTMLElement {
		const { entry, r, countdown } = data;
		const isMovie = r.isSingle;
		const totalEps = r.totalUnits;
		const isFinalEpisode =
			!isMovie &&
			entry.currentEpisode !== undefined &&
			totalEps > 0 &&
			entry.currentEpisode >= totalEps;
		const showTick =
			(isMovie && countdown.kind === 'due') ||
			(!isMovie && countdown.kind === 'aired');

		const cell = createDiv({ cls: 'wl-tracker-cell' });
		cell.dataset.entryId = entry.id;

		// poster box (the Watchlist card)
		const card = cell.createDiv({ cls: 'wl-card wl-tracker-card' });
		if (this.selectionMode && this.selectedItems.has(entry.id)) card.addClass('wl-card-selected');

		// placeholder colour: the type colour regardless of the colored-badges setting
		let placeholderColor: string;
		if (entry.source === 'reading') {
			placeholderColor = getReadingTypeColor(entry.readingKind ?? 'book', this.plugin.settings);
		} else if (entry.source === 'game') {
			// the Games-tab placeholder colour: the game's genre colour
			const game = this.gameDataManager.getGame(entry.titleId);
			placeholderColor = this.gameDataManager.getSettings().types
				.find((t) => t.name === game?.type)?.color ?? '#888780';
		} else {
			const typeDef = this.plugin.settings.types.find((t) => t.name === r.typeName);
			placeholderColor = typeDef
				? getThemedColor(r.typeName, typeDef.color, this.plugin.settings.colorTheme)
				: '#888780';
		}
		const placeholder = card.createDiv({ cls: 'wl-card-poster-placeholder' });
		placeholder.style.backgroundColor = placeholderColor;
		placeholder.createSpan({ text: (r.title.trim().charAt(0) || '?').toUpperCase() });

		const posterHeight = Math.round(cardWidth * 1.5);
		const img = card.createEl('img', { cls: 'wl-card-poster' });
		img.alt = r.title;
		img.width = Math.round(cardWidth);
		img.height = posterHeight;

		if (entry.source === 'reading') {
			// reading items carry their cover directly — no lazy fetch machinery
			const item = entry.readingKind === 'manga'
				? this.readingDataManager.getManga(entry.titleId)
				: this.readingDataManager.getBook(entry.titleId);
			const cover = item?.coverUrl ?? '';
			if (cover.startsWith('http')) {
				img.onerror = () => card.removeClass('has-poster');
				card.addClass('has-poster');
				img.src = cover;
			}
		} else if (entry.source === 'game') {
			// games also carry their cover directly (RAWG-resized like the Games tab)
			const cover = this.gameDataManager.getGame(entry.titleId)?.coverUrl ?? '';
			if (cover.startsWith('http')) {
				img.onerror = () => card.removeClass('has-poster');
				card.addClass('has-poster');
				img.src = rawgResizedCover(cover);
			}
		} else {
			const title = this.dataManager.getTitle(entry.titleId);
			if (title) {
				cell.dataset.titleId = title.id;
				const display = getDisplayPoster(title);
				const isManual = !!(title.manualPosterUrl && title.manualPosterUrl.trim() !== '');
				const needsPoster = !isManual && !title.posterUrl && title.posterUrl !== 'none';
				if (display && display.startsWith('http')) {
					img.onerror = () => {
						card.removeClass('has-poster');
						if (!isManual) this.dataManager.updatePosterUrl(title.id, 'none');
					};
					card.addClass('has-poster');
					img.src = display;
				} else if (needsPoster) {
					cell.dataset.needsPoster = 'true';
				}
			}
		}

		// text block: below the poster ('under') or overlaid at its bottom ('inside', the classic
		// Watchlist overlay). Built before the corner buttons so an overlay paints below them (later
		// absolute siblings win).
		const info = this.plugin.isCardTextUnder('upcoming')
			? cell.createDiv({ cls: 'wl-tracker-card-info' })
			: card.createDiv({ cls: 'wl-card-overlay wl-tracker-card-overlay' });
		info.createDiv({ cls: 'wl-tracker-card-title', text: r.title });
		// the same schedule info the List row shows
		info.createDiv({
			cls: 'wl-tracker-card-sub',
			text: getAirtimeScheduleString(entry.schedule).replace(/^Release date/, 'Release'),
		});
		if (!isMovie && (entry.currentSeason !== undefined || entry.currentEpisode !== undefined)) {
			const badgeParts: string[] = [];
			if (entry.currentSeason !== undefined) badgeParts.push(`${r.groupNounCap} ${entry.currentSeason}`);
			if (entry.currentEpisode !== undefined) badgeParts.push(`${r.unitNounBadge} ${entry.currentEpisode}`);
			badgeParts.push(r.nextLabel);
			info.createDiv({
				cls: `${isFinalEpisode ? 'wl-ep-badge wl-ep-badge-final' : 'wl-ep-badge'} wl-tracker-ep-badge`,
				text: badgeParts.join(' · '),
			});
		}

		// type badge — top-left over the poster
		const typeBadge = card.createSpan({
			cls: `wl-tracker-type-badge${r.typeColor ? '' : ' is-plain'}`,
			text: r.typeName,
		});
		if (r.typeColor) typeBadge.style.backgroundColor = r.typeColor;

		// countdown badge — top-right: big number + DAYS, or the state word
		const cd = card.createDiv({ cls: `wl-tracker-countdown is-${countdown.kind}` });
		if (countdown.kind === 'future') {
			if (countdown.daysUntil >= 9999) {
				cd.createSpan({ cls: 'wl-tracker-countdown-word', text: '—' });
			} else {
				cd.createSpan({ cls: 'wl-tracker-countdown-num', text: String(countdown.daysUntil) });
				cd.createSpan({ cls: 'wl-tracker-countdown-label', text: countdown.daysUntil === 1 ? 'DAY' : 'DAYS' });
			}
		} else {
			const word = countdown.kind === 'today-before' ? 'TODAY' : countdown.kind === 'aired' ? 'AIRED' : 'DUE';
			cd.createSpan({ cls: 'wl-tracker-countdown-word', text: word });
		}

		// green tick overlay (same due/aired gate as the List tick button)
		if (showTick) {
			const tickBtn = card.createEl('button', { cls: 'wl-tracker-tick-btn', text: '✓' });
			tickBtn.title = isMovie ? 'Mark as released' : (isFinalEpisode ? `Final ${r.unitNoun}: mark done` : `Mark ${r.unitNoun} as aired`);
			tickBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.confirmTick(entry, r);
			});
		}

		// ⋮ menu (Remove only) — stacked above the globe, bottom-right
		const menuBtn = card.createEl('button', { cls: 'wl-card-menu-btn wl-tracker-menu-btn', text: '⋮' });
		menuBtn.setAttr('aria-label', 'More actions');
		menuBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openTrackerCardMenu(card, menuBtn, data);
		});

		// globe — bottom-right, opens the external page
		const globeBtn = card.createEl('button', { cls: 'wl-card-menu-btn wl-tracker-globe-btn', text: '🌐' });
		globeBtn.title = 'Open page';
		globeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (r.externalLink) activeWindow.open(r.externalLink, '_blank');
			else new Notice('No external link set for this title.');
		});

		// selection mode: a click anywhere on the cell toggles (full re-render, like the List rows, so
		// the header action bar stays in sync; scroll survives via _trackerPersistentScrollTop).
		// Otherwise a click opens the Edit-schedule modal.
		cell.addEventListener('click', () => {
			if (this.selectionMode) {
				if (this.selectedItems.has(entry.id)) this.selectedItems.delete(entry.id);
				else this.selectedItems.add(entry.id);
				this.render();
				return;
			}
			if (r.source === 'reading') this.openEditReadingSchedule(entry);
			else if (r.source === 'game') this.openEditGameSchedule(entry);
			else this.openEditWatchSchedule(entry);
		});

		return cell;
	}

	private openTrackerCardMenu(card: HTMLElement, anchorBtn: HTMLElement, data: TrackerCardData): void {
		const { entry, r } = data;
		// tick lives on the card overlay, edit on card click, open-page on the globe — the menu only
		// carries Remove
		openCardMenu(card, anchorBtn, [
			{
				label: 'Remove from upcoming',
				onClick: () => this.confirmRemove(entry, r),
			},
		], { container: this.container, cleanups: this.activeCleanups });
	}

	// Cards view: lazy poster fetch (watchlist titles)

	/**
	 * Lazy poster fetch for tracker cells that scrolled into view (handed over once, already
	 * unobserved).
	 */
	private handleTrackerCardsVisible(cells: HTMLElement[]): void {
		for (const cell of cells) {
			const titleId = cell.dataset.titleId;
			if (!titleId) continue;

			const title = this.dataManager.getTitle(titleId);
			if (!title) continue;
			// same gates as the Watchlist cards: manual override wins; 'none' means tried, nothing found
			if (title.manualPosterUrl && title.manualPosterUrl.trim() !== '') continue;
			if (title.posterUrl || title.posterUrl === 'none') continue;

			const placeholder = cell.querySelector('.wl-card-poster-placeholder');
			placeholder?.addClass('is-loading');

			void this.plugin.posterService.enqueue(title).then((url) => {
				placeholder?.removeClass('is-loading');
				if (!url) return;
				const card = cell.querySelector<HTMLElement>('.wl-card');
				const img = cell.querySelector<HTMLImageElement>('.wl-card-poster');
				if (!card || !img) return;
				img.onload = () => card.addClass('has-poster');
				img.onerror = () => this.dataManager.updatePosterUrl(titleId, 'none');
				img.src = url;
			});
		}
	}

	private openEditWatchSchedule(entry: AirtimeEntry, initialMode?: 'single' | 'recurring'): void {
		const title = this.dataManager.getTitle(entry.titleId);
		if (!title) return;
		new AirtimeScheduleModal(
			this.plugin.app,
			title,
			{ ...entry.schedule },
			entry.currentSeason ?? null,
			entry.currentEpisode ?? null,
			entry.totalSeasons ?? null,
			entry.totalEpisodes ?? null,
			async (schedule, season, episode, totalSeasons, totalEpisodes) => {
				entry.schedule = schedule;
				entry.currentSeason = season ?? undefined;
				entry.currentEpisode = episode ?? undefined;
				entry.totalSeasons = totalSeasons ?? undefined;
				entry.totalEpisodes = totalEpisodes ?? undefined;
				await this.dataManager.updateAirtimeEntry(entry);

				// sync back to the Watchlist title
				const currentTitle = this.dataManager.getTitle(entry.titleId);
				if (currentTitle) {
					let changed = false;
					if (totalEpisodes !== null && totalEpisodes !== currentTitle.totalEpisodes) {
						currentTitle.totalEpisodes = totalEpisodes;
						changed = true;
					}
					// sync releaseDate when the schedule is 'once'
					if (schedule.recurrence === 'once') {
						const newDate = schedule.releaseDate ?? null;
						if (currentTitle.releaseDate !== newDate) {
							currentTitle.releaseDate = newDate;
							changed = true;
						}
					}
					if (changed) await this.dataManager.updateTitle(currentTitle);
				}

				this.render();
			},
			initialMode,
		).open();
	}

	private openEditGameSchedule(entry: AirtimeEntry): void {
		const game = this.gameDataManager.getGame(entry.titleId);
		if (!game) return;
		new GameScheduleModal(this.plugin.app, game, { ...entry.schedule }, async (schedule) => {
			entry.schedule = schedule;
			await this.dataManager.updateAirtimeEntry(entry);
			await this.syncGameFromSchedule(entry.titleId, schedule);
			this.render();
		}).open();
	}

	private openEditReadingSchedule(entry: AirtimeEntry, initialMode?: 'single' | 'recurring'): void {
		const kind = entry.readingKind ?? 'book';
		const item: Book | Manga | undefined =
			kind === 'book' ? this.readingDataManager.getBook(entry.titleId) : this.readingDataManager.getManga(entry.titleId);
		if (!item) return;
		new ReadingScheduleModal(
			this.plugin.app,
			item,
			kind,
			{ ...entry.schedule },
			entry.currentSeason ?? null,   // volume
			entry.currentEpisode ?? null,  // chapter
			entry.totalSeasons ?? null,    // total volumes
			entry.totalEpisodes ?? null,   // total chapters
			async (schedule, volume, chapter, totalVolumes, totalChapters) => {
				entry.schedule = schedule;
				entry.currentSeason = volume ?? undefined;
				entry.currentEpisode = chapter ?? undefined;
				entry.totalSeasons = totalVolumes ?? undefined;
				entry.totalEpisodes = totalChapters ?? undefined;
				await this.dataManager.updateAirtimeEntry(entry);
				await this.syncReadingItemFromSchedule(entry.titleId, kind, schedule, totalVolumes, totalChapters);
				this.render();
			},
			initialMode,
		).open();
	}
}

// AirtimeScheduleModal

type AirtimeRecurringKind = Exclude<AirtimeRecurrence, 'once'>;

class AirtimeScheduleModal extends Modal {
	private title: WatchLogTitle;
	// UI state — Save assembles a fresh AirtimeSchedule from the fields the active mode/recurrence
	// actually shows (buildSchedule), so a value left over from another mode can never leak in
	private mode: 'single' | 'recurring';
	private recurrence: AirtimeRecurringKind;
	private releaseDate: string; // YYYY-MM-DD ('' = unset) — same format the Watchlist/Reading auto-import writes
	private releaseTime: string; // HH:MM ('' = unset), local time
	private dayOfWeek: number;
	private dayOfMonth: number;
	private currentSeason: number | null;
	private currentEpisode: number | null;
	private totalSeasons: number | null;
	private totalEpisodes: number | null;
	private saveBtn: HTMLButtonElement | null = null;
	private onSave: (
		schedule: AirtimeSchedule,
		season: number | null,
		episode: number | null,
		totalSeasons: number | null,
		totalEpisodes: number | null,
	) => Promise<void>;

	constructor(
		app: App,
		title: WatchLogTitle,
		existingSchedule: AirtimeSchedule | null,
		currentSeason: number | null,
		currentEpisode: number | null,
		totalSeasons: number | null,
		totalEpisodes: number | null,
		onSave: (
			schedule: AirtimeSchedule,
			season: number | null,
			episode: number | null,
			totalSeasons: number | null,
			totalEpisodes: number | null,
		) => Promise<void>,
		initialMode?: 'single' | 'recurring',
	) {
		super(app);
		this.title = title;
		this.onSave = onSave;
		const s = existingSchedule;
		// mode: an explicit initialMode wins (the tick confirm's "Switch to Recurring episodes" opens
		// straight into Recurring); otherwise an existing schedule decides — auto-imported entries arrive
		// as 'once'. Without a schedule the title's shape only picks the DEFAULT, and the toggle makes it
		// overridable instead of the old hidden totalEpisodes<=1 fork.
		this.mode = initialMode ?? (s
			? (s.recurrence === 'once' ? 'single' : 'recurring')
			: (title.totalEpisodes <= 1 ? 'single' : 'recurring'));
		this.recurrence = s && s.recurrence !== 'once' ? s.recurrence : 'weekly';
		this.releaseDate =
			s?.releaseDate ??
			(title.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(title.releaseDate) ? title.releaseDate : '');
		this.releaseTime = s?.releaseTime ?? '';
		// weekly default: shows usually keep their premiere weekday, so derive it from the known release
		// date before falling back to Saturday
		this.dayOfWeek = s?.dayOfWeek ??
			(this.releaseDate ? new Date(this.releaseDate + 'T00:00:00').getDay() : 6);
		this.dayOfMonth = s?.dayOfMonth ?? 1;
		this.currentSeason = currentSeason;
		this.currentEpisode = currentEpisode;
		this.totalSeasons = totalSeasons ?? (title.seasons.length > 0 ? title.seasons.length : null);
		this.totalEpisodes = totalEpisodes ?? (title.totalEpisodes > 0 ? title.totalEpisodes : null);
	}

	onOpen(): void {
		this.titleEl.setText('Set schedule');
		this.contentEl.addClass('wl-add-modal');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/**
	 * Local HH:MM → its JST (UTC+9) equivalent, accounting for the local offset so DST is handled.
	 * Display only — the schedule stores the local time as entered.
	 */
	private localHHMMtoJST(localHHMM: string): string {
		if (!localHHMM || !/^\d{2}:\d{2}$/.test(localHHMM)) return '—';
		const [hStr, mStr] = localHHMM.split(':');
		const h = parseInt(hStr ?? '0', 10);
		const m = parseInt(mStr ?? '0', 10);
		// a Date for today at the given local time
		const now = new Date();
		const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
		// .getTime() is UTC epoch; add 9h for JST
		const jstMs = local.getTime() + 9 * 60 * 60 * 1000;
		const jst = new Date(jstMs);
		// format in UTC — the JST offset is already added
		const jh = jst.getUTCHours().toString().padStart(2, '0');
		const jm = jst.getUTCMinutes().toString().padStart(2, '0');
		return `${jh}:${jm}`;
	}

	/**
	 * Single release needs a date; recurring is always saveable (its selects and clamped inputs
	 * cannot hold an invalid value).
	 */
	private isValid(): boolean {
		return this.mode !== 'single' || this.releaseDate !== '';
	}

	private updateSaveState(): void {
		if (this.saveBtn) this.saveBtn.disabled = !this.isValid();
	}

	/** The schedule handed to onSave: built fresh from the visible fields only. */
	private buildSchedule(): AirtimeSchedule {
		if (this.mode === 'single') {
			return {
				recurrence: 'once',
				releaseDate: this.releaseDate,
				...(this.releaseTime ? { releaseTime: this.releaseTime } : {}),
			};
		}
		return {
			recurrence: this.recurrence,
			...(this.recurrence === 'weekly' ? { dayOfWeek: this.dayOfWeek } : {}),
			...(this.recurrence === 'monthly' ? { dayOfMonth: this.dayOfMonth } : {}),
			...(this.releaseTime ? { releaseTime: this.releaseTime } : {}),
		};
	}

	private renderForm(): void {
		const content = this.contentEl;
		content.empty();

		const makeRow = (parent: HTMLElement, label: string): HTMLElement => {
			const row = parent.createDiv({ cls: 'wl-modal-row' });
			row.createSpan({ cls: 'wl-modal-label', text: label });
			return row;
		};

		/** Native time input + live JST converter label. */
		const makeTimeRow = (parent: HTMLElement): void => {
			const row = parent.createDiv({ cls: 'wl-modal-row wl-modal-row-mt' });
			row.createSpan({ cls: 'wl-modal-label', text: 'Time (optional)' });
			const inp = row.createEl('input', {
				cls: 'wl-modal-input wl-time-input',
				attr: { type: 'time' },
			});
			inp.value = this.releaseTime;
			const jstLabel = row.createSpan({ cls: 'wl-jst-clock' });
			const updateJST = (): void => {
				jstLabel.textContent = this.releaseTime
					? `JST ${this.localHHMMtoJST(this.releaseTime)} · stored as local time`
					: 'JST —';
			};
			updateJST();
			inp.addEventListener('input', () => {
				this.releaseTime = inp.value;
				updateJST();
			});
		};

		// mode toggle
		const modeRow = content.createDiv({ cls: 'wl-schedule-mode-row' });
		const makeModeBtn = (label: string, value: 'single' | 'recurring'): void => {
			const btn = modeRow.createEl('button', {
				cls: `wl-btn wl-btn-sm wl-schedule-mode-btn${this.mode === value ? ' is-active' : ''}`,
				text: label,
			});
			btn.addEventListener('click', () => {
				if (this.mode === value) return;
				this.mode = value;
				this.renderForm();
			});
		};
		makeModeBtn('Single release', 'single');
		makeModeBtn('Recurring episodes', 'recurring');

		if (this.mode === 'single') {
			// single release: just a date (+ optional time)
			const dateRow = makeRow(content, 'Release date');
			createDatePicker({
				parent: dateRow,
				inputCls: 'wl-modal-input wl-date-input',
				value: this.releaseDate || null,
				lenient: true,
				onChange: (iso) => {
					// the picker only ever commits YYYY-MM-DD or null — no silent-failure path
					this.releaseDate = iso ?? '';
					this.updateSaveState();
				},
			});
			makeTimeRow(content);
		} else {
			// recurring: cadence + its one extra field (+ time)
			const recRow = makeRow(content, 'Airs');
			const recSelect = recRow.createEl('select', { cls: 'wl-select' });
			const recOptions: Array<[AirtimeRecurringKind, string]> = [
				['daily', 'Daily'],
				['weekly', 'Weekly'],
				['monthly', 'Monthly'],
			];
			for (const [val, label] of recOptions) {
				const opt = recSelect.createEl('option', { text: label, value: val });
				if (val === this.recurrence) opt.selected = true;
			}

			const extraEl = content.createDiv();
			const renderExtra = (): void => {
				extraEl.empty();
				if (this.recurrence === 'weekly') {
					const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
					const r = makeRow(extraEl, 'Day of week');
					const daySelect = r.createEl('select', { cls: 'wl-select' });
					DAYS.forEach((d, i) => {
						const opt = daySelect.createEl('option', { text: d, value: String(i) });
						if (i === this.dayOfWeek) opt.selected = true;
					});
					daySelect.addEventListener('change', () => {
						this.dayOfWeek = parseInt(daySelect.value, 10);
					});
				}
				if (this.recurrence === 'monthly') {
					const r = makeRow(extraEl, 'Day of month');
					const inp = r.createEl('input', {
						cls: 'wl-modal-input wl-modal-input-sm',
						attr: { type: 'number', min: '1', max: '31', placeholder: '1' },
					});
					inp.value = String(this.dayOfMonth);
					inp.addEventListener('input', () => {
						const v = parseInt(inp.value, 10);
						this.dayOfMonth = isNaN(v) ? 1 : Math.min(31, Math.max(1, v));
					});
				}
				makeTimeRow(extraEl);
			};
			recSelect.addEventListener('change', () => {
				this.recurrence = recSelect.value as AirtimeRecurringKind;
				renderExtra();
			});
			renderExtra();

			// progress: one compact row — Season [2] of [3] · Episode [7] of [13]
			const progRow = content.createDiv({ cls: 'wl-modal-row wl-schedule-progress-row' });
			const makeNum = (
				value: number | null,
				aria: string,
				onInput: (v: number | null) => void,
				min = 1,
			): void => {
				const inp = progRow.createEl('input', {
					cls: 'wl-modal-input wl-schedule-num',
					attr: { type: 'number', min: String(min), placeholder: '—', 'aria-label': aria },
				});
				if (value !== null) inp.value = String(value);
				inp.addEventListener('input', () => onInput(parseInt(inp.value, 10) || null));
			};
			progRow.createSpan({ cls: 'wl-modal-label', text: 'Season' });
			makeNum(this.currentSeason, 'Current season', (v) => { this.currentSeason = v; });
			progRow.createSpan({ cls: 'wl-schedule-progress-sep', text: 'of' });
			makeNum(this.totalSeasons, 'Total seasons', (v) => { this.totalSeasons = v; });
			progRow.createSpan({ cls: 'wl-schedule-progress-sep wl-schedule-progress-dot', text: '·' });
			progRow.createSpan({ cls: 'wl-modal-label', text: 'Episode' });
			makeNum(this.currentEpisode, 'Next episode', (v) => { this.currentEpisode = v; });
			progRow.createSpan({ cls: 'wl-schedule-progress-sep', text: 'of' });
			makeNum(this.totalEpisodes, 'Total episodes', (v) => { this.totalEpisodes = v; }, 0);
		}

		// the save side-effects, stated instead of silent
		content.createDiv({
			cls: 'wl-modal-info wl-schedule-hint',
			text: this.mode === 'single'
				? "Saving also updates this title's release date."
				: "Saving also updates this title's total episodes.",
		});

		// cancel / save
		const btnRow = content.createDiv({ cls: 'wl-modal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-mr', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.saveBtn = btnRow.createEl('button', { cls: 'wl-btn wl-btn-primary', text: 'Save' });
		this.saveBtn.addEventListener('click', () => {
			if (!this.isValid()) return;
			void (async () => {
				await this.onSave(
					this.buildSchedule(),
					this.currentSeason,
					this.currentEpisode,
					this.totalSeasons,
					this.totalEpisodes,
				);
				this.close();
			})();
		});
		this.updateSaveState();
	}
}

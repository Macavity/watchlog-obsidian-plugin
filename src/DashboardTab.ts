import type WatchLogPlugin from './main';
import type { DataManager } from './DataManager';
import type { ReadingDataManager } from './ReadingDataManager';
import type { Book, Game, Manga, TagDefinition, WatchLogTitle } from './types';
import { formatTime, getTitleCredits, getThemedColor, getReadingTypeColor, GAME_FINISHED_STATUS, bookPageEquivalents, formatCount } from './types';
import type { CreditsField } from './types';

const RING_CIRCUMFERENCE = 2 * Math.PI * 45; // r=45

/**
 * The minimal shape the More-statistics counters need from any library item, so Watchlist titles,
 * Books, Manga and Games share one counting pipeline. Buckets are keyed by name, so a status/type
 * shared across libraries (e.g. 'Completed') merges into one row.
 */
interface StatItem {
	status: string;
	/** Watch type, 'Book' / 'Manga' for reading, or the game's genre. */
	type: string;
	dateAdded?: string | null;
	releaseDate?: string | null;
}

/** Libraries the More-statistics panel can be narrowed to. */
type StatSource = 'watchlist' | 'reading' | 'games';

const STAT_SOURCES: { label: string; value: StatSource }[] = [
	{ label: 'Watchlist', value: 'watchlist' },
	{ label: 'Reading', value: 'reading' },
	{ label: 'Games', value: 'games' },
];

/** Aggregated reading stats for one kind (books or manga). */
interface ReadingAggregate {
	left: number;       // count of Reading + Plan to Read (To be released excluded)
	read: number;       // sum of pages (books) / chapters (manga) read
	total: number;      // sum of total pages / chapters
	volumesRead: number;
	totalVolumes: number;
}

export class DashboardTab {
	private container: HTMLElement;
	private plugin: WatchLogPlugin;
	private dataManager: DataManager;
	private readingData: ReadingDataManager;

	/**
	 * Which libraries the More-statistics panel shows. Static, so the choice survives tab switches for
	 * the session (the view builds a fresh DashboardTab each time). Empty is never valid: deselecting
	 * the last source falls back to "All".
	 */
	private static activeSources = new Set<StatSource>(['watchlist', 'reading', 'games']);

	constructor(
		container: HTMLElement,
		plugin: WatchLogPlugin,
		dataManager: DataManager,
		readingData: ReadingDataManager,
	) {
		this.container = container;
		this.plugin = plugin;
		this.dataManager = dataManager;
		this.readingData = readingData;
	}

	render(): void {
		this.container.empty();
		this.container.addClass('wl-dashboard');

		// precompute shared collections once per render so subrenderers don't rescan the titles array
		const allTitles = this.dataManager.getTitles();
		const byType = new Map<string, WatchLogTitle[]>();
		for (const t of allTitles) {
			const arr = byType.get(t.type);
			if (arr) arr.push(t);
			else byType.set(t.type, [t]);
		}
		const planTitles = allTitles.filter((t) => t.status === 'Plan to watch');

		// reading data from ReadingDataManager so footer counts span both datasets
		const books = this.readingData.getBooks();
		const manga = this.readingData.getMangaList();
		const games = this.plugin.gameDataManager.getGames();

		// reading aggregates computed once per render, not per data change
		const booksAgg = this.aggregateBooks(books);
		const mangaAgg = this.aggregateManga(manga);

		this.renderCards(allTitles, byType, booksAgg, mangaAgg);
		this.renderMoreStatistics(allTitles, books, manga, games);
		this.renderSuggestions(planTitles);
		this.renderRecentlyWatched();
		this.renderRecentlyAdded();
	}

	private statsFor(titles: WatchLogTitle[]): { watched: number; total: number } {
		const EXCLUDED = new Set(['Dropped', 'To be released']);
		let total = 0;
		let watched = 0;
		for (const t of titles) {
			if (EXCLUDED.has(t.status)) continue;
			total++;
			if (t.status === 'Completed') watched++;
		}
		return { watched, total };
	}

	private renderCards(
		allTitles: WatchLogTitle[],
		byType: Map<string, WatchLogTitle[]>,
		booksAgg: ReadingAggregate,
		mangaAgg: ReadingAggregate,
	): void {
		const isRect = this.plugin.settings.dashboardCardStyle === 'rectangles';
		const grid = this.container.createDiv({ cls: 'wl-rings-grid' });

		// unified Total / Time card, anchored at the top (full width)
		const totalStats = this.statsFor(allTitles);
		const totalPercent =
			totalStats.total === 0
				? 0
				: Math.round((totalStats.watched / totalStats.total) * 100);
		const timeWatched = this.dataManager.getTotalTimeWatched();
		const timeRemaining = this.dataManager.getTotalTimeRemaining();
		// the games segment is omitted entirely when nothing has a playtime, so libraries without games
		// keep the 3-up card
		const timePlayed = this.plugin.gameDataManager
			.getGames()
			.reduce((sum, g) => sum + g.playtimeMinutes, 0);
		this.renderUnifiedCard(
			grid, isRect, totalPercent, totalStats,
			formatTime(timeWatched), formatTime(timeRemaining),
			timePlayed > 0 ? formatTime(timePlayed) : null,
		);

		for (const type of this.plugin.settings.types) {
			const stats = this.statsFor(byType.get(type.name) ?? []);
			const percent =
				stats.total === 0 ? 0 : Math.round((stats.watched / stats.total) * 100);
			if (isRect) {
				const item = grid.createDiv({ cls: 'wl-rect-item' });
				this.fillRect(item, type.name, type.color, percent, stats);
				// reserve the sublabel line so type cards match the taller Books/Manga cards
				item.createDiv({ cls: 'wl-rect-subline', text: ' ' });
			} else {
				const item = grid.createDiv({ cls: 'wl-ring-item' });
				this.fillRing(item, type.name, type.color, percent, stats);
				item.createDiv({ cls: 'wl-ring-subtitle wl-ring-subline', text: ' ' });
			}
		}

		// reading cards (Books + Manga) at the end of the flow
		this.renderReadingCard(grid, isRect, 'Books', booksAgg);
		this.renderReadingCard(grid, isRect, 'Manga', mangaAgg);
	}

	// Unified Total / Time card

	private renderUnifiedCard(
		grid: HTMLElement,
		isRect: boolean,
		totalPercent: number,
		totalStats: { watched: number; total: number },
		timeWatchedStr: string,
		timeRemainingStr: string,
		timePlayedStr: string | null,
	): void {
		// rect cards carry an outer border; ring cards don't — match the active style
		const cls = isRect ? 'wl-dash-unified wl-dash-unified-bordered' : 'wl-dash-unified';
		const card = grid.createDiv({
			cls: timePlayedStr ? `${cls} wl-dash-unified-4` : cls,
		});

		// segment 1 — Total. Ring content is centered; rect content stretches so its bar spans the segment.
		const seg1 = card.createDiv({ cls: isRect ? 'wl-dash-seg' : 'wl-dash-seg wl-dash-seg-center' });
		if (isRect) {
			// rect content goes straight into the segment, so its border is the card's
			this.fillRect(seg1, 'Total', '#7F77DD', totalPercent, totalStats);
		} else {
			// rings are borderless; wrap so the accent ring matches type cards
			this.fillRing(seg1.createDiv({ cls: 'wl-ring-item' }), 'Total', '#7F77DD', totalPercent, totalStats);
		}

		// segments 2 & 3 — Time Watched / Remaining: label + value, no bar
		this.renderTimeSegment(card, 'Time Watched', timeWatchedStr);
		this.renderTimeSegment(card, 'Time Remaining', timeRemainingStr);
		if (timePlayedStr) this.renderTimeSegment(card, 'Time Played', timePlayedStr);
	}

	private renderTimeSegment(card: HTMLElement, label: string, value: string): void {
		const seg = card.createDiv({ cls: 'wl-dash-seg wl-dash-seg-center wl-dash-seg-time' });
		seg.createDiv({ cls: 'wl-dash-seg-label', text: label });
		seg.createDiv({ cls: 'wl-dash-seg-value', text: value });
	}

	// Reading cards (Books / Manga)

	private aggregateBooks(books: Book[]): ReadingAggregate {
		const agg: ReadingAggregate = { left: 0, read: 0, total: 0, volumesRead: 0, totalVolumes: 0 };
		for (const b of books) {
			if (b.status === 'To be released') continue; // excluded entirely
			if (b.status === 'Reading' || b.status === 'Plan to Read') agg.left++;
			// words-tracked books fold in as page equivalents (WORDS_PER_PAGE) so one ring spans both units;
			// nothing stored is converted
			const { read, total } = bookPageEquivalents(b);
			agg.read += read;
			agg.total += total;
		}
		return agg;
	}

	private aggregateManga(manga: Manga[]): ReadingAggregate {
		const agg: ReadingAggregate = { left: 0, read: 0, total: 0, volumesRead: 0, totalVolumes: 0 };
		for (const m of manga) {
			if (m.status === 'To be released') continue; // excluded entirely
			if (m.status === 'Reading' || m.status === 'Plan to Read') agg.left++;
			agg.read += m.chaptersRead;
			agg.total += m.totalChapters;
			agg.volumesRead += m.volumesRead;
			agg.totalVolumes += m.totalVolumes;
		}
		return agg;
	}

	private renderReadingCard(
		grid: HTMLElement,
		isRect: boolean,
		label: 'Books' | 'Manga',
		agg: ReadingAggregate,
	): void {
		const percent = agg.total > 0 ? Math.round((agg.read / agg.total) * 100) : 0;
		// configured Reading type colour, mirroring how watchlist type cards use theirs
		const color = getReadingTypeColor(label === 'Books' ? 'book' : 'manga', this.plugin.settings);

		// single inline subline under the bar: Books → pages; Manga → chapters · vol.
		const subline =
			label === 'Books'
				? `${formatCount(agg.read)} / ${formatCount(agg.total)} pages`
				: `${formatCount(agg.read)} / ${formatCount(agg.total)} chapters · ${agg.volumesRead} / ${agg.totalVolumes} vol`;

		if (isRect) {
			const item = grid.createDiv({ cls: 'wl-rect-item' });
			const topRow = item.createDiv({ cls: 'wl-rect-top' });
			topRow.createSpan({ cls: 'wl-rect-label', text: label });
			topRow.createSpan({ cls: 'wl-rect-unwatched', text: `${agg.left} left` });
			item.createDiv({ cls: 'wl-rect-value', text: `${percent}%` });
			const barWrap = item.createDiv({ cls: 'wl-rect-bar-wrap' });
			const bar = barWrap.createDiv({ cls: 'wl-rect-bar' });
			bar.style.width = `${percent}%`;
			bar.style.backgroundColor = color;
			item.createDiv({ cls: 'wl-rect-subline', text: subline });
		} else {
			const item = grid.createDiv({ cls: 'wl-ring-item' });
			const svg = this.makeRingSvg(percent, color, `${percent}%`, '', true);
			item.appendChild(svg);
			item.createDiv({ cls: 'wl-ring-label', text: label });
			item.createDiv({ cls: 'wl-ring-subtitle', text: `${agg.left} left` });
			item.createDiv({ cls: 'wl-ring-subtitle wl-ring-subline', text: subline });
		}
	}

	// Shared card content builders

	/**
	 * Builds the progress-ring SVG. With `themeStroke` the arc colour is applied inline, so CSS vars
	 * resolve.
	 */
	private makeRingSvg(
		percent: number,
		color: string,
		centerText: string,
		subText: string,
		themeStroke = false,
	): SVGSVGElement {
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = activeDocument.createElementNS(svgNS, 'svg');
		svg.setAttribute('viewBox', '0 0 120 120');
		svg.setAttribute('width', '110');
		svg.setAttribute('height', '110');
		svg.addClass('wl-ring-svg');

		const bgCircle = activeDocument.createElementNS(svgNS, 'circle');
		bgCircle.setAttribute('cx', '60');
		bgCircle.setAttribute('cy', '60');
		bgCircle.setAttribute('r', '45');
		bgCircle.setAttribute('fill', 'none');
		bgCircle.setAttribute('stroke-width', '10');
		bgCircle.addClass('wl-ring-track');
		svg.appendChild(bgCircle);

		const arc = activeDocument.createElementNS(svgNS, 'circle');
		arc.setAttribute('cx', '60');
		arc.setAttribute('cy', '60');
		arc.setAttribute('r', '45');
		arc.setAttribute('fill', 'none');
		if (themeStroke) arc.style.stroke = color;
		else arc.setAttribute('stroke', color);
		arc.setAttribute('stroke-width', '10');
		arc.setAttribute('stroke-linecap', 'round');
		arc.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
		arc.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - percent / 100)));
		arc.setAttribute('transform', 'rotate(-90 60 60)');
		arc.addClass('wl-ring-arc');
		svg.appendChild(arc);

		const text = activeDocument.createElementNS(svgNS, 'text');
		text.setAttribute('x', '60');
		text.setAttribute('y', subText ? '55' : '60');
		text.setAttribute('text-anchor', 'middle');
		text.setAttribute('dominant-baseline', 'middle');
		text.addClass('wl-ring-percent-text');
		text.textContent = centerText;
		svg.appendChild(text);

		if (subText) {
			const sub = activeDocument.createElementNS(svgNS, 'text');
			sub.setAttribute('x', '60');
			sub.setAttribute('y', '72');
			sub.setAttribute('text-anchor', 'middle');
			sub.addClass('wl-ring-sub-text');
			sub.textContent = subText;
			svg.appendChild(sub);
		}

		return svg;
	}

	private fillRing(
		item: HTMLElement,
		label: string,
		color: string,
		percent: number,
		stats: { watched: number; total: number },
	): void {
		const svg = this.makeRingSvg(percent, color, `${percent}%`, `${stats.watched}/${stats.total}`);
		item.appendChild(svg);
		item.createDiv({ cls: 'wl-ring-label', text: label });
		const unwatched = stats.total - stats.watched;
		item.createDiv({ cls: 'wl-ring-subtitle', text: `${unwatched} unwatched` });
	}

	private fillRect(
		item: HTMLElement,
		label: string,
		color: string,
		percent: number,
		stats: { watched: number; total: number },
	): void {
		const topRow = item.createDiv({ cls: 'wl-rect-top' });
		topRow.createSpan({ cls: 'wl-rect-label', text: label });
		const unwatched = stats.total - stats.watched;
		topRow.createSpan({ cls: 'wl-rect-unwatched', text: `${unwatched} left` });

		item.createDiv({ cls: 'wl-rect-value', text: `${percent}%` });

		const barWrap = item.createDiv({ cls: 'wl-rect-bar-wrap' });
		const bar = barWrap.createDiv({ cls: 'wl-rect-bar' });
		bar.style.width = `${percent}%`;
		bar.style.backgroundColor = color;
	}

	// More statistics

	private renderMoreStatistics(
		allTitles: WatchLogTitle[],
		books: Book[],
		manga: Manga[],
		games: Game[],
	): void {
		const inner = this.renderAccordion(this.container, 'More Statistics', 'wl-more-stats');

		// pinned library counts — repainted with the panel so they follow the source filter
		const pinned = inner.createDiv({ cls: 'wl-summary-metrics wl-more-stats-pinned' });
		const filterBar = inner.createDiv({ cls: 'wl-stats-filter-bar' });
		const grid = inner.createDiv({ cls: 'wl-stats-grid' });

		// repaint only this panel; a full re-render would rebuild the accordion and snap it shut
		const paint = (): void => {
			this.renderFilterButtons(filterBar, paint);
			this.renderStatsContent(pinned, grid, allTitles, books, manga, games);
		};
		paint();
	}

	/** The All / Watchlist / Reading / Games pill row (the Log-tab filter bar pattern). */
	private renderFilterButtons(bar: HTMLElement, onChange: () => void): void {
		bar.empty();
		const active = DashboardTab.activeSources;
		const allActive = active.size === STAT_SOURCES.length;

		const allBtn = bar.createEl('button', {
			cls: `wl-stats-filter-btn${allActive ? ' is-active' : ''}`,
			text: 'All',
		});
		allBtn.addEventListener('click', () => {
			if (allActive) return;
			DashboardTab.activeSources = new Set(STAT_SOURCES.map((s) => s.value));
			onChange();
		});

		for (const src of STAT_SOURCES) {
			const isActive = active.has(src.value);
			const btn = bar.createEl('button', {
				cls: `wl-stats-filter-btn${isActive && !allActive ? ' is-active' : ''}`,
				text: src.label,
			});
			btn.addEventListener('click', () => {
				// from "All", picking one source narrows to it; otherwise toggle, falling back to "All" when the
				// last one is switched off
				if (allActive) {
					DashboardTab.activeSources = new Set([src.value]);
				} else {
					const next = new Set(active);
					if (next.has(src.value)) next.delete(src.value);
					else next.add(src.value);
					DashboardTab.activeSources = next.size === 0
						? new Set(STAT_SOURCES.map((s) => s.value))
						: next;
				}
				onChange();
			});
		}
	}

	/**
	 * Paints the pinned counts + stat cards for the active sources. Cards with nothing to show are
	 * omitted entirely rather than rendering an empty shell.
	 */
	private renderStatsContent(
		pinned: HTMLElement,
		grid: HTMLElement,
		allTitles: WatchLogTitle[],
		books: Book[],
		manga: Manga[],
		games: Game[],
	): void {
		pinned.empty();
		grid.empty();

		const active = DashboardTab.activeSources;
		const watch = active.has('watchlist') ? allTitles : [];
		const shownBooks = active.has('reading') ? books : [];
		const shownManga = active.has('reading') ? manga : [];
		const shownGames = active.has('games') ? games : [];

		// Library + Completed sum watch + reading + games. Reading counts as completed on the exact status
		// 'Completed', matching the watch side; games use GAME_FINISHED_STATUS.
		const titleCount = watch.length + shownBooks.length + shownManga.length + shownGames.length;
		const completedCount =
			watch.reduce((n, t) => n + (t.status === 'Completed' ? 1 : 0), 0) +
			shownBooks.reduce((n, b) => n + (b.status === 'Completed' ? 1 : 0), 0) +
			shownManga.reduce((n, m) => n + (m.status === 'Completed' ? 1 : 0), 0) +
			shownGames.reduce((n, g) => n + (g.status === GAME_FINISHED_STATUS ? 1 : 0), 0);

		this.renderMetricRow(pinned, 'Titles in library', String(titleCount));
		this.renderMetricRow(pinned, 'Completed', String(completedCount));

		// one normalized list feeding the library-wide counters (Added Over Time / By Status / Type / Year)
		const statItems: StatItem[] = [
			...watch.map((t) => ({ status: t.status, type: t.type, dateAdded: t.dateAdded, releaseDate: t.releaseDate })),
			...shownBooks.map((b) => ({ status: b.status, type: 'Book', dateAdded: b.dateAdded, releaseDate: b.releaseDate })),
			...shownManga.map((m) => ({ status: m.status, type: 'Manga', dateAdded: m.dateAdded, releaseDate: m.releaseDate })),
			...shownGames.map((g) => ({ status: g.status, type: g.type, dateAdded: g.dateAdded, releaseDate: g.releaseDate })),
		];

		// always-open stat cards, alphabetical by label. The first four span every selected library; Time
		// Watched and the credit lists are Watchlist-only — minutes and cast/crew have no analog elsewhere.
		this.renderCountSection(grid, 'Added Over Time', this.countBy(statItems, (t) => this.yearOf(t.dateAdded)));
		this.renderCountSection(grid, 'By Status', this.countBy(statItems, (t) => t.status));
		this.renderCountSection(grid, 'By Type', this.countBy(statItems, (t) => t.type));
		this.renderByYearSection(grid, statItems);
		this.renderTimeByYearSection(grid, watch);
		const topN = Math.max(1, this.plugin.settings.dashboardTopCredits ?? 5);
		this.renderCountSection(grid, 'Top Actors', this.countCredits(watch, 'cast'), topN);
		this.renderCountSection(grid, 'Top Directors', this.countCredits(watch, 'director'), topN);
		this.renderCountSection(grid, 'Top Studios', this.countCredits(watch, 'studio'), topN);

		if (grid.childElementCount === 0) {
			grid.createDiv({ cls: 'wl-empty-state', text: 'No statistics for the selected libraries yet.' });
		}
	}

	/** Builds one always-open stat card (centered header + content) in the stats grid. */
	private renderStatCard(
		parent: HTMLElement,
		label: string,
	): { card: HTMLElement; header: HTMLElement } {
		const card = parent.createDiv({ cls: 'wl-stats-card' });
		const header = card.createDiv({ cls: 'wl-stats-card-header' });
		header.createDiv({ cls: 'wl-stats-card-title', text: label });
		return { card, header };
	}

	/** Builds a collapsed accordion (header + animated body) and returns the body. */
	private renderAccordion(parent: HTMLElement, label: string, cls: string): HTMLElement {
		const section = parent.createDiv({ cls: `wl-accordion ${cls}` });
		const header = section.createEl('button', { cls: 'wl-accordion-header' });
		header.createSpan({ cls: 'wl-accordion-title', text: label });
		header.createSpan({ cls: 'wl-accordion-chevron', text: '›' });
		const body = section.createDiv({ cls: 'wl-accordion-body' });
		const inner = body.createDiv({ cls: 'wl-accordion-inner' });
		header.addEventListener('click', () => {
			section.toggleClass('is-open', !section.hasClass('is-open'));
		});
		return inner;
	}

	/** Year (as 'YYYY') from a stored date/timestamp, or null when absent. */
	private yearOf(date: string | null | undefined): string | null {
		const m = date?.match(/^(\d{4})/);
		return m?.[1] ?? null;
	}

	private countBy<T>(
		titles: T[],
		key: (t: T) => string | null,
	): Map<string, number> {
		const counts = new Map<string, number>();
		for (const t of titles) {
			const k = key(t);
			if (!k) continue;
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		return counts;
	}

	/**
	 * Occurrence counts of credit names, over the merged view so user-added credits count too;
	 * unfetched / 'none' fields contribute nothing.
	 */
	private countCredits(titles: WatchLogTitle[], field: CreditsField): Map<string, number> {
		// bucket case-insensitively, display the first spelling seen: AniList returns "bones"
		// where Jikan returns "Bones", and two rows for one studio is just wrong
		const counts = new Map<string, number>();
		const labels = new Map<string, string>();
		for (const t of titles) {
			for (const name of getTitleCredits(t, field)) {
				const key = name.toLowerCase();
				if (!labels.has(key)) labels.set(key, name);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
		const out = new Map<string, number>();
		for (const [key, n] of counts) out.set(labels.get(key) ?? key, n);
		return out;
	}

	/** No-op when there's nothing to count — an empty card is dropped from the grid. */
	private renderCountSection(
		parent: HTMLElement,
		label: string,
		counts: Map<string, number>,
		limit?: number,
	): void {
		if (counts.size === 0) return;
		const { card } = this.renderStatCard(parent, label);
		this.renderCountList(card, counts, String, limit);
	}

	/** Renders count rows sorted count-desc (ties label-asc); optional cap for Top-N lists. */
	private renderCountList(
		parent: HTMLElement,
		counts: Map<string, number>,
		format: (n: number) => string,
		limit?: number,
	): void {
		let rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
		if (limit !== undefined) rows = rows.slice(0, limit);
		if (rows.length === 0) {
			parent.createDiv({ cls: 'wl-empty-state', text: 'No data yet.' });
			return;
		}
		const list = parent.createDiv({ cls: 'wl-stat-list' });
		for (const [label, n] of rows) {
			const row = list.createDiv({ cls: 'wl-stat-row' });
			row.createSpan({ cls: 'wl-metric-label', text: label });
			row.createSpan({ cls: 'wl-metric-value', text: format(n) });
		}
	}

	private renderByYearSection(parent: HTMLElement, statItems: StatItem[]): void {
		const byYear = this.countBy(statItems, (t) => this.yearOf(t.releaseDate));
		if (byYear.size === 0) return;
		const { card, header } = this.renderStatCard(parent, 'By Year');
		const byDecade = new Map<string, number>();
		for (const [year, n] of byYear) {
			const decade = `${year.slice(0, 3)}0s`;
			byDecade.set(decade, (byDecade.get(decade) ?? 0) + n);
		}

		let grouping: 'decade' | 'year' = 'decade';
		const toggle = header.createEl('button', { cls: 'wl-stat-toggle' });
		const listWrap = card.createDiv();
		const renderList = () => {
			listWrap.empty();
			toggle.textContent = grouping === 'decade' ? 'Group by year' : 'Group by decade';
			this.renderCountList(listWrap, grouping === 'decade' ? byDecade : byYear, String);
		};
		toggle.addEventListener('click', () => {
			grouping = grouping === 'decade' ? 'year' : 'decade';
			renderList();
		});
		renderList();
	}

	private renderTimeByYearSection(parent: HTMLElement, allTitles: WatchLogTitle[]): void {
		// year comes from dateFinished, not the release year; time uses the episodes-watched × duration
		// rules
		const minutes = new Map<string, number>();
		for (const t of allTitles) {
			const year = this.yearOf(t.dateFinished);
			if (!year) continue;
			const time = this.dataManager.calcTimeWatched(t);
			if (time <= 0) continue;
			minutes.set(year, (minutes.get(year) ?? 0) + time);
		}
		if (minutes.size === 0) return;
		const { card } = this.renderStatCard(parent, 'Time Watched by Year');
		this.renderCountList(card, minutes, formatTime);
	}

	private renderMetricRow(parent: HTMLElement, label: string, value: string): void {
		const row = parent.createDiv({ cls: 'wl-metric-row' });
		row.createSpan({ cls: 'wl-metric-label', text: label });
		row.createSpan({ cls: 'wl-metric-value', text: value });
	}

	// Suggestions

	private renderSuggestions(planTitles: WatchLogTitle[]): void {
		if (planTitles.length === 0) return;

		const section = this.container.createDiv({ cls: 'wl-suggestions' });
		section.createDiv({ cls: 'wl-section-title', text: "Don't know what to watch next?" });

		const grid = section.createDiv({ cls: 'wl-suggestions-grid' });

		const shortestByType = (typeName: string): string | null => {
			const candidates = planTitles
				.filter((t) => t.type === typeName)
				.filter((t) => t.totalEpisodes > 0 || t.episodeDuration > 0);
			if (candidates.length === 0) {
				// fallback: any plan-to-watch of this type, no length filter
				const fallback = planTitles.filter((t) => t.type === typeName);
				return fallback[0]?.title ?? null;
			}
			candidates.sort((a, b) => {
				const aVal = a.totalEpisodes > 0 ? a.totalEpisodes * (a.episodeDuration || 24) : a.episodeDuration;
				const bVal = b.totalEpisodes > 0 ? b.totalEpisodes * (b.episodeDuration || 24) : b.episodeDuration;
				return aVal - bVal;
			});
			return candidates[0]?.title ?? null;
		};

		// fixed 2×2 grid: Anime, Movie, TV Show, Random
		const fixedTypes = ['Anime', 'Movie', 'TV Show'];
		for (const typeName of fixedTypes) {
			const pick = shortestByType(typeName);
			const card = grid.createDiv({ cls: 'wl-suggestion-card' });
			card.createDiv({ cls: 'wl-suggestion-label', text: `Shortest ${typeName}` });
			card.createDiv({
				cls: `wl-suggestion-title${pick ? '' : ' wl-suggestion-empty'}`,
				text: pick ?? 'Nothing planned',
			});
		}

		const randomCard = grid.createDiv({ cls: 'wl-suggestion-card' });
		const randomHeader = randomCard.createDiv({ cls: 'wl-suggestion-random-header' });
		randomHeader.createDiv({ cls: 'wl-suggestion-label', text: 'Random' });
		const shuffleBtn = randomHeader.createEl('button', { cls: 'wl-suggestion-shuffle', text: '🔀' });
		shuffleBtn.title = 'Pick another';

		const getRandomTitle = (): string =>
			planTitles[Math.floor(Math.random() * planTitles.length)]?.title ?? '';
		const randomTitleEl = randomCard.createDiv({ cls: 'wl-suggestion-title', text: getRandomTitle() });

		shuffleBtn.addEventListener('click', () => {
			randomTitleEl.textContent = getRandomTitle();
		});
	}

	// Recently watched

	private renderRecentlyWatched(): void {
		const section = this.container.createDiv({ cls: 'wl-recently-watched' });
		section.createDiv({ cls: 'wl-section-title', text: 'Recently watched' });

		const recent = this.dataManager.getRecentlyWatched(3);

		if (recent.length === 0) {
			section.createDiv({ cls: 'wl-empty-state', text: 'No titles watched yet.' });
			return;
		}

		for (const title of recent) {
			const item = section.createDiv({ cls: 'wl-rw-item' });

			item.createDiv({ cls: 'wl-rw-title', text: title.title });

			const typeDef = this.getTagDef(title.type, this.plugin.settings.types);
			const colored = this.plugin.settings.coloredTypeBadges;
			const badgeWrap = item.createDiv({ cls: 'wl-rw-col-badge' });
			const badge = badgeWrap.createSpan({
				cls: colored ? 'wl-badge wl-badge-sm' : 'wl-badge-plain',
				text: title.type,
			});
			if (colored && typeDef) badge.style.backgroundColor = getThemedColor(title.type, typeDef.color, this.plugin.settings.colorTheme);

			const epCol = item.createDiv({ cls: 'wl-rw-col-ep' });
			const isMovie = title.type === 'Movie';
			if (!isMovie) {
				const nextEp = this.dataManager.getNextUnwatchedEpisode(title);
				epCol.textContent = nextEp !== null ? `Ep ${nextEp}` : '✓';
			}

			const pctCol = item.createDiv({ cls: 'wl-rw-col-pct' });
			if (isMovie) {
				pctCol.textContent = title.watchedEpisodes.includes(1) ? '100%' : '0%';
			} else {
				pctCol.textContent = `${this.dataManager.getProgress(title)}%`;
			}
		}
	}

	// Recently added

	private renderRecentlyAdded(): void {
		const section = this.container.createDiv({ cls: 'wl-recently-watched' });
		section.createDiv({ cls: 'wl-section-title', text: 'Recently added' });

		const recent = this.dataManager.getRecentlyAdded(3);

		if (recent.length === 0) {
			section.createDiv({ cls: 'wl-empty-state', text: 'No titles in your library yet.' });
			return;
		}

		for (const title of recent) {
			const item = section.createDiv({ cls: 'wl-rw-item' });

			item.createDiv({ cls: 'wl-rw-title', text: title.title });

			const typeDef = this.getTagDef(title.type, this.plugin.settings.types);
			const colored = this.plugin.settings.coloredTypeBadges;
			const badgeWrap = item.createDiv({ cls: 'wl-rw-col-badge' });
			const badge = badgeWrap.createSpan({
				cls: colored ? 'wl-badge wl-badge-sm' : 'wl-badge-plain',
				text: title.type,
			});
			if (colored && typeDef) badge.style.backgroundColor = getThemedColor(title.type, typeDef.color, this.plugin.settings.colorTheme);

			const epCol = item.createDiv({ cls: 'wl-rw-col-ep' });
			const isMovie = title.type === 'Movie';
			if (!isMovie) {
				const nextEp = this.dataManager.getNextUnwatchedEpisode(title);
				epCol.textContent = nextEp !== null ? `Ep ${nextEp}` : '✓';
			}

			const pctCol = item.createDiv({ cls: 'wl-rw-col-pct' });
			if (isMovie) {
				pctCol.textContent = title.watchedEpisodes.includes(1) ? '100%' : '0%';
			} else {
				pctCol.textContent = `${this.dataManager.getProgress(title)}%`;
			}
		}
	}

	private getTagDef(name: string, tags: TagDefinition[]): TagDefinition | undefined {
		return tags.find((t) => t.name === name);
	}
}

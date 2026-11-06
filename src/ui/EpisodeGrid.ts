import type { Season, WatchLogTitle } from '../types';

interface SeasonFillButtonOptions {
	/** Live title; read on every refresh and click because the object can be replaced. */
	getTitle: () => WatchLogTitle;
	seasonEps: number[];
	labels: { clearAll: string; markAll: string };
	/** Click: `markWatched` is true when the season is not fully watched yet. */
	onToggle: (markWatched: boolean, e: MouseEvent) => void;
}

/** The ✓/✗ fill-or-clear toggle that opens an episode grid. Returns a refresh for after episode clicks. */
function renderSeasonFillButton(grid: HTMLElement, opts: SeasonFillButtonOptions): () => void {
	const fillBtn = grid.createDiv({ cls: 'wl-season-fill-btn' });
	const allWatched = (): boolean => {
		const watched = new Set(opts.getTitle().watchedEpisodes);
		return opts.seasonEps.length > 0 && opts.seasonEps.every((ep) => watched.has(ep));
	};
	const refresh = (): void => {
		const all = allWatched();
		fillBtn.classList.toggle('is-clear', all);
		fillBtn.classList.toggle('is-fill', !all);
		fillBtn.textContent = all ? '✗' : '✓';
		fillBtn.title = all ? opts.labels.clearAll : opts.labels.markAll;
	};
	refresh();
	fillBtn.addEventListener('click', (e) => opts.onToggle(!allWatched(), e));
	return refresh;
}

interface EpisodeBoxOptions {
	getTitle: () => WatchLogTitle;
	season: Season | null;
	epNum: number;
	/** Number within the season (1-based); matches `skippedEpisodes`. */
	relNum: number;
	displayNum: number;
	tooltip: (isSkipped: boolean) => string;
	/** Click handler; `refreshBox` repaints this box from live state. */
	onClick: (e: MouseEvent, refreshBox: () => void) => void;
}

/** One episode cell: watched ✓, skipped —, else its number. */
function renderEpisodeBox(grid: HTMLElement, opts: EpisodeBoxOptions): void {
	const box = grid.createDiv({ cls: 'wl-episode-box' });
	// read fresh state: closures over isWatched/isSkipped go stale
	const refreshBox = (): void => {
		const isWatched = opts.getTitle().watchedEpisodes.includes(opts.epNum);
		const isSkipped = opts.season ? (opts.season.skippedEpisodes ?? []).includes(opts.relNum) : false;
		box.classList.toggle('is-watched', isWatched);
		box.classList.toggle('is-skipped', isSkipped);
		box.textContent = isSkipped && !isWatched ? '—' : (isWatched ? '✓' : String(opts.displayNum));
		box.title = opts.tooltip(isSkipped);
	};
	refreshBox();
	box.addEventListener('click', (e) => opts.onClick(e, refreshBox));
}

export interface EpisodeGridOptions {
	/** Live title; read on every repaint because the object can be replaced. */
	getTitle: () => WatchLogTitle;
	/** The season shown, or null for a title without seasons. */
	season: Season | null;
	/** Number cells within the season instead of across the whole title. */
	perSeason: boolean;
	labels: { clearAll: string; markAll: string };
	episodeTooltip: (epNum: number, isSkipped: boolean) => string;
	/** Fill button click: set every episode of the season watched or unwatched. */
	onFill: (seasonEps: number[], markWatched: boolean, e: MouseEvent) => void;
	/** Episode click; the box and the fill button repaint through the passed callbacks. */
	onEpisode: (epNum: number, e: MouseEvent, refreshBox: () => void, refreshFillBtn: () => void) => void;
}

/** Episode grid of one season: fill/clear toggle plus one box per episode. */
export function renderEpisodeGrid(parent: HTMLElement, opts: EpisodeGridOptions): void {
	const { season } = opts;
	const grid = parent.createDiv({ cls: 'wl-episode-grid' });
	const count = season ? season.episodes : opts.getTitle().totalEpisodes;
	const offset = season ? season.offset : 0;
	const seasonEps = Array.from({ length: count }, (_, i) => offset + i + 1);

	const refreshFillBtn = renderSeasonFillButton(grid, {
		getTitle: opts.getTitle,
		seasonEps,
		labels: opts.labels,
		onToggle: (markWatched, e) => opts.onFill(seasonEps, markWatched, e),
	});

	for (let i = 0; i < count; i++) {
		const epNum = offset + i + 1;
		const relNum = i + 1;
		renderEpisodeBox(grid, {
			getTitle: opts.getTitle,
			season,
			epNum,
			relNum,
			displayNum: opts.perSeason ? relNum : epNum,
			tooltip: (isSkipped) => opts.episodeTooltip(epNum, isSkipped),
			onClick: (e, refreshBox) => opts.onEpisode(epNum, e, refreshBox, refreshFillBtn),
		});
	}
}

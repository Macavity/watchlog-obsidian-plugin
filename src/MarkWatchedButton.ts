import type { DataManager } from './DataManager';
import type { WatchLogTitle } from './types';
import { todayIso } from './types';

/**
 * True for titles with exactly one thing to tick, where the episode grid would render a lone "1"
 * box — those get the Mark-as-Watched button instead.
 *
 * Movies qualify by type (their episode count is often left at 0); everything else qualifies on
 * content: one episode and no season structure. Titles with seasons stay on the grid even at one
 * episode, so the season header and its skip info stay visible — which is also why the raw
 * `totalEpisodes` is used rather than the skip-adjusted total.
 */
export function isSingleEpisodeTitle(title: WatchLogTitle): boolean {
	return title.type === 'Movie' || (title.seasons.length === 0 && title.totalEpisodes === 1);
}

/**
 * The shared "Mark as Watched" button for Movie titles, used by the detail modal and the List
 * view's expanded row. A movie has one episode, so the button doubles as the watched toggle and the
 * completion action: it ticks episode 1, sets the status to Completed and stamps today's watch date;
 * pressing again reverts all three. Live state is read from the DataManager on every paint, so the
 * label and colour stay correct whichever copy of the title the caller holds.
 *
 * @param onChanged Fired after the write lands, before the button repaints.
 */
export function appendMarkWatchedButton(
	dataManager: DataManager,
	parent: HTMLElement,
	titleId: string,
	onChanged: () => void,
): HTMLElement {
	const btn = parent.createEl('button', {
		cls: 'wl-mark-watched-btn',
		attr: { type: 'button' },
	});

	// watched whenever the movie counts as seen — its single episode is ticked, or the title was set to
	// Completed elsewhere
	const isWatched = (): boolean => {
		const t = dataManager.getTitle(titleId);
		return !!t && (t.watchedEpisodes.includes(1) || t.status === 'Completed');
	};

	const paint = (): void => {
		const done = isWatched();
		btn.textContent = done ? 'Watched' : 'Mark as Watched';
		btn.toggleClass('is-watched', done);
		btn.title = done ? 'Click to unmark as watched' : 'Mark as watched';
		btn.setAttr('aria-pressed', done ? 'true' : 'false');
	};
	paint();

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		const next = !isWatched();
		void (async () => {
			await dataManager.markEpisodeWatched(titleId, 1, next);
			await finalizeWatchedState(dataManager, titleId, next);
			onChanged();
			paint();
		})();
	});

	return btn;
}

/**
 * Finalizes a Mark-as-Watched toggle. `markEpisodeWatched` already syncs status and finish date, but
 * only when the auto-complete / auto-finish-date settings are on — for an explicit press the two
 * always follow, so this writes them regardless. Persists only when something differs, so the
 * common path stays a single save.
 */
async function finalizeWatchedState(
	dataManager: DataManager,
	titleId: string,
	watched: boolean,
): Promise<void> {
	const t = dataManager.getTitle(titleId);
	if (!t) return;
	const today = todayIso();
	let dirty = false;
	if (watched) {
		if (t.status !== 'Completed') {
			t.status = 'Completed';
			dirty = true;
		}
		if (t.dateFinished !== today) {
			t.dateFinished = today;
			dirty = true;
		}
	} else if (t.status === 'Completed') {
		t.status = 'Watching';
		t.dateFinished = null;
		dirty = true;
	}
	if (dirty) await dataManager.updateTitle(t);
}

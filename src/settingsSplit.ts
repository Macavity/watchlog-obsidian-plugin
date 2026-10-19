import { DEFAULT_SETTINGS, LAST_USED_TYPE_SENTINEL, normalizeRowsLayout } from './types';
import type { WatchLogPluginSettings } from './types';
import { SHARED_SETTING_KEYS } from './storage/SharedConfigStore';
import type { SharedConfigStore } from './storage/SharedConfigStore';
import type { LocalStore } from './storage/LocalStore';

/** Settings that no longer exist; dropped from stored data. */
const REMOVED_KEYS = ['rootFolder', 'customListsFolder'];

/**
 * Settings = DEFAULT_SETTINGS <- local (data.json) <- shared (base); shared keys win.
 * Inputs are cloned, so backfills never mutate the stores or DEFAULT_SETTINGS.
 */
export function composeSettings(
	local: Record<string, unknown>,
	shared: Record<string, unknown>,
): WatchLogPluginSettings {
	const saved = structuredClone({ ...local, ...shared }) as Partial<WatchLogPluginSettings>;
	for (const k of REMOVED_KEYS) delete (saved as Record<string, unknown>)[k];
	const settings: WatchLogPluginSettings = Object.assign({}, DEFAULT_SETTINGS, saved);
	if (saved.listFilters) {
		settings.listFilters = Object.assign(
			{},
			DEFAULT_SETTINGS.listFilters,
			saved.listFilters,
		);
	}
	// per-tab merge so a partially saved record keeps defaults for the rest
	settings.cardTextStyles = Object.assign(
		{},
		DEFAULT_SETTINGS.cardTextStyles,
		saved.cardTextStyles ?? {},
	);
	if (settings.animeApiSource === undefined) {
		settings.animeApiSource = 'jikan';
	}
	// date display format. Existing installs saw DD/MM/YYYY everywhere, so 'european' is both the
	// default and the migration target for a missing or hand-edited value. Storage is unaffected.
	if (
		settings.dateFormat !== 'european' &&
		settings.dateFormat !== 'american' &&
		settings.dateFormat !== 'iso'
	) {
		settings.dateFormat = 'european';
	}
	if (settings.typeApiMapping === undefined) {
		settings.typeApiMapping = {};
	}
	// reading type badge colors (Manga / Book) — backfill defaults for old installs
	if (!settings.readingTypeColors) {
		settings.readingTypeColors = { manga: '#D4537E', book: '#D85A30' };
	} else {
		if (!settings.readingTypeColors.manga) settings.readingTypeColors.manga = '#D4537E';
		if (!settings.readingTypeColors.book) settings.readingTypeColors.book = '#D85A30';
	}
	// watchlist view: 'rows' is the default, and the removed 'cards' view migrates to 'rows'
	if (settings.defaultWatchlistView !== 'list' && settings.defaultWatchlistView !== 'rows') {
		settings.defaultWatchlistView = 'rows';
	}
	// backfill the status-bar Upcoming counter toggle for existing installs (default ON)
	if (settings.showUpcomingStatusBar === undefined) {
		settings.showUpcomingStatusBar = true;
	}
	// normalize the stored rows layout (drops unknown ids, appends shelves missing from an older
	// layout) and always take a fresh array so later in-place edits can't mutate DEFAULT_SETTINGS
	settings.rowsLayout = normalizeRowsLayout(settings.rowsLayout);
	// backfill the default Add type setting for existing installs
	if (settings.defaultAddType === undefined) {
		settings.defaultAddType = LAST_USED_TYPE_SENTINEL;
	}
	if (settings.lastAddedType === undefined) {
		settings.lastAddedType = '';
	}
	// array fields are never undefined after a partial merge
	if (!settings.types?.length) settings.types = DEFAULT_SETTINGS.types;
	if (!settings.statuses?.length) settings.statuses = DEFAULT_SETTINGS.statuses;
	if (!settings.reviews?.length) settings.reviews = DEFAULT_SETTINGS.reviews;
	if (!settings.priorities?.length) settings.priorities = DEFAULT_SETTINGS.priorities;
	if (!settings.seasonPalette?.length) settings.seasonPalette = DEFAULT_SETTINGS.seasonPalette;
	// the rating system must always be exactly five well-formed tiers; a missing or malformed value
	// (older or hand-edited data) resets to defaults
	if (
		!Array.isArray(settings.ratingSystem) ||
		settings.ratingSystem.length !== 5 ||
		settings.ratingSystem.some((t) => !t || typeof t.label !== 'string' || typeof t.color !== 'string')
	) {
		settings.ratingSystem = DEFAULT_SETTINGS.ratingSystem.map((t) => ({ ...t }));
	}
	// migrate the Plan to watch colour from old grey to new teal
	const ptw = settings.statuses.find((s) => s.name === 'Plan to watch');
	if (ptw && ptw.color === '#888780') ptw.color = '#00A9A5';

	// ensure the "To be released" status exists (migration for existing users)
	if (!settings.statuses.find((s) => s.name === 'To be released')) {
		const completedIdx = settings.statuses.findIndex((s) => s.name === 'Completed');
		const insertAt = completedIdx >= 0 ? completedIdx + 1 : settings.statuses.length;
		settings.statuses.splice(insertAt, 0, { name: 'To be released', color: '#E8873A' });
	}

	return settings;
}

/**
 * Shared keys go to the base (whitelist-filtered there), the rest, including every API key,
 * to data.json. Secrets must never reach the base.
 */
export async function persistSettings(
	settings: WatchLogPluginSettings,
	local: LocalStore,
	shared: SharedConfigStore,
): Promise<void> {
	const all = settings as unknown as Record<string, unknown>;
	const localPart: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(all)) {
		if (!SHARED_SETTING_KEYS.includes(k)) localPart[k] = v;
	}
	local.data.settings = localPart;
	local.queueSave();
	await shared.update(all);
}

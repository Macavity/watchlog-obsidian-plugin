const app = {
	ribbon: 'Watchlog',
	viewTitle: 'Watchlog',
	commands: {
		openPanel: 'Open panel',
		addTitle: 'Add title',
		insertWidget: 'Insert widget',
		searchTitle: 'Search title',
	},
	tabs: {
		dashboard: 'Dashboard',
		watchlist: 'Watchlist',
		reading: 'Reading',
		games: 'Games',
		upcoming: 'Upcoming',
		customLists: 'Custom lists',
		drafts: 'Drafts',
		log: 'Log',
	},
	statusBar: {
		label: 'Watchlog: upcoming due',
		due: { one: '{count} due', other: '{count} due' },
	},
	titleNotice: '"{title}" · {type} · {status}',
	widgetPlaceholder: 'Select a widget to insert...',
	widgets: {
		todoFull: 'Track a title (full)',
		todoMini: 'Track a title (compact)',
		statWatched: 'Time watched (mini)',
		statCompleted: 'Completed titles (mini)',
		statRemaining: 'Time remaining (mini)',
		statTime: 'Watched + remaining (mini)',
		upcomingNext: 'Next upcoming (mini)',
		statTimeCompletedFull: 'Time · remaining · completed card',
		nowNext: 'Now watching + up next card',
	},
	notices: {
		newerSchema: 'Watchlog: data.json was written by a newer plugin version. Device settings are not saved until you update.',
		baseFilterMissing: 'Watchlog: the folder filter in WatchLog.base was not found; the base view may list other notes.',
		loadFailed: 'Watchlog could not load its notes. See the developer console for details.',
		legacyPluginEnabled: 'The original WatchLog plugin is still enabled. Disable it, otherwise both plugins write the same notes.',
		migrationFailed: 'Watchlog could not migrate its data to notes. It will retry on the next start; see the developer console.',
		migrated: 'Watchlog moved its data into notes (backup: {backup}).',
		migratedSkipped: {
			one: '{count} item was skipped, see the developer console.',
			other: '{count} items were skipped, see the developer console.',
		},
		noTitles: 'No titles in your watchlog library yet.',
	},
} as const;

export default app;

const settings = {
	nav: {
		general: 'General',
		api: 'API',
		customize: 'Customize',
		watchlist: 'Watchlist',
		drafts: 'Drafts',
		customLists: 'Custom Lists',
		reading: 'Reading',
		widgets: 'Widgets',
		quickInfo: 'Quick info',
	},
	group: {
		main: 'Main',
	},
	about: 'About {label}',
	progress: {
		done: 'Done',
		cancelled: 'Cancelled',
	},
	chip: {
		types: { one: '{count} type', other: '{count} types' },
		statuses: { one: '{count} status', other: '{count} statuses' },
		genres: { one: '{count} genre', other: '{count} genres' },
		platforms: { one: '{count} platform', other: '{count} platforms' },
		priorities: { one: '{count} priority', other: '{count} priorities' },
		tiers: { one: '{count} tier', other: '{count} tiers' },
		books: { one: '{count} book', other: '{count} books' },
		manga: { one: '{count} manga', other: '{count} manga' },
	},
	cardSize: {
		smallest: 'Smallest',
		smaller: 'Smaller',
		small: 'Small',
		default: 'Default',
		large: 'Large',
		larger: 'Larger',
		largest: 'Largest',
	},
	cards: {
		valuePx: '{label} · {px} px',
		styleMixed: 'Mixed',
		textUnder: 'Text under',
		textInside: 'Text inside',
		hintUnder: 'Name and details below the poster',
		hintInside: 'Overlaid on the poster',
		under: 'Under',
		inside: 'Inside',
		applyAll: '{name}: apply to every tab',
		tabStyle: '{tab}: {style}',
		text: {
			label: 'Card text',
			help: 'Where a tab\'s poster cards show their name, type and year; in a block under the poster (the classic Reading/Upcoming style) or overlaid at the bottom of the poster (the classic Watchlist style). Status badges stay on the poster either way. The two big previews apply a style to every tab at once; the rows below set each tab on its own.',
		},
		size: {
			label: 'Card size',
			help: 'Minimum poster width for every grid and shelf (cards stretch a little to fill each row). Desktop and phones/tablets are independent, and both sync like any other setting.',
		},
		desktop: 'Desktop',
		mobile: 'Mobile',
	},
	general: {
		coffee: 'Buy me a coffee',
		main: {
			sub: 'Global appearance, dates and maintenance',
		},
		dashboardStyle: {
			name: 'Dashboard card style',
			desc: 'Choose between ring charts or rectangular stat cards on the dashboard.',
			circles: 'Circles',
			rectangles: 'Rectangles',
		},
		dateFormat: {
			name: 'Date format',
			desc: 'How dates are shown and typed everywhere in the plugin; lists, cards, modals, the activity log and the calendar picker. Your stored data is never touched: dates are always saved in the same internal format, so switching between these is safe at any time.',
			european: 'European: {date}',
			american: 'American: {date}',
			iso: 'ISO: {date}',
		},
		halfStar: {
			name: 'Half-star ratings',
			desc: 'Allow half-star (0.5) steps when rating watchlist titles and reading entries. Existing ratings are never changed.',
		},
		finishDate: {
			name: 'Set finish date automatically',
			desc: 'Record today\'s date as the finish date when a watch title or reading entry is completed.',
		},
		replaceImages: {
			name: 'Replace all images with API images',
			desc: 'Replaces the image of every entry with the one from its API, including images you entered by hand. Entries without an ID and failed fetches keep their image.',
			button: 'Replace images',
			confirm: 'This replaces the image of all {titles} watch titles, {reading} reading entries and {games} games with the image from the API, including images you entered by hand. Entries without an API id or match keep their image. This makes many API requests and can take a while. Continue?',
			start: 'Re-fetching {count} images…',
			done: 'Images re-fetched: {updated} updated, {unchanged} unchanged or failed.',
		},
		rewrite: {
			name: 'Rewrite all note frontmatter',
			desc: 'Rewrites the YAML frontmatter on every existing Watchlist and Reading note, applying newer frontmatter fields to older notes. Body content (## Notes / ## Quotes) is preserved. Notes without a file on disk are skipped; use Regenerate to create them.',
			button: 'Rewrite frontmatter',
			confirm: 'This will rewrite the YAML frontmatter on all existing notes for {titles} watch titles and {reading} reading entries. Body content is preserved; notes without a file on disk are skipped. Continue?',
			none: 'No notes to rewrite.',
			progress: 'Rewriting frontmatter… {done} / {total}',
			result: { one: '{state}: {count} note rewritten.', other: '{state}: {count} notes rewritten.' },
			resultSkipped: { one: '{state}: {count} note rewritten, {skipped} skipped (no file).', other: '{state}: {count} notes rewritten, {skipped} skipped (no file).' },
		},
		studios: {
			name: 'Fetch studios for all titles',
			desc: 'Fills the studio or network for every watchlist title that has none yet. Movies and series use the configured movie service, anime uses the configured anime source. Titles that already have one are skipped, so re-running is cheap.',
			button: 'Fetch studios',
			allHave: 'Every title already has a studio.',
			confirm: { one: 'This will make roughly one API request for each of the {count} title without a studio. It can be cancelled at any time. Continue?', other: 'This will make roughly one API request for each of the {count} titles without a studio. It can be cancelled at any time. Continue?' },
			progress: 'Fetching studios… {done} / {total}',
			result: { one: '{state}: {count} title filled.', other: '{state}: {count} titles filled.' },
			resultMissed: { one: '{state}: {count} title filled, {missed} with no studio available.', other: '{state}: {count} titles filled, {missed} with no studio available.' },
		},
		hints: {
			name: 'Show hint banners',
			desc: 'Show informational hint banners in Upcoming, Custom Lists, and Drafts tabs.',
		},
		statusBar: {
			name: 'Show Upcoming count in status bar',
			desc: 'Show a "N due" counter in the status bar when Upcoming entries are due. Click it to open the Upcoming tab. (Desktop only.)',
		},
	},
	tags: {
		type: 'Type',
		status: 'Status',
		priority: 'Priority',
		genre: 'Genre',
		platform: 'Platform',
		namePlaceholder: 'Name',
		add: '+ add',
		exists: '"{name}" already exists.',
		removed: 'Removed "{name}".',
		rename: 'Rename {name}',
		infoStatusLocked: 'Status names are locked. Only the color can be changed.',
		infoTypes: 'Built-in types are locked. Custom types can be added and removed.',
		infoGenres: 'Genres can be renamed, recolored, added and removed. Renaming updates every game using that genre.',
		infoPlatforms: 'Platforms can be renamed, recolored, added and removed. Renaming updates every game using that platform; removing one clears it from them.',
	},
	customize: {
		theme: {
			title: 'Theme',
			sub: 'Preset palette applied across every tab',
			default: 'Default',
		},
		cards: {
			title: 'Cards',
			sub: 'Size and text layout of the poster cards in every tab',
		},
		watchlist: {
			sub: 'Type, status and season colours for watch titles',
		},
		reading: {
			sub: 'Badge and status colours for books and manga',
		},
		games: {
			sub: 'Status, genre and platform colours for the Games tab',
			note: 'Game note files pick up a renamed genre or platform the next time that game is saved.',
		},
		shared: {
			title: 'Shared',
			sub: 'Priority and star ratings, used by all three libraries',
		},
		readingType: {
			manga: 'Manga',
			book: 'Book',
			help: 'The badge colour used for a Book or a Manga wherever its type is shown.',
		},
		rating: {
			label: 'Rating system',
			help: 'The color and text shown for each star rating across Watchlist, Reading, and Games. A whole star shares a tier with the half-step below it; e.g. 2.5★ and 3★ are both "Good".',
			labelAria: 'Label for {tier}-star rating',
		},
		season: {
			label: 'Season colors',
			help: 'Colors cycle through seasons in order (Season 1 = color 1, etc.).',
			name: 'Season {number}',
			add: '+ add color',
		},
	},
	watchlist: {
		main: {
			sub: 'Episode numbering, add defaults and badge style',
		},
		numbering: {
			name: 'Episode numbering',
			desc: 'Absolute: episodes numbered 1→n across all seasons. Per season: each season restarts from 1 (display only, data is unchanged).',
			absolute: 'Absolute',
			perSeason: 'Per season',
		},
		defaultType: {
			name: 'Default type for new titles',
			desc: 'Type preselected when adding a title. "Last type used" follows whatever you added last.',
			last: '* Last type used',
		},
		topCredits: {
			name: 'Top directors / actors count',
			desc: 'How many entries the dashboard shows in its top directors and top actors lists.',
		},
		autoComplete: {
			name: 'Auto-complete on last episode',
			desc: 'Mark status as completed when all episodes are watched.',
		},
		coloredBadges: {
			name: 'Colored type badges',
			desc: 'Show type and status badges with their configured colors. Disable for a plain text style.',
		},
		openAfterAdd: {
			name: 'Open watchlist after adding',
			desc: 'Jump to the watchlist tab and open the new title after adding it from the command palette.',
		},
	},
	reading: {
		main: {
			sub: 'Defaults applied when adding books and manga',
		},
		defaultStatus: {
			name: 'Default status for new entries',
			desc: 'Status pre-selected in the Add book / Add manga modal.',
		},
		subTab: {
			name: 'Default sub-tab',
			desc: 'Which sub-tab opens by default when you switch to the Reading tab.',
			books: 'Books',
			manga: 'Manga',
		},
	},
	steam: {
		missing: 'Key or Steam ID missing',
		badKey: 'Failed; check your API key',
		private: 'Profile is private; set "Game details" to Public',
		empty: 'No games on this account',
		unreachable: 'Could not reach Steam',
	},
} as const;

export default settings;

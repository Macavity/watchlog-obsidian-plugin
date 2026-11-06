import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

// Cosmetic-only: keep UI sentence-case visible without failing the lint.
// ignoreWords/ignoreRegex teach the rules this plugin's proper nouns
// (tab, modal and feature names) and format-mask placeholders; genuine
// sentence-case violations are still reported. Shared by the UI rule and the
// English locale-module rule.
const sentenceCaseOptions = {
	ignoreWords: [
		// Plugin / feature names
		'WatchLog', 'Watchlist', 'Upcoming', 'Reading', 'Cards',
		'Drafts', 'Custom', 'Lists', 'Books', 'Manga', 'Games',
		'Notes', 'Quotes', 'Regenerate', 'Settings', 'Add', 'Last',
		// External services / acronyms not in the rule defaults
		'Google', 'MAL', 'TSV', 'URLs', 'APIs', 'Steam', 'Tenrai',
		// API provider names (proper nouns)
		'RAWG', 'TMDB', 'OMDb', 'IGDB', 'Twitch', 'Jikan', 'AniList', 'MyAnimeList',
	],
	ignoreRegex: [
		'^DD/MM/YYYY$',            // date format mask
		'^https://',               // URL placeholder
		'^Season \\d',             // season-spec example placeholder
		'\\(Season 1 = color 1',    // season example inside the help text
		'"Game details" to Public', // Steam's own profile privacy wording
		// settings area: external service wording and stored status names named inside the text
		'^(Get a Web API key|Paste your Steam Web API key here|Movies & TV shows|Not a Jikan-compatible API|Register a Twitch app|— Not set —|Keep as Added)$',
		'^(Steam has no search endpoint|Missing a name\\? Use the|TMDB is used through|Anime and manga data from MyAnimeList|Create a project in the Google Cloud|RAWG also carries|IGDB authenticates through|Choose which API group|Anime API \\(|Movie / TV API \\()',
		'^(Full-width (triple|double) card: |Statuses To be released or Dropped|Calculated as: |Groups let you combine|Pinning a title moves|Open the title and click Edit|WatchLog uses a different API|Reading entries use five statuses|Books track pages read|Covers are fetched automatically|Any title with a release date)',
		'^p\\. 123',               // quote-location example placeholder
		'^APIs & Services',        // Google Cloud console path
		'"N due"',                 // N is a number placeholder
		'^\\* Last type used$',    // sentinel option; * confuses sentence-start detection
		'"Last type used"',        // quotes that sentinel option's label
		'^#\\w+$',                 // tag placeholder (#watchlog)
		'^\\d+h$',                 // duration placeholder (0h)
		'a Book or a Manga',       // stored type name quoted inside a help text
		'are both "Good"',        // default rating-tier label quoted inside a help text
		// Label values that must match stored values letter-for-letter
		'^TV Show$',
		'^Korean TV Show$',
		'^Plan to Read$',
		// Reading / Games locale leaves that the rule misreads: lowercase unit nouns that follow a number,
		// a link fragment that continues a sentence, and a hint that quotes section names
		'^pages$',
		'^words$',
		'^add your first (book|manga)$',
		'^Reorder the sections or switch them off\\. "By ',
		// list area: lowercase stat captions under a value, and quoted stored status/section names
		'^(left|watched|episodes|progress)$',
		'^Nothing to recommend; add titles to "Plan to watch" or "Watching"\\.$',
		'^Reorder the sections or switch them off\\. "By type"',
		// lists/widget areas: lowercase stat captions and relative-date words, uppercase card headers, prose naming UI terms
		'^(completed|remaining|titles completed|today|tomorrow)$',
		'^(NOW WATCHING|UPCOMING NEXT)$',
		'^Missing id field\\.$',
		'^These columns are pre-populated when creating a new list\\.',
		// airtime area: lowercase unit word that follows a number (uppercased in code), quoted section name, time zone note
		'^(day|days)$',
		'^No "Maybe" titles yet\\.',
		'^JST —$',
		'^TSV pastes into spreadsheets',
		'^Paste tab-separated values copied from a spreadsheet',
		// csv/steam areas: lowercase badge and caption, quoted dropdown/privacy names, MAL ID acronym label
		'^(duplicate|never played|\\(no title\\))$',
		'^Match each WatchLog field to a column from your CSV\\. Select "Skip"',
		'^MAL ID$',
		'^Steam returned no library\\. Your profile.s "Game details"',
		// add/edit areas: service URL example, IGDB wording, ISBN acronym, parenthesised fallback, abbreviation, quoted format examples
		'^Please enter an IMDb or TMDB URL',
		'^No IGDB credentials configured\\.',
		'^Search by title or ISBN\\.\\.\\.$',
		'^\\(untitled\\)$',
		'^Ep\\. duration \\(min\\)$',
		'^Format: "Season Name',
		'^Skip episodes: add "',
		'^Note: when adding a new season',
		// detail area: lowercase link/caption/unit words, placeholder naming MAL
		'^(show less|eps|cover art|not linked|chapters|volumes|MAL manga ID)$',
		// sweep: lowercase counter word between two numbers ("3 of 12")
		'^of$',
		// sweep: API error texts that start with a service name or quote a Google Cloud product
		'^(TMDB (token required|rejected this credential)|(RAWG|Twitch|IGDB) rejected|OMDb daily request limit|The Books API is not enabled)',
		// sweep: backup rejection reasons continue the sentence "Invalid backup file: ..."
		'^(could not parse JSON|not an object|titles are missing|reading data is missing books|games data is missing games|shared settings are missing|activity log is not a list|local settings are invalid|unsupported format|watch data is missing)',
	],
};

export default defineConfig(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				activeDocument: 'readonly',
				activeWindow: 'readonly',
				// Obsidian DOM helpers (obsidian.d.ts globals)
				createEl: 'readonly',
				createDiv: 'readonly',
				createSpan: 'readonly',
				createSvg: 'readonly',
				createFragment: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		// Options: see sentenceCaseOptions above.
		plugins: { obsidianmd },
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', sentenceCaseOptions],
			'obsidianmd/ui/sentence-case-locale-module': ['warn', sentenceCaseOptions],
			// Declarative settings API (Obsidian 1.13+) is a separate migration of the whole SettingsTab.
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	globalIgnores([
		"node_modules",
		".claude/worktrees",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"scripts",
		"test",
		"vitest.config.ts",
		"versions.json",
		"main.js",
	]),
);

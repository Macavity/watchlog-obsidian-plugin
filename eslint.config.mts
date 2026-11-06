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
		'Google', 'MAL', 'TSV', 'URLs', 'APIs', 'Steam', 'Tenrai', 'English',
		// Stored type name, Steam's privacy option and the default rating-tier label
		'Book', 'Public', 'Good',
	],
	ignoreRegex: [
		'^DD/MM/YYYY$',            // date format mask
		'^https://',               // URL placeholder
		'^Season \\d',             // season-spec example placeholder
		'\\(Season 1 = color 1',    // season example inside the help text
		'^p\\. 123',               // quote-location example placeholder
		'^APIs & Services',        // Google Cloud console path
		'"N due"',                 // N is a number placeholder
		'^\\* Last type used$',    // sentinel option; * confuses sentence-start detection
		'"Last type used"',        // quotes that sentinel option's label
		'^#\\w+$',                 // tag placeholder (#watchlog)
		'^\\d+h$',                 // duration placeholder (0h)
		// Label values that must match stored values letter-for-letter
		'^TV Show$',
		'^Korean TV Show$',
		'^Plan to Read$',
		// list area: lowercase stat captions under a value, and quoted stored status/section names
		'^(left|watched|episodes|progress)$',
		'^Nothing to recommend; add titles to "Plan to watch" or "Watching"\\.$',
		'^Reorder the sections or switch them off\\. "By type"',
		// lists/widget areas: lowercase stat captions and relative-date words, uppercase card headers, prose naming UI terms
		'^(completed|remaining|titles completed|today|tomorrow)$',
		'^(NOW WATCHING|UPCOMING NEXT)$',
		'^Missing id field\\.$',
		'^These columns are pre-populated when creating a new list\\.',
		'^TSV pastes into spreadsheets',
		'^Paste tab-separated values copied from a spreadsheet',
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

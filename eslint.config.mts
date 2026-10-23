import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

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
	...obsidianmd.configs.recommended,
	{
		// Cosmetic-only: keep UI sentence-case visible without failing the lint.
		// ignoreWords/ignoreRegex teach the rule this plugin's proper nouns
		// (tab, modal and feature names) and format-mask placeholders; genuine
		// sentence-case violations are still reported.
		plugins: { obsidianmd },
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', {
				ignoreWords: [
					// Plugin / feature names
					'WatchLog', 'Watchlist', 'Upcoming', 'Reading', 'Cards',
					'Drafts', 'Custom', 'Lists', 'Books', 'Manga', 'Games',
					'Notes', 'Quotes', 'Regenerate', 'Settings', 'Add', 'Last',
					// External services / acronyms not in the rule defaults
					'Google', 'MAL', 'TSV', 'URLs', 'APIs', 'Steam',
				],
				ignoreRegex: [
					'^DD/MM/YYYY$',            // date format mask
					'^https://',               // URL placeholder
					'^Season \\d',             // season-spec example placeholder
					'^p\\. 123',               // quote-location example placeholder
					'^APIs & Services',        // Google Cloud console path
					'"N due"',                 // N is a number placeholder
					'^\\* Last type used$',    // sentinel option; * confuses sentence-start detection
					'"Last type used"',        // quotes that sentinel option's label
					'^#\\w+$',                 // tag placeholder (#watchlog)
					'^\\d+h$',                 // duration placeholder (0h)
				],
			}],
			// Declarative settings API (Obsidian 1.13+) is a separate migration of the whole SettingsTab.
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	globalIgnores([
		"node_modules",
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

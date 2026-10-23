---
name: obsidian-plugin
description: Obsidian plugin rules for this repo. Load when touching UI, vault access, manifest.json, commands, styling, or when preparing or debugging a release.
---

# Obsidian plugin rules

Curated from `@davidvkimball/obsidian-dev-skills` 1.3.1 (plugin parts only, adapted to this repo). Each reference carries its source and changes in a header comment.

## Core rules

- Vault writes go through `vault.process` (background edits) or `fileManager.processFrontMatter` (properties); `vault.modify` only for whole-file replacement where nothing else fits. Use the `Editor` API for the active file.
- Never `innerHTML`/`outerHTML`/`insertAdjacentHTML`; build DOM with `createEl`/`createDiv`/`createSpan`.
- Everything that needs cleanup goes through `this.register*` (events, intervals, DOM events). Do not detach leaves in `onunload`.
- Command IDs are stable once released. No default hotkeys.
- `normalizePath` for every user-provided path; `vault.getFileByPath` instead of iterating all files.
- UI text is sentence case; settings headings via `setHeading`, no "settings" in a settings heading. Proper nouns go into `ignoreWords` in `eslint.config.mts`, never into an `eslint-disable`.
- No inline styles from TypeScript; put styling in `styles.css` with plugin-scoped classes, no `!important`, no `:has()`, no rules on Obsidian's global selectors.
- Prefer `activeDocument`/`activeWindow` over `document`/`window` globals (popout windows).
- Release tag = `manifest.json` version, no `v`. `main.js` is built by CI, never committed or uploaded by hand.

## References

- [plugin-guidelines.md](references/plugin-guidelines.md): the official Obsidian plugin guidelines, verbatim.
- [scorecard-compliance.md](references/scorecard-compliance.md): what the community scorecard deducts for and how to fix each signal.
- [release-process.md](references/release-process.md): versioning, cutting a release, what to do when the workflow did not fire.
- [agent-dos-donts.md](references/agent-dos-donts.md): day-to-day development and lint-fixing discipline.

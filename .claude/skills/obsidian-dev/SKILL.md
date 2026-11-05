---
name: obsidian-dev
description: Development patterns for Obsidian. Load when implementing features or following coding conventions.
---

# Obsidian Development Skill

This skill provides patterns and rules for developing Obsidian plugins.

## Purpose

To ensure consistent plugin development, proper code organization, and adherence to Obsidian's development patterns.

## Scope

This skill covers:
- Implementing new plugin features
- TypeScript/JavaScript coding conventions
- Plugin debugging and troubleshooting
- Project structure and organization

## Core Rules

- Vault writes go through `vault.process` (background edits) or `fileManager.processFrontMatter` (properties); `vault.modify` only for whole-file replacement where nothing else fits. Use the `Editor` API for the active file.
- Never `innerHTML`/`outerHTML`/`insertAdjacentHTML`; build DOM with `createEl`/`createDiv`/`createSpan`.
- Everything that needs cleanup goes through `this.register*` (events, intervals, DOM events). Do not detach leaves in `onunload`.
- Command IDs are stable once released. No default hotkeys.
- `normalizePath` for every user-provided path; `vault.getFileByPath` instead of iterating all files.
- UI text is sentence case; settings headings via `setHeading`, no "settings" in a settings heading. Proper nouns go into `ignoreWords` in `eslint.config.mts`, never into an `eslint-disable`.
- No inline styles from TypeScript; put styling in `styles.css` with plugin-scoped classes, no `!important`, no `:has()`, no rules on Obsidian's global selectors.
- Prefer `activeDocument`/`activeWindow` over `document`/`window` globals (popout windows).

## Bundled Resources

- `references/plugin-guidelines.md`: Official Obsidian plugin review guidelines
- `references/agent-dos-donts.md`: Critical development guidelines
- `references/code-patterns.md`: Implementation patterns and examples
- `references/coding-conventions.md`: Code style and organization
- `references/commands-settings.md`: Command and settings patterns
- `references/common-tasks.md`: Frequently needed operations
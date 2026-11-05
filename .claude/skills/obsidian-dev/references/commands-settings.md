<!--
Source: Based on Obsidian Sample Plugin and community plugin guidelines
Update frequency: Check Obsidian Sample Plugin repo for updates
Applicability: Plugin
-->

# Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Settings tabs

This repo targets `minAppVersion` 1.11.0, so `SettingGroup` is available without version guards, but the declarative `getSettingDefinitions()` API (Obsidian 1.13+) is not. Settings tabs implement `display()` (see `src/SettingsTab.ts`). Add `getSettingDefinitions()` only together with a `minAppVersion` bump to 1.13, or keep `display()` as the required fallback. Sentence case for all UI text (names, descriptions, headings); headings via `setHeading()`.



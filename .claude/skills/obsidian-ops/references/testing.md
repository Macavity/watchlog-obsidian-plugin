<!--
Source: https://github.com/obsidianmd/obsidian-sample-plugin, https://docs.obsidian.md/Plugins/Getting+started/Mobile+development, https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins
-->

# Testing

## Desktop

1. Symlink the repo to `<Vault>/.obsidian/plugins/<plugin-id>/` (or copy `main.js`, `manifest.json`, `styles.css`).
2. Run `pnpm dev`.
3. Enable the plugin in **Settings → Community plugins**. Reload after changes (command "Reload app without saving"), or use [Hot Reload](https://github.com/pjeby/hot-reload).
4. Use a dedicated test vault, never a production vault.

## Mobile

- Emulate from the desktop DevTools console: `app.emulateMobile(true)` (toggle back with `app.emulateMobile(false)`).
- Real devices: Android via `chrome://inspect` with USB debugging; iOS 16.4+ via Safari Web Inspector on macOS.
- Node.js/Electron APIs are unavailable on mobile; regex lookbehind is unsupported on iOS < 16.4.

## Beta testing

Distribute pre-release builds via [BRAT](https://github.com/TfTHacker/obsidian42-brat).

**Platform testing**: Before release, test on all applicable platforms (Windows, macOS, Linux, Android, iOS). See [release-readiness.md](release-readiness.md).

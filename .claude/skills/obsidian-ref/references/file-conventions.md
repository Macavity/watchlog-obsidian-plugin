<!--
Source: https://github.com/obsidianmd/obsidian-sample-plugin, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
-->

# File & folder conventions

## Repository layout

```text
src/
  main.ts          # Plugin entry: lifecycle only, delegate to modules
  settings.ts      # Settings interface, defaults, settings tab
  …                # Feature modules, one responsibility per file
styles.css         # Plugin CSS (optional, shipped with the release)
manifest.json      # Plugin manifest (see manifest.md)
versions.json      # Plugin version → minAppVersion
main.js            # Build output, gitignored, attached to releases
```

## Rules

- Keep `main.ts` small: register things in `onload()`, put logic in modules under `src/`.
- Build output (`main.js`, source maps) is never committed; it is attached to GitHub releases.
- Release assets are `main.js`, `manifest.json` and optionally `styles.css`, all at the repo root.
- Prefix CSS classes with the plugin id to avoid collisions.
- `data.json` (written by `saveData()`) lives in the vault plugin folder and is gitignored.

## In the vault

```text
<Vault>/.obsidian/plugins/<plugin-id>/
  main.js
  manifest.json
  styles.css
  data.json        # created by the plugin
```

For development, symlink the repo into this folder (a macOS Finder alias does not work).

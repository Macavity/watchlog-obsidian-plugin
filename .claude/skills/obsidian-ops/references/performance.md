<!--
Source: https://docs.obsidian.md/Plugins/Guides/Optimize+plugin+load+time, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
-->

# Performance

- **Fast `onload()`**: Only register things there. Defer heavy work to `app.workspace.onLayoutReady()`.
- **Register `vault.on("create")` inside `onLayoutReady`**: Obsidian fires `create` for every file during vault startup.
- **Light view constructors**: Restored views are constructed at startup.
- **Don't scan the vault needlessly**: Use `vault.getFileByPath()` instead of iterating `getFiles()`; prefer `metadataCache` over reading files.
- **Debounce reactions** to frequent events (`metadataCache.on("changed")`, `vault.on("modify")`, editor changes).
- **Scope DOM observers** narrowly; a subtree `MutationObserver` on a large container fires on every keystroke.
- **Clean up**: Use `registerEvent`, `registerDomEvent`, `registerInterval` and `Component` children so everything is released on unload.
- **Keep `main.js` small**: Avoid large dependencies; check bundle size after adding packages.
- Test with large vaults and on mobile devices.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Obsidian plugin (TypeScript, esbuild, vitest). Fork of WatchLog that moves tracked data from
`data.json` into vault notes so it syncs across devices. User-facing docs: `README.md`.

## Commands

```
npm run dev                          # esbuild watch -> main.js
npm run build                        # tsc -noEmit + production bundle (rewrites main.js)
npm run lint                         # eslint, fails on warnings (--max-warnings 0)
npm test                             # vitest run
npx vitest run test/DataManager.test.ts        # single file
npx vitest run -t "pattern"                    # single test by name
npm run deploy -- <vault-name>       # build + copy into a vault's .obsidian/plugins/watchlog-sync
npm version <patch|minor|major>      # bumps manifest.json + versions.json via version-bump.mjs
```

CI runs lint, test, build, then `git diff --exit-code -- main.js`: **`main.js` is committed and must
match the source.** After changing anything under `src/`, run `npm run build` and commit `main.js`
together with the change.

Install with plain `npm ci`/`npm install`. Do not use `--legacy-peer-deps` (it drops `@eslint/json`).

## Tests

- `vitest.config.ts` aliases the `obsidian` module to `test/obsidianStub.ts`; `test/fakes/fakeApp.ts`
  is an in-memory App (vault + metadataCache, async event firing). Extend these stubs when a test
  needs more Obsidian surface instead of mocking per test.
- `test/helpers/setup*.ts` build the managers against FakeApp; start new manager tests from them.
- `test/` and `vitest.config.ts` are excluded from ESLint.

## Storage model
The note is the record. Every user-entered value lives in a note's YAML frontmatter under one root
folder; the note path is the key (no separate id). Three stores with strict boundaries:

- `src/storage/LocalStore.ts` – `data.json` via `plugin.saveData`. Device-local only: API keys,
  Steam id, API cache, colors, layout, filters, drafts state, schema version. Never written into
  the vault (holds secrets); losing it must never lose user data.
- `src/storage/SharedConfigStore.ts` – `WatchLog.base`, top-level `watchlog:` block. Only keys in
  `SHARED_SETTING_KEYS` / `NESTED_SHARED_KEYS` sync; adding a shared setting means adding it there.
  `src/settingsSplit.ts` splits the settings object between local and shared.
- `src/storage/HistoryStore.ts` – `History.md`, append-only shared activity log.

`src/storage/VaultLayout.ts` resolves the root: the folder of the first `.base` file with a
`watchlog:` key (there is no `rootFolder` setting anymore). Entries are the `.md` files directly in
`<root>/<type>/`, `Books/`, `Manga/`, `Games/`. `EntryIndex` watches metadataCache and feeds
`DataManager` (watchlist), `ReadingDataManager`, `GameDataManager`. Frontmatter <-> entry mapping
lives in `storage/titleCodec.ts`, `readingCodec.ts`, `gameCodec.ts`; change a codec and its test
together, and remember keys missing from an encode must be actively deleted from the note.

`storage/migrateV1.ts` converts the original plugin's `data.json` (schema 1) into notes; `LocalStore`
refuses to write while on schema 1 or a newer schema.

## Conventions

- UI strings are sentence case (`obsidianmd/ui/sentence-case`, warn level but CI fails on warnings).
  Proper nouns go into the `ignoreWords` list in `eslint.config.mts`, not into disabled lines.
- Design notes and the execution plan for the vault-storage rewrite are in `.claude/specs/` and
  `.claude/plans/` (German). The plan is authoritative where it and the spec differ.

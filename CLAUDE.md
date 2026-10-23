# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Obsidian plugin (TypeScript, esbuild, vitest). Fork of WatchLog that moves tracked data from
`data.json` into vault notes so it syncs across devices. User-facing docs: `README.md`.

## Commands (pnpm)

```
pnpm install --frozen-lockfile
pnpm dev                              # esbuild watch -> main.js
pnpm build                            # tsc -noEmit + production bundle
pnpm lint                             # eslint, fails on warnings (--max-warnings 0)
pnpm test                             # vitest run
pnpm vitest run test/DataManager.test.ts        # single file
pnpm vitest run -t "pattern"                    # single test by name
pnpm run deploy -- <vault-name>       # build + copy into a vault; "run" needed, "pnpm deploy" is a builtin
pnpm version <patch|minor|major>      # bumps manifest.json + versions.json, commits, tags
pnpm fallow:audit                     # code-health gate for changed files, run before every commit
pnpm fallow:report                    # whole-repo fallow report + health score, never a gate
```

`main.js` is build output and not tracked. CI runs lint, test and build on every push and PR,
plus `fallow audit` on PRs.

## Git

`git push`, opening a PR and merging into `main` each need the user's explicit go-ahead in the
conversation. Commits on a feature branch are fine. Never chain a push with other commands.
Never post comments on GitHub (PRs, issues, reviews) on the user's behalf; everything written
there goes through the user's account and must come from them.

## Code health

`pnpm fallow:audit` must be green before a commit. It gates only findings the change introduces
(duplication, unused exports/members, complexity); inherited debt in touched files is shown but
not enforced, and is being reduced separately. Fixes, in this order: introduced duplication means
extract a shared helper; dead code means remove it (check with `fallow dead-code --trace
<file>:<export>` first); complexity means split the function or write a test for it (test
reachability lowers the estimated CRAP score). Suppressions, inline
(`// fallow-ignore-next-line <rule>` with a reason) or in `.fallowrc.jsonc`, only with the user's
explicit go-ahead in the conversation. fallow is pinned exactly; when bumping it, repeat the probe
from `.fallowrc.jsonc` (a copied file must fail the audit).

## Releases

Tag equals the manifest version, no `v` prefix. The release workflow builds `main.js`, attests it
and publishes the release with `main.js`, `manifest.json`, `styles.css`. Release notes are the
`## [<version>]` section of `CHANGELOG.md`, so write that section first.

```
pnpm version patch        # or minor / major
git push origin main      # commits first
git push origin 4.0.1     # tag separately, a few seconds later (a combined push can drop the trigger)
```

Recovery steps when the workflow did not fire:
`.claude/skills/obsidian-plugin/references/release-process.md`.

Obsidian plugin rules (vault API, UI text, styling, scorecard) live in the `obsidian-plugin` skill
under `.claude/skills/`.

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
- `.claude/specs/` and `.claude/plans/` are local working files (gitignored, German); they are not
  present on a fresh clone.

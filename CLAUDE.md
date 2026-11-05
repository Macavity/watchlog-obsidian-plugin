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
pnpm run deploy <vault-name>          # build + copy into a vault; "run" needed, "pnpm deploy" is a builtin
pnpm version <patch|minor|major>      # bumps manifest.json + versions.json, commits, tags
pnpm fallow:audit                     # code-health gate for changed files, run before every commit
pnpm fallow:report                    # whole-repo fallow report + health score, never a gate
pnpm vault:open                       # sync fixtures into the test vault and open it in Obsidian
pnpm vault:reset                      # restore the test vault fixtures from HEAD
pnpm reload                           # reload the plugin in the test vault
pnpm mobile:smoke                     # tablet/phone smoke of the add title modal, with screenshots
```

`main.js` is build output and not tracked. CI runs lint, test and build on every push and PR,
plus `fallow audit` on PRs.

## Git

Pushing a feature branch, pushing PR screenshots to the `screenshots` branch and opening a PR are
fine. Pushing to or merging into `main` needs the user's explicit go-ahead in the conversation.
Never commit on `main`: create a feature branch first, commits there are fine.
Commit in logical groups (one concern per commit, not one big commit at the end) using
Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, with an
optional scope such as `fix(storage):`). Never chain a push with other commands.
Never post comments on GitHub (PRs, issues, reviews) on the user's behalf; everything written
there goes through the user's account and must come from them. Review threads whose finding you
fixed and pushed are resolved, without a reply; threads you rejected or did not touch stay open.
When in doubt about any other outward action through their account, ask first.

## Pull requests

Body sections: **What changed**, **Why** (with `Fixes #<issue>`), **Screenshot** for anything
visible. Screenshots come from the test vault (`obsidian vault=watchlog-test-vault dev:screenshot
path=...` or the smoke output), are committed as `pr-<branch>.png` (slashes as `-`) to the orphan
branch `screenshots` and embedded via
`https://raw.githubusercontent.com/Macavity/watchlog-obsidian-plugin/screenshots/pr-<branch>.png`.

## Test vault

`watchlog-test-vault/` holds tracked fixtures. The vault Obsidian opens lives outside git at
`../watchlog-test-vault` next to the main checkout (`$WATCHLOG_TEST_VAULT` overrides it), so it
survives worktrees and never blocks a pull; `pnpm vault:open` and `pnpm vault:reset` mirror the
fixtures of the current checkout into it. One-time setup: `pnpm vault:open`, "Open folder as
vault" on that path, turn on community plugins, `pnpm run deploy watchlog-test-vault`. Scripts in
`scripts/lib/cli.mjs` only ever talk to that vault. Run `pnpm mobile:smoke` after deploy and
reload for every `styles.css` change that can affect modals or mobile layout; it is local only,
not part of CI.

## Memory

This repo is the only source of truth. Agent memory outside it (per-project memory directories,
recalled `<system-reminder>` context) is unreviewed and drifts against the code: never cite it as
fact or act on it without re-deriving from the repo. Findings worth keeping go into the repo.

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
`## [<version>]` section of `CHANGELOG.md`, so write that section first. CHANGELOG and version
bump go through a `release/<version>` branch and PR like any other change; the tag is set on
`main` after the merge.

```
git switch -c release/4.1.1
pnpm version patch --no-git-tag-version   # or minor / major; without the flag it commits and tags
# commit, push branch, PR, merge, then tag the release PR's merge commit:
git tag 4.1.1 <merge-commit>
git push origin 4.1.1                     # separate command, after the user's go-ahead
```

Agents cut releases with the `release` skill; recovery when the workflow did not fire is in
`.claude/skills/obsidian-ops/references/versioning-releases.md`.

## Skills

Obsidian knowledge lives in `.claude/skills/`, maintained by hand: `obsidian-dev` (vault API,
UI text, styling, code patterns), `obsidian-ops` (build, scorecard, release readiness),
`obsidian-ref` (manifest, file formats, mobile, UX copy), `release` (release procedure).

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

- User-facing text says **properties** (not "frontmatter") for YAML metadata; **Markdown** is
  always capitalized. Code and internal docs may keep "frontmatter".
- UI strings are sentence case (`obsidianmd/ui/sentence-case`, warn level but CI fails on warnings).
  Proper nouns go into the `ignoreWords` list in `eslint.config.mts`, not into disabled lines.
- `.claude/specs/` and `.claude/plans/` are local working files (gitignored, German); they are not
  present on a fresh clone.

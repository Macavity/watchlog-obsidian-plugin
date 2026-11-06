---
name: release
description: Use when cutting a new release of this plugin — picking the next version, checking the code is release-ready, bumping, tagging and publishing through GitHub. Triggers on "release", "cut a release", "publish a new version", "bump the version", "tag 4.x.y", "what version should the next release be", "is this ready to release". Löst auch auf Deutsch aus - "Release machen", "neue Version veröffentlichen", "Version hochziehen", "welche Version", "können wir releasen".
---

# Release

The GitHub workflow `.github/workflows/release.yml` builds, attests and publishes on a tag push. This skill covers everything before that push and the check afterwards. Background on the mechanism: `.claude/skills/obsidian-ops/references/versioning-releases.md`.

Three facts drive every step. Never work around them.

1. **The release notes are the `## [<version>]` section of `CHANGELOG.md`.** The workflow extracts that section; when it is missing it warns and falls back to GitHub-generated notes. Commit messages play no role. A release without a section is the user's explicit choice (a quick hotfix), never a default.
2. **The tag equals `manifest.json`'s `version`, no `v` prefix.** The workflow fails otherwise. `.npmrc` sets `tag-version-prefix=""`, so `pnpm version` tags correctly.
3. **Nothing is committed on `main`.** CHANGELOG, README and the version bump go on a `release/<version>` branch and reach `main` through a PR. The tag is set afterwards on `main`'s merge result. So `pnpm version` always runs with `--no-git-tag-version`; without it, it commits and tags on its own.

## 1. Preconditions

Run all of these; a failed one stops the release until fixed.

```bash
git fetch origin
git switch main && git pull --ff-only
git status --short            # must be empty
gh pr list --state open       # releases wait for nothing that should be in them
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

- Release only from `main`, never from a feature branch. The community directory reads `manifest.json` from the head of the default branch.
- Dirty working tree or a checked-out feature branch: those changes are not part of the release. Ask the user whether to commit them on their branch, stash them, or leave them out, before switching to `main`.
- Compare against `origin/main`, not a stale local view.
- Zero commits since the last tag → nothing to release. Say so and stop.

## 2. Pick the version

Base the proposal on **user-visible change**, not commit subjects. Read the diff since the last tag:

```bash
LAST=$(git describe --tags --abbrev=0)
git diff --stat "$LAST"..HEAD -- src styles.css manifest.json README.md
git diff "$LAST"..HEAD -- manifest.json README.md
```

| Change since last tag | Bump |
| --- | --- |
| Breaks stored data (note properties, `WatchLog.base`, `History.md`, `data.json` schema) without migration, or removes a setting or command | **major** |
| New feature, new user-facing behaviour, migrated data shape, `minAppVersion` raised | **minor** |
| Only fixes, docs, tooling, refactors | **patch** |

Present the version with the two or three changes that justify it, and wait for the user's confirmation. Never bump before that.

## 3. Gate

All of it, every release, no matter how small the diff. CI ran on the PR, but the merge commit on `main` is a different tree.

```bash
git rev-parse HEAD            # note this as GATED: the tree the gate and notes cover
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm fallow:report            # informational, not a gate
```

Then the automated section of `.claude/skills/obsidian-ops/references/release-readiness.md`: files at root, manifest consistent, no stray console output, README disclosures (network use: the services in the README's APIs table). Report each item as pass or fail with a concrete fix. The interactive pre-release items (desktop platforms, large vault, mobile/tablet layout, a real phone or tablet via a synced test vault) are a question to the user, not assumed.

A gate failure is fixed in its own `fix:` branch and PR before the release, or the release is called off.

## 4. CHANGELOG and README

**CHANGELOG.md** (Keep a Changelog style as used in this file: `## [<version>] - <YYYY-MM-DD>`, subsections `##### Added`, `##### Changed`, `##### Fixed`, `##### Removed`, `*` bullets, only subsections with content). If an `## [Unreleased]` section exists, compare it against the diff from step 2 and rename it; otherwise write the section. Every user-visible change since the last tag must be listed, nothing else (no refactors, tooling, fallow cleanups). Written for a plugin user, present tense, no commit hashes.

**README.md**. For each item in the new section, check that the README still describes the behaviour correctly ("Where your data lives", "Set up the APIs", "Worth knowing", screenshots). Fix what is stale. "The README was updated in the feature PR" is a claim to verify by reading.

Show the finished CHANGELOG section and any README diff to the user together with the version.

## 5. Release branch and bump

Only after the user confirmed version, CHANGELOG section and README changes. Work on a branch; never commit on `main`.

```bash
git switch -c release/<version>
git add CHANGELOG.md README.md
git diff --cached --quiet || git commit -m "docs: changelog for <version>"   # skipped for an approved hotfix without changelog or README change
pnpm version <patch|minor|major> --no-git-tag-version
git add package.json manifest.json versions.json
git commit -m "chore(release): <version>"
```

Check: `git show --stat HEAD` lists only `package.json`, `manifest.json`, `versions.json`, and `git tag --list <version>` is empty.

## 6. PR, merge, tag

Each outward step needs the user's explicit go-ahead (`CLAUDE.md`): push the branch, open the PR, merge it. Ask for each, naming the version.

```bash
git push -u origin release/<version>
```

```bash
gh pr create --base main --title "chore(release): <version>" --body "<the CHANGELOG section>"
```

Merge the release PR as a **merge commit** (`gh pr merge --merge`, or "Create a merge commit" in the UI), like every other PR in this repo. Never a rebase merge: it puts each release commit on `main` separately, `mergeCommit` is then the last of them and `$MERGE^1` is the previous release commit, not the old `main`, so the check below fails.

After the user merged the PR (or told you to merge it), tag the PR's merge commit, not whatever `main` points at now. Another PR may have merged in between; its changes are not in the approved notes or the gate. Tagging is not a commit on `main`:

```bash
git switch main && git pull --ff-only
MERGE=$(gh pr view release/<version> --json mergeCommit -q .mergeCommit.oid)
git rev-parse HEAD                      # compare with $MERGE
git log --oneline <GATED>.."$MERGE"^1   # merged between the gate and the release PR: must be empty
git log --oneline "$MERGE"..HEAD        # merged after the release PR: not part of this release
git log --oneline "$MERGE"^1.."$MERGE"  # the release commits only; $MERGE^1 is main before the PR
git show "$MERGE":manifest.json | jq -r .version   # must equal <version>
git tag <version> "$MERGE"
```

`$MERGE^1` is `main` just before the release PR landed, so the first list holds commits that reached `main` after the gate and are inside `$MERGE`, but were neither gated nor described. If it is not empty, stop: tell the user, update the CHANGELOG and rerun the gate on a new release branch. Commits in the second list came after `$MERGE`; tag `$MERGE` anyway and tell the user they are not part of this release.

Pushing the tag publishes the release; ask once more, then push it on its own:

```bash
git push origin <version>
```

Then verify, do not assume:

```bash
gh run list --workflow=release.yml -L 1
gh run watch                   # until the run completes
gh release view <version>      # title = version, assets main.js, manifest.json, styles.css, body = CHANGELOG section
```

Workflow did not fire: follow "Pushing tags so the workflow actually fires" in `versioning-releases.md` (run the workflow from the Actions tab with the **tag** as ref; branch refs are rejected). Never create the release by hand as a first resort; that skips the build attestation.

Report the release URL and the asset list to the user.

## Rationalizations that end releases badly

- "Tiny change, skip the gate." The gate runs on every release. Skip only on the user's instruction, and say so.
- "I'll write the notes into the tag or commit message instead." The workflow reads only `CHANGELOG.md`.
- "It's a hotfix, skip the changelog." Only when the user says so; one `##### Fixed` line takes a minute.
- "The README was touched in the PR, it's current." Read the sections named in step 4 against the change.
- "It's only the version bump, I'll commit it on `main`." Never; release branch and PR.
- "I'll tag the release branch, it has everything." Tags go on the release PR's merge commit on `main`.
- "The user said release, that covers the push." Version, CHANGELOG and README are confirmed first; the push is confirmed separately.
- "CI was green on the PR." The merge commit is a different tree; run the gate on `main`.

Red-flag phrases: "should be fine", "I'll just", "basically the same as the PR", "no need to wait for the run".

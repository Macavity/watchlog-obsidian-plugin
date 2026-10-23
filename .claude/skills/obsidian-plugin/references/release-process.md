<!--
Source: @davidvkimball/obsidian-dev-skills 1.3.1 (obsidian-ops/references/versioning-releases.md), copied 2026-10-23.
Changes: plugin part only; workflow block replaced by this repo's draft-release flow; theme section dropped; pnpm version used for bumping.
Re-sync: pnpm pack @davidvkimball/obsidian-dev-skills into a temp dir and diff.
-->

# Versioning & releases

- Versions follow SemVer. `manifest.json` is the source of truth; `versions.json` maps plugin version → `minAppVersion`.
- The GitHub release tag must equal `manifest.json`'s `version` exactly. **No leading `v`.**
- Release assets: `main.js`, `manifest.json`, `styles.css` as individual files. `main.js` is not tracked in git; the workflow builds it.
- `.github/workflows/release.yml` runs on tag push (and manually via `workflow_dispatch`), builds with pnpm on Node 22, fails if tag ≠ manifest version, attests build provenance and creates a **draft** release with the three assets.

## Cutting a release

```bash
pnpm version patch            # or minor / major; runs version-bump.mjs, commits manifest.json + versions.json, tags
git push origin main          # commits first
git push origin <version>     # tag in a separate command, a few seconds later
```

Then open the draft release on GitHub, paste the matching section from `CHANGELOG.md` as notes, and publish.

Push order matters: pushing commits and tags in one batch (`--follow-tags`, `--tags`, some GUIs) occasionally lets GitHub process the tag webhook before it has indexed the workflow at that ref, and the trigger silently drops.

## When the workflow did not fire

```bash
gh run list --workflow release.yml -L 5
gh api repos/:owner/:repo/actions/runs --jq '.workflow_runs[0:5] | .[] | {id, event, status, conclusion, head_branch, created_at}'
```

Recovery, in order of preference:

1. Run the workflow from the Actions tab (`workflow_dispatch`) on the tagged commit.
2. Re-push the tag: `git push origin :refs/tags/<version> && git push origin <version>`.
3. Create the release by hand in the GitHub UI. It then lacks the provenance attestation, which costs scorecard points until the next release.

## Reproducibility

The scorecard rebuilds `main.js` from the tagged source and compares it byte for byte with the release asset. Keep it reproducible: production build without sourcemap (already the case in `esbuild.config.mjs`), `pnpm-lock.yaml` committed, `pnpm install --frozen-lockfile` and a pinned Node version in the workflow, never hand-edit or hand-upload `main.js`.

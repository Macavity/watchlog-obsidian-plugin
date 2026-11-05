<!--
Source: https://github.com/obsidianmd/obsidian-sample-plugin, https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions, https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
-->

# Versioning & releases

**Before releasing**: Use the [release-readiness.md](release-readiness.md) checklist.

- Bump the version on a `release/<version>` branch with `pnpm version <patch|minor|major> --no-git-tag-version`. This updates `package.json` and runs `version-bump.mjs` (writes `manifest.json`, adds a key to `versions.json`); commit it, merge via PR, then tag `main`. Nothing is committed on `main` directly.
- The GitHub release tag must equal `manifest.json`'s `version` exactly. No leading `v`.
- Attach `main.js`, `manifest.json` and `styles.css` (if present) as individual release assets.
- First publication: submit the plugin via the [community directory](https://community.obsidian.md/) (sign in, link GitHub, add the plugin). The directory reads `manifest.json` from the HEAD of the default branch and runs an automated review; fix findings by publishing a new release.

### Automated releases with build provenance attestation

The community scorecard penalizes releases whose assets lack a GitHub artifact attestation. This repo's `.github/workflows/release.yml` handles it: on a tag push (or manual `workflow_dispatch`) it installs with pnpm, runs `pnpm build`, reads the version from `manifest.json`, attests the assets with `actions/attest-build-provenance`, and creates or updates the release.

**Tag and manifest must agree**: the workflow runs on a tag push or a manual `workflow_dispatch`. Its first step rejects branch refs, so a manual run must select the tag. It then compares the tag with `manifest.json`'s `version` and fails on a mismatch, because Obsidian's plugin loader reads the manifest.

**Why the release notes come from `CHANGELOG.md` instead of `--generate-notes` or the commit message**: `--generate-notes` produces a PR list plus compare link with no context, and the commit history is not curated enough to serve as notes. The workflow extracts the `## [<version>]` section from `CHANGELOG.md` (Keep a Changelog format) and warns when that section is missing; it then falls back to GitHub-generated notes.

Cut releases by pushing a tag on `main` after the release PR is merged. The workflow attaches the three required assets and registers the attestation. The scorecard's "Build verified" signal also fires once the workflow has run, because the attested artifacts can be reproduced byte-for-byte from source.

For the full set of scorecard signals and their fixes, see [scorecard-compliance.md](scorecard-compliance.md).

### Pushing tags so the workflow actually fires

Push the tag on its own, after the release PR is merged and `main` is pulled. Never batch it with other refs (`git push --tags --follow-tags` or some GUIs): GitHub occasionally processes the tag webhook before indexing the workflow file at that ref, and the trigger silently drops.

```bash
git switch main && git pull --ff-only
git tag 4.1.1
git push origin 4.1.1            # tag in a separate command
```

If the workflow does not fire on a tag push, diagnose with:

```bash
gh api repos/:owner/:repo/actions/runs --jq '.workflow_runs[0:5] | .[] | {id, event, status, conclusion, head_branch, created_at}'
gh workflow list
gh api repos/:owner/:repo/actions/permissions/workflow
```

If `gh api .../runs` is empty for the tag, the trigger was dropped. Recovery options:

- **Run the workflow from the Actions tab** (`workflow_dispatch`) and pick the **tag** as the ref; branch refs are rejected by the first step.
- **Re-push the tag**: `git push origin :refs/tags/<version>`, then `git push origin <version>` in a separate command.
- **Manually create the release** in the GitHub UI. The release will exist but it will not have the build provenance attestation, which costs scorecard points until the next release.

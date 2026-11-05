<!--
Source: Condensed from the other references in this skill set
-->

# Quick Reference

One-page cheat sheet for this plugin.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Watch build | `pnpm dev` |
| Production build + type check | `pnpm build` |
| Lint | `pnpm lint` / `pnpm eslint . --fix` |
| Test | `pnpm test` |
| Code health | `pnpm fallow:audit` (gate) / `pnpm fallow:report` |
| Deploy to a vault | `pnpm run deploy -- <vault-name>` |
| Bump version | `pnpm version patch\|minor\|major --no-git-tag-version` on a `release/<version>` branch (updates `package.json`, `manifest.json`, `versions.json`) |
| Look up API | search `node_modules/obsidian/obsidian.d.ts` |

## Shortcuts for agents

- `release` → use the `release` skill
- `release ready?` → run the checklist in [release-readiness.md](release-readiness.md)
- `summarize` / `summarize for release` → see [summarize-commands.md](summarize-commands.md)

## File paths

```text
<Vault>/.obsidian/plugins/<plugin-id>/
  ├── main.js
  ├── manifest.json
  └── styles.css
```

## Release

1. `pnpm lint`, `pnpm test`, `pnpm build` pass, [release-readiness.md](release-readiness.md) checked, `CHANGELOG.md` section written
2. On `release/<version>`: `pnpm version <patch|minor|major> --no-git-tag-version`, commit, PR, merge; then `git tag <version>` on `main`
3. Push commits, then push the tag separately (tag = `manifest.json` version, no `v`)
4. `.github/workflows/release.yml` builds, attests and attaches the assets

Details: [versioning-releases.md](versioning-releases.md).


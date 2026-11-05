<!--
Source: https://docs.obsidian.md/Reference/Manifest, https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
-->

# Manifest rules (`manifest.json`)

## Fields (plugins)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Only lowercase letters and hyphens. Must not contain `obsidian`, must not end with `plugin`. Should match the plugin folder name. Never change it after release. |
| `name` | string | yes | Short, English, Basic Latin, no emoji. Only hyphens, plus and parentheses as punctuation. No "Obsidian" variations, must not match a core feature. |
| `version` | string | yes | SemVer `x.y.z`. Must equal the GitHub release tag (no leading `v`). |
| `minAppVersion` | string | yes | Minimum Obsidian version the plugin works with. If unsure, use the latest stable build. |
| `description` | string | yes | See rules below. |
| `author` | string | yes | |
| `isDesktopOnly` | boolean | yes | Must be `true` if the plugin uses Node.js or Electron APIs. |
| `authorUrl` | string | no | |
| `fundingUrl` | string or object | no | Only for financial support (GitHub Sponsors, Buy Me A Coffee, …). Object form: `{ "Label": "url" }`. Remove if you don't accept donations. |

## Description rules

- Max. 250 characters, ends with a period.
- Start with an action statement ("Translate selected text into…"), not "This is a plugin…".
- No emoji or special characters.
- Correct capitalization of proper nouns and acronyms ("Obsidian", "Markdown", "PDF").
- Follows the [Obsidian style guide](https://help.obsidian.md/Contributing+to+Obsidian/Style+guide).

## `versions.json`

Maps plugin versions to the `minAppVersion` they need, so older Obsidian installs can fall back to a compatible release. `pnpm version <patch|minor|major> --no-git-tag-version` runs `version-bump.mjs`, which updates `manifest.json` and adds the new version to `versions.json`.

## Validation checklist

- [ ] All required fields present, valid JSON
- [ ] `id` and `name` follow the rules above, `id` matches folder name
- [ ] `version` is SemVer and equals the release tag
- [ ] `description` follows the rules above
- [ ] `isDesktopOnly` is `true` if any Node.js/Electron API is used
- [ ] `fundingUrl` only present if donations are accepted

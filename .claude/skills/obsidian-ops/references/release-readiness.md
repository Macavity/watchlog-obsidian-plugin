<!--
Source: https://docs.obsidian.md/community-directory/developer-policies, https://docs.obsidian.md/community-directory/submission-requirements-for-plugins, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines, https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
-->

# Release Readiness Checklist

Use this when preparing a release or when asked "is the plugin ready for release?".

## Quick Reference

- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) (local summary: [plugin-guidelines.md](../../obsidian-dev/references/plugin-guidelines.md))

## Automated Checks (agent can verify)

### Files

- [ ] `manifest.json`, `README.md`, `LICENSE` at the repo root
- [ ] `pnpm build` produces `main.js` without errors
- [ ] `styles.css` present if the plugin ships CSS

### Manifest

- [ ] Passes the checklist in [manifest.md](../../obsidian-ref/references/manifest.md)
- [ ] `version` in `manifest.json` and `package.json` match, and `versions.json` has a key for it
- [ ] `isDesktopOnly: true` if any Node.js/Electron API is used (grep for `fs`, `path`, `electron`, `require(`)

### Code

- [ ] `pnpm lint` passes with zero warnings (same rules as the review bot)
- [ ] No sample/placeholder code left (`MyPlugin`, `SampleSettingTab`, demo commands)
- [ ] Command IDs don't include the plugin ID (Obsidian prefixes them)
- [ ] No `innerHTML`/`outerHTML`/`insertAdjacentHTML` with untrusted input
- [ ] Everything registered in `onload()` is cleaned up on unload
- [ ] No unnecessary console output

### Policies

- [ ] No obfuscated code, no client-side telemetry, no dynamic ads, no self-updating
- [ ] README discloses, if applicable: payment, account requirement, network use (which services, why), file access outside the vault, static ads, server-side telemetry (with privacy policy link)
- [ ] LICENSE present; third-party code licenses respected and attributed in README
- [ ] "Obsidian" not used in a way that suggests a first-party plugin

### README

- [ ] Explains what the plugin does and how to use it (excerpts appear in the directory)
- [ ] Screenshots or GIFs for UI features (recommended)

## Interactive Checks (ask the user)

Before the release:

- [ ] Tested on Windows / macOS / Linux as applicable
- [ ] Tested with a large vault and with other plugins disabled
- [ ] Mobile and tablet layout checked (the plugin ships a mobile toolbar), or `isDesktopOnly: true`
- [ ] Tested on Android / iOS: `pnpm run deploy <vault-name>` copies the build into a synced test vault, so a phone or tablet gets it before publication

After the release:

- [ ] Release created with tag = version, assets `main.js`, `manifest.json`, `styles.css` attached individually
- [ ] Installed from the release on one device to confirm the published assets; a regression found there gets a patch release

## Agent workflow

1. Run the automated checks, report pass/fail/warning per item with concrete fixes.
2. Ask the interactive questions.
3. If ready, continue with [versioning-releases.md](versioning-releases.md).

## Related Documentation

- [versioning-releases.md](versioning-releases.md)
- [security-privacy.md](security-privacy.md)
- [scorecard-compliance.md](scorecard-compliance.md)
- [testing.md](testing.md)
- [ux-copy.md](../../obsidian-ref/references/ux-copy.md)

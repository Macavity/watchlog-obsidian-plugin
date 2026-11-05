# Contributing

Thanks for your interest in contributing. This document describes how to report issues, propose changes, and get a local development environment running.

## Reporting issues

- Search [existing issues](../../issues) before opening a new one.
- For bugs, include: Obsidian version, plugin version, operating system, reproduction steps, and what you expected vs. what happened. Screenshots or a short screen recording help.
- For feature requests, describe the use case and the problem the feature would solve, not just the proposed solution.

## Development setup

Requirements:

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/). This repo pins a specific version via `packageManager` in `package.json`.

```bash
pnpm install
pnpm dev      # watch mode build
pnpm build    # typecheck + production build
pnpm lint     # check code style, fails on warnings
pnpm test     # unit tests (vitest)
```

`main.js` is built at the repo root and is not tracked. `pnpm run deploy -- <vault-name>` builds and copies `main.js`, `manifest.json` and `styles.css` into a registered vault. Use a test vault, not your working vault.

## Code quality

[Fallow](https://fallow.tools) measures dead code, duplication and complexity; the policy lives in `.fallowrc.jsonc`.

- `pnpm fallow:audit` checks the files you changed and fails on findings your change introduces. CI runs it on every pull request.
- `pnpm fallow:report` shows the whole-repo report; it is informational.
- Handle findings by fixing the code: extract a shared helper for duplication, remove dead code, split complex functions or add tests for them. Suppressions need a maintainer's approval.

## Pull requests

- Open an issue first for anything non-trivial so we can agree on direction before you spend time on it.
- Keep PRs focused. One concern per PR is easier to review.
- Run `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm fallow:audit` before submitting; CI runs these too.
- Follow the existing code style. Use **"properties"** (not "frontmatter") in user-facing text when referring to YAML metadata. **"Markdown"** is always capitalized. UI text is sentence case.
- Update the README if you change user-facing behavior, and add a line to `CHANGELOG.md`.

## Code style

- TypeScript strict mode, no `any` unless unavoidable.
- Prefer Obsidian's API (`Vault`, `MetadataCache`, `FileManager`) over Node `fs` for vault access.
- Network requests only to the services listed in the README's APIs section, and only for the features that need them.
- API keys and other secrets stay in the plugin's `data.json`; never write them into the vault.

## Releases

Maintainers cut releases on a `release/<version>` branch: update `CHANGELOG.md`, run `pnpm version <patch|minor|major> --no-git-tag-version` (updates `package.json`, `manifest.json` and `versions.json`), merge via pull request, then tag the result on `main` with the bare version and push the tag. The release workflow builds and attaches `main.js`, `manifest.json` and `styles.css` with build provenance attestation and uses the version's `CHANGELOG.md` section as the release notes.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

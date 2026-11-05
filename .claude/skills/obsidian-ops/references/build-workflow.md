<!--
Source: this repo's package.json and esbuild.config.mjs
-->

# Build Workflow

After any code change, run:

```bash
pnpm build   # tsc --noEmit (type check) + esbuild production build → main.js
pnpm lint    # must pass with zero warnings
```

During development, `pnpm dev` rebuilds `main.js` on every change (with inline source maps). Reload the plugin in Obsidian afterwards.

## What the build does

- `tsc -noEmit -skipLibCheck`: type check only, no output.
- `node esbuild.config.mjs build`: bundles `src/main.ts` into `main.js` at the repo root.
- `main.js` is gitignored; releases attach it as an asset.

## Lint

`pnpm lint` runs ESLint with `eslint-plugin-obsidianmd` and `--max-warnings 0`; `obsidianmd/ui/sentence-case` is a warning that still fails the run. Proper nouns go into `ignoreWords` in `eslint.config.mts`, never into an `eslint-disable`.

## Code health

`pnpm fallow:audit` gates the findings a change introduces (duplication, dead code, complexity) and must be green before every commit; `pnpm fallow:report` is the whole-repo report and never a gate. See the Code health section of `CLAUDE.md`.

## Automated Workflow

1. Make the code change
2. **Immediately run `pnpm build`, `pnpm lint` and `pnpm test`**
3. Fix errors, repeat until both pass
4. Then test in Obsidian

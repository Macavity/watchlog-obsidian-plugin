<!--
Source: https://github.com/obsidianmd/obsidian-sample-plugin, this repo's package.json
-->

# Environment & tooling

- **Node.js** LTS (CI uses Node 22) and **pnpm** (version pinned via `packageManager` in `package.json`).
- **TypeScript** with `tsconfig.json` (`strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`). Source lives in `src/`.
- **esbuild** bundles `src/main.ts` into `main.js` (CJS, `es2018`). `obsidian`, `electron`, `@codemirror/*`, `@lezer/*` and Node builtins are external; Obsidian provides them at runtime.
- **ESLint 9** with `eslint-plugin-obsidianmd`, the same rules the community review bot applies.
- **API types** come from the `obsidian` npm package (`node_modules/obsidian/obsidian.d.ts`).

## Commands

```bash
pnpm install
pnpm dev        # watch build, inline source maps
pnpm build      # tsc --noEmit + production build
pnpm lint       # eslint, fails on warnings
pnpm test       # vitest
pnpm fallow:audit
```

## Runtime constraints

- Plugins run in Obsidian's Electron renderer on desktop and in a WebView on mobile. Node.js and Electron APIs exist only on desktop.
- No network access unless essential and disclosed (see [security-privacy.md](../../obsidian-ops/references/security-privacy.md)).

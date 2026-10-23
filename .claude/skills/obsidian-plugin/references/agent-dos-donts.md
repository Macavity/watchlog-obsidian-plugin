<!--
Source: @davidvkimball/obsidian-dev-skills 1.3.1 (obsidian-dev/references/agent-dos-donts.md), copied 2026-10-23.
Changes: removed .ref folder setup, pnpm build reminder, summarize/release-readiness workflows, the no-git-operations policy and links to files not copied here.
Re-sync: pnpm pack @davidvkimball/obsidian-dev-skills into a temp dir and diff.
-->

# Agent do/don't

## Do
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.
- Run `pnpm build` after changes that touch types or imports; `tsc -noEmit` is part of it and catches what vitest does not.

## Don't
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Fixing linting errors

**Do**:
- Read the error message carefully; note the exact line and column.
- Understand what the rule is actually complaining about; see [scorecard-compliance.md](scorecard-compliance.md) for the common `obsidianmd/*` and `@typescript-eslint/*` rules.
- Fix the root cause, not the symptom.
- Run `pnpm lint` after each fix and confirm `pnpm build` still works.

**Don't**:
- Add `eslint-disable` comments without understanding why. Never disable `obsidianmd/ui/sentence-case`; add proper nouns to `ignoreWords` in `eslint.config.mts` instead.
- Put disable comments on the wrong line.
- Try the same fix multiple times without understanding why it failed.
- Assume the error location matches where you think the problem is.

**When stuck**: re-read the error, check the rule's docs, understand the type signature the function expects, fix the actual mismatch. After three identical attempts, stop and re-read the error message.

<!--
Source: Based on Obsidian community best practices
Update frequency: Review periodically for AI agent-specific guidance
-->

# Agent do/don't

## Do
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.
- **Always run `pnpm build` after making changes** to catch build errors early. Only check for pnpm installation if the build fails. See [build-workflow.md](../../obsidian-ops/references/build-workflow.md) for details.
- **Summarize commands**: When user requests "Summarize" or "Summarize for release", follow the workflow in [summarize-commands.md](../../obsidian-ops/references/summarize-commands.md). Always read actual file changes, not just chat history.
- **Release preparation**: When user asks "is my plugin ready for release?" or similar, use [release-readiness.md](../../obsidian-ops/references/release-readiness.md) checklist. Run automated checks where possible, ask user interactively for items requiring their input (like platform testing).

## Don't
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.
- **File structure**: Never have `main.ts` in both root AND `src/` - this causes build confusion. For simple plugins, `main.ts` in root is acceptable. For plugins with multiple files, place `main.ts` in `src/` (recommended). See [file-conventions.md](../../obsidian-ref/references/file-conventions.md) for standard structure and common pitfalls.
- **Git operations**: follow the Git section of `CLAUDE.md`. Commits on a feature branch are fine; `git push`, opening a PR and merging into `main` each need the user's explicit go-ahead.

## Fixing Linting Errors

**DO**:
- Read the error message carefully - note the exact line and column
- Understand what the error is actually complaining about
- Fix the root cause, not the symptom
- Test with `pnpm lint` after each fix
- Verify `pnpm build` still works

**DON'T**:
- Add eslint-disable comments without understanding why. Never disable `obsidianmd/ui/sentence-case`; add proper nouns to `ignoreWords` in `eslint.config.mts` instead
- Put disable comments on the wrong line
- Try the same fix multiple times without understanding why it failed
- Suppress errors as a shortcut
- Assume the error location matches where you think the problem is
- Skip reading the documentation for the specific error type

**When Stuck**:
1. Read the error message - what line/column is it complaining about?
2. Understand the type signature - what does the function expect?
3. Fix the actual type mismatch, not just suppress the warning
4. If you've tried the same thing 3 times, stop and re-read the error message



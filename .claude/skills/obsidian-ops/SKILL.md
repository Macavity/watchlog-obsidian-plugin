---
name: obsidian-ops
description: Operations, versioning, and release management for Obsidian projects. Load when running builds, bumping versions, or preparing for release.
---

# Obsidian Operations Skill

This skill covers the operational aspects of maintaining an Obsidian project, including build workflows and release management.

## Purpose

To ensure reliable builds, and safe release processes while strictly following project policies.

## Scope

This skill covers:
- Build and lint workflows
- Version management and release preparation
- Build and environment troubleshooting

## Core Rules

- **Git**: the Git section of `CLAUDE.md` governs. Commits on a feature branch are fine; `git push`, PRs and merges into `main` need the user's explicit go-ahead.
- **Verify Build**: Always run a build/lint after significant changes to ensure compatibility.

## Bundled Resources

Cutting a release of this plugin: use the `release` skill (`.claude/skills/release/SKILL.md`); it wraps the references below into the step-by-step procedure.


- `references/build-workflow.md`: Standard build and development commands.
- `references/release-readiness.md`: Checklist for ensuring a project is ready for release.
- `references/scorecard-compliance.md`: Map of Obsidian community plugin scorecard signals to concrete fixes (vulnerability overrides, attestation workflow, CSS dedup, obsidianmd rules).
- `references/contributing-template.md`: Portable CONTRIBUTING.md template for the scorecard hygiene check.
- `references/security-privacy.md`: Developer policies, mandatory disclosures, and dependency vulnerability hygiene via `pnpm.overrides`.
- `references/versioning-releases.md`: Workflow for versioning and GitHub releases, including the build-provenance attestation pattern.
- `references/testing.md`: Desktop, mobile and beta testing.
- `references/performance.md`: Load time and runtime performance.
- `references/summarize-commands.md`: Commit message and release note workflows.
- `references/troubleshooting.md`: Common issues and their resolutions.
- `references/quick-reference.md`: One-page cheat sheet for common operations.

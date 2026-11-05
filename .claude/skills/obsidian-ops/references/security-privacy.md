<!--
Source: https://docs.obsidian.md/community-directory/developer-policies, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
-->

# Security, privacy, and compliance

Follow Obsidian's [Developer policies](https://docs.obsidian.md/community-directory/developer-policies). Plugins that violate them are removed from the community directory. See [release-readiness.md](release-readiness.md) for the full checklist.

## Not allowed

- Obfuscating code to hide its purpose
- Dynamic ads loaded over the internet; static ads outside the plugin's own interface
- Client-side telemetry
- Installing or updating itself or its dependencies (no fetching/evaluating remote code)

## Allowed only with a clear README disclosure

- Payment required for full access
- Account required for full access
- Network use: which remote services and why
- Accessing files outside the vault, and why
- Static ads within the plugin's own interface
- Server-side telemetry, with a link to a privacy policy
- Closed-source code (case by case)

## Copyright and licensing

- Include a LICENSE file and state the license clearly.
- Comply with licenses of all code used, with attribution in the README where required.
- Don't use the "Obsidian" trademark in a way that suggests a first-party plugin.

## Implementation guidelines

- Default to local/offline operation; read and write only what the feature needs, inside the vault.
- Never build DOM from untrusted strings via `innerHTML`/`outerHTML`/`insertAdjacentHTML`; use `createEl`/`createDiv`/`setText`.
- Validate and `normalizePath()` user-supplied paths.
- Treat note contents and YAML (properties, `.base` files) as untrusted input: parse defensively, never evaluate it.

## Dependency Vulnerability Hygiene

The community scorecard scans the lockfile and flags any package with a known advisory, even if the package is dev-only and never ships in `main.js`. Common offenders are transitives pulled in by `eslint`, `eslint-plugin-obsidianmd`, and `@typescript-eslint/*`: `minimatch`, `picomatch`, `brace-expansion`, `ajv`, `flatted`, `fast-uri`, `yaml`.

Use `overrides` in `pnpm-workspace.yaml` (this repo; older setups use `pnpm.overrides` in `package.json`) to force patched versions of vulnerable transitives without changing direct dependencies. Major-version-scoped ranges avoid breaking consumers that depend on a specific major:

```json
{
  "pnpm": {
    "overrides": {
      "minimatch@<3.1.3": "^3.1.3",
      "minimatch@^4 || ^5 || ^6 || ^7 || ^8": "^8.0.5",
      "minimatch@^9": "^9.0.6",
      "picomatch@<2.3.2": "^2.3.2",
      "picomatch@^3 || ^4": "^4.0.4",
      "brace-expansion@<1.1.13": "^1.1.13",
      "brace-expansion@^2": "^2.0.3",
      "ajv@<6.14.0": "^6.14.0",
      "ajv@^7 || ^8": "^8.18.0",
      "flatted@<3.4.0": "^3.4.0",
      "fast-uri@<3.1.1": "^3.1.1",
      "yaml@<2.8.3": "^2.8.3"
    }
  }
}
```

Verify with `pnpm install` then `pnpm why <pkg>` for each advisory. Every resolved version should be at or above the advisory's fix version.

If a direct dependency (e.g. `eslint-plugin-obsidianmd`) has a newer release that already pulls in patched transitives, prefer bumping the direct dep before adding an override. Overrides are appropriate when no upstream release covers your case.

See [scorecard-compliance.md](scorecard-compliance.md) for the full set of scorecard signals and their fixes.

## Related Documentation

- [release-readiness.md](release-readiness.md)
- [scorecard-compliance.md](scorecard-compliance.md)
- [manifest.md](../../obsidian-ref/references/manifest.md)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)

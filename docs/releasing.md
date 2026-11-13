# Publishing packages

The npm packages are `harngine` and the scoped libraries under `packages/`,
except `@harngine/codex-cli`, `@harngine/evaluation`, and `@harngine/workbench`.
Apps and examples remain private workspaces.
All publishable packages use the same stable version. Publish the core package first, then the scoped libraries.

Run `bun install --frozen-lockfile`, `bun run check`, and `bun run test:package`.
Inspect every publishable package with `bun pm pack` from its directory.
The packed manifests must contain release
versions, not `workspace:*` dependency ranges.

Authenticate with npm using an account authorized to publish `harngine` and
the public `@harngine` scope. Run `bun run publish` to publish the
`0.1.0` packages with the default `latest` dist tag. It packs with Bun before
calling npm because `npm pack` leaves `workspace:*` dependency ranges in the
tarball. The script stops at the
first failed publish. If a publish partially succeeds, inspect npm before
retrying; npm rejects a version that has already been published.

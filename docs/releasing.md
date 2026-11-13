# Publishing a release

The npm packages are `harngine` and the scoped libraries under `packages/`,
except `@harngine/codex-cli`, `@harngine/evaluation`, and `@harngine/workbench`.
Apps and examples remain private workspaces.
All publishable packages use the same stable version as the Git tag.

Run `bun install --frozen-lockfile`, `bun run check`, and `bun run test:package`.
Inspect every publishable package with `bun pm pack` from its directory.
The packed manifests must contain release
versions, not `workspace:*` dependency ranges.

Create and push the annotated version tag before running the publisher. The
matching remote tag is a required preflight.

Authenticate with npm using an account authorized to publish `harngine` and
the public `@harngine` scope. Authenticate GitHub CLI with `gh auth status`.
Then run:

```bash
bun run publish
```

If the local Bun process supervisor terminates the Node publisher on a
memory-constrained host, run `node scripts/publish-packages.mjs` directly.

The publisher:

- publishes the core package first, followed by the scoped libraries;
- skips package versions already present on npm, making partial releases safe to retry;
- packs with Bun so `workspace:*` dependencies resolve in the tarball;
- creates a latest GitHub Release from the pushed tag with generated notes.

The script stops at the first failed npm publish. If a publish partially
succeeds, rerun the same command after fixing the failure.

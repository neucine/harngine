# Publishing a release

The npm packages are `harngine` and the scoped libraries under `packages/`,
except `@harngine/codex-cli`, `@harngine/evaluation`, and `@harngine/workbench`.
Apps and examples remain private workspaces.
All publishable packages use the same stable version as the Git tag.

Create a `release/vX.Y.Z` branch and update all six publishable package
versions to `X.Y.Z`. Open a pull request to `main`. Buildkite checks the
versions and runs the usual macOS checks on each candidate commit. Fixes to
the branch start another candidate build.

After the pull request merges, Buildkite checks the merged commit and asks for
release approval in that same build. Approval publishes the six npm packages,
creates the matching Git tag, and creates the GitHub release. The desktop app
is not part of this release.

The publisher skips package versions already present on npm, so an interrupted
publication can be retried on the same checked commit. A tag that points to a
different commit stops publication.

For a manual release, run `bun install --frozen-lockfile`, `bun run check`, and
`bun run test:package`. Inspect each publishable package with `bun pm pack`;
packed manifests must contain release versions, not `workspace:*` ranges.
Create and push the version tag for the commit before running the publisher.

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
- creates a latest GitHub Release from the tag with generated notes.

The script stops at the first failed npm publish. If a publish partially
succeeds, rerun the same command after fixing the failure.

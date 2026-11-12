# Contributing

Harngine is pre-release software. Small fixes and focused proposals are easiest to review while the
public API is still changing.

## Development setup

Use the versions recorded in `.bun-version` and `.node-version`:

```bash
bun install
bun run check
bun run test:package
```

`bun run check` formats, type-checks, builds, and runs the test suite. The package check also packs
the public packages and exercises them from a temporary consumer project.

The coding desktop has additional checkout prerequisites. See the
[Coding Desktop guide](apps/coding/desktop/README.md).

## Pull requests

- Keep execution-core behavior changes separate from provider or application integrations.
- Add a regression test for a behavior fix, especially around restart, durability, authorization,
  replay, and uncertain external effects.
- Update the applicable README or [framework guide](docs/guide.md) when a public API or setup step
  changes.
- Do not include generated build output, local runtime databases, credentials, personal data, or
  machine-specific absolute paths.

Report security issues according to [SECURITY.md](SECURITY.md).

# Two-minute recovery demo

This example uses only the public `harngine` package, Bun for the definition manifest, and Node.js 24.21 or later in the 24.x line. It does not need a model account, desktop app, or sibling repository.

Harngine is not published on npm yet. From a Harngine checkout, run:

```bash
bun install --frozen-lockfile
bun run test:quickstart
```

The command builds the package, packs it, installs the tarball into a fresh temporary project with npm, generates that project's definition manifest, and runs `demo.mjs` under Node 24. The installed project contains only the package and this example. When a release tarball is available, copy `demo.mjs` to an empty directory, create a `package.json` with `{"private":true,"type":"module"}`, install the tarball, run `bunx harngine-manifest`, then run `node demo.mjs`.

The demo starts Work that calls a typed Tool and waits on a durable timer. Its parent kills the worker with `SIGKILL` while the Work is waiting. A new process opens the same SQLite directory, retrieves the Work by ID, awaits its result, and inspects the recorded call and closure. It asserts one settled Tool call with one Attempt. The printed directory retains SQLite evidence for inspection; remove it when finished.

The Tool is a deterministic read operation. This demo proves timer recovery and committed call replay. Write Tools need idempotency or reconciliation appropriate to their external effect; see the [framework guide](../../docs/guide.md).

# Codex CLI model adapter

Development-only adapter that connects Harngine to `codex exec` using the local ChatGPT login.
It is used by this repository's live demonstrations and is not published as part of the public
framework package.

```ts
import { createCodexCliModel } from "@harngine/codex-cli";

const model = createCodexCliModel({
  cliVersion: "codex-cli 0.157.0",
  model: "codex/gpt-6.1-sol",
  timeoutMs: 180_000,
  provider: {
    name: "magpie",
    baseUrl: "http://127.0.0.1:3425/v1",
    bearerToken: process.env.HARNGINE_CODING_API_TOKEN,
  },
});
```

The adapter sends a bounded Model Context and Harngine-generated response schema over stdin. It
runs Codex with user configuration ignored, a read-only sandbox, web access disabled, and action
tools disabled. An explicit `provider` selects Magpie or another Responses-compatible endpoint
without loading unrelated user configuration. Harngine executes accepted Tool proposals itself.

The adapter does not read or export credential files and does not pass API-key environment
variables to the subprocess. Temporary instructions, schema, and response files are removed after
each invocation. Time, output, and process-group limits are enforced.

Use `bun run demo:coding` from the repository root for a live example.

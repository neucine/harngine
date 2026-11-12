# Claude Messages model adapter

`@harngine/claude-messages` connects Harngine to the Claude Messages protocol. A compatible router
can use a different upstream model while preserving the Messages request and response shape.

```ts
import { createClaudeMessagesAdapter } from "@harngine/claude-messages";

const model = createClaudeMessagesAdapter({
  accessToken: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  model: "opencode-go/deepseek-v4.1-flash",
});
```

The adapter sends `POST /messages` with `x-api-key` and `anthropic-version` headers. It requests a
Harngine structured response envelope, rejects truncated or incomplete messages, and normalizes
token usage. A model ID is required. Harngine executes accepted Tool proposals; the adapter does
not invoke tools itself.

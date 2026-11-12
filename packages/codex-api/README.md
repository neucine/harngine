# OpenAI Responses model adapter

`@harngine/codex-api` connects Harngine to the OpenAI Responses protocol. Set `baseUrl` for a
compatible router such as Magpie; the protocol remains OpenAI Responses regardless of which
upstream model the router selects.

```ts
import { createOpenAIResponsesAdapter } from "@harngine/codex-api";

const model = createOpenAIResponsesAdapter({
  accessToken: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  model: "codex/gpt-6-sol",
});
```

When `model` is omitted, the adapter chooses the first model from the `/models` endpoint. The
adapter sends a bounded Model Context to `/responses`, requests Harngine's structured response
envelope with strict JSON Schema, verifies that the SSE stream reaches `response.completed`, and
normalizes provider usage. Harngine executes accepted Tool proposals; the adapter does not invoke
tools itself.

The deprecated `createCodexApiAdapter` and `CodexApiOptions` names remain as aliases for existing
callers.

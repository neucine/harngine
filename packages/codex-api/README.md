# OpenAI Responses model adapter

`@harngine/codex-api` connects Harngine to the OpenAI Responses protocol. Set `baseUrl` for a
compatible router such as Magpie; the protocol remains OpenAI Responses regardless of which
upstream model the router selects.

```ts
import { createOpenAIResponsesAdapter } from "@harngine/codex-api";

const model = createOpenAIResponsesAdapter({
  baseUrl: "http://127.0.0.1:3425/v1",
  model: "codex/gpt-6-sol",
});
```

`accessToken` is optional when `baseUrl` names an unauthenticated local compatible router. The
adapter still requires either a token or an explicit `baseUrl`, so an accidental request to the
public OpenAI endpoint cannot silently omit authentication.

Provider-native image and PDF input is opt-in because a compatible router may target a model
without vision or document support:

```ts
const model = createOpenAIResponsesAdapter({
  accessToken: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  model: "vision-capable-model",
  async resolveArtifact(reference, { signal }) {
    return applicationStorage.readVerified(reference, { signal });
  },
});
```

When `resolveArtifact` is configured, the adapter resolves every reference already selected into
`ModelContext.artifacts`, verifies its byte length and SHA-256 digest, and converts GIF, JPEG, PNG
and WebP references into Responses `input_image` parts and `application/pdf` references into
`input_file` parts. The complete `ModelRequest` remains in the user message as JSON text.
Resolution failure occurs before the `/responses` request starts.

The shared resolver defaults to at most 8 Artifacts, 20 MiB per Artifact and 20 MiB of raw bytes
per model call. Override `maxArtifacts`, `maxArtifactBytes` or `maxTotalArtifactBytes` when the
application and selected router have a different reviewed bound. Without `resolveArtifact`, no
native input capability is advertised and references remain metadata only.

When `model` is omitted, the adapter chooses the first model from the `/models` endpoint. The
adapter sends a bounded Model Context to `/responses`, requests Harngine's structured response
envelope with strict JSON Schema, verifies that the SSE stream reaches `response.completed`, and
normalizes provider usage. It advertises streaming and extracts preview text only from complete
`items[*].text` values in the structured response; tool inputs and nested fields are excluded.
Harngine executes accepted Tool proposals; the adapter does not invoke tools itself.

The deprecated `createCodexApiAdapter` and `CodexApiOptions` names remain as aliases for existing
callers.

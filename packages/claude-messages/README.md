# Claude Messages model adapter

`@harngine/claude-messages` connects Harngine to the Claude Messages protocol. A compatible router
can use a different upstream model while preserving the Messages request and response shape.

```ts
import { createClaudeMessagesAdapter } from "@harngine/claude-messages";

const model = createClaudeMessagesAdapter({
  baseUrl: "http://127.0.0.1:3425/v1",
  model: "opencode-go/deepseek-v4.1-flash",
});
```

`accessToken` is optional when `baseUrl` names an unauthenticated local compatible router. The
adapter still requires either a token or an explicit `baseUrl`.

Provider-native image and PDF input is opt-in because a compatible router may target a model
without vision or document support:

```ts
const model = createClaudeMessagesAdapter({
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
and WebP references into Messages `image` blocks and `application/pdf` references into `document`
blocks. The complete `ModelRequest` remains in the user message as JSON text. Resolution failure
occurs before the `/messages` request starts.

The shared resolver defaults to at most 8 Artifacts, 20 MiB per Artifact and 20 MiB of raw bytes
per model call. The raw bound leaves room for base64 expansion and request framing below the
Messages 32 MB request limit. Override `maxArtifacts`, `maxArtifactBytes` or
`maxTotalArtifactBytes` only after reviewing the router and upstream model limits. Without
`resolveArtifact`, no native input capability is advertised and references remain metadata only.

The adapter sends a streaming `POST /messages` request with `anthropic-version` and, when
configured, `x-api-key`. It supports both Messages SSE and a non-streaming compatible JSON
fallback. Structured envelope text becomes normalized live previews while nested Tool fields stay
out of the preview channel. The adapter rejects truncated or incomplete messages and normalizes
token usage. A model ID is required. Harngine executes accepted Tool proposals; the adapter does
not invoke tools itself.

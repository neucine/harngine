import {
  modelEnvelopeInstructions,
  modelOutputSchema,
  modelResponseContract,
  normalizeModelEnvelope,
  resolveModelArtifacts,
} from 'harngine';
import type {
  ArtifactResolver,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ResolvedModelArtifact,
} from 'harngine';

export interface ClaudeMessagesOptions {
  accessToken: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Resolve bytes owned by the application for Artifact References in Model Context. */
  resolveArtifact?: ArtifactResolver;
  maxArtifacts?: number;
  maxArtifactBytes?: number;
  maxTotalArtifactBytes?: number;
}

interface ClaudeMessage {
  type: string;
  model?: string;
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

const NATIVE_IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const;
const NATIVE_DOCUMENT_TYPES = ['application/pdf'] as const;

function contentBlock(artifact: ResolvedModelArtifact): object {
  const mediaType = artifact.reference.mediaType.toLowerCase();
  const source = {
    type: 'base64',
    media_type: mediaType,
    data: Buffer.from(artifact.bytes).toString('base64'),
  };
  if ((NATIVE_IMAGE_TYPES as readonly string[]).includes(mediaType))
    return { type: 'image', source };
  return { type: 'document', source };
}

export function createClaudeMessagesAdapter(options: ClaudeMessagesOptions): ModelAdapter {
  if (!options.accessToken.trim()) throw new Error('API access token is empty');
  if (!options.model.trim()) throw new Error('Claude Messages adapter requires a model');
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxOutputTokens = options.maxOutputTokens ?? 4_000;
  return {
    id: 'claude-messages',
    capabilities: {
      tools: true,
      structuredOutput: true,
      streaming: false,
      ...(options.resolveArtifact ? { inputModalities: ['image', 'document'] as const } : {}),
      contextWindow: 128_000,
      defaultOutputReserve: maxOutputTokens,
    },
    async generate(input: ModelRequest, { signal }): Promise<ModelResponse> {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort(signal.reason);
      const timer = setTimeout(
        () => controller.abort(new Error('Claude Messages timeout')),
        timeoutMs,
      );
      try {
        const artifacts = options.resolveArtifact
          ? await resolveModelArtifacts(input.context.artifacts, {
              resolve: options.resolveArtifact,
              allowedMediaTypes: [...NATIVE_IMAGE_TYPES, ...NATIVE_DOCUMENT_TYPES],
              signal: controller.signal,
              ...(options.maxArtifacts === undefined ? {} : { maxArtifacts: options.maxArtifacts }),
              ...(options.maxArtifactBytes === undefined
                ? {}
                : { maxArtifactBytes: options.maxArtifactBytes }),
              ...(options.maxTotalArtifactBytes === undefined
                ? {}
                : { maxTotalArtifactBytes: options.maxTotalArtifactBytes }),
            })
          : [];
        const response = await request(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': options.accessToken,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: maxOutputTokens,
            system: modelEnvelopeInstructions,
            messages: [
              {
                role: 'user',
                content: artifacts.length
                  ? [{ type: 'text', text: JSON.stringify(input) }, ...artifacts.map(contentBlock)]
                  : JSON.stringify(input),
              },
            ],
            output_config: {
              format: {
                type: 'json_schema',
                schema: modelOutputSchema(modelResponseContract(input)),
              },
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as ClaudeMessage | null;
          throw new Error(
            `Claude Messages API HTTP ${response.status}${error?.error?.type ? `: ${error.error.type}` : ''}`,
          );
        }
        const body = (await response.json()) as ClaudeMessage;
        if (body.type !== 'message' || body.stop_reason === 'max_tokens')
          throw new Error(
            `Claude Messages response did not complete: ${body.stop_reason ?? body.type}`,
          );
        const output = body.content
          ?.filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('');
        if (!output) throw new Error('Claude Messages response has no text');
        const result = normalizeModelEnvelope(JSON.parse(output), input);
        return {
          ...result,
          provider: { name: 'claude-messages', model: body.model ?? options.model },
          ...(body.usage
            ? {
                usage: {
                  ...(body.usage.input_tokens !== undefined
                    ? { inputTokens: body.usage.input_tokens }
                    : {}),
                  ...(body.usage.output_tokens !== undefined
                    ? { outputTokens: body.usage.output_tokens }
                    : {}),
                  ...(body.usage.input_tokens !== undefined &&
                  body.usage.output_tokens !== undefined
                    ? { totalTokens: body.usage.input_tokens + body.usage.output_tokens }
                    : {}),
                },
              }
            : {}),
        };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
  };
}

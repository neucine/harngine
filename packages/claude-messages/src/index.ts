import {
  createModelOutputTextPreview,
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
  /** Omit for an unauthenticated local compatible router. */
  accessToken?: string;
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

interface ClaudeStreamEvent {
  type?: string;
  message?: ClaudeMessage;
  content_block?: { type?: string; text?: string };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
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

async function readClaudeStream(
  response: Response,
  fallbackModel: string,
  emit: (item: { type: 'text'; text: string }) => void,
): Promise<{
  output: string;
  model: string;
  stopReason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  if (!response.body) throw new Error('Claude Messages stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const preview = createModelOutputTextPreview();
  let pending = '';
  let output = '';
  let model = fallbackModel;
  let stopReason: string | null = null;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let started = false;
  let stopped = false;
  let bytes = 0;
  const consume = (frameText: string) => {
    const data = frameText
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    const event = JSON.parse(data) as ClaudeStreamEvent;
    if (event.type === 'error')
      throw new Error(
        `Claude Messages stream error${event.error?.type ? `: ${event.error.type}` : ''}`,
      );
    if (event.type === 'message_start') {
      started = true;
      model = event.message?.model ?? model;
      inputTokens = event.message?.usage?.input_tokens;
    }
    const text = event.content_block?.text ?? event.delta?.text;
    if (
      (event.type === 'content_block_start' && event.content_block?.type === 'text') ||
      (event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
    ) {
      if (typeof text === 'string' && text) {
        output += text;
        for (const part of preview.push(text)) emit({ type: 'text', text: part });
      }
    }
    if (event.type === 'message_delta') {
      stopReason = event.delta?.stop_reason ?? stopReason;
      outputTokens = event.usage?.output_tokens ?? outputTokens;
    }
    if (event.type === 'message_stop') stopped = true;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2 * 1024 * 1024) throw new Error('Claude Messages stream exceeded 2 MB');
    pending += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = pending.search(/\r?\n\r?\n/)) >= 0) {
      const separator = pending.slice(end).match(/^\r?\n\r?\n/)![0];
      consume(pending.slice(0, end));
      pending = pending.slice(end + separator.length);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) consume(pending);
  if (!started || !stopped)
    throw new Error('Claude Messages stream ended without a complete message');
  return {
    output,
    model,
    stopReason,
    ...(inputTokens !== undefined || outputTokens !== undefined
      ? {
          usage: {
            ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
            ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
          },
        }
      : {}),
  };
}

export function createClaudeMessagesAdapter(options: ClaudeMessagesOptions): ModelAdapter {
  const accessToken = options.accessToken?.trim();
  if (options.accessToken !== undefined && !accessToken)
    throw new Error('API access token is empty');
  if (!accessToken && !options.baseUrl)
    throw new Error('API access token or an explicit compatible baseUrl is required');
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
      streaming: true,
      ...(options.resolveArtifact ? { inputModalities: ['image', 'document'] as const } : {}),
      contextWindow: 128_000,
      defaultOutputReserve: maxOutputTokens,
    },
    async generate(input: ModelRequest, { signal, emit }): Promise<ModelResponse> {
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
            ...(accessToken ? { 'x-api-key': accessToken } : {}),
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: maxOutputTokens,
            stream: true,
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
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          const streamed = await readClaudeStream(response, options.model, emit);
          if (streamed.stopReason === 'max_tokens')
            throw new Error(
              `Claude Messages response did not complete: ${streamed.stopReason ?? 'stream'}`,
            );
          if (!streamed.output) throw new Error('Claude Messages response has no text');
          const result = normalizeModelEnvelope(JSON.parse(streamed.output), input);
          return {
            ...result,
            provider: { name: 'claude-messages', model: streamed.model },
            ...(streamed.usage
              ? {
                  usage: {
                    ...(streamed.usage.input_tokens !== undefined
                      ? { inputTokens: streamed.usage.input_tokens }
                      : {}),
                    ...(streamed.usage.output_tokens !== undefined
                      ? { outputTokens: streamed.usage.output_tokens }
                      : {}),
                    ...(streamed.usage.input_tokens !== undefined &&
                    streamed.usage.output_tokens !== undefined
                      ? {
                          totalTokens: streamed.usage.input_tokens + streamed.usage.output_tokens,
                        }
                      : {}),
                  },
                }
              : {}),
          };
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

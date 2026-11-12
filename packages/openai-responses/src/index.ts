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

export interface OpenAIResponsesOptions {
  /** Omit for an unauthenticated local compatible router. */
  accessToken?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Resolve bytes owned by the application for Artifact References in Model Context. */
  resolveArtifact?: ArtifactResolver;
  maxArtifacts?: number;
  maxArtifactBytes?: number;
  maxTotalArtifactBytes?: number;
}

const NATIVE_IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const;
const NATIVE_DOCUMENT_TYPES = ['application/pdf'] as const;

function message(value: unknown): string {
  if (value && typeof value === 'object') {
    const error = (value as { error?: { code?: string } }).error;
    if (error?.code) return `OpenAI Responses API error: ${error.code}`;
  }
  return 'OpenAI Responses API request failed';
}

function inputFile(artifact: ResolvedModelArtifact): object {
  const mediaType = artifact.reference.mediaType.toLowerCase();
  const data = `data:${mediaType};base64,${Buffer.from(artifact.bytes).toString('base64')}`;
  if ((NATIVE_IMAGE_TYPES as readonly string[]).includes(mediaType))
    return { type: 'input_image', image_url: data };
  return {
    type: 'input_file',
    filename: artifact.reference.name ?? `${artifact.reference.digest.slice(7, 19)}.pdf`,
    file_data: data,
    detail: 'high',
  };
}

export function createOpenAIResponsesAdapter(options: OpenAIResponsesOptions): ModelAdapter {
  const accessToken = options.accessToken?.trim();
  if (options.accessToken !== undefined && !accessToken)
    throw new Error('API access token is empty');
  if (!accessToken && !options.baseUrl)
    throw new Error('API access token or an explicit compatible baseUrl is required');
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 180000;
  let selectedModel = options.model;
  async function model(signal: AbortSignal): Promise<string> {
    if (selectedModel) return selectedModel;
    const response = await request(`${baseUrl}/models`, {
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      signal,
    });
    if (response.status === 401)
      throw new Error(
        'API token was rejected by the model catalog (HTTP 401). Check the token and API base URL.',
      );
    if (!response.ok) throw new Error(`OpenAI compatible model catalog HTTP ${response.status}`);
    const catalog = (await response.json()) as {
      data?: { id: string }[];
      models?: { slug: string; visibility?: string }[];
    };
    const choice =
      catalog.data?.[0]?.id ?? catalog.models?.find((item) => item.visibility === 'list')?.slug;
    if (!choice) throw new Error('Model catalog has no listed model; specify the model option');
    selectedModel = choice;
    return choice;
  }
  return {
    id: 'openai-responses',
    capabilities: {
      tools: true,
      structuredOutput: true,
      streaming: true,
      ...(options.resolveArtifact ? { inputModalities: ['image', 'document'] as const } : {}),
      contextWindow: 128_000,
      defaultOutputReserve: 4_000,
    },
    async generate(input: ModelRequest, { signal, emit }): Promise<ModelResponse> {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort(signal.reason);
      const timer = setTimeout(
        () => controller.abort(new Error('OpenAI Responses API timeout')),
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
        const content = artifacts.length
          ? [{ type: 'input_text', text: JSON.stringify(input) }, ...artifacts.map(inputFile)]
          : JSON.stringify(input);
        const name = await model(controller.signal);
        const preview = createModelOutputTextPreview();
        const response = await request(`${baseUrl}/responses`, {
          method: 'POST',
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: name,
            instructions: modelEnvelopeInstructions,
            input: [{ role: 'user', content }],
            text: {
              format: {
                type: 'json_schema',
                name: 'harngine_response',
                strict: true,
                schema: modelOutputSchema(modelResponseContract(input)),
              },
            },
            store: false,
            stream: true,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(`${message(body)} (HTTP ${response.status})`);
        }
        if (!response.body) throw new Error('OpenAI Responses API response has no stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '',
          output = '',
          complete: any = null;
        let bytes = 0;
        const commentary = new Set<string>();
        const frame = (text: string) => {
          const data = text
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') return;
          const event = JSON.parse(data) as { type: string; delta?: string; response?: any };
          const eventWithItem = event as {
            item_id?: string;
            item?: { id?: string; phase?: string };
          };
          if (
            event.type === 'response.output_item.added' &&
            eventWithItem.item?.id &&
            eventWithItem.item.phase === 'commentary'
          )
            commentary.add(eventWithItem.item.id);
          if (
            event.type === 'response.output_text.delta' &&
            (!eventWithItem.item_id || !commentary.has(eventWithItem.item_id)) &&
            typeof event.delta === 'string'
          ) {
            output += event.delta;
            for (const text of preview.push(event.delta)) emit({ type: 'text', text });
          }
          if (event.type === 'response.completed') complete = event.response;
          if (
            event.type === 'response.failed' ||
            event.type === 'response.incomplete' ||
            event.type === 'error'
          )
            throw new Error(message(event.response ?? event));
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024)
            throw new Error('OpenAI Responses API response exceeded 2 MB');
          pending += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = pending.search(/\r?\n\r?\n/)) >= 0) {
            const separator = pending.slice(end).match(/^\r?\n\r?\n/)![0];
            frame(pending.slice(0, end));
            pending = pending.slice(end + separator.length);
          }
        }
        pending += decoder.decode();
        if (pending.trim()) frame(pending);
        if (!complete)
          throw new Error('OpenAI Responses API stream ended without response.completed');
        if (!output) {
          const items = (complete.output ?? []) as {
            phase?: string;
            content?: { type: string; text?: string }[];
          }[];
          const final = items.some((item) => item.phase === 'final_answer')
            ? items.filter((item) => item.phase === 'final_answer')
            : items.filter((item) => item.phase !== 'commentary');
          output = final
            .flatMap((item: any) => item.content ?? [])
            .filter((part: any) => part.type === 'output_text')
            .map((part: any) => part.text)
            .join('');
        }
        const result = normalizeModelEnvelope(JSON.parse(output), input);
        return {
          ...result,
          provider: { name: 'openai-responses', model: name },
          ...(complete.usage
            ? {
                usage: {
                  inputTokens: complete.usage.input_tokens,
                  outputTokens: complete.usage.output_tokens,
                  totalTokens: complete.usage.total_tokens,
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

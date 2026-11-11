import type { ModelAdapter, ModelRequest, ModelResponse } from 'harngine';
import {
  codexCliSystemInstructions,
  normalizeResponse,
  responseContract,
} from '@harngine/codex-cli';

export interface CodexApiOptions {
  accessToken: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function message(value: unknown): string {
  if (value && typeof value === 'object') {
    const error = (value as { error?: { code?: string } }).error;
    if (error?.code) return `Codex API error: ${error.code}`;
  }
  return 'Codex API request failed';
}

export function createCodexApiAdapter(options: CodexApiOptions): ModelAdapter {
  if (!options.accessToken.trim()) throw new Error('CODEX_ACCESS_TOKEN is empty');
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 180000;
  let selectedModel = options.model;
  async function model(signal: AbortSignal): Promise<string> {
    if (selectedModel) return selectedModel;
    const response = await request(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      signal,
    });
    if (response.status === 401)
      throw new Error(
        'CODEX_ACCESS_TOKEN was rejected by the OpenAI model catalog (HTTP 401). Use an authorized ChatGPT plan OAuth access token or unset the variable to use Codex CLI.',
      );
    if (!response.ok) throw new Error(`Codex model catalog HTTP ${response.status}`);
    const catalog = (await response.json()) as { models?: { slug: string; visibility?: string }[] };
    const choice = catalog.models?.find((item) => item.visibility === 'list')?.slug;
    if (!choice) throw new Error('Codex model catalog has no listed model; set CODEX_MODEL');
    selectedModel = choice;
    return choice;
  }
  return {
    id: 'codex-api',
    capabilities: {
      tools: true,
      structuredOutput: true,
      streaming: false,
      contextWindow: 128_000,
      defaultOutputReserve: 4_000,
    },
    async generate(input: ModelRequest, { signal }): Promise<ModelResponse> {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort(signal.reason);
      const timer = setTimeout(() => controller.abort(new Error('Codex API timeout')), timeoutMs);
      try {
        const name = await model(controller.signal);
        const response = await request(`${baseUrl}/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: name,
            instructions: codexCliSystemInstructions,
            input: [{ role: 'user', content: JSON.stringify(input) }],
            text: {
              format: {
                type: 'json_schema',
                name: 'harngine_response',
                strict: true,
                schema: responseContract(input),
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
        if (!response.body) throw new Error('Codex API response has no stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '',
          output = '',
          complete: any = null;
        let bytes = 0;
        const frame = (text: string) => {
          const data = text
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') return;
          const event = JSON.parse(data) as { type: string; delta?: string; response?: any };
          if (event.type === 'response.output_text.delta') output += event.delta ?? '';
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
          if (bytes > 2 * 1024 * 1024) throw new Error('Codex API response exceeded 2 MB');
          pending += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = pending.search(/\r?\n\r?\n/)) >= 0) {
            const separator = pending.slice(end).match(/^\r?\n\r?\n/)![0];
            frame(pending.slice(0, end));
            pending = pending.slice(end + separator.length);
          }
        }
        if (!complete) throw new Error('Codex API stream ended without response.completed');
        if (!output)
          output = (complete.output ?? [])
            .flatMap((item: any) => item.content ?? [])
            .filter((part: any) => part.type === 'output_text')
            .map((part: any) => part.text)
            .join('');
        const result = normalizeResponse(JSON.parse(output));
        return {
          ...result,
          provider: { name: 'openai', model: name },
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

import { describe, expect, it } from 'vitest';
import { createCodexApiAdapter } from '../src/index.js';
import type { ModelRequest } from 'harngine';

const request: ModelRequest = {
  object: 'model_request',
  instructions: ['Read code'],
  context: {
    object: 'model_context',
    objective: 'Explain a file',
    items: [],
    policy: 'default',
    budget: { inputTokens: 1000, estimatedTokens: 50 },
  },
  tools: [],
};
function stream(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}
describe('Codex API adapter', () => {
  it('uses bearer auth and accepts only a completed SSE response', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).endsWith('/models'))
        return Response.json({ models: [{ slug: 'test-model', visibility: 'list' }] });
      const result = JSON.stringify({
        items: [
          {
            type: 'text',
            text: 'Done',
            providerCallId: null,
            tool: null,
            input: null,
            value: null,
          },
        ],
        finishReason: 'stop',
      });
      return new Response(
        stream([
          `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: result.slice(0, 20) })}\n`,
          `\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: result.slice(20) })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } })}\n\n`,
        ]),
        { status: 200 },
      );
    };
    const adapter = createCodexApiAdapter({
      accessToken: 'fixture-credential',
      fetch: fetcher as typeof fetch,
    });
    const result = await adapter.generate(request, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(result.items).toEqual([{ type: 'text', text: 'Done' }]);
    expect(result.usage?.totalTokens).toBe(15);
    expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer fixture-credential' });
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body).toMatchObject({ model: 'test-model', store: false, stream: true });
    expect(body.text.format.type).toBe('json_schema');
  });
  it('explains an unauthorized token without exposing it', async () => {
    const fetcher = async () => new Response(null, { status: 401 });
    const adapter = createCodexApiAdapter({
      accessToken: 'fixture-credential',
      fetch: fetcher as typeof fetch,
    });
    await expect(
      adapter.generate(request, { signal: new AbortController().signal, emit() {} }),
    ).rejects.toThrow('CODEX_ACCESS_TOKEN was rejected');
  });
  it('rejects an interrupted stream', async () => {
    const fetcher = async () =>
      new Response(stream(['data: {"type":"response.output_text.delta","delta":"{}"}\n\n']), {
        status: 200,
      });
    const adapter = createCodexApiAdapter({
      accessToken: 'fixture-credential',
      model: 'test-model',
      fetch: fetcher as typeof fetch,
    });
    await expect(
      adapter.generate(request, { signal: new AbortController().signal, emit() {} }),
    ).rejects.toThrow('without response.completed');
  });
});

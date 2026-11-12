import { describe, expect, it } from 'vitest';
import { createOpenAIResponsesAdapter } from '../src/index.js';
import type { ModelRequest } from 'harngine';
import {
  describeModelAdapterConformance,
  type AdapterConformanceFactory,
} from '../../harngine/test/model-adapter-conformance.js';

const request: ModelRequest = {
  object: 'model_request',
  instructions: ['Read code'],
  context: {
    object: 'model_context',
    objective: 'Explain a file',
    items: [],
    artifacts: [],
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

const conformance: AdapterConformanceFactory = (reply, options) => {
  const fetcher: typeof fetch = async (_url, init) => {
    if (reply.kind === 'provider-error')
      return Response.json({ error: { code: 'fixture_rejected' } }, { status: 400 });
    if (reply.kind === 'timeout')
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
      });
    const text = reply.kind === 'malformed' ? 'not-json' : JSON.stringify(reply.value);
    return new Response(
      stream([
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            output: [{ content: [{ type: 'output_text', text }] }],
            ...(reply.kind === 'contract' && reply.usage
              ? {
                  usage: {
                    input_tokens: reply.usage.inputTokens,
                    output_tokens: reply.usage.outputTokens,
                    total_tokens: reply.usage.totalTokens,
                  },
                }
              : {}),
          },
        })}\n\n`,
      ]),
      { status: 200 },
    );
  };
  return {
    adapter: createOpenAIResponsesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      timeoutMs: options.timeoutMs,
      fetch: fetcher,
    }),
  };
};

describeModelAdapterConformance('OpenAI Responses adapter', conformance);

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
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'fixture-credential',
      fetch: fetcher as typeof fetch,
    });
    const result = await adapter.generate(request, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(result.items).toEqual([{ type: 'text', text: 'Done' }]);
    expect(result.usage?.totalTokens).toBe(15);
    expect(result.provider?.name).toBe('openai-responses');
    expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer fixture-credential' });
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body).toMatchObject({ model: 'test-model', store: false, stream: true });
    expect(body.text.format.type).toBe('json_schema');
  });
  it('ignores commentary output and parses only the final answer item', async () => {
    const commentaryId = 'commentary-output';
    const finalId = 'final-output';
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
    const fetcher = async () =>
      new Response(
        stream([
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: commentaryId, type: 'message', phase: 'commentary' },
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.output_text.delta',
            item_id: commentaryId,
            delta: 'I will inspect the file.',
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            output_index: 1,
            item: { id: finalId, type: 'message', phase: 'final_answer' },
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.output_text.delta',
            item_id: finalId,
            delta: result,
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              output: [
                {
                  phase: 'commentary',
                  content: [{ type: 'output_text', text: 'I will inspect the file.' }],
                },
                { phase: 'final_answer', content: [{ type: 'output_text', text: result }] },
              ],
            },
          })}\n\n`,
        ]),
        { status: 200 },
      );
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: fetcher as typeof fetch,
    });
    await expect(
      adapter.generate(request, {
        signal: new AbortController().signal,
        emit() {},
      }),
    ).resolves.toMatchObject({
      items: [{ type: 'text', text: 'Done' }],
      finishReason: 'stop',
    });
  });
  it('explains an unauthorized token without exposing it', async () => {
    const fetcher = async () => new Response(null, { status: 401 });
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'fixture-credential',
      fetch: fetcher as typeof fetch,
    });
    await expect(
      adapter.generate(request, { signal: new AbortController().signal, emit() {} }),
    ).rejects.toThrow('API token was rejected');
  });
  it('discovers a model from a standard OpenAI catalog at a local base URL', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string | URL | Request): Promise<Response> => {
      urls.push(String(url));
      if (String(url).endsWith('/models'))
        return Response.json({ data: [{ id: 'codex/gpt-6-sol' }] });
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
          `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: result }] }] } })}\n\n`,
        ]),
        { status: 200 },
      );
    };
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'magpie',
      baseUrl: 'http://127.0.0.1:3425/v1/',
      fetch: fetcher as typeof fetch,
    });
    const result = await adapter.generate(request, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(urls).toEqual(['http://127.0.0.1:3425/v1/models', 'http://127.0.0.1:3425/v1/responses']);
    expect(result.provider?.model).toBe('codex/gpt-6-sol');
  });
  it('uses strict schemas while omitting null optional Tool inputs', async () => {
    const toolId = 'search';
    let body: any;
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      body = JSON.parse(String(init?.body));
      const result = JSON.stringify({
        items: [
          {
            type: 'tool-call',
            text: null,
            providerCallId: 'search-1',
            tool: toolId,
            input: { query: 'durability', limit: null },
            value: null,
          },
        ],
        finishReason: 'tool-calls',
      });
      return new Response(
        stream([
          `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: result }] }] } })}\n\n`,
        ]),
        { status: 200 },
      );
    };
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: fetcher as typeof fetch,
    });
    const response = await adapter.generate(
      {
        ...request,
        tools: [
          {
            id: toolId,
            kind: 'tool',
            description: 'Search',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['query'],
              properties: {
                query: { type: 'string', minLength: 1 },
                limit: { type: 'integer', minimum: 1 },
              },
            },
            outputSchema: { type: 'array' },
          },
        ],
      },
      { signal: new AbortController().signal, emit() {} },
    );
    const callSchema = body.text.format.schema.properties.items.items.anyOf.find(
      (item: any) => item.properties.tool.enum?.[0] === toolId,
    );
    expect(callSchema.properties.input.required).toEqual(['query', 'limit']);
    expect(callSchema.properties.input.properties.limit.anyOf[0]).toEqual({
      type: 'integer',
      minimum: 1,
    });
    expect(callSchema.properties.input.properties.limit.anyOf[1]).toEqual({ type: 'null' });
    expect(response.items).toEqual([
      {
        type: 'tool-call',
        providerCallId: 'search-1',
        tool: toolId,
        input: { query: 'durability' },
      },
    ]);
  });
  it('rejects an interrupted stream', async () => {
    const fetcher = async () =>
      new Response(stream(['data: {"type":"response.output_text.delta","delta":"{}"}\n\n']), {
        status: 200,
      });
    const adapter = createOpenAIResponsesAdapter({
      accessToken: 'fixture-credential',
      model: 'test-model',
      fetch: fetcher as typeof fetch,
    });
    await expect(
      adapter.generate(request, { signal: new AbortController().signal, emit() {} }),
    ).rejects.toThrow('without response.completed');
  });
});

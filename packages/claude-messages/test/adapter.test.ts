import { describe, expect, it } from 'vitest';
import type { ModelRequest } from 'harngine';
import { createClaudeMessagesAdapter } from '../src/index.js';
import {
  describeModelAdapterConformance,
  type AdapterConformanceFactory,
} from '../../harngine/test/model-adapter-conformance.js';

const request: ModelRequest = {
  object: 'model_request',
  instructions: ['Reply briefly'],
  context: {
    object: 'model_context',
    objective: 'Say OK',
    items: [],
    artifacts: [],
    policy: 'default',
    budget: { inputTokens: 1000, estimatedTokens: 50 },
  },
  tools: [],
};

const conformance: AdapterConformanceFactory = (reply, options) => {
  const fetcher: typeof fetch = async (_url, init) => {
    if (reply.kind === 'provider-error')
      return Response.json({ type: 'error', error: { type: 'fixture_rejected' } }, { status: 400 });
    if (reply.kind === 'timeout')
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
      });
    return Response.json({
      type: 'message',
      model: 'test-model',
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: reply.kind === 'malformed' ? 'not-json' : JSON.stringify(reply.value),
        },
      ],
      ...(reply.kind === 'contract' && reply.usage
        ? {
            usage: {
              input_tokens: reply.usage.inputTokens,
              output_tokens: reply.usage.outputTokens,
            },
          }
        : {}),
    });
  };
  return {
    adapter: createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      timeoutMs: options.timeoutMs,
      fetch: fetcher,
    }),
  };
};

describeModelAdapterConformance('Claude Messages adapter', conformance);

describe('Claude Messages adapter', () => {
  it('uses Messages framing and normalizes a completed response', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const fetcher = async (target: string | URL | Request, options?: RequestInit) => {
      url = String(target);
      init = options;
      return Response.json({
        type: 'message',
        model: 'codex/gpt-6-sol',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                {
                  type: 'text',
                  text: 'OK',
                  providerCallId: null,
                  tool: null,
                  input: null,
                  value: null,
                },
              ],
              finishReason: 'stop',
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    };
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'codex/gpt-6-sol',
      baseUrl: 'http://127.0.0.1:3425/v1/',
      fetch: fetcher as typeof fetch,
    });
    const result = await adapter.generate(request, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(url).toBe('http://127.0.0.1:3425/v1/messages');
    expect(init?.headers).toMatchObject({
      'x-api-key': 'magpie',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'codex/gpt-6-sol',
      output_config: { format: { type: 'json_schema' } },
    });
    expect(result.items).toEqual([{ type: 'text', text: 'OK' }]);
    expect(result.provider).toEqual({ name: 'claude-messages', model: 'codex/gpt-6-sol' });
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('rejects truncated responses', async () => {
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: (async () =>
        Response.json({ type: 'message', stop_reason: 'max_tokens', content: [] })) as typeof fetch,
    });
    await expect(
      adapter.generate(request, { signal: new AbortController().signal, emit() {} }),
    ).rejects.toThrow('did not complete');
  });

  it('normalizes a tool proposal through the same ModelItem contract', async () => {
    const withTool: ModelRequest = {
      ...request,
      tools: [
        {
          id: 'read-file',
          kind: 'tool',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            required: ['path'],
            properties: { path: { type: 'string' } },
          },
          outputSchema: { type: 'string' },
        },
      ],
    };
    const fetcher = async () =>
      Response.json({
        type: 'message',
        model: 'test-model',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                {
                  type: 'tool-call',
                  text: null,
                  providerCallId: 'call-1',
                  tool: 'read-file',
                  input: { path: 'README.md' },
                  value: null,
                },
              ],
              finishReason: 'tool-calls',
            }),
          },
        ],
      });
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: fetcher as typeof fetch,
    });
    const response = await adapter.generate(withTool, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(response.items).toEqual([
      {
        type: 'tool-call',
        providerCallId: 'call-1',
        tool: 'read-file',
        input: { path: 'README.md' },
      },
    ]);
  });
});

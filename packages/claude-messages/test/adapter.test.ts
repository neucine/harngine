import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { artifactReference, type ModelRequest } from 'harngine';
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

function artifact(name: string, mediaType: string, bytes: Uint8Array) {
  return artifactReference({
    id: `attachment:${name}`,
    name,
    mediaType,
    byteLength: bytes.byteLength,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

function completedResponse() {
  return Response.json({
    type: 'message',
    model: 'test-model',
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          items: [{ type: 'text', text: 'Done' }],
          finishReason: 'stop',
        }),
      },
    ],
  });
}

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
  it('requires a token or an explicit compatible base URL', () => {
    expect(() => createClaudeMessagesAdapter({ model: 'test-model' })).toThrow(
      'API access token or an explicit compatible baseUrl is required',
    );
  });
  it('encodes verified image and PDF references as native Messages content blocks', async () => {
    const imageBytes = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2]);
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nfixture');
    const image = artifact('photo.jpg', 'image/jpeg', imageBytes);
    const pdf = artifact('agreement.pdf', 'application/pdf', pdfBytes);
    const multimodalRequest: ModelRequest = {
      ...request,
      context: { ...request.context, artifacts: [image, pdf] },
    };
    const resolved: string[] = [];
    let body: any;
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return completedResponse();
      }) as typeof fetch,
      async resolveArtifact(reference) {
        resolved.push(reference.id);
        return reference.id === image.id ? imageBytes : pdfBytes;
      },
    });

    await adapter.generate(multimodalRequest, {
      signal: new AbortController().signal,
      emit() {},
    });

    expect(resolved).toEqual([image.id, pdf.id]);
    expect(adapter.capabilities.inputModalities).toEqual(['image', 'document']);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: JSON.stringify(multimodalRequest) },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: Buffer.from(imageBytes).toString('base64'),
        },
      },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: Buffer.from(pdfBytes).toString('base64'),
        },
      },
    ]);
  });

  it('keeps metadata-only artifacts when native resolution is not configured', () => {
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: (async () => completedResponse()) as typeof fetch,
    });
    expect(adapter.capabilities).not.toHaveProperty('inputModalities');
  });

  it('rejects unsupported artifact media types before provider I/O', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const text = artifact('notes.txt', 'text/plain', bytes);
    let fetches = 0;
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'test-model',
      fetch: (async () => {
        fetches++;
        return completedResponse();
      }) as typeof fetch,
      resolveArtifact: async () => bytes,
    });
    await expect(
      adapter.generate(
        { ...request, context: { ...request.context, artifacts: [text] } },
        { signal: new AbortController().signal, emit() {} },
      ),
    ).rejects.toThrow('does not support Artifact');
    expect(fetches).toBe(0);
  });

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
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'codex/gpt-6-sol',
      stream: true,
      output_config: { format: { type: 'json_schema' } },
    });
    expect(body.messages[0].content).toBe(JSON.stringify(request));
    expect(result.items).toEqual([{ type: 'text', text: 'OK' }]);
    expect(result.provider).toEqual({ name: 'claude-messages', model: 'codex/gpt-6-sol' });
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('emits normalized preview text from Messages SSE events', async () => {
    const result = JSON.stringify({
      items: [
        {
          type: 'text',
          text: 'Streamed answer',
          providerCallId: null,
          tool: null,
          input: { text: 'must not preview' },
          value: null,
        },
      ],
      finishReason: 'stop',
    });
    const chunks = [...result.matchAll(/[\s\S]{1,5}/g)].map((match) => match[0]);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const events = [
          {
            type: 'message_start',
            message: { type: 'message', model: 'claude-test', usage: { input_tokens: 11 } },
          },
          ...chunks.map((text) => ({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text },
          })),
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 4 },
          },
          { type: 'message_stop' },
        ];
        const wire = events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join('');
        for (let offset = 0; offset < wire.length; offset += 7)
          controller.enqueue(encoder.encode(wire.slice(offset, offset + 7)));
        controller.close();
      },
    });
    const adapter = createClaudeMessagesAdapter({
      accessToken: 'magpie',
      model: 'claude-test',
      fetch: (async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch,
    });
    const previews: string[] = [];
    const response = await adapter.generate(request, {
      signal: new AbortController().signal,
      emit(item) {
        if (item.type === 'text') previews.push(item.text);
      },
    });
    expect(adapter.capabilities.streaming).toBe(true);
    expect(previews.join('')).toBe('Streamed answer');
    expect(previews.join('')).not.toContain('must not preview');
    expect(response).toMatchObject({
      items: [{ type: 'text', text: 'Streamed answer' }],
      usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 },
      provider: { name: 'claude-messages', model: 'claude-test' },
    });
  });

  it('supports an unauthenticated local compatible router', async () => {
    let headers: HeadersInit | undefined;
    const adapter = createClaudeMessagesAdapter({
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'local-model',
      fetch: (async (_url, init) => {
        headers = init?.headers;
        return completedResponse();
      }) as typeof fetch,
    });
    await adapter.generate(request, {
      signal: new AbortController().signal,
      emit() {},
    });
    expect(headers).not.toHaveProperty('x-api-key');
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

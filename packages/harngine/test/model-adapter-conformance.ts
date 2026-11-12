import { describe, expect, test } from 'vitest';
import type { Json, ModelAdapter, ModelRequest, ModelUsage } from '../src/index.js';

export type AdapterConformanceReply =
  | { readonly kind: 'contract'; readonly value: Json; readonly usage?: ModelUsage }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'provider-error' }
  | { readonly kind: 'timeout' };

export interface AdapterConformanceSubject {
  readonly adapter: ModelAdapter;
  close?(): void | Promise<void>;
}

export type AdapterConformanceFactory = (
  reply: AdapterConformanceReply,
  options: { readonly timeoutMs: number },
) => AdapterConformanceSubject;

const toolId = 'conformance-lookup';

export function conformanceRequest(withTool = false): ModelRequest {
  return {
    object: 'model_request',
    instructions: ['Use Harngine evidence and return a structured response.'],
    context: {
      object: 'model_context',
      objective: 'Answer the conformance question',
      items: [],
      artifacts: [],
      policy: 'conformance',
      budget: { inputTokens: 2_000, estimatedTokens: 100 },
    },
    tools: withTool
      ? [
          {
            id: toolId,
            kind: 'tool',
            description: 'Look up one query.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1 },
              },
            },
            outputSchema: { type: 'string' },
          },
        ]
      : [],
  };
}

function envelope(
  item: { type: 'text' | 'tool-call'; text?: string; input?: Json },
  finishReason: 'stop' | 'length' | 'tool-calls',
): Json {
  return {
    items: [
      {
        type: item.type,
        text: item.text ?? null,
        providerCallId: item.type === 'tool-call' ? 'call-conformance' : null,
        tool: item.type === 'tool-call' ? toolId : null,
        input: item.input ?? null,
        value: null,
      },
    ],
    finishReason,
  };
}

export function describeModelAdapterConformance(
  name: string,
  create: AdapterConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    async function run(
      reply: AdapterConformanceReply,
      request: ModelRequest = conformanceRequest(),
      timeoutMs = 2_000,
    ) {
      const subject = create(reply, { timeoutMs });
      try {
        return await subject.adapter.generate(request, {
          signal: new AbortController().signal,
          emit() {},
        });
      } finally {
        await subject.close?.();
      }
    }

    test('normalizes structured text, finish reason, and usage', async () => {
      const result = await run({
        kind: 'contract',
        value: envelope({ type: 'text', text: 'conformant' }, 'length'),
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      });
      expect(result).toMatchObject({
        object: 'model_response',
        items: [{ type: 'text', text: 'conformant' }],
        finishReason: 'length',
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      });
    });

    test('normalizes Tool proposals and removes synthetic optional nulls', async () => {
      const result = await run(
        {
          kind: 'contract',
          value: envelope(
            { type: 'tool-call', input: { query: 'durable', limit: null } },
            'tool-calls',
          ),
        },
        conformanceRequest(true),
      );
      expect(result.items).toEqual([
        {
          type: 'tool-call',
          providerCallId: 'call-conformance',
          tool: toolId,
          input: { query: 'durable' },
        },
      ]);
      expect(result.finishReason).toBe('tool-calls');
    });

    test('rejects malformed structured output', async () => {
      const subject = create({ kind: 'malformed' }, { timeoutMs: 2_000 });
      try {
        await expect(
          subject.adapter.generate(conformanceRequest(), {
            signal: new AbortController().signal,
            emit() {},
          }),
        ).rejects.toBeDefined();
      } finally {
        await subject.close?.();
      }
    });

    test('surfaces provider failures as rejected model calls', async () => {
      const subject = create({ kind: 'provider-error' }, { timeoutMs: 2_000 });
      try {
        await expect(
          subject.adapter.generate(conformanceRequest(), {
            signal: new AbortController().signal,
            emit() {},
          }),
        ).rejects.toBeDefined();
      } finally {
        await subject.close?.();
      }
    });

    test('times out a stalled provider', async () => {
      const subject = create({ kind: 'timeout' }, { timeoutMs: 250 });
      try {
        await expect(
          subject.adapter.generate(conformanceRequest(), {
            signal: new AbortController().signal,
            emit() {},
          }),
        ).rejects.toBeDefined();
      } finally {
        await subject.close?.();
      }
    });

    test('honors caller cancellation of an active provider request', async () => {
      const subject = create({ kind: 'timeout' }, { timeoutMs: 2_000 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25);
      try {
        await expect(
          subject.adapter.generate(conformanceRequest(), {
            signal: controller.signal,
            emit() {},
          }),
        ).rejects.toBeDefined();
        expect(controller.signal.aborted).toBe(true);
      } finally {
        clearTimeout(timer);
        await subject.close?.();
      }
    });

    test('advertises the common logical adapter capabilities', async () => {
      const subject = create({ kind: 'malformed' }, { timeoutMs: 2_000 });
      await subject.close?.();
      expect(subject.adapter.id).not.toBe('');
      expect(subject.adapter.capabilities).toMatchObject({
        tools: true,
        structuredOutput: true,
      });
      if (subject.adapter.capabilities.inputModalities) {
        expect(
          subject.adapter.capabilities.inputModalities.every((modality) =>
            ['text', 'image', 'document', 'audio', 'video'].includes(modality),
          ),
        ).toBe(true);
        expect(new Set(subject.adapter.capabilities.inputModalities).size).toBe(
          subject.adapter.capabilities.inputModalities.length,
        );
      }
    });
  });
}

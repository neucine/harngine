import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  agent,
  createApp,
  guardrail,
  schema,
  workflow,
  type App,
  type AuditEntry,
  type AuditExportBatch,
  type ModelAdapter,
  type StateStoreBackend,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-audit-')));
  directories.push(value);
  return value;
}

function app(options: Parameters<typeof createApp>[0]) {
  const value = createApp(options);
  apps.push(value);
  return value;
}

const text = schema<string>({
  id: 'audit-streaming-text',
  version: '1',
  jsonSchema: { type: 'string' },
});

function final(value: string): Awaited<ReturnType<ModelAdapter['generate']>> {
  return {
    object: 'model_response',
    items: [{ type: 'text', text: value }],
    finishReason: 'stop',
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition was not met before timeout');
}

test.each(['better-sqlite3', 'node-sqlite'] as const)(
  '%s audit survives restart with stable payload-safe correlations',
  async (backend) => {
    const location = directory();
    const model: ModelAdapter = {
      id: 'audit-model',
      capabilities: { tools: false, structuredOutput: false, streaming: false },
      async generate() {
        return final('TOP-SECRET-MODEL-OUTPUT');
      },
    };
    const assistant = agent({
      id: 'audit-agent',
      instructions: 'Answer without exposing the fixture.',
      objective: text,
      model,
      guardrails: [
        guardrail({
          id: 'audit-guardrail',
          revision: 'rev_audit_guardrail_v1',
          stages: ['model-input'],
          check: () => ({ action: 'allow' }),
        }),
      ],
    });
    const questions = workflow({
      id: 'audit-questions',
      objective: text,
      result: text,
      run: (_objective, flow) =>
        flow.ask('audit-question', {
          prompt: 'TOP-SECRET-INTERACTION-PROMPT',
          response: text,
        }),
    });
    let first: App | undefined;
    let restored: App | undefined;
    try {
      first = app({
        directory: location,
        agents: [assistant],
        workflows: [questions],
        stateStore: { backend },
        access: { allowAuthenticated: true },
      });
      const session = await first.sessions.create({
        agent: assistant,
        title: 'TOP-SECRET-SESSION-TITLE',
      });
      const { work } = await session.send('TOP-SECRET-OBJECTIVE');
      await expect(work.result()).resolves.toBe('TOP-SECRET-MODEL-OUTPUT');

      const questioned = await first.start(questions, 'TOP-SECRET-WORKFLOW-OBJECTIVE');
      await waitUntil(async () => (await questioned.snapshot()).interactions.length > 0);

      const firstPage = await first.audit.list({ limit: 100 });
      const categories = new Set(firstPage.entries.map((entry) => entry.category));
      expect(categories).toEqual(
        new Set([
          'work',
          'decision',
          'authorization',
          'guardrail',
          'attempt',
          'interaction',
          'session',
        ]),
      );
      expect(firstPage.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'guardrail',
            guardrail: {
              id: 'audit-guardrail',
              revision: 'rev_audit_guardrail_v1',
            },
          }),
          expect.objectContaining({
            category: 'attempt',
            correlation: expect.objectContaining({
              workId: work.id,
              callId: expect.any(String),
              attemptId: expect.any(String),
            }),
          }),
          expect.objectContaining({
            category: 'interaction',
            correlation: expect.objectContaining({
              workId: questioned.id,
              interactionId: expect.any(String),
            }),
          }),
        ]),
      );
      const serialized = JSON.stringify(firstPage.entries);
      for (const secret of [
        'TOP-SECRET-MODEL-OUTPUT',
        'TOP-SECRET-OBJECTIVE',
        'TOP-SECRET-WORKFLOW-OBJECTIVE',
        'TOP-SECRET-INTERACTION-PROMPT',
        'TOP-SECRET-SESSION-TITLE',
      ])
        expect(serialized).not.toContain(secret);

      const stableIds = firstPage.entries.map((entry) => entry.id);
      await first.close();
      apps.splice(apps.indexOf(first), 1);
      first = undefined;

      restored = app({
        directory: location,
        agents: [assistant],
        workflows: [questions],
        stateStore: { backend },
        access: { allowAuthenticated: true },
      });
      const afterRestart = await restored.audit.list({ limit: 100 });
      expect(afterRestart.entries.map((entry) => entry.id)).toEqual(stableIds);

      const batches: AuditExportBatch[] = [];
      const exported = await restored.audit.export({
        format: 'otel',
        limit: 7,
        sink: { write: (batch) => void batches.push(batch) },
      });
      expect(exported).toMatchObject({
        object: 'audit_export',
        format: 'otel',
        exported: 7,
        next: expect.any(String),
      });
      await restored.audit.export({
        format: 'otel',
        after: exported.next!,
        sink: { write: (batch) => void batches.push(batch) },
      });
      expect(batches).toHaveLength(2);
      const otel = batches[0];
      expect(otel?.format).toBe('otel');
      if (otel?.format !== 'otel') throw new Error('Expected OTel export');
      const spans = batches.flatMap((batch) =>
        batch.format === 'otel'
          ? (
              ((batch.resourceSpans as unknown as Record<string, unknown>[])[0]?.scopeSpans as {
                spans: Record<string, unknown>[];
              }[]) ?? []
            ).flatMap((scope) => scope.spans)
          : [],
      );
      expect(spans.length).toBe(stableIds.length);
      for (const span of spans) {
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      }
      expect(JSON.stringify(otel)).not.toContain('TOP-SECRET');
    } finally {
      if (first) await first.close();
      if (restored) await restored.close();
    }
  },
);

test('Audit retention and redaction apply only to the read/export projection', async () => {
  const definition = agent({
    id: 'audit-retention-agent',
    instructions: 'Answer.',
    objective: text,
    model: {
      id: 'audit-retention-model',
      capabilities: { tools: false, structuredOutput: false, streaming: false },
      async generate() {
        return final('answer');
      },
    },
    guardrails: [
      guardrail({
        id: 'audit-retention-guardrail',
        revision: 'rev_audit_retention_v1',
        stages: ['model-input'],
        check: () => ({
          action: 'block',
          reason: { code: 'SAFE', message: 'private detail' },
        }),
      }),
    ],
  });
  const instance = app({
    directory: directory(),
    agents: [definition],
    audit: {
      retention: { maxAgeMs: 60_000 },
      redact: (entry) =>
        entry.reason?.message === 'private detail'
          ? { reason: { code: entry.reason.code, message: '[redacted]' } }
          : {},
    },
  });
  const work = await instance.start(definition, 'question');
  await expect(work.result()).rejects.toMatchObject({ code: 'SAFE' });

  const page = await instance.audit.list();
  expect(JSON.stringify(page.entries)).toContain('private detail');

  const batches: AuditExportBatch[] = [];
  await instance.audit.export({
    sink: { write: (batch) => void batches.push(batch) },
  });
  expect(JSON.stringify(batches)).toContain('[redacted]');
  expect(JSON.stringify(batches)).not.toContain('private detail');
  await expect(work.inspect({ detail: 'story' })).resolves.toMatchObject({
    work: { status: 'failed' },
  });

  const capped = app({
    directory: directory(),
    agents: [definition],
    audit: { retention: { maxEntries: 2 } },
  });
  const cappedWork = await capped.start(definition, 'question');
  await expect(cappedWork.result()).rejects.toMatchObject({ code: 'SAFE' });
  await expect(capped.audit.list()).resolves.toMatchObject({
    entries: [expect.any(Object), expect.any(Object)],
  });
  expect((await capped.audit.list()).entries).toHaveLength(2);
});

test.each(['better-sqlite3', 'node-sqlite'] as const)(
  '%s model item deltas are ordered, correlated, transient, and stop with the watch',
  async (backend: StateStoreBackend) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const emitting: ModelAdapter = {
      id: 'streaming-model',
      capabilities: { tools: false, structuredOutput: false, streaming: true },
      async generate(_request, { emit }) {
        await gate;
        emit({ type: 'text', text: 'EPHEMERAL-' });
        emit({ type: 'text', text: 'PREVIEW' });
        return final('durable final answer');
      },
    };
    const definition = agent({
      id: 'streaming-agent',
      instructions: 'Answer.',
      objective: text,
      model: emitting,
    });
    const instance = app({
      directory: directory(),
      agents: [definition],
      stateStore: { backend },
    });
    const work = await instance.start(definition, 'question');
    const deltas: import('../src/index.js').ModelDelta[] = [];
    const watching = await work.watch({ onModelDelta: (delta) => deltas.push(delta) });
    const consumed = (async () => {
      for await (const _update of watching) {
        // Durable updates still drive the cursor and completion boundary.
      }
    })();
    release();
    await expect(work.result()).resolves.toBe('durable final answer');
    await consumed;
    expect(deltas.map((delta) => delta.sequence)).toEqual([0, 1]);
    expect(deltas.map((delta) => delta.item)).toEqual([
      { type: 'text', text: 'EPHEMERAL-' },
      { type: 'text', text: 'PREVIEW' },
    ]);
    expect(deltas.every((delta) => delta.workId === work.id)).toBe(true);
    expect(new Set(deltas.map((delta) => delta.callId)).size).toBe(1);
    expect(new Set(deltas.map((delta) => delta.attemptId)).size).toBe(1);
    const inspection = await work.inspect({ detail: 'diagnostic' });
    expect(JSON.stringify(inspection)).not.toContain('EPHEMERAL-PREVIEW');
    const noListener = await instance.start(definition, 'question');
    await expect(noListener.result()).resolves.toBe('durable final answer');

    let secondRelease!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      secondRelease = resolve;
    });
    const delayed: ModelAdapter = {
      id: 'delayed-stream-model',
      capabilities: { tools: false, structuredOutput: false, streaming: true },
      async generate(_request, { emit }) {
        await secondGate;
        emit({ type: 'text', text: 'MUST-NOT-ARRIVE' });
        return final('answer');
      },
    };
    const delayedDefinition = agent({
      id: 'delayed-stream-agent',
      instructions: 'Answer.',
      objective: text,
      model: delayed,
    });
    const delayedInstance = app({
      directory: directory(),
      agents: [delayedDefinition],
      stateStore: { backend },
    });
    const delayedWork = await delayedInstance.start(delayedDefinition, 'question');
    const controller = new AbortController();
    const received: string[] = [];
    const stopped = await delayedWork.watch({
      signal: controller.signal,
      onModelDelta: (delta) => {
        if (delta.item.type === 'text') received.push(delta.item.text);
      },
    });
    const consuming = (async () => {
      for await (const _update of stopped) {
        // Intentionally stop by aborting the watcher.
      }
    })();
    const cancellation = expect(consuming).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    secondRelease();
    await expect(delayedWork.result()).resolves.toBe('answer');
    await cancellation;
    expect(received).toEqual([]);
  },
);

test('model-output guardrails suppress preview items and export failures do not change Work', async () => {
  const definition = agent({
    id: 'guarded-stream-agent',
    instructions: 'Answer.',
    objective: text,
    model: {
      id: 'guarded-stream-model',
      capabilities: { tools: false, structuredOutput: false, streaming: true },
      async generate(_request, { emit }) {
        emit({ type: 'text', text: 'UNGUARDED-PREVIEW' });
        return final('answer');
      },
    },
    guardrails: [
      guardrail({
        id: 'guarded-output',
        revision: 'rev_guarded_output_v1',
        stages: ['model-output'],
        check: () => ({ action: 'allow' }),
      }),
    ],
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, 'question');
  const previews: string[] = [];
  const watching = await work.watch({
    onModelDelta: (delta) => {
      if (delta.item.type === 'text') previews.push(delta.item.text);
    },
  });
  const consumed = (async () => {
    for await (const _update of watching) {
      // Drain until durable completion.
    }
  })();
  await expect(work.result()).resolves.toBe('answer');
  await consumed;
  expect(previews).toEqual([]);
  await expect(
    instance.audit.export({
      sink: {
        write() {
          throw new Error('collector unavailable');
        },
      },
    }),
  ).rejects.toThrow('collector unavailable');
  await expect(work.snapshot()).resolves.toMatchObject({ status: 'completed' });
});

test('Audit exposes stable entry shape with no payload fields', async () => {
  const definition = agent({
    id: 'audit-shape-agent',
    instructions: 'Answer.',
    objective: text,
    model: {
      id: 'audit-shape-model',
      capabilities: { tools: false, structuredOutput: false, streaming: false },
      async generate() {
        return final('answer');
      },
    },
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, 'question');
  await work.result();
  const page = await instance.audit.list({ category: ['work', 'decision', 'attempt'] });
  for (const entry of page.entries as AuditEntry[]) {
    expect(entry).toMatchObject({
      object: 'audit_entry',
      id: expect.any(String),
      category: expect.any(String),
      action: expect.any(String),
      recordedAt: expect.any(Number),
      principal: 'local',
      correlation: expect.any(Object),
    });
    expect(entry).not.toHaveProperty('objective');
    expect(entry).not.toHaveProperty('input');
    expect(entry).not.toHaveProperty('output');
    expect(entry).not.toHaveProperty('content');
  }
});

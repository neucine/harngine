import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenAIResponsesAdapter } from '@harngine/openai-responses';
import { captureWorkTrace, summarizeWorkTrace } from '@harngine/evaluation';
import type { Json, ModelAdapter, ModelRequest } from 'harngine';
import { createCodingApp } from '../src/app.js';

const apps: ReturnType<typeof createCodingApp>[] = [];
const roots: string[] = [];
const readToolId = 'coding.read';

afterEach(async () => {
  for (const instance of apps.splice(0)) await instance.app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-coding-model-')));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}

function stream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function item(
  value: { type: 'text'; text: string } | { type: 'tool-call'; tool: string; input: Json },
): Json {
  return value.type === 'text'
    ? {
        type: 'text',
        text: value.text,
        providerCallId: null,
        tool: null,
        input: null,
        value: null,
      }
    : {
        type: 'tool-call',
        text: null,
        providerCallId: `call-${value.tool}`,
        tool: value.tool,
        input: value.input,
        value: null,
      };
}

function response(value: Json, usage = false): Response {
  return new Response(
    stream([
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
          ...(usage
            ? {
                usage: {
                  input_tokens: 20,
                  output_tokens: 10,
                  total_tokens: 30,
                },
              }
            : {}),
        },
      })}\n\n`,
    ]),
    { status: 200 },
  );
}

async function requestContext(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as {
    input: { content: string }[];
  };
  return JSON.parse(body.input[0]!.content) as {
    context: {
      items: {
        type: string;
        call?: { tool: { id: string } };
        outcome?: { status: string; value?: Json };
      }[];
    };
  };
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for integration state');
}

test('coding Agent completes a read Tool loop through the Responses adapter', async () => {
  const root = repository({ 'README.md': 'Harngine marker: durable-read\n' });
  let requests = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    requests++;
    const input = await requestContext(init);
    const evidence = input.context.items.find(
      (entry) =>
        entry.type === 'tool_outcome' &&
        entry.call?.tool.id === 'coding.read' &&
        entry.outcome?.status === 'success',
    );
    if (!evidence)
      return response({
        items: [item({ type: 'tool-call', tool: 'coding.read', input: { path: 'README.md' } })],
        finishReason: 'tool-calls',
      });
    return response(
      {
        items: [item({ type: 'text', text: `Observed ${String(evidence.outcome!.value).trim()}` })],
        finishReason: 'stop',
      },
      true,
    );
  };
  const model = createOpenAIResponsesAdapter({
    accessToken: 'magpie',
    model: 'codex/gpt-6-sol',
    fetch: fetcher,
  });
  const coding = createCodingApp({ repo: root, writable: false, modelAdapter: model });
  apps.push(coding);
  const work = await coding.app.start(
    coding.assistant,
    'Read README.md and report the durable-read marker.',
  );
  await expect(work.result()).resolves.toContain('durable-read');
  expect(requests).toBe(2);
  expect(await work.inspect({ detail: 'diagnostic' })).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        type: 'call',
        tool: expect.objectContaining({ id: readToolId }),
        diagnostic: expect.objectContaining({
          outcome: expect.objectContaining({
            value: expect.stringContaining('durable-read'),
          }),
        }),
      }),
    ]),
  });
});

test('coding App can select a public API provider with an explicit model and token', async () => {
  const root = repository({ 'README.md': 'Provider selection fixture\n' });
  const coding = createCodingApp({
    repo: root,
    writable: false,
    provider: 'openai',
    modelId: 'gpt-test',
    apiToken: ['test', 'api', 'token'].join('-'),
  });
  apps.push(coding);

  expect(coding.provider).toBe('openai');
  expect(coding.model).toBe('gpt-test');
  expect(coding.readAssistant.model.id).toBe('openai-responses');
});

test('local Magpie uses the streaming Responses adapter by default', async () => {
  const root = repository({ 'README.md': 'Magpie streaming fixture\n' });
  const coding = createCodingApp({
    repo: root,
    writable: false,
    provider: 'magpie',
    modelId: 'codex/gpt-6.1-sol',
    apiToken: 'magpie',
  });
  apps.push(coding);

  expect(coding.provider).toBe('magpie');
  expect(coding.model).toBe('codex/gpt-6.1-sol');
  expect(coding.readAssistant.model.id).toBe('openai-responses');
  expect(coding.readAssistant.model.capabilities.streaming).toBe(true);
});

test('coding orchestrator exposes specialists and durable research/review composition', async () => {
  const root = repository({ 'README.md': 'Collaborative coding fixture\n' });
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'coding-specialist-fixture',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      requests.push(request);
      const text = request.instructions.join('\n');
      if (text.includes('researcher specialist'))
        return {
          object: 'model_response',
          items: [{ type: 'text', text: `researched: ${request.context.objective}` }],
          finishReason: 'stop',
        };
      if (text.includes('reviewer specialist'))
        return {
          object: 'model_response',
          items: [{ type: 'text', text: `reviewed: ${request.context.objective}` }],
          finishReason: 'stop',
        };
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'orchestrated result' }],
        finishReason: 'stop',
      };
    },
  };
  const coding = createCodingApp({
    repo: root,
    writable: true,
    modelAdapter: model,
  });
  apps.push(coding);

  await expect(coding.app.run(coding.orchestrator, 'Plan the change')).resolves.toBe(
    'orchestrated result',
  );
  expect(requests[0]!.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: coding.readAssistant.id, kind: 'agent' }),
      expect.objectContaining({ id: coding.writeAssistant.id, kind: 'agent' }),
      expect.objectContaining({ id: coding.reviewer.id, kind: 'agent' }),
    ]),
  );

  const work = await coding.app.start(coding.collaborativeReview, 'Review token rotation');
  await expect(work.result()).resolves.toContain('Research:\nresearched:');
  await expect(work.result()).resolves.toContain('Review:\nreviewed:');
  const works = (await coding.app.works.list()).works;
  expect(
    works.filter(
      (item) =>
        item.parentId === work.id &&
        [coding.readAssistant.id, coding.reviewer.id].includes(item.definition.id),
    ),
  ).toHaveLength(2);
  const entries = (await work.inspect()).entries.filter((entry) => entry.type === 'child');
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        phase: 'started',
        mode: 'concurrent',
        definition: expect.objectContaining({ kind: 'agent', id: coding.readAssistant.id }),
      }),
      expect.objectContaining({ phase: 'joined' }),
      expect.objectContaining({ phase: 'closed' }),
    ]),
  );
  const trace = await captureWorkTrace(coding.app.works, work.id);
  const metrics = summarizeWorkTrace(trace);
  expect(metrics).toMatchObject({
    complete: true,
    works: 3,
    completed: 3,
    childWork: 2,
  });
  expect(
    metrics.byWork.flatMap((item) =>
      item.children
        .filter((child) => child.status === 'completed')
        .map((child) => child.definition.id),
    ),
  ).toEqual(expect.arrayContaining([coding.readAssistant.id, coding.reviewer.id]));
});

test('coding Agent requires approval before edit and runs a check through the same adapter', async () => {
  const root = repository({ 'note.txt': 'before\n' });
  const fetcher: typeof fetch = async (_url, init) => {
    const input = await requestContext(init);
    const toolIds = input.context.items
      .filter((entry) => entry.type === 'tool_outcome' && entry.outcome?.status === 'success')
      .map((entry) => entry.call?.tool.id);
    if (!toolIds.includes('coding.edit'))
      return response({
        items: [
          item({
            type: 'tool-call',
            tool: 'coding.edit',
            input: { path: 'note.txt', oldText: 'before', newText: 'after' },
          }),
        ],
        finishReason: 'tool-calls',
      });
    if (!toolIds.includes('coding.check'))
      return response({
        items: [
          item({
            type: 'tool-call',
            tool: 'coding.check',
            input: { command: 'node', args: ['-e', 'process.exit(0)'] },
          }),
        ],
        finishReason: 'tool-calls',
      });
    return response({
      items: [item({ type: 'text', text: 'Edited and checked note.txt.' })],
      finishReason: 'stop',
    });
  };
  const model = createOpenAIResponsesAdapter({
    accessToken: 'magpie',
    model: 'codex/gpt-6-sol',
    fetch: fetcher,
  });
  const coding = createCodingApp({
    repo: root,
    writable: true,
    principal: 'desktop',
    requireEditApproval: true,
    modelAdapter: model,
  });
  apps.push(coding);
  const work = await coding.app.start(
    coding.assistant,
    'Change before to after and check the result.',
  );
  const interaction = await waitFor(async () => {
    const snapshot = await work.snapshot();
    return snapshot.interactions.find((entry) => entry.type === 'approval');
  });
  expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('before\n');
  await work.respond(interaction.id, true);
  await expect(work.result()).resolves.toBe('Edited and checked note.txt.');
  expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('after\n');
  const diagnostic = await work.inspect({ detail: 'diagnostic' });
  expect(
    diagnostic.entries.flatMap((entry) =>
      entry.type === 'call' && entry.phase === 'settled' ? [entry.tool.id] : [],
    ),
  ).toEqual(expect.arrayContaining(['coding.edit', 'coding.check']));
});

test('coding Agent restores completed Work and accepts new Work after restart', async () => {
  const root = repository({ 'README.md': 'restart evidence\n' });
  const runTurn: typeof fetch = async (_url, init) => {
    const input = await requestContext(init);
    const evidence = input.context.items.find(
      (entry) => entry.type === 'tool_outcome' && entry.call?.tool.id === 'coding.read',
    );
    if (!evidence)
      return response({
        items: [item({ type: 'tool-call', tool: 'coding.read', input: { path: 'README.md' } })],
        finishReason: 'tool-calls',
      });
    return response({
      items: [item({ type: 'text', text: String(evidence.outcome!.value).trim() })],
      finishReason: 'stop',
    });
  };
  let firstRequests = 0;
  const firstFetcher: typeof fetch = async (url, init) => {
    firstRequests++;
    return runTurn(url, init);
  };
  const firstModel = createOpenAIResponsesAdapter({
    accessToken: 'magpie',
    model: 'codex/gpt-6-sol',
    fetch: firstFetcher,
  });
  const first = createCodingApp({ repo: root, writable: false, modelAdapter: firstModel });
  apps.push(first);
  const work = await first.app.start(first.assistant, 'Read README.md and summarize it.');
  await expect(work.result()).resolves.toBe('restart evidence');
  expect(firstRequests).toBe(2);
  await first.app.close();
  apps.splice(apps.indexOf(first), 1);

  let restoredRequests = 0;
  const restoredFetcher: typeof fetch = async (url, init) => {
    restoredRequests++;
    return runTurn(url, init);
  };
  const restoredModel = createOpenAIResponsesAdapter({
    accessToken: 'magpie',
    model: 'codex/gpt-6-sol',
    fetch: restoredFetcher,
  });
  const restored = createCodingApp({
    repo: root,
    writable: false,
    modelAdapter: restoredModel,
  });
  apps.push(restored);
  const restoredWork = await restored.app.works.get(work.id);
  await expect(restoredWork.result()).resolves.toBe('restart evidence');
  expect(restoredRequests).toBe(0);
  const settledReads = (await restoredWork.inspect({ detail: 'diagnostic' })).entries.flatMap(
    (entry) =>
      entry.type === 'call' && entry.phase === 'settled' && entry.tool.id === 'coding.read'
        ? [entry]
        : [],
  );
  expect(settledReads).toHaveLength(1);
  const next = await restored.app.start(restored.assistant, 'Read README.md again.');
  await expect(next.result()).resolves.toBe('restart evidence');
  expect(restoredRequests).toBe(2);
});

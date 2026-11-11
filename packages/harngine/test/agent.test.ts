import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  tool,
  createRuntime,
  requestId,
  schema,
  type AgentModel,
  type Json,
  type Receipt,
  type SessionReceipt,
} from '../src/internal/index.js';
import type { ModelContext as LegacyModelContext } from '../src/internal/contracts.js';
import type { Runtime } from '../src/internal/runtime.js';

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-agent-')));
  dirs.push(value);
  return value;
}
function accepted<T>(receipt: Receipt<T> | SessionReceipt<T>): T {
  if (receipt.status !== 'accepted') throw new Error(JSON.stringify(receipt));
  return receipt.value;
}

function model(id: string, actions: (input: Json) => Json): AgentModel {
  return {
    id,
    version: '1',
    artifactDigest: `${id}-1`,
    invoke: async ({ input }) => ({ status: 'success', value: { response: actions(input) } }),
  };
}
function fixture(actions: (input: Json) => Json) {
  const text = schema<string>({ id: 'agent-text', version: '1', jsonSchema: { type: 'string' } });
  const modelAdapter = model('agent-model', actions);
  const lookup = tool<string, string>({
    id: 'lookup',
    version: '1',
    artifactDigest: 'lookup-1',
    description: 'Look up a question.',
    input: text,
    output: text,
    effect: 'read',
    invoke: async ({ input }) => ({ status: 'success', value: `found:${input}` }),
  });
  const definition = agent({
    id: 'research-agent',
    version: '1',
    artifactDigest: 'agent-1',
    instructions: 'Use lookup, then answer.',
    objective: text,
    result: text,
    model: modelAdapter,
    tools: [lookup],
    policy: { maxDecisions: 10, maxAttempts: 10 },
    context: { maxEntries: 5 },
  });
  return { model: modelAdapter, lookup, definition };
}

test('Agent owns the model/tool loop and exposes selected context to the model', async () => {
  const modelInputs: Json[] = [];
  const f = fixture((input) => {
    modelInputs.push(input);
    const context = input as LegacyModelContext;
    if (!context.items.some((item) => item.type === 'tool_outcome'))
      return { type: 'call', tool: { id: 'lookup', version: '1' }, input: context.objective };
    return { type: 'complete', result: 'done' };
  });
  const runtime = createRuntime({ directory: directory(), agents: [f.definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const work = accepted(
    await api.work.start(f.definition, {
      requestId: requestId('start'),
      objective: 'question',
      context: [{ prior: 'fact' }],
    }),
  );
  await runtime.drain();
  expect(await api.work.result(work)).toEqual({ status: 'completed', result: 'done' });
  expect(modelInputs).toHaveLength(2);
  expect(modelInputs[0]).toMatchObject({
    instructions: 'Use lookup, then answer.',
    objective: 'question',
    items: [{ type: 'reference', content: { prior: 'fact' } }],
    turn: 0,
  });
  expect(modelInputs[1]).toMatchObject({
    items: [
      { type: 'reference' },
      {
        type: 'tool_outcome',
        call: { tool: { id: 'lookup', version: '1' }, input: 'question' },
        outcome: { status: 'success', value: 'found:question' },
      },
    ],
  });
  expect((await api.work.inspect(work)).calls.map((call) => call.slot)).toEqual([
    'r1:model:0',
    'r1:tool:0',
    'r1:model:1',
  ]);
});

test('Agent derives the model contract from tools and defaults to text output', async () => {
  const text = schema<string>({ id: 'derived-text', version: '1', jsonSchema: { type: 'string' } });
  const lookup = tool<string, string>({
    id: 'derived-lookup',
    version: '1',
    artifactDigest: 'lookup',
    description: 'Look up one term.',
    input: text,
    output: text,
    effect: 'read',
    invoke: async ({ input }) => ({ status: 'success', value: input }),
  });
  let suppliedSchema: Json | null = null;
  let suppliedInput: Json | null = null;
  const modelAdapter: AgentModel = {
    id: 'derived-model',
    version: '1',
    artifactDigest: 'model',
    invoke: async ({ input, responseSchema }) => {
      suppliedInput = input;
      suppliedSchema = responseSchema;
      return { status: 'success', value: { response: { type: 'complete', result: 'plain text' } } };
    },
  };
  const definition = agent({
    id: 'derived-agent',
    version: '1',
    artifactDigest: 'agent',
    instructions: 'Answer or use lookup.',
    objective: text,
    model: modelAdapter,
    tools: [lookup],
    policy: { maxDecisions: 4, maxAttempts: 2 },
  });
  const runtime = createRuntime({ directory: directory(), agents: [definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const work = accepted(
    await api.work.start(definition, { requestId: requestId('derived'), objective: 'question' }),
  );
  await runtime.drain();
  expect(await api.work.result(work)).toEqual({ status: 'completed', result: 'plain text' });
  expect(suppliedSchema).toEqual(definition.modelResponse.jsonSchema);
  expect(suppliedInput).toMatchObject({
    tools: [
      {
        id: 'derived-lookup',
        description: 'Look up one term.',
        inputSchema: { type: 'string' },
        outputSchema: { type: 'string' },
      },
    ],
  });
  expect(definition.result.jsonSchema).toEqual({ type: 'string' });
});

test('Agent exposure requires a semantic Tool description while Workflow tools remain low-level', () => {
  const text = schema<string>({
    id: 'description-text',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const undescribed = tool<string, string>({
    id: 'undescribed',
    version: '1',
    artifactDigest: 'tool',
    input: text,
    output: text,
    effect: 'read',
    invoke: async ({ input }) => ({ status: 'success', value: input }),
  });
  const modelAdapter = model('description-model', () => ({ type: 'complete', result: 'done' }));
  expect(() =>
    agent({
      id: 'description-agent',
      version: '1',
      artifactDigest: 'agent',
      instructions: 'Use tools.',
      objective: text,
      model: modelAdapter,
      tools: [undescribed],
      policy: { maxDecisions: 2, maxAttempts: 1 },
    }),
  ).toThrowError(/requires a description/);
});

test('Session.send atomically records intake, selects history, and starts bound Agent Work', async () => {
  const contexts: Json[] = [];
  const f = fixture((input) => {
    contexts.push((input as LegacyModelContext).items as unknown as Json);
    return { type: 'complete', result: `answered:${(input as LegacyModelContext).objective}` };
  });
  const dir = directory();
  const runtime = createRuntime({ directory: dir, agents: [f.definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const session = accepted(
    await api.session.create({
      requestId: requestId('session'),
      title: 'Research',
      agent: f.definition,
    }),
  );
  expect((await api.session.inspect(session)).agent).toEqual({
    id: f.definition.id,
    version: f.definition.version,
  });
  const first = accepted(
    await api.session.send(session, { requestId: requestId('first'), content: 'one' }),
  );
  const secondRequest = { requestId: requestId('second'), content: 'two' };
  const secondReceipt = await api.session.send(session, secondRequest);
  const second = accepted(secondReceipt);
  expect(first.route).toBe('started');
  expect(second.route).toBe('queued');
  expect((await api.work.inspect(second.work)).status).toBe('active');
  await runtime.drain();
  expect(await api.work.result(first.work)).toEqual({
    status: 'completed',
    result: 'answered:one',
  });
  expect(await api.session.send(session, secondRequest)).toEqual(secondReceipt);
  expect(await api.work.result(second.work)).toEqual({
    status: 'completed',
    result: 'answered:two',
  });
  expect(contexts).toEqual([
    [],
    [
      { type: 'input', content: 'one', source: { type: 'work_context', index: 0 } },
      { type: 'output', content: 'answered:one', source: { type: 'work_context', index: 1 } },
    ],
  ]);
  expect((await api.session.history(session)).entries.map((entry) => entry.entry)).toEqual([
    expect.objectContaining({ type: 'input', content: 'one' }),
    expect.objectContaining({ type: 'input', content: 'two', route: 'queued' }),
    expect.objectContaining({ type: 'output', content: 'answered:one' }),
    expect.objectContaining({ type: 'work', work: second.work }),
    expect.objectContaining({ type: 'output', content: 'answered:two' }),
  ]);
  await runtime.close();
  const restored = createRuntime({ directory: dir, agents: [f.definition] });
  runtimes.push(restored);
  const restoredApi = restored.forCaller({ principal: 'owner', source: 'test' });
  expect(await restoredApi.session.send(session, secondRequest)).toEqual(secondReceipt);
  expect((await restoredApi.session.inspect(session)).foregroundWork).toBeNull();
});

test('queued Session Work survives restart and is promoted in FIFO order', async () => {
  const f = fixture((input) => ({
    type: 'complete',
    result: `answered:${(input as LegacyModelContext).objective}`,
  }));
  const dir = directory();
  const firstRuntime = createRuntime({ directory: dir, agents: [f.definition] });
  runtimes.push(firstRuntime);
  const firstApi = firstRuntime.forCaller({ principal: 'owner', source: 'test' });
  const session = accepted(
    await firstApi.session.create({
      requestId: requestId('restart-session'),
      title: 'Restart queue',
      agent: f.definition,
    }),
  );
  const first = accepted(
    await firstApi.session.send(session, {
      requestId: requestId('restart-first'),
      content: 'one',
    }),
  );
  const second = accepted(
    await firstApi.session.send(session, {
      requestId: requestId('restart-second'),
      content: 'two',
    }),
  );
  expect(second.route).toBe('queued');
  await firstRuntime.close();

  const restored = createRuntime({ directory: dir, agents: [f.definition] });
  runtimes.push(restored);
  const restoredApi = restored.forCaller({ principal: 'owner', source: 'test' });
  await restored.drain();
  expect(await restoredApi.work.result(first.work)).toEqual({
    status: 'completed',
    result: 'answered:one',
  });
  expect(await restoredApi.work.result(second.work)).toEqual({
    status: 'completed',
    result: 'answered:two',
  });
  expect((await restoredApi.session.inspect(session)).foregroundWork).toBeNull();
  expect((await restoredApi.session.inspect(session)).queuedWork).toEqual([]);
});

test('Agent-generated schema rejects a model call outside the declared tool set', async () => {
  const f = fixture(() => ({
    type: 'call',
    tool: { id: 'not-allowed', version: '1' },
    input: null,
  }));
  const runtime = createRuntime({ directory: directory(), agents: [f.definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const work = accepted(
    await api.work.start(f.definition, { requestId: requestId('start'), objective: 'question' }),
  );
  await runtime.drain();
  expect(await api.work.result(work)).toMatchObject({
    status: 'failed',
    reason: { code: 'MODEL_FAILURE' },
  });
});

test('Agent ask creates an inspectable reply wait and resumes with the answer', async () => {
  const text = schema<string>({ id: 'reply-text', version: '1', jsonSchema: { type: 'string' } });
  let calls = 0;
  const modelAdapter = model('reply-model', (input) =>
    ++calls === 1
      ? { type: 'ask', question: 'Which order?' }
      : {
          type: 'complete',
          result: (input as LegacyModelContext).items.find((item) => item.type === 'reply')!
            .content,
        },
  );
  const definition = agent({
    id: 'reply-agent',
    version: '1',
    artifactDigest: '1',
    instructions: 'Ask when needed.',
    objective: text,
    result: text,
    model: modelAdapter,
    policy: { maxDecisions: 8, maxAttempts: 3 },
    reply: { schema: text, responders: ['owner'] },
  });
  const runtime = createRuntime({ directory: directory(), agents: [definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const work = accepted(
    await api.work.start(definition, { requestId: requestId('start'), objective: 'help' }),
  );
  await runtime.drain();
  const waiting = await api.work.inspect(work);
  expect(waiting).toMatchObject({ status: 'waiting', state: { question: 'Which order?' } });
  expect(waiting.waits).toHaveLength(1);
  await api.work.reply(work, {
    requestId: requestId('reply'),
    wait: waiting.waits[0]!.wait,
    payload: 'ORD-1',
  });
  await runtime.drain();
  expect(await api.work.result(work)).toEqual({ status: 'completed', result: 'ORD-1' });
});

test('objective revision resets Agent turns and excludes calls from the old revision', async () => {
  const seen: { objective: Json; items: readonly Json[] }[] = [];
  const text = schema<string>({ id: 'revise-text', version: '1', jsonSchema: { type: 'string' } });
  const modelAdapter = model('revise-model', (input) => {
    const value = input as LegacyModelContext;
    seen.push({ objective: value.objective, items: value.items });
    return value.objective === 'old'
      ? { type: 'ask', question: 'More?' }
      : { type: 'complete', result: 'new-result' };
  });
  const definition = agent({
    id: 'revise-agent',
    version: '1',
    artifactDigest: '1',
    instructions: 'Handle revisions.',
    objective: text,
    result: text,
    model: modelAdapter,
    policy: { maxDecisions: 8, maxAttempts: 3 },
    reply: { schema: text, responders: ['owner'] },
  });
  const runtime = createRuntime({ directory: directory(), agents: [definition] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const work = accepted(
    await api.work.start(definition, { requestId: requestId('start'), objective: 'old' }),
  );
  await runtime.drain();
  const waiting = await api.work.inspect(work);
  await api.work.revise(work, {
    requestId: requestId('revise'),
    expectedControl: waiting.controlToken,
    objective: 'new',
  });
  await runtime.drain();
  expect(await api.work.result(work)).toEqual({ status: 'completed', result: 'new-result' });
  expect(seen.map((item) => [item.objective, item.items.length])).toEqual([
    ['old', 0],
    ['new', 0],
  ]);
});

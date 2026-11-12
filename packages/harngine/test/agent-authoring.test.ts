import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import {
  ConflictError,
  WorkFailedError,
  agent,
  createApp,
  schema,
  tool,
  workflow,
  type App,
  type ModelAdapter,
  type ModelRequest,
  type WorkId,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];
const processes: ChildProcess[] = [];

afterEach(async () => {
  for (const child of processes.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-agent-')));
  directories.push(value);
  return value;
}

const text = schema<string>({ id: 'text', version: '1', jsonSchema: { type: 'string' } });

test('open-loop Agent accepts native Tool calls and completes with text', async () => {
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'fixture-model',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      requests.push(request);
      if (requests.length === 1)
        return {
          items: [
            {
              type: 'tool-call',
              providerCallId: 'lookup-1',
              tool: 'lookup',
              input: 'question',
            },
          ],
          object: 'model_response',
          finishReason: 'tool-calls',
        };
      return {
        items: [{ type: 'text', text: 'The recorded answer is 42.' }],
        object: 'model_response',
        finishReason: 'stop',
      };
    },
  };
  const lookup = tool({
    id: 'lookup',
    description: 'Look up the answer for a question.',
    input: text,
    output: text,
    effect: 'read',
    execute: () => '42',
  });
  const assistant = agent({
    id: 'assistant',
    instructions: 'Use evidence and answer concisely.',
    objective: text,
    model,
    tools: [lookup],
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);

  await expect(app.run(assistant, 'What is the answer?')).resolves.toBe(
    'The recorded answer is 42.',
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]!.tools[0]).toMatchObject({ id: 'lookup' });
  expect(requests[1]!.context.items.some((item) => item.type === 'tool_outcome')).toBe(true);
});

test('Agent delegates only explicitly exposed CallTargets and receives child Closure context', async () => {
  const parentRequests: ModelRequest[] = [];
  const parentModel: ModelAdapter = {
    id: 'delegating-model',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      parentRequests.push(request);
      if (parentRequests.length === 1)
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'research-1',
              tool: 'specialist.researcher',
              input: 'Collect the evidence',
            },
          ],
          finishReason: 'tool-calls',
        };
      const outcome = request.context.items.find((item) => item.type === 'child_outcome');
      return {
        object: 'model_response',
        items: [
          {
            type: 'text',
            text:
              outcome?.type === 'child_outcome' && outcome.closure.status === 'completed'
                ? String(outcome.closure.result)
                : 'missing child Closure',
          },
        ],
        finishReason: 'stop',
      };
    },
  };
  const researcherModel: ModelAdapter = {
    id: 'research-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      return {
        object: 'model_response',
        items: [{ type: 'text', text: `evidence for ${request.context.objective}` }],
        finishReason: 'stop',
      };
    },
  };
  const researcher = agent({
    id: 'specialist.researcher',
    instructions: 'Collect evidence.',
    objective: text,
    model: researcherModel,
  });
  const registeredOnly = agent({
    id: 'specialist.registered-only',
    instructions: 'This Agent is registered but must not be exposed.',
    objective: text,
    model: researcherModel,
  });
  const orchestrator = agent({
    id: 'orchestrator',
    instructions: 'Delegate research when evidence is needed.',
    objective: text,
    model: parentModel,
    delegates: [
      {
        target: researcher,
        description: 'Research one bounded question and return evidence.',
      },
    ],
  });
  const app = createApp({
    directory: directory(),
    agents: [orchestrator, researcher, registeredOnly],
  });
  apps.push(app);

  await expect(app.run(orchestrator, 'Answer with evidence')).resolves.toBe(
    'evidence for Collect the evidence',
  );
  expect(parentRequests[0]!.tools).toEqual([
    expect.objectContaining({ id: 'specialist.researcher', kind: 'agent' }),
  ]);
  expect(parentRequests[0]!.tools.some((item) => item.id === registeredOnly.id)).toBe(false);
  expect((await app.works.list()).works).toHaveLength(2);
  expect(
    parentRequests[1]!.context.items.some(
      (item) =>
        item.type === 'child_outcome' &&
        item.call.target.id === researcher.id &&
        item.closure.status === 'completed',
    ),
  ).toBe(true);
});

test('concurrent Agent delegate lets the parent complete a Tool step before joining', async () => {
  const child = workflow({
    id: 'concurrent-researcher',
    objective: text,
    result: text,
    run: async (objective, flow) => {
      const evidence = await flow.ask('release', {
        prompt: 'Release research evidence?',
        response: text,
      });
      return `${objective}: ${evidence}`;
    },
  });
  const parentRequests: ModelRequest[] = [];
  let parentTurns = 0;
  const parentModel: ModelAdapter = {
    id: 'concurrent-orchestrator-model',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      parentRequests.push(request);
      parentTurns++;
      if (parentTurns === 1) {
        expect(request.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: child.id, kind: 'workflow' }),
            expect.objectContaining({ id: 'record', kind: 'tool' }),
          ]),
        );
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'research-1',
              tool: child.id,
              input: 'Evaluate the design',
            },
            {
              type: 'tool-call',
              providerCallId: 'record-1',
              tool: 'record',
              input: 'parent-made-progress',
            },
          ],
          finishReason: 'tool-calls',
        };
      }
      const outcome = request.context.items.find((item) => item.type === 'child_outcome');
      return {
        object: 'model_response',
        items: [
          {
            type: 'text',
            text:
              outcome?.type === 'child_outcome' && outcome.closure.status === 'completed'
                ? String(outcome.closure.result)
                : 'missing child Closure',
          },
        ],
        finishReason: 'stop',
      };
    },
  };
  const record = tool({
    id: 'record',
    description: 'Record useful parent progress while the child runs.',
    input: text,
    output: text,
    effect: 'read',
    execute: (input) => input,
  });
  const orchestrator = agent({
    id: 'concurrent-orchestrator',
    instructions: 'Delegate concurrent research and make local progress.',
    objective: text,
    model: parentModel,
    tools: [record],
    delegates: [
      {
        target: child,
        description: 'Research and return evidence.',
        mode: 'concurrent',
      },
    ],
  });
  const app = createApp({
    directory: directory(),
    agents: [orchestrator],
    workflows: [child],
  });
  apps.push(app);

  const work = await app.start(orchestrator, 'Design review');
  let snapshot = await work.snapshot();
  for (let index = 0; index < 50; index++) {
    if (snapshot.childWorkIds.length) {
      const inspected = await work.inspect({ detail: 'diagnostic' });
      if (
        inspected.entries.some(
          (entry) =>
            entry.type === 'call' && entry.phase === 'settled' && entry.tool.id === record.id,
        )
      )
        break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    snapshot = await work.snapshot();
  }
  expect(snapshot.childWorkIds).toHaveLength(1);
  const childWork = await app.works.get(snapshot.childWorkIds[0]!);
  let childSnapshot = await childWork.snapshot();
  for (let index = 0; index < 50 && !childSnapshot.interactions.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    childSnapshot = await childWork.snapshot();
  }
  expect(childSnapshot).toMatchObject({ status: 'waiting' });
  expect((await work.snapshot()).status).toBe('waiting');
  await childWork.respond(childSnapshot.interactions[0]!.id, 'approved evidence');
  await expect(work.result()).resolves.toBe('Evaluate the design: approved evidence');
  expect(parentTurns).toBe(2);
  expect(parentRequests[1]!.context.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'tool_outcome' }),
      expect.objectContaining({ type: 'child_outcome' }),
    ]),
  );
  const childEntry = (await work.inspect()).entries.find(
    (entry) => entry.type === 'child' && entry.phase === 'started',
  );
  expect(childEntry).toMatchObject({
    callId: expect.stringMatching(/^call_/),
    mode: 'concurrent',
    definition: { kind: 'workflow', id: child.id },
  });
});

test('Agent preserves a failed model call instead of proposing its slot again', async () => {
  const model: ModelAdapter = {
    id: 'failing-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      throw new Error('provider unavailable');
    },
  };
  const assistant = agent({
    id: 'failing-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'question');

  await expect(work.result()).rejects.toMatchObject({
    code: 'MODEL_FAILED',
    message: 'provider unavailable',
  });
  expect((await work.inspect({ detail: 'diagnostic' })).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        object: 'inspection_entry',
        type: 'work.closed',
        status: 'failed',
        error: { code: 'MODEL_FAILED', message: 'provider unavailable' },
      }),
    ]),
  );
});

test('closing aborts an active model request and restart retries that turn', async () => {
  const directoryPath = directory();
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted!: () => void;
  const cancellationObserved = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  let calls = 0;
  const model: ModelAdapter = {
    id: 'interruptible-model',
    capabilities: { tools: false, structuredOutput: false, streaming: true },
    generate(_request, { signal }) {
      calls++;
      if (calls > 1)
        return Promise.resolve({
          object: 'model_response',
          items: [{ type: 'text', text: 'resumed after restart' }],
          finishReason: 'stop',
        });
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted();
            reject(new Error('request aborted'));
          },
          { once: true },
        );
      });
    },
  };
  const assistant = agent({
    id: 'interruptible-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const first = createApp({ directory: directoryPath, agents: [assistant] });
  apps.push(first);
  const work = await first.start(assistant, 'continue after shutdown');
  await entered;

  const closed = await Promise.race([
    first.close().then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  expect(closed).toBe(true);
  await cancellationObserved;

  const restored = createApp({ directory: directoryPath, agents: [assistant] });
  apps.push(restored);
  const restartedWork = await restored.works.get(work.id);
  await expect(restartedWork.result({ signal: AbortSignal.timeout(2_000) })).resolves.toBe(
    'resumed after restart',
  );
  expect(calls).toBe(2);
});

test('restart recovers a process killed during a model request', async () => {
  const directoryPath = directory();
  const child = fork(
    fileURLToPath(new URL('./agent-model-worker.mjs', import.meta.url)),
    [directoryPath],
    { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  processes.push(child);
  const message = (await once(child, 'message'))[0] as { readonly workId: string };
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;

  let calls = 0;
  const model: ModelAdapter = {
    id: 'crash-model',
    capabilities: { tools: false, structuredOutput: false, streaming: true },
    async generate() {
      calls++;
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'recovered after process failure' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'crash-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const restored = createApp({ directory: directoryPath, agents: [assistant] });
  apps.push(restored);
  const work = await restored.works.get(message.workId as WorkId);
  await expect(work.result({ signal: AbortSignal.timeout(2_000) })).resolves.toBe(
    'recovered after process failure',
  );
  expect(calls).toBe(1);
});

test('structured Agent result is opt-in through a data model item', async () => {
  const result = schema<{ priority: string }>({
    id: 'priority-result',
    version: '1',
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['priority'],
      properties: { priority: { type: 'string' } },
    },
  });
  const model: ModelAdapter = {
    id: 'strict-model',
    capabilities: { tools: false, structuredOutput: true, streaming: false },
    async generate() {
      return {
        items: [{ type: 'data', value: { priority: 'critical' } }],
        object: 'model_response',
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'triage',
    instructions: 'Classify the task.',
    objective: text,
    result,
    publish: false,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);

  await expect(app.run(assistant, 'security defect')).resolves.toEqual({ priority: 'critical' });
  const session = await app.sessions.create({ agent: assistant, title: 'Private result' });
  const sent = await session.send('another defect');
  await expect(sent.work.result()).resolves.toEqual({ priority: 'critical' });
  expect(await session.messages()).toMatchObject([
    { author: 'human', content: 'another defect', workId: sent.work.id },
  ]);
});

test('Agent inspection separates the safe story from normalized model diagnostics', async () => {
  const model: ModelAdapter = {
    id: 'inspection-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      return {
        items: [{ type: 'text', text: 'inspected answer' }],
        object: 'model_response',
        finishReason: 'stop',
        provider: { name: 'fixture', model: 'inspection' },
      };
    },
  };
  const assistant = agent({
    id: 'inspection-agent',
    instructions: 'A private instruction retained only in diagnostics.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'inspect this');
  await expect(work.result()).resolves.toBe('inspected answer');

  const story = await work.inspect({ detail: 'story' });
  expect(story.entries.map((entry) => entry.type)).toEqual([
    'work.started',
    'decision',
    'decision',
    'work.closed',
  ]);
  expect(story.entries.every((entry) => !('diagnostic' in entry))).toBe(true);
  expect(JSON.stringify(story.entries)).not.toContain('private instruction');

  const diagnostic = await work.inspect({ detail: 'diagnostic' });
  expect(diagnostic.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        object: 'inspection_entry',
        type: 'decision',
        diagnostic: expect.objectContaining({
          modelRequest: expect.objectContaining({
            instructions: ['A private instruction retained only in diagnostics.'],
          }),
          modelResponse: expect.objectContaining({
            items: [{ type: 'text', text: 'inspected answer' }],
            provider: { name: 'fixture', model: 'inspection' },
          }),
        }),
      }),
    ]),
  );
});

test('Session projections pin the Agent revision and creation is retry-safe', async () => {
  const model: ModelAdapter = {
    id: 'session-projection-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'session-projection-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const description = app.describe(assistant);
  if (description.kind !== 'agent') throw new Error('expected Agent');

  const first = await app.sessions.create({
    agent: description,
    title: 'Exact revision',
    idempotencyKey: 'create-exact-session',
  });
  const replay = await app.sessions.create({
    agent: description,
    title: 'Exact revision',
    idempotencyKey: 'create-exact-session',
  });
  expect(replay.id).toBe(first.id);
  const snapshot = await first.snapshot();
  expect(snapshot).toMatchObject({
    id: first.id,
    agent: { kind: 'agent', id: assistant.id, revision: assistant.revision },
    foregroundWorkId: null,
  });
  expect(snapshot.createdAt).toBeLessThanOrEqual(snapshot.updatedAt);
  expect((await app.sessions.list()).sessions[0]).toMatchObject({
    id: first.id,
    agent: { kind: 'agent', id: assistant.id, revision: assistant.revision },
  });
});

test('Session queues later Work and promotes it after foreground Work publishes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const model: ModelAdapter = {
    id: 'session-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      calls++;
      if (calls === 1) await gate;
      return {
        items: [{ type: 'text', text: `Answer: ${request.context.objective}` }],
        object: 'model_response',
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'session-assistant',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const session = await app.sessions.create({ agent: assistant, title: 'Assistant' });
  const first = await session.send('one');
  const second = await session.send('two');
  const canceled = await session.send('three');
  await expect(second.work.snapshot()).resolves.toMatchObject({ status: 'queued' });
  await expect(session.snapshot()).resolves.toMatchObject({
    foregroundWorkId: first.work.id,
    queuedWorkIds: [second.work.id, canceled.work.id],
  });
  await canceled.work.cancel('No longer needed');
  await expect(session.snapshot()).resolves.toMatchObject({
    foregroundWorkId: first.work.id,
    queuedWorkIds: [second.work.id],
  });
  release();
  await expect(first.work.result()).resolves.toBe('Answer: one');
  await expect(second.work.result()).resolves.toBe('Answer: two');
  expect(await session.messages()).toMatchObject([
    { author: 'human', content: 'one' },
    { author: 'human', content: 'two' },
    { author: 'human', content: 'three' },
    { author: 'agent', content: 'Answer: one', workId: first.work.id },
    { author: 'agent', content: 'Answer: two', workId: second.work.id },
  ]);
  await expect(session.snapshot()).resolves.toMatchObject({
    foregroundWorkId: null,
    queuedWorkIds: [],
  });
  await expect(session.close()).resolves.toMatchObject({ status: 'closed' });
});

test('Session lists are principal scoped and Messages page backward from the newest', async () => {
  const model: ModelAdapter = {
    id: 'list-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      return {
        items: [{ type: 'text', text: `Answer: ${request.context.objective}` }],
        object: 'model_response',
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'list-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({
    directory: directory(),
    agents: [assistant],
    access: { allowAuthenticated: true },
  });
  apps.push(app);
  const first = await app.sessions.create({ agent: assistant, title: 'First' });
  const second = await app.sessions.create({ agent: assistant, title: 'Second' });
  expect(first.id).toMatch(/^session_[A-Za-z0-9_-]{16}$/);
  const sent = await second.send('hello');
  await sent.work.result();
  const latest = await second.messages({ limit: 1 });
  expect(latest[0]!.id).toMatch(/^message_[A-Za-z0-9_-]{16}_[0-9a-z]+$/);
  expect(latest).toMatchObject([{ author: 'agent', content: 'Answer: hello' }]);
  expect(await second.messages({ before: latest[0]!.id, limit: 1 })).toMatchObject([
    { author: 'human', content: 'hello' },
  ]);
  const page = await app.sessions.list({ limit: 1 });
  expect(page.sessions).toMatchObject([{ id: second.id, title: 'Second' }]);
  expect(page.next).not.toBeNull();
  expect((await app.sessions.list({ page: page.next!, limit: 1 })).sessions).toMatchObject([
    { id: first.id, title: 'First' },
  ]);
  const other = app.forPrincipal('other');
  await other.sessions.create({ agent: assistant, title: 'Other' });
  expect((await other.sessions.list()).sessions).toHaveLength(1);
  expect((await app.sessions.list()).sessions).toHaveLength(2);
});

test('Session watch aggregates bound Work and Message updates with reconnectable state', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const model: ModelAdapter = {
    id: 'session-watch-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      entered();
      await gate;
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'complete' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'session-watch-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const session = await app.sessions.create({ agent: assistant, title: 'Watch' });
  const { work } = await session.send('start');
  await started;
  const watching = await session.watch();
  const cursor = watching.cursor!;
  expect(watching.value).toMatchObject({
    status: 'open',
    recentMessages: [{ author: 'human', content: 'start' }],
    foregroundWorkId: work.id,
  });
  release();
  await work.result();
  await session.close();
  const events: string[] = [];
  for await (const update of watching) events.push(update.value.event);
  expect(events).toContain('work.updated');
  expect(events).toContain('message.appended');
  expect(events.at(-1)).toBe('session.closed');
  expect(watching.value).toMatchObject({
    status: 'closed',
    foregroundWorkId: null,
    recentMessages: [
      { author: 'human', content: 'start' },
      { author: 'agent', content: 'complete' },
    ],
  });

  const replay = await session.watch({ after: cursor });
  expect(replay.value).toMatchObject({ status: 'open', foregroundWorkId: work.id });
});

test('steering active Agent Work fences the earlier model answer', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let turn = 0;
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'steering-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      requests.push(request);
      turn++;
      if (turn === 1) {
        entered();
        await gate;
        return {
          object: 'model_response',
          items: [{ type: 'text', text: 'stale' }],
          finishReason: 'stop',
        };
      }
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'updated' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'steering-assistant',
    instructions: 'Follow the latest input.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'original');
  await started;
  await work.steer('additional information');
  release();
  await expect(work.result()).resolves.toBe('updated');
  expect(requests[1]!.context.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'input', content: 'additional information' }),
    ]),
  );
  await expect(work.steer('late')).rejects.toBeInstanceOf(ConflictError);
});

test('steering Session Work atomically records the message with the Work input', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let turn = 0;
  const model: ModelAdapter = {
    id: 'session-steering-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      turn++;
      if (turn === 1) {
        entered();
        await gate;
        return {
          object: 'model_response',
          items: [{ type: 'text', text: 'stale' }],
          finishReason: 'stop',
        };
      }
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'updated' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'session-steering-agent',
    instructions: 'Follow steering.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const session = await app.sessions.create({ agent: assistant, title: 'Steering' });
  const { work } = await session.send('original');
  await started;
  await work.steer('additional information');
  expect(await session.messages()).toMatchObject([
    { author: 'human', content: 'original' },
    { author: 'human', content: 'additional information' },
  ]);
  release();
  await expect(work.result()).resolves.toBe('updated');
  expect(await session.messages()).toMatchObject([
    { author: 'human', content: 'original' },
    { author: 'human', content: 'additional information' },
    { author: 'agent', content: 'updated' },
  ]);
});

test('ContextPolicy selects recorded sources and its identity is part of each model request', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'context-model',
    capabilities: {
      tools: false,
      structuredOutput: false,
      streaming: false,
      contextWindow: 2_000,
    },
    async generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        entered();
        await gate;
      }
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'context-agent',
    instructions: 'Use required input.',
    objective: text,
    model,
    context: {
      reserveForOutput: 100,
      policy: {
        id: 'required-only-v1',
        select: ({ sources }) =>
          sources.filter((source) => source.required).map((source) => source.ref),
      },
    },
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'original');
  await started;
  await work.steer('required input');
  release();
  await work.result();
  expect(requests[1]!.context).toMatchObject({
    policy: 'required-only-v1',
    items: [expect.objectContaining({ type: 'input', content: 'required input' })],
    budget: { inputTokens: 1900 },
  });
});

test('ContextEngine uses provider-neutral adapter token accounting when supplied', async () => {
  let captured: ModelRequest | undefined;
  let counts = 0;
  const model: ModelAdapter = {
    id: 'token-accounting-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    tokenizer: {
      id: 'fixture-tokenizer-v1',
      count(value) {
        counts++;
        return Math.max(1, Math.ceil(JSON.stringify(value).length / 8));
      },
    },
    async generate(request) {
      captured = request;
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'counted' }],
        finishReason: 'stop',
        usage: {
          inputTokens: 7,
          outputTokens: 2,
          cost: { amountMicros: 15, currency: 'USD' },
        },
      };
    },
  };
  const assistant = agent({
    id: 'token-accounting-agent',
    instructions: 'Use adapter accounting.',
    objective: text,
    model,
    context: { maxInputTokens: 1_000 },
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);

  const work = await app.start(assistant, 'measure this');
  await expect(work.result()).resolves.toBe('counted');
  expect(counts).toBeGreaterThan(0);
  expect(captured?.context.budget).toMatchObject({
    inputTokens: 1_000,
    accounting: 'fixture-tokenizer-v1',
  });
  expect(await work.inspect({ detail: 'diagnostic' })).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        type: 'decision',
        diagnostic: expect.objectContaining({
          modelResponse: expect.objectContaining({
            usage: {
              inputTokens: 7,
              outputTokens: 2,
              totalTokens: 9,
              cost: { amountMicros: 15, currency: 'USD' },
            },
          }),
        }),
      }),
    ]),
  });
});

test('default Context accounting estimates serialized UTF-8 bytes', async () => {
  let captured: ModelRequest | undefined;
  const model: ModelAdapter = {
    id: 'utf8-context-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      captured = request;
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'utf8-context-agent',
    instructions: 'Answer with care 😀',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);

  await expect(app.run(assistant, 'évidence')).resolves.toBe('done');
  const base = {
    instructions: ['Answer with care 😀'],
    objective: 'évidence',
    tools: [],
  };
  expect(captured?.context.budget).toEqual({
    inputTokens: 28_768,
    estimatedTokens: Math.ceil(Buffer.byteLength(JSON.stringify(base), 'utf8') / 4),
    accounting: 'harngine.utf8-estimate-v1',
  });
});

test('required context that cannot fit fails Work with CONTEXT_LIMIT', async () => {
  const model: ModelAdapter = {
    id: 'tiny-context-model',
    capabilities: {
      tools: false,
      structuredOutput: false,
      streaming: false,
      contextWindow: 20,
      defaultOutputReserve: 0,
    },
    async generate() {
      throw new Error('must not be called');
    },
  };
  const assistant = agent({
    id: 'tiny-context-agent',
    instructions: 'A long instruction that cannot fit in the deliberately tiny model context.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const result = app.run(assistant, 'another long objective');
  await expect(result).rejects.toBeInstanceOf(WorkFailedError);
  await expect(result).rejects.toMatchObject({ reason: { code: 'CONTEXT_LIMIT' } });
});

test('App and Work limits bound Agent model turns independently from Tool executions', async () => {
  let calls = 0;
  const model: ModelAdapter = {
    id: 'limited-model',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate() {
      calls++;
      return calls === 1
        ? {
            items: [
              { type: 'tool-call', providerCallId: 'call-1', tool: 'limited-tool', input: 'x' },
            ],
            object: 'model_response',
            finishReason: 'tool-calls',
          }
        : {
            object: 'model_response',
            items: [{ type: 'text', text: 'done' }],
            finishReason: 'stop',
          };
    },
  };
  const selected = tool({
    id: 'limited-tool',
    description: 'Return the input.',
    input: text,
    output: text,
    effect: 'read',
    execute: (input) => input,
  });
  const assistant = agent({
    id: 'limited-agent',
    instructions: 'Use the Tool.',
    objective: text,
    model,
    tools: [selected],
  });
  const app = createApp({
    directory: directory(),
    agents: [assistant],
    limits: { modelTurns: 1, toolExecutions: 1 },
  });
  apps.push(app);
  const result = app.run(assistant, 'run');
  await expect(result).rejects.toMatchObject({ reason: { code: 'LIMIT_EXCEEDED' } });
  expect(calls).toBe(1);
  await expect(
    app.start(assistant, 'invalid', { limits: { modelTurns: 2 } }),
  ).rejects.toMatchObject({ code: 'INVALID_POLICY' });
});

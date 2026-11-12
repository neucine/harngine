import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  UnauthorizedError,
  WorkFailedError,
  agent,
  createApp,
  schema,
  tool,
  workflow,
  type App,
  type Json,
  type ModelAdapter,
  type Work,
  type Workflow,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-workflow-')));
  directories.push(value);
  return value;
}

function open<O extends Json, R extends Json>(definition: Workflow<O, R>): App {
  const app = createApp({ directory: directory(), workflows: [definition] });
  apps.push(app);
  return app;
}

const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
const text = schema<string>({ id: 'text', version: '1', jsonSchema: { type: 'string' } });

test('public definitions derive immutable revision identities', () => {
  const execute = (input: number) => input + 1;
  const first = tool({
    id: 'revision-tool',
    input: number,
    output: number,
    effect: 'read',
    execute,
  });
  const same = tool({
    id: 'revision-tool',
    input: number,
    output: number,
    effect: 'read',
    execute,
  });
  const changed = tool({
    id: 'revision-tool',
    input: number,
    output: number,
    effect: 'write',
    execute,
  });
  expect(first.revision).toMatch(/^rev_[A-Za-z0-9_-]{16}$/);
  expect(same.revision).toBe(first.revision);
  expect(changed.revision).not.toBe(first.revision);

  const definition = workflow({
    id: 'revision-workflow',
    objective: number,
    result: number,
    tools: [first],
    run: (objective, flow) => flow.call('increment', first, objective),
  });
  expect(definition.revision).toMatch(/^rev_[A-Za-z0-9_-]{16}$/);
  expect(open(definition).describe(definition)).toMatchObject({
    id: 'revision-workflow',
    revision: definition.revision,
    kind: 'workflow',
    tools: [{ id: 'revision-tool', revision: first.revision }],
  });
});

test('Tool capabilities distinguish repeatable reads and conservative or declared writes', () => {
  const read = tool({
    id: 'capability-read',
    input: number,
    output: number,
    effect: 'read',
    retry: { maxAttempts: 3 },
    execute: (input) => input,
  });
  const conservative = tool({
    id: 'capability-write',
    input: number,
    output: number,
    effect: 'write',
    execute: (input) => input,
  });
  const keyed = tool({
    id: 'capability-keyed-write',
    input: number,
    output: number,
    effect: 'write',
    capabilities: { idempotency: 'operation-key', reversibility: 'irreversible' },
    reconcile: (input) => ({ status: 'success', value: input }),
    execute: (input) => input,
  });

  expect(read.capabilities).toEqual({ effect: 'read', invocation: 'repeatable' });
  expect(read.retry).toEqual({ maxAttempts: 3 });
  expect(conservative.capabilities).toEqual({
    effect: 'write',
    idempotency: 'none',
    reconciliation: 'manual',
    reversibility: 'unknown',
  });
  expect(keyed.capabilities).toEqual({
    effect: 'write',
    idempotency: 'operation-key',
    reconciliation: 'automatic',
    reversibility: 'irreversible',
  });
  expect(() =>
    tool({
      id: 'invalid-read-capability',
      input: number,
      output: number,
      effect: 'read',
      capabilities: {
        idempotency: 'intrinsic',
        reversibility: 'reversible',
      },
      execute: (input) => input,
    }),
  ).toThrow(/Only write Tools/);
});

test('resumable Workflow replays recorded calls and returns their values', async () => {
  let executions = 0;
  const increment = tool({
    id: 'increment',
    input: number,
    output: number,
    effect: 'write',
    execute: async (input) => {
      executions++;
      return input + 1;
    },
  });
  const definition = workflow({
    id: 'twice',
    objective: number,
    result: number,
    tools: [increment],
    async run(objective, flow) {
      const first = await flow.call('first', increment, objective);
      return flow.call('second', increment, first);
    },
  });

  await expect(open(definition).run(definition, 5)).resolves.toBe(7);
  expect(executions).toBe(2);
});

test('flow.child creates durable child Work and links its result back to the parent', async () => {
  const child = workflow({
    id: 'child-double',
    objective: number,
    result: number,
    run: (objective) => objective * 2,
  });
  const parent = workflow({
    id: 'parent-delegation',
    objective: number,
    result: number,
    children: [child],
    run: (objective, flow) => flow.child('double', child, objective),
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const parentWork = await app.start(parent, 9);
  await expect(parentWork.result()).resolves.toBe(18);
  const works = await app.works.list();
  expect(works.works).toHaveLength(2);
  expect(works.works.map((work) => work.definition.id).sort()).toEqual([
    'child-double',
    'parent-delegation',
  ]);
  expect(app.describe(parent)).toMatchObject({
    kind: 'workflow',
    children: [{ kind: 'workflow', id: child.id, revision: child.revision }],
  });
  const childSummary = works.works.find((work) => work.definition.id === child.id)!;
  expect((await app.diagnostics.records(childSummary.id)).records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: 'authorization_decisions',
        value: expect.objectContaining({ policy_revision: 'inherited-parent-authority-v1' }),
      }),
    ]),
  );
  const inspection = await parentWork.inspect();
  expect(inspection.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'decision',
        proposal: 'child',
      }),
    ]),
  );
});

test('canceling parent Work durably cancels active descendants and exposes the hierarchy', async () => {
  const child = workflow({
    id: 'waiting-child',
    objective: number,
    result: number,
    run: (objective, flow) =>
      flow.ask('continue', { prompt: 'Continue?', response: number }).then(() => objective),
  });
  const parent = workflow({
    id: 'canceling-parent',
    objective: number,
    result: number,
    children: [child],
    run: (objective, flow) => flow.child('waiting', child, objective),
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const parentWork = await app.start(parent, 4);
  let listed = await app.works.list();
  for (let index = 0; index < 30 && listed.works.length < 2; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    listed = await app.works.list();
  }
  const parentSnapshot = await parentWork.snapshot();
  expect(parentSnapshot.childWorkIds).toHaveLength(1);
  const childWork = await app.works.get(parentSnapshot.childWorkIds[0]!);
  expect(await childWork.snapshot()).toMatchObject({ parentId: parentWork.id, status: 'waiting' });

  await parentWork.cancel('Stop the tree');
  expect(await parentWork.snapshot()).toMatchObject({ status: 'canceled' });
  expect(await childWork.snapshot()).toMatchObject({
    status: 'canceled',
    error: { code: 'PARENT_CANCELED' },
  });
});

test('parent and child Work recover independently and resume their durable linkage', async () => {
  const child = workflow({
    id: 'recovering-child',
    objective: number,
    result: number,
    run: async (objective, flow) => {
      const increment = await flow.ask('increment', {
        prompt: 'Increment?',
        response: number,
      });
      return objective + increment;
    },
  });
  const parent = workflow({
    id: 'recovering-parent',
    objective: number,
    result: number,
    children: [child],
    run: (objective, flow) => flow.child('delegate', child, objective),
  });
  const location = directory();
  const first = createApp({ directory: location, workflows: [parent, child] });
  const parentWork = await first.start(parent, 5);
  let parentSnapshot = await parentWork.snapshot();
  for (let index = 0; index < 30 && !parentSnapshot.childWorkIds.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    parentSnapshot = await parentWork.snapshot();
  }
  const childId = parentSnapshot.childWorkIds[0]!;
  await first.close();

  const restored = createApp({ directory: location, workflows: [parent, child] });
  apps.push(restored);
  const restoredParent = await restored.works.get(parentWork.id);
  const restoredChild = await restored.works.get(childId);
  const childSnapshot = await restoredChild.snapshot();
  await restoredChild.respond(childSnapshot.interactions[0]!.id, 3);
  await expect(restoredParent.result()).resolves.toBe(8);
  expect(await restoredChild.snapshot()).toMatchObject({
    status: 'completed',
    parentId: parentWork.id,
  });
});

test('flow.all provides durable ordered fan-out/fan-in without arbitrary Promise concurrency', async () => {
  const worker = workflow({
    id: 'fanout-worker',
    objective: number,
    result: number,
    run: async (objective, flow) => {
      if (objective === 2)
        await flow.ask('release', { prompt: 'Release the batch?', response: number });
      return objective * 10;
    },
  });
  const parent = workflow({
    id: 'fanout-parent',
    objective: number,
    result: number,
    children: [worker],
    run: async (_objective, flow) => {
      const values = await flow.all('batch', [
        { definition: worker, objective: 1 },
        { definition: worker, objective: 2 },
        { definition: worker, objective: 3 },
      ] as const);
      return values[0] + values[1] + values[2];
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, worker] });
  apps.push(app);
  const parentWork = await app.start(parent, 0);
  let children = (await parentWork.snapshot()).childWorkIds;
  for (let index = 0; index < 30 && children.length < 3; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    children = (await parentWork.snapshot()).childWorkIds;
  }
  expect(children).toHaveLength(3);
  const handles = await Promise.all(children.map((id) => app.works.get(id)));
  let waiting: Work | undefined;
  for (const handle of handles) {
    const snapshot = await handle.snapshot();
    if (snapshot.interactions.length) waiting = handle;
  }
  expect(waiting).toBeDefined();
  const waitingSnapshot = await waiting!.snapshot();
  await waiting!.respond(waitingSnapshot.interactions[0]!.id, 1);
  await expect(parentWork.result()).resolves.toBe(60);
  const parentRecords = await app.diagnostics.records(parentWork.id, { limit: 500 });
  expect(
    parentRecords.records.filter(
      (record) =>
        record.table === 'progress' &&
        record.value !== null &&
        typeof record.value === 'object' &&
        !Array.isArray(record.value) &&
        record.value.kind === 'child.closed',
    ),
  ).toHaveLength(3);
  const entries = (await parentWork.inspect()).entries;
  expect(entries).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'decision', proposal: 'children' })]),
  );
  expect(
    entries.filter((entry) => entry.type === 'child' && entry.phase === 'started'),
  ).toHaveLength(3);
  expect(
    entries.filter((entry) => entry.type === 'child' && entry.phase === 'closed'),
  ).toHaveLength(3);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'decision',
        proposal: 'children',
        presentation: expect.objectContaining({ summary: 'Started parallel child Work' }),
      }),
    ]),
  );
});

test('Workflow child delegation accepts an Agent definition on the same execution substrate', async () => {
  const model: ModelAdapter = {
    id: 'child-agent-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    generate: async () => ({
      object: 'model_response',
      items: [{ type: 'text', text: 'delegated answer' }],
      finishReason: 'stop',
    }),
  };
  const assistant = agent({
    id: 'delegated-agent',
    instructions: 'Answer the delegated objective.',
    objective: text,
    model,
  });
  const parent = workflow({
    id: 'agent-delegating-workflow',
    objective: text,
    result: text,
    children: [assistant],
    run: (objective, flow) => flow.child('assistant', assistant, objective),
  });
  const app = createApp({
    directory: directory(),
    workflows: [parent],
    agents: [assistant],
  });
  apps.push(app);

  await expect(app.run(parent, 'delegate this')).resolves.toBe('delegated answer');
});

test('flow.start and flow.join keep one concurrent child Call while the parent does useful work', async () => {
  let probes = 0;
  const probe = tool({
    id: 'progress-probe',
    input: number,
    output: number,
    effect: 'read',
    execute: (input) => {
      probes++;
      return input + 1;
    },
  });
  const child = workflow({
    id: 'joined-researcher',
    objective: number,
    result: number,
    run: async (objective, flow) => {
      const extra = await flow.ask('release', {
        prompt: 'Release the result?',
        response: number,
      });
      return objective + extra;
    },
  });
  const parent = workflow({
    id: 'joined-parent',
    objective: number,
    result: number,
    tools: [probe],
    children: [child],
    async run(objective, flow) {
      const pending = await flow.start('research', child, objective);
      const progressed = await flow.call('probe', probe, objective);
      const researched = await flow.join('joined', pending);
      return progressed + researched;
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const work = await app.start(parent, 10);
  let snapshot = await work.snapshot();
  for (let index = 0; index < 50 && !snapshot.childWorkIds.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    snapshot = await work.snapshot();
  }
  expect(snapshot.childWorkIds).toHaveLength(1);
  expect(probes).toBe(1);
  const childWork = await app.works.get(snapshot.childWorkIds[0]!);
  let childSnapshot = await childWork.snapshot();
  for (let index = 0; index < 50 && !childSnapshot.interactions.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    childSnapshot = await childWork.snapshot();
  }
  await childWork.respond(childSnapshot.interactions[0]!.id, 7);
  await expect(work.result()).resolves.toBe(28);

  const inspection = await work.inspect();
  const childEntries = inspection.entries.filter(
    (entry): entry is Extract<(typeof inspection.entries)[number], { type: 'child' }> =>
      entry.type === 'child',
  );
  expect(childEntries.map((entry) => entry.phase)).toEqual(
    expect.arrayContaining(['started', 'joined', 'closed']),
  );
  expect(new Set(childEntries.map((entry) => entry.callId)).size).toBe(1);
  expect(childEntries.find((entry) => entry.phase === 'joined')).toMatchObject({
    mode: 'concurrent',
    joinSlot: 'joined',
    childWorkId: childWork.id,
  });
  expect(
    inspection.entries.some(
      (entry) =>
        entry.type === 'decision' &&
        entry.proposal === 'join' &&
        entry.presentation.summary === 'Joined concurrent child Work',
    ),
  ).toBe(true);
});

test('a parent cannot complete successfully while its concurrent child remains active', async () => {
  const child = workflow({
    id: 'unjoined-child',
    objective: number,
    result: number,
    run: async (objective, flow) => {
      await flow.ask('hold', { prompt: 'Hold the child?', response: number });
      return objective;
    },
  });
  const parent = workflow({
    id: 'unjoined-parent',
    objective: number,
    result: number,
    children: [child],
    async run(objective, flow) {
      await flow.start('child', child, objective);
      return objective;
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const work = await app.start(parent, 3);
  await expect(work.result()).rejects.toMatchObject({ code: 'UNSETTLED' });
  const snapshot = await work.snapshot();
  expect(snapshot.childWorkIds).toHaveLength(1);
  await expect((await app.works.get(snapshot.childWorkIds[0]!)).snapshot()).resolves.toMatchObject({
    status: 'waiting',
  });
});

test('Workflow calling an Agent survives restart with one durable child Work', async () => {
  const location = directory();
  let modelCalls = 0;
  let entered!: () => void;
  const modelEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const model: ModelAdapter = {
    id: 'restartable-child-model',
    capabilities: { tools: false, structuredOutput: false, streaming: true },
    async generate(_request, { signal }) {
      modelCalls++;
      if (modelCalls > 1)
        return {
          object: 'model_response',
          items: [{ type: 'text', text: 'resumed child answer' }],
          finishReason: 'stop',
        };
      entered();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
      });
    },
  };
  const child = agent({
    id: 'restartable-child',
    instructions: 'Answer the parent objective.',
    objective: text,
    model,
  });
  const parent = workflow({
    id: 'restartable-parent',
    objective: text,
    result: text,
    children: [child],
    run: (objective, flow) => flow.call('child-agent', child, objective),
  });
  const first = createApp({ directory: location, workflows: [parent], agents: [child] });
  apps.push(first);
  const work = await first.start(parent, 'survive restart');
  await modelEntered;
  let snapshot = await work.snapshot();
  for (let index = 0; index < 50 && !snapshot.childWorkIds.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    snapshot = await work.snapshot();
  }
  expect(snapshot.childWorkIds).toHaveLength(1);
  const childWorkId = snapshot.childWorkIds[0]!;
  await first.close();

  const restored = createApp({ directory: location, workflows: [parent], agents: [child] });
  apps.push(restored);
  const restoredParent = await restored.works.get(work.id);
  await expect(restoredParent.result()).resolves.toBe('resumed child answer');
  expect(modelCalls).toBe(2);
  const works = (await restored.works.list()).works;
  expect(works).toHaveLength(2);
  expect(works.filter((item) => item.definition.id === child.id)).toHaveLength(1);
  await expect((await restored.works.get(childWorkId)).snapshot()).resolves.toMatchObject({
    parentId: work.id,
    status: 'completed',
  });
});

test('executable child failure is catchable with the child Work identity', async () => {
  const child = workflow({
    id: 'failing-specialist',
    objective: number,
    result: number,
    run: (_objective, flow) =>
      flow.fail({ code: 'SPECIALIST_FAILED', message: 'specialist could not continue' }),
  });
  const parent = workflow({
    id: 'catch-specialist-failure',
    objective: number,
    result: text,
    children: [child],
    async run(objective, flow) {
      try {
        await flow.call('specialist', child, objective);
      } catch (error) {
        if (error instanceof WorkFailedError)
          return `${error.reason.code}:${error.workId ?? 'missing-work-id'}`;
        throw error;
      }
      return 'unexpected success';
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const result = await app.run(parent, 1);
  expect(result).toMatch(/^SPECIALIST_FAILED:work_/);
  const childWork = (await app.works.list()).works.find((work) => work.definition.id === child.id)!;
  expect(result).toBe(`SPECIALIST_FAILED:${childWork.id}`);
});

test('root child allowance and depth narrow descendants without widening principal', async () => {
  const grandchild = workflow({
    id: 'allowance-grandchild',
    objective: number,
    result: number,
    run: (objective) => objective,
  });
  const middle = workflow({
    id: 'allowance-middle',
    objective: number,
    result: number,
    children: [grandchild],
    run: (objective, flow) => flow.call('grandchild', grandchild, objective),
  });
  const parent = workflow({
    id: 'allowance-parent',
    objective: number,
    result: number,
    children: [middle],
    run: (objective, flow) => flow.call('middle', middle, objective),
  });
  const app = createApp({
    directory: directory(),
    workflows: [parent, middle, grandchild],
  });
  apps.push(app);

  const work = await app.start(parent, 5, { limits: { childWork: 1, depth: 3 } });
  await expect(work.result()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  const works = (await app.works.list()).works;
  expect(works.map((item) => item.definition.id).sort()).toEqual([
    'allowance-middle',
    'allowance-parent',
  ]);
  const child = works.find((item) => item.definition.id === middle.id)!;
  const records = await app.diagnostics.records(child.id, { limit: 100 });
  const childRow = records.records.find(
    (record) => record.table === 'work' && record.value !== null,
  )!.value as { policy: string; principal: string };
  const parentRow = (await app.diagnostics.records(work.id, { limit: 100 })).records.find(
    (record) => record.table === 'work' && record.value !== null,
  )!.value as { principal: string };
  expect(JSON.parse(childRow.policy)).toMatchObject({ maxChildWork: 0, maxDepth: 2 });
  expect(childRow.principal).toBe(parentRow.principal);
});

test('child Call authorization denial creates no child Work and records the exact target', async () => {
  const child = workflow({
    id: 'denied-child',
    objective: number,
    result: number,
    run: (objective) => objective,
  });
  const parent = workflow({
    id: 'denied-parent',
    objective: number,
    result: number,
    children: [child],
    run: (objective, flow) => flow.call('child', child, objective),
  });
  const app = createApp({
    directory: directory(),
    workflows: [parent, child],
    access: {
      revision: 'deny-child-calls-v1',
      canStart: () => true,
      canCall: ({ target }) => target.kind === 'tool',
      canRespond: () => true,
    },
  });
  apps.push(app);

  const work = await app.start(parent, 1);
  await expect(work.result()).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect((await app.works.list()).works).toHaveLength(1);
  const records = await app.diagnostics.records(work.id, { limit: 100 });
  expect(records.records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: 'authorization_decisions',
        value: expect.objectContaining({
          action: 'call',
          allowed: 0,
          policy_revision: 'deny-child-calls-v1',
          subject: JSON.stringify({
            id: child.id,
            kind: 'workflow',
            version: child.revision,
          }),
        }),
      }),
    ]),
  );
});

test('child fan-out is atomically rejected when it exceeds the parent operation budget', async () => {
  const child = workflow({
    id: 'budget-child',
    objective: number,
    result: number,
    run: (objective) => objective,
  });
  const parent = workflow({
    id: 'budget-parent',
    objective: number,
    result: number,
    children: [child],
    limits: { operations: 2 },
    run: async (_objective, flow) => {
      const values = await flow.all('too-many', [
        { definition: child, objective: 1 },
        { definition: child, objective: 2 },
        { definition: child, objective: 3 },
      ] as const);
      return values[0];
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);

  const work = await app.start(parent, 0);
  await expect(work.result()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  expect((await app.works.list()).works).toHaveLength(1);
  expect((await work.snapshot()).childWorkIds).toEqual([]);
});

test('Workflow replay rejects a stable name whose canonical input changes', async () => {
  let nextInput = 1;
  const mutate = tool({
    id: 'mutate',
    input: number,
    output: number,
    effect: 'write',
    execute: async (input) => {
      nextInput = 2;
      return input;
    },
  });
  const definition = workflow({
    id: 'nondeterministic',
    objective: number,
    result: number,
    tools: [mutate],
    async run(_objective, flow) {
      return flow.call('same-name', mutate, nextInput);
    },
  });

  const result = open(definition).run(definition, 0);
  await expect(result).rejects.toBeInstanceOf(WorkFailedError);
  await expect(result).rejects.toMatchObject({ reason: { code: 'INVALID_DEFINITION' } });
});

test('Tool retries preserve the idempotency key and require proven no effect', async () => {
  const keys: string[] = [];
  const retrying = tool({
    id: 'retrying-read',
    input: number,
    output: number,
    effect: 'read',
    retry: { maxAttempts: 2 },
    execute(input, context) {
      keys.push(context.idempotencyKey);
      if (keys.length === 1)
        context.fail({ effect: 'none', code: 'TEMPORARY', message: 'Try again' });
      return input + 1;
    },
  });
  const definition = workflow({
    id: 'retry-read',
    objective: number,
    result: number,
    tools: [retrying],
    run: (objective, flow) => flow.call('read', retrying, objective),
  });

  await expect(open(definition).run(definition, 1)).resolves.toBe(2);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test('an unknown write effect waits for an audited resolution', async () => {
  const uncertain = tool({
    id: 'uncertain-write',
    input: number,
    output: number,
    effect: 'write',
    execute(_input, context) {
      return context.effectUnknown({ code: 'REMOTE_TIMEOUT', message: 'Receipt was lost' });
    },
  });
  const definition = workflow({
    id: 'uncertain-workflow',
    objective: number,
    result: number,
    tools: [uncertain],
    run: (objective, flow) => flow.call('write', uncertain, objective),
  });

  const work = await open(definition).start(definition, 1);
  let snapshot = await work.snapshot();
  for (let attempt = 0; attempt < 30 && snapshot.waitingFor !== 'effect-resolution'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  expect(snapshot).toMatchObject({ status: 'waiting', waitingFor: 'effect-resolution' });
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const uncertainEntry = inspection.entries.find(
    (entry) => entry.type === 'call' && entry.phase === 'uncertain',
  );
  if (!uncertainEntry || uncertainEntry.type !== 'call')
    throw new Error('uncertain Call not found');

  await work.resolveEffect(
    uncertainEntry.callId,
    { status: 'success', value: 9 },
    { idempotencyKey: 'resolved-write' },
  );

  await expect(work.result()).resolves.toBe(9);
  expect((await work.inspect()).entries).toContainEqual(
    expect.objectContaining({ type: 'call', callId: uncertainEntry.callId, phase: 'resolved' }),
  );
});

test('a reconcilable Tool automatically reconstructs an unknown write result', async () => {
  let executionKey = '';
  let reconciliation:
    | { readonly key: string; readonly attemptId: string; readonly input: number }
    | undefined;
  const recovered = tool({
    id: 'reconciled-write',
    input: number,
    output: number,
    effect: 'write',
    execute(_input, context) {
      executionKey = context.idempotencyKey;
      return context.effectUnknown({ code: 'REMOTE_TIMEOUT', message: 'Receipt was lost' });
    },
    reconcile(input, context) {
      reconciliation = {
        key: context.idempotencyKey,
        attemptId: context.attemptId,
        input,
      };
      return { status: 'success', value: input + 10 };
    },
  });
  const definition = workflow({
    id: 'automatically-reconciled-workflow',
    objective: number,
    result: number,
    tools: [recovered],
    run: (objective, flow) => flow.call('write', recovered, objective),
  });
  const app = open(definition);
  expect(app.describe(recovered)).toMatchObject({ kind: 'tool', reconcilable: true });
  const work = await app.start(definition, 2);

  await expect(work.result()).resolves.toBe(12);
  expect(reconciliation).toMatchObject({ key: executionKey, input: 2 });
  expect(reconciliation?.attemptId).toMatch(/^attempt_/);
  expect((await work.inspect()).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'call', phase: 'reconciling' }),
      expect.objectContaining({ type: 'call', phase: 'resolved' }),
    ]),
  );
});

test('a not-applied reconciliation safely retries the original operation', async () => {
  let executions = 0;
  let reconciliations = 0;
  const retryAfterLookup = tool({
    id: 'reconciled-retry',
    input: number,
    output: number,
    effect: 'write',
    retry: { maxAttempts: 2 },
    execute(input, context) {
      executions++;
      if (executions === 1)
        return context.effectUnknown({ code: 'REMOTE_TIMEOUT', message: 'Receipt was lost' });
      return input + 1;
    },
    reconcile() {
      reconciliations++;
      return {
        status: 'not-applied',
        reason: { code: 'NOT_FOUND', message: 'No remote effect exists' },
      };
    },
  });
  const definition = workflow({
    id: 'reconciled-retry-workflow',
    objective: number,
    result: number,
    tools: [retryAfterLookup],
    run: (objective, flow) => flow.call('write', retryAfterLookup, objective),
  });

  await expect(open(definition).run(definition, 4)).resolves.toBe(5);
  expect(executions).toBe(2);
  expect(reconciliations).toBe(1);
});

test('an inconclusive Tool reconciliation leaves manual resolution available', async () => {
  let reconciliations = 0;
  const unresolved = tool({
    id: 'inconclusive-reconciliation',
    input: number,
    output: number,
    effect: 'write',
    execute(_input, context) {
      return context.effectUnknown({ code: 'REMOTE_TIMEOUT', message: 'Receipt was lost' });
    },
    reconcile() {
      reconciliations++;
      return {
        status: 'unknown',
        reason: { code: 'LOOKUP_UNAVAILABLE', message: 'Remote history is unavailable' },
      };
    },
  });
  const definition = workflow({
    id: 'inconclusive-reconciliation-workflow',
    objective: number,
    result: number,
    tools: [unresolved],
    run: (objective, flow) => flow.call('write', unresolved, objective),
  });
  const work = await open(definition).start(definition, 3);
  let snapshot = await work.snapshot();
  for (let attempt = 0; attempt < 30 && snapshot.waitingFor !== 'effect-resolution'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  const inspection = await work.inspect();
  const uncertainEntry = inspection.entries.find(
    (entry) => entry.type === 'call' && entry.phase === 'uncertain',
  );
  if (!uncertainEntry || uncertainEntry.type !== 'call')
    throw new Error('uncertain Call not found');

  expect(snapshot.waitingFor).toBe('effect-resolution');
  expect(reconciliations).toBe(1);
  await work.resolveEffect(uncertainEntry.callId, { status: 'success', value: 8 });
  await expect(work.result()).resolves.toBe(8);
  expect(reconciliations).toBe(1);
});

test('flow.ask exposes a blocking Interaction and resumes from its validated response', async () => {
  const definition = workflow({
    id: 'ask-name',
    objective: number,
    result: text,
    async run(_objective, flow) {
      return flow.ask('name', { prompt: 'What is your name?', response: text });
    },
  });
  const app = open(definition);
  const work = await app.start(definition, 0);
  let snapshot = await work.snapshot();
  for (let attempt = 0; attempt < 20 && snapshot.interactions.length === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  expect(snapshot).toMatchObject({
    status: 'waiting',
    interactions: [{ type: 'question', prompt: 'What is your name?', blocking: true }],
  });
  await work.respond(snapshot.interactions[0]!.id, 'Ada');
  await expect(work.result()).resolves.toBe('Ada');
});

test('flow.question publishes before its response becomes a blocking dependency', async () => {
  let release!: (value: number) => void;
  const collect = tool({
    id: 'collect-while-question-open',
    input: number,
    output: number,
    effect: 'read',
    execute: () => new Promise<number>((resolve) => (release = resolve)),
  });
  const definition = workflow({
    id: 'nonblocking-question',
    objective: number,
    result: text,
    tools: [collect],
    async run(objective, flow) {
      const review = flow.question('review', { prompt: 'Review the evidence?', response: text });
      await flow.call('collect', collect, objective);
      return review.response();
    },
  });
  const app = open(definition);
  const work = await app.start(definition, 1);
  let snapshot = await work.snapshot();
  for (let i = 0; i < 30 && snapshot.interactions.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  expect(snapshot.interactions[0]).toMatchObject({ type: 'question', blocking: false });
  release(1);
  for (let i = 0; i < 30 && !snapshot.interactions[0]?.blocking; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  expect(snapshot.interactions[0]).toMatchObject({ type: 'question', blocking: true });
  await work.respond(snapshot.interactions[0]!.id, 'Looks good');
  await expect(work.result()).resolves.toBe('Looks good');
});

test('flow.approval exposes a standalone approval Interaction', async () => {
  const definition = workflow({
    id: 'standalone-approval',
    objective: number,
    result: number,
    async run(objective, flow) {
      await flow.approval('refund', { amount: objective });
      return objective;
    },
  });
  const app = open(definition);
  const work = await app.start(definition, 42);
  let snapshot = await work.snapshot();
  for (let i = 0; i < 30 && snapshot.interactions.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  expect(snapshot.interactions[0]).toMatchObject({
    type: 'approval',
    blocking: true,
    title: 'Approve refund?',
    details: { amount: 42 },
  });
  await work.respond(snapshot.interactions[0]!.id, true);
  await expect(work.result()).resolves.toBe(42);
});

test('AccessPolicy denies starts, Calls and Interaction responses before authority is used', async () => {
  let executions = 0;
  const protectedTool = tool({
    id: 'protected',
    input: number,
    output: number,
    effect: 'write',
    execute(input) {
      executions++;
      return input;
    },
  });
  const calling = workflow({
    id: 'calling',
    objective: number,
    result: number,
    tools: [protectedTool],
    run: (objective, flow) => flow.call('protected', protectedTool, objective),
  });
  const asking = workflow({
    id: 'asking',
    objective: number,
    result: text,
    run: (_objective, flow) =>
      flow.ask('answer', { prompt: 'Answer?', response: text, responders: ['reviewer'] }),
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-access-')));
  directories.push(directory);
  const app = createApp({
    directory,
    workflows: [calling, asking],
    access: {
      revision: 'policy-1',
      canStart: ({ principal }) => principal !== 'denied',
      canCall: () => false,
      canRespond: () => false,
    },
  });
  apps.push(app);
  await expect(app.forPrincipal('denied').start(calling, 1)).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  const work = await app.forPrincipal('allowed').start(calling, 1);
  await expect(work.result()).rejects.toMatchObject({ reason: { code: 'TOOL_FAILED' } });
  expect(executions).toBe(0);
  expect((await work.inspect({ detail: 'diagnostic' })).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'call',
        phase: 'rejected',
        diagnostic: expect.objectContaining({
          input: 1,
          outcome: expect.objectContaining({
            status: 'failure',
            reason: expect.objectContaining({ code: 'ACCESS_DENIED' }),
          }),
        }),
      }),
    ]),
  );
  expect((await app.diagnostics.records(work.id)).records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: 'authorization_decisions',
        value: expect.objectContaining({
          action: 'call',
          allowed: 0,
          policy_revision: 'policy-1',
        }),
      }),
    ]),
  );

  const question = await app.forPrincipal('allowed').start(asking, 1);
  let snapshot = await question.snapshot();
  for (let i = 0; i < 20 && snapshot.interactions.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await question.snapshot();
  }
  await expect(question.respond(snapshot.interactions[0]!.id, 'no')).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect((await question.snapshot()).interactions).toHaveLength(1);
  expect((await question.inspect()).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'interaction',
        status: 'pending',
        interaction: expect.objectContaining({ type: 'question', prompt: 'Answer?' }),
      }),
    ]),
  );
  expect((await app.diagnostics.records(question.id)).records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: 'authorization_decisions',
        value: expect.objectContaining({ action: 'respond', allowed: 0 }),
      }),
    ]),
  );
  await question.cancel();
  expect((await question.inspect()).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'interaction', status: 'withdrawn' }),
      expect.objectContaining({ type: 'work.closed', status: 'canceled' }),
    ]),
  );
});

test('flow.now and flow.sleep use recorded timer operations', async () => {
  const definition = workflow({
    id: 'recorded-time',
    objective: number,
    result: number,
    async run(_objective, flow) {
      const recorded = await flow.now('started-at');
      await flow.sleep('pause', 5);
      return recorded;
    },
  });
  const before = Date.now();
  const value = await open(definition).run(definition, 0);
  expect(value).toBeGreaterThanOrEqual(before);
  expect(value).toBeLessThanOrEqual(Date.now());
});

test('Work-specific Workflow limits narrow definition limits', async () => {
  const definition = workflow({
    id: 'limited-operations',
    objective: number,
    result: number,
    async run(objective, flow) {
      await flow.now('one');
      await flow.sleep('two', 0);
      return objective;
    },
  });
  const result = open(definition).run(definition, 1, { limits: { operations: 1 } });
  await expect(result).rejects.toMatchObject({ reason: { code: 'LIMIT_EXCEEDED' } });
});

test('Work watch reconnects from the exact durable projection without running ahead', async () => {
  const definition = workflow({
    id: 'watch-projection',
    objective: number,
    result: text,
    run: (_objective, flow) => flow.ask('answer', { prompt: 'Answer?', response: text }),
  });
  const app = open(definition);
  const work = await app.start(definition, 0);
  let snapshot = await work.snapshot();
  for (let i = 0; i < 30 && snapshot.interactions.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  const before = await work.watch();
  expect(before.value.status).toBe('waiting');
  expect(before.cursor).toMatch(/^event_/);
  const cursor = before.cursor!;
  await work.respond(snapshot.interactions[0]!.id, 'done');
  await work.result();

  const replay = await work.watch({ after: cursor });
  expect(replay.value.status).toBe('waiting');
  const statuses: string[] = [];
  for await (const update of replay) {
    statuses.push(replay.value.status);
    expect(update.durable).toBe(true);
  }
  expect(statuses.at(-1)).toBe('completed');
  expect(statuses[0]).not.toBe('completed');

  const reset = await work.watch({ after: 'event_unavailable' });
  expect(reset.reset).toBe(true);
  expect(reset.value.status).toBe('completed');
});

test('Workflow replay resumes from durable operations after App restart', async () => {
  const definition = workflow({
    id: 'restart-workflow',
    objective: number,
    result: text,
    async run(_objective, flow) {
      const answer = await flow.ask('durable-answer', {
        prompt: 'Continue after restart?',
        response: text,
      });
      await flow.sleep('durable-timer', 0);
      return answer;
    },
  });
  const location = directory();
  const first = createApp({ directory: location, workflows: [definition] });
  apps.push(first);
  const original = await first.start(definition, 0, { idempotencyKey: 'restart' });
  let snapshot = await original.snapshot();
  for (let i = 0; i < 30 && snapshot.interactions.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await original.snapshot();
  }
  await first.close();
  apps.splice(apps.indexOf(first), 1);

  const restoredApp = createApp({ directory: location, workflows: [definition] });
  apps.push(restoredApp);
  const restored = await restoredApp.start(definition, 0, { idempotencyKey: 'restart' });
  expect(restored.id).toBe(original.id);
  const waiting = await restored.snapshot();
  await restored.respond(waiting.interactions[0]!.id, 'resumed');
  await expect(restored.result()).resolves.toBe('resumed');
});

test('Agent model progress is durable and visible in Work inspection', async () => {
  const model: ModelAdapter = {
    id: 'progress-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(_request, { progress }) {
      progress?.({ type: 'started' });
      progress?.({ type: 'reasoning', text: 'A visible model summary' });
      progress?.({
        type: 'completed',
        usage: {
          inputTokens: 120,
          outputTokens: 20,
          totalTokens: 140,
          cost: { amountMicros: 25, currency: 'USD' },
        },
      });
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'Answer' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'progress-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'Question');
  await expect(work.result()).resolves.toBe('Answer');
  expect(
    (await work.inspect()).entries.filter((entry) => entry.type === 'model.progress'),
  ).toMatchObject([
    { phase: 'started', presentation: { title: 'Model started' } },
    { phase: 'reasoning', text: 'A visible model summary' },
    {
      phase: 'completed',
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        totalTokens: 140,
        cost: { amountMicros: 25, currency: 'USD' },
      },
      presentation: { title: 'Model response ready', summary: '120 input · 20 output tokens' },
    },
  ]);
});

import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  schema,
  workflow,
  requestId,
  type Receipt,
  type Proposal,
  type WaitPlan,
  type ReplyRequest,
} from '../src/internal/index.js';
import { Runtime, type Checkpoint } from '../src/internal/runtime.js';
const dirs: string[] = [];
const runtimes: Runtime[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  for (const r of runtimes.splice(0)) await r.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-wait-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(receipt: Receipt<T>): T {
  if (receipt.status !== 'accepted') throw new Error(JSON.stringify(receipt));
  return receipt.value;
}
function fixture(kind: 'reply' | 'timer' = 'reply', duration = 100) {
  const number = schema<number>({
    id: 'wait-number',
    version: '1',
    jsonSchema: { type: 'integer' },
  });
  const definition = workflow<number, number, number, number>({
    id: 'wait-flow',
    version: '1',
    artifactDigest: 'wait-flow-v1',
    objective: number,
    state: number,
    result: number,
    replySchemas: [number],
    tools: [],
    policy: { maxDecisions: 10, maxAttempts: 1 },
    initial: () => 0,
    decide: (view): Proposal<number, number> => {
      const slot = `wait-${view.objectiveRevision}`;
      const wait = view.waits[slot];
      if (!wait)
        return {
          type: 'wait',
          state: 1,
          until:
            kind === 'timer'
              ? { type: 'timer', slot, delayMs: duration }
              : {
                  type: 'reply',
                  slot,
                  schema: { id: number.id, version: number.version },
                  responders: ['reviewer'],
                  timeoutMs: duration,
                },
        };
      if (wait.status === 'pending')
        return { type: 'wait', state: view.state, until: { type: 'existing', slot } };
      return {
        type: 'complete',
        result:
          wait.status === 'replied' ? (wait.payload as number) : wait.status === 'fired' ? 42 : 0,
      };
    },
  });
  return { number, definition };
}
function open(
  f = fixture(),
  dir = directory(),
  clock: () => number = () => 1000,
  checkpoint?: Checkpoint,
) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [] },
    checkpoint,
    clock,
  );
  runtimes.push(runtime);
  return {
    runtime,
    dir,
    ...f,
    owner: runtime.forCaller({ principal: 'owner', source: 'test' }),
    reviewer: runtime.forCaller({ principal: 'reviewer', source: 'review-ui' }),
  };
}
async function plan(x: ReturnType<typeof open>) {
  const ref = accepted(
    await x.owner.work.start(x.definition, {
      requestId: requestId('start'),
      objective: 5,
      context: [],
    }),
  );
  await x.runtime.drain();
  const wait = (await x.owner.work.inspect(ref)).waits[0]!;
  return { ref, wait, request: { requestId: requestId('reply'), wait: wait.wait, payload: 7 } };
}

test('durable reply wait settles through scoped inspection and the existing reply API', async () => {
  const x = open();
  const p = await plan(x);
  expect(p.wait).toMatchObject({
    kind: 'reply',
    status: 'pending',
    deadline: 1100,
    objectiveRevision: 1,
  });
  expect(await x.reviewer.work.wait(p.ref, p.wait.wait)).toEqual(p.wait);
  await expect(x.reviewer.work.inspect(p.ref)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  const receipt = await x.reviewer.work.reply(p.ref, p.request);
  expect(receipt.status).toBe('accepted');
  expect((await x.owner.work.inspect(p.ref)).closure).toBeNull();
  await x.runtime.drain();
  expect(await x.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 7 });
  expect(await x.reviewer.work.reply(p.ref, p.request)).toEqual(receipt);
  expect(await x.reviewer.work.wait(p.ref, p.wait.wait)).toMatchObject({
    status: 'replied',
    payload: 7,
    respondedBy: 'reviewer',
  });
});
test('scope, responders and schema are checked independently of claimed actor or timestamps', async () => {
  const x = open();
  const p = await plan(x);
  await expect(x.owner.work.reply(p.ref, p.request)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  await expect(
    x.reviewer.work.reply({ ...p.ref, definition: { id: 'other', version: '1' } }, p.request),
  ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
  await expect(
    x.reviewer.work.reply(p.ref, {
      ...p.request,
      wait: { ...p.wait.wait, workId: 'wrong' as typeof p.ref.id },
    }),
  ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
  const bad = await x.reviewer.work.reply(p.ref, { ...p.request, payload: '7' });
  expect(bad).toMatchObject({ status: 'rejected', reason: { code: 'INVALID_DATA' } });
  expect(await x.reviewer.work.reply(p.ref, { ...p.request, payload: 7 })).toMatchObject({
    status: 'conflict',
  });
  expect(
    await x.reviewer.work.reply(p.ref, {
      ...p.request,
      requestId: requestId('actor'),
      actor: 'owner',
      sentAt: 1000,
    } as ReplyRequest),
  ).toMatchObject({ status: 'rejected', reason: { code: 'UNSUPPORTED' } });
  expect((await x.owner.work.inspect(p.ref)).waits[0]?.status).toBe('pending');
});
test.each([1099, 1100, 1101])(
  'reply at %i uses acceptance time even without timer delivery',
  async (time) => {
    let now = 1000;
    const x = open(fixture(), directory(), () => now);
    const p = await plan(x);
    now = time;
    const receipt = await x.reviewer.work.reply(p.ref, p.request);
    expect(receipt.status).toBe(time < 1100 ? 'accepted' : 'rejected');
    await x.runtime.drain();
    expect(await x.owner.work.result(p.ref)).toEqual({
      status: 'completed',
      result: time < 1100 ? 7 : 0,
    });
  },
);
test('a wait settles once and exact retries survive expiration of its former deadline', async () => {
  let now = 1000;
  const x = open(fixture(), directory(), () => now);
  const p = await plan(x);
  const receipt = await x.reviewer.work.reply(p.ref, p.request);
  now = 1200;
  expect(await x.reviewer.work.reply(p.ref, p.request)).toEqual(receipt);
  expect(
    await x.reviewer.work.reply(p.ref, { ...p.request, requestId: requestId('another') }),
  ).toMatchObject({ status: 'rejected', reason: { code: 'WAIT_SETTLED' } });
  await x.runtime.drain();
  expect((await x.owner.work.inspect(p.ref)).waits[0]?.status).toBe('replied');
});
test.each(['reply', 'timer'] as const)(
  '%s deadline reconstructs after restart and fires automatically',
  async (kind) => {
    const f = fixture(kind, 80);
    const x = open(f, directory(), Date.now);
    const p = await plan(x);
    await x.runtime.close();
    const y = open(f, x.dir, Date.now);
    const running = y.runtime.start();
    expect(await y.owner.work.result(p.ref, { signal: AbortSignal.timeout(2000) })).toEqual({
      status: 'completed',
      result: kind === 'timer' ? 42 : 0,
    });
    expect((await y.owner.work.inspect(p.ref)).waits[0]?.wait).toEqual(p.wait.wait);
    await y.runtime.close();
    await running;
  },
);
test('zero-delay timer settles at registration without losing its wakeup', async () => {
  const x = open(fixture('timer', 0));
  const p = await plan(x);
  expect(await x.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 42 });
  expect(p.wait.status).toBe('fired');
});
test('reply schema remains enforceable without registered Workflow code', async () => {
  const x = open();
  const p = await plan(x);
  await x.runtime.close();
  const runtime = new Runtime(
    { directory: x.dir, definitions: [], tools: [] },
    undefined,
    () => 1000,
  );
  runtimes.push(runtime);
  const reviewer = runtime.forCaller({ principal: 'reviewer', source: 'review-ui' });
  expect((await reviewer.work.reply(p.ref, p.request)).status).toBe('accepted');
  await runtime.drain();
  expect(
    (await runtime.forCaller({ principal: 'owner', source: 'test' }).work.inspect(p.ref)).closure,
  ).toBeNull();
  await runtime.close();
  const y = open(fixture(), x.dir);
  await y.runtime.drain();
  expect(await y.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 7 });
});
test.each(['cancel', 'revise'] as const)(
  '%s withdraws pending waits and cannot authorize late replies',
  async (kind) => {
    const x = open();
    const p = await plan(x);
    const expectedControl = (await x.owner.work.inspect(p.ref)).controlToken;
    if (kind === 'cancel')
      await x.owner.work.cancel(p.ref, {
        requestId: requestId('control'),
        expectedControl,
        reason: 'Stop',
      });
    else
      await x.owner.work.revise(p.ref, {
        requestId: requestId('control'),
        expectedControl,
        objective: 9,
      });
    expect(await x.reviewer.work.reply(p.ref, p.request)).toMatchObject({
      status: 'rejected',
      reason: { code: 'STALE_WAIT' },
    });
    await x.runtime.drain();
    const snapshot = await x.owner.work.inspect(p.ref);
    expect(snapshot.waits[0]?.status).toBe('withdrawn');
    if (kind === 'revise')
      expect(snapshot.waits[1]).toMatchObject({ objectiveRevision: 2, status: 'pending' });
  },
);
test('ordinary input can resume behavior and reselect an existing pending wait', async () => {
  const f = fixture();
  const definition = workflow({
    ...f.definition,
    input: { schema: f.number, maxPending: 4, batchSize: 2 },
    decide: (v): Proposal<number, number> => {
      const wait = v.waits.question;
      const state = v.state + v.inputs.reduce((sum, i) => sum + i.payload, 0);
      const dispositions = v.inputs.map((i) => ({ id: i.id, status: 'incorporated' as const }));
      if (wait?.status === 'replied')
        return { type: 'complete', result: state + (wait.payload as number), dispositions };
      return {
        type: 'wait',
        state,
        dispositions,
        until: wait
          ? { type: 'existing', slot: 'question' }
          : {
              type: 'reply',
              slot: 'question',
              schema: { id: f.number.id, version: f.number.version },
              responders: ['reviewer'],
            },
      };
    },
  });
  const x = open({ ...f, definition });
  const p = await plan(x);
  await x.owner.work.input(p.ref, {
    requestId: requestId('input'),
    objectiveRevision: p.wait.objectiveRevision,
    payload: 3,
  });
  await x.runtime.drain();
  expect((await x.owner.work.inspect(p.ref)).waits).toHaveLength(1);
  await x.reviewer.work.reply(p.ref, p.request);
  await x.runtime.drain();
  expect(await x.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 10 });
});
test('reply during an existing-wait proposal is observed at registration without a lost wakeup', async () => {
  const f = fixture();
  const definition = workflow({
    ...f.definition,
    input: { schema: f.number, maxPending: 2, batchSize: 2 },
    decide: (v): Proposal<number, number> => ({
      ...f.definition.decide(v),
      dispositions: v.inputs.map((i) => ({ id: i.id, status: 'incorporated' })),
    }),
  });
  let inject = () => {};
  let pending: Promise<unknown> | undefined;
  const x = open(
    { ...f, definition },
    directory(),
    () => 1000,
    (at) => {
      if (at === 'proposal') inject();
    },
  );
  const p = await plan(x);
  await x.owner.work.input(p.ref, {
    requestId: requestId('input'),
    objectiveRevision: p.wait.objectiveRevision,
    payload: 1,
  });
  inject = () => {
    inject = () => {};
    pending = x.reviewer.work.reply(p.ref, p.request);
  };
  await x.runtime.drain();
  await pending;
  expect(await x.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 7 });
});
test.each([
  { type: 'timer', slot: 'bad', delayMs: -1 },
  { type: 'reply', slot: 'bad', schema: { id: 'missing', version: '1' }, responders: ['reviewer'] },
  { type: 'reply', slot: 'bad', schema: { id: 'wait-number', version: '1' }, responders: [] },
  { type: 'existing', slot: 'missing' },
] as WaitPlan[])('invalid wait plan is atomic: %j', (until) => {
  return (async () => {
    const f = fixture();
    const x = open({
      ...f,
      definition: workflow({ ...f.definition, decide: () => ({ type: 'wait', state: 99, until }) }),
    });
    const ref = accepted(
      await x.owner.work.start(x.definition, {
        requestId: requestId('start'),
        objective: 5,
        context: [],
      }),
    );
    await x.runtime.drain();
    const snapshot = await x.owner.work.inspect(ref);
    expect(snapshot.closure?.status).toBe('failed');
    expect(snapshot.state).toBe(0);
    expect(snapshot.waits).toEqual([]);
  })();
});
test('reply schemas are pinned and duplicate wait slots cannot create another registration', async () => {
  const f = fixture();
  const x = open({
    ...f,
    definition: workflow({
      ...f.definition,
      decide: () => ({
        type: 'wait',
        state: 1,
        until: { type: 'timer', slot: 'same', delayMs: 0 },
      }),
    }),
  });
  const p = await plan(x);
  expect(await x.owner.work.result(p.ref)).toMatchObject({
    status: 'failed',
    reason: { code: 'DUPLICATE_SLOT' },
  });
  expect((await x.owner.work.inspect(p.ref)).waits).toHaveLength(1);
  const y = open();
  await y.runtime.close();
  expect(() =>
    open({ ...f, definition: workflow({ ...f.definition, replySchemas: [] }) }, y.dir),
  ).toThrow(/changed/);
});
test.each(['decision', 'reply'] as const)(
  'SIGKILL after %s preserves Wait identity and settlement',
  async (boundary) => {
    const dir = directory();
    const child = fork(
      fileURLToPath(new URL('./wait-worker.mjs', import.meta.url)),
      [dir, boundary],
      { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    children.push(child);
    const message = (await once(child, 'message'))[0];
    expect(message.boundary).toBe(boundary);
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    const x = open(fixture(), dir);
    const snapshot = await x.owner.work.inspect(message.ref);
    expect(snapshot.waits).toHaveLength(1);
    expect(snapshot.waits[0]?.status).toBe(boundary === 'reply' ? 'replied' : 'pending');
    const request = message.request ?? {
      requestId: requestId('reply'),
      wait: snapshot.waits[0]!.wait,
      payload: 7,
    };
    expect((await x.reviewer.work.reply(message.ref, request)).status).toBe('accepted');
    await x.runtime.drain();
    expect(await x.owner.work.result(message.ref)).toEqual({ status: 'completed', result: 7 });
    expect((await x.owner.work.inspect(message.ref)).waits).toHaveLength(1);
  },
);

test('successful completion after ordinary input withdraws an unused reply wait', async () => {
  const f = fixture();
  const definition = workflow({
    ...f.definition,
    input: { schema: f.number, maxPending: 2, batchSize: 2 },
    decide: (v): Proposal<number, number> =>
      v.inputs.length
        ? {
            type: 'complete',
            result: 1,
            dispositions: v.inputs.map((i) => ({ id: i.id, status: 'incorporated' })),
          }
        : f.definition.decide(v),
  });
  const x = open({ ...f, definition });
  const p = await plan(x);
  await x.owner.work.input(p.ref, {
    requestId: requestId('finish'),
    objectiveRevision: p.wait.objectiveRevision,
    payload: 1,
  });
  await x.runtime.drain();
  expect((await x.owner.work.inspect(p.ref)).waits[0]?.status).toBe('withdrawn');
  expect(await x.reviewer.work.reply(p.ref, p.request)).toMatchObject({
    status: 'rejected',
    reason: { code: 'STALE_WAIT' },
  });
});
test('background reply wakes a waiting objective without drain', async () => {
  const x = open(fixture('reply', 2000), directory(), Date.now);
  const p = await plan(x);
  const running = x.runtime.start();
  await x.reviewer.work.reply(p.ref, p.request);
  expect(await x.owner.work.result(p.ref, { signal: AbortSignal.timeout(2000) })).toEqual({
    status: 'completed',
    result: 7,
  });
  await x.runtime.close();
  await running;
});
test('cancellation between proposal and commit prevents wait registration', async () => {
  let cancel = () => {};
  let pending: Promise<unknown> | undefined;
  const x = open(
    fixture(),
    directory(),
    () => 1000,
    (at) => {
      if (at === 'proposal') cancel();
    },
  );
  const ref = accepted(
    await x.owner.work.start(x.definition, {
      requestId: requestId('start'),
      objective: 5,
      context: [],
    }),
  );
  const expectedControl = (await x.owner.work.inspect(ref)).controlToken;
  cancel = () => {
    cancel = () => {};
    pending = x.owner.work.cancel(ref, {
      requestId: requestId('cancel'),
      expectedControl,
      reason: 'Stop',
    });
  };
  await x.runtime.drain();
  await pending;
  expect((await x.owner.work.inspect(ref)).waits).toEqual([]);
  expect((await x.owner.work.result(ref)).status).toBe('canceled');
});
test('timers cannot be settled by external replies and long deadlines remain pending', async () => {
  const x = open(fixture('timer', 365 * 24 * 60 * 60 * 1000), directory(), Date.now);
  const p = await plan(x);
  await expect(x.owner.work.reply(p.ref, p.request)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  const running = x.runtime.start();
  await x.runtime.drain();
  expect((await x.owner.work.wait(p.ref, p.wait.wait)).status).toBe('pending');
  await x.runtime.close();
  await running;
});

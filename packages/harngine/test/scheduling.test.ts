import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  schema,
  workflow,
  tool,
  requestId,
  type Receipt,
  type Outcome,
} from '../src/internal/index.js';
import { Runtime, type Checkpoint } from '../src/internal/runtime.js';
const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function directory() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-scheduling-')));
  dirs.push(d);
  return d;
}
function accepted<T>(r: Receipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
function fixture(
  timeoutMs?: number,
  invoke: () => Promise<Outcome<number>> = async () => ({ status: 'success', value: 42 }),
) {
  const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
  const cap = tool({
    id: 'action',
    version: '1',
    artifactDigest: '1',
    effect: 'write',
    input: number,
    output: number,
    ...(timeoutMs ? { approval: { approvers: ['owner'], timeoutMs } } : {}),
    invoke,
  });
  const definition = workflow({
    id: 'flow',
    version: '1',
    artifactDigest: '1',
    objective: number,
    state: number,
    result: number,
    tools: [{ id: cap.id, version: cap.version }],
    policy: { maxDecisions: 3, maxAttempts: 1 },
    initial: () => 0,
    decide: (view) =>
      !view.calls.action
        ? {
            type: 'call',
            state: 1,
            call: {
              slot: 'action',
              tool: { id: cap.id, version: cap.version },
              input: view.objective,
            },
          }
        : view.calls.action.outcome?.status === 'success'
          ? { type: 'complete', result: 42 }
          : { type: 'fail', reason: { code: 'NO_ACTION', message: 'No action' } },
  });
  return { cap, definition };
}
function open(f = fixture(), dir = directory(), checkpoint?: Checkpoint) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [f.cap] },
    checkpoint,
  );
  runtimes.push(runtime);
  return { runtime, dir, ...f, owner: runtime.forCaller({ principal: 'owner', source: 'test' }) };
}
async function submit(x: ReturnType<typeof open>, id = 'start') {
  return accepted(
    await x.owner.work.start(x.definition, { requestId: requestId(id), objective: 1, context: [] }),
  );
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(5);
  }
  throw new Error('Timed out');
}

test('background start is idempotent and advances newly accepted Work without drain', async () => {
  const x = open();
  const running = x.runtime.start();
  expect(x.runtime.start()).toBe(running);
  const ref = await submit(x);
  expect(await x.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toEqual({
    status: 'completed',
    result: 42,
  });
  await x.runtime.close();
  await running;
  await expect(x.runtime.start()).rejects.toMatchObject({ code: 'CLOSED' });
});
test('startup scans durable accepted Work after its scheduling notification was lost', async () => {
  const f = fixture();
  const x = open(f);
  const ref = await submit(x);
  await x.runtime.close();
  const y = open(f, x.dir);
  const running = y.runtime.start();
  expect(await y.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toMatchObject({
    status: 'completed',
  });
  await y.runtime.close();
  await running;
});
test('pending deadlines are reconstructed after restart and expire without drain', async () => {
  const f = fixture(80);
  const x = open(f);
  const ref = await submit(x);
  await x.runtime.drain();
  await x.runtime.close();
  const y = open(f, x.dir);
  const running = y.runtime.start();
  expect(await y.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toMatchObject({
    status: 'failed',
  });
  const snap = await y.owner.work.inspect(ref);
  expect(snap.approvals[0]?.invalidation).toBe('expired');
  expect(snap.calls[0]?.outcome).toMatchObject({ status: 'failure', effect: 'none' });
  await y.runtime.close();
  await running;
});
test('approval replies wake execution and consume authority once', async () => {
  let calls = 0;
  const x = open(
    fixture(2000, async () => {
      calls++;
      return { status: 'success', value: 42 };
    }),
  );
  const running = x.runtime.start();
  const ref = await submit(x);
  await until(async () => (await x.owner.work.inspect(ref)).approvals.length === 1);
  const wait = (await x.owner.work.inspect(ref)).approvals[0]!.wait;
  await x.owner.work.reply(ref, {
    requestId: requestId('approve'),
    wait,
    payload: { decision: 'approve' },
  });
  expect(await x.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toMatchObject({
    status: 'completed',
  });
  expect(calls).toBe(1);
  await x.runtime.close();
  await running;
});
test('deadlines settle during a different in-flight invocation; close waits for its outcome', async () => {
  let release!: (o: Outcome<number>) => void;
  let entered = false;
  const slow = fixture(undefined, () => {
    entered = true;
    return new Promise((r) => {
      release = r;
    });
  });
  const waiting = fixture(100);
  const x = open(waiting);
  const pending = await submit(x);
  await x.runtime.drain();
  await x.runtime.close();
  // Distinct registrations allow both behaviors to coexist in the same store.
  const cap = tool({ ...slow.cap, id: 'slow' });
  const def = workflow({
    ...slow.definition,
    id: 'slow-flow',
    tools: [{ id: cap.id, version: cap.version }],
    decide: () => ({
      type: 'call',
      state: 1,
      call: { slot: 'slow', tool: { id: cap.id, version: cap.version }, input: 1 },
    }),
  });
  const runtime = new Runtime({
    directory: x.dir,
    definitions: [waiting.definition, def],
    tools: [waiting.cap, cap],
  });
  runtimes.push(runtime);
  const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
  const active = accepted(
    await owner.work.start(def, { requestId: requestId('slow'), objective: 1, context: [] }),
  );
  const running = runtime.start();
  await until(async () => entered);
  await until(
    async () => (await owner.work.inspect(pending)).approvals[0]?.invalidation === 'expired',
  );
  expect((await owner.work.inspect(active)).calls[0]?.status).toBe('admitted');
  let closed = false;
  const closing = runtime.close().then(() => {
    closed = true;
  });
  await delay(10);
  expect(closed).toBe(false);
  release({ status: 'success', value: 42 });
  await closing;
  await running;
});
test('scheduler failures reject supervision, result and close, while inspection remains available', async () => {
  const failure = new Error('storage checkpoint failure');
  const x = open(fixture(), directory(), (b) => {
    if (b === 'decision') throw failure;
  });
  const ref = await submit(x);
  const supervised = expect(x.runtime.start()).rejects.toBe(failure);
  await supervised;
  await expect(x.owner.work.result(ref)).rejects.toBe(failure);
  await expect(x.runtime.drain()).rejects.toBe(failure);
  expect((await x.owner.work.inspect(ref)).closure).toBeNull();
  await expect(x.runtime.close()).rejects.toBe(failure);
});
test('long deadlines do not overflow Node timers or run the tool early', async () => {
  let calls = 0;
  const x = open(
    fixture(365 * 24 * 60 * 60 * 1000, async () => {
      calls++;
      return { status: 'success', value: 42 };
    }),
  );
  const running = x.runtime.start();
  const ref = await submit(x);
  await delay(40);
  expect((await x.owner.work.inspect(ref)).approvals[0]?.status).toBe('pending');
  expect(calls).toBe(0);
  await x.runtime.close();
  await running;
});

test('commands accepted during an invocation are picked up after it completes', async () => {
  let release!: (o: Outcome<number>) => void;
  let calls = 0;
  const x = open(
    fixture(undefined, () => {
      calls++;
      return calls === 1
        ? new Promise((r) => {
            release = r;
          })
        : Promise.resolve({ status: 'success', value: 42 });
    }),
  );
  const running = x.runtime.start();
  const first = await submit(x);
  await until(async () => calls === 1);
  const second = await submit(x, 'second');
  release({ status: 'success', value: 42 });
  await x.owner.work.result(first, { signal: AbortSignal.timeout(2000) });
  await x.owner.work.result(second, { signal: AbortSignal.timeout(2000) });
  expect(calls).toBe(2);
  await x.runtime.close();
  await running;
});
test('revision wakes a waiting Work and cancellation removes its deadline', async () => {
  const x = open(fixture(2000));
  const running = x.runtime.start();
  const ref = await submit(x);
  await until(async () => (await x.owner.work.inspect(ref)).approvals.length === 1);
  const before = await x.owner.work.inspect(ref);
  await x.owner.work.revise(ref, {
    requestId: requestId('revise'),
    expectedControl: before.controlToken,
    objective: 2,
  });
  await until(async () => Boolean((await x.owner.work.inspect(ref)).closure));
  expect((await x.owner.work.inspect(ref)).approvals[0]?.invalidation).toBe('withdrawn');
  const second = await submit(x, 'cancel-me');
  await until(async () => (await x.owner.work.inspect(second)).approvals.length === 1);
  await x.owner.work.cancel(second, {
    requestId: requestId('cancel'),
    expectedControl: (await x.owner.work.inspect(second)).controlToken,
    reason: 'Stop',
  });
  expect((await x.owner.work.inspect(second)).closure?.status).toBe('canceled');
  await x.runtime.close();
  await running;
});

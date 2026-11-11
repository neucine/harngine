import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  schema,
  workflow,
  tool,
  requestId,
  type Receipt,
  type Proposal,
  type View,
  type InputRequest,
  type ObjectiveRevision,
  type Outcome,
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-input-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(r: Receipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
function decide(view: View<number, number, number>): Proposal<number, number> {
  const sum = view.state + view.inputs.reduce((n, input) => n + input.payload, 0);
  const dispositions = view.inputs.map((input) => ({
    id: input.id,
    status: 'incorporated' as const,
  }));
  return sum >= view.objective && !view.hasMoreInputs
    ? { type: 'complete', result: sum, dispositions }
    : { type: 'wait', state: sum, dispositions };
}
function fixture(decision = decide) {
  const number = schema<number>({
    id: 'input-number',
    version: '1',
    jsonSchema: { type: 'integer', minimum: 0 },
  });
  const definition = workflow({
    id: 'input-flow',
    version: '1',
    artifactDigest: 'input-flow-v1',
    objective: number,
    state: number,
    result: number,
    input: { schema: number, maxPending: 4, batchSize: 2 },
    policy: { maxDecisions: 20, maxAttempts: 1 },
    tools: [],
    initial: () => 0,
    decide: decision,
  });
  return { number, definition };
}
function open(f = fixture(), dir = directory(), checkpoint?: Checkpoint) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [] },
    checkpoint,
  );
  runtimes.push(runtime);
  return { runtime, dir, ...f, owner: runtime.forCaller({ principal: 'owner', source: 'test' }) };
}
async function start(x: ReturnType<typeof open>, objective = 10) {
  return accepted(
    await x.owner.work.start(x.definition, {
      requestId: requestId('start'),
      objective,
      context: [],
    }),
  );
}
function input(id: string, payload = 3, revision = 1): InputRequest<number> {
  return { requestId: requestId(id), objectiveRevision: revision as ObjectiveRevision, payload };
}
function rows(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('accepted evidence waits for incorporation; background execution resumes a waiting objective', async () => {
  const x = open();
  const ref = await start(x);
  await x.runtime.drain();
  expect((await x.owner.work.inspect(ref)).status).toBe('waiting');
  const before = await x.owner.work.inspect(ref);
  const receipt = await x.owner.work.input(ref, input('first'));
  expect(receipt.status).toBe('accepted');
  const queued = await x.owner.work.inspect(ref);
  expect(queued.inputs[0]?.status).toBe('pending');
  expect(queued.state).toBe(0);
  expect(queued.controlToken).toBe(before.controlToken);
  const running = x.runtime.start();
  await x.owner.work.input(ref, input('second', 7));
  expect(await x.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toEqual({
    status: 'completed',
    result: 10,
  });
  const final = await x.owner.work.inspect(ref);
  expect(final.inputs.map((i) => i.status)).toEqual(['incorporated', 'incorporated']);
  expect(final.inputs.every((i) => i.decision !== null)).toBe(true);
  await x.runtime.close();
  await running;
});
test('bounded batches preserve acceptance order and record each decision boundary', async () => {
  const seen: number[][] = [];
  const x = open(
    fixture((v) => {
      seen.push(v.inputs.map((i) => i.payload));
      return decide(v);
    }),
  );
  const ref = await start(x, 6);
  for (let n = 1; n <= 3; n++) await x.owner.work.input(ref, input(String(n), n));
  await x.runtime.drain();
  expect(seen).toEqual([[1, 2], [3]]);
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 6 });
  const saved = rows(x.dir, 'SELECT input_boundary,input_ids FROM decisions ORDER BY sequence') as {
    input_boundary: number;
    input_ids: string;
  }[];
  expect(saved.map((r) => r.input_boundary)).toEqual([2, 3]);
  expect(saved.map((r) => JSON.parse(r.input_ids).length)).toEqual([2, 1]);
});
test('queue overflow is a durable rejection and retries cannot become new input after capacity frees', async () => {
  const x = open();
  const ref = await start(x, 100);
  for (let n = 1; n <= 4; n++) await x.owner.work.input(ref, input(String(n)));
  const overflow = await x.owner.work.input(ref, input('overflow'));
  expect(overflow).toMatchObject({ status: 'rejected', reason: { code: 'INPUT_CAPACITY' } });
  await x.runtime.drain();
  expect(await x.owner.work.input(ref, input('overflow'))).toEqual(overflow);
  expect((await x.owner.work.input(ref, input('new'))).status).toBe('accepted');
});
test('schema rejection, request identity and source scope survive closure and missing code', async () => {
  const x = open();
  const ref = await start(x, 3);
  const bad = await x.owner.work.input(ref, input('bad', -1));
  expect(bad.status).toBe('rejected');
  const request = input('good');
  const receipt = await x.owner.work.input(ref, request);
  expect((await x.owner.work.input(ref, input('good', 4))).status).toBe('conflict');
  await x.runtime.drain();
  expect(await x.owner.work.input(ref, request)).toEqual(receipt);
  expect(await x.owner.work.input(ref, input('late'))).toMatchObject({
    status: 'rejected',
    reason: { code: 'WORK_CLOSED' },
  });
  await x.runtime.close();
  const restored = new Runtime({ directory: x.dir, definitions: [], tools: [] });
  runtimes.push(restored);
  const api = restored.forCaller({ principal: 'owner', source: 'test' });
  expect(await api.work.input(ref, request)).toEqual(receipt);
  expect(await api.work.input(ref, input('bad', -1))).toEqual(bad);
  expect(
    await restored.forCaller({ principal: 'owner', source: 'other' }).work.input(ref, request),
  ).toMatchObject({ status: 'rejected', reason: { code: 'WORK_CLOSED' } });
  await expect(
    restored.forCaller({ principal: 'stranger', source: 'test' }).work.input(ref, request),
  ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
});
test('revision supersedes queued evidence and stale new delivery cannot change intent', async () => {
  const x = open();
  const ref = await start(x);
  const receipt = await x.owner.work.input(ref, input('old'));
  const before = await x.owner.work.inspect(ref);
  await x.owner.work.revise(ref, {
    requestId: requestId('revise'),
    expectedControl: before.controlToken,
    objective: 20,
  });
  expect((await x.owner.work.inspect(ref)).inputs[0]).toMatchObject({
    status: 'superseded',
    decision: null,
  });
  expect(await x.owner.work.input(ref, input('old'))).toEqual(receipt);
  expect(await x.owner.work.input(ref, input('stale'))).toMatchObject({
    status: 'rejected',
    reason: { code: 'STALE_REVISION' },
  });
  await x.owner.work.input(ref, input('current', 20, 2));
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 20 });
});
test('cancel disposes pending input without claiming incorporation', async () => {
  const x = open();
  const ref = await start(x);
  await x.owner.work.input(ref, input('pending'));
  await x.owner.work.cancel(ref, {
    requestId: requestId('cancel'),
    expectedControl: (await x.owner.work.inspect(ref)).controlToken,
    reason: 'Stop',
  });
  expect((await x.owner.work.inspect(ref)).inputs[0]).toMatchObject({
    status: 'canceled',
    decision: null,
  });
  await x.runtime.drain();
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(0);
});
test.each(['missing', 'duplicate', 'foreign', 'invalid-state'] as const)(
  'invalid %s disposition proposal is atomic',
  async (kind) => {
    const x = open(
      fixture((v) => ({
        type: 'wait',
        state: kind === 'invalid-state' ? -1 : 99,
        dispositions:
          kind === 'missing'
            ? []
            : kind === 'duplicate'
              ? [
                  { id: v.inputs[0]!.id, status: 'incorporated' },
                  { id: v.inputs[0]!.id, status: 'incorporated' },
                ]
              : [{ id: 'foreign', status: 'incorporated' }],
      })),
    );
    const ref = await start(x);
    await x.owner.work.input(ref, input('one'));
    if (kind === 'duplicate') await x.owner.work.input(ref, input('two'));
    await x.runtime.drain();
    const snapshot = await x.owner.work.inspect(ref);
    expect(snapshot.closure?.status).toBe('failed');
    expect(snapshot.state).toBe(0);
    expect(snapshot.inputs.every((i) => i.status === 'failed' && i.decision === null)).toBe(true);
    expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(0);
  },
);
test('behavior can explicitly ignore evidence with a persisted reason', async () => {
  const x = open(
    fixture((v) => ({
      type: 'complete',
      result: 0,
      dispositions: v.inputs.map((i) => ({
        id: i.id,
        status: 'ignored',
        reason: { code: 'IRRELEVANT', message: 'Outside this objective' },
      })),
    })),
  );
  const ref = await start(x);
  await x.owner.work.input(ref, input('ignore'));
  await x.runtime.drain();
  expect((await x.owner.work.inspect(ref)).inputs[0]).toMatchObject({
    status: 'ignored',
    reason: { code: 'IRRELEVANT' },
    decision: 1,
  });
});
test('success cannot bypass batches outside the supplied view', async () => {
  const x = open(
    fixture((v) => ({
      type: 'complete',
      result: 42,
      dispositions: v.inputs.map((i) => ({ id: i.id, status: 'incorporated' })),
    })),
  );
  const ref = await start(x);
  for (let n = 0; n < 3; n++) await x.owner.work.input(ref, input(String(n)));
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toMatchObject({
    status: 'failed',
    reason: { code: 'INPUT_BACKLOG' },
  });
});
test('input accepted during completion forces a fresh boundary without changing control or basis', async () => {
  let inject = () => {};
  let injected: Promise<unknown> | undefined;
  const x = open(fixture(), directory(), (at) => {
    if (at === 'proposal') inject();
  });
  const ref = await start(x, 3);
  await x.owner.work.input(ref, input('first'));
  inject = () => {
    inject = () => {};
    injected = x.owner.work.input(ref, input('racing', 4));
  };
  await x.runtime.drain();
  await injected;
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 7 });
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(1);
});
test('new input during a nonterminal proposal is processed at the subsequent boundary', async () => {
  let inject = () => {};
  let injected: Promise<unknown> | undefined;
  const seen: number[][] = [];
  const x = open(
    fixture((v) => {
      seen.push(v.inputs.map((i) => i.payload));
      return decide(v);
    }),
    directory(),
    (at) => {
      if (at === 'proposal') inject();
    },
  );
  const ref = await start(x);
  await x.owner.work.input(ref, input('first'));
  inject = () => {
    inject = () => {};
    injected = x.owner.work.input(ref, input('racing', 7));
  };
  await x.runtime.drain();
  await injected;
  expect(seen).toEqual([[3], [7]]);
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 10 });
});
test('input configuration is immutable and absence of a contract rejects delivery', async () => {
  const f = fixture();
  const x = open(f);
  const ref = await start(x);
  await x.runtime.close();
  const changed = workflow({ ...f.definition, input: { ...f.definition.input!, batchSize: 1 } });
  expect(() => open({ ...f, definition: changed }, x.dir)).toThrow(/changed/);
  const { input: omittedInput, ...withoutInput } = f.definition;
  void omittedInput;
  const plain = workflow<number, number, number, number>({
    ...withoutInput,
    id: 'plain',
    decide: () => ({ type: 'complete', result: 1 }),
  });
  const y = open({ ...f, definition: plain });
  const other = await start(y);
  expect(await y.owner.work.input(other, input('unsupported'))).toMatchObject({
    status: 'rejected',
    reason: { code: 'INPUT_UNSUPPORTED' },
  });
  expect(() =>
    workflow({ ...f.definition, input: { schema: f.number, maxPending: 1, batchSize: 2 } }),
  ).toThrow(/finite positive/);
  const missing = new Runtime({ directory: x.dir, definitions: [], tools: [] });
  runtimes.push(missing);
  expect(
    await missing
      .forCaller({ principal: 'owner', source: 'test' })
      .work.input(ref, input('unavailable')),
  ).toMatchObject({ status: 'rejected', reason: { code: 'UNAVAILABLE' } });
});
test('input queued behind approval cannot grant admission; it incorporates after the call settles', async () => {
  const f = fixture();
  let calls = 0;
  const cap = tool({
    id: 'approved',
    version: '1',
    artifactDigest: '1',
    input: f.number,
    output: f.number,
    effect: 'write',
    approval: { approvers: ['owner'], timeoutMs: 60000 },
    invoke: async () => {
      calls++;
      return { status: 'success', value: 1 };
    },
  });
  const definition = workflow({
    ...f.definition,
    tools: [{ id: cap.id, version: cap.version }],
    decide: (v): Proposal<number, number> =>
      !v.calls.action
        ? {
            type: 'call',
            state: 0,
            call: { slot: 'action', tool: { id: cap.id, version: cap.version }, input: 1 },
            dispositions: [],
          }
        : decide(v),
  });
  const runtime = new Runtime({ directory: directory(), definitions: [definition], tools: [cap] });
  runtimes.push(runtime);
  const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
  const ref = accepted(
    await owner.work.start(definition, {
      requestId: requestId('start'),
      objective: 3,
      context: [],
    }),
  );
  await runtime.drain();
  await owner.work.input(ref, input('evidence'));
  await runtime.drain();
  const waiting = await owner.work.inspect(ref);
  expect(waiting.inputs[0]?.status).toBe('pending');
  expect(calls).toBe(0);
  await owner.work.reply(ref, {
    requestId: requestId('approve'),
    wait: waiting.approvals[0]!.wait,
    payload: { decision: 'approve' },
  });
  await runtime.drain();
  expect(await owner.work.result(ref)).toEqual({ status: 'completed', result: 3 });
  expect(calls).toBe(1);
});

test.each(['input', 'decision'] as const)(
  'SIGKILL after %s commit retains receipt and incorporates once after restart',
  async (boundary) => {
    const dir = directory();
    const child = fork(
      fileURLToPath(new URL('./input-worker.mjs', import.meta.url)),
      [dir, boundary],
      { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    children.push(child);
    const message = (await once(child, 'message'))[0];
    expect(message.boundary).toBe(boundary);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const x = open(fixture(), dir);
    const before = await x.owner.work.inspect(message.ref);
    expect(before.state).toBe(boundary === 'input' ? 0 : 3);
    expect(before.inputs[0]?.status).toBe(boundary === 'input' ? 'pending' : 'incorporated');
    const receipt = await x.owner.work.input(message.ref, message.request);
    expect(receipt.status).toBe('accepted');
    expect(accepted(receipt).id).toBe(before.inputs[0]!.id);
    await x.owner.work.input(message.ref, input('finish', 7));
    const running = x.runtime.start();
    expect(await x.owner.work.result(message.ref, { signal: AbortSignal.timeout(2000) })).toEqual({
      status: 'completed',
      result: 10,
    });
    expect((await x.owner.work.inspect(message.ref)).inputs).toHaveLength(2);
    await x.runtime.close();
    await running;
  },
);

test('input cannot unblock an uncertain call or act as outcome evidence', async () => {
  const f = fixture();
  let release!: (outcome: Outcome<number>) => void;
  let entered = false;
  const cap = tool({
    id: 'uncertain',
    version: '1',
    artifactDigest: '1',
    input: f.number,
    output: f.number,
    effect: 'write',
    invoke: () => {
      entered = true;
      return new Promise<Outcome<number>>((resolve) => {
        release = resolve;
      });
    },
  });
  const definition = workflow({
    ...f.definition,
    tools: [{ id: cap.id, version: cap.version }],
    decide: (): Proposal<number, number> => ({
      type: 'call',
      state: 0,
      call: { slot: 'action', tool: { id: cap.id, version: cap.version }, input: 1 },
    }),
  });
  const runtime = new Runtime({ directory: directory(), definitions: [definition], tools: [cap] });
  runtimes.push(runtime);
  const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
  const ref = accepted(
    await owner.work.start(definition, {
      requestId: requestId('start'),
      objective: 3,
      context: [],
    }),
  );
  const driving = runtime.drain();
  expect(entered).toBe(true);
  await owner.work.input(ref, input('during-invocation'));
  release({ status: 'unknown', reason: { code: 'LOST', message: 'Unknown remote outcome' } });
  await driving;
  await owner.work.input(ref, input('after-unknown'));
  await runtime.drain();
  const snapshot = await owner.work.inspect(ref);
  expect(snapshot.closure).toBeNull();
  expect(snapshot.calls[0]?.status).toBe('unknown');
  expect(snapshot.inputs.map((i) => i.status)).toEqual(['pending', 'pending']);
});
test('an invalid call cannot commit state or evidence dispositions', async () => {
  const x = open(
    fixture((v) => ({
      type: 'call',
      state: 99,
      call: { slot: 'denied', tool: { id: 'unregistered', version: '1' }, input: 0 },
      dispositions: v.inputs.map((i) => ({ id: i.id, status: 'incorporated' })),
    })),
  );
  const ref = await start(x);
  await x.owner.work.input(ref, input('one'));
  await x.runtime.drain();
  const snapshot = await x.owner.work.inspect(ref);
  expect(snapshot.closure).toMatchObject({ status: 'failed', reason: { code: 'TOOL_DENIED' } });
  expect(snapshot.state).toBe(0);
  expect(snapshot.inputs[0]).toMatchObject({ status: 'failed', decision: null });
  expect(snapshot.calls).toEqual([]);
});
test('source retry scopes are independent and unknown request fields cannot grant authority', async () => {
  const x = open();
  const ref = await start(x);
  const first = accepted(await x.owner.work.input(ref, input('shared')));
  const other = x.runtime.forCaller({ principal: 'owner', source: 'other' });
  const second = accepted(await other.work.input(ref, input('shared')));
  expect(second.id).not.toBe(first.id);
  expect(second.sequence).toBe(first.sequence + 1);
  expect(
    await x.owner.work.input(ref, { ...input('actor'), actor: 'reviewer' } as InputRequest<number>),
  ).toMatchObject({ status: 'rejected', reason: { code: 'UNSUPPORTED' } });
  await expect(
    x.owner.work.input({ ...ref, definition: { id: 'wrong', version: '1' } }, input('wrong')),
  ).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
});

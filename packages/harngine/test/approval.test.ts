import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
  type Outcome,
  type Proposal,
  type ApprovalReply,
} from '../src/internal/index.js';
import { Runtime, type Checkpoint } from '../src/internal/runtime.js';

const dirs: string[] = [];
const runtimes: Runtime[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-approval-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(receipt: Receipt<T>): T {
  if (receipt.status !== 'accepted') throw new Error(JSON.stringify(receipt));
  return receipt.value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(
  invoke: (input: number) => Promise<Outcome<number>> = async (input) => ({
    status: 'success',
    value: input + 1,
  }),
) {
  const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
  const cap = tool({
    id: 'purchase',
    version: '1',
    artifactDigest: 'approval-tool-v1',
    input: number,
    output: number,
    effect: 'write',
    approval: { approvers: ['reviewer'], timeoutMs: 100 },
    invoke: async ({ input }) => invoke(input),
  });
  const definition = workflow({
    id: 'approval-workflow',
    version: '1',
    artifactDigest: 'approval-workflow-v1',
    objective: number,
    state: number,
    result: number,
    tools: [{ id: cap.id, version: cap.version }],
    policy: { maxDecisions: 6, maxAttempts: 3 },
    initial: () => 0,
    decide: (view): Proposal<number, number> => {
      const slot = `revision-${view.objectiveRevision}`;
      const call = view.calls[slot];
      if (!call)
        return {
          type: 'call',
          state: view.state + 1,
          call: { slot, tool: { id: cap.id, version: cap.version }, input: view.objective },
        };
      if (call.outcome?.status === 'success')
        return { type: 'complete', result: call.outcome.value as number };
      return {
        type: 'fail',
        reason: { code: 'NOT_PURCHASED', message: 'The call did not succeed' },
      };
    },
  });
  return { cap, definition };
}
function open(
  dir = directory(),
  f = fixture(),
  clock: () => number = () => 1000,
  checkpoint?: Checkpoint,
) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [f.cap] },
    checkpoint,
    clock,
  );
  runtimes.push(runtime);
  return {
    runtime,
    dir,
    ...f,
    owner: runtime.forCaller({ principal: 'owner', source: 'test' }),
    reviewer: runtime.forCaller({ principal: 'reviewer', source: 'approval-ui' }),
  };
}
async function plan(x: ReturnType<typeof open>, id = 'start', objective = 5) {
  const ref = accepted(
    await x.owner.work.start(x.definition, { requestId: requestId(id), objective, context: [] }),
  );
  await x.runtime.drain();
  const snapshot = await x.owner.work.inspect(ref);
  const approval = snapshot.approvals.at(-1)!;
  const reply: ApprovalReply = {
    requestId: requestId(`approve-${id}`),
    wait: approval.wait,
    payload: { decision: 'approve' },
  };
  return { ref, snapshot, approval, reply };
}
function rows(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('planning binds exact action and waits without an Attempt or spending capacity', async () => {
  let calls = 0;
  const x = open(
    directory(),
    fixture(async (input) => {
      calls++;
      return { status: 'success', value: input };
    }),
  );
  const p = await plan(x);
  expect(p.snapshot.status).toBe('waiting');
  expect(p.approval).toMatchObject({
    input: 5,
    tool: { id: 'purchase', version: '1' },
    objectiveRevision: 1,
    controlToken: p.snapshot.controlToken,
    admissionLimit: 1,
    status: 'pending',
  });
  expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
  expect(rows(x.dir, 'SELECT * FROM capacity_entries')).toHaveLength(0);
  expect(await x.reviewer.work.approval(p.ref, p.approval.wait)).toEqual(p.approval);
  await expect(x.reviewer.work.inspect(p.ref)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  const receipt = await x.reviewer.work.reply(p.ref, p.reply);
  expect(receipt.status).toBe('accepted');
  expect(calls).toBe(0);
  await x.runtime.drain();
  expect(calls).toBe(1);
  expect((await x.owner.work.result(p.ref)).status).toBe('completed');
  expect(await x.reviewer.work.reply(p.ref, p.reply)).toEqual(receipt);
  expect((await x.owner.work.inspect(p.ref)).approvals[0]!.admittedAttemptId).not.toBeNull();
});

test('only authenticated approvers can reply; model/request actor fields grant no authority', async () => {
  const x = open();
  const p = await plan(x);
  const stranger = x.runtime.forCaller({ principal: 'stranger', source: 'approval-ui' });
  await expect(stranger.work.reply(p.ref, p.reply)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  await expect(x.owner.work.reply(p.ref, p.reply)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(stranger.work.approval(p.ref, p.approval.wait)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  expect(
    (await x.reviewer.work.reply(p.ref, { ...p.reply, actor: 'reviewer' } as ApprovalReply)).status,
  ).toBe('rejected');
  expect((await x.owner.work.inspect(p.ref)).approvals[0]!.status).toBe('pending');
});

test('reply schema, scope and identity are validated before settlement', async () => {
  const x = open();
  const a = await plan(x, 'a');
  const b = await plan(x, 'b');
  await expect(x.reviewer.work.reply(b.ref, a.reply)).rejects.toMatchObject({
    code: 'SCOPE_MISMATCH',
  });
  const invalid = { ...a.reply, payload: { decision: 'yes' } } as unknown as ApprovalReply;
  const rejected = await x.reviewer.work.reply(a.ref, invalid);
  expect(rejected.status).toBe('rejected');
  expect(await x.reviewer.work.reply(a.ref, invalid)).toEqual(rejected);
  expect((await x.reviewer.work.reply(a.ref, a.reply)).status).toBe('conflict');
  const valid = { ...a.reply, requestId: requestId('valid') };
  const receipt = await x.reviewer.work.reply(a.ref, valid);
  expect(receipt.status).toBe('accepted');
  expect(
    (await x.reviewer.work.reply(a.ref, { ...valid, payload: { decision: 'deny' } })).status,
  ).toBe('conflict');
  expect(
    (
      await x.reviewer.work.reply(a.ref, {
        ...valid,
        requestId: requestId('second'),
        payload: { decision: 'deny' },
      })
    ).status,
  ).toBe('rejected');
});

test('denial settles the call as no effect without creating an Attempt', async () => {
  const x = open();
  const p = await plan(x);
  accepted(await x.reviewer.work.reply(p.ref, { ...p.reply, payload: { decision: 'deny' } }));
  await x.runtime.drain();
  const snapshot = await x.owner.work.inspect(p.ref);
  expect(snapshot.closure?.status).toBe('failed');
  expect(snapshot.calls[0]!.outcome).toMatchObject({
    status: 'failure',
    effect: 'none',
    reason: { code: 'APPROVAL_DENIED' },
  });
  expect(snapshot.approvals[0]!.status).toBe('denied');
  expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
});

test.each([1099, 1100, 1101])('deadline uses core acceptance time at %s', async (now) => {
  let time = 1000;
  const x = open(directory(), fixture(), () => time);
  const p = await plan(x);
  time = now;
  const receipt = await x.reviewer.work.reply(p.ref, p.reply);
  expect(receipt.status).toBe(now < 1100 ? 'accepted' : 'rejected');
  if (now >= 1100) {
    expect((await x.owner.work.inspect(p.ref)).approvals[0]!.status).toBe('expired');
    expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
  }
});

test('admission rechecks expiry after an approved reply and preserves historical settlement', async () => {
  let time = 1000;
  let calls = 0;
  const x = open(
    directory(),
    fixture(async (input) => {
      calls++;
      return { status: 'success', value: input };
    }),
    () => time,
    (at) => {
      if (at === 'beforeAdmission') time = 1100;
    },
  );
  const p = await plan(x);
  const receipt = await x.reviewer.work.reply(p.ref, p.reply);
  await x.runtime.drain();
  expect(calls).toBe(0);
  const after = await x.owner.work.inspect(p.ref);
  expect(after.approvals[0]).toMatchObject({
    status: 'approved',
    invalidation: 'expired',
    admittedAttemptId: null,
  });
  expect(after.calls[0]!.outcome).toMatchObject({ status: 'failure', effect: 'none' });
  expect(await x.reviewer.work.reply(p.ref, p.reply)).toEqual(receipt);
});

test('restart expires pending approvals from durable deadlines, without a reply', async () => {
  const x = open();
  const p = await plan(x);
  await x.runtime.close();
  const y = open(x.dir, { cap: x.cap, definition: x.definition }, () => 1100);
  expect((await y.owner.work.inspect(p.ref)).approvals[0]!.status).toBe('expired');
  await y.runtime.drain();
  expect((await y.owner.work.result(p.ref)).status).toBe('failed');
  expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
});

test.each(['pending', 'approved'] as const)(
  'revision withdraws %s approval and requires a new action binding',
  async (status) => {
    const calls: number[] = [];
    const x = open(
      directory(),
      fixture(async (input) => {
        calls.push(input);
        return { status: 'success', value: input + 1 };
      }),
    );
    const p = await plan(x);
    let oldReceipt: Receipt<unknown> | undefined;
    if (status === 'approved') oldReceipt = await x.reviewer.work.reply(p.ref, p.reply);
    accepted(
      await x.owner.work.revise(p.ref, {
        requestId: requestId('revise'),
        expectedControl: p.snapshot.controlToken,
        objective: 20,
      }),
    );
    await x.runtime.drain();
    const revised = await x.owner.work.inspect(p.ref);
    expect(calls).toEqual([]);
    expect(revised.approvals[0]!.invalidation).toBe('withdrawn');
    expect(revised.calls[0]!.status).toBe('withdrawn');
    const fresh = revised.approvals[1]!;
    expect(fresh.input).toBe(20);
    expect(fresh.wait.id).not.toBe(p.approval.wait.id);
    const retry = await x.reviewer.work.reply(p.ref, p.reply);
    expect(retry.status).toBe(status === 'approved' ? 'accepted' : 'rejected');
    if (oldReceipt) expect(retry).toEqual(oldReceipt);
    accepted(
      await x.reviewer.work.reply(p.ref, {
        requestId: requestId('fresh'),
        wait: fresh.wait,
        payload: { decision: 'approve' },
      }),
    );
    await x.runtime.drain();
    expect(calls).toEqual([20]);
    expect(await x.owner.work.result(p.ref)).toEqual({ status: 'completed', result: 21 });
  },
);

test('revision immediately before admission fences an already approved call', async () => {
  let control: Promise<unknown> | undefined;
  let trigger = () => {};
  const inputs: number[] = [];
  const x = open(
    directory(),
    fixture(async (input) => {
      inputs.push(input);
      return { status: 'success', value: input };
    }),
    () => 1000,
    (at) => {
      if (at === 'beforeAdmission' && !control) trigger();
    },
  );
  const p = await plan(x);
  trigger = () => {
    control = x.owner.work.revise(p.ref, {
      requestId: requestId('revise'),
      expectedControl: p.snapshot.controlToken,
      objective: 20,
    });
  };
  accepted(await x.reviewer.work.reply(p.ref, p.reply));
  await x.runtime.drain();
  await control;
  expect(inputs).toEqual([]);
  expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
  const snapshot = await x.owner.work.inspect(p.ref);
  expect(snapshot.approvals[0]).toMatchObject({ status: 'approved', invalidation: 'withdrawn' });
  expect(snapshot.approvals[1]!.status).toBe('pending');
});

test('expiry or cancellation after admission cannot erase the admitted effect', async () => {
  let time = 1000;
  const pending = deferred<Outcome<number>>();
  const x = open(
    directory(),
    fixture(async () => pending.promise),
    () => time,
  );
  const p = await plan(x);
  accepted(await x.reviewer.work.reply(p.ref, p.reply));
  const driving = x.runtime.drain();
  await Promise.resolve();
  time = 1200;
  accepted(
    await x.owner.work.cancel(p.ref, {
      requestId: requestId('cancel'),
      expectedControl: p.snapshot.controlToken,
      reason: 'stop',
    }),
  );
  pending.resolve({ status: 'success', value: 6 });
  await driving;
  const snapshot = await x.owner.work.inspect(p.ref);
  expect(snapshot.closure?.status).toBe('canceled');
  expect(snapshot.calls[0]!.outcome).toEqual({ status: 'success', value: 6 });
  expect(snapshot.approvals[0]).toMatchObject({ status: 'approved', invalidation: null });
  expect(snapshot.approvals[0]!.admittedAttemptId).not.toBeNull();
  expect(rows(x.dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
});

test('a second call gets a new Wait; prior approval grants neither another admission nor capacity', async () => {
  let calls = 0;
  const f = fixture(async (input) => {
    calls++;
    return { status: 'success', value: input };
  });
  const definition = workflow({
    ...f.definition,
    artifactDigest: 'two-calls-v1',
    decide: (view): Proposal<number, number> =>
      view.state < 2
        ? {
            type: 'call',
            state: view.state + 1,
            call: {
              slot: `step-${view.state}`,
              tool: { id: f.cap.id, version: f.cap.version },
              input: view.objective + view.state,
            },
          }
        : { type: 'complete', result: 6 },
  });
  const x = open(directory(), { ...f, definition });
  const p = await plan(x);
  accepted(await x.reviewer.work.reply(p.ref, p.reply));
  await x.runtime.drain();
  expect(calls).toBe(1);
  const second = (await x.owner.work.inspect(p.ref)).approvals[1]!;
  expect(second).toMatchObject({ status: 'pending', input: 6, admittedAttemptId: null });
  expect(second.wait.id).not.toBe(p.approval.wait.id);
  accepted(
    await x.reviewer.work.reply(p.ref, {
      requestId: requestId('second'),
      wait: second.wait,
      payload: { decision: 'approve' },
    }),
  );
  await x.runtime.drain();
  expect(calls).toBe(2);
});

test('approval does not replenish exhausted attempt capacity', async () => {
  let calls = 0;
  const f = fixture(async (input) => {
    calls++;
    return { status: 'success', value: input };
  });
  const definition = workflow({
    ...f.definition,
    artifactDigest: 'budget-approval-v1',
    policy: { maxDecisions: 6, maxAttempts: 1 },
    decide: (view) => ({
      type: 'call' as const,
      state: view.state + 1,
      call: {
        slot: `step-${view.state}`,
        tool: { id: f.cap.id, version: f.cap.version },
        input: 5,
      },
    }),
  });
  const x = open(directory(), { ...f, definition });
  const p = await plan(x);
  accepted(await x.reviewer.work.reply(p.ref, p.reply));
  await x.runtime.drain();
  const second = (await x.owner.work.inspect(p.ref)).approvals[1]!;
  accepted(
    await x.reviewer.work.reply(p.ref, {
      requestId: requestId('second'),
      wait: second.wait,
      payload: { decision: 'approve' },
    }),
  );
  await x.runtime.drain();
  expect(calls).toBe(1);
  expect(rows(x.dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
  expect((await x.owner.work.inspect(p.ref)).closure).toMatchObject({
    status: 'failed',
    reason: { code: 'ATTEMPT_LIMIT' },
  });
});

test('canceling a pending approval leaves no admissible action or accepted late reply', async () => {
  const x = open();
  const p = await plan(x);
  accepted(
    await x.owner.work.cancel(p.ref, {
      requestId: requestId('cancel'),
      expectedControl: p.snapshot.controlToken,
      reason: 'stop',
    }),
  );
  expect((await x.reviewer.work.reply(p.ref, p.reply)).status).toBe('rejected');
  await x.runtime.drain();
  expect((await x.owner.work.inspect(p.ref)).approvals[0]).toMatchObject({
    status: 'withdrawn',
    invalidation: 'withdrawn',
    admittedAttemptId: null,
  });
  expect(rows(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
});

test('approval configuration is pinned and cannot change under an existing tool version', async () => {
  const x = open();
  await plan(x);
  await x.runtime.close();
  const changed = tool({ ...x.cap, approval: { approvers: ['someone-else'], timeoutMs: 100 } });
  expect(() => open(x.dir, { definition: x.definition, cap: changed })).toThrowError(/changed/);
});

test('a behavior proposal cannot disable approval on its call', async () => {
  const f = fixture();
  const definition = workflow({
    ...f.definition,
    artifactDigest: 'bypass-v1',
    decide: () => ({
      type: 'call' as const,
      state: 1,
      call: {
        slot: 'bypass',
        tool: { id: f.cap.id, version: f.cap.version },
        input: 5,
        approval: false,
      },
    }),
  });
  const x = open(directory(), { ...f, definition });
  const ref = accepted(
    await x.owner.work.start(definition, {
      requestId: requestId('start'),
      objective: 5,
      context: [],
    }),
  );
  await x.runtime.drain();
  expect((await x.owner.work.inspect(ref)).closure?.status).toBe('failed');
  expect(rows(x.dir, 'SELECT * FROM requests')).toHaveLength(0);
});

async function crash(dir: string, boundary: string) {
  const child = fork(
    fileURLToPath(new URL('./approval-worker.mjs', import.meta.url)),
    [dir, boundary],
    { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  children.push(child);
  const message = (await once(child, 'message'))[0];
  expect(message.boundary).toBe(boundary);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  return message;
}
test.each(['decision', 'reply', 'admission', 'effect', 'outcome'])(
  'SIGKILL after approval %s preserves authorization and no-replay behavior',
  async (boundary) => {
    const dir = directory();
    const message = await crash(dir, boundary);
    let calls = 0;
    const x = open(
      dir,
      fixture(async (input) => {
        calls++;
        return { status: 'success', value: input + 1 };
      }),
    );
    let snapshot = await x.owner.work.inspect(message.ref);
    expect(snapshot.approvals).toHaveLength(1);
    if (boundary === 'decision') {
      await x.runtime.drain();
      expect(calls).toBe(0);
      accepted(
        await x.reviewer.work.reply(message.ref, {
          requestId: requestId('approve'),
          wait: snapshot.approvals[0]!.wait,
          payload: { decision: 'approve' },
        }),
      );
    } else {
      expect((await x.reviewer.work.reply(message.ref, message.reply)).status).toBe('accepted');
    }
    await x.runtime.drain();
    snapshot = await x.owner.work.inspect(message.ref);
    const unknown = boundary === 'admission' || boundary === 'effect';
    expect(calls).toBe(boundary === 'decision' || boundary === 'reply' ? 1 : 0);
    expect(snapshot.status).toBe(unknown ? 'waiting' : 'closed');
    expect(snapshot.calls[0]!.status).toBe(unknown ? 'unknown' : 'settled');
    expect(rows(dir, 'SELECT * FROM attempts')).toHaveLength(1);
    expect(rows(dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
    const path = join(dir, 'effect.log');
    const effects = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
    expect(effects.length).toBe(boundary === 'effect' || boundary === 'outcome' ? 1 : 0);
  },
);

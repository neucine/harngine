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
  requestId,
  type Receipt,
  type WaitPlan,
  type Proposal,
  type View,
  type WorkRef,
  type WorkId,
} from '../src/internal/index.js';
import { Runtime, type Checkpoint } from '../src/internal/runtime.js';
import { migrations } from '../src/internal/migrations.js';
import { canonical, digest } from '../src/schema.js';
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-condition-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(r: Receipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
function reply(slot: string): WaitPlan {
  return {
    type: 'reply',
    slot,
    schema: { id: 'condition-number', version: '1' },
    responders: ['reviewer'],
  };
}
const existing = (slot: string): WaitPlan => ({ type: 'existing', slot });
const both: WaitPlan = { type: 'all', conditions: [reply('a'), reply('b')] };
function fixture(
  until: WaitPlan = both,
  custom?: (view: View<number, number, number>) => Proposal<number, number>,
) {
  const number = schema<number>({
    id: 'condition-number',
    version: '1',
    jsonSchema: { type: 'integer' },
  });
  const definition = workflow({
    id: 'condition-flow',
    version: '1',
    artifactDigest: 'condition-flow-v1',
    objective: number,
    state: number,
    result: number,
    replySchemas: [number],
    input: { schema: number, maxPending: 4, batchSize: 2 },
    tools: [],
    policy: { maxDecisions: 12, maxAttempts: 1 },
    initial: () => 0,
    decide:
      custom ??
      ((view): Proposal<number, number> =>
        view.state === 0
          ? { type: 'wait', state: 1, until }
          : {
              type: 'complete',
              result: Object.values(view.waits).reduce(
                (sum, w) => sum + (w.status === 'replied' ? (w.payload as number) : 0),
                0,
              ),
            }),
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
async function start(x: ReturnType<typeof open>) {
  return accepted(
    await x.owner.work.start(x.definition, {
      requestId: requestId('start'),
      objective: 10,
      context: [],
    }),
  );
}
async function plan(x: ReturnType<typeof open>) {
  const ref = await start(x);
  await x.runtime.drain();
  return ref;
}
async function respond(x: ReturnType<typeof open>, ref: WorkRef, slot: string, value = 3) {
  const wait = (await x.owner.work.inspect(ref)).waits.find((w) => w.slot === slot)!.wait;
  return x.reviewer.work.reply(ref, { requestId: requestId(slot), wait, payload: value });
}
function rows(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('all registers atomically and partial settlement does not advance behavior', async () => {
  const x = open();
  const ref = await plan(x);
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(1);
  expect((await x.owner.work.inspect(ref)).waits).toHaveLength(2);
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(2);
  await respond(x, ref, 'a');
  await x.runtime.drain();
  expect((await x.owner.work.inspect(ref)).status).toBe('waiting');
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(1);
  await respond(x, ref, 'b', 4);
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 7 });
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(0);
});
test('any wakes without canceling the losing wait, whose later reply cannot wake a replacement condition', async () => {
  const until: WaitPlan = { type: 'any', conditions: [reply('a'), reply('b')] };
  const x = open(
    fixture(until, (v) =>
      v.state === 0 ? { type: 'wait', state: 1, until } : { type: 'wait', state: 2 },
    ),
  );
  const ref = await plan(x);
  await respond(x, ref, 'a');
  await x.runtime.drain();
  const before = await x.owner.work.inspect(ref);
  expect(before.state).toBe(2);
  expect(before.waits.find((w) => w.slot === 'b')?.status).toBe('pending');
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(0);
  await respond(x, ref, 'b');
  await x.runtime.drain();
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(2);
  expect((await x.owner.work.inspect(ref)).status).toBe('waiting');
});
test.each(['reply', 'timer'] as const)(
  'nested all/any accepts the %s branch only after the other all branch settles',
  async (branch) => {
    let now = 1000;
    const until: WaitPlan = {
      type: 'all',
      conditions: [
        reply('a'),
        { type: 'any', conditions: [reply('b'), { type: 'timer', slot: 'timeout', delayMs: 100 }] },
      ],
    };
    const x = open(fixture(until), directory(), () => now);
    const ref = await plan(x);
    if (branch === 'reply') await respond(x, ref, 'b', 4);
    else now = 1100;
    await x.runtime.drain();
    expect((await x.owner.work.inspect(ref)).closure).toBeNull();
    expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(1);
    await respond(x, ref, 'a');
    await x.runtime.drain();
    expect(await x.owner.work.result(ref)).toEqual({
      status: 'completed',
      result: branch === 'reply' ? 7 : 3,
    });
  },
);
test('a zero-delay branch does not satisfy an all condition with another pending wait', async () => {
  const until: WaitPlan = {
    type: 'all',
    conditions: [{ type: 'timer', slot: 'instant', delayMs: 0 }, reply('a')],
  };
  const x = open(fixture(until));
  const ref = await plan(x);
  expect((await x.owner.work.inspect(ref)).waits[0]?.status).toBe('fired');
  expect((await x.owner.work.inspect(ref)).status).toBe('waiting');
  await respond(x, ref, 'a');
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 3 });
});
test('settled existing leaves are rechecked when replies arrive during a compound proposal', async () => {
  let inject = () => {};
  let pending: Promise<unknown> | undefined;
  const f = fixture(both, (v) => {
    const dispositions = v.inputs.map((i) => ({ id: i.id, status: 'incorporated' as const }));
    if (v.state === 0) return { type: 'wait', state: 1, until: both, dispositions };
    if (Object.values(v.waits).every((w) => w.status === 'replied'))
      return { type: 'complete', result: 7, dispositions };
    return {
      type: 'wait',
      state: 2,
      until: { type: 'all', conditions: [existing('a'), existing('b')] },
      dispositions,
    };
  });
  const x = open(
    f,
    directory(),
    () => 1000,
    (at) => {
      if (at === 'proposal') inject();
    },
  );
  const ref = await plan(x);
  await respond(x, ref, 'a');
  await x.owner.work.input(ref, {
    requestId: requestId('input'),
    objectiveRevision: (await x.owner.work.inspect(ref)).objectiveRevision,
    payload: 1,
  });
  // Resolve synchronously inside the checkpoint, before the decision commit transaction.
  const wait = (await x.owner.work.inspect(ref)).waits.find((w) => w.slot === 'b')!.wait;
  inject = () => {
    inject = () => {};
    pending = x.reviewer.work.reply(ref, { requestId: requestId('b'), wait, payload: 4 });
  };
  await x.runtime.drain();
  await pending;
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 7 });
  expect((await x.owner.work.inspect(ref)).waits).toHaveLength(2);
});
test('ordinary input remains independently eligible when an all condition is only partly settled', async () => {
  const f = fixture(both, (v) => ({
    type: 'wait',
    state: v.state + 1,
    until: v.state === 0 ? both : { type: 'all', conditions: [existing('a'), existing('b')] },
    dispositions: v.inputs.map((i) => ({ id: i.id, status: 'incorporated' })),
  }));
  const x = open(f);
  const ref = await plan(x);
  await x.owner.work.input(ref, {
    requestId: requestId('input'),
    objectiveRevision: (await x.owner.work.inspect(ref)).objectiveRevision,
    payload: 1,
  });
  await respond(x, ref, 'a');
  await x.runtime.drain();
  const snapshot = await x.owner.work.inspect(ref);
  expect(snapshot.state).toBe(2);
  expect(snapshot.inputs[0]?.status).toBe('incorporated');
  expect(snapshot.status).toBe('waiting');
});
test('duplicate references to an existing wait have one dependency and retain boolean semantics', async () => {
  const f = fixture(both, (v) => {
    const dispositions = v.inputs.map((i) => ({ id: i.id, status: 'incorporated' as const }));
    if (v.state === 0) return { type: 'wait', state: 1, until: both, dispositions };
    if (v.state === 1)
      return {
        type: 'wait',
        state: 2,
        until: {
          type: 'all',
          conditions: [existing('a'), { type: 'any', conditions: [existing('a'), existing('b')] }],
        },
        dispositions,
      };
    return { type: 'complete', result: 9, dispositions };
  });
  const x = open(f);
  const ref = await plan(x);
  await respond(x, ref, 'a');
  await x.owner.work.input(ref, {
    requestId: requestId('input'),
    objectiveRevision: (await x.owner.work.inspect(ref)).objectiveRevision,
    payload: 1,
  });
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 9 });
  expect((await x.owner.work.inspect(ref)).waits.find((w) => w.slot === 'b')?.status).toBe(
    'withdrawn',
  );
});
test('restart preserves partial condition and durable leaf identities', async () => {
  const f = fixture();
  const x = open(f);
  const ref = await plan(x);
  await respond(x, ref, 'a');
  const before = await x.owner.work.inspect(ref);
  const predicate = rows(x.dir, 'SELECT wake_condition FROM work');
  await x.runtime.close();
  const y = open(f, x.dir);
  await y.runtime.drain();
  expect(rows(x.dir, 'SELECT wake_condition FROM work')).toEqual(predicate);
  expect((await y.owner.work.inspect(ref)).waits).toEqual(before.waits);
  const running = y.runtime.start();
  await respond(y, ref, 'b', 4);
  expect(await y.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toEqual({
    status: 'completed',
    result: 7,
  });
  await y.runtime.close();
  await running;
});
const deep = (): WaitPlan => {
  let plan: WaitPlan = reply('a');
  for (let n = 0; n < 16; n++) plan = { type: 'all', conditions: [plan] };
  return plan;
};
test.each([
  { type: 'all', conditions: [] },
  { type: 'any', conditions: [] },
  {
    type: 'any',
    conditions: [
      { type: 'timer', slot: 'instant', delayMs: 0 },
      { type: 'timer', slot: 'bad', delayMs: -1 },
    ],
  },
  { type: 'all', conditions: [reply('a'), reply('a')] },
  { type: 'all', conditions: [reply('a'), existing('missing')] },
  { type: 'all', conditions: Array.from({ length: 128 }, (_, n) => reply(`w${n}`)) },
  deep(),
] as WaitPlan[])('invalid compound plan leaves no partial registrations: %j', async (until) => {
  const x = open(fixture(until));
  const ref = await start(x);
  await x.runtime.drain();
  const snapshot = await x.owner.work.inspect(ref);
  expect(snapshot.closure?.status).toBe('failed');
  expect(snapshot.state).toBe(0);
  expect(snapshot.waits).toEqual([]);
  expect(rows(x.dir, 'SELECT * FROM decisions')).toHaveLength(0);
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(0);
});
test('revision retires the entire predicate and disallows selecting historical leaves', async () => {
  const f = fixture(both, (v) =>
    v.objectiveRevision === 1
      ? { type: 'wait', state: 1, until: both }
      : {
          type: 'wait',
          state: 2,
          until: { type: 'all', conditions: [existing('a'), existing('b')] },
        },
  );
  const x = open(f);
  const ref = await plan(x);
  await respond(x, ref, 'a');
  const before = await x.owner.work.inspect(ref);
  await x.owner.work.revise(ref, {
    requestId: requestId('revise'),
    expectedControl: before.controlToken,
    objective: 20,
  });
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(0);
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toMatchObject({
    status: 'failed',
    reason: { code: 'STALE_WAIT' },
  });
  expect((await x.owner.work.inspect(ref)).waits.map((w) => w.status)).toEqual([
    'replied',
    'withdrawn',
  ]);
});
test('version 5 single-wait scheduling migrates to an equivalent resolved condition', async () => {
  const dir = directory();
  const f = fixture();
  const id = 'migrated' as WorkId;
  const waitId = 'saved-wait';
  const controlToken = 'saved-control';
  const db = new Database(join(dir, 'state.sqlite'));
  for (let i = 0; i < 5; i++) {
    db.exec(migrations[i]!);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(i + 1, digest(migrations[i]));
  }
  db.prepare(
    "INSERT INTO work(id,principal,definition,objective,state,policy,basis,decisions,status,eligible,control_token) VALUES(?,?,?,?,?,?,1,1,'waiting',0,?)",
  ).run(
    id,
    'owner',
    canonical({ id: f.definition.id, version: '1' }),
    '10',
    '1',
    canonical(f.definition.policy),
    controlToken,
  );
  db.prepare('INSERT INTO objective_revisions VALUES(?,1,?,?)').run(id, '10', controlToken);
  db.prepare('INSERT INTO decisions(work_id,sequence,body) VALUES(?,1,?)').run(id, '{}');
  db.prepare(
    "INSERT INTO workflow_waits(id,work_id,slot,decision_sequence,kind,objective_revision,control_token,schema,responders,deadline,status) VALUES(?,?,?,1,'timer',1,?,NULL,'[]',1100,'pending')",
  ).run(waitId, id, 'timer', controlToken);
  db.prepare('UPDATE work SET wake_wait_id=? WHERE id=?').run(waitId, id);
  db.close();
  let now = 1000;
  const x = open(f, dir, () => now);
  const ref = { id, definition: { id: f.definition.id, version: '1' } };
  expect(rows(dir, 'SELECT wake_condition FROM work')).toEqual([
    { wake_condition: JSON.stringify({ type: 'wait', id: waitId }) },
  ]);
  expect(rows(dir, 'SELECT * FROM wake_dependencies')).toEqual([{ work_id: id, wait_id: waitId }]);
  await x.runtime.drain();
  expect((await x.owner.work.inspect(ref)).closure).toBeNull();
  now = 1100;
  await x.runtime.drain();
  expect(await x.owner.work.result(ref)).toEqual({ status: 'completed', result: 0 });
});
test.each(['decision', 'reply'] as const)(
  'SIGKILL after %s preserves a compound registration and partial settlement',
  async (boundary) => {
    const dir = directory();
    const child = fork(
      fileURLToPath(new URL('./condition-worker.mjs', import.meta.url)),
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
    expect(snapshot.waits).toHaveLength(2);
    expect(rows(dir, 'SELECT * FROM wake_dependencies')).toHaveLength(2);
    const receipt = await respond(x, message.ref, 'a');
    expect(receipt.status).toBe('accepted');
    await x.runtime.drain();
    expect((await x.owner.work.inspect(message.ref)).closure).toBeNull();
    await respond(x, message.ref, 'b', 4);
    await x.runtime.drain();
    expect(await x.owner.work.result(message.ref)).toEqual({ status: 'completed', result: 7 });
    expect(rows(dir, 'SELECT * FROM decisions')).toHaveLength(2);
  },
);

test('overdue simultaneous timers restore all facts before behavior chooses its result', async () => {
  let now = 1000;
  const until: WaitPlan = {
    type: 'any',
    conditions: [
      { type: 'timer', slot: 'a', delayMs: 100 },
      { type: 'timer', slot: 'b', delayMs: 100 },
    ],
  };
  const f = fixture(until, (v) =>
    v.state === 0
      ? { type: 'wait', state: 1, until }
      : {
          type: 'complete',
          result: Object.values(v.waits).filter((w) => w.status === 'fired').length,
        },
  );
  const x = open(f, directory(), () => now);
  const ref = await plan(x);
  await x.runtime.close();
  now = 1100;
  const y = open(f, x.dir, () => now);
  const running = y.runtime.start();
  expect(await y.owner.work.result(ref, { signal: AbortSignal.timeout(2000) })).toEqual({
    status: 'completed',
    result: 2,
  });
  expect((await y.owner.work.inspect(ref)).waits.map((w) => w.status)).toEqual(['fired', 'fired']);
  await y.runtime.close();
  await running;
});
test('cancellation during a compound proposal prevents every planned leaf', async () => {
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
  const ref = await start(x);
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
  expect(rows(x.dir, 'SELECT * FROM wake_dependencies')).toHaveLength(0);
  expect((await x.owner.work.result(ref)).status).toBe('canceled');
});

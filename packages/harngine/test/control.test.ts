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
  type Outcome,
  type Proposal,
  type WorkRef,
  type ControlToken,
  type ControlAcceptance,
} from '../src/internal/index.js';
import { Runtime, type Checkpoint } from '../src/internal/runtime.js';
import { migrations } from '../src/internal/migrations.js';
import { canonical, digest } from '../src/schema.js';

const directories: string[] = [];
const runtimes: Runtime[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-control-')));
  directories.push(dir);
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
const start = { requestId: requestId('start'), objective: 5, context: [] as const };
function fixture(
  invoke: (input: number, signal: AbortSignal) => Promise<Outcome<number>> = async (input) => ({
    status: 'success',
    value: input + 1,
  }),
) {
  const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
  const cap = tool({
    id: 'increment',
    version: '1',
    artifactDigest: 'fixture-tool-v1',
    effect: 'write',
    input: number,
    output: number,
    invoke: async ({ input, signal }) => invoke(input, signal),
  });
  const definition = workflow({
    id: 'revision-aware',
    version: '1',
    artifactDigest: 'control-fixture-v1',
    objective: number,
    state: number,
    result: number,
    policy: { maxDecisions: 6, maxAttempts: 3 },
    tools: [{ id: cap.id, version: cap.version }],
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
      return { type: 'fail', reason: { code: 'CALL_FAILED', message: 'Cannot complete' } };
    },
  });
  return { cap, definition };
}
function open(dir = directory(), f = fixture(), checkpoint?: Checkpoint) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [f.cap] },
    checkpoint,
  );
  runtimes.push(runtime);
  return { runtime, api: runtime.forCaller({ principal: 'owner', source: 'test' }), dir, ...f };
}
function query(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('cancel is durably acknowledged, deduplicated after closure and does not admit a call', async () => {
  let calls = 0;
  const x = open(
    directory(),
    fixture(async (input) => {
      calls++;
      return { status: 'success', value: input };
    }),
  );
  const ref = accepted(await x.api.work.start(x.definition, start));
  const before = await x.api.work.inspect(ref);
  const command = {
    requestId: requestId('cancel'),
    expectedControl: before.controlToken,
    reason: 'No longer required',
  };
  const receipt = await x.api.work.cancel(ref, command);
  expect(receipt.status).toBe('accepted');
  expect(await x.api.work.cancel(ref, command)).toEqual(receipt);
  expect((await x.api.work.cancel(ref, { ...command, reason: 'changed' })).status).toBe('conflict');
  expect((await x.api.work.cancel(ref, { ...command, requestId: requestId('new') })).status).toBe(
    'rejected',
  );
  await x.runtime.drain();
  expect(calls).toBe(0);
  expect((await x.api.work.result(ref)).status).toBe('canceled');
  await x.runtime.close();
  const recovered = open(x.dir, { cap: x.cap, definition: x.definition });
  expect(await recovered.api.work.cancel(ref, command)).toEqual(receipt);
});

test.each(['proposal', 'beforeAdmission'] as const)(
  'cancel at %s fences stale proposals/admissions',
  async (boundary) => {
    let action: Promise<Receipt<ControlAcceptance>> | undefined;
    let ref: WorkRef<number, number>;
    let token: ControlToken;
    let calls = 0;
    const x = open(
      directory(),
      fixture(async (input) => {
        calls++;
        return { status: 'success', value: input };
      }),
      (at) => {
        if (at === boundary && !action)
          action = x.api.work.cancel(ref, {
            requestId: requestId('cancel'),
            expectedControl: token,
            reason: 'stop',
          });
      },
    );
    ref = accepted(await x.api.work.start(x.definition, start));
    token = (await x.api.work.inspect(ref)).controlToken;
    await x.runtime.drain();
    expect((await action)!.status).toBe('accepted');
    expect(calls).toBe(0);
    expect(query(x.dir, 'SELECT * FROM attempts')).toHaveLength(0);
    expect((await x.api.work.inspect(ref)).closure?.status).toBe('canceled');
  },
);

test.each(['success', 'unknown'] as const)(
  'late %s after cancellation updates accounting, never closure',
  async (status) => {
    const outcome = deferred<Outcome<number>>();
    let signal!: AbortSignal;
    const x = open(
      directory(),
      fixture(async (_input, s) => {
        signal = s;
        return outcome.promise;
      }),
    );
    const ref = accepted(await x.api.work.start(x.definition, start));
    const token = (await x.api.work.inspect(ref)).controlToken;
    const driving = x.runtime.drain();
    await Promise.resolve();
    accepted(
      await x.api.work.cancel(ref, {
        requestId: requestId('cancel'),
        expectedControl: token,
        reason: 'stop',
      }),
    );
    expect(signal.aborted).toBe(true);
    const closed = await x.api.work.result(ref);
    expect(closed.status).toBe('canceled');
    expect(
      (await x.api.work.inspect(ref)).concerns.some((c) => c.code === 'UNRESOLVED_ATTEMPT'),
    ).toBe(true);
    outcome.resolve(
      status === 'success'
        ? { status: 'success', value: 6 }
        : { status: 'unknown', reason: { code: 'LOST', message: 'No evidence' } },
    );
    await driving;
    const after = await x.api.work.inspect(ref);
    expect(after.closure).toEqual(closed);
    expect(after.status).toBe('closed');
    expect(after.calls[0]!.status).toBe(status === 'success' ? 'settled' : 'unknown');
    expect(query(x.dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
  },
);

test.each(['proposal', 'beforeAdmission'] as const)(
  'revision at %s uses fresh intent and never invokes old input',
  async (boundary) => {
    let action: Promise<Receipt<ControlAcceptance>> | undefined;
    let ref: WorkRef<number, number>;
    let token: ControlToken;
    const inputs: number[] = [];
    const x = open(
      directory(),
      fixture(async (input) => {
        inputs.push(input);
        return { status: 'success', value: input + 1 };
      }),
      (at) => {
        if (at === boundary && !action)
          action = x.api.work.revise(ref, {
            requestId: requestId('revise'),
            expectedControl: token,
            objective: 20,
          });
      },
    );
    ref = accepted(await x.api.work.start(x.definition, start));
    token = (await x.api.work.inspect(ref)).controlToken;
    await x.runtime.drain();
    expect((await action)!.status).toBe('accepted');
    expect(inputs).toEqual([20]);
    const snapshot = await x.api.work.inspect(ref);
    expect(snapshot.objectiveRevision).toBe(2);
    expect(snapshot.closure).toEqual({ status: 'completed', result: 21 });
    expect(query(x.dir, 'SELECT objective FROM objective_revisions ORDER BY revision')).toEqual([
      { objective: '5' },
      { objective: '20' },
    ]);
    if (boundary === 'beforeAdmission') {
      expect(snapshot.calls[0]!.status).toBe('withdrawn');
      expect(snapshot.state).toBe(2);
    }
  },
);

test('revision during invocation preserves state, original evidence and spent budget', async () => {
  const pending = deferred<Outcome<number>>();
  const inputs: number[] = [];
  const x = open(
    directory(),
    fixture(async (input) => {
      inputs.push(input);
      return input === 5 ? pending.promise : { status: 'success', value: input + 1 };
    }),
  );
  const ref = accepted(await x.api.work.start(x.definition, start));
  const before = await x.api.work.inspect(ref);
  const driving = x.runtime.drain();
  await Promise.resolve();
  const revision = {
    requestId: requestId('revise'),
    expectedControl: before.controlToken,
    objective: 10,
  };
  const receipt = await x.api.work.revise(ref, revision);
  const revised = await x.api.work.inspect(ref);
  expect(revised.state).toBe(1);
  expect(revised.stateRevision).toBe(1);
  expect(revised.objectiveRevision).toBe(2);
  expect(
    (await x.api.work.revise(ref, { ...revision, requestId: requestId('stale'), objective: 99 }))
      .status,
  ).toBe('conflict');
  pending.resolve({ status: 'success', value: 6 });
  await driving;
  expect(inputs).toEqual([5, 10]);
  expect(await x.api.work.result(ref)).toEqual({ status: 'completed', result: 11 });
  expect(await x.api.work.revise(ref, revision)).toEqual(receipt);
  expect(query(x.dir, 'SELECT spent FROM work')).toEqual([{ spent: 2 }]);
  const calls = (await x.api.work.inspect(ref)).calls;
  expect(calls.map((c) => c.objectiveRevision)).toEqual([1, 2]);
  expect(calls[0]!.outcome).toEqual({ status: 'success', value: 6 });
});

test('unknown old action is not replayed by revision and can still be canceled', async () => {
  const x = open(
    directory(),
    fixture(async () => ({ status: 'unknown', reason: { code: 'LOST', message: 'unknown' } })),
  );
  const ref = accepted(await x.api.work.start(x.definition, start));
  await x.runtime.drain();
  let snapshot = await x.api.work.inspect(ref);
  accepted(
    await x.api.work.revise(ref, {
      requestId: requestId('revise'),
      expectedControl: snapshot.controlToken,
      objective: 20,
    }),
  );
  await x.runtime.drain();
  snapshot = await x.api.work.inspect(ref);
  expect(snapshot.status).toBe('waiting');
  expect(query(x.dir, 'SELECT * FROM attempts')).toHaveLength(1);
  accepted(
    await x.api.work.cancel(ref, {
      requestId: requestId('cancel'),
      expectedControl: snapshot.controlToken,
      reason: 'stop waiting',
    }),
  );
  expect(
    (await x.api.work.inspect(ref)).concerns.some((c) => c.code === 'UNRESOLVED_ATTEMPT'),
  ).toBe(true);
});

test('ordinary progress does not stale a control token', async () => {
  let ref: WorkRef<number, number>;
  let token: ControlToken;
  let action: Promise<Receipt<ControlAcceptance>> | undefined;
  const x = open(directory(), fixture(), (at) => {
    if (at === 'outcome')
      action = x.api.work.cancel(ref, {
        requestId: requestId('cancel'),
        expectedControl: token,
        reason: 'stop after result',
      });
  });
  ref = accepted(await x.api.work.start(x.definition, start));
  token = (await x.api.work.inspect(ref)).controlToken;
  await x.runtime.drain();
  expect((await action)!.status).toBe('accepted');
  expect((await x.api.work.inspect(ref)).closure?.status).toBe('canceled');
});

test('revision validates objective without mutation and isolates control access', async () => {
  const x = open();
  const ref = accepted(await x.api.work.start(x.definition, start));
  const before = await x.api.work.inspect(ref);
  const bad = {
    requestId: requestId('bad'),
    expectedControl: before.controlToken,
    objective: '10' as unknown as number,
  };
  const rejection = await x.api.work.revise(ref, bad);
  expect(rejection.status).toBe('rejected');
  expect(await x.api.work.revise(ref, bad)).toEqual(rejection);
  const after = await x.api.work.inspect(ref);
  expect(after.controlToken).toBe(before.controlToken);
  expect(after.objective).toBe(5);
  await expect(
    x.runtime.forCaller({ principal: 'other', source: 'test' }).work.cancel(ref, {
      requestId: requestId('cancel'),
      expectedControl: before.controlToken,
      reason: 'stop',
    }),
  ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
});

test('cancellation works while pinned behavior is missing', async () => {
  const x = open();
  const ref = accepted(await x.api.work.start(x.definition, start));
  await x.runtime.close();
  const runtime = new Runtime({ directory: x.dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const before = await api.work.inspect(ref);
  expect(
    (
      await api.work.cancel(ref, {
        requestId: requestId('cancel'),
        expectedControl: before.controlToken,
        reason: 'stop',
      })
    ).status,
  ).toBe('accepted');
  expect((await api.work.result(ref)).status).toBe('canceled');
});

test('migration from slice-one preserves receipt, state, admitted attempt and capacity', async () => {
  const dir = directory();
  const db = new Database(join(dir, 'state.sqlite'));
  const definition = { id: 'single-call', version: '1' };
  const id = 'existing' as WorkRef<number, number>['id'];
  const receipt = {
    requestId: start.requestId,
    status: 'accepted',
    target: id,
    cursor: 1,
    value: { id, definition },
  };
  db.exec(migrations[0]);
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(digest(migrations[0]));
  db.prepare(
    "INSERT INTO work(id,principal,definition,objective,state,policy,basis,decisions,spent,status,eligible) VALUES(?,?,?,?,?,?,1,1,1,'waiting',0)",
  ).run(
    id,
    'owner',
    canonical(definition),
    '5',
    '1',
    canonical({ maxDecisions: 3, maxAttempts: 1 }),
  );
  db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(
    canonical(['owner', 'test']),
    start.requestId,
    canonical({ definition, request: start }),
    id,
    canonical(receipt),
  );
  db.prepare('INSERT INTO decisions VALUES(?,1,?)').run(id, '{}');
  db.prepare("INSERT INTO requests VALUES('operation',?,1,'increment',?,'5','admitted',NULL)").run(
    id,
    canonical({ id: 'increment', version: '1' }),
  );
  db.exec(
    "INSERT INTO operations VALUES('operation'); INSERT INTO attempts VALUES('attempt','operation',1,'admitted',1)",
  );
  db.prepare("INSERT INTO capacity_entries VALUES('attempt',?,1)").run(id);
  db.close();
  const runtime = new Runtime({ directory: dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const ref = receipt.value;
  const snapshot = await api.work.inspect(ref);
  expect(snapshot.state).toBe(1);
  expect(snapshot.objectiveRevision).toBe(1);
  expect(snapshot.controlToken.length).toBeGreaterThan(0);
  expect(snapshot.calls[0]!.status).toBe('unknown');
  expect(query(dir, 'SELECT spent FROM work')).toEqual([{ spent: 1 }]);
  expect(query(dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
  expect(query(dir, 'SELECT version FROM schema_migrations')).toEqual([
    { version: 1 },
    { version: 2 },
    { version: 3 },
    { version: 4 },
    { version: 5 },
    { version: 6 },
    { version: 7 },
    { version: 8 },
    { version: 9 },
    { version: 10 },
    { version: 11 },
    { version: 12 },
    { version: 13 },
    { version: 14 },
    { version: 15 },
    { version: 16 },
    { version: 17 },
    { version: 18 },
    { version: 19 },
    { version: 20 },
    { version: 21 },
    { version: 22 },
  ]);
  expect(query(dir, 'SELECT receipt FROM receipts')).toEqual([{ receipt: canonical(receipt) }]);
});

async function crash(dir: string, kind: string) {
  const child = fork(fileURLToPath(new URL('./control-worker.mjs', import.meta.url)), [dir, kind], {
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  const message = (await once(child, 'message'))[0];
  expect(message.kind).toBe(kind);
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
  return message;
}
test.each(['cancel', 'revise', 'cancel-admitted'] as const)(
  'SIGKILL after %s commit preserves the lost acknowledgement and authority',
  async (kind) => {
    const dir = directory();
    const message = await crash(dir, kind);
    const runtime = new Runtime({ directory: dir, definitions: [], tools: [] });
    runtimes.push(runtime);
    const api = runtime.forCaller({ principal: 'owner', source: 'test' });
    const snapshot = await api.work.inspect(message.ref);
    const receipt =
      kind === 'revise'
        ? await api.work.revise(message.ref, message.request)
        : await api.work.cancel(message.ref, message.request);
    expect(receipt.status).toBe('accepted');
    expect(receipt.cursor).toBe(message.cursor);
    expect(snapshot.controlToken).not.toBe(message.request.expectedControl);
    expect(snapshot.status).toBe(kind === 'revise' ? 'waiting' : 'closed');
    if (kind === 'cancel-admitted') {
      expect(snapshot.calls[0]!.status).toBe('unknown');
      expect(snapshot.concerns.some((c) => c.code === 'UNRESOLVED_ATTEMPT')).toBe(true);
    }
    await runtime.drain();
    expect(query(dir, 'SELECT * FROM attempts')).toHaveLength(kind === 'cancel-admitted' ? 1 : 0);
  },
);

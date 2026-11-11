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
  type WorkRef,
  type WorkHistoryOptions,
} from '../src/internal/index.js';
import { Runtime } from '../src/internal/runtime.js';
import { migrations } from '../src/internal/migrations.js';
import { digest } from '../src/schema.js';
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-inspection-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(r: Receipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
function open(
  options: {
    invoke?: () => Promise<Outcome<number>>;
    approval?: boolean;
    clock?: () => number;
  } = {},
) {
  const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
  const cap = tool({
    id: 'call',
    version: '1',
    artifactDigest: '1',
    input: number,
    output: number,
    effect: 'read',
    ...(options.approval ? { approval: { approvers: ['reviewer'], timeoutMs: 10 } } : {}),
    invoke: options.invoke ?? (async () => ({ status: 'success', value: 42 })),
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
        : { type: 'complete', result: 42 },
  });
  const dir = directory();
  const runtime = new Runtime(
    { directory: dir, definitions: [definition], tools: [cap] },
    undefined,
    options.clock ?? (() => 1000),
  );
  runtimes.push(runtime);
  return {
    runtime,
    dir,
    definition,
    api: runtime.forCaller({ principal: 'owner', source: 'test' }),
  };
}
async function start(x: ReturnType<typeof open>, id = 'start') {
  return accepted(
    await x.api.work.start(x.definition, { requestId: requestId(id), objective: 7, context: [] }),
  );
}

test('timeline joins committed decisions, exact calls, outcomes and charged usage', async () => {
  const x = open();
  const w = await start(x);
  await x.runtime.drain();
  const snapshot = await x.api.work.inspect(w);
  expect(snapshot).toMatchObject({
    limits: { maxDecisions: 3, maxAttempts: 1 },
    usage: { decisions: 2, attempts: 1 },
  });
  const history = await x.api.work.history(w);
  expect(history.events.map((e) => e.kind)).toEqual([
    'work.accepted',
    'decision.committed',
    'call.committed',
    'authorization.allowed',
    'attempt.admitted',
    'attempt.outcome_recorded',
    'decision.committed',
    'work.closed',
  ]);
  expect(history.events.map((e) => e.decisionSequence)).toEqual([
    null,
    1,
    1,
    null,
    null,
    null,
    2,
    2,
  ]);
  expect(history.events.every((e) => e.recordedAt === 1000)).toBe(true);
  expect(new Set(history.events.map((e) => e.id)).size).toBe(8);
  const decision = await x.api.work.decision(w, 1);
  expect(decision).toMatchObject({
    inputBoundary: 0,
    inputIds: [],
    context: { objective: 7, state: 0, basis: 0, objectiveRevision: 1, stateRevision: 1 },
    proposal: { type: 'call', call: { input: 7 } },
  });
  const call = await x.api.work.call(w, snapshot.calls[0]!.id);
  expect(call).toMatchObject({
    decisionSequence: 1,
    input: 7,
    tool: { id: 'call', version: '1' },
    attempts: [
      { sequence: 1, status: 'settled', charged: 1, outcome: { status: 'success', value: 42 } },
    ],
  });
  expect(call.controlToken).toBe(decision.context!.controlToken);
  expect((await x.api.work.decision(w, 2)).proposal).toEqual({ type: 'complete', result: 42 });
  expect(Object.isFrozen(call.attempts[0]!.outcome)).toBe(true);
  expect(Object.isFrozen(history.events)).toBe(true);
});
test('fixed upper cursor excludes new events and pages without duplicates', async () => {
  const x = open({ approval: true });
  const w = await start(x);
  await x.runtime.drain();
  const first = await x.api.work.history(w, { limit: 1 });
  await x.api.work.cancel(w, {
    requestId: requestId('cancel'),
    expectedControl: (await x.api.work.inspect(w)).controlToken,
    reason: 'Stop',
  });
  const rest = await x.api.work.history(w, { after: first.nextCursor, through: first.through });
  expect(rest.hasMore).toBe(false);
  expect([...first.events, ...rest.events]).toEqual(
    (await x.api.work.history(w, { through: first.through })).events,
  );
  const later = await x.api.work.history(w, { after: rest.nextCursor });
  expect(later.events.length).toBeGreaterThan(0);
  expect(later.events.every((e) => e.cursor > first.through)).toBe(true);
  expect(await x.api.work.history(w, { after: later.nextCursor })).toMatchObject({
    events: [],
    nextCursor: later.nextCursor,
    hasMore: false,
  });
});
test.each([
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { after: -1 },
  { after: 2 },
  { through: 2 },
  { through: 0, after: 1 },
  { after: NaN },
  { through: Infinity },
  { extra: true },
])('rejects invalid page options %j', async (options) => {
  const x = open();
  const w = await start(x);
  await expect(x.api.work.history(w, options as WorkHistoryOptions)).rejects.toBeInstanceOf(Error);
});
test('whole-Work access and reference scope apply to every inspection API', async () => {
  const x = open({ approval: true });
  const w = await start(x);
  await x.runtime.drain();
  const snapshot = await x.api.work.inspect(w);
  const reviewer = x.runtime.forCaller({ principal: 'reviewer', source: 'test' });
  expect(await reviewer.work.approval(w, snapshot.approvals[0]!.wait)).toBeTruthy();
  await expect(reviewer.work.history(w)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(reviewer.work.decision(w, 1)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(reviewer.work.call(w, snapshot.calls[0]!.id)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  const other = await start(x, 'other');
  await expect(x.api.work.call(other, snapshot.calls[0]!.id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(x.api.work.decision(other, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    x.api.work.history({ ...w, definition: { id: 'wrong', version: '1' } }),
  ).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
});
test('inspection does not expire approval or create attempts and denial retains no attempts', async () => {
  let now = 1000;
  const x = open({ approval: true, clock: () => now });
  const w = await start(x);
  await x.runtime.drain();
  const before = await x.api.work.inspect(w);
  now = 2000;
  await x.api.work.history(w);
  await x.api.work.decision(w, 1);
  expect(await x.api.work.call(w, before.calls[0]!.id)).toMatchObject({
    status: 'planned',
    attempts: [],
  });
  expect(await x.api.work.inspect(w)).toEqual(before);
  now = 1001;
  const reviewer = x.runtime.forCaller({ principal: 'reviewer', source: 'test' });
  await reviewer.work.reply(w, {
    requestId: requestId('deny'),
    wait: before.approvals[0]!.wait,
    payload: { decision: 'deny' },
  });
  expect((await x.api.work.call(w, before.calls[0]!.id)).attempts).toEqual([]);
});
test('late outcome remains inspectable after cancellation without reopening Work', async () => {
  let release!: (o: Outcome<number>) => void;
  const x = open({
    invoke: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const w = await start(x);
  const driving = x.runtime.drain();
  const snapshot = await x.api.work.inspect(w);
  const id = snapshot.calls[0]!.id;
  expect(await x.api.work.call(w, id)).toMatchObject({
    status: 'admitted',
    attempts: [{ outcome: null, charged: 1 }],
  });
  await x.api.work.cancel(w, {
    requestId: requestId('cancel'),
    expectedControl: snapshot.controlToken,
    reason: 'Stop',
  });
  release({ status: 'success', value: 42 });
  await driving;
  expect(await x.api.work.call(w, id)).toMatchObject({
    attempts: [{ outcome: { status: 'success', value: 42 } }],
  });
  expect((await x.api.work.inspect(w)).closure?.status).toBe('canceled');
  expect((await x.api.work.history(w)).events.at(-1)!.kind).toBe('attempt.outcome_recorded');
});
test('restart without behavior preserves event identities and details; closed APIs reject', async () => {
  const x = open();
  const w = await start(x);
  await x.runtime.drain();
  const history = await x.api.work.history(w);
  const decision = await x.api.work.decision(w, 1);
  const id = (await x.api.work.inspect(w)).calls[0]!.id;
  const call = await x.api.work.call(w, id);
  await x.runtime.close();
  const runtime = new Runtime({ directory: x.dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'other' });
  expect(await api.work.history(w)).toEqual(history);
  expect(await api.work.decision(w, 1)).toEqual(decision);
  expect(await api.work.call(w, id)).toEqual(call);
  await runtime.close();
  await expect(api.work.history(w)).rejects.toMatchObject({ code: 'CLOSED' });
  await expect(api.work.decision(w, 1)).rejects.toMatchObject({ code: 'CLOSED' });
  await expect(api.work.call(w, id)).rejects.toMatchObject({ code: 'CLOSED' });
});
test('cursor order remains authoritative when local clock moves backwards', async () => {
  let now = 1000;
  const x = open({ clock: () => now-- });
  const w = await start(x);
  await x.runtime.drain();
  const events = (await x.api.work.history(w)).events;
  expect(events.map((e) => e.cursor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(events[0]!.recordedAt).toBeGreaterThan(events.at(-1)!.recordedAt!);
});
test('migration preserves old events and leaves unrecorded metadata null', async () => {
  const dir = directory();
  const db = new Database(join(dir, 'state.sqlite'));
  for (let i = 0; i < 7; i++) {
    db.exec(migrations[i]!);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(i + 1, digest(migrations[i]!));
  }
  db.exec(`INSERT INTO work(id,principal,definition,objective,state,policy,basis,decisions,spent,status,eligible) VALUES('old','owner','{"id":"old","version":"1"}','7','0','{"maxDecisions":2,"maxAttempts":1}',1,1,0,'waiting',0);
 INSERT INTO decisions(work_id,sequence,body) VALUES('old',1,'{"type":"wait","state":0}');
 INSERT INTO progress VALUES('old',1,'saved-event','decision.committed','{}');`);
  db.close();
  const runtime = new Runtime({ directory: dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const w = { id: 'old', definition: { id: 'old', version: '1' } } as unknown as WorkRef;
  expect((await api.work.history(w)).events[0]).toMatchObject({
    id: 'saved-event',
    recordedAt: null,
    decisionSequence: null,
  });
  expect((await api.work.decision(w, 1)).context).toBeNull();
});
test('process crash after admission exposes unknown outcome without fabricating an outcome', async () => {
  const dir = directory();
  const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [dir, 'admission'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  expect((await once(child, 'message'))[0]).toBe('admission');
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  const row = db.prepare('SELECT id,definition FROM work').get() as {
    id: WorkRef['id'];
    definition: string;
  };
  db.close();
  const runtime = new Runtime({ directory: dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const w = { id: row.id, definition: JSON.parse(row.definition) };
  const snapshot = await api.work.inspect(w);
  expect(await api.work.call(w, snapshot.calls[0]!.id)).toMatchObject({
    status: 'unknown',
    outcome: { status: 'unknown', reason: { code: 'INTERRUPTED' } },
    attempts: [{ status: 'unknown', charged: 1, outcome: null }],
  });
  expect((await api.work.history(w)).events.at(-1)!.kind).toBe('attempt.uncertain');
});
test('invalid or missing decision and call identities are explicit errors', async () => {
  const x = open();
  const w = await start(x);
  await expect(x.api.work.decision(w, 0)).rejects.toMatchObject({ code: 'INVALID_SEQUENCE' });
  await expect(x.api.work.decision(w, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(x.api.work.call(w, '')).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
  await expect(x.api.work.call(w, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

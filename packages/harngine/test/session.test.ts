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
  type SessionReceipt,
  type SessionRef,
  type SessionRecord,
  type SessionVersion,
  type SessionCursor,
  type SessionContent,
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-session-')));
  dirs.push(dir);
  return dir;
}
function accepted<T>(r: Receipt<T> | SessionReceipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
function fixture(
  invoke: () => Promise<Outcome<number>> = async () => ({ status: 'success', value: 42 }),
) {
  const number = schema<number>({
    id: 'session-number',
    version: '1',
    jsonSchema: { type: 'integer' },
  });
  const cap = tool({
    id: 'session-call',
    version: '1',
    artifactDigest: '1',
    input: number,
    output: number,
    effect: 'read',
    invoke,
  });
  const definition = workflow({
    id: 'session-flow',
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
  return { cap, definition };
}
function open(f = fixture(), dir = directory(), checkpoint?: Checkpoint) {
  const runtime = new Runtime(
    { directory: dir, definitions: [f.definition], tools: [f.cap] },
    checkpoint,
    () => 1000,
  );
  runtimes.push(runtime);
  return { runtime, dir, ...f, api: runtime.forCaller({ principal: 'owner', source: 'test' }) };
}
async function create(x: ReturnType<typeof open>, id = 'session', maxEntries = 10) {
  return accepted(
    await x.api.session.create({ requestId: requestId(id), title: 'Support case', maxEntries }),
  );
}
async function record(
  x: ReturnType<typeof open>,
  ref: SessionRef,
  id: string,
  entry: SessionContent,
) {
  return x.api.session.record(ref, {
    requestId: requestId(id),
    expectedVersion: (await x.api.session.inspect(ref)).version,
    entry,
  });
}
async function work(x: ReturnType<typeof open>, id = 'work') {
  return accepted(
    await x.api.work.start(x.definition, { requestId: requestId(id), objective: 1, context: [] }),
  );
}
function rows(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('Session creation and ordered history are durable without starting Work', async () => {
  const x = open();
  const ref = await create(x);
  expect(await x.api.session.inspect(ref)).toMatchObject({
    status: 'active',
    version: 1,
    cursor: 0,
    maxEntries: 10,
  });
  await record(x, ref, 'input', { type: 'input', content: { message: 'Please investigate' } });
  await record(x, ref, 'output', { type: 'output', content: 'Checking your case' });
  const history = await x.api.session.history(ref);
  expect(history.entries.map((e) => [e.sequence, e.version, e.entry.type])).toEqual([
    [1, 2, 'input'],
    [2, 3, 'output'],
  ]);
  expect(history.entries.every((e) => e.source === 'test' && e.recordedAt === 1000)).toBe(true);
  expect(history.hasMore).toBe(false);
  expect(rows(x.dir, 'SELECT * FROM work')).toHaveLength(0);
  await x.runtime.close();
  const y = open(fixture(), x.dir);
  expect(await y.api.session.get(ref.id)).toEqual(ref);
  expect(await y.api.session.history(ref)).toEqual(history);
});
test('paged history has stable append-only boundaries and validates page options', async () => {
  const x = open();
  const ref = await create(x);
  for (let i = 0; i < 3; i++) await record(x, ref, String(i), { type: 'input', content: i });
  const first = await x.api.session.history(ref, { limit: 2 });
  expect(first.nextCursor).toBe(2);
  expect(first.hasMore).toBe(true);
  await record(x, ref, 'later', { type: 'output', content: 3 });
  const second = await x.api.session.history(ref, { after: first.nextCursor, limit: 2 });
  expect(second.entries.map((e) => e.sequence)).toEqual([3, 4]);
  expect(second.hasMore).toBe(false);
  expect((await x.api.session.history(ref, { after: second.nextCursor })).entries).toEqual([]);
  await expect(x.api.session.history(ref, { after: 99 as SessionCursor })).rejects.toMatchObject({
    code: 'INVALID_CURSOR',
  });
  await expect(x.api.session.history(ref, { limit: 0 })).rejects.toMatchObject({
    code: 'INVALID_LIMIT',
  });
});
test('exact create/record/close retries retain original receipts after closure and restart', async () => {
  const x = open();
  const creation = { requestId: requestId('session'), title: 'Support case', maxEntries: 10 };
  const created = await x.api.session.create(creation);
  const ref = accepted(created);
  const request: SessionRecord = {
    requestId: requestId('message'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
    entry: { type: 'input', content: 'hello' },
  };
  const recorded = await x.api.session.record(ref, request);
  const close = {
    requestId: requestId('close'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
  };
  const closed = await x.api.session.close(ref, close);
  await x.runtime.close();
  const y = open(fixture(), x.dir);
  expect(await y.api.session.create(creation)).toEqual(created);
  expect(await y.api.session.record(ref, request)).toEqual(recorded);
  expect(await y.api.session.close(ref, close)).toEqual(closed);
  expect((await y.api.session.history(ref)).entries).toHaveLength(1);
  expect(
    await y.api.session.record(ref, { ...request, entry: { type: 'input', content: 'changed' } }),
  ).toMatchObject({ status: 'conflict', reason: { code: 'IDENTITY_CONFLICT' } });
});
test('stale version rejection is durable even if resubmitted with a new expected version', async () => {
  const x = open();
  const ref = await create(x);
  const version = (await x.api.session.inspect(ref)).version;
  await record(x, ref, 'first', { type: 'input', content: 1 });
  const request: SessionRecord = {
    requestId: requestId('stale'),
    expectedVersion: version,
    entry: { type: 'input', content: 2 },
  };
  const rejected = await x.api.session.record(ref, request);
  expect(rejected).toMatchObject({ status: 'conflict', reason: { code: 'STALE_VERSION' } });
  expect(await x.api.session.record(ref, request)).toEqual(rejected);
  expect(
    await x.api.session.record(ref, {
      ...request,
      expectedVersion: (await x.api.session.inspect(ref)).version,
    }),
  ).toMatchObject({ status: 'conflict', reason: { code: 'IDENTITY_CONFLICT' } });
  expect((await x.api.session.history(ref)).entries).toHaveLength(1);
});
test('Work and Session mutations share the authenticated source request-identity scope', async () => {
  const x = open();
  const ref = await create(x, 'shared');
  expect(
    await x.api.work.start(x.definition, {
      requestId: requestId('shared'),
      objective: 1,
      context: [],
    }),
  ).toMatchObject({ status: 'conflict', reason: { code: 'IDENTITY_CONFLICT' } });
  const w = await work(x, 'work-id');
  expect(
    await x.api.session.create({ requestId: requestId('work-id'), title: 'Collision' }),
  ).toMatchObject({ status: 'conflict', reason: { code: 'IDENTITY_CONFLICT' } });
  expect(w.id).toBeTruthy();
  const other = x.runtime.forCaller({ principal: 'owner', source: 'other' });
  expect(
    (await other.session.create({ requestId: requestId('shared'), title: 'Different source' }))
      .status,
  ).toBe('accepted');
  expect((await x.api.session.inspect(ref)).cursor).toBe(0);
});
test('Session ownership and Work access are checked independently', async () => {
  const x = open();
  const ref = await create(x);
  const stranger = x.runtime.forCaller({ principal: 'stranger', source: 'test' });
  const w = accepted(
    await stranger.work.start(x.definition, {
      requestId: requestId('foreign'),
      objective: 1,
      context: [],
    }),
  );
  await expect(stranger.session.get(ref.id)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(stranger.session.history(ref)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(
    stranger.session.close(ref, {
      requestId: requestId('close'),
      expectedVersion: 1 as SessionVersion,
    }),
  ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(record(x, ref, 'link', { type: 'work', work: w })).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  expect((await x.api.session.inspect(ref)).cursor).toBe(0);
  const own = await work(x);
  await expect(
    record(x, ref, 'wrong', {
      type: 'work',
      work: { ...own, definition: { id: 'wrong', version: '1' } },
    }),
  ).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
});
test('one Work can belong to multiple Sessions without acquiring new execution ownership', async () => {
  let calls = 0;
  const x = open(
    fixture(async () => {
      calls++;
      return { status: 'success', value: 42 };
    }),
  );
  const a = await create(x, 'a');
  const b = await create(x, 'b');
  const w = await work(x);
  await record(x, a, 'link-a', { type: 'work', work: w });
  await record(x, b, 'link-b', { type: 'work', work: w });
  await record(x, a, 'link-again', { type: 'work', work: w });
  expect(rows(x.dir, 'SELECT * FROM session_work')).toHaveLength(2);
  await x.api.session.close(a, {
    requestId: requestId('close'),
    expectedVersion: (await x.api.session.inspect(a)).version,
  });
  await x.runtime.drain();
  expect(calls).toBe(1);
  expect(await x.api.work.result(w)).toEqual({ status: 'completed', result: 42 });
  expect((await x.api.session.inspect(b)).status).toBe('active');
});
test('closing a Session does not abort an admitted call or prevent recording its later result', async () => {
  let release!: (o: Outcome<number>) => void;
  let aborted = false;
  const f = fixture(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const cap = tool({
    ...f.cap,
    invoke: async (call) => {
      call.signal.addEventListener('abort', () => {
        aborted = true;
      });
      return f.cap.invoke(call);
    },
  });
  const x = open({ ...f, cap });
  const ref = await create(x);
  const w = await work(x);
  await record(x, ref, 'link', { type: 'work', work: w });
  const driving = x.runtime.drain();
  await x.api.session.close(ref, {
    requestId: requestId('close'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
  });
  expect(aborted).toBe(false);
  expect((await x.api.work.inspect(w)).calls[0]?.status).toBe('admitted');
  release({ status: 'success', value: 42 });
  await driving;
  expect((await record(x, ref, 'result', { type: 'result', work: w })).status).toBe('accepted');
  expect((await x.api.session.history(ref)).entries.at(-1)?.entry).toMatchObject({
    type: 'result',
    closure: { status: 'completed', result: 42 },
  });
});
test('closed Sessions reject new intake and associations but accept outputs for already-associated Work', async () => {
  const x = open();
  const ref = await create(x);
  const w = await work(x);
  await record(x, ref, 'link', { type: 'work', work: w });
  await x.api.session.close(ref, {
    requestId: requestId('close'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
  });
  for (const entry of [
    { type: 'input', content: 'new' },
    { type: 'output', content: 'unbound' },
    { type: 'work', work: w },
  ] as SessionContent[])
    expect(await record(x, ref, `closed-${entry.type}`, entry)).toMatchObject({
      status: 'rejected',
      reason: { code: 'SESSION_CLOSED' },
    });
  expect(
    (await record(x, ref, 'bound', { type: 'output', work: w, content: 'Still working' })).status,
  ).toBe('accepted');
  expect((await x.api.work.inspect(w)).status).toBe('active');
});
test('result records copy saved closure and cannot assert a fabricated result', async () => {
  const x = open();
  const ref = await create(x);
  const w = await work(x);
  expect(await record(x, ref, 'unlinked', { type: 'result', work: w })).toMatchObject({
    status: 'rejected',
    reason: { code: 'WORK_NOT_ASSOCIATED' },
  });
  await record(x, ref, 'link', { type: 'work', work: w });
  const version = (await x.api.session.inspect(ref)).version;
  const request: SessionRecord = {
    requestId: requestId('pending'),
    expectedVersion: version,
    entry: { type: 'result', work: w },
  };
  const rejected = await x.api.session.record(ref, request);
  expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'RESULT_PENDING' } });
  await x.runtime.drain();
  expect(await x.api.session.record(ref, request)).toEqual(rejected);
  expect(
    await record(x, ref, 'fake', {
      type: 'result',
      work: w,
      closure: { status: 'completed', result: 999 },
    } as SessionContent),
  ).toMatchObject({ status: 'rejected', reason: { code: 'UNSUPPORTED' } });
  expect((await record(x, ref, 'actual', { type: 'result', work: w })).status).toBe('accepted');
  const last = (await x.api.session.history(ref)).entries.at(-1)!;
  expect(last.entry).toMatchObject({ type: 'result', closure: { result: 42 } });
});
test('Work cancellation leaves the Session active and its canceled result recordable', async () => {
  const x = open();
  const ref = await create(x);
  const w = await work(x);
  await record(x, ref, 'link', { type: 'work', work: w });
  await x.api.work.cancel(w, {
    requestId: requestId('cancel'),
    expectedControl: (await x.api.work.inspect(w)).controlToken,
    reason: 'Stop',
  });
  await record(x, ref, 'result', { type: 'result', work: w });
  expect((await x.api.session.inspect(ref)).status).toBe('active');
  expect((await x.api.session.history(ref)).entries.at(-1)?.entry).toMatchObject({
    type: 'result',
    closure: { status: 'canceled' },
  });
});
test('capacity rejects without truncating history or preventing closure', async () => {
  const x = open();
  const ref = await create(x, 'session', 1);
  await record(x, ref, 'one', { type: 'input', content: 1 });
  const rejected = await record(x, ref, 'two', { type: 'input', content: 2 });
  expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'SESSION_CAPACITY' } });
  expect((await x.api.session.inspect(ref)).version).toBe(2);
  expect(
    (
      await x.api.session.close(ref, {
        requestId: requestId('close'),
        expectedVersion: (await x.api.session.inspect(ref)).version,
      })
    ).status,
  ).toBe('accepted');
  expect((await x.api.session.history(ref)).entries).toHaveLength(1);
});
test.each([
  null,
  'bad',
  { type: 'input' },
  { type: 'unknown', content: 1 },
  { type: 'input', content: 1, actor: 'admin' },
])('malformed entry receives a durable rejection: %j', async (entry) => {
  const x = open();
  const ref = await create(x);
  const request = {
    requestId: requestId('invalid'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
    entry,
  } as SessionRecord;
  const receipt = await x.api.session.record(ref, request);
  expect(receipt.status).toBe('rejected');
  expect(await x.api.session.record(ref, request)).toEqual(receipt);
  expect((await x.api.session.history(ref)).entries).toEqual([]);
});
test('invalid creation is durably rejected and closed runtime APIs fail consistently', async () => {
  const x = open();
  const request = { requestId: requestId('invalid'), title: '', maxEntries: 0 };
  const receipt = await x.api.session.create(request);
  expect(receipt.status).toBe('rejected');
  expect(await x.api.session.create(request)).toEqual(receipt);
  const ref = await create(x);
  await x.runtime.close();
  await expect(x.api.session.inspect(ref)).rejects.toMatchObject({ code: 'CLOSED' });
  await expect(
    x.api.session.create({ requestId: requestId('late'), title: 'Late' }),
  ).rejects.toMatchObject({ code: 'CLOSED' });
});
test('history and saved result publication remain available without Workflow code after restart', async () => {
  const x = open();
  const ref = await create(x);
  const w = await work(x);
  await record(x, ref, 'link', { type: 'work', work: w });
  await x.runtime.drain();
  await x.runtime.close();
  const runtime = new Runtime({ directory: x.dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  expect(
    (
      await api.session.record(ref, {
        requestId: requestId('result'),
        expectedVersion: (await api.session.inspect(ref)).version,
        entry: { type: 'result', work: w },
      })
    ).status,
  ).toBe('accepted');
  expect((await api.session.history(ref)).entries.at(-1)?.entry).toMatchObject({
    closure: { result: 42 },
  });
});
test.each(['create', 'record', 'close'] as const)(
  'SIGKILL after Session %s commit preserves a lost acknowledgement',
  async (action) => {
    const dir = directory();
    const child = fork(
      fileURLToPath(new URL('./session-worker.mjs', import.meta.url)),
      [dir, action],
      { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    children.push(child);
    const message = (await once(child, 'message'))[0];
    expect(message.action).toBe(action);
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    const x = open(fixture(), dir);
    if (action === 'create') {
      const receipt = await x.api.session.create(message.request);
      expect(receipt.status).toBe('accepted');
      expect(rows(dir, 'SELECT * FROM sessions')).toHaveLength(1);
    } else {
      const receipt =
        action === 'record'
          ? await x.api.session.record(message.ref, message.request)
          : await x.api.session.close(message.ref, message.request);
      expect(receipt.status).toBe('accepted');
      const snapshot = await x.api.session.inspect(message.ref);
      expect(snapshot.version).toBe(2);
      expect(snapshot.cursor).toBe(action === 'record' ? 1 : 0);
      expect(snapshot.status).toBe(action === 'close' ? 'closed' : 'active');
    }
  },
);

test('a closed Session still permits scoped Work replies; recorded output is not an approval', async () => {
  const f = fixture();
  const cap = tool({ ...f.cap, approval: { approvers: ['owner'], timeoutMs: 1000 } });
  const x = open({ ...f, cap });
  const ref = await create(x);
  const w = await work(x);
  await record(x, ref, 'link', { type: 'work', work: w });
  await x.runtime.drain();
  const before = await x.api.work.inspect(w);
  await x.api.session.close(ref, {
    requestId: requestId('close'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
  });
  await record(x, ref, 'text', { type: 'output', work: w, content: 'Approved' });
  await x.runtime.drain();
  expect((await x.api.work.inspect(w)).approvals[0]?.status).toBe('pending');
  await x.api.work.reply(w, {
    requestId: requestId('actual-approval'),
    wait: before.approvals[0]!.wait,
    payload: { decision: 'approve' },
  });
  await x.runtime.drain();
  expect(await x.api.work.result(w)).toEqual({ status: 'completed', result: 42 });
  expect((await record(x, ref, 'result', { type: 'result', work: w })).status).toBe('accepted');
});
test('one Session can reference successive objectives and Work progress does not change its version', async () => {
  const x = open();
  const ref = await create(x);
  const first = await work(x, 'first');
  await record(x, ref, 'link-first', { type: 'work', work: first });
  const before = await x.api.session.inspect(ref);
  await x.runtime.drain();
  expect((await x.api.session.inspect(ref)).version).toBe(before.version);
  const second = await work(x, 'second');
  await record(x, ref, 'link-second', { type: 'work', work: second });
  await record(x, ref, 'message', { type: 'input', content: 'New question' });
  expect(rows(x.dir, 'SELECT * FROM session_work')).toHaveLength(2);
  expect((await x.api.work.inspect(second)).inputs).toEqual([]);
  expect((await x.api.work.inspect(second)).calls).toEqual([]);
});
test('storage failure rolls back entry, version and receipt together before a retry', async () => {
  const x = open();
  const ref = await create(x);
  const request: SessionRecord = {
    requestId: requestId('record'),
    expectedVersion: (await x.api.session.inspect(ref)).version,
    entry: { type: 'input', content: 'hello' },
  };
  const db = new Database(join(x.dir, 'state.sqlite'));
  db.exec(
    "CREATE TRIGGER reject_entry BEFORE INSERT ON session_entries BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;",
  );
  await expect(x.api.session.record(ref, request)).rejects.toThrow('injected storage failure');
  expect(await x.api.session.inspect(ref)).toMatchObject({ version: 1, cursor: 0 });
  expect(rows(x.dir, "SELECT * FROM receipts WHERE request_id='record'")).toHaveLength(0);
  db.exec('DROP TRIGGER reject_entry');
  db.close();
  expect((await x.api.session.record(ref, request)).status).toBe('accepted');
  expect((await x.api.session.history(ref)).entries).toHaveLength(1);
});

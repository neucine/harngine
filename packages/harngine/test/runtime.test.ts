import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  createRuntime,
  schema,
  workflow,
  tool,
  requestId,
  type Receipt,
  type Outcome,
  type Proposal,
} from '../src/internal/index.js';
import type { Runtime } from '../src/internal/runtime.js';
const directories: string[] = [];
const runtimes: Runtime[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
  for (const child of processes.splice(0))
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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-runtime-')));
  directories.push(d);
  return d;
}
function fixture(
  invoke: (input: number) => Promise<Outcome<number>> = async (input) => ({
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
    invoke: async ({ input }) => invoke(input),
  });
  const definition = workflow({
    id: 'single-call',
    version: '1',
    artifactDigest: 'fixture-workflow-v1',
    objective: number,
    state: number,
    result: number,
    policy: { maxDecisions: 3, maxAttempts: 1 },
    tools: [{ id: cap.id, version: cap.version }],
    initial: () => 0,
    decide: (view): Proposal<number, number> =>
      view.state === 0
        ? {
            type: 'call',
            state: 1,
            call: {
              slot: 'increment',
              tool: { id: cap.id, version: cap.version },
              input: view.objective,
            },
          }
        : {
            type: 'complete',
            result: (view.calls.increment!.outcome as { status: 'success'; value: number }).value,
          },
  });
  return { number, cap, definition };
}
function open(dir: string, f = fixture()) {
  const runtime = createRuntime({ directory: dir, definitions: [f.definition], tools: [f.cap] });
  runtimes.push(runtime);
  return { runtime, api: runtime.forCaller({ principal: 'owner', source: 'test' }), ...f };
}
function accepted<T>(r: Receipt<T>): T {
  if (r.status !== 'accepted') throw new Error(JSON.stringify(r));
  return r.value;
}
const start = { requestId: requestId('start'), objective: 5, context: [] as const };
function query(dir: string, sql: string) {
  const db = new Database(join(dir, 'state.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

test('R1: exact retries survive closure/restart and conflicting content does not create Work', async () => {
  const dir = directory();
  let calls = 0;
  const f = fixture(async (input) => {
    calls++;
    return { status: 'success', value: input + 1 };
  });
  const first = open(dir, f);
  const receipt = await first.api.work.start(f.definition, start);
  const ref = accepted(receipt);
  await first.runtime.drain();
  expect(await first.api.work.result(ref)).toEqual({ status: 'completed', result: 6 });
  expect(await first.api.work.start(f.definition, start)).toEqual(receipt);
  expect((await first.api.work.start(f.definition, { ...start, objective: 7 })).status).toBe(
    'conflict',
  );
  await first.runtime.close();
  const second = open(dir, f);
  expect(await second.api.work.start(f.definition, start)).toEqual(receipt);
  await second.runtime.drain();
  expect(calls).toBe(1);
  expect(query(dir, 'SELECT id FROM work')).toHaveLength(1);
  expect(query(dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
});
test('validation rejects coercion, keeps durable rejection and preserves bounded context', async () => {
  const { runtime, api, definition } = open(directory());
  const bad = { ...start, objective: '5' as unknown as number };
  const receipt = await api.work.start(definition, bad);
  expect(receipt.status).toBe('rejected');
  expect(await api.work.start(definition, bad)).toEqual(receipt);
  const contextual = await api.work.start(definition, {
    ...start,
    requestId: requestId('context'),
    context: ['private'],
  });
  expect(contextual.status).toBe('accepted');
  if (contextual.status === 'accepted')
    expect((await api.work.inspect(contextual.value)).context).toEqual(['private']);
  await runtime.drain();
});
test('caller isolation, wrong typed definition and outcome cancellation', async () => {
  const { runtime, api, definition } = open(directory());
  const ref = accepted(await api.work.start(definition, start));
  await expect(
    runtime.forCaller({ principal: 'other', source: 'test' }).work.inspect(ref),
  ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  const different = workflow({ ...definition, id: 'different' });
  await expect(api.work.get(ref.id, different)).rejects.toMatchObject({
    code: 'CONTRACT_MISMATCH',
  });
  const abort = new AbortController();
  abort.abort();
  await expect(api.work.result(ref, { signal: abort.signal })).rejects.toBeDefined();
  await runtime.drain();
  expect((await api.work.inspect(ref)).closure?.status).toBe('completed');
});
test('R5: invalid next state commits no call and invokes nothing', async () => {
  const dir = directory();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { status: 'success', value: 1 };
  });
  const definition = workflow({
    ...f.definition,
    decide: () => ({
      type: 'call' as const,
      state: 'bad' as unknown as number,
      call: { slot: 'bad', tool: { id: f.cap.id, version: f.cap.version }, input: 5 },
    }),
  });
  const { runtime, api } = open(dir, { ...f, definition });
  const ref = accepted(await api.work.start(definition, start));
  await runtime.drain();
  expect((await api.work.inspect(ref)).closure?.status).toBe('failed');
  expect(calls).toBe(0);
  expect(query(dir, 'SELECT * FROM requests')).toEqual([]);
  expect((await api.work.inspect(ref)).state).toBe(0);
});
test.each(['throw', 'malformed', 'unknown'] as const)(
  'R5/R6: %s outcome cannot become no-effect or trigger replay',
  async (mode) => {
    const dir = directory();
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      if (mode === 'throw') throw new Error('timeout');
      if (mode === 'malformed')
        return { status: 'success', value: 'bad' } as unknown as Outcome<number>;
      return { status: 'unknown', reason: { code: 'TIMEOUT', message: 'unknown' } };
    });
    const { runtime, api } = open(dir, f);
    const ref = accepted(await api.work.start(f.definition, start));
    await runtime.drain();
    const snapshot = await api.work.inspect(ref);
    expect(snapshot.status).toBe('waiting');
    expect(snapshot.calls[0]!.status).toBe('unknown');
    expect(snapshot.closure).toBeNull();
    await runtime.close();
    const recovered = open(dir, f);
    await recovered.runtime.drain();
    expect(calls).toBe(1);
  },
);
test('registration is immutable and failed initialization releases ownership', async () => {
  const dir = directory();
  const f = fixture();
  const first = open(dir, f);
  await first.runtime.close();
  expect(() =>
    createRuntime({
      directory: dir,
      definitions: [workflow({ ...f.definition, artifactDigest: 'changed' })],
      tools: [f.cap],
    }),
  ).toThrowError(/changed/);
  const good = open(dir, f);
  await good.runtime.drain();
});
test('registration failure rolls back all new manifests', async () => {
  const dir = directory();
  const f = fixture();
  const first = open(dir, f);
  await first.runtime.close();
  const extra = tool({ ...f.cap, id: 'new' });
  expect(() =>
    createRuntime({
      directory: dir,
      definitions: [workflow({ ...f.definition, artifactDigest: 'changed' })],
      tools: [f.cap, extra],
    }),
  ).toThrow();
  expect(query(dir, "SELECT * FROM definitions WHERE id='new'")).toHaveLength(0);
});
test('definition registry separates persisted revisions from the currently executable revision', async () => {
  const dir = directory();
  const firstRevision = fixture();
  const first = open(dir, firstRevision);
  await first.runtime.close();

  const secondDefinition = workflow({
    ...firstRevision.definition,
    version: '2',
    artifactDigest: 'fixture-workflow-v2',
  });
  const restored = createRuntime({
    directory: dir,
    definitions: [secondDefinition],
    tools: [firstRevision.cap],
  });
  runtimes.push(restored);
  expect(restored.definitionRecords().filter((record) => record.kind === 'workflow')).toEqual([
    expect.objectContaining({ version: '1', available: false }),
    expect.objectContaining({ version: '2', available: true }),
  ]);
  const api = restored.forCaller({ principal: 'owner', source: 'revision-test' });
  await expect(api.work.start(firstRevision.definition, start)).resolves.toMatchObject({
    status: 'rejected',
    reason: { code: 'UNAVAILABLE' },
  });
  const acceptedWork = accepted(
    await api.work.start(secondDefinition, {
      ...start,
      requestId: requestId('start-v2'),
    }),
  );
  await restored.drain();
  await expect(api.work.result(acceptedWork)).resolves.toMatchObject({ status: 'completed' });
});
test('duplicate executable revisions fail before registration and release ownership', async () => {
  const dir = directory();
  const first = fixture();
  const duplicate = workflow({ ...first.definition });
  expect(() =>
    createRuntime({
      directory: dir,
      definitions: [first.definition, duplicate],
      tools: [first.cap],
    }),
  ).toThrowError(/Duplicate Workflow/);

  const recovered = open(dir, first);
  await expect(recovered.api.work.start(first.definition, start)).resolves.toMatchObject({
    status: 'accepted',
  });
});
test('checksummed storage format refuses migration tampering', async () => {
  const dir = directory();
  const first = open(dir);
  await first.runtime.close();
  const db = new Database(join(dir, 'state.sqlite'));
  db.exec("UPDATE schema_migrations SET checksum='changed'");
  db.close();
  expect(() => open(dir)).toThrowError(/migration/);
});
async function spawn(dir: string, boundary: string) {
  const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [dir, boundary], {
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  processes.push(child);
  expect((await once(child, 'message'))[0]).toBe(boundary);
  return child;
}
async function kill(child: ChildProcess) {
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}
test('local ownership is held across processes and released by process death', async () => {
  const dir = directory();
  const child = await spawn(dir, 'owner');
  expect(() => open(dir)).toThrowError(/ownership/);
  await kill(child);
  const reopened = open(dir);
  await reopened.runtime.drain();
});
test.each(['accepted', 'decision', 'admission', 'effect', 'outcome', 'closure'])(
  'SIGKILL after %s restores the correct execution boundary',
  async (boundary) => {
    const dir = directory();
    const child = await spawn(dir, boundary);
    await kill(child);
    let repeats = 0;
    const f = fixture(async (input) => {
      repeats++;
      return { status: 'success', value: input + 1 };
    });
    const { runtime, api } = open(dir, f);
    const ref = accepted(await api.work.start(f.definition, start));
    await runtime.drain();
    const snapshot = await api.work.inspect(ref);
    const beforeAdmission = boundary === 'accepted' || boundary === 'decision';
    expect(repeats).toBe(beforeAdmission ? 1 : 0);
    expect(query(dir, 'SELECT * FROM attempts')).toHaveLength(1);
    expect(query(dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
    if (boundary === 'admission' || boundary === 'effect') {
      expect(snapshot.status).toBe('waiting');
      expect(snapshot.calls[0]!.status).toBe('unknown');
      expect(snapshot.closure).toBeNull();
    } else expect(snapshot.closure).toEqual({ status: 'completed', result: 6 });
    const file = join(dir, 'external.log');
    const writes = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
    expect(writes.length).toBe(['effect', 'outcome', 'closure'].includes(boundary) ? 1 : 0);
    expect(query(dir, 'SELECT * FROM decisions')).toHaveLength(
      ['admission', 'effect'].includes(boundary) ? 1 : 2,
    );
  },
);

test('missing behavior blocks honestly while preserving inspection and exact receipt retries', async () => {
  const dir = directory();
  const first = open(dir);
  const receipt = await first.api.work.start(first.definition, start);
  const ref = accepted(receipt);
  await first.runtime.close();
  const runtime = createRuntime({ directory: dir, definitions: [], tools: [] });
  runtimes.push(runtime);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  await runtime.drain();
  const snapshot = await api.work.inspect(ref);
  expect(snapshot.status).toBe('waiting');
  expect(snapshot.concerns[0]!.code).toBe('DEFINITION_UNAVAILABLE');
  expect(await api.work.start(first.definition, start)).toEqual(receipt);
});
test('malformed approval and unsupported retry policies fail before activation', () => {
  const f = fixture();
  expect(() => tool({ ...f.cap, approval: true } as unknown as typeof f.cap)).toThrowError(
    /Unsupported/,
  );
  expect(() =>
    workflow({
      ...f.definition,
      policy: { ...f.definition.policy, retries: 3 },
    } as typeof f.definition),
  ).toThrowError(/Unsupported/);
});
test('attempt budget blocks a second call without refunding the first', async () => {
  const dir = directory();
  let calls = 0;
  const f = fixture(async (input) => {
    calls++;
    return { status: 'success', value: input };
  });
  const definition = workflow({
    ...f.definition,
    decide: (view) => ({
      type: 'call' as const,
      state: view.state + 1,
      call: {
        slot: `call-${view.state}`,
        tool: { id: f.cap.id, version: f.cap.version },
        input: 5,
      },
    }),
  });
  const { runtime, api } = open(dir, { ...f, definition });
  const ref = accepted(await api.work.start(definition, start));
  await runtime.drain();
  expect(calls).toBe(1);
  expect((await api.work.inspect(ref)).closure).toMatchObject({
    status: 'failed',
    reason: { code: 'ATTEMPT_LIMIT' },
  });
  expect(query(dir, 'SELECT * FROM capacity_entries')).toHaveLength(1);
});

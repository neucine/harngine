import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  ConflictError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
  WorkCanceledError,
  createApp,
  schema,
  workflow,
  tool,
  type App,
  type TelemetryEvent,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-app-')));
  directories.push(value);
  return value;
}

const number = schema<number>({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
const double = workflow({
  id: 'double',
  objective: number,
  result: number,
  run: (objective) => objective * 2,
});

function open(): App {
  const app = createApp({ directory: directory(), workflows: [double] });
  apps.push(app);
  return app;
}

test('App runs a definition without request IDs or drain', async () => {
  const app = open();
  await expect(app.run(double, 21)).resolves.toBe(42);
});

test('telemetry receives only post-commit identities and cannot affect execution', async () => {
  const events: TelemetryEvent[] = [];
  const app = createApp({
    directory: directory(),
    workflows: [double],
    telemetry: {
      emit(event) {
        events.push(event);
        if (event.kind === 'decision.committed') throw new Error('exporter unavailable');
      },
    },
  });
  apps.push(app);

  await expect(app.run(double, 4)).resolves.toBe(8);
  expect(events.map((event) => event.kind)).toEqual([
    'work.accepted',
    'decision.committed',
    'work.closed',
  ]);
  expect(events.every((event) => event.object === 'telemetry_event' && event.eventId)).toBe(true);
  expect(events.every((event) => !('body' in event))).toBe(true);
});

test('Work exposes public state, result and idempotent terminal cancellation', async () => {
  const app = open();
  const work = await app.start(double, 6);
  expect(work.id).toBeTruthy();
  await expect(work.result()).resolves.toBe(12);
  expect(await work.snapshot()).toMatchObject({
    usage: { decisions: 1, modelTurns: 0, toolExecutions: 0 },
    limits: { maxDecisions: expect.any(Number), maxAttempts: expect.any(Number) },
  });
  await expect(work.cancel()).resolves.toMatchObject({ status: 'completed', result: 12 });
});

test('Tool approval Interactions use the public Boolean response contract', async () => {
  const approved = tool({
    id: 'app.approved-write',
    input: number,
    output: number,
    effect: 'write',
    approval: { approvers: ['local'], timeoutMs: 1000 },
    execute: (value) => value,
  });
  const definition = workflow({
    id: 'app.approval-workflow',
    objective: number,
    result: number,
    tools: [approved],
    run: (objective, flow) => flow.call('write', approved, objective),
  });
  const app = createApp({ directory: directory(), workflows: [definition], tools: [approved] });
  apps.push(app);
  const work = await app.start(definition, 8);
  let snapshot = await work.snapshot();
  for (let index = 0; index < 30 && !snapshot.interactions.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await work.snapshot();
  }
  await expect(work.respond(snapshot.interactions[0]!.id, 'approve')).rejects.toBeInstanceOf(
    ValidationError,
  );
  await work.respond(snapshot.interactions[0]!.id, true);
  await expect(work.result()).resolves.toBe(8);
});

test('cancel returns a typed result error and principal access stays scoped', async () => {
  const waiting = workflow({
    id: 'waiting',
    objective: number,
    result: number,
    async run(objective, flow) {
      await flow.sleep('wait', 60_000);
      return objective;
    },
  });
  const app = createApp({ directory: directory(), workflows: [waiting] });
  apps.push(app);
  const work = await app.start(waiting, 1);
  expect((await work.cancel('stop')).status).toBe('canceled');
  await expect(work.result()).rejects.toBeInstanceOf(WorkCanceledError);

  await expect(
    app.forPrincipal('other').start(waiting, 1, { idempotencyKey: 'other-scope' }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(app.start(waiting, 1, { idempotencyKey: 'same' })).resolves.toBeDefined();
  await expect(app.start(waiting, 2, { idempotencyKey: 'same' })).rejects.toBeInstanceOf(
    ConflictError,
  );
});

test('definitions expose exact revisions and exact references start Work', async () => {
  const app = open();
  const page = await app.definitions.list({ kind: 'workflow' });
  expect(page.next).toBeNull();
  expect(page.definitions).toEqual([
    expect.objectContaining({
      object: 'workflow',
      kind: 'workflow',
      id: double.id,
      revision: double.revision,
      availability: 'available',
      objective: { type: 'integer' },
    }),
  ]);

  const selected = page.definitions[0]!;
  if (selected.kind !== 'workflow') throw new Error('expected Workflow');
  const work = await app.start(selected, 9);
  expect(work.id).toMatch(/^work_[A-Za-z0-9_-]{16}$/);
  await expect(work.result()).resolves.toBe(18);
  await expect(app.definitions.get(selected)).resolves.toEqual(selected);
});

test('principal-scoped Work discovery reconnects handles in stable creation order', async () => {
  const app = createApp({
    directory: directory(),
    workflows: [double],
    access: { allowAuthenticated: true },
  });
  apps.push(app);
  const local = await app.start(double, 2);
  const otherScope = app.forPrincipal('other');
  const other = await otherScope.start(double, 3);
  await Promise.all([local.result(), other.result()]);

  const localPage = await app.works.list({ limit: 1 });
  expect(localPage.works).toHaveLength(1);
  expect(localPage.works[0]).toMatchObject({
    object: 'work',
    id: local.id,
    objective: 2,
    status: 'completed',
    definition: { kind: 'workflow', id: double.id, revision: double.revision },
  });
  expect(localPage.works[0]!.createdAt).toBeLessThanOrEqual(localPage.works[0]!.updatedAt);
  await expect((await app.works.get(local.id)).result()).resolves.toBe(4);
  await expect(otherScope.works.get(local.id)).rejects.toBeInstanceOf(UnauthorizedError);
  expect((await otherScope.works.list()).works.map((work) => work.id)).toEqual([other.id]);
});

test('persisted definitions and completed Work remain inspectable when code is unavailable', async () => {
  const location = directory();
  const first = createApp({ directory: location, workflows: [double] });
  const work = await first.start(double, 11);
  await expect(work.result()).resolves.toBe(22);
  await first.close();

  const restored = createApp({ directory: location });
  apps.push(restored);
  const description = await restored.definitions.get({
    object: 'workflow',
    kind: 'workflow',
    id: double.id,
    revision: double.revision,
  });
  expect(description.availability).toBe('unavailable');
  if (description.kind !== 'workflow') throw new Error('expected Workflow');
  const reopened = await restored.works.get(work.id);
  await expect(reopened.snapshot()).resolves.toMatchObject({
    id: work.id,
    status: 'completed',
    result: 22,
  });
  await expect(restored.start(description, 1)).rejects.toBeInstanceOf(UnavailableError);
});

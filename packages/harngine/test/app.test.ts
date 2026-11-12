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
  agent,
  createApp,
  schema,
  workflow,
  tool,
  type App,
  type ModelAdapter,
  type ModelRequest,
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

test('Session handoff changes ownership only at an idle boundary and preserves lineage', async () => {
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'support-handoff-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      requests.push(request);
      const instructions = request.instructions.join('\n');
      return {
        object: 'model_response',
        items: [
          {
            type: 'text',
            text: instructions.includes('billing specialist')
              ? 'Billing will review the duplicate charge.'
              : 'route:billing',
          },
        ],
        finishReason: 'stop',
      };
    },
  };
  const triage = agent({
    id: 'support.triage',
    instructions: 'Route the request.',
    objective: schema<string>({
      id: 'support.message',
      version: '1',
      jsonSchema: { type: 'string' },
    }),
    model,
  });
  const billing = agent({
    id: 'support.billing',
    instructions: 'You are the billing specialist.',
    objective: schema<string>({
      id: 'support.message',
      version: '1',
      jsonSchema: { type: 'string' },
    }),
    model,
  });
  const app = createApp({ directory: directory(), agents: [triage, billing] });
  apps.push(app);
  const session = await app.sessions.create({ agent: triage, title: 'Billing support' });
  const first = await session.send('My card was charged twice.');
  await expect(first.work.result()).resolves.toBe('route:billing');
  expect((await session.snapshot()).agent).toMatchObject({
    id: triage.id,
    revision: triage.revision,
  });

  const watcher = await session.watch();
  const iterator = watcher[Symbol.asyncIterator]();
  const nextUpdate = iterator.next();
  const billingSession = await session.handoff(billing, {
    reason: 'Duplicate charge requires billing',
    idempotencyKey: 'support-route-billing',
  });
  expect((await nextUpdate).value).toMatchObject({
    value: {
      event: 'ownership.changed',
      snapshot: { agent: { id: billing.id, revision: billing.revision } },
    },
  });
  await iterator.return?.();
  expect((await billingSession.snapshot()).agent).toMatchObject({
    id: billing.id,
    revision: billing.revision,
  });
  const retried = await session.handoff(billing, {
    reason: 'Duplicate charge requires billing',
    idempotencyKey: 'support-route-billing',
  });
  expect(retried.id).toBe(session.id);
  await expect(session.send('Use the stale handle')).rejects.toMatchObject({
    code: 'SESSION_HANDED_OFF',
  });

  const followUp = await billingSession.send('Please refund the duplicate charge.');
  await expect(followUp.work.result()).resolves.toBe('Billing will review the duplicate charge.');
  expect(requests.at(-1)?.context.objective).toBe('Please refund the duplicate charge.');
  expect(requests.at(-1)?.context.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'reference',
        content: expect.objectContaining({
          type: 'output',
          content: 'route:billing',
        }),
      }),
    ]),
  );
  expect(await billingSession.handoffs()).toEqual([
    expect.objectContaining({
      object: 'session_handoff',
      from: expect.objectContaining({ id: triage.id, revision: triage.revision }),
      to: expect.objectContaining({ id: billing.id, revision: billing.revision }),
      reason: 'Duplicate charge requires billing',
    }),
  ]);
  await billingSession.close();
});

test('Session handoff rejects active Work and unauthorized ownership transfer', async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model: ModelAdapter = {
    id: 'held-support-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      if (request.instructions.join('\n').includes('Current owner')) await waiting;
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'specialist answer' }],
        finishReason: 'stop',
      };
    },
  };
  const text = schema<string>({
    id: 'support-busy-message',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const owner = agent({
    id: 'support.owner',
    instructions: 'Current owner.',
    objective: text,
    model,
  });
  const specialist = agent({
    id: 'support.specialist',
    instructions: 'Specialist.',
    objective: text,
    model,
  });
  const app = createApp({
    directory: directory(),
    agents: [owner, specialist],
    access: {
      revision: 'deny-handoff-v1',
      canStart: () => true,
      canCall: () => true,
      canRespond: () => true,
      canHandoff: () => false,
    },
  });
  apps.push(app);
  const session = await app.sessions.create({ agent: owner, title: 'Busy support' });
  const active = await session.send('Keep working');
  await expect(session.handoff(specialist)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  release();
  await active.work.result();

  await expect(session.handoff(specialist)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(session.handoff(owner)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
});

test('Session handoff and its conversation lineage survive App restart', async () => {
  const location = directory();
  const text = schema<string>({
    id: 'restart-handoff-message',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const model: ModelAdapter = {
    id: 'restart-handoff-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'handled after restart' }],
        finishReason: 'stop',
      };
    },
  };
  const triage = agent({
    id: 'restart-support.triage',
    instructions: 'Triage.',
    objective: text,
    model,
  });
  const billing = agent({
    id: 'restart-support.billing',
    instructions: 'Billing.',
    objective: text,
    model,
  });
  const firstApp = createApp({ directory: location, agents: [triage, billing] });
  apps.push(firstApp);
  const session = await firstApp.sessions.create({ agent: triage, title: 'Restart handoff' });
  const initial = await session.send('charge');
  await initial.work.result();
  const billingSession = await session.handoff(billing, { reason: 'billing owns this' });
  await firstApp.close();

  const reopened = createApp({ directory: location, agents: [triage, billing] });
  apps.push(reopened);
  const restored = await reopened.sessions.get(session.id);
  expect((await restored.snapshot()).agent).toMatchObject({
    id: billing.id,
    revision: billing.revision,
  });
  await expect(restored.handoffs()).resolves.toEqual([
    expect.objectContaining({
      from: expect.objectContaining({ id: triage.id, revision: triage.revision }),
      to: expect.objectContaining({ id: billing.id, revision: billing.revision }),
      reason: 'billing owns this',
    }),
  ]);
  const followUp = await restored.send('refund');
  await expect(followUp.work.result()).resolves.toBe('handled after restart');
  expect((await restored.messages()).map((message) => message.author)).toEqual([
    'human',
    'agent',
    'human',
    'agent',
  ]);
  expect(billingSession.id).toBe(session.id);
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

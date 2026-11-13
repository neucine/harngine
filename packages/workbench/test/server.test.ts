import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { agent, createApp, schema, workflow, type App, type ModelAdapter } from 'harngine';
import { serveWorkbench, type WorkbenchServer } from '../src/index.js';

const apps: App[] = [];
const servers: WorkbenchServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const number = schema<number>({
  id: 'workbench.number',
  version: '1',
  jsonSchema: { type: 'integer' },
});
const double = workflow({
  id: 'workbench.double',
  objective: number,
  result: number,
  run: (objective) => objective * 2,
});

function open() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-workbench-')));
  directories.push(directory);
  const app = createApp({ directory, workflows: [double] });
  apps.push(app);
  return app;
}

async function started() {
  const app = open();
  const server = await serveWorkbench({ app });
  servers.push(server);
  const headers = { authorization: `Bearer ${server.capability}` };
  return { app, server, headers };
}

test('serves stable browser routes and protects the public protocol with a local capability', async () => {
  const { server, headers } = await started();
  const page = await fetch(`${server.url}definitions/workflow/example/rev_example`);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('Harngine Workbench');
  expect(html).toContain('<script type="module" src="/main.mjs"></script>');
  expect(html).toContain(`<meta name="workbench-capability" content="${server.capability}" />`);
  expect(page.headers.get('content-security-policy')).toContain("script-src 'self';");
  const appAsset = await fetch(`${server.url}App.mjs`);
  expect(appAsset.status).toBe(200);
  expect(appAsset.headers.get('content-type')).toContain('text/javascript');
  const appSource = await appAsset.text();
  expect(appSource).toContain('loadInspection');
  expect(appSource).toContain('model.delta');
  const styles = await fetch(`${server.url}styles.css`);
  expect(styles.status).toBe(200);
  expect(await styles.text()).toContain('.shell');

  const denied = await fetch(`${server.url}api/v1/definitions`);
  expect(denied.status).toBe(401);
  const allowed = await fetch(`${server.url}api/v1/definitions`, { headers });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toMatchObject({
    object: 'list',
    definitions: [
      {
        object: 'workflow',
        kind: 'workflow',
        id: double.id,
        revision: double.revision,
        availability: 'available',
      },
    ],
  });
});

test('Workbench streams model previews and exposes its audit projection', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const text = schema<string>({
    id: 'workbench.stream',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const model: ModelAdapter = {
    id: 'workbench.stream-model',
    capabilities: { tools: false, structuredOutput: false, streaming: true },
    async generate(_request, context) {
      await gate;
      context.emit({ type: 'text', text: 'live workbench' });
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'durable workbench' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'workbench.stream-agent',
    instructions: 'Answer.',
    objective: text,
    model,
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-workbench-')));
  directories.push(directory);
  const app = createApp({ directory, agents: [assistant] });
  apps.push(app);
  const server = await serveWorkbench({ app });
  servers.push(server);
  const headers = {
    authorization: `Bearer ${server.capability}`,
    'content-type': 'application/json',
  };
  const startedWork = await fetch(`${server.url}api/v1/works`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_stream_agent' },
    body: JSON.stringify({
      definition: {
        object: 'agent',
        kind: 'agent',
        id: assistant.id,
        revision: assistant.revision,
      },
      objective: 'hello',
    }),
  });
  const work = (await startedWork.json()) as { id: string };
  const events = await fetch(`${server.url}api/v1/works/${work.id}/events?modelDeltas=1`, {
    headers: { authorization: headers.authorization },
  });
  expect(events.status).toBe(200);
  release();
  const stream = await events.text();
  expect(stream).toContain('event: model.delta');
  expect(stream).toContain('live workbench');

  const audit = await fetch(`${server.url}api/v1/audit?limit=100`, {
    headers: { authorization: headers.authorization },
  });
  expect(audit.status).toBe(200);
  expect(await audit.json()).toMatchObject({
    object: 'list',
    entries: expect.arrayContaining([
      expect.objectContaining({ category: 'work', correlation: { workId: work.id } }),
    ]),
  });
});

test('Workbench audit access requires its independent read permission', async () => {
  const app = open();
  const server = await serveWorkbench({
    app,
    authenticate: () => ({ principal: 'local', permissions: ['work:read'] }),
  });
  servers.push(server);
  const response = await fetch(`${server.url}api/v1/audit`);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: 'ACCESS_DENIED', message: 'Permission audit:read is required' },
  });
});

test('commands require retry keys and duplicate starts return the same durable Work', async () => {
  const { server, headers } = await started();
  const url = `${server.url}api/v1/works`;
  const body = JSON.stringify({
    definition: { object: 'workflow', kind: 'workflow', id: double.id, revision: double.revision },
    objective: 21,
  });
  expect(
    await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    }),
  ).toMatchObject({ status: 400 });
  const commandHeaders = {
    ...headers,
    'content-type': 'application/json',
    'idempotency-key': 'req_retry_start',
  };
  const first = await fetch(url, { method: 'POST', headers: commandHeaders, body });
  const second = await fetch(url, { method: 'POST', headers: commandHeaders, body });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect((await first.json()).id).toBe((await second.json()).id);
});

test('closing an SSE observer leaves the Work running and reconnectable', async () => {
  const waiting = workflow({
    id: 'workbench.waiting',
    objective: number,
    result: number,
    async run(objective, flow) {
      await flow.sleep('pause', 80);
      return objective;
    },
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-workbench-')));
  directories.push(directory);
  const app = createApp({ directory, workflows: [waiting] });
  apps.push(app);
  const server = await serveWorkbench({ app });
  servers.push(server);
  const authorization = `Bearer ${server.capability}`;
  const start = await fetch(`${server.url}api/v1/works`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      'idempotency-key': 'req_stream_work',
    },
    body: JSON.stringify({
      definition: {
        object: 'workflow',
        kind: 'workflow',
        id: waiting.id,
        revision: waiting.revision,
      },
      objective: 7,
    }),
  });
  const work = (await start.json()) as { id: string };
  const abort = new AbortController();
  const events = await fetch(`${server.url}api/v1/works/${work.id}/events`, {
    headers: { authorization },
    signal: abort.signal,
  });
  expect(events.status).toBe(200);
  await events.body?.getReader().read();
  abort.abort();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const reopened = await fetch(`${server.url}api/v1/works/${work.id}`, {
    headers: { authorization },
  });
  expect(await reopened.json()).toMatchObject({ id: work.id, status: 'completed', result: 7 });
});

test('Session messages queue follow-up Work while explicit steering addresses foreground Work', async () => {
  const text = schema<string>({
    id: 'workbench.message',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const model: ModelAdapter = {
    id: 'workbench.blocked-model',
    capabilities: {
      tools: false,
      structuredOutput: true,
      streaming: false,
      contextWindow: 4096,
      defaultOutputReserve: 256,
    },
    generate(_request, context) {
      return new Promise((_resolve, reject) =>
        context.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        }),
      );
    },
  };
  const assistant = agent({
    id: 'workbench.assistant',
    instructions: 'Wait for input.',
    objective: text,
    result: text,
    publish: false,
    model,
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-workbench-')));
  directories.push(directory);
  const app = createApp({ directory, agents: [assistant] });
  apps.push(app);
  const server = await serveWorkbench({ app });
  servers.push(server);
  const headers = {
    authorization: `Bearer ${server.capability}`,
    'content-type': 'application/json',
  };
  const created = await fetch(`${server.url}api/v1/sessions`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_create_session' },
    body: JSON.stringify({
      agent: { object: 'agent', kind: 'agent', id: assistant.id, revision: assistant.revision },
      title: 'Test Session',
    }),
  });
  const session = (await created.json()) as { id: string };
  const messageUrl = `${server.url}api/v1/sessions/${session.id}/messages`;
  const first = await fetch(messageUrl, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_first_message' },
    body: JSON.stringify({ content: 'first objective' }),
  });
  expect(first.status).toBe(200);
  const firstSnapshot = (await first.json()) as { foregroundWork: { id: string } };
  const second = await fetch(messageUrl, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_active_message' },
    body: JSON.stringify({ content: 'additional information' }),
  });
  expect(second.status).toBe(200);
  const secondSnapshot = (await second.json()) as {
    foregroundWork: { id: string };
    queuedWorkIds: string[];
  };
  expect(secondSnapshot.foregroundWork.id).toBe(firstSnapshot.foregroundWork.id);
  expect(secondSnapshot.queuedWorkIds).toHaveLength(1);
  const queuedWorkId = secondSnapshot.queuedWorkIds[0]!;

  const listed = await fetch(`${server.url}api/v1/works?sessionId=${session.id}`, {
    headers: { authorization: headers.authorization },
  });
  const listedBody = (await listed.json()) as { works: { id: string; status: string }[] };
  expect(listedBody.works).toHaveLength(2);
  expect(listedBody.works).toContainEqual(
    expect.objectContaining({ id: queuedWorkId, status: 'queued' }),
  );

  const steered = await fetch(messageUrl, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_steer_work' },
    body: JSON.stringify({ content: 'current correction', delivery: 'steer' }),
  });
  expect(steered.status).toBe(200);
  const steeredSnapshot = (await steered.json()) as {
    foregroundWork: { id: string };
    queuedWorkIds: string[];
    recentMessages: { author: string; content: string; workId?: string }[];
  };
  expect(steeredSnapshot.foregroundWork.id).toBe(firstSnapshot.foregroundWork.id);
  expect(steeredSnapshot.queuedWorkIds).toEqual([queuedWorkId]);
  expect(steeredSnapshot.recentMessages).toContainEqual(
    expect.objectContaining({
      author: 'human',
      content: 'current correction',
      workId: firstSnapshot.foregroundWork.id,
    }),
  );

  await fetch(`${server.url}api/v1/works/${firstSnapshot.foregroundWork.id}/cancel`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_cancel_agent' },
    body: '{}',
  });

  let promoted: { foregroundWork: { id: string } | null; queuedWorkIds: string[] } | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${server.url}api/v1/sessions/${session.id}`, {
      headers: { authorization: headers.authorization },
    });
    promoted = (await response.json()) as typeof promoted;
    if (promoted?.foregroundWork?.id === queuedWorkId) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(promoted?.foregroundWork?.id).toBe(queuedWorkId);
  expect(promoted?.queuedWorkIds).toEqual([]);

  await fetch(`${server.url}api/v1/works/${queuedWorkId}/cancel`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'req_cancel_queued_agent' },
    body: '{}',
  });
});

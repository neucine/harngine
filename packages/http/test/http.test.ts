import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { agent, createApp, schema, tool, type App, type ModelAdapter } from 'harngine';
import { createHarngineHttpServer } from '../src/index.js';
import type { Server } from 'node:http';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

test('authenticated HTTP client can create a session and complete Work', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-http-')));
  const model: ModelAdapter = {
    id: 'http-test-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate() {
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'http-test-agent',
    instructions: 'Answer.',
    objective: schema<string>({
      id: 'http-test-text',
      version: '1',
      jsonSchema: { type: 'string' },
    }),
    model,
  });
  const app: App = createApp({
    directory,
    agents: [assistant],
    access: { allowAuthenticated: true },
  });
  const server: Server = createHarngineHttpServer({
    app,
    authenticate: (request) => (request.headers.authorization === 'Bearer test' ? 'tester' : null),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`;
  expect((await fetch(base + '/definitions')).status).toBe(401);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  };
  const definitions = await call('/definitions');
  const session = await call('/sessions', 'POST', {
    agent: definitions.definitions[0],
    title: 'Test',
  });
  const sent = await call(`/sessions/${session.id}/messages`, 'POST', { message: 'hello' });
  let snapshot = sent.work;
  for (let attempt = 0; attempt < 50 && snapshot.status !== 'completed'; attempt++) {
    await new Promise((done) => setTimeout(done, 20));
    snapshot = await call(`/works/${sent.work.id}`);
  }
  expect(snapshot.status).toBe('completed');
  expect(snapshot.result).toBe('done');
});

test('HTTP client can resolve an uncertain write effect and resume Work', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-http-resolution-')));
  const text = schema<string>({
    id: 'http-resolution-text',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const uncertain = tool({
    id: 'http-resolution-write',
    description: 'Write a value with uncertain receipt.',
    input: text,
    output: text,
    effect: 'write',
    execute(_value, context) {
      return context.effectUnknown({ code: 'LOST_RECEIPT', message: 'Result unknown' });
    },
  });
  let turns = 0;
  const model: ModelAdapter = {
    id: 'http-resolution-model',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate() {
      turns++;
      return turns === 1
        ? {
            object: 'model_response',
            items: [
              { type: 'tool-call', providerCallId: 'call-1', tool: uncertain.id, input: 'write' },
            ],
            finishReason: 'tool-calls',
          }
        : {
            object: 'model_response',
            items: [{ type: 'text', text: 'Recovered' }],
            finishReason: 'stop',
          };
    },
  };
  const assistant = agent({
    id: 'http-resolution-agent',
    instructions: 'Use the Tool.',
    objective: text,
    model,
    tools: [uncertain],
  });
  const app = createApp({ directory, agents: [assistant], access: { allowAuthenticated: true } });
  const server = createHarngineHttpServer({
    app,
    authenticate: (request) => (request.headers.authorization === 'Bearer test' ? 'tester' : null),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  };
  const definitions = await call('/definitions');
  const selected = definitions.definitions.find((item: { id: string }) => item.id === assistant.id);
  const session = await call('/sessions', 'POST', { agent: selected, title: 'Recovery test' });
  const sent = await call(`/sessions/${session.id}/messages`, 'POST', { message: 'Do the write' });
  let snapshot = sent.work;
  for (let attempt = 0; attempt < 100 && snapshot.waitingFor !== 'effect-resolution'; attempt++) {
    await new Promise((done) => setTimeout(done, 10));
    snapshot = await call(`/works/${sent.work.id}`);
  }
  expect(snapshot.waitingFor).toBe('effect-resolution');
  const inspection = await call(`/works/${sent.work.id}/inspect?detail=diagnostic`);
  const uncertainCall = inspection.entries.find(
    (entry: { type: string; phase?: string }) =>
      entry.type === 'call' && entry.phase === 'uncertain',
  );
  expect(uncertainCall?.callId).toBeTruthy();
  const invalid = await fetch(`${base}/works/${sent.work.id}/resolve-effect`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId: uncertainCall.callId, resolution: { status: 'success' } }),
  });
  expect(invalid.status).toBe(400);
  await call(`/works/${sent.work.id}/resolve-effect`, 'POST', {
    callId: uncertainCall.callId,
    resolution: { status: 'success', value: 'write completed' },
    idempotencyKey: 'http-recovery-1',
  });
  for (let attempt = 0; attempt < 100 && snapshot.status !== 'completed'; attempt++) {
    await new Promise((done) => setTimeout(done, 10));
    snapshot = await call(`/works/${sent.work.id}`);
  }
  expect(snapshot).toMatchObject({ status: 'completed', result: 'Recovered' });
});

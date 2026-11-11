import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session, SessionId } from 'harngine';
import type { QuestEngine } from './engine.js';
import type { MetProvider, ProviderMode } from './met-provider.js';
import { page } from './page.js';
import { WorldStore, type VisitorRow } from './world-store.js';
import { objectIds, worldObject, type WorldObject } from './world.js';

interface ServerOptions {
  readonly engine: QuestEngine;
  readonly provider: MetProvider;
  readonly providerMode: ProviderMode;
  readonly store: WorldStore;
  readonly port?: number;
}

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), '../public');
const assets = new Map([
  ['/App.mjs', 'text/javascript; charset=utf-8'],
  ['/main.mjs', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
]);

export async function serveQuest(options: ServerOptions) {
  const apiToken = randomBytes(24).toString('hex');
  const objects: WorldObject[] = await Promise.all(
    objectIds.map(async (objectId) => worldObject(await options.provider.object(objectId))),
  );
  const byId = new Map(objects.map((item) => [item.id, item]));
  const rate = new Map<string, { start: number; count: number }>();
  let origin = '';
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src https://images.metmuseum.org; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return json(403, { error: 'Origin rejected' });
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(apiToken));
      return;
    }
    if (req.method === 'GET' && req.url && assets.has(req.url)) {
      const path = join(publicDirectory, req.url.slice(1));
      await stat(path);
      res.writeHead(200, { 'Content-Type': assets.get(req.url)! });
      createReadStream(path).pipe(res);
      return;
    }
    if (req.headers['x-quest-token'] !== apiToken)
      return json(403, { error: 'Open Quest from its world page' });
    const remote = req.socket.remoteAddress ?? 'local';
    const now = Date.now();
    const bucket = rate.get(remote);
    if (!bucket || now - bucket.start > 60_000) rate.set(remote, { start: now, count: 1 });
    else if (++bucket.count > 150)
      return json(429, { error: 'Pause here for a moment before wandering on' });
    try {
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      if (req.method === 'POST' && req.url === '/api/visitors') {
        const auth = options.store.enter(String(body?.name ?? ''));
        const visitor = options.store.authenticate(auth.visitorToken);
        const perspective = await turn(
          options,
          visitor,
          'arrive',
          visitor.current_object_id,
          [],
          [],
        );
        return json(201, { ...auth, perspective });
      }
      const supplied = req.headers['x-visitor-token'];
      if (typeof supplied !== 'string')
        return json(401, { error: 'Your visitor token is required' });
      const visitor = options.store.authenticate(supplied);
      if (req.method === 'GET' && req.url === '/api/world')
        return json(200, options.store.state(visitor.id, objects, options.providerMode));
      if (req.method === 'POST' && req.url === '/api/return') {
        const echoes = options.store.echoesSince(visitor, visitor.current_object_id);
        const perspective = await turn(
          options,
          visitor,
          'return',
          visitor.current_object_id,
          options.store.priorVisits(visitor.id),
          echoes,
        );
        options.store.markSeen(visitor.id);
        return json(200, { perspective });
      }
      if (req.method === 'POST' && req.url === '/api/wander') {
        const objectId = Number(body?.objectId);
        if (!byId.has(objectId)) throw new Error('That object is outside this constellation');
        const prior = options.store.priorVisits(visitor.id);
        options.store.wander(visitor.id, objectId);
        const echoes = options.store.echoesSince(visitor, objectId);
        const perspective = await turn(options, visitor, 'wander', objectId, prior, echoes);
        return json(200, { perspective });
      }
      if (req.method === 'POST' && req.url === '/api/interpret') {
        const objectId = Number(body?.objectId);
        const text = String(body?.text ?? '');
        const triggerId = options.store.interpret(visitor.id, objectId, text);
        const companion = options.store.companionObject(objectId, text);
        return json(
          200,
          await react(options, visitor.id, triggerId, 'interpretation', text, [
            objectId,
            companion,
          ]),
        );
      }
      if (req.method === 'POST' && req.url === '/api/connect') {
        const from = Number(body?.from);
        const to = Number(body?.to);
        const label = String(body?.label ?? '');
        const triggerId = options.store.connect(visitor.id, from, to, label);
        return json(
          200,
          await react(options, visitor.id, triggerId, 'connection', label, [from, to]),
        );
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/inspection/')) {
        const workId = req.url.slice('/api/inspection/'.length);
        const work = await options.engine.app
          .forPrincipal('quest:world')
          .works.get(workId as never);
        return json(200, await work.inspect({ detail: 'story', limit: 100 }));
      }
      return json(404, { error: 'Not found' });
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

async function session(options: ServerOptions, visitor: VisitorRow): Promise<Session> {
  const scope = options.engine.app.forPrincipal(visitor.id);
  if (visitor.session_id) return scope.sessions.get(visitor.session_id as SessionId);
  const created = await scope.sessions.create({
    agent: options.engine.perspective,
    title: 'A private path through the Museum of Nearby Things',
    idempotencyKey: `perspective:${visitor.id}`,
  });
  options.store.setSession(visitor.id, created.id);
  return created;
}

async function turn(
  options: ServerOptions,
  visitor: VisitorRow,
  type: 'arrive' | 'wander' | 'return',
  objectId: number,
  priorVisits: number[],
  echoes: string[],
) {
  const activeSession = await session(options, visitor);
  const sent = await activeSession.send({
    type,
    objectId,
    priorVisits: priorVisits.slice(0, 20),
    echoes: echoes.slice(0, 12),
  });
  return sent.work.result();
}

async function react(
  options: ServerOptions,
  visitorId: string,
  triggerId: string,
  kind: 'interpretation' | 'connection',
  text: string,
  objectIds: [number, number],
) {
  const work = await options.engine.app
    .forPrincipal('quest:world')
    .start(
      options.engine.react,
      { kind, text, objectIds },
      { idempotencyKey: `reaction:${triggerId}` },
    );
  const result = (await work.result()) as unknown as {
    text: string;
    objectIds: number[];
    sources: unknown;
  };
  options.store.rememberReaction({
    visitorId,
    triggerId,
    text: result.text,
    objectIds: result.objectIds,
    sources: result.sources,
    workId: work.id,
  });
  return { ...result, workId: work.id };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type']).startsWith('application/json'))
    throw new Error('JSON required');
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 16_000) throw new Error('Request too large');
  }
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('JSON object required');
  return value as Record<string, unknown>;
}

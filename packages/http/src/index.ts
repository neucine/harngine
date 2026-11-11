import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HarngineError, type App, type Json, type SessionId, type WorkId } from 'harngine';

export interface HttpAdapterOptions {
  app: App;
  /** Return a principal for the request, or null to reject it. Never expose an unauthenticated adapter. */
  authenticate(request: IncomingMessage): string | null | Promise<string | null>;
  /** Exact browser origin permitted for a webview client, such as "null" for a local file page. */
  origin?: string | readonly string[];
  maxBodyBytes?: number;
  /** Host-owned routes, called after authentication and before built-in routes. */
  route?: (
    request: IncomingMessage,
    response: ServerResponse,
    principal: string,
    url: URL,
  ) => boolean | Promise<boolean>;
}

export function createHarngineHttpServer(options: HttpAdapterOptions): Server {
  const limit = options.maxBodyBytes ?? 1024 * 1024;
  return createServer(async (request, response) => {
    try {
      const allowedOrigins =
        typeof options.origin === 'string' ? [options.origin] : (options.origin ?? []);
      const allowedOrigin =
        request.headers.origin && allowedOrigins.includes(request.headers.origin);
      if (allowedOrigin) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin!);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Token');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(allowedOrigin ? 204 : 403).end();
        return;
      }
      const principal = await options.authenticate(request);
      if (!principal) return json(response, 401, { error: 'Unauthorized' });
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (options.route && (await options.route(request, response, principal, url))) return;
      const parts = url.pathname.split('/').filter(Boolean);
      const scope = options.app.forPrincipal(principal);
      if (request.method === 'GET' && url.pathname === '/health')
        return json(response, 200, { status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/definitions')
        return json(
          response,
          200,
          await options.app.definitions.list({
            kind: 'agent',
            availability: 'available',
            limit: 100,
          }),
        );
      if (request.method === 'GET' && url.pathname === '/works')
        return json(
          response,
          200,
          await scope.works.list({
            ...(url.searchParams.get('sessionId')
              ? { sessionId: url.searchParams.get('sessionId') as SessionId }
              : {}),
            limit: 100,
          }),
        );
      if (request.method === 'GET' && url.pathname === '/sessions')
        return json(response, 200, await scope.sessions.list({ limit: 100 }));
      if (request.method === 'POST' && url.pathname === '/sessions') {
        const body = await readBody(request, limit);
        const agent = object(body.agent);
        return json(
          response,
          201,
          await scope.sessions
            .create({
              agent: {
                object: 'agent',
                kind: 'agent',
                id: string(agent.id),
                revision: revision(agent.revision),
              },
              title: string(body.title),
            })
            .then((session) => session.snapshot()),
        );
      }
      if (parts[0] === 'sessions' && parts[1]) {
        const session = await scope.sessions.get(parts[1] as SessionId);
        if (request.method === 'GET' && parts.length === 2)
          return json(response, 200, await session.snapshot());
        if (request.method === 'GET' && parts[2] === 'messages')
          return json(response, 200, await session.messages({ limit: 100 }));
        if (request.method === 'POST' && parts[2] === 'messages') {
          const body = await readBody(request, limit);
          const sent = await session.send(body.message ?? null);
          return json(response, 202, { message: sent.message, work: await sent.work.snapshot() });
        }
      }
      if (parts[0] === 'works' && parts[1]) {
        const work = await scope.works.get(parts[1] as WorkId);
        if (request.method === 'GET' && parts.length === 2)
          return json(response, 200, await work.snapshot());
        if (request.method === 'GET' && parts[2] === 'inspect')
          return json(
            response,
            200,
            await work.inspect({
              detail: url.searchParams.get('detail') === 'diagnostic' ? 'diagnostic' : 'story',
              ...(url.searchParams.get('after') ? { after: url.searchParams.get('after')! } : {}),
            }),
          );
        if (request.method === 'GET' && parts[2] === 'events')
          return events(response, work, url.searchParams.get('after') ?? undefined);
        if (request.method === 'POST' && parts[2] === 'cancel')
          return json(response, 200, await work.cancel('Canceled through HTTP'));
        if (request.method === 'POST' && parts[2] === 'steer')
          return json(
            response,
            200,
            await work.steer((await readBody(request, limit)).input ?? null),
          );
        if (request.method === 'POST' && parts[2] === 'respond') {
          const body = await readBody(request, limit);
          return json(
            response,
            200,
            await work.respond(string(body.interactionId), body.response ?? null),
          );
        }
        if (request.method === 'POST' && parts[2] === 'resolve-effect') {
          const body = await readBody(request, limit);
          const resolution = object(body.resolution);
          const status = string(resolution.status);
          const reason = () => {
            const value = object(resolution.reason);
            return { code: string(value.code), message: string(value.message) };
          };
          const decision =
            status === 'success'
              ? { status: 'success' as const, value: bodyValue(resolution.value) }
              : status === 'not-applied'
                ? { status: 'not-applied' as const, reason: reason() }
                : status === 'failure' &&
                    ['partial', 'occurred'].includes(String(resolution.effect))
                  ? {
                      status: 'failure' as const,
                      effect: resolution.effect as 'partial' | 'occurred',
                      reason: reason(),
                    }
                  : null;
          if (!decision) throw new TypeError('Invalid effect resolution');
          return json(
            response,
            200,
            await work.resolveEffect(
              string(body.callId),
              decision,
              body.idempotencyKey ? { idempotencyKey: string(body.idempotencyKey) } : {},
            ),
          );
        }
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      const status =
        error instanceof SyntaxError || error instanceof TypeError
          ? 400
          : error instanceof HarngineError
            ? 409
            : 500;
      json(response, status, { error: error instanceof Error ? error.message : 'Internal error' });
    }
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new TypeError('Expected a nonempty string');
  return value;
}
function revision(value: unknown): `rev_${string}` {
  const result = string(value);
  if (!result.startsWith('rev_')) throw new TypeError('Expected a revision');
  return result as `rev_${string}`;
}
function bodyValue(value: Json | undefined): Json {
  if (value === undefined) throw new TypeError('Resolution value is required');
  return value;
}
function object(value: unknown): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, Json>;
}
async function readBody(request: IncomingMessage, limit: number): Promise<Record<string, Json>> {
  let text = '';
  for await (const chunk of request) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > limit) throw new TypeError('Request body is too large');
  }
  return object(JSON.parse(text));
}
async function events(
  response: ServerResponse,
  work: Awaited<ReturnType<App['works']['get']>>,
  after?: string,
) {
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  const watcher = await work.watch({ ...(after ? { after } : {}), signal: controller.signal });
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  response.write(`data: ${JSON.stringify(watcher.value)}\n\n`);
  try {
    for await (const update of watcher)
      response.write(
        `${update.durable ? `id: ${update.id}\n` : ''}data: ${JSON.stringify(update.value)}\n\n`,
      );
  } catch (error) {
    if (!controller.signal.aborted)
      response.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`);
  } finally {
    response.end();
  }
}

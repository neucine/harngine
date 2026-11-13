import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConflictError,
  type App,
  type AuditCategory,
  type AuditQuery,
  type DefinitionKind,
  type DefinitionReference,
  HarngineError,
  NotFoundError,
  type SessionId,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
  type WorkId,
} from 'harngine';
import { workbenchHtml } from './ui.js';

const uiDirectory = join(dirname(fileURLToPath(import.meta.url)), '../public');

export type WorkbenchPermission =
  | 'definitions:read'
  | 'work:read'
  | 'work:control'
  | 'audit:read'
  | 'diagnostics:read';

export interface WorkbenchIdentity {
  readonly principal: string;
  readonly permissions: readonly WorkbenchPermission[];
}

export interface ServeWorkbenchOptions {
  readonly app: App;
  readonly host?: string;
  readonly port?: number;
  readonly principal?: string;
  /** Fixed local capability used by launch supervisors across complete generation reloads. */
  readonly localCapability?: string;
  readonly authenticate?: (
    request: IncomingMessage,
  ) => WorkbenchIdentity | null | Promise<WorkbenchIdentity | null>;
  readonly maxBodyBytes?: number;
  readonly maxStreams?: number;
}

export interface WorkbenchServer {
  readonly url: string;
  readonly capability: string | null;
  close(): Promise<void>;
}

const allPermissions: readonly WorkbenchPermission[] = [
  'definitions:read',
  'work:read',
  'work:control',
  'audit:read',
  'diagnostics:read',
];
const mutation = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const terminal = new Set(['completed', 'failed', 'canceled']);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function body(request: IncomingMessage, maximum: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximum) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    chunks.push(value);
  }
  if (!size) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
}

function idempotencyKey(request: IncomingMessage): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim())
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required');
  if (value.length > 200)
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is too long');
  return value;
}

function positiveInteger(value: string | null, fallback?: number): number | undefined {
  if (value === null) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new HttpError(400, 'INVALID_QUERY', 'Expected a positive integer');
  return result;
}

function reference(kind: string, id: string, revision: string): DefinitionReference {
  if (!['agent', 'workflow', 'tool'].includes(kind) || !revision.startsWith('rev_'))
    throw new HttpError(400, 'INVALID_DEFINITION', 'Invalid Definition reference');
  return {
    object: kind as DefinitionKind,
    kind: kind as DefinitionKind,
    id,
    revision: revision as `rev_${string}`,
  };
}

function requirePermission(identity: WorkbenchIdentity, permission: WorkbenchPermission) {
  if (!identity.permissions.includes(permission))
    throw new HttpError(403, 'ACCESS_DENIED', `Permission ${permission} is required`);
}

function statusFor(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error instanceof UnavailableError) return 503;
  return 500;
}

function publicError(error: unknown) {
  if (error instanceof HttpError)
    return { object: 'error', code: error.code, message: error.message };
  if (error instanceof HarngineError) return error.toJSON();
  return {
    object: 'error',
    code: 'INTERNAL',
    message: 'Workbench encountered an internal error',
  };
}

function errorResponse(error: unknown) {
  return { object: 'error' as const, error: publicError(error) };
}

function writeSse(response: ServerResponse, event: string, value: unknown, id?: string) {
  if (id) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function routeParts(pathname: string): string[] {
  return pathname.slice('/api/v1/'.length).split('/').filter(Boolean).map(decodeURIComponent);
}

function auditQuery(url: URL): AuditQuery {
  const category = url.searchParams
    .getAll('category')
    .flatMap((value) => value.split(','))
    .filter(Boolean);
  const integer = (name: string) => {
    const raw = url.searchParams.get(name);
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new HttpError(400, 'INVALID_QUERY', `Audit query ${name} is invalid`);
    return value;
  };
  const since = integer('since');
  const until = integer('until');
  const limit = integer('limit');
  return {
    ...(category.length ? { category: category as AuditCategory[] } : {}),
    ...(url.searchParams.get('workId') ? { workId: url.searchParams.get('workId') as WorkId } : {}),
    ...(url.searchParams.get('sessionId')
      ? { sessionId: url.searchParams.get('sessionId') as SessionId }
      : {}),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(url.searchParams.get('after') ? { after: url.searchParams.get('after')! } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

export async function serveWorkbench(options: ServeWorkbenchOptions): Promise<WorkbenchServer> {
  const host = options.host ?? '127.0.0.1';
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!local && !options.authenticate && !options.localCapability)
    throw new Error('Hosted Workbench requires authentication or an explicit capability');
  const capability = options.authenticate
    ? null
    : (options.localCapability ?? randomBytes(24).toString('base64url'));
  const controllers = new Set<AbortController>();
  const maxStreams = options.maxStreams ?? 32;
  let origin = '';

  const authenticate = async (request: IncomingMessage, url: URL): Promise<WorkbenchIdentity> => {
    if (options.authenticate) {
      const identity = await options.authenticate(request);
      if (!identity) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
      return identity;
    }
    const supplied =
      url.searchParams.get('capability') ??
      (typeof request.headers.authorization === 'string' &&
      request.headers.authorization.startsWith('Bearer ')
        ? request.headers.authorization.slice(7)
        : null);
    if (supplied !== capability)
      throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Invalid Workbench capability');
    const requestOrigin = request.headers.origin;
    const expectedOrigin = local
      ? origin
      : request.headers.host
        ? `http://${request.headers.host}`
        : origin;
    if (requestOrigin && requestOrigin !== expectedOrigin)
      throw new HttpError(403, 'ORIGIN_DENIED', 'Workbench origin is not allowed');
    return { principal: options.principal ?? 'local', permissions: allPermissions };
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', origin || `http://${host}`);
      if (local && origin && request.headers.host !== new URL(origin).host)
        throw new HttpError(403, 'HOST_DENIED', 'Workbench host is not allowed');
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (
          /^\/(?:main|bundle|App|props|api)\.(?:mjs|js)$|^\/styles\.css$|^\/(?:views|components)\/[A-Za-z]+\.mjs$/.test(
            url.pathname,
          )
        ) {
          const asset = readFileSync(join(uiDirectory, url.pathname.slice(1)));
          response.writeHead(200, {
            'content-type': url.pathname.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(asset);
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
        });
        response.end(workbenchHtml(local ? capability : null));
        return;
      }
      if (!url.pathname.startsWith('/api/v1/')) throw new HttpError(404, 'NOT_FOUND', 'Not found');
      const identity = await authenticate(request, url);
      const scope = options.app.forPrincipal(identity.principal);
      const parts = routeParts(url.pathname);
      const method = request.method ?? 'GET';
      const key = mutation.has(method) ? idempotencyKey(request) : undefined;

      if (method === 'GET' && parts[0] === 'definitions' && parts.length === 1) {
        requirePermission(identity, 'definitions:read');
        const kind = url.searchParams.get('kind');
        const availability = url.searchParams.get('availability');
        const result = await options.app.definitions.list({
          ...(kind ? { kind: kind as DefinitionKind } : {}),
          ...(url.searchParams.get('id') ? { id: url.searchParams.get('id')! } : {}),
          ...(availability ? { availability: availability as 'available' | 'unavailable' } : {}),
          ...(url.searchParams.get('page') ? { page: url.searchParams.get('page')! } : {}),
          ...(url.searchParams.has('limit')
            ? { limit: positiveInteger(url.searchParams.get('limit'))! }
            : {}),
        });
        json(response, 200, result);
        return;
      }
      if (method === 'GET' && parts[0] === 'definitions' && parts.length === 4) {
        requirePermission(identity, 'definitions:read');
        json(
          response,
          200,
          await options.app.definitions.get(reference(parts[1]!, parts[2]!, parts[3]!)),
        );
        return;
      }
      if (method === 'GET' && parts[0] === 'audit' && parts.length === 1) {
        requirePermission(identity, 'audit:read');
        json(response, 200, await scope.audit.list(auditQuery(url)));
        return;
      }
      if (parts[0] === 'works' && parts.length === 1 && method === 'GET') {
        requirePermission(identity, 'work:read');
        const status = url.searchParams.getAll('status');
        const kind = url.searchParams.get('definitionKind');
        const id = url.searchParams.get('definitionId');
        const revision = url.searchParams.get('definitionRevision');
        json(
          response,
          200,
          await scope.works.list({
            ...(status.length ? { status: status as never } : {}),
            ...(kind && id && revision
              ? { definition: reference(kind, id, revision) as never }
              : {}),
            ...(url.searchParams.get('sessionId')
              ? { sessionId: url.searchParams.get('sessionId') as never }
              : {}),
            ...(url.searchParams.get('page') ? { page: url.searchParams.get('page')! } : {}),
            ...(url.searchParams.has('limit')
              ? { limit: positiveInteger(url.searchParams.get('limit'))! }
              : {}),
          }),
        );
        return;
      }
      if (parts[0] === 'works' && parts.length === 1 && method === 'POST') {
        requirePermission(identity, 'work:control');
        const value = await body(request, options.maxBodyBytes ?? 1_048_576);
        const selected = value.definition as DefinitionReference | undefined;
        if (
          !selected ||
          selected.object !== selected.kind ||
          (selected.kind !== 'agent' && selected.kind !== 'workflow')
        )
          throw new HttpError(400, 'INVALID_DEFINITION', 'Executable Definition is required');
        const work = await scope.start(selected as never, value.objective as never, {
          idempotencyKey: key!,
          ...(Array.isArray(value.context) ? { context: value.context as never } : {}),
          ...(value.limits ? { limits: value.limits as never } : {}),
        });
        json(response, 201, await work.snapshot());
        return;
      }
      if (parts[0] === 'works' && parts[1]) {
        const work = await scope.works.get(parts[1] as never);
        if (parts.length === 2 && method === 'GET') {
          requirePermission(identity, 'work:read');
          json(response, 200, await work.snapshot());
          return;
        }
        if (parts[2] === 'steer' && parts.length === 3 && method === 'POST') {
          requirePermission(identity, 'work:control');
          const value = await body(request, options.maxBodyBytes ?? 1_048_576);
          json(response, 200, await work.steer(value.message as never, { idempotencyKey: key! }));
          return;
        }
        if (parts[2] === 'cancel' && parts.length === 3 && method === 'POST') {
          requirePermission(identity, 'work:control');
          const value = await body(request, options.maxBodyBytes ?? 1_048_576);
          json(
            response,
            200,
            await work.cancel(typeof value.reason === 'string' ? value.reason : undefined, {
              idempotencyKey: key!,
            }),
          );
          return;
        }
        if (
          parts[2] === 'interactions' &&
          parts[3] &&
          parts[4] === 'response' &&
          parts.length === 5 &&
          method === 'POST'
        ) {
          requirePermission(identity, 'work:control');
          const value = await body(request, options.maxBodyBytes ?? 1_048_576);
          json(
            response,
            200,
            await work.respond(parts[3], value.response as never, { idempotencyKey: key! }),
          );
          return;
        }
        if (parts[2] === 'inspection' && parts.length === 3 && method === 'GET') {
          requirePermission(identity, 'work:read');
          const detail = url.searchParams.get('detail') === 'diagnostic' ? 'diagnostic' : 'story';
          if (detail === 'diagnostic') requirePermission(identity, 'diagnostics:read');
          json(
            response,
            200,
            await work.inspect({
              detail,
              ...(url.searchParams.get('after') ? { after: url.searchParams.get('after')! } : {}),
              ...(url.searchParams.has('limit')
                ? { limit: positiveInteger(url.searchParams.get('limit'))! }
                : {}),
            }),
          );
          return;
        }
        if (parts[2] === 'events' && parts.length === 3 && method === 'GET') {
          requirePermission(identity, 'work:read');
          const explicit = url.searchParams.get('after');
          const header = request.headers['last-event-id'];
          if (explicit && header)
            throw new HttpError(400, 'AMBIGUOUS_CURSOR', 'Use either after or Last-Event-ID');
          await stream(response, controllers, maxStreams, (signal) =>
            work.watch({
              ...((explicit ?? (typeof header === 'string' ? header : undefined))
                ? { after: explicit ?? (header as string) }
                : {}),
              signal,
              ...(url.searchParams.get('modelDeltas') === '1'
                ? {
                    onModelDelta(delta) {
                      if (!signal.aborted) writeSse(response, 'model.delta', delta);
                    },
                  }
                : {}),
            }),
          );
          return;
        }
      }
      if (parts[0] === 'sessions' && parts.length === 1 && method === 'GET') {
        requirePermission(identity, 'work:read');
        json(
          response,
          200,
          await scope.sessions.list({
            ...(url.searchParams.get('page') ? { page: url.searchParams.get('page')! } : {}),
            ...(url.searchParams.has('limit')
              ? { limit: positiveInteger(url.searchParams.get('limit'))! }
              : {}),
          }),
        );
        return;
      }
      if (parts[0] === 'sessions' && parts.length === 1 && method === 'POST') {
        requirePermission(identity, 'work:control');
        const value = await body(request, options.maxBodyBytes ?? 1_048_576);
        const selected = value.agent as DefinitionReference | undefined;
        if (!selected || selected.object !== selected.kind || selected.kind !== 'agent')
          throw new HttpError(400, 'INVALID_DEFINITION', 'Agent reference is required');
        const session = await scope.sessions.create({
          agent: selected as never,
          title: value.title as string,
          idempotencyKey: key!,
        });
        json(response, 201, await session.snapshot());
        return;
      }
      if (parts[0] === 'sessions' && parts[1]) {
        const session = await scope.sessions.get(parts[1] as never);
        if (parts.length === 2 && method === 'GET') {
          requirePermission(identity, 'work:read');
          json(response, 200, await session.snapshot());
          return;
        }
        if (parts[2] === 'messages' && parts.length === 3 && method === 'GET') {
          requirePermission(identity, 'work:read');
          json(response, 200, {
            object: 'list',
            messages: await session.messages({
              ...(url.searchParams.get('before')
                ? { before: url.searchParams.get('before')! }
                : {}),
              ...(url.searchParams.has('limit')
                ? { limit: positiveInteger(url.searchParams.get('limit'))! }
                : {}),
            }),
          });
          return;
        }
        if (parts[2] === 'messages' && parts.length === 3 && method === 'POST') {
          requirePermission(identity, 'work:control');
          const value = await body(request, options.maxBodyBytes ?? 1_048_576);
          const delivery = value.delivery ?? 'queue';
          if (delivery !== 'queue' && delivery !== 'steer')
            throw new HttpError(400, 'INVALID_DATA', 'Delivery must be queue or steer');
          if (delivery === 'steer') {
            const snapshot = await session.snapshot();
            if (!snapshot.foregroundWork || terminal.has(snapshot.foregroundWork.status))
              throw new HttpError(409, 'WORK_CLOSED', 'No active foreground Work to steer');
            const work = await scope.works.get(snapshot.foregroundWork.id);
            await work.steer(value.content as never, { idempotencyKey: key! });
          } else
            await session.send(value.content as never, {
              idempotencyKey: key!,
              ...(value.limits ? { limits: value.limits as never } : {}),
            });
          json(response, 200, await session.snapshot());
          return;
        }
        if (parts[2] === 'close' && parts.length === 3 && method === 'POST') {
          requirePermission(identity, 'work:control');
          json(response, 200, await session.close({ idempotencyKey: key! }));
          return;
        }
        if (parts[2] === 'events' && parts.length === 3 && method === 'GET') {
          requirePermission(identity, 'work:read');
          const explicit = url.searchParams.get('after');
          const header = request.headers['last-event-id'];
          if (explicit && header)
            throw new HttpError(400, 'AMBIGUOUS_CURSOR', 'Use either after or Last-Event-ID');
          await stream(response, controllers, maxStreams, (signal) =>
            session.watch({
              ...((explicit ?? (typeof header === 'string' ? header : undefined))
                ? { after: explicit ?? (header as string) }
                : {}),
              signal,
            }),
          );
          return;
        }
      }
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    } catch (error) {
      if (!response.headersSent) json(response, statusFor(error), errorResponse(error));
      else response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  const displayHost = address.address === '::1' ? '[::1]' : address.address;
  origin = `http://${displayHost}:${address.port}`;
  return {
    url: `${origin}/`,
    capability,
    async close() {
      for (const controller of controllers) controller.abort();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

async function stream(
  response: ServerResponse,
  controllers: Set<AbortController>,
  maximum: number,
  open: (signal: AbortSignal) => Promise<{
    readonly value: unknown;
    readonly cursor: string | null;
    readonly reset: boolean;
    [Symbol.asyncIterator](): AsyncIterator<{
      readonly durable: boolean;
      readonly id?: string;
      readonly value: unknown;
    }>;
  }>,
) {
  if (controllers.size >= maximum)
    throw new HttpError(503, 'STREAM_LIMIT', 'Too many open event streams');
  const controller = new AbortController();
  controllers.add(controller);
  response.once('close', () => controller.abort());
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  try {
    const watch = await open(controller.signal);
    writeSse(response, 'ready', {
      object: 'watch',
      value: watch.value,
      cursor: watch.cursor,
      reset: watch.reset,
    });
    for await (const update of watch) {
      if (controller.signal.aborted) break;
      writeSse(
        response,
        'update',
        { object: 'event', ...update },
        update.durable && typeof update.id === 'string' ? update.id : undefined,
      );
    }
  } catch (error) {
    if (!controller.signal.aborted) writeSse(response, 'error', errorResponse(error));
  } finally {
    controllers.delete(controller);
    response.end();
  }
}

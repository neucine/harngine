import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hearth } from './app.js';
import type { PersonId, Visibility } from './domain.js';
import { hearthPage } from './page.js';

async function body(
  request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 16_000) throw new Error('Request is too large');
    chunks.push(value);
  }
  return size
    ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    : {};
}
function viewer(value: unknown): PersonId {
  if (value !== 'alex' && value !== 'sam') throw new Error('Unknown household member');
  return value;
}
export async function serveHearth(hearth: Hearth, port = 0) {
  const token = randomBytes(20).toString('hex');
  const uiDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(hearthPage(token));
        return;
      }
      if (request.method === 'GET' && /^\/[A-Za-z0-9_-]+\.(?:mjs|css)$/.test(url.pathname)) {
        const asset = join(uiDirectory, url.pathname.slice(1));
        if (existsSync(asset)) {
          response.writeHead(200, {
            'content-type': url.pathname.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'text/javascript; charset=utf-8',
          });
          response.end(readFileSync(asset));
          return;
        }
      }
      if (request.headers['x-hearth-token'] !== token) throw new Error('Hearth token required');
      if (request.headers.origin && request.headers.origin !== origin)
        throw new Error('Foreign origin denied');
      let value: unknown;
      if (request.method === 'GET' && url.pathname === '/api/state')
        value = await hearth.state(viewer(url.searchParams.get('viewer')));
      else if (request.method === 'POST' && url.pathname === '/api/check-in') {
        const input = await body(request);
        await hearth.checkIn({
          viewer: viewer(input.viewer),
          energy: Number(input.energy),
          feeling: String(input.feeling ?? ''),
          note: String(input.note ?? ''),
          visibility: (input.visibility === 'private' ? 'private' : 'shared') as Visibility,
        });
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/ritual') {
        const input = await body(request);
        await hearth.adoptRitual(viewer(input.viewer), String(input.openingId ?? ''));
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/dismiss') {
        const input = await body(request);
        await hearth.dismiss(viewer(input.viewer), String(input.openingId ?? ''));
        value = { ok: true };
      } else {
        response.writeHead(404);
        response.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

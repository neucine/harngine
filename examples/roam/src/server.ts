import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roamPage } from './page.js';
import type { RoamRoom } from './room.js';

async function body(
  request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 64_000) throw new Error('Request is too large');
    chunks.push(value);
  }
  return size
    ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    : {};
}
export async function serveRoam(room: RoamRoom, port = 0) {
  const token = randomBytes(20).toString('hex');
  const uiDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        });
        response.end(roamPage(token));
        return;
      }
      if (request.method === 'GET' && /^\/[A-Za-z0-9_-]+\.(?:mjs|css)$/.test(url.pathname)) {
        const assetPath = join(uiDirectory, url.pathname.slice(1));
        if (existsSync(assetPath)) {
          response.writeHead(200, {
            'content-type': url.pathname.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(readFileSync(assetPath));
          return;
        }
      }
      if (request.headers['x-roam-token'] !== token) {
        response.writeHead(403);
        response.end(JSON.stringify({ error: 'Room token required' }));
        return;
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        response.writeHead(403);
        response.end(JSON.stringify({ error: 'Foreign origin denied' }));
        return;
      }
      let value: unknown;
      if (request.method === 'GET' && url.pathname === '/api/state') value = await room.state();
      else if (request.method === 'POST' && url.pathname === '/api/create') {
        const input = await body(request);
        await room.create({
          origin: String(input.origin ?? ''),
          startDate: String(input.startDate ?? ''),
          endDate: String(input.endDate ?? ''),
          signals: Array.isArray(input.signals) ? input.signals.map(String) : [],
        });
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/focus') {
        const input = await body(request);
        await room.focus(String(input.worldId));
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/signal') {
        const input = await body(request);
        await room.addSignal({
          kind: String(input.kind) as 'mood' | 'fascination' | 'rhythm' | 'constraint',
          text: String(input.text ?? ''),
          author: String(input.author ?? 'maya'),
        });
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/nudge') {
        const input = await body(request);
        const direction = String(input.direction);
        if (direction !== 'closer' && direction !== 'away') throw new Error('Unknown direction');
        await room.nudge(String(input.worldId), direction);
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/weave') {
        const input = await body(request);
        await room.weave(String(input.signalId));
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/save') {
        const input = await body(request);
        await room.saveTrail(String(input.worldId));
        value = { ok: true };
      } else if (request.method === 'POST' && url.pathname === '/api/refresh') {
        await room.refresh();
        value = { ok: true };
      } else {
        response.writeHead(404);
        response.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const encoded = JSON.stringify(value);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(encoded),
        'cache-control': 'no-store',
      });
      response.end(encoded);
    } catch (error) {
      const encoded = JSON.stringify({
        error: error instanceof Error ? error.message : 'Request failed',
      });
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(encoded);
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

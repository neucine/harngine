import { randomBytes } from 'node:crypto';
import { createHarngineHttpServer } from '@harngine/http';
import { createCodingApp } from './app.js';
import { workspaceRoutes } from './workspace-routes.js';

export async function startCodingServer(options: { repo: string; debugHttp?: boolean }) {
  const { app, root } = createCodingApp({
    repo: options.repo,
    writable: false,
    requireEditApproval: true,
  });
  const token = randomBytes(32).toString('hex');
  const server = createHarngineHttpServer({
    app,
    route: workspaceRoutes(root),
    authenticate: (request) => {
      if (options.debugHttp)
        console.log('HTTP request', request.method, request.url, 'origin', request.headers.origin);
      return request.headers['x-agent-token'] === token ? 'desktop' : null;
    },
  });
  try {
    await new Promise<void>((done, fail) =>
      server.listen(0, '127.0.0.1', done).once('error', fail),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP listener unavailable');
    return {
      root,
      endpoint: `http://127.0.0.1:${address.port}`,
      token,
      async close() {
        await new Promise<void>((done, fail) =>
          server.close((error) => (error ? fail(error) : done())),
        );
        await app.close();
      },
    };
  } catch (error) {
    server.close();
    await app.close();
    throw error;
  }
}

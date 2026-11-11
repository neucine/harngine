#!/usr/bin/env bun
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { App } from 'harngine';
import { serveWorkbench } from './server.js';

const parsed = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '4317' },
    principal: { type: 'string', default: 'local' },
    watch: { type: 'boolean', default: true },
    child: { type: 'boolean', default: false },
    capability: { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (parsed.values.help || !parsed.positionals[0]) {
  console.log(
    'Usage: harngine-workbench <app-module> [--host 127.0.0.1] [--port 4317] [--no-watch]',
  );
  process.exit(parsed.values.help ? 0 : 1);
}

const modulePath = resolve(parsed.positionals[0]);
const port = Number(parsed.values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');

if (parsed.values.child) {
  await runGeneration({
    modulePath,
    host: parsed.values.host,
    port,
    principal: parsed.values.principal,
    capability: parsed.values.capability!,
  });
} else {
  await supervise({
    modulePath,
    host: parsed.values.host,
    port,
    principal: parsed.values.principal,
    watch: parsed.values.watch,
  });
}

async function runGeneration(options: {
  modulePath: string;
  host: string;
  port: number;
  principal: string;
  capability: string;
}) {
  let app: App | undefined;
  let server: Awaited<ReturnType<typeof serveWorkbench>> | undefined;
  try {
    const loaded = (await import(
      `${pathToFileURL(options.modulePath).href}?generation=${Date.now()}`
    )) as {
      default?: () => App | Promise<App>;
    };
    if (typeof loaded.default !== 'function')
      throw new Error('Workbench project module must default-export an App factory');
    app = await loaded.default();
    server = await serveWorkbench({
      app,
      host: options.host,
      port: options.port,
      principal: options.principal,
      localCapability: options.capability,
    });
    const remote = !['127.0.0.1', 'localhost', '::1'].includes(options.host);
    const accessUrl = remote
      ? `${server.url}#capability=${encodeURIComponent(options.capability)}`
      : server.url;
    console.log(`Harngine Workbench\nOpen: ${accessUrl}\nProject: ${options.modulePath}`);
  } catch (error) {
    console.error('Workbench generation failed:', error);
    process.exitCode = 1;
    return;
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server?.close();
    await app?.close();
  };
  process.once('SIGINT', () => void stop().then(() => process.exit()));
  process.once('SIGTERM', () => void stop().then(() => process.exit()));
}

async function supervise(options: {
  modulePath: string;
  host: string;
  port: number;
  principal: string;
  watch: boolean;
}) {
  const capability = randomBytes(24).toString('base64url');
  const bundledNode = resolve('node_modules/node/bin/node');
  const nodeRuntime = process.env.HARNGINE_NODE ?? (existsSync(bundledNode) ? bundledNode : 'node');
  let child: ChildProcess | undefined;
  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;
  const start = () => {
    child = spawn(
      nodeRuntime,
      [
        fileURLToPath(import.meta.url),
        options.modulePath,
        '--child',
        '--host',
        options.host,
        '--port',
        String(options.port),
        '--principal',
        options.principal,
        '--capability',
        capability,
      ],
      { stdio: 'inherit' },
    );
  };
  const stopChild = async () => {
    const active = child;
    child = undefined;
    if (!active || active.exitCode !== null) return;
    await new Promise<void>((resolveExit) => {
      active.once('exit', () => resolveExit());
      active.kill('SIGTERM');
    });
  };
  const reload = () => {
    if (stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      console.log('\nSource changed; replacing the complete Workbench generation…');
      await stopChild();
      start();
    }, 120);
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    watcher?.close();
    await stopChild();
  };
  start();
  if (options.watch) {
    watcher = watch(dirname(options.modulePath), { recursive: true }, (_event, filename) => {
      const name = filename?.toString() ?? '';
      if (
        name.includes('node_modules') ||
        name.includes('.harngine') ||
        (!name.endsWith('.ts') && !name.endsWith('.js') && !name.endsWith('.json'))
      )
        return;
      reload();
    });
  }
  process.once('SIGINT', () => void stop().then(() => process.exit()));
  process.once('SIGTERM', () => void stop().then(() => process.exit()));
}

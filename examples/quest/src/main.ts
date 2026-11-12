import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createQuestEngine } from './engine.js';
import { MetProvider, type ProviderMode } from './met-provider.js';
import { serveQuest } from './server.js';
import { WorldStore } from './world-store.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'replay' },
    directory: { type: 'string', default: '.harngine/quest' },
    port: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'bun run demo:quest -- [--mode replay|live|safe-write] [--directory path] [--port number]\nReplay is deterministic and makes no network requests. Live reads the bounded Met object set without writing. Safe-write explicitly refreshes the checked recording.',
  );
  process.exit(0);
}
if (!['replay', 'live', 'safe-write'].includes(values.mode!))
  throw new Error('Mode must be replay, live, or safe-write');
const port = values.port === undefined ? 0 : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Port must be from 0 to 65535');
const directory = resolve(values.directory!);
mkdirSync(directory, { recursive: true });
const executionDirectory = join(directory, 'execution');
mkdirSync(executionDirectory, { recursive: true });
const providerMode = values.mode as ProviderMode;
const provider = new MetProvider({ mode: providerMode });
const engine = createQuestEngine(realpathSync(executionDirectory), provider);
const store = new WorldStore(join(directory, 'world.sqlite'));
const server = await serveQuest({
  engine,
  provider,
  providerMode,
  store,
  port,
});
console.log(
  `Quest · The Museum of Nearby Things (${providerMode})\nOpen: ${server.url}\nData: ${realpathSync(directory)}\nReturn with the same browser to continue your path.`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  store.close();
  await engine.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

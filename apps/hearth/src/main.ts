import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openHearth } from './app.js';
import { serveHearth } from './server.js';
import { HomeStore } from './store.js';

const { values } = parseArgs({
  options: { directory: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log('bun run demo:hearth [--directory path] [--port number]');
  process.exit(0);
}
const directory = resolve(values.directory ?? '.harngine/hearth-home');
await mkdir(directory, { recursive: true });
const hearth = await openHearth({
  directory: await realpath(directory),
  store: new HomeStore(resolve(directory, 'home-memory.json')),
});
const port = values.port === undefined ? 0 : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Port must be from 0 to 65535');
const server = await serveHearth(hearth, port);
console.log(
  `Hearth · living home-world\nOpen: ${server.url}\nMemory: ${resolve(directory, 'home-memory.json')}`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await hearth.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

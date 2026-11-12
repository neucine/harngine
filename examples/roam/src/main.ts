import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openRoam } from './room.js';
import { serveRoam } from './server.js';

const { values } = parseArgs({
  options: { directory: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(
    'bun run demo:roam [--directory path] [--port number]\nUses live OpenStreetMap and Open-Meteo observations to grow a persistent journey atlas.',
  );
  process.exit(0);
}
const directory = resolve(values.directory ?? process.env.ROAM_DIRECTORY ?? '.harngine/roam');
mkdirSync(directory, { recursive: true });
const port = values.port === undefined ? 0 : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Port must be from 0 to 65535');
const room = await openRoam({ directory });
const server = await serveRoam(room, port);
console.log(
  `Roam · living journey atlas\nOpen: ${server.url}\nData: ${directory}\nShared signals, scout memory, and environmental observations persist locally.`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await room.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

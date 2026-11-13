import { mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSupportDesk } from './app.js';
import { serveSupport } from './server.js';

const { values } = parseArgs({
  options: {
    directory: { type: 'string', default: '.harngine/support-demo' },
    port: { type: 'string', default: '4318' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'bun run demo:support -- [--port 4318] [--directory .harngine/support-demo]\nOpen the printed URL. Use `node examples/support/dist/main.js --cli` for the terminal walkthrough.',
  );
  process.exit(0);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Port must be from 0 to 65535');
const directory = resolve(values.directory!);
mkdirSync(directory, { recursive: true });
const desk = createSupportDesk({
  directory: realpathSync(directory),
  audit: { retention: { maxEntries: 5_000 } },
});
const server = await serveSupport({ desk, port });
console.log(`Harngine support desk\nOpen: ${server.url}\nData: ${realpathSync(directory)}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await desk.app.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

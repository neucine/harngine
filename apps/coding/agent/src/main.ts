import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCodingServer } from './server.js';

const directory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(directory, 'config.json'), 'utf8')) as {
  repo: string;
  codexCli?: string;
};
process.env.HARNGINE_MANIFEST = resolve(directory, 'manifest.json');
process.env.PATH = [
  resolve(directory, 'bin'),
  ...(config.codexCli ? [dirname(config.codexCli)] : []),
  process.env.PATH ?? '',
].join(':');
// The previous desktop process may still be releasing Harngine's exclusive
// repository ownership when the user closes and immediately reopens the app.
let service: Awaited<ReturnType<typeof startCodingServer>> | undefined;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    service = await startCodingServer({ repo: config.repo });
    break;
  } catch (error) {
    if ((error as { code?: string }).code !== 'OWNER_BUSY' || attempt === 19) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!service) throw new Error('Coding server did not start');
process.stdout.write(
  `${JSON.stringify({
    endpoint: service.endpoint,
    headers: { 'X-Agent-Token': service.token },
  })}\n`,
);

let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  try {
    await service.close();
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) void stop();
}, 1_000).unref();

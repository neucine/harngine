import { resolve } from 'node:path';
import { createMuseApp } from './workflow.js';
import { serveMuse } from './server.js';

const mode = process.argv.includes('--live') ? 'live' : 'replay';
const { app, workflow } = createMuseApp({ directory: resolve('.harngine/muse') });
const server = await serveMuse({
  app,
  workflow,
  defaultMode: mode,
  port: Number(process.env.MUSE_PORT ?? 0),
});
console.log(`Muse thought-space: ${server.url}`);
console.log(`Default evidence mode: ${mode}. Material begins arriving when the space opens.`);
const stop = async () => {
  await server.close();
  await app.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

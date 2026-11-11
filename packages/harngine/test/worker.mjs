import { Runtime, requestId } from '../dist/internal/index.js';
import { appendFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';
const [directory, boundary] = process.argv.slice(2);
function pause(at) {
  if (at !== boundary) return;
  process.send(at);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const { cap, definition } = fixture(async ({ input, attemptId }) => {
  const path = join(directory, 'external.log');
  appendFileSync(path, attemptId + '\n');
  const fd = openSync(path, 'r');
  fsyncSync(fd);
  closeSync(fd);
  pause('effect');
  return { status: 'success', value: input + 1 };
});
try {
  const runtime = new Runtime({ directory, definitions: [definition], tools: [cap] }, pause);
  const api = runtime.forCaller({ principal: 'owner', source: 'test' });
  await api.work.start(definition, { requestId: requestId('start'), objective: 5, context: [] });
  if (boundary === 'owner') pause('owner');
  await runtime.drain();
  await runtime.close();
} catch (error) {
  process.send({ error: String(error) });
  process.exitCode = 1;
}

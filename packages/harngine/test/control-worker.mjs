import { Runtime, requestId } from '../dist/internal/index.js';
import { fixture } from './fixture.mjs';
const [directory, kind] = process.argv.slice(2);
let request, ref, api;
const { cap, definition } = fixture(async () => new Promise(() => {}));
const runtime = new Runtime({ directory, definitions: [definition], tools: [cap] }, (at) => {
  if (at === 'control') {
    // Snapshot runs synchronously before its promise resolves; its cursor is the control event.
    api.work.inspect(ref).then((snapshot) => {
      process.send({ kind, request, ref, cursor: snapshot.cursor });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    });
  }
});
try {
  api = runtime.forCaller({ principal: 'owner', source: 'test' });
  const start = await api.work.start(definition, {
    requestId: requestId('start'),
    objective: 5,
    context: [],
  });
  ref = start.value;
  const before = await api.work.inspect(ref);
  if (kind === 'cancel-admitted') void runtime.drain();
  request =
    kind === 'revise'
      ? { requestId: requestId('control'), expectedControl: before.controlToken, objective: 20 }
      : { requestId: requestId('control'), expectedControl: before.controlToken, reason: 'stop' };
  if (kind === 'revise') await api.work.revise(ref, request);
  else await api.work.cancel(ref, request);
} catch (error) {
  process.send({ error: String(error) });
  process.exitCode = 1;
}

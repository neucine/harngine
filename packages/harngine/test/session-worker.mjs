import { Runtime, requestId } from '../dist/internal/index.js';
const [directory, action] = process.argv.slice(2);
let armed = action === 'create';
let ref;
let request = { requestId: requestId('create'), title: 'Support case' };
const runtime = new Runtime(
  { directory, definitions: [], tools: [] },
  (at) => {
    if (armed && at === 'session') {
      process.send({ action, ref, request });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
  () => 1000,
);
const api = runtime.forCaller({ principal: 'owner', source: 'test' });
ref = (await api.session.create(request)).value;
request =
  action === 'record'
    ? {
        requestId: requestId('record'),
        expectedVersion: 1,
        entry: { type: 'input', content: 'hello' },
      }
    : { requestId: requestId('close'), expectedVersion: 1 };
armed = true;
if (action === 'record') await api.session.record(ref, request);
else await api.session.close(ref, request);

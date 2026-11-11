import { Runtime, schema, workflow, requestId } from '../dist/internal/index.js';
const [directory, boundary] = process.argv.slice(2);
const number = schema({ id: 'wait-number', version: '1', jsonSchema: { type: 'integer' } });
const definition = workflow({
  id: 'wait-flow',
  version: '1',
  artifactDigest: 'wait-flow-v1',
  objective: number,
  state: number,
  result: number,
  replySchemas: [number],
  tools: [],
  policy: { maxDecisions: 10, maxAttempts: 1 },
  initial: () => 0,
  decide: (view) => {
    const slot = `wait-${view.objectiveRevision}`;
    const wait = view.waits[slot];
    if (!wait)
      return {
        type: 'wait',
        state: 1,
        until: {
          type: 'reply',
          slot,
          schema: { id: number.id, version: number.version },
          responders: ['reviewer'],
          timeoutMs: 100,
        },
      };
    if (wait.status === 'pending')
      return { type: 'wait', state: view.state, until: { type: 'existing', slot } };
    return {
      type: 'complete',
      result: wait.status === 'replied' ? wait.payload : wait.status === 'fired' ? 42 : 0,
    };
  },
});
let ref, request;
const runtime = new Runtime(
  { directory, definitions: [definition], tools: [] },
  (at) => {
    if (at === boundary) {
      process.send({ boundary, ref, request });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
  () => 1000,
);
const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
const reviewer = runtime.forCaller({ principal: 'reviewer', source: 'review-ui' });
ref = (
  await owner.work.start(definition, { requestId: requestId('start'), objective: 5, context: [] })
).value;
await runtime.drain();
request = {
  requestId: requestId('reply'),
  wait: (await owner.work.inspect(ref)).waits[0].wait,
  payload: 7,
};
await reviewer.work.reply(ref, request);

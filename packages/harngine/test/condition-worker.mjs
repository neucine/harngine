import { Runtime, schema, workflow, requestId } from '../dist/internal/index.js';
const [directory, boundary] = process.argv.slice(2);
const number = schema({ id: 'condition-number', version: '1', jsonSchema: { type: 'integer' } });
const leaf = (slot) => ({
  type: 'reply',
  slot,
  schema: { id: number.id, version: number.version },
  responders: ['reviewer'],
});
const definition = workflow({
  id: 'condition-flow',
  version: '1',
  artifactDigest: 'condition-flow-v1',
  objective: number,
  state: number,
  result: number,
  replySchemas: [number],
  input: { schema: number, maxPending: 4, batchSize: 2 },
  tools: [],
  policy: { maxDecisions: 12, maxAttempts: 1 },
  initial: () => 0,
  decide: (view) =>
    view.state === 0
      ? { type: 'wait', state: 1, until: { type: 'all', conditions: [leaf('a'), leaf('b')] } }
      : {
          type: 'complete',
          result: Object.values(view.waits).reduce(
            (sum, w) => sum + (w.status === 'replied' ? w.payload : 0),
            0,
          ),
        },
});
let ref;
const runtime = new Runtime(
  { directory, definitions: [definition], tools: [] },
  (at) => {
    if (at === boundary) {
      process.send({ boundary, ref });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
  () => 1000,
);
const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
const reviewer = runtime.forCaller({ principal: 'reviewer', source: 'review-ui' });
ref = (
  await owner.work.start(definition, { requestId: requestId('start'), objective: 10, context: [] })
).value;
await runtime.drain();
const wait = (await owner.work.inspect(ref)).waits.find((w) => w.slot === 'a').wait;
await reviewer.work.reply(ref, { requestId: requestId('a'), wait, payload: 3 });

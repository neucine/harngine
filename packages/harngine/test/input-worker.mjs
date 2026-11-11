import { Runtime, schema, workflow, requestId } from '../dist/internal/index.js';
const [directory, boundary] = process.argv.slice(2);
const number = schema({
  id: 'input-number',
  version: '1',
  jsonSchema: { type: 'integer', minimum: 0 },
});
const definition = workflow({
  id: 'input-flow',
  version: '1',
  artifactDigest: 'input-flow-v1',
  objective: number,
  state: number,
  result: number,
  input: { schema: number, maxPending: 4, batchSize: 2 },
  policy: { maxDecisions: 20, maxAttempts: 1 },
  tools: [],
  initial: () => 0,
  decide: (view) => {
    const sum = view.state + view.inputs.reduce((n, input) => n + input.payload, 0);
    const dispositions = view.inputs.map((input) => ({ id: input.id, status: 'incorporated' }));
    return sum >= view.objective && !view.hasMoreInputs
      ? { type: 'complete', result: sum, dispositions }
      : { type: 'wait', state: sum, dispositions };
  },
});
let armed = false,
  ref;
const request = { requestId: requestId('first'), objectiveRevision: 1, payload: 3 };
const runtime = new Runtime({ directory, definitions: [definition], tools: [] }, (at) => {
  if (armed && at === boundary) {
    process.send({ boundary, ref, request });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
});
const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
ref = (
  await owner.work.start(definition, { requestId: requestId('start'), objective: 10, context: [] })
).value;
await runtime.drain();
armed = true;
await owner.work.input(ref, request);
await runtime.drain();

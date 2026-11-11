import { Runtime, schema, workflow, tool, requestId } from '../dist/internal/index.js';
import { appendFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
const [directory, boundary] = process.argv.slice(2);
let ref, reply;
function checkpoint(at) {
  if (at !== boundary) return;
  process.send({ boundary, ref, reply });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const number = schema({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
const cap = tool({
  id: 'purchase',
  version: '1',
  artifactDigest: 'approval-tool-v1',
  input: number,
  output: number,
  effect: 'write',
  approval: { approvers: ['reviewer'], timeoutMs: 100 },
  invoke: async ({ input, attemptId }) => {
    const path = join(directory, 'effect.log');
    appendFileSync(path, attemptId + '\n');
    const fd = openSync(path, 'r');
    fsyncSync(fd);
    closeSync(fd);
    checkpoint('effect');
    return { status: 'success', value: input + 1 };
  },
});
const definition = workflow({
  id: 'approval-workflow',
  version: '1',
  artifactDigest: 'approval-workflow-v1',
  objective: number,
  state: number,
  result: number,
  tools: [{ id: cap.id, version: cap.version }],
  policy: { maxDecisions: 6, maxAttempts: 3 },
  initial: () => 0,
  decide: (view) => {
    const slot = `revision-${view.objectiveRevision}`;
    const call = view.calls[slot];
    if (!call)
      return {
        type: 'call',
        state: view.state + 1,
        call: { slot, tool: { id: cap.id, version: cap.version }, input: view.objective },
      };
    if (call.outcome?.status === 'success') return { type: 'complete', result: call.outcome.value };
    return { type: 'fail', reason: { code: 'NOT_PURCHASED', message: 'The call did not succeed' } };
  },
});
try {
  const runtime = new Runtime(
    { directory, definitions: [definition], tools: [cap] },
    checkpoint,
    () => 1000,
  );
  const owner = runtime.forCaller({ principal: 'owner', source: 'test' });
  const reviewer = runtime.forCaller({ principal: 'reviewer', source: 'approval-ui' });
  ref = (
    await owner.work.start(definition, { requestId: requestId('start'), objective: 5, context: [] })
  ).value;
  await runtime.drain();
  const wait = (await owner.work.inspect(ref)).approvals[0].wait;
  reply = { requestId: requestId('approve'), wait, payload: { decision: 'approve' } };
  await reviewer.work.reply(ref, reply);
  await runtime.drain();
  await runtime.close();
} catch (error) {
  process.send({ error: String(error) });
  process.exitCode = 1;
}

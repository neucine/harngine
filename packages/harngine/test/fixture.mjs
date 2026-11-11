import { schema, workflow, tool } from '../dist/internal/index.js';
export function fixture(invoke = async ({ input }) => ({ status: 'success', value: input + 1 })) {
  const number = schema({ id: 'number', version: '1', jsonSchema: { type: 'integer' } });
  const cap = tool({
    id: 'increment',
    version: '1',
    artifactDigest: 'fixture-tool-v1',
    effect: 'write',
    input: number,
    output: number,
    invoke,
  });
  const definition = workflow({
    id: 'single-call',
    version: '1',
    artifactDigest: 'fixture-workflow-v1',
    objective: number,
    state: number,
    result: number,
    policy: { maxDecisions: 3, maxAttempts: 1 },
    tools: [{ id: cap.id, version: cap.version }],
    initial: () => 0,
    decide: (view) =>
      view.state === 0
        ? {
            type: 'call',
            state: 1,
            call: {
              slot: 'increment',
              tool: { id: cap.id, version: cap.version },
              input: view.objective,
            },
          }
        : { type: 'complete', result: view.calls.increment.outcome.value },
  });
  return { cap, definition };
}

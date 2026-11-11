import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelResponse } from 'harngine';
import { runCodingSessionDemo, type CodingSessionModel } from '../src/coding-session.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-coding-demo-')));
  directories.push(value);
  return value;
}
let call = 0;
const actions: ModelResponse[] = [
  {
    items: [
      {
        type: 'tool-call',
        providerCallId: 'search-1',
        tool: 'demo.code.search-text',
        input: { query: 'reused' },
      },
    ],
    object: 'model_response',
    finishReason: 'tool-calls',
  },
  {
    items: [
      {
        type: 'tool-call',
        providerCallId: 'read-1',
        tool: 'demo.code.read-file',
        input: { path: 'src/tokens.ts' },
      },
    ],
    object: 'model_response',
    finishReason: 'tool-calls',
  },
  {
    items: [
      {
        type: 'text',
        text: 'The reuse branch throws but does not set family.revoked in src/tokens.ts:4. Set revoked before throwing.',
      },
    ],
    object: 'model_response',
    finishReason: 'stop',
  },
  {
    items: [
      {
        type: 'tool-call',
        providerCallId: 'read-2',
        tool: 'demo.code.read-file',
        input: { path: 'src/tokens.test.ts' },
      },
    ],
    object: 'model_response',
    finishReason: 'tool-calls',
  },
  {
    items: [
      {
        type: 'text',
        text: 'Add a regression proving every token in the reused family is rejected, plus a separate-family boundary test.',
      },
    ],
    object: 'model_response',
    finishReason: 'stop',
  },
];
const model: CodingSessionModel = {
  id: 'demo.coding-test',
  capabilities: { tools: true, structuredOutput: false, streaming: false },
  label: 'deterministic coding model',
  mode: 'test',
  generate: async () => actions[call++]!,
};

test('open text Agent chooses coding tools across a durable Session without a coded Workflow', async () => {
  call = 0;
  const report = await runCodingSessionDemo({ directory: directory(), model });
  expect(report.history.map((entry: { entry: { type: string } }) => entry.entry.type)).toEqual([
    'input',
    'result',
    'input',
    'result',
  ]);
  expect(report.executions[0]!.snapshot.closure).toMatchObject({
    status: 'completed',
    result: expect.stringContaining('family.revoked'),
  });
  expect(report.executions[1]!.snapshot.context).toHaveLength(2);
  expect(report.invocations).toEqual({ model: 5, tools: 3 });
  expect(report.model.responseSchema).toMatchObject({
    type: 'string',
  });
});

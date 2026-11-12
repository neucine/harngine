import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { agent, createApp, schema, tool, workflow, type App, type ModelAdapter } from 'harngine';
import {
  captureWorkTrace,
  evaluationCase,
  runEvaluation,
  summarizeWorkTrace,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-evaluation-')));
  directories.push(value);
  return value;
}

const number = schema<number>({
  id: 'evaluation.number',
  version: '1',
  jsonSchema: { type: 'integer' },
});

test('captures attached child Work and derives metrics from inspection', async () => {
  const add = tool({
    id: 'evaluation.add',
    input: number,
    output: number,
    effect: 'read',
    execute: (input) => input + 1,
  });
  const child = workflow({
    id: 'evaluation.child',
    objective: number,
    result: number,
    tools: [add],
    run: (objective, flow) => flow.call('add-in-child', add, objective),
  });
  const parent = workflow({
    id: 'evaluation.parent',
    objective: number,
    result: number,
    tools: [add],
    children: [child],
    async run(objective, flow) {
      const first = await flow.call('add-first', add, objective);
      const second = await flow.call('add-second', add, first);
      const delegated = await flow.call('child', child, second);
      return delegated;
    },
  });
  const app = createApp({ directory: directory(), workflows: [parent, child], tools: [add] });
  apps.push(app);

  const work = await app.start(parent, 1);
  await expect(work.result()).resolves.toBe(4);
  const trace = await captureWorkTrace(app.works, work.id);
  expect(trace).toMatchObject({
    object: 'work_trace',
    rootWorkId: work.id,
    detail: 'story',
    complete: true,
  });
  expect(trace.works.map((evidence) => evidence.work.definition.id)).toEqual([parent.id, child.id]);
  expect(trace.works.every((evidence) => evidence.complete)).toBe(true);

  const metrics = summarizeWorkTrace(trace);
  expect(metrics).toMatchObject({
    object: 'evaluation_metrics',
    complete: true,
    works: 2,
    completed: 2,
    failed: 0,
    stopped: 0,
    childWork: 1,
    calls: 3,
    decisions: { call: 3, child: 1 },
  });
  expect(
    metrics.byWork
      .flatMap((item) => item.calls)
      .every((call) => call.tool.id === add.id && call.phase === 'settled'),
  ).toBe(true);
});

test('runs ordered cases with scorer results and honest failure evidence', async () => {
  const double = workflow({
    id: 'evaluation.double',
    objective: number,
    result: number,
    run: (objective) => objective * 2,
  });
  const fail = workflow({
    id: 'evaluation.fail',
    objective: number,
    result: number,
    run: (_objective, flow) => flow.fail({ code: 'EXPECTED_FAILURE', message: 'fixture failure' }),
  });
  const app = createApp({
    directory: directory(),
    workflows: [double, fail],
  });
  apps.push(app);

  const report = await runEvaluation(app, [
    evaluationCase({
      id: 'double',
      definition: double,
      objective: 4,
      score: ({ result, metrics }) => ({
        score: result === 8 && metrics.calls === 0 ? 1 : 0,
        passed: result === 8,
        label: 'correct result',
      }),
    }),
    evaluationCase({
      id: 'failure',
      definition: fail,
      objective: 1,
    }),
  ]);

  expect(report.summary).toEqual({
    total: 2,
    passed: 1,
    failed: 1,
    evaluationErrors: 0,
    incompleteTraces: 0,
    averageScore: 1,
  });
  expect(report.cases[0]).toMatchObject({
    object: 'evaluation_case',
    id: 'double',
    passed: true,
    result: 8,
    score: { score: 1, passed: true, label: 'correct result' },
    metrics: { completed: 1, calls: 0 },
  });
  expect(report.cases[0]?.trace.works[0]?.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'work.started' }),
      expect.objectContaining({ type: 'work.closed', status: 'completed' }),
    ]),
  );
  expect(report.cases[1]).toMatchObject({
    id: 'failure',
    passed: false,
    error: { code: 'EXPECTED_FAILURE', message: 'fixture failure' },
    trace: {
      complete: true,
      works: [expect.objectContaining({ work: expect.objectContaining({ status: 'failed' }) })],
    },
    metrics: { failed: 1, completed: 0 },
  });
});

test('marks a bounded trace incomplete instead of reporting partial metrics as conclusive', async () => {
  const child = workflow({
    id: 'evaluation.bounded-child',
    objective: number,
    result: number,
    run: (objective) => objective,
  });
  const parent = workflow({
    id: 'evaluation.bounded-parent',
    objective: number,
    result: number,
    children: [child],
    run: (objective, flow) => flow.call('child', child, objective),
  });
  const app = createApp({ directory: directory(), workflows: [parent, child] });
  apps.push(app);
  const work = await app.start(parent, 1);
  await work.result();

  const trace = await captureWorkTrace(app.works, work.id, {
    maxEntriesPerWork: 1,
    maxWorks: 1,
  });
  expect(trace).toMatchObject({
    complete: false,
    works: [
      {
        complete: false,
        work: { childWorkIds: expect.any(Array) },
      },
    ],
  });
  expect(summarizeWorkTrace(trace)).toMatchObject({
    complete: false,
    works: 1,
  });
});

test('rejects duplicate case ids before starting either case', async () => {
  const identity = workflow({
    id: 'evaluation.identity',
    objective: number,
    result: number,
    run: (objective) => objective,
  });
  const app = createApp({ directory: directory(), workflows: [identity] });
  apps.push(app);
  const first = evaluationCase({ id: 'same', definition: identity, objective: 1 });
  const second = evaluationCase({ id: 'same', definition: identity, objective: 2 });

  await expect(runEvaluation(app, [first, second])).rejects.toThrow(
    'Duplicate evaluation case id: same',
  );
  expect((await app.works.list()).works).toEqual([]);
});

test('aggregates recorded model usage and cost without changing Work', async () => {
  const model: ModelAdapter = {
    id: 'evaluation-usage-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(_request, { progress }) {
      progress?.({
        type: 'completed',
        usage: {
          inputTokens: 120,
          outputTokens: 20,
          totalTokens: 140,
          cost: { amountMicros: 25, currency: 'USD' },
        },
      });
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'answer' }],
        finishReason: 'stop',
      };
    },
  };
  const assistant = agent({
    id: 'evaluation.usage-agent',
    instructions: 'Answer.',
    objective: schema<string>({
      id: 'evaluation.question',
      version: '1',
      jsonSchema: { type: 'string' },
    }),
    model,
  });
  const app = createApp({ directory: directory(), agents: [assistant] });
  apps.push(app);

  const report = await runEvaluation(app, [
    evaluationCase({
      id: 'usage',
      definition: assistant,
      objective: 'Question',
    }),
  ]);
  expect(report.cases[0]).toMatchObject({
    passed: true,
    result: 'answer',
    metrics: {
      modelTurns: 1,
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 20,
        totalTokens: 140,
        costMicros: { USD: 25 },
      },
    },
  });
  await expect(
    (await app.works.get(report.cases[0]!.trace.rootWorkId)).snapshot(),
  ).resolves.toMatchObject({
    status: 'completed',
    result: 'answer',
    usage: { modelTurns: 1 },
  });
});

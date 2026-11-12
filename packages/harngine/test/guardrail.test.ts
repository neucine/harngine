import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  createApp,
  guardrail,
  schema,
  tool,
  type App,
  type Json,
  type ModelAdapter,
  type ModelRequest,
} from '../src/index.js';

const directories: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-guardrail-')));
  directories.push(value);
  return value;
}

function app(options: Parameters<typeof createApp>[0]) {
  const created = createApp(options);
  apps.push(created);
  return created;
}

function model(responses: (request: ModelRequest) => Json): ModelAdapter {
  return {
    id: 'guardrail-test-model',
    capabilities: { tools: true, structuredOutput: true, streaming: false },
    async generate(request) {
      return responses(request) as never;
    },
  };
}

function final(value: string): Json {
  return {
    object: 'model_response',
    items: [{ type: 'data', value }],
    finishReason: 'stop',
  };
}

function redactStrings(value: Json, replace: (value: string) => string): Json {
  if (typeof value === 'string') return replace(value);
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, replace));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redactStrings(item, replace)]),
    ) as Json;
  return value;
}

const request = schema<{ readonly email: string }>({
  id: 'guardrail-request',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: { type: 'string', minLength: 1 } },
  },
});

const text = schema<string>({
  id: 'guardrail-text',
  version: '1',
  jsonSchema: { type: 'string' },
});

test('model input redaction reaches the provider while Work keeps the original objective', async () => {
  const modelInputs: ModelRequest[] = [];
  const pii = guardrail({
    id: 'test.model-pii',
    revision: 'rev_test_model_pii_v1',
    stages: ['model-input'],
    check({ value }) {
      const redacted = redactStrings(value, (item) =>
        item.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'),
      );
      return JSON.stringify(redacted) === JSON.stringify(value)
        ? { action: 'allow' }
        : {
            action: 'redact',
            value: redacted,
            reason: { code: 'PII_REDACTED', message: 'Email redacted' },
          };
    },
  });
  const definition = agent({
    id: 'guardrail-pii-agent',
    instructions: 'Answer with the redacted customer reference.',
    objective: request,
    result: text,
    publish: (value) => value,
    model: model((value) => {
      modelInputs.push(value);
      return final('handled');
    }),
    guardrails: [pii],
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, { email: 'alice@example.com' });

  await expect(work.result()).resolves.toBe('handled');
  expect(JSON.stringify(modelInputs)).toContain('[redacted-email]');
  expect(JSON.stringify(modelInputs)).not.toContain('alice@example.com');
  await expect(work.snapshot()).resolves.toMatchObject({
    objective: { email: 'alice@example.com' },
  });
  const inspection = await work.inspect({ detail: 'diagnostic' });
  expect(inspection.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'guardrail',
        stage: 'model-input',
        action: 'redact',
        guardrail: { id: 'test.model-pii', revision: 'rev_test_model_pii_v1' },
      }),
    ]),
  );
  expect(JSON.stringify(inspection.entries)).not.toContain('alice@example.com');
});

test('Tool input blocks create no Attempt and never invoke the Tool', async () => {
  let calls = 0;
  const blocked = tool<string, string>({
    id: 'guardrail-blocked-tool',
    description: 'Read a value that the guardrail may reject.',
    input: text,
    output: text,
    effect: 'read',
    guardrails: [
      guardrail({
        id: 'test.tool-input-block',
        revision: 'rev_test_tool_input_block_v1',
        stages: ['tool-input'],
        check: ({ value }) =>
          value === 'blocked'
            ? {
                action: 'block',
                reason: { code: 'BLOCKED_VALUE', message: 'Value is blocked' },
              }
            : { action: 'allow' },
      }),
    ],
    execute(value) {
      calls++;
      return value;
    },
  });
  const definition = agent({
    id: 'guardrail-blocked-agent',
    instructions: 'Call the Tool once and report its status.',
    objective: text,
    result: text,
    publish: (value) => value,
    model: model((value) =>
      value.context.items.some((item) => item.type === 'tool_outcome')
        ? final('handled')
        : {
            object: 'model_response',
            items: [
              {
                type: 'tool-call',
                providerCallId: 'blocked-1',
                tool: blocked.id,
                input: 'blocked',
              },
            ],
            finishReason: 'tool-calls',
          },
    ),
    tools: [blocked],
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, 'blocked');

  await expect(work.result()).resolves.toBe('handled');
  expect(calls).toBe(0);
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const call = inspection.entries.find(
    (entry) => entry.type === 'call' && entry.tool.id === blocked.id && entry.phase === 'committed',
  );
  expect(call).toMatchObject({
    type: 'call',
    attemptCount: 0,
    diagnostic: { attempts: [] },
  });
  expect(inspection.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'guardrail',
        stage: 'tool-input',
        action: 'block',
        reason: expect.objectContaining({ code: 'BLOCKED_VALUE' }),
      }),
    ]),
  );
});

test('Tool output redaction is validated before the model observes the result', async () => {
  const modelInputs: ModelRequest[] = [];
  const secret = tool<string, string>({
    id: 'guardrail-redacted-output-tool',
    description: 'Read a value with a sensitive token.',
    input: text,
    output: text,
    effect: 'read',
    guardrails: [
      guardrail({
        id: 'test.tool-output-redact',
        revision: 'rev_test_tool_output_redact_v1',
        stages: ['tool-output'],
        check: ({ value }) =>
          value === 'Bearer secret'
            ? {
                action: 'redact',
                value: '[redacted-token]',
                reason: { code: 'TOKEN_REDACTED', message: 'Token redacted' },
              }
            : { action: 'allow' },
      }),
    ],
    execute: () => 'Bearer secret',
  });
  const definition = agent({
    id: 'guardrail-redacted-output-agent',
    instructions: 'Read the value and return completion.',
    objective: text,
    result: text,
    publish: (value) => value,
    model: model((value) => {
      modelInputs.push(value);
      return value.context.items.some((item) => item.type === 'tool_outcome')
        ? final('handled')
        : {
            object: 'model_response',
            items: [
              {
                type: 'tool-call',
                providerCallId: 'redact-1',
                tool: secret.id,
                input: 'read',
              },
            ],
            finishReason: 'tool-calls',
          };
    }),
    tools: [secret],
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, 'read');

  await expect(work.result()).resolves.toBe('handled');
  expect(JSON.stringify(modelInputs)).toContain('[redacted-token]');
  expect(JSON.stringify(modelInputs)).not.toContain('Bearer secret');
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const call = inspection.entries.find(
    (entry) => entry.type === 'call' && entry.tool.id === secret.id && entry.phase === 'settled',
  );
  expect(call).toMatchObject({
    diagnostic: { outcome: { status: 'success', value: '[redacted-token]' } },
  });
  expect(inspection.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'guardrail',
        stage: 'tool-output',
        action: 'redact',
      }),
    ]),
  );
});

test('blocked write output records occurred once and cannot retry', async () => {
  let calls = 0;
  const writer = tool<string, string>({
    id: 'guardrail-blocked-write-tool',
    description: 'Apply a write whose output is not publishable.',
    input: text,
    output: text,
    effect: 'write',
    capabilities: { idempotency: 'operation-key', reversibility: 'irreversible' },
    retry: { maxAttempts: 3 },
    guardrails: [
      guardrail({
        id: 'test.tool-output-block',
        revision: 'rev_test_tool_output_block_v1',
        stages: ['tool-output'],
        check: () => ({
          action: 'block',
          reason: { code: 'OUTPUT_BLOCKED', message: 'Write output is blocked' },
        }),
      }),
    ],
    execute() {
      calls++;
      return 'applied';
    },
  });
  const definition = agent({
    id: 'guardrail-blocked-write-agent',
    instructions: 'Apply the write and report completion.',
    objective: text,
    result: text,
    publish: (value) => value,
    model: model((value) =>
      value.context.items.some((item) => item.type === 'tool_outcome')
        ? final('handled')
        : {
            object: 'model_response',
            items: [
              {
                type: 'tool-call',
                providerCallId: 'write-1',
                tool: writer.id,
                input: 'apply',
              },
            ],
            finishReason: 'tool-calls',
          },
    ),
    tools: [writer],
  });
  const instance = app({ directory: directory(), agents: [definition] });
  const work = await instance.start(definition, 'apply');

  await expect(work.result()).resolves.toBe('handled');
  expect(calls).toBe(1);
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const call = inspection.entries.find(
    (entry) => entry.type === 'call' && entry.tool.id === writer.id && entry.phase === 'settled',
  );
  expect(call).toMatchObject({
    attemptCount: 1,
    diagnostic: {
      outcome: {
        status: 'failure',
        effect: 'occurred',
        reason: { code: 'OUTPUT_BLOCKED' },
      },
    },
  });
});

test('throwing guardrails fail closed and guardrail identity changes Agent revision', async () => {
  const baseline = agent({
    id: 'guardrail-revision-agent',
    instructions: 'Revision test.',
    objective: text,
    model: model(() => final('ok')),
  });
  const changed = agent({
    ...baseline,
    guardrails: [
      guardrail({
        id: 'test.failing-guardrail',
        revision: 'rev_test_failing_guardrail_v1',
        stages: ['model-output'],
        check() {
          throw new Error('provider DLP unavailable');
        },
      }),
    ],
  });
  expect(changed.revision).not.toBe(baseline.revision);
  const instance = app({ directory: directory(), agents: [changed] });
  const work = await instance.start(changed, 'run');
  await expect(work.result()).rejects.toMatchObject({ code: 'GUARDRAIL_FAILED' });
  expect(() =>
    tool<string, string>({
      id: 'guardrail-invalid-stage-tool',
      input: text,
      output: text,
      effect: 'read',
      guardrails: [
        guardrail({
          id: 'test.wrong-stage',
          revision: 'rev_test_wrong_stage_v1',
          stages: ['model-input'],
          check: () => ({ action: 'allow' }),
        }),
      ],
      execute: (value) => value,
    }),
  ).toThrowError(/use Tool input\/output stages/);
});

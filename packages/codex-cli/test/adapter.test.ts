import { afterEach, expect, test } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodexCliAdapter, createCodexCliModel } from '../src/index.js';
import type { Json } from 'harngine';
import {
  describeModelAdapterConformance,
  type AdapterConformanceFactory,
} from '../../harngine/test/model-adapter-conformance.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const payload: Json = {
  instructions: 'Use evidence',
  objective: 'question',
  turn: 0,
  tools: [],
  items: [],
};
const responseSchema: Json = {
  type: 'object',
  additionalProperties: false,
  required: ['response'],
  properties: {
    response: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'result'],
      properties: {
        type: { type: 'string', enum: ['complete'] },
        result: { type: 'string', minLength: 1 },
      },
    },
  },
};

const conformance: AdapterConformanceFactory = (reply, options) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-cli-conformance-')));
  const command = join(directory, 'codex');
  const replyFile = join(directory, 'reply.json');
  writeFileSync(replyFile, JSON.stringify(reply), { mode: 0o600 });
  writeFileSync(
    command,
    `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex-cli conformance');process.exit(0);}const reply=JSON.parse(fs.readFileSync(${JSON.stringify(replyFile)},'utf8'));if(reply.kind==='provider-error'){console.error('fixture provider error');process.exit(1);}if(reply.kind==='timeout'){setInterval(()=>{},1000);return;}const out=args[args.indexOf('--output-last-message')+1];fs.writeFileSync(out,reply.kind==='malformed'?'garbage':JSON.stringify(reply.value));if(reply.kind==='contract'&&reply.usage)console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:reply.usage.inputTokens,output_tokens:reply.usage.outputTokens}}));`,
    { mode: 0o700 },
  );
  return {
    adapter: createCodexCliAdapter({
      command,
      cliVersion: 'codex-cli conformance',
      timeoutMs: options.timeoutMs,
    }),
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
};

describeModelAdapterConformance('Codex CLI adapter', conformance);

function input(signal = new AbortController().signal) {
  return { payload, responseSchema, ordinal: 1, signal };
}
function fixture(mode: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-cli-test-')));
  directories.push(directory);
  const command = join(directory, 'codex'),
    audit = join(directory, 'audit.json');
  writeFileSync(
    command,
    `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex-cli test');process.exit(0);}const mode=${JSON.stringify(mode)};const out=args[args.indexOf('--output-last-message')+1];let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(audit)},JSON.stringify({args,cwd:process.cwd(),input,schema:JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8')),hasApiKey:Boolean(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY),hasProviderToken:process.env.HARNGINE_MODEL_PROVIDER_TOKEN==='test-bearer'}));
if(mode==='timeout'){setInterval(()=>{},1000);return;}if(mode==='failure'){console.error('Bearer secret-do-not-persist');process.exit(1);}if(mode==='tool'){console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));setInterval(()=>{},1000);return;}if(mode==='overflow'){process.stdout.write('x'.repeat(1100000));return;}if(mode==='progress'){console.log(JSON.stringify({type:'turn.started'}));console.log(JSON.stringify({type:'item.completed',item:{type:'reasoning',summary:[{type:'summary_text',text:'Checked the request and selected a response.'}]}}));}if(mode==='notice')console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'Optional feature unavailable'}}));if(mode==='credits'){console.log(JSON.stringify({type:'error',message:'Your workspace is out of credits. Bearer secret-do-not-persist'}));return;}if(mode==='turn-failure'){console.log(JSON.stringify({type:'turn.failed',error:{message:'failure'}}));return;}
const response=mode==='adapter'?{items:[{type:'text',text:'live-shaped',providerCallId:null,tool:null,input:null,value:null}],finishReason:'stop'}:{response:{type:'complete',result:'live-shaped'}};
fs.writeFileSync(out,mode==='invalid'?'garbage':JSON.stringify(response));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));if(mode==='progress')console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:120,output_tokens:20}}));});`,
    { mode: 0o700 },
  );
  return { command, audit };
}

test('CLI model sends structured context over stdin, uses existing auth and cleans temporary files', async () => {
  const { command, audit } = fixture('success');
  const model = createCodexCliModel({
    command,
    cliVersion: 'codex-cli test',
    model: 'chosen-model',
  });
  expect(await model.invoke(input())).toEqual({
    status: 'success',
    value: { response: { type: 'complete', result: 'live-shaped' } },
  });
  const recorded = JSON.parse(readFileSync(audit, 'utf8')) as {
    args: string[];
    cwd: string;
    input: string;
    hasApiKey: boolean;
    hasProviderToken: boolean;
  };
  expect(JSON.parse(recorded.input)).toEqual(payload);
  expect(recorded.hasApiKey).toBe(false);
  expect(recorded.hasProviderToken).toBe(false);
  expect(recorded.args).toContain('--ignore-user-config');
  expect(recorded.args).toContain('read-only');
  expect(recorded.args).toContain('forced_login_method="chatgpt"');
  expect(recorded.args).toContain('model_reasoning_summary="auto"');
  expect(recorded.args).toContain('shell_tool');
  expect(recorded.args).toContain('chosen-model');
  expect(existsSync(recorded.cwd)).toBe(false);
});

test('explicit model provider reaches Codex without exposing its token in arguments', async () => {
  const { command, audit } = fixture('success');
  const model = createCodexCliModel({
    command,
    cliVersion: 'codex-cli test',
    model: 'codex/gpt-6.1-sol',
    provider: {
      name: 'magpie',
      baseUrl: 'http://127.0.0.1:3425/v1',
      bearerToken: 'test-bearer',
      headers: { 'x-openai-actor-authorization': 'magpie' },
    },
  });
  await expect(model.invoke(input())).resolves.toMatchObject({ status: 'success' });
  const recorded = JSON.parse(readFileSync(audit, 'utf8')) as {
    args: string[];
    hasProviderToken: boolean;
  };
  expect(recorded.args).toEqual(
    expect.arrayContaining([
      'model_provider="magpie"',
      'model_providers.magpie.base_url="http://127.0.0.1:3425/v1"',
      'model_providers.magpie.wire_api="responses"',
      'model_providers.magpie.env_key="HARNGINE_MODEL_PROVIDER_TOKEN"',
      'model_providers.magpie.http_headers={ "x-openai-actor-authorization" = "magpie" }',
      'codex/gpt-6.1-sol',
    ]),
  );
  expect(recorded.args).not.toContain('forced_login_method="chatgpt"');
  expect(recorded.args.join(' ')).not.toContain('test-bearer');
  expect(recorded.hasProviderToken).toBe(true);
});

test('nonfatal CLI feature notices allow a successful model response', async () => {
  const { command } = fixture('notice');
  expect(
    await createCodexCliModel({ command, cliVersion: 'codex-cli test' }).invoke(input()),
  ).toMatchObject({ status: 'success' });
});

test('Codex adapter uses a provider-compatible tagged schema and normalizes its response', async () => {
  const { command } = fixture('adapter');
  const adapter = createCodexCliAdapter({ command, cliVersion: 'codex-cli test' });
  await expect(
    adapter.generate(
      {
        object: 'model_request',
        instructions: ['Answer.'],
        context: {
          object: 'model_context',
          objective: 'question',
          items: [],
          artifacts: [],
          policy: 'test',
          budget: { inputTokens: 1000, estimatedTokens: 10 },
        },
        tools: [],
      },
      { signal: new AbortController().signal, emit: () => {} },
    ),
  ).resolves.toEqual({
    items: [{ type: 'text', text: 'live-shaped' }],
    object: 'model_response',
    finishReason: 'stop',
  });
});

test('Codex output contract binds each tool name to its own required input', async () => {
  const { command, audit } = fixture('adapter');
  const adapter = createCodexCliAdapter({ command, cliVersion: 'codex-cli test' });
  await adapter.generate(
    {
      object: 'model_request',
      instructions: ['Use a tool.'],
      context: {
        object: 'model_context',
        objective: 'edit',
        items: [],
        artifacts: [],
        policy: 'test',
        budget: { inputTokens: 1000, estimatedTokens: 10 },
      },
      tools: [
        {
          id: 'read',
          kind: 'tool',
          description: 'Read',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          outputSchema: { type: 'string' },
        },
        {
          id: 'edit',
          kind: 'tool',
          description: 'Edit',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              oldText: { type: 'string' },
              newText: { type: 'string' },
            },
            required: ['path', 'oldText', 'newText'],
          },
          outputSchema: { type: 'string' },
        },
      ],
    },
    { signal: new AbortController().signal, emit: () => {} },
  );
  type Variant = { properties: { tool: { enum?: string[] }; input: { required?: string[] } } };
  const recorded = JSON.parse(readFileSync(audit, 'utf8')) as {
    schema: { properties: { items: { items: { anyOf: Variant[] } } } };
  };
  const variants = recorded.schema.properties.items.items.anyOf;
  expect(
    variants.find((variant) => variant.properties.tool.enum?.[0] === 'edit')?.properties.input
      .required,
  ).toEqual(['path', 'oldText', 'newText']);
  expect(
    variants.find((variant) => variant.properties.tool.enum?.[0] === 'read')?.properties.input
      .required,
  ).toEqual(['path']);
});

test.each([
  ['failure', 'cli_exit'],
  ['turn-failure', 'cli_failure'],
  ['credits', 'cli_failure:workspace out of credits'],
  ['tool', 'unexpected_cli_item:command_execution'],
  ['overflow', 'output_limit'],
  ['timeout', 'timeout'],
])('%s produces an unknown Outcome without raw diagnostics', async (mode, reason) => {
  const { command } = fixture(mode!);
  const result = await createCodexCliModel({
    command,
    cliVersion: 'codex-cli test',
    timeoutMs: 200,
  }).invoke(input());
  expect(result).toEqual({
    status: 'unknown',
    reason: { code: 'MODEL_UNCERTAIN', message: reason },
  });
  expect(JSON.stringify(result)).not.toContain('secret-do-not-persist');
});

test('invalid structured output produces an unknown model-response Outcome', async () => {
  const { command } = fixture('invalid');
  expect(
    await createCodexCliModel({ command, cliVersion: 'codex-cli test' }).invoke(input()),
  ).toEqual({
    status: 'unknown',
    reason: { code: 'MODEL_RESPONSE', message: 'Invalid or missing model response' },
  });
});

test('cancellation reaches the subprocess', async () => {
  const { command, audit } = fixture('timeout'),
    controller = new AbortController(),
    model = createCodexCliModel({ command, cliVersion: 'codex-cli test' });
  const pending = model.invoke(input(controller.signal));
  for (let index = 0; index < 100 && !existsSync(audit); index++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(existsSync(audit)).toBe(true);
  controller.abort();
  expect(await pending).toEqual({
    status: 'unknown',
    reason: { code: 'MODEL_UNCERTAIN', message: 'aborted' },
  });
});

test('unavailable or changed CLI fails before model dispatch', async () => {
  const { command, audit } = fixture('success');
  expect(
    await createCodexCliModel({ command, cliVersion: 'different' }).invoke(input()),
  ).toMatchObject({ status: 'failure', reason: { code: 'CLI_VERSION' } });
  expect(existsSync(audit)).toBe(false);
  expect(
    await createCodexCliModel({ command: join(command, 'missing'), cliVersion: 'test' }).invoke(
      input(),
    ),
  ).toMatchObject({ status: 'failure', reason: { code: 'CLI_VERSION' } });
});

test('Codex CLI reports observable model progress without exposing structured output text', async () => {
  const { command } = fixture('progress');
  const updates: { type: string; text?: string }[] = [];
  const outcome = await createCodexCliModel({ command, cliVersion: 'codex-cli test' }).invoke({
    ...input(),
    progress: (event) => updates.push(event),
  });
  expect(outcome.status).toBe('success');
  expect(updates).toEqual([
    { type: 'started' },
    { type: 'reasoning', text: 'Checked the request and selected a response.' },
    { type: 'completed', usage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 } },
  ]);
});

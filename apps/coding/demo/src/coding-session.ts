import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createCodexCliAdapter } from '@harngine/codex-cli';
import {
  agent,
  createApp,
  schema,
  tool,
  type Json,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
} from 'harngine';
import { serveCodingSession } from './coding-session-server.js';

const files: Readonly<Record<string, string>> = {
  'src/tokens.ts': `export type Family = { revoked: boolean; used: Set<string> };
export function refresh(family: Family, tokenId: string) {
  if (family.revoked) throw new Error('revoked');
  if (family.used.has(tokenId)) throw new Error('reused');
  family.used.add(tokenId);
  return { accessToken: 'new-access-token' };
}`,
  'src/tokens.test.ts': `import { refresh } from './tokens.js';
test('rejects a used token', () => {
  const family = { revoked: false, used: new Set(['old']) };
  expect(() => refresh(family, 'old')).toThrow('reused');
});`,
  'README.md':
    'This miniature service rotates refresh tokens. Reuse must revoke the whole token family.',
};
const object = (properties: Record<string, Json>, required = Object.keys(properties)): Json => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const text: Json = { type: 'string', minLength: 1, maxLength: 10_000 };

export interface CodingSessionModel extends ModelAdapter {
  readonly label: string;
  readonly mode: 'live' | 'test';
}

export function codexCodingSessionModel(options: {
  cliVersion: string;
  model?: string;
  timeoutMs?: number;
}): CodingSessionModel {
  return {
    ...createCodexCliAdapter({
      cliVersion: options.cliVersion,
      model: options.model ?? 'codex/gpt-6.1-sol',
      provider: {
        name: 'magpie',
        baseUrl: process.env.HARNGINE_CODING_API_BASE_URL ?? 'http://127.0.0.1:3425/v1',
        wireApi: 'responses',
        bearerToken: process.env.HARNGINE_CODING_API_TOKEN ?? 'magpie',
        headers: {
          'x-openai-actor-authorization': process.env.HARNGINE_CODING_ACTOR ?? 'magpie',
        },
      },
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
    label: `Codex CLI ${options.model ?? 'default model'} (${options.cliVersion})`,
    mode: 'live',
  };
}

export async function runCodingSessionDemo(options: {
  directory: string;
  model: CodingSessionModel;
  log?: (line: string) => void;
}) {
  mkdirSync(options.directory, { recursive: true });
  const directory = realpathSync(options.directory);
  const reportPath = join(directory, 'coding-session-report.json');
  const log = options.log ?? (() => {});
  const message = schema<string>({ id: 'demo.coding-message', version: '1', jsonSchema: text });
  const pathInput = schema<Json>({
    id: 'demo.code-path',
    version: '1',
    jsonSchema: object({ path: text }),
  });
  const searchInput = schema<Json>({
    id: 'demo.code-search',
    version: '1',
    jsonSchema: object({ query: text }),
  });
  const fileOutput = schema<Json>({
    id: 'demo.code-file',
    version: '1',
    jsonSchema: object({ path: text, content: text }),
  });
  const searchOutput = schema<Json>({
    id: 'demo.code-matches',
    version: '1',
    jsonSchema: { type: 'array', items: object({ path: text, line: { type: 'integer' }, text }) },
  });
  let modelCalls = 0;
  let toolCalls = 0;
  const turns: { request: ModelRequest; response: ModelResponse }[] = [];
  const model: ModelAdapter = {
    id: options.model.id,
    capabilities: options.model.capabilities,
    async generate(request, context) {
      modelCalls++;
      log(`model ${modelCalls}: complete logical ModelRequest sent to ${options.model.label}`);
      const response = await options.model.generate(request, context);
      turns.push({ request, response });
      log(`model ${modelCalls}: ${JSON.stringify(response)}`);
      return response;
    },
  };
  const readFile = tool({
    id: 'demo.code.read-file',
    description: 'Read one workspace file by its exact relative path.',
    input: pathInput,
    output: fileOutput,
    effect: 'read',
    execute(input, context) {
      toolCalls++;
      const path = (input as { path: string }).path;
      const content = files[path];
      if (content === undefined)
        return context.fail({ effect: 'none', code: 'NOT_FOUND', message: `No file ${path}` });
      return { path, content };
    },
  });
  const searchText = tool({
    id: 'demo.code.search-text',
    description: 'Search all workspace files for a literal case-insensitive text fragment.',
    input: searchInput,
    output: searchOutput,
    effect: 'read',
    execute(input) {
      toolCalls++;
      const query = (input as { query: string }).query.toLowerCase();
      return Object.entries(files).flatMap(([path, content]) =>
        content
          .split('\n')
          .map((line, index) => ({ path, line: index + 1, text: line }))
          .filter((item) => item.text.toLowerCase().includes(query)),
      );
    },
  });
  const assistant = agent({
    id: 'demo.coding-assistant',
    instructions:
      'Act as a coding assistant for the supplied miniature TypeScript workspace. Inspect code with the available tools before answering. Explain findings with file paths and line numbers from recorded evidence. Use prior Session messages to resolve follow-up references. Do not claim to have edited or tested code; these tools are read-only.',
    objective: message,
    model,
    tools: [readFile, searchText],
    limits: { modelTurns: 10, toolExecutions: 8 },
    context: { session: { recent: 12 }, reserveForOutput: 2_000 },
  });
  const app = createApp({ directory, agents: [assistant] });
  try {
    const listed = await app.sessions.list({ limit: 1 });
    const session = listed.sessions[0]
      ? await app.sessions.get(listed.sessions[0].id)
      : await app.sessions.create({ agent: assistant, title: 'Coding assistant' });
    const requests = [
      'Find the refresh-token reuse defect and explain the smallest safe fix.',
      'What regression tests should we add for that fix?',
    ];
    const existing = await session.messages({ limit: 100 });
    const executions: {
      work: { id: string };
      snapshot: unknown;
      calls: unknown[];
      modelTurns: { request: ModelRequest; response: ModelResponse }[];
    }[] = [];
    for (const objective of requests) {
      if (existing.some((entry) => entry.author === 'human' && entry.content === objective))
        continue;
      log(`\nuser: ${objective}`);
      const turnStart = turns.length;
      const { work } = await session.send(objective);
      const answer = await work.result();
      log(`assistant: ${answer}`);
      const selectedTurns = turns.slice(turnStart);
      executions.push({
        work: { id: work.id },
        snapshot: {
          objective,
          context: selectedTurns[0]?.request.context.items ?? [],
          closure: { status: 'completed', result: answer },
        },
        calls: selectedTurns.flatMap((turn, index) => [
          {
            slot: `model:${index}`,
            status: 'settled',
            tool: { id: options.model.id },
            input: { request: turn.request },
            outcome: { status: 'success', value: turn.response },
          },
          ...turn.response.items
            .filter((item) => item.type === 'tool-call')
            .map((item) => ({
              slot: `tool:${index}:${item.providerCallId}`,
              status: 'settled',
              tool: { id: item.tool },
              input: item.input,
            })),
        ]),
        modelTurns: selectedTurns,
      });
    }
    if (!executions.length) {
      try {
        const saved = JSON.parse(readFileSync(reportPath, 'utf8'));
        return { ...saved, invocations: { model: 0, tools: 0 } };
      } catch {}
    }
    const messages = await session.messages({ limit: 100 });
    const history = messages.map((entry, index) => ({
      sequence: index + 1,
      entry:
        entry.author === 'human'
          ? { type: 'input', content: entry.content, work: { id: entry.workId } }
          : {
              type: 'result',
              work: { id: entry.workId },
              closure: { status: 'completed', result: entry.content },
            },
    }));
    const report = {
      directory,
      agent: { id: assistant.id, version: assistant.revision },
      model: { label: options.model.label, mode: options.model.mode, responseSchema: text },
      session: await session.snapshot(),
      history,
      executions,
      workspace: Object.keys(files),
      invocations: { model: modelCalls, tools: toolCalls },
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return report;
  } finally {
    await app.close();
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      timeout: { type: 'string' },
      noUi: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'bun run demo:coding [--model model-id] [--timeout milliseconds] [--directory path] [--port number] [--no-ui]',
    );
    process.exit(0);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const base = join(root, '.harngine');
  mkdirSync(base, { recursive: true });
  const directory = values.directory
    ? resolve(values.directory)
    : mkdtempSync(join(base, 'coding-session-'));
  const cliVersion = execFileSync('codex', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  execFileSync('codex', ['login', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000)
  )
    throw Error('Timeout must be from 100 to 600000 milliseconds');
  const report = await runCodingSessionDemo({
    directory,
    model: codexCodingSessionModel({
      cliVersion,
      ...(values.model ? { model: values.model } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
    log: console.log,
  });
  const details = `Session: ${report.session.id}\nData: ${report.directory}\nReport: ${join(report.directory, 'coding-session-report.json')}`;
  if (values.noUi) console.log(`\n${details}`);
  else {
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error('Port must be from 0 to 65535');
    const server = await serveCodingSession(report, port);
    console.log(`\nHarngine Coding Session showcase\nOpen: ${server.url}\n${details}`);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void server.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createCodingApp } from '@harngine/coding-agent';
import type { Json, Session, SessionId, SessionState, Work } from 'harngine';
import {
  runCodingWork,
  type ApprovalMode,
  type CodingWorkActivity,
  type CodingWorkResult,
  type CodingToolProgress,
} from './runner.js';

const help = `Harngine Coding

Start an interactive session:
  bun run coding:cli --repo /path/to/repository

Run one task:
  bun run coding:cli --repo /path/to/repository --task "Fix the failing tests" --write

Use OpenAI with your own model and API key:
  OPENAI_API_KEY=... bun run coding:cli --repo /path/to/repository --provider openai --model <model-id>

If no provider is detected, interactive startup prompts for OpenAI, Claude, or local Magpie.

Options:
  --repo <path>        Repository to inspect (defaults to the current directory)
  --task <request>     Run one task, or pipe a task through stdin
  --write              Allow edits and checks
  --session <id>       Resume a specific Session
  --continue           Resume the latest Session for the selected access mode
  --provider <name>    magpie (default), openai, claude, or codex
  --model <id>         Select the provider model
  --base-url <url>     Override the provider API endpoint
  --show-thinking      Print provider reasoning summaries
  --no-color           Disable terminal styling
  --yes                Approve exact edits without prompting
  --json               Print one machine-readable result
  --list-sessions      List saved coding Sessions

Interactive commands:
  /help  /new  /read  /write  /sessions  /session <id>  /status  /quit

Ctrl+C stops the active Work. In write mode, each exact file change is shown before approval.`;

type Parsed = ReturnType<typeof parseArguments>;
type Coding = ReturnType<typeof createCodingApp>;
type SelectedSession = {
  readonly intercept: Session;
  readonly write: boolean;
};

type ProviderSettings = {
  readonly provider?: string;
  readonly model?: string;
  readonly apiToken?: string;
};

function parseArguments(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: 'string' },
      task: { type: 'string' },
      write: { type: 'boolean', default: false },
      session: { type: 'string' },
      continue: { type: 'boolean', default: false },
      provider: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'show-thinking': { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'list-sessions': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

let colorsEnabled = false;

function hasColor() {
  return colorsEnabled && !!process.stderr.isTTY;
}

function style(code: string, value: string) {
  return hasColor() ? `\u001b[${code}m${value}\u001b[0m` : value;
}

const dim = (value: string) => style('2', value);
const green = (value: string) => style('32', value);
const amber = (value: string) => style('33', value);
const cyan = (value: string) => style('36', value);
const bold = (value: string) => style('1', value);

function progress(line: string) {
  process.stderr.write(formatProgress(line));
}

function formatProgress(line: string) {
  return `${dim('│')} ${line}\n`;
}

function dimToolProgress(line: string) {
  const value = line.trimStart();
  const subdued = /^(?:[→✓✕?…]|Thinking\b)/.test(value) ? dim(line) : line;
  process.stderr.write(`${dim('│')} ${subdued}\n`);
}

function info(line: string) {
  process.stderr.write(`${line}\n`);
}

function elapsed(ms: number) {
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`;
}

function createActivity(enabled: boolean) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let timer: ReturnType<typeof setInterval> | undefined;
  let startedAt = 0;
  let activeSince = 0;
  let activeMs = 0;
  let frame = 0;
  let label = 'Thinking';
  let detail = '';
  let visible = false;
  let suspended = false;

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!visible) return;
    process.stderr.write('\r\u001b[2K');
    visible = false;
  };

  const render = () => {
    if (!enabled) return;
    const icon = frames[frame++ % frames.length];
    const text = detail ? `${label} · ${detail}` : `${label}…`;
    const width = Math.max(24, (process.stderr.columns || 80) - 20);
    const fitted = text.length > width ? `${text.slice(0, width - 1)}…` : text;
    const styled = detail ? dim(fitted) : fitted;
    process.stderr.write(
      `\r\u001b[2K${dim('│')} ${cyan(icon!)} ${styled} ${dim(elapsed(Date.now() - startedAt))}`,
    );
    visible = true;
  };

  const accumulate = () => {
    if (!activeSince) return;
    activeMs += Date.now() - activeSince;
    activeSince = 0;
  };

  return {
    update(state: CodingWorkActivity) {
      if (!enabled || suspended) return;
      if (state.status === 'idle') {
        accumulate();
        clear();
        detail = '';
        startedAt = 0;
        return;
      }
      if (!startedAt) startedAt = Date.now();
      if (!activeSince) activeSince = Date.now();
      const nextLabel = state.label ?? (state.status === 'working' ? 'Working' : 'Thinking');
      if (nextLabel !== label) detail = '';
      label = nextLabel;
      if (state.detail) detail = state.detail;
      if (!timer) {
        render();
        timer = setInterval(render, 80);
      } else {
        render();
      }
    },
    collapse() {
      if (!enabled) return;
      accumulate();
      clear();
      detail = '';
      startedAt = 0;
      if (activeMs > 0) {
        process.stderr.write(`${green('✓')} Thought for ${elapsed(activeMs)}\n`);
        activeMs = 0;
      }
    },
    stop() {
      accumulate();
      clear();
      detail = '';
      startedAt = 0;
      activeMs = 0;
    },
    suspend() {
      if (!enabled) return;
      accumulate();
      clear();
      detail = '';
      startedAt = 0;
      suspended = true;
    },
    resume() {
      suspended = false;
    },
  };
}

function createToolProgress(enabled: boolean, activity: ReturnType<typeof createActivity>) {
  let active: { callId: string; label: string } | undefined;
  const write = (symbol: string, label: string, final: boolean) => {
    if (!enabled) return;
    process.stderr.write(`\r\u001b[2K${dim('│')} ${dim(`${symbol} ${label}`)}${final ? '\n' : ''}`);
  };
  const finish = (symbol: string) => {
    if (!active) return;
    write(symbol, active.label, true);
    active = undefined;
    activity.resume();
  };
  return {
    update(event: CodingToolProgress) {
      if (!enabled) return;
      if (event.phase === 'started') {
        finish('✓');
        activity.suspend();
        active = { callId: event.callId, label: event.label };
        write('→', event.label, false);
        return;
      }
      if (active?.callId === event.callId && event.phase === 'reconciling') {
        write('…', event.label, false);
        return;
      }
      if (active?.callId === event.callId) {
        finish(
          event.phase === 'succeeded'
            ? '✓'
            : event.phase === 'failed'
              ? '✕'
              : event.phase === 'uncertain'
                ? '?'
                : '…',
        );
      } else if (event.phase !== 'reconciling') {
        write(
          event.phase === 'succeeded' ? '✓' : event.phase === 'failed' ? '✕' : '?',
          event.phase === 'uncertain' ? `${event.label} · result needs review` : event.label,
          true,
        );
      }
    },
    finish() {
      finish('…');
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  let parsed: Parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    console.error(message(error));
    console.error('\nRun with --help for usage.');
    process.exitCode = 2;
    return;
  }

  const { values, positionals } = parsed;
  colorsEnabled = !values['no-color'] && !!process.stderr.isTTY;
  if (values.help) {
    console.log(help);
    return;
  }
  if (values.session && values.continue) {
    console.error('Use either --session or --continue, not both.');
    process.exitCode = 2;
    return;
  }

  const repo = resolve(values.repo ?? process.cwd());
  const task =
    values.task?.trim() ||
    positionals.join(' ').trim() ||
    (values['list-sessions'] ? '' : pipedTask());
  const interactive = !task && !values['list-sessions'];
  if (interactive && !process.stdin.isTTY) {
    console.error('No task was supplied. Pipe a task through stdin or pass --task.');
    process.exitCode = 2;
    return;
  }
  if (values.json && interactive) {
    console.error('--json requires a one-shot --task or piped task.');
    process.exitCode = 2;
    return;
  }

  const providerSettings = values['list-sessions']
    ? {
        ...(values.provider ? { provider: values.provider } : {}),
        ...(values.model ? { model: values.model } : {}),
      }
    : await resolveProviderSettings(values);
  const coding = createCodingApp({
    repo,
    writable: interactive ? true : values.write,
    principal: 'cli',
    requireEditApproval: true,
    ...(providerSettings.provider ? { provider: providerSettings.provider } : {}),
    ...(providerSettings.model ? { modelId: providerSettings.model } : {}),
    ...(providerSettings.apiToken ? { apiToken: providerSettings.apiToken } : {}),
    ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
  });

  try {
    if (values['list-sessions']) {
      await listSessions(coding.app.sessions, false);
      return;
    }

    const selected = await selectSession(coding, values, values.write);
    if (task) {
      await runOneShot(coding, selected, task, values);
      return;
    }
    await runInteractive(coding, selected, values);
  } finally {
    await coding.app.close();
  }
}

function pipedTask() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

async function resolveProviderSettings(values: Parsed['values']): Promise<ProviderSettings> {
  let provider =
    values.provider?.trim() ||
    process.env.HARNGINE_CODING_PROVIDER?.trim() ||
    (process.env.OPENAI_API_KEY
      ? 'openai'
      : process.env.ANTHROPIC_API_KEY
        ? 'claude'
        : process.env.HARNGINE_CODING_API_TOKEN
          ? 'openai'
          : process.env.HARNGINE_CODING_API_BASE_URL
            ? 'openai'
            : undefined);

  if (!provider && (await magpieAvailable())) provider = 'magpie';
  if (!provider) {
    if (!process.stdin.isTTY)
      throw new Error(
        'No model provider is configured. Set OPENAI_API_KEY and pass --provider openai --model <id>, or start local Magpie.',
      );
    provider = await chooseProvider();
  }

  const canonical =
    provider === 'api' || provider === 'openai-responses'
      ? 'openai'
      : provider === 'claude-messages'
        ? 'claude'
        : provider;
  const model =
    values.model?.trim() ||
    process.env.CODEX_MODEL?.trim() ||
    (canonical === 'openai'
      ? process.env.OPENAI_MODEL?.trim()
      : canonical === 'claude'
        ? process.env.ANTHROPIC_MODEL?.trim()
        : undefined);

  if (canonical !== 'openai' && canonical !== 'claude') {
    return { provider, ...(model ? { model } : {}) };
  }

  const resolvedModel =
    model || (await askLine(`${canonical === 'openai' ? 'OpenAI' : 'Claude'} model: `));
  if (!resolvedModel.trim())
    throw new Error(`${canonical === 'openai' ? 'OpenAI' : 'Claude'} requires a model ID.`);
  const token =
    (canonical === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) ??
    process.env.HARNGINE_CODING_API_TOKEN ??
    (await askSecret(`${canonical === 'openai' ? 'OpenAI' : 'Claude'} API key: `));
  return { provider, model: resolvedModel.trim(), apiToken: token.trim() };
}

async function magpieAvailable() {
  const base = process.env.HARNGINE_CODING_API_BASE_URL?.trim() || 'http://127.0.0.1:3425/v1';
  try {
    await fetch(base, {
      headers: {
        authorization: `Bearer ${process.env.HARNGINE_CODING_API_TOKEN?.trim() || 'magpie'}`,
      },
      signal: AbortSignal.timeout(600),
    });
    return true;
  } catch {
    return false;
  }
}

async function chooseProvider() {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    console.error('No model provider was detected. Choose one for this run:');
    const answer = (
      await readline.question('  1. OpenAI\n  2. Claude\n  3. Local Magpie\nProvider [1]: ')
    ).trim();
    if (answer === '' || answer === '1' || /^openai$/i.test(answer)) return 'openai';
    if (answer === '2' || /^claude$/i.test(answer)) return 'claude';
    if (answer === '3' || /^magpie$/i.test(answer)) return 'magpie';
    throw new Error(`Unknown provider choice: ${answer}`);
  } finally {
    readline.close();
  }
}

async function askLine(prompt: string) {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

async function askSecret(prompt: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new Error('API token entry requires an interactive terminal.');
  process.stderr.write(prompt);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Provider setup canceled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (!value) continue;
          value = value.slice(0, -1);
          process.stderr.write('\b \b');
          continue;
        }
        value += character;
        process.stderr.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function selectSession(coding: Coding, values: Parsed['values'], write: boolean) {
  if (values.session) {
    const session = await coding.app.sessions.get(values.session as SessionId);
    const mode = await sessionMode(session);
    if (mode !== write) {
      throw new Error(
        `Session ${session.id} uses ${mode ? 'edit' : 'read'} access. Re-run with ${mode ? '--write' : 'no --write flag'}.`,
      );
    }
    return { intercept: session, write: mode } satisfies SelectedSession;
  }

  if (values.continue) {
    const page = await coding.app.sessions.list({ limit: 100 });
    const session = page.sessions
      .filter(
        (item) => item.agent.id === (write ? 'coding.workspace-write' : 'coding.workspace-read'),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (session) return openSession(coding, session.id);
  }

  return createSession(coding, write);
}

async function openSession(coding: Coding, id: SessionId): Promise<SelectedSession> {
  const intercept = await coding.app.sessions.get(id);
  return { intercept, write: await sessionMode(intercept) };
}

async function sessionMode(session: Session) {
  return (await session.snapshot()).agent.id === 'coding.workspace-write';
}

async function createSession(coding: Coding, write: boolean): Promise<SelectedSession> {
  const agent = write ? coding.assistant : coding.readAssistant;
  const intercept = await coding.app.sessions.create({
    agent,
    title: write ? 'Terminal edit session' : 'Terminal read session',
  });
  return { intercept, write };
}

async function runOneShot(
  coding: Coding,
  selected: SelectedSession,
  task: string,
  values: Parsed['values'],
) {
  const startedAt = Date.now();
  if (!values.json) printSessionHeader(coding.root, selected.intercept.id, selected.write);
  if (!values.json) printRouting(coding);
  const { work } = await selected.intercept.send(task);
  if (!values.json) info(`${dim('Work')} ${work.id}\n`);

  const approval: ApprovalMode = values.yes ? 'approve' : process.stdin.isTTY ? 'ask' : 'deny';
  let result: CodingWorkResult<Json>;
  try {
    result = await executeWork(work, {
      approval,
      json: values.json,
      showThinking: values['show-thinking'],
      onResult: printAnswer,
    });
  } catch (error) {
    if (!values.json) throw error;
    console.log(
      JSON.stringify(
        {
          session: selected.intercept.id,
          work: work.id,
          provider: coding.provider,
          model: coding.model,
          status: isCancellation(error) ? 'canceled' : 'failed',
          elapsedMs: Date.now() - startedAt,
          usage: null,
          result: null,
          error: message(error),
          events: [],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          session: selected.intercept.id,
          work: work.id,
          provider: coding.provider,
          model: coding.model,
          status: 'completed',
          elapsedMs: result.elapsedMs,
          usage: result.usage ?? null,
          result: result.result,
          events: result.events,
        },
        null,
        2,
      ),
    );
    return;
  }

  printCompletion(result);
}

async function executeWork(
  work: Work,
  options: {
    readonly approval: ApprovalMode;
    readonly json: boolean;
    readonly showThinking: boolean;
    readonly onResult?: (result: CodingWorkResult<Json>) => void;
  },
) {
  let readline: ReturnType<typeof createInterface> | undefined;
  const requirePrompt = !options.json && options.approval === 'ask';
  if (requirePrompt) readline = createInterface({ input: process.stdin, output: process.stdout });
  const activity = createActivity(!options.json && !!process.stderr.isTTY);
  const toolProgress =
    !options.json && !!process.stderr.isTTY ? createToolProgress(true, activity) : undefined;
  const interrupt = () => {
    activity.stop();
    progress(amber('Stopping active Work…'));
    void work.cancel('Stopped from Harngine Coding CLI');
  };
  process.once('SIGINT', interrupt);
  readline?.on('SIGINT', interrupt);

  let completed = false;
  try {
    const result = await runCodingWork(work, {
      approval: options.approval,
      ...(readline ? { ask: (prompt: string) => readline!.question(prompt) } : {}),
      ...(options.json ? {} : { progress: dimToolProgress }),
      activity: activity.update,
      ...(toolProgress ? { toolProgress: toolProgress.update } : {}),
      showThinking: options.showThinking,
    });
    options.onResult?.(result);
    completed = true;
    return result;
  } finally {
    toolProgress?.finish();
    if (completed) {
      activity.collapse();
    } else {
      activity.stop();
    }
    process.removeListener('SIGINT', interrupt);
    readline?.removeListener('SIGINT', interrupt);
    readline?.close();
  }
}

function printAnswer(result: CodingWorkResult<Json>) {
  const text =
    typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
  if (
    !result.streamedText.trim() ||
    !result.streamedText.trim().endsWith(text.trim()) ||
    text.trim() === ''
  ) {
    console.log(`\n${bold('Agent')}\n${text}`);
  }
}

function printCompletion(result: CodingWorkResult<Json>) {
  const usage = result.usage
    ? ` · ${result.usage.modelTurns} model · ${result.usage.toolExecutions} tools`
    : '';
  progress(`${green('Complete')} · ${elapsed(result.elapsedMs)}${usage}`);
}

async function runInteractive(coding: Coding, initial: SelectedSession, values: Parsed['values']) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let selected = initial;
  let active: Work | undefined;
  let activity: ReturnType<typeof createActivity> | undefined;
  let toolProgress: ReturnType<typeof createToolProgress> | undefined;
  let last: CodingWorkResult<Json> | undefined;
  let closed = false;
  readline.on('close', () => {
    closed = true;
  });
  readline.on('SIGINT', () => {
    if (active) {
      activity?.stop();
      progress(amber('Stopping active Work…'));
      void active.cancel('Stopped from Harngine Coding CLI');
    } else {
      readline.close();
    }
  });

  const ask = (prompt: string) => readline.question(prompt);
  console.log(bold('\nHarngine Coding'));
  console.log(`${dim(coding.root)}\n`);
  printSessionHeader(coding.root, selected.intercept.id, selected.write);
  printRouting(coding);
  console.log(`${dim('Type /help for commands. Ctrl+C stops active Work.')}\n`);

  try {
    while (!closed) {
      const line = (
        await readline.question(
          `${cyan(`[${selected.write ? 'edit' : 'read'}]`)} ${bold('repo')} › `,
        )
      ).trim();
      if (!line) continue;
      if (line.startsWith('/')) {
        const [command = '', ...rest] = line.split(/\s+/);
        if (command === '/quit' || command === '/exit') break;
        if (command === '/help') {
          console.log(help);
          continue;
        }
        if (command === '/sessions') {
          await listSessions(coding.app.sessions, true);
          continue;
        }
        if (command === '/new') {
          selected = await createSession(coding, selected.write);
          printSessionHeader(coding.root, selected.intercept.id, selected.write);
          continue;
        }
        if (command === '/read' || command === '/write') {
          const write = command === '/write';
          if (write !== selected.write) selected = await createSession(coding, write);
          printSessionHeader(coding.root, selected.intercept.id, selected.write);
          continue;
        }
        if (command === '/session') {
          const id = rest[0];
          if (!id) {
            console.error('Usage: /session <id>');
            continue;
          }
          selected = await openSession(coding, id as SessionId);
          printSessionHeader(coding.root, selected.intercept.id, selected.write);
          continue;
        }
        if (command === '/status') {
          const snapshot = await selected.intercept.snapshot();
          console.log(
            [
              `Session ${snapshot.id}`,
              `Mode ${selected.write ? 'edit' : 'read'}`,
              `Model ${coding.model} via ${coding.provider}`,
              `Status ${snapshot.status}`,
              `Active Work ${snapshot.foregroundWorkId ?? 'none'}`,
              last ? `Last run ${elapsed(last.elapsedMs)}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          );
          continue;
        }
        console.error(`Unknown command ${command}. Type /help for commands.`);
        continue;
      }

      try {
        const { work } = await selected.intercept.send(line);
        active = work;
        activity = createActivity(!!process.stderr.isTTY);
        toolProgress = process.stderr.isTTY ? createToolProgress(true, activity) : undefined;
        info(`${dim('Work')} ${work.id}`);
        const result = await runCodingWork(work, {
          approval: values.yes ? 'approve' : 'ask',
          ask,
          progress: dimToolProgress,
          activity: activity.update,
          ...(toolProgress ? { toolProgress: toolProgress.update } : {}),
          showThinking: values['show-thinking'],
        });
        last = result;
        printAnswer(result);
        activity.collapse();
        printCompletion(result);
      } catch (error) {
        console.error(`\n${amber('Task stopped')} · ${message(error)}`);
      } finally {
        toolProgress?.finish();
        activity?.stop();
        activity = undefined;
        toolProgress = undefined;
        active = undefined;
      }
    }
  } finally {
    readline.close();
  }
}

async function listSessions(sessions: Coding['app']['sessions'], compact: boolean) {
  const page = await sessions.list({ limit: 100 });
  const codingSessions = page.sessions
    .filter((session) => session.agent.id.startsWith('coding.'))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (codingSessions.length === 0) {
    console.log('No coding Sessions yet.');
    return;
  }
  for (const session of codingSessions) {
    console.log(formatSession(session, compact));
  }
}

function formatSession(session: SessionState, compact: boolean) {
  const mode = session.agent.id === 'coding.workspace-write' ? 'edit' : 'read';
  const date = new Date(session.updatedAt).toLocaleString();
  return compact
    ? `${mode.padEnd(4)} ${session.id}  ${session.title}`
    : `${session.id}  ${mode.padEnd(4)}  ${date}  ${session.title}`;
}

function printSessionHeader(repo: string, id: string, write: boolean) {
  info(`${bold('Session')} ${id}  ${dim(write ? 'edit access' : 'read access')}  ${repo}`);
}

function printRouting(coding: Coding) {
  info(`${dim('Model')} ${coding.model}  ${dim(`via ${coding.provider}`)}\n`);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isCancellation(error: unknown) {
  return /\bcancel|stopped from harngine/i.test(message(error));
}

try {
  await main();
} catch (error) {
  console.error(`Coding error: ${message(error)}`);
  process.exitCode = 1;
}

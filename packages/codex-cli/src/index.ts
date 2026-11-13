import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  modelEnvelopeInstructions,
  modelOutputSchema,
  modelResponseContract,
  normalizeModelEnvelope,
} from 'harngine';
import type { Json, ModelAdapter, ModelResponse, ModelProgress } from 'harngine';
import type { Outcome } from 'harngine/internal';

export interface CodexCliOptions {
  command?: string;
  model?: string;
  timeoutMs?: number;
  /**
   * Explicit provider settings. The CLI runs with user configuration ignored, so embeddings that
   * target a local gateway must pass its connection details here.
   */
  provider?: {
    readonly name: string;
    readonly baseUrl: string;
    readonly wireApi?: 'responses';
    readonly bearerToken?: string;
    readonly headers?: Readonly<Record<string, string>>;
  };
  /** Version observed with `codex --version`; checked before invoking the model. */
  cliVersion: string;
  onCall?: (ordinal: number) => void;
}
const disabled = [
  'shell_tool',
  'apps',
  'plugins',
  'multi_agent',
  'browser_use',
  'computer_use',
  'image_generation',
  'hooks',
  'skill_search',
  'code_mode_host',
  'sleep_tool',
  'view_image',
  'workspace_dependencies',
  'goals',
];
// CLI error items can be nonfatal feature notices (for example disabled Code Mode).
// A failed turn, error event or nonzero exit still rejects the invocation.
const allowedItems = new Set(['agent_message', 'reasoning', 'error']);
const maxBytes = 1024 * 1024;
function tomlInlineTable(value: Readonly<Record<string, string>>) {
  return `{ ${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)} = ${JSON.stringify(item)}`)
    .join(', ')} }`;
}
function environment(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
  for (const name of [
    'HOME',
    'USER',
    'PATH',
    'CODEX_HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
interface ProcessResult {
  ok: boolean;
  reason: string;
  stdout: string;
}
/** No shell interpolation, bounded output/time, abort propagation and tool-use detection. */
function execute(
  command: string,
  args: string[],
  cwd: string,
  input: string,
  signal: AbortSignal,
  timeoutMs: number,
  audit: boolean,
  progress?: (event: ModelProgress) => void,
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<ProcessResult> {
  if (signal.aborted)
    return Promise.resolve({ ok: false, reason: 'aborted_before_start', stdout: '' });
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd,
        env: environment(extraEnvironment),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch {
      resolve({ ok: false, reason: 'cli_unavailable', stdout: '' });
      return;
    }
    let stdout = '';
    let line = '';
    let size = 0;
    let reason = '';
    let force: NodeJS.Timeout | undefined;
    function kill(kind: NodeJS.Signals) {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {}
    }
    function stop(why: string) {
      if (reason) return;
      reason = why;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), 1000);
      force.unref();
    }
    const abort = () => stop('aborted');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      size += Buffer.byteLength(text);
      if (size > maxBytes) {
        stop('output_limit');
        return;
      }
      stdout += text;
      if (audit) {
        line += text;
        let at: number;
        while ((at = line.indexOf('\n')) >= 0) {
          const value = line.slice(0, at);
          line = line.slice(at + 1);
          if (!value.trim()) continue;
          try {
            const event = JSON.parse(value) as { type?: string; item?: { type?: string } };
            if (progress && event.type === 'turn.started') progress({ type: 'started' });
            if (progress && event.type === 'turn.completed') {
              const raw = event as {
                usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
              };
              const usage =
                raw.usage &&
                [raw.usage.input_tokens, raw.usage.output_tokens, raw.usage.total_tokens].every(
                  (value) => value === undefined || (Number.isSafeInteger(value) && value >= 0),
                )
                  ? {
                      inputTokens: raw.usage.input_tokens ?? 0,
                      outputTokens: raw.usage.output_tokens ?? 0,
                      totalTokens:
                        raw.usage.total_tokens ??
                        (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
                    }
                  : undefined;
              progress({ type: 'completed', ...(usage ? { usage } : {}) });
            }
            if (progress && event.type === 'item.completed' && event.item?.type === 'reasoning') {
              const item = event.item as { text?: unknown; summary?: unknown };
              const summary =
                typeof item.text === 'string'
                  ? item.text
                  : typeof item.summary === 'string'
                    ? item.summary
                    : Array.isArray(item.summary)
                      ? item.summary
                          .filter(
                            (part): part is { text: string } =>
                              !!part && typeof part === 'object' && typeof part.text === 'string',
                          )
                          .map((part) => part.text)
                          .join('\n')
                      : '';
              if (summary.trim())
                progress({ type: 'reasoning', text: summary.trim().slice(0, 2000) });
            }
            if (event.item?.type && !allowedItems.has(event.item.type))
              stop(
                `unexpected_cli_item:${event.item.type.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`,
              );
            if (event.type === 'turn.failed' || event.type === 'error') {
              const failure = event as {
                message?: unknown;
                error?: { message?: unknown };
              };
              const detail =
                typeof failure.error?.message === 'string'
                  ? failure.error.message
                  : typeof failure.message === 'string'
                    ? failure.message
                    : '';
              const summary = describeCliFailure(detail);
              stop(summary ? `cli_failure:${summary}` : 'cli_failure');
            }
          } catch {
            stop('invalid_cli_events');
          }
        }
      }
    });
    // Diagnostics may contain sensitive local details; count them but never persist or display them.
    child.stderr.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) stop('output_limit');
    });
    child.stdin.on('error', () => {});
    child.on('error', () => {
      reason = reason || 'cli_unavailable';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (force) clearTimeout(force);
      signal.removeEventListener('abort', abort);
      resolve({ ok: code === 0 && !reason, reason: reason || 'cli_exit', stdout });
    });
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}
function describeCliFailure(message: string) {
  if (/out of credits|credit balance/i.test(message)) return 'workspace out of credits';
  if (/rate limit|too many requests/i.test(message)) return 'rate limit reached';
  if (/usage limit|quota/i.test(message)) return 'usage limit reached';
  if (/auth|log in|login|unauthorized|\b401\b/i.test(message)) return 'authentication required';
  return '';
}
/** Backward compatible names for the shared Harngine model envelope. */
export {
  modelEnvelopeInstructions as codexCliSystemInstructions,
  modelOutputSchema as codexResponseSchema,
  modelResponseContract as responseContract,
  normalizeModelEnvelope as normalizeResponse,
};

export function createCodexCliModel(options: CodexCliOptions) {
  const command = options.command ?? 'codex';
  const timeoutMs = options.timeoutMs ?? 180000;
  const provider = options.provider;
  if (
    provider &&
    (!/^[A-Za-z0-9_-]+$/.test(provider.name) ||
      !URL.canParse(provider.baseUrl) ||
      !['http:', 'https:'].includes(new URL(provider.baseUrl).protocol))
  )
    throw Error('Invalid model provider');
  if (
    !options.cliVersion.trim() ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 600000
  )
    throw Error('Invalid CLI version or timeout');
  const artifactDigest = createHash('sha256')
    .update(
      JSON.stringify({
        profile: provider ? 'structured-v3-explicit-provider' : 'structured-v2-reasoning-summary',
        version: options.cliVersion,
        model: options.model ?? 'cli-default',
        provider: provider
          ? {
              name: provider.name,
              baseUrl: provider.baseUrl,
              wireApi: provider.wireApi ?? 'responses',
            }
          : null,
        timeoutMs,
      }),
    )
    .digest('hex');
  return {
    id: 'harngine.codex-cli',
    version: '1',
    artifactDigest,
    async invoke(input: {
      payload: Json;
      responseSchema: Json;
      ordinal: number;
      signal: AbortSignal;
      progress?: (event: ModelProgress) => void;
    }): Promise<Outcome> {
      if (input.signal.aborted)
        return {
          status: 'failure',
          effect: 'none',
          reason: { code: 'CANCELED', message: 'Canceled before invocation' },
        };
      const directory = await mkdtemp(join(tmpdir(), 'harngine-codex-'));
      try {
        const version = await execute(
          command,
          ['--version'],
          directory,
          '',
          input.signal,
          10000,
          false,
        );
        if (!version.ok || version.stdout.trim() !== options.cliVersion)
          return {
            status: 'failure',
            effect: 'none',
            reason: { code: 'CLI_VERSION', message: 'CLI unavailable or version changed' },
          };
        const output = join(directory, 'response.json'),
          outputSchema = join(directory, 'schema.json'),
          system = join(directory, 'instructions.md');
        await writeFile(outputSchema, JSON.stringify(modelOutputSchema(input.responseSchema)), {
          mode: 0o600,
        });
        await writeFile(system, modelEnvelopeInstructions, { mode: 0o600 });
        const providerTokenName = 'HARNGINE_MODEL_PROVIDER_TOKEN';
        const providerArgs = provider
          ? [
              '-c',
              `model_provider=${JSON.stringify(provider.name)}`,
              '-c',
              `model_providers.${provider.name}.name=${JSON.stringify(provider.name)}`,
              '-c',
              `model_providers.${provider.name}.base_url=${JSON.stringify(provider.baseUrl)}`,
              '-c',
              `model_providers.${provider.name}.wire_api=${JSON.stringify(provider.wireApi ?? 'responses')}`,
              ...(provider.bearerToken
                ? [
                    '-c',
                    `model_providers.${provider.name}.env_key=${JSON.stringify(providerTokenName)}`,
                  ]
                : []),
              ...(provider.headers
                ? [
                    '-c',
                    `model_providers.${provider.name}.http_headers=${tomlInlineTable(provider.headers)}`,
                  ]
                : []),
            ]
          : ['-c', 'forced_login_method="chatgpt"'];
        const args = [
          'exec',
          '--ignore-user-config',
          '--strict-config',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--json',
          '--color',
          'never',
          '-c',
          'approval_policy="never"',
          ...providerArgs,
          '-c',
          'web_search="disabled"',
          '-c',
          'project_doc_max_bytes=0',
          '-c',
          'model_reasoning_summary="auto"',
          '-c',
          `model_instructions_file=${JSON.stringify(system)}`,
          ...disabled.flatMap((f) => ['--disable', f]),
          '--output-schema',
          outputSchema,
          '--output-last-message',
          output,
          ...(options.model ? ['--model', options.model] : []),
          '-',
        ];
        options.onCall?.(input.ordinal);
        const result = await execute(
          command,
          args,
          directory,
          JSON.stringify(input.payload),
          input.signal,
          timeoutMs,
          true,
          input.progress,
          provider?.bearerToken ? { [providerTokenName]: provider.bearerToken } : {},
        );
        if (!result.ok)
          return { status: 'unknown', reason: { code: 'MODEL_UNCERTAIN', message: result.reason } };
        try {
          if ((await stat(output)).size > 256 * 1024) throw Error('Oversized result');
          return { status: 'success', value: JSON.parse(await readFile(output, 'utf8')) as Json };
        } catch {
          return {
            status: 'unknown',
            reason: { code: 'MODEL_RESPONSE', message: 'Invalid or missing model response' },
          };
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

/** Provider-neutral Harngine adapter backed by the locally authenticated Codex CLI. */
export function createCodexCliAdapter(options: CodexCliOptions): ModelAdapter {
  const transport = createCodexCliModel(options);
  let ordinal = 0;
  return {
    id: 'codex-cli',
    capabilities: {
      tools: true,
      structuredOutput: true,
      streaming: false,
      contextWindow: 128_000,
      defaultOutputReserve: 4_000,
    },
    async generate(request, { signal, progress }): Promise<ModelResponse> {
      let usage: ModelResponse['usage'];
      const outcome = await transport.invoke({
        payload: request as unknown as Json,
        responseSchema: modelResponseContract(request),
        ordinal: ++ordinal,
        signal,
        progress(event) {
          if (event.type === 'completed' && event.usage) usage = event.usage;
          progress?.(event);
        },
      });
      if (outcome.status !== 'success')
        throw new Error(outcome.reason.message, { cause: outcome.reason.code });
      return {
        ...normalizeModelEnvelope(outcome.value, request),
        ...(usage ? { usage } : {}),
      };
    },
  };
}

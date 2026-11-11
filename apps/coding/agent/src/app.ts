import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createCodexCliAdapter } from '@harngine/codex-cli';
import { createCodexApiAdapter } from '@harngine/codex-api';
import { agent, createApp, schema, tool, type Json } from 'harngine';

const runFile = promisify(execFile);
export function createCodingApp(options: {
  repo: string;
  writable: boolean;
  modelId?: string;
  requireEditApproval?: boolean;
}) {
  const root = realpathSync(resolve(options.repo));
  const writable = options.writable;
  const modelId = options.modelId;
  const data = resolve(root, '.harngine/coding-agent');
  mkdirSync(data, { recursive: true });
  const editJournal = resolve(data, 'edit-journal');
  mkdirSync(editJournal, { recursive: true, mode: 0o700 });
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const journalPath = (id: string) => {
    if (!/^call_[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid edit operation identity');
    return resolve(editJournal, `${id}.json`);
  };
  const string = { type: 'string', maxLength: 200000 } as const;
  const shape = (properties: Record<string, Json>) =>
    ({
      type: 'object',
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    }) as Json;
  const input = (id: string, jsonSchema: Json) =>
    schema<Json>({ id: `coding.${id}`, version: '1', jsonSchema });
  const output = input('output', string);
  function pathInRepo(path: string, existing: boolean): string {
    if (isAbsolute(path)) throw new Error('Use a relative path');
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (
      !rel ||
      rel === '..' ||
      rel.startsWith(`..${sep}`) ||
      rel === '.git' ||
      rel.startsWith(`.git${sep}`) ||
      rel === '.harngine' ||
      rel.startsWith(`.harngine${sep}`)
    )
      throw new Error('Path is outside the allowed workspace');
    const actual = existing
      ? realpathSync(target)
      : resolve(realpathSync(dirname(target)), target.split(sep).at(-1)!);
    const actualRel = relative(root, actual);
    if (actualRel === '..' || actualRel.startsWith(`..${sep}`))
      throw new Error('Symlink leaves workspace');
    return target;
  }
  const read = tool({
    id: 'coding.read',
    description: 'Read a repository file by relative path.',
    input: input('read', shape({ path: string })),
    output,
    effect: 'read',
    execute(value) {
      return readFileSync(pathInRepo(String((value as { path: string }).path), true), 'utf8').slice(
        0,
        100000,
      );
    },
  });
  const search = tool({
    id: 'coding.search',
    description: 'Search repository text with ripgrep. Query is a literal string.',
    input: input('search', shape({ query: string })),
    output,
    effect: 'read',
    async execute(value) {
      try {
        const { stdout } = await runFile(
          'rg',
          [
            '-n',
            '-F',
            '--glob',
            '!.harngine/**',
            '--',
            String((value as { query: string }).query),
            '.',
          ],
          { cwd: root, timeout: 10000, maxBuffer: 100000 },
        );
        return stdout.slice(0, 100000);
      } catch (error) {
        if ((error as { code?: number }).code === 1) return 'No matches';
        throw error;
      }
    },
  });
  const edit = tool({
    id: 'coding.edit',
    description:
      'Replace one exact text fragment in an existing repository file. oldText must occur exactly once.',
    input: input('edit', shape({ path: string, oldText: string, newText: string })),
    output,
    effect: 'write',
    ...(options.requireEditApproval
      ? { approval: { approvers: ['desktop'], timeoutMs: 24 * 60 * 60 * 1000 } }
      : {}),
    capabilities: { idempotency: 'none', reversibility: 'reversible' },
    execute(value, context) {
      const relativePath = String((value as { path: string }).path);
      let path: string, before: string;
      try {
        path = pathInRepo(relativePath, true);
        before = readFileSync(path, 'utf8');
      } catch (error) {
        return context.fail({
          effect: 'none',
          code: 'EDIT_PRECONDITION',
          message: error instanceof Error ? error.message : 'File cannot be read',
        });
      }
      const oldText = String((value as { oldText: string }).oldText);
      if (!oldText || before.split(oldText).length !== 2)
        return context.fail({
          effect: 'none',
          code: 'EDIT_PRECONDITION',
          message: 'oldText must occur exactly once',
        });
      const after = before.replace(oldText, String((value as { newText: string }).newText));
      try {
        writeFileSync(
          journalPath(context.idempotencyKey),
          JSON.stringify({
            path: relativePath,
            before: digest(before),
            after: digest(after),
          }),
          { mode: 0o600, flag: 'wx', flush: true },
        );
      } catch (error) {
        return context.fail({
          effect: 'none',
          code: 'EDIT_JOURNAL',
          message: error instanceof Error ? error.message : 'Cannot record edit intent',
        });
      }
      writeFileSync(path, after, { flush: true });
      return `Edited ${relativePath}`;
    },
    reconcile(value, context) {
      const relativePath = String((value as { path: string }).path);
      try {
        const journal = JSON.parse(readFileSync(journalPath(context.idempotencyKey), 'utf8')) as {
          path?: string;
          before?: string;
          after?: string;
        };
        if (
          journal.path !== relativePath ||
          !/^[a-f0-9]{64}$/.test(journal.before ?? '') ||
          !/^[a-f0-9]{64}$/.test(journal.after ?? '')
        )
          throw new Error('Invalid edit journal');
        const current = digest(readFileSync(pathInRepo(relativePath, true), 'utf8'));
        if (current === journal.after)
          return { status: 'success', value: `Edited ${relativePath}` };
        if (current === journal.before)
          return {
            status: 'not-applied',
            reason: {
              code: 'EDIT_NOT_APPLIED',
              message: 'The file still matches its pre-edit content',
            },
          };
      } catch {
        /* Missing journal or changed file needs a human decision. */
      }
      return {
        status: 'unknown',
        reason: {
          code: 'EDIT_AMBIGUOUS',
          message: 'The edit journal cannot establish the current file effect',
        },
      };
    },
  });
  const check = tool({
    id: 'coding.check',
    description:
      'Run a repository check using bun, npm, pnpm, yarn, node, or git with an argument array. No shell is used.',
    input: input(
      'check',
      shape({ command: string, args: { type: 'array', items: string, maxItems: 20 } }),
    ),
    output,
    effect: 'write',
    capabilities: { idempotency: 'none', reversibility: 'unknown' },
    async execute(value, context) {
      const command = String((value as { command: string }).command);
      if (!['bun', 'npm', 'pnpm', 'yarn', 'node', 'git'].includes(command))
        throw new Error('Command is not allowed');
      const argv = (value as { args: string[] }).args as string[];
      if (argv.some((part) => typeof part !== 'string' || part.includes('\0')))
        throw new Error('Invalid arguments');
      try {
        const { stdout, stderr } = await runFile(command, argv, {
          cwd: root,
          timeout: 120000,
          maxBuffer: 100000,
        });
        return `${stdout}\n${stderr}`.slice(0, 100000);
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; code?: number };
        return context.fail({
          effect: 'none',
          code: 'CHECK_FAILED',
          message:
            `Exit ${failure.code ?? 'error'}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.slice(
              0,
              100000,
            ),
        });
      }
    },
  });
  const selectedModel = modelId || process.env.CODEX_MODEL;
  const useApi = process.env.HARNGINE_CODING_PROVIDER === 'api';
  const accessToken = useApi ? process.env.CODEX_ACCESS_TOKEN?.trim() : undefined;
  if (useApi && !accessToken)
    throw new Error('HARNGINE_CODING_PROVIDER=api requires CODEX_ACCESS_TOKEN');
  const model = useApi
    ? createCodexApiAdapter({
        accessToken: accessToken!,
        ...(selectedModel ? { model: selectedModel } : {}),
      })
    : createCodexCliAdapter({
        cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(),
        ...(modelId ? { model: modelId } : {}),
        timeoutMs: 180000,
      });
  const task = schema<string>({ id: 'coding.task', version: '1', jsonSchema: string });
  const readAssistant = agent({
    id: 'coding.workspace-read',
    instructions: `You are a coding agent working in ${root}. Inspect files before answering. Use relative paths. Report findings accurately. This session is read only; do not claim to edit.`,
    objective: task,
    model,
    tools: [read, search],
    limits: { modelTurns: 20, toolExecutions: 40 },
  });
  const writeAssistant = agent({
    id: 'coding.workspace-write',
    instructions: `You are a coding agent working in ${root}. Inspect files before proposing changes. Use relative paths. The coding.edit Tool requires exactly three string fields: path, oldText, and newText. Set oldText to one exact, unique fragment copied from the file and newText to its replacement; never omit either field. A desktop reviewer must approve the exact edit before execution. After an approved edit, run a focused coding.check command. Report actual changes and check results accurately.`,
    objective: task,
    model,
    tools: [read, search, edit, check],
    limits: { modelTurns: 20, toolExecutions: 40 },
  });
  const assistant = writable ? writeAssistant : readAssistant;
  const app = createApp({
    directory: data,
    agents: [readAssistant, writeAssistant],
    access: { allowAuthenticated: true },
  });
  return { app, assistant, readAssistant, writeAssistant, root };
}

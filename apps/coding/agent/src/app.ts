import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createCodexCliAdapter } from '@harngine/codex-cli';
import { createOpenAIResponsesAdapter } from '@harngine/codex-api';
import { createClaudeMessagesAdapter } from '@harngine/claude-messages';
import { agent, createApp, schema, tool, workflow, type Json, type ModelAdapter } from 'harngine';

const runFile = promisify(execFile);
export function createCodingApp(options: {
  repo: string;
  writable: boolean;
  modelId?: string;
  /** Override provider selection for embedding and deterministic integration tests. */
  modelAdapter?: ModelAdapter;
  /** Runtime principal used by the desktop or another embedding application. */
  principal?: string;
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
  const provider = process.env.HARNGINE_CODING_PROVIDER;
  const useApi =
    !options.modelAdapter &&
    ['api', 'openai-responses', 'claude-messages'].includes(provider ?? '');
  const accessToken = useApi
    ? (process.env.HARNGINE_CODING_API_TOKEN ?? process.env.CODEX_ACCESS_TOKEN)?.trim()
    : undefined;
  if (useApi && !accessToken)
    throw new Error(
      'HARNGINE_CODING_PROVIDER requires HARNGINE_CODING_API_TOKEN or CODEX_ACCESS_TOKEN',
    );
  if (provider === 'claude-messages' && !selectedModel)
    throw new Error('Claude Messages provider requires CODEX_MODEL');
  const model =
    options.modelAdapter ??
    (provider === 'claude-messages'
      ? createClaudeMessagesAdapter({
          accessToken: accessToken!,
          model: selectedModel!,
          ...(process.env.HARNGINE_CODING_API_BASE_URL
            ? { baseUrl: process.env.HARNGINE_CODING_API_BASE_URL }
            : {}),
        })
      : useApi
        ? createOpenAIResponsesAdapter({
            accessToken: accessToken!,
            ...(process.env.HARNGINE_CODING_API_BASE_URL
              ? { baseUrl: process.env.HARNGINE_CODING_API_BASE_URL }
              : {}),
            ...(selectedModel ? { model: selectedModel } : {}),
          })
        : createCodexCliAdapter({
            cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(),
            ...(modelId ? { model: modelId } : {}),
            timeoutMs: 180000,
          }));
  const task = schema<string>({ id: 'coding.task', version: '1', jsonSchema: string });
  const readAssistant = agent({
    id: 'coding.workspace-read',
    instructions: `You are the researcher specialist for a coding task in ${root}. Inspect files before answering. Use relative paths. Return concrete evidence, relevant file and line references, and risks. This role is read only; do not claim to edit.`,
    objective: task,
    model,
    tools: [read, search],
    limits: { modelTurns: 20, toolExecutions: 40 },
  });
  const writeAssistant = agent({
    id: 'coding.workspace-write',
    instructions: `You are the implementer specialist for a coding task in ${root}. Inspect files before proposing changes. Use relative paths. The coding.edit Tool requires exactly three string fields: path, oldText, and newText. Set oldText to one exact, unique fragment copied from the file and newText to its replacement; never omit either field. A desktop reviewer must approve the exact edit before execution. After an approved edit, run a focused coding.check command. Report actual changes and check results accurately.`,
    objective: task,
    model,
    tools: [read, search, edit, check],
    limits: { modelTurns: 20, toolExecutions: 40 },
  });
  const reviewer = agent({
    id: 'coding.reviewer',
    instructions: `You are the reviewer specialist for a coding task in ${root}. Inspect the supplied evidence and relevant repository files. Focus on correctness, security, compatibility, missing tests, and actionable risks. Use relative paths. This role is read only and must not claim to edit.`,
    objective: task,
    model,
    tools: [read, search],
    limits: { modelTurns: 16, toolExecutions: 32 },
  });
  const orchestrator = agent({
    id: 'coding.orchestrator',
    instructions: `You are the coding orchestrator for ${root}. Solve the task using recorded repository evidence. You may delegate focused research, implementation, or review to the explicitly exposed specialists, then synthesize their results. Use relative paths and report actual changes and checks accurately. Never claim work the recorded outcomes do not support.`,
    objective: task,
    model,
    tools: writable ? [read, search, edit, check] : [read, search],
    delegates: [
      {
        target: readAssistant,
        description: 'Research repository evidence and constraints for a bounded subtask.',
      },
      ...(writable
        ? [
            {
              target: writeAssistant,
              description:
                'Implement a bounded repository change through approved, recoverable Tools.',
            },
          ]
        : []),
      {
        target: reviewer,
        description: 'Review evidence or a proposed change for correctness and concrete risks.',
        mode: 'concurrent' as const,
      },
    ],
    limits: { modelTurns: 24, toolExecutions: 48, childWork: 8 },
  });
  const collaborativeReview = workflow({
    id: 'coding.collaborative-review',
    objective: task,
    result: task,
    children: [readAssistant, reviewer],
    async run(objective, flow) {
      const research = await flow.start(
        'research',
        readAssistant,
        `Collect repository evidence for: ${objective}`,
      );
      const review = await flow.call(
        'review',
        reviewer,
        `Review the likely implementation and risks for: ${objective}`,
      );
      const evidence = await flow.join('research-complete', research);
      return `Research:\n${evidence}\n\nReview:\n${review}`;
    },
  });
  const assistant = orchestrator;
  const app = createApp({
    directory: data,
    agents: [orchestrator, readAssistant, writeAssistant, reviewer],
    workflows: [collaborativeReview],
    access: { allowAuthenticated: true },
    ...(options.principal ? { principal: options.principal } : {}),
  });
  return {
    app,
    assistant,
    orchestrator,
    readAssistant,
    writeAssistant,
    reviewer,
    collaborativeReview,
    root,
  };
}

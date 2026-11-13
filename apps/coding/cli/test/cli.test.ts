import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createCodingApp } from '@harngine/coding-agent';
import type { Json, ModelAdapter, ModelRequest } from 'harngine';
import { runCodingWork } from '../src/runner.js';

const roots: string[] = [];
const apps: ReturnType<typeof createCodingApp>[] = [];

afterEach(async () => {
  for (const coding of apps.splice(0)) await coding.app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-coding-cli-')));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}

function hasOutcome(request: ModelRequest, tool: string, status?: 'success' | 'failure') {
  return request.context.items.some(
    (item) =>
      item.type === 'tool_outcome' &&
      item.call.tool.id === tool &&
      (!status || item.outcome.status === status),
  );
}

function final(text: string): Json {
  return {
    object: 'model_response',
    items: [{ type: 'text', text }],
    finishReason: 'stop',
  };
}

function editModel(): ModelAdapter {
  return {
    id: 'coding-cli-edit-fixture',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      if (!hasOutcome(request, 'coding.edit')) {
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'edit-note',
              tool: 'coding.edit',
              input: { path: 'note.txt', oldText: 'before', newText: 'after' },
            },
          ],
          finishReason: 'tool-calls',
        } as never;
      }
      return final(
        hasOutcome(request, 'coding.edit', 'success') ? 'Updated note.' : 'Edit denied.',
      ) as never;
    },
  };
}

test('CLI shows the exact edit and applies it only after approval', async () => {
  const root = repository({ 'note.txt': 'before\n' });
  const coding = createCodingApp({
    repo: root,
    writable: true,
    principal: 'cli',
    requireEditApproval: true,
    modelAdapter: editModel(),
  });
  apps.push(coding);
  const session = await coding.app.sessions.create({
    agent: coding.writeAssistant,
    title: 'Approval test',
  });
  const { work } = await session.send('Change before to after.');
  const prompts: string[] = [];
  const progress: string[] = [];

  const result = await runCodingWork(work, {
    approval: 'ask',
    ask: async (prompt) => {
      prompts.push(prompt);
      return 'yes';
    },
    progress: (line) => progress.push(line),
  });

  const displayed = [...progress, ...prompts].join('\n');
  expect(displayed).toContain('File: note.txt');
  expect(displayed).toContain('- before');
  expect(displayed).toContain('+ after');
  expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('after\n');
  expect(result.result).toBe('Updated note.');
  expect(progress).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Approved exact edit'),
      expect.stringContaining('Edit note.txt'),
    ]),
  );
});

test('denying an exact edit leaves the repository unchanged', async () => {
  const root = repository({ 'note.txt': 'before\n' });
  const coding = createCodingApp({
    repo: root,
    writable: true,
    principal: 'cli',
    requireEditApproval: true,
    modelAdapter: editModel(),
  });
  apps.push(coding);
  const session = await coding.app.sessions.create({
    agent: coding.writeAssistant,
    title: 'Denial test',
  });
  const { work } = await session.send('Change before to after.');
  const progress: string[] = [];

  const result = await runCodingWork(work, {
    approval: 'ask',
    ask: async () => '',
    progress: (line) => progress.push(line),
  });

  expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('before\n');
  expect(result.result).toBe('Edit denied.');
  expect(progress).toContain('Denied exact edit');
});

test('runner keeps reasoning summaries transient unless explicitly requested', async () => {
  const root = repository({ 'README.md': 'Reasoning visibility fixture\n' });
  const reasoning = 'Checking the repository before answering.';
  const coding = createCodingApp({
    repo: root,
    writable: false,
    principal: 'cli',
    modelAdapter: {
      id: 'coding-cli-reasoning-fixture',
      capabilities: { tools: true, structuredOutput: false, streaming: false },
      async generate(_request, context) {
        context.progress?.({ type: 'reasoning', text: reasoning });
        return final('Reasoning fixture answer.') as never;
      },
    },
  });
  apps.push(coding);
  const session = await coding.app.sessions.create({
    agent: coding.readAssistant,
    title: 'Reasoning visibility test',
  });

  const hiddenProgress: string[] = [];
  const hiddenActivity: string[] = [];
  const hidden = await session.send('Answer without exposing reasoning.');
  await runCodingWork(hidden.work, {
    progress: (line) => hiddenProgress.push(line),
    activity: (state) => {
      if (state.detail) hiddenActivity.push(state.detail);
    },
  });

  expect(hiddenProgress).not.toContain(`Thinking · ${reasoning}`);
  expect(hiddenActivity).toContain(reasoning);

  const visibleProgress: string[] = [];
  const visible = await session.send('Answer and show reasoning.');
  await runCodingWork(visible.work, {
    progress: (line) => visibleProgress.push(line),
    showThinking: true,
  });

  expect(visibleProgress).toContain(`Thinking · ${reasoning}`);
});

test('runner reports Tool lifecycle and preserves a resumable Session', async () => {
  const root = repository({ 'README.md': 'Harngine CLI evidence\n' });
  let turns = 0;
  const model: ModelAdapter = {
    id: 'coding-cli-read-fixture',
    capabilities: { tools: true, structuredOutput: false, streaming: true },
    async generate(request, context) {
      turns++;
      const outcome = request.context.items.find(
        (
          item,
        ): item is Extract<ModelRequest['context']['items'][number], { type: 'tool_outcome' }> =>
          item.type === 'tool_outcome' && item.call.tool.id === 'coding.read',
      );
      if (!outcome) {
        context.emit({ type: 'text', text: 'I will inspect the README.' });
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'readme',
              tool: 'coding.read',
              input: { path: 'README.md' },
            },
          ],
          finishReason: 'tool-calls',
        } as never;
      }
      const text = String(outcome.outcome.status === 'success' ? outcome.outcome.value : '').trim();
      context.progress?.({ type: 'reasoning', text: 'Checking the README evidence.' });
      context.emit({ type: 'text', text });
      return final(text) as never;
    },
  };
  const first = createCodingApp({
    repo: root,
    writable: false,
    principal: 'cli',
    modelAdapter: model,
  });
  apps.push(first);
  const session = await first.app.sessions.create({
    agent: first.readAssistant,
    title: 'Resume test',
  });
  const sent = await session.send('Read README.md.');
  const progress: string[] = [];
  const activity: { status: string; detail?: string }[] = [];
  const toolEvents: { label: string; phase: string }[] = [];

  const result = await runCodingWork(sent.work, {
    approval: 'deny',
    progress: (line) => progress.push(line),
    activity: (state) => activity.push(state),
    toolProgress: (event) => toolEvents.push({ label: event.label, phase: event.phase }),
    showThinking: true,
  });

  expect(result.result).toBe('Harngine CLI evidence');
  expect(result.streamedText).toBe('');
  expect(activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ detail: 'I will inspect the README.' }),
      expect.objectContaining({ detail: 'Harngine CLI evidence' }),
    ]),
  );
  expect(toolEvents).toEqual([
    { label: 'Read README.md', phase: 'started' },
    { label: 'Read README.md', phase: 'succeeded' },
  ]);
  expect(progress).toEqual(expect.arrayContaining(['Thinking · Checking the README evidence.']));
  expect(activity).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'idle' })]));
  expect(turns).toBe(2);
  await first.app.close();
  apps.splice(apps.indexOf(first), 1);

  const restored = createCodingApp({
    repo: root,
    writable: false,
    principal: 'cli',
    modelAdapter: {
      ...model,
      async generate() {
        return final('Resumed without replaying the previous Tool.') as never;
      },
    },
  });
  apps.push(restored);
  const resumed = await restored.app.sessions.get(session.id);
  expect((await resumed.snapshot()).status).toBe('open');
  const next = await resumed.send('Continue.');
  await expect(next.work.result()).resolves.toBe('Resumed without replaying the previous Tool.');
});

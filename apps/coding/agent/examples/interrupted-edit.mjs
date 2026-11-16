import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodingApp } from '@harngine/coding-agent';

const root =
  process.env.HARNGINE_CODING_DEMO_ROOT ??
  realpathSync(mkdtempSync(join(tmpdir(), 'harngine-coding-demo-')));
const file = join(root, 'tokens.ts');
const before =
  'export function canRefresh(family) {\n  if (family.revoked) return true;\n  return true;\n}\n';
const after = before.replace(
  'if (family.revoked) return true;',
  'if (family.revoked) return false;',
);

function model(restarted) {
  return {
    id: 'coding-interruption-demo',
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request) {
      const editSettled = request.context.items.some(
        (item) => item.type === 'tool_outcome' && item.call.tool.id === 'coding.edit',
      );
      if (editSettled) {
        if (!restarted) await new Promise(() => {});
        return {
          object: 'model_response',
          items: [{ type: 'text', text: 'The revoked family now returns false.' }],
          finishReason: 'stop',
        };
      }
      return {
        object: 'model_response',
        items: [
          {
            type: 'tool-call',
            providerCallId: 'fix-revoked-family',
            tool: 'coding.edit',
            input: {
              path: 'tokens.ts',
              oldText: 'if (family.revoked) return true;',
              newText: 'if (family.revoked) return false;',
            },
          },
        ],
        finishReason: 'tool-calls',
      };
    },
  };
}

async function waitFor(check, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

if (process.argv[2] === 'worker') {
  const coding = createCodingApp({
    repo: root,
    writable: true,
    principal: 'cli',
    requireEditApproval: true,
    modelAdapter: model(false),
  });
  const session = await coding.app.sessions.create({
    agent: coding.writeAssistant,
    title: 'Fix revoked refresh',
  });
  const { work } = await session.send('Fix the revoked family branch.');
  const approval = await waitFor(
    async () => (await work.snapshot()).interactions.find((item) => item.type === 'approval'),
    'edit approval',
  );
  process.send?.({
    type: 'approval',
    workId: work.id,
    sessionId: session.id,
    details: approval.details,
  });
  process.once('message', async (message) => {
    if (message !== 'approve') return;
    await work.respond(approval.id, true);
    await waitFor(async () => {
      const inspection = await work.inspect({ detail: 'diagnostic' });
      return inspection.entries.some(
        (entry) =>
          entry.type === 'call' && entry.tool.id === 'coding.edit' && entry.phase === 'settled',
      );
    }, 'settled edit');
    process.send?.({ type: 'edit-settled' });
  });
} else {
  writeFileSync(file, before);
  const child = fork(import.meta.filename, ['worker'], {
    env: { ...process.env, HARNGINE_CODING_DEMO_ROOT: root },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  try {
    const [approval] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
    assert.equal(approval?.type, 'approval');
    assert.equal(readFileSync(file, 'utf8'), before);
    console.log(`Proposed edit: ${approval.details.oldText} → ${approval.details.newText}`);
    child.send('approve');
    const [settled] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
    assert.equal(settled?.type, 'edit-settled');
    assert.equal(readFileSync(file, 'utf8'), after);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    console.log('Killed the coding process after the approved edit, before its final reply.');

    const coding = createCodingApp({
      repo: root,
      writable: true,
      principal: 'cli',
      requireEditApproval: true,
      modelAdapter: model(true),
    });
    try {
      const work = await coding.app.works.get(approval.workId);
      const result = await work.result({ signal: AbortSignal.timeout(10_000) });
      const inspection = await work.inspect({ detail: 'diagnostic' });
      const edits = inspection.entries.filter(
        (entry) => entry.type === 'call' && entry.tool.id === 'coding.edit',
      );
      assert.equal(readFileSync(file, 'utf8'), after);
      assert.equal(result, 'The revoked family now returns false.');
      assert.equal(edits.filter((entry) => entry.phase === 'settled').length, 1);
      console.log(`Recovered Work ${work.id}: ${result}`);
      console.log(`Edit call phases: ${edits.map((entry) => entry.phase).join(' → ')}`);
      console.log(`Saved Session: ${approval.sessionId}`);
      console.log(`Evidence directory: ${root}`);
    } finally {
      await coding.app.close();
    }
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

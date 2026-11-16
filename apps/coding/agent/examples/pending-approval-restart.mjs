import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodingApp } from '@harngine/coding-agent';

const root =
  process.env.HARNGINE_CODING_DEMO_ROOT ??
  realpathSync(mkdtempSync(join(tmpdir(), 'harngine-approval-demo-')));
const source = join(root, 'tokens.js');
const before =
  'export function canRefresh(family) {\n  if (family.revoked) return true;\n  return true;\n}\n';
const after = before.replace(
  'if (family.revoked) return true;',
  'if (family.revoked) return false;',
);

const model = {
  id: 'coding-approval-restart-demo',
  capabilities: { tools: true, structuredOutput: false, streaming: false },
  async generate(request) {
    const called = (id) =>
      request.context.items.some(
        (item) => item.type === 'tool_outcome' && item.call.tool.id === id,
      );
    const call = (tool, input) => ({
      object: 'model_response',
      items: [{ type: 'tool-call', providerCallId: tool, tool, input }],
      finishReason: 'tool-calls',
    });
    if (!called('coding.read')) return call('coding.read', { path: 'tokens.test.js' });
    if (!called('coding.edit'))
      return call('coding.edit', {
        path: 'tokens.js',
        oldText: 'if (family.revoked) return true;',
        newText: 'if (family.revoked) return false;',
      });
    if (!called('coding.check'))
      return call('coding.check', {
        command: 'node',
        args: ['--test', 'tokens.test.js'],
      });
    return {
      object: 'model_response',
      items: [{ type: 'text', text: 'The revoked-family test now passes.' }],
      finishReason: 'stop',
    };
  },
};

async function waitFor(check, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function openCoding() {
  return createCodingApp({
    repo: root,
    writable: true,
    principal: 'cli',
    requireEditApproval: true,
    modelAdapter: model,
  });
}

if (process.argv[2] === 'worker') {
  const coding = openCoding();
  const session = await coding.app.sessions.create({
    agent: coding.writeAssistant,
    title: 'Fix revoked refresh',
  });
  const { work } = await session.send('Fix the revoked-family test and run it.');
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
} else {
  writeFileSync(source, before);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(root, 'tokens.test.js'),
    "import { test } from 'node:test';\nimport { strict as assert } from 'node:assert';\nimport { canRefresh } from './tokens.js';\ntest('revoked families cannot refresh', () => assert.equal(canRefresh({ revoked: true }), false));\ntest('active families can refresh', () => assert.equal(canRefresh({ revoked: false }), true));\n",
  );
  const child = fork(import.meta.filename, ['worker'], {
    env: { ...process.env, HARNGINE_CODING_DEMO_ROOT: root },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  try {
    const [pending] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
    assert.equal(pending?.type, 'approval');
    assert.equal(readFileSync(source, 'utf8'), before);
    console.log(`Approval waiting: ${pending.details.oldText} → ${pending.details.newText}`);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    console.log('Killed the process before approving; the file is unchanged.');

    const coding = openCoding();
    try {
      const work = await coding.app.works.get(pending.workId);
      const approval = await waitFor(
        async () => (await work.snapshot()).interactions.find((item) => item.type === 'approval'),
        'restored approval',
      );
      assert.deepEqual(approval.details, pending.details);
      assert.equal(readFileSync(source, 'utf8'), before);
      console.log(`Reopened the same Work: approval is still waiting.`);
      await work.respond(approval.id, true);
      const result = await work.result({ signal: AbortSignal.timeout(10_000) });
      const inspection = await work.inspect({ detail: 'diagnostic' });
      const settled = inspection.entries.filter(
        (entry) => entry.type === 'call' && entry.phase === 'settled',
      );
      assert.equal(readFileSync(source, 'utf8'), after);
      assert.equal(result, 'The revoked-family test now passes.');
      assert.equal(settled.filter((entry) => entry.tool.id === 'coding.edit').length, 1);
      const checks = settled.filter((entry) => entry.tool.id === 'coding.check');
      assert.equal(checks.length, 1);
      assert.equal(checks[0].diagnostic?.outcome?.status, 'success');
      assert.match(String(checks[0].diagnostic?.outcome?.value), /# pass 2/);
      console.log(`Approved after restart: ${result}`);
      console.log(`Settled calls: ${settled.map((entry) => entry.tool.id).join(' → ')}`);
      console.log(`Saved Session: ${pending.sessionId}`);
      console.log(`Evidence directory: ${root}`);
    } finally {
      await coding.app.close();
    }
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

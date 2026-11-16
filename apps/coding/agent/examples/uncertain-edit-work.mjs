import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, schema, tool, workflow } from 'harngine';

// A fixed failure point makes the lost receipt repeatable. The Work and its
// reconciliation are real; the failure is deliberately injected for this demo.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-uncertain-edit-')));
const file = join(root, 'tokens.js');
const journal = join(root, 'edit-journal.json');
const before = 'if (family.revoked) return true;\n';
const after = 'if (family.revoked) return false;\n';
writeFileSync(file, before);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const text = schema({ id: 'demo.text', version: '1', jsonSchema: { type: 'string' } });
let allowLookup;
const lookupAllowed = new Promise((resolve) => {
  allowLookup = resolve;
});
let lookups = 0;
let writes = 0;

const edit = tool({
  id: 'demo.edit',
  input: text,
  output: text,
  effect: 'write',
  capabilities: { idempotency: 'none', reversibility: 'reversible' },
  execute(replacement, context) {
    writes++;
    const original = readFileSync(file, 'utf8');
    assert.equal(original, before);
    writeFileSync(
      journal,
      JSON.stringify({
        key: context.idempotencyKey,
        before: hash(original),
        after: hash(replacement),
      }),
      { flush: true },
    );
    writeFileSync(file, replacement, { flush: true });
    return context.effectUnknown({
      code: 'LOST_EDIT_RECEIPT',
      message: 'Simulated loss of the result after the file changed',
    });
  },
  async reconcile(_replacement, context) {
    lookups++;
    await lookupAllowed;
    const record = JSON.parse(readFileSync(journal, 'utf8'));
    assert.equal(record.key, context.idempotencyKey);
    const current = hash(readFileSync(file, 'utf8'));
    if (current === record.after) return { status: 'success', value: 'Edit applied' };
    if (current === record.before)
      return {
        status: 'not-applied',
        reason: { code: 'EDIT_ABSENT', message: 'File matches its original content' },
      };
    return {
      status: 'unknown',
      reason: { code: 'EDIT_AMBIGUOUS', message: 'File matches neither journal hash' },
    };
  },
});
const task = workflow({
  id: 'demo.fix-revoked-family',
  objective: text,
  result: text,
  tools: [edit],
  run: (replacement, flow) => flow.call('edit', edit, replacement),
});
const app = createApp({ directory: join(root, 'work'), workflows: [task] });
try {
  const work = await app.start(task, after);
  let uncertain;
  for (let n = 0; n < 200; n++) {
    const inspection = await work.inspect({ detail: 'diagnostic' });
    uncertain = inspection.entries.find(
      (entry) => entry.type === 'call' && entry.tool.id === edit.id && entry.phase === 'uncertain',
    );
    if (uncertain) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(uncertain, 'Expected a durable uncertain edit Call');
  assert.equal(readFileSync(file, 'utf8'), after);
  assert.equal(writes, 1);
  console.log(`File changed; Call ${uncertain.callId} records an unknown outcome.`);
  allowLookup();
  assert.equal(await work.result({ signal: AbortSignal.timeout(10000) }), 'Edit applied');
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const resolved = inspection.entries.find(
    (entry) =>
      entry.type === 'call' && entry.callId === uncertain.callId && entry.phase === 'resolved',
  );
  assert.ok(resolved, 'Expected the same Call to be resolved');
  assert.equal(writes, 1);
  assert.equal(lookups, 1);
  console.log(`Read-only lookup resolved Call ${uncertain.callId}: edit applied.`);
  console.log(`Write attempts: ${writes}; reconciliation lookups: ${lookups}.`);
  console.log(`Evidence directory: ${root}`);
} finally {
  allowLookup();
  await app.close();
}

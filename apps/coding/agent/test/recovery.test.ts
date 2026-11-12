import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { ModelAdapter } from 'harngine';
import { createCodingApp } from '../src/app.js';

const roots: string[] = [];
const model: ModelAdapter = {
  id: 'coding-recovery-fixture',
  capabilities: { tools: true, structuredOutput: false, streaming: false },
  async generate() {
    throw new Error('The recovery test does not run model turns');
  },
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('coding edit journal reconciles applied, absent, and ambiguous file effects', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-edit-recovery-')));
  roots.push(root);
  const file = join(root, 'note.txt');
  writeFileSync(file, 'before\n');
  const { app, writeAssistant } = createCodingApp({
    repo: root,
    writable: true,
    modelAdapter: model,
  });
  let reopened: ReturnType<typeof createCodingApp> | undefined;
  try {
    const edit = writeAssistant.tools.find((tool) => tool.id === 'coding.edit');
    if (!edit || !('execute' in edit) || !edit.reconcile)
      throw new Error('Edit reconciliation unavailable');
    const input = { path: 'note.txt', oldText: 'before', newText: 'after' };
    const key = 'call_abcdefgh123';
    const context = {
      signal: new AbortController().signal,
      idempotencyKey: key,
      fail(error: { message: string }): never {
        throw new Error(error.message);
      },
      effectUnknown(error: { message: string }): never {
        throw new Error(error.message);
      },
    };
    expect(() => edit.execute({ ...input, oldText: 'missing' }, context)).toThrow(
      'oldText must occur exactly once',
    );
    expect(readFileSync(file, 'utf8')).toBe('before\n');
    expect(await edit.execute(input, context)).toBe('Edited note.txt');
    expect(readFileSync(file, 'utf8')).toBe('after\n');
    await app.close();
    reopened = createCodingApp({ repo: root, writable: true, modelAdapter: model });
    const recoveredEdit = reopened.writeAssistant.tools.find((tool) => tool.id === 'coding.edit');
    if (!recoveredEdit?.reconcile) throw new Error('Recovered edit Tool unavailable');
    expect(
      await recoveredEdit.reconcile(input, {
        signal: context.signal,
        idempotencyKey: key,
        attemptId: 'attempt_test',
      }),
    ).toEqual({ status: 'success', value: 'Edited note.txt' });
    writeFileSync(file, 'before\n');
    expect(
      await recoveredEdit.reconcile(input, {
        signal: context.signal,
        idempotencyKey: key,
        attemptId: 'attempt_test',
      }),
    ).toMatchObject({ status: 'not-applied' });
    writeFileSync(file, 'someone changed this\n');
    expect(
      await recoveredEdit.reconcile(input, {
        signal: context.signal,
        idempotencyKey: key,
        attemptId: 'attempt_test',
      }),
    ).toMatchObject({ status: 'unknown' });
  } finally {
    await reopened?.app.close();
    await app.close();
  }
});

import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  createApp,
  guardrail,
  schema,
  type App,
  type ModelAdapter,
  type StateStoreBackend,
} from '../src/index.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-state-store-')));
  directories.push(value);
  return value;
}

const text = schema<string>({
  id: 'state-store-text',
  version: '1',
  jsonSchema: { type: 'string' },
});

function model(backend: StateStoreBackend): ModelAdapter {
  return {
    id: `state-store-model-${backend}`,
    capabilities: { tools: false, structuredOutput: true, streaming: false },
    async generate() {
      return {
        object: 'model_response',
        items: [{ type: 'data', value: 'durable result' }],
        finishReason: 'stop',
      };
    },
  };
}

test.each(['better-sqlite3', 'node-sqlite'] as const)(
  '%s backend preserves ownership, receipts, Work state, and guardrail history across restart',
  async (backend) => {
    const path = directory();
    const definition =
      backend === 'better-sqlite3'
        ? agent({
            id: 'state-store-agent-better-sqlite3',
            instructions: 'Return the durable result.',
            objective: text,
            result: text,
            publish: (value) => value,
            model: model(backend),
            guardrails: [
              guardrail({
                id: `state-store-allow-${backend}`,
                revision: 'rev_state_store_allow_v1',
                stages: ['model-input'],
                check: () => ({ action: 'allow' }),
              }),
            ],
          })
        : agent({
            id: 'state-store-agent-node-sqlite',
            instructions: 'Return the durable result.',
            objective: text,
            result: text,
            publish: (value) => value,
            model: model(backend),
            guardrails: [
              guardrail({
                id: `state-store-allow-${backend}`,
                revision: 'rev_state_store_allow_v1',
                stages: ['model-input'],
                check: () => ({ action: 'allow' }),
              }),
            ],
          });
    let first: App | undefined;
    let restored: App | undefined;
    try {
      first = createApp({
        directory: path,
        agents: [definition],
        stateStore: { backend },
      });
      expect(first.storage).toMatchObject({
        engine: 'sqlite',
        backend,
        durability: 'full',
        transactions: 'atomic',
        ownership: 'exclusive',
        ownershipFencing: true,
        idempotentReceipts: true,
        inspectableHistory: true,
      });
      expect(() =>
        createApp({
          directory: path,
          agents: [definition],
          stateStore: { backend },
        }),
      ).toThrowError(/ownership/i);
      const work = await first.start(definition, 'input', { idempotencyKey: 'restart-request' });
      await expect(work.result()).resolves.toBe('durable result');
      await first.close();
      first = undefined;

      restored = createApp({
        directory: path,
        agents: [definition],
        stateStore: { backend },
      });
      expect(restored.storage.backend).toBe(backend);
      const same = await restored.start(definition, 'input', {
        idempotencyKey: 'restart-request',
      });
      expect(same.id).toBe(work.id);
      await expect(same.result()).resolves.toBe('durable result');
      await expect(same.snapshot()).resolves.toMatchObject({
        status: 'completed',
        objective: 'input',
      });
      const inspection = await same.inspect({ detail: 'diagnostic' });
      expect(inspection.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'guardrail',
            stage: 'model-input',
            action: 'allow',
            guardrail: expect.objectContaining({
              id: `state-store-allow-${backend}`,
              revision: 'rev_state_store_allow_v1',
            }),
          }),
          expect.objectContaining({ type: 'work.closed', status: 'completed' }),
        ]),
      );
    } finally {
      if (first) await first.close();
      if (restored) await restored.close();
    }
  },
);

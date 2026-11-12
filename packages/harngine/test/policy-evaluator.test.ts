import { expect, test } from 'vitest';
import { PolicyEvaluator } from '../src/internal/policy-evaluator.js';

test('PolicyEvaluator provides the explicit legacy-permissive embedded policy', async () => {
  const policy = new PolicyEvaluator();
  expect(policy.revision).toBe('legacy-permissive');
  expect(
    await policy.canStart({
      principal: 'owner',
      definition: { id: 'flow', version: '1' },
      objective: null,
    }),
  ).toBe(true);
  expect(
    policy.canCall({
      principal: 'owner',
      workId: 'work_test' as never,
      target: { kind: 'tool', id: 'tool', version: '1' },
      tool: { id: 'tool', version: '1' },
      input: null,
    }),
  ).toBe(true);
});

test('PolicyEvaluator delegates async application policy with its immutable revision', async () => {
  const seen: string[] = [];
  const policy = new PolicyEvaluator({
    revision: 'policy-7',
    canStart: async ({ principal }) => {
      seen.push(`start:${principal}`);
      return false;
    },
    canCall: ({ principal }) => {
      seen.push(`call:${principal}`);
      return true;
    },
    canRespond: async ({ principal }) => {
      seen.push(`respond:${principal}`);
      return true;
    },
  });

  expect(policy.revision).toBe('policy-7');
  await expect(
    policy.canStart({
      principal: 'guest',
      definition: { id: 'flow', version: '1' },
      objective: null,
    }),
  ).resolves.toBe(false);
  expect(
    policy.canCall({
      principal: 'owner',
      workId: 'work_test' as never,
      target: { kind: 'tool', id: 'tool', version: '1' },
      tool: { id: 'tool', version: '1' },
      input: null,
    }),
  ).toBe(true);
  await expect(
    policy.canRespond({
      principal: 'reviewer',
      workId: 'work_test' as never,
      interactionId: 'wait-1',
    }),
  ).resolves.toBe(true);
  expect(seen).toEqual(['start:guest', 'call:owner', 'respond:reviewer']);
});

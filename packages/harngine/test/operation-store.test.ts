import { afterEach, expect, test } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  requestId,
  type Json,
  type Outcome,
  type Policy,
  type WorkId,
} from '../src/internal/contracts.js';
import { OperationStore } from '../src/internal/operation-store.js';
import { SqliteStore } from '../src/internal/store.js';

const stores: SqliteStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(
  options: { workToken?: string; operationToken?: string; policy?: Partial<Policy> } = {},
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-operation-store-')));
  directories.push(directory);
  const store = new SqliteStore(directory, () => 100);
  stores.push(store);
  const workToken = options.workToken ?? 'control-current';
  const operationToken = options.operationToken ?? workToken;
  const policy: Policy = {
    maxDecisions: 4,
    maxAttempts: 2,
    ...options.policy,
  };
  store.write(() => {
    store.db
      .prepare(
        `INSERT INTO work
         (id,principal,definition,objective,state,policy,status,eligible,control_token,context)
         VALUES(?,?,?,?,?,?,'active',1,?,?)`,
      )
      .run(
        'work-1',
        'owner',
        JSON.stringify({ id: 'workflow', version: '1' }),
        '1',
        '0',
        JSON.stringify(policy),
        workToken,
        '[]',
      );
    store.db
      .prepare('INSERT INTO decisions(work_id,sequence,body) VALUES(?,?,?)')
      .run('work-1', 1, JSON.stringify({ type: 'call' }));
    store.db
      .prepare(
        `INSERT INTO requests
         (id,work_id,decision_sequence,slot,tool,input,status,outcome,objective_revision,control_token)
         VALUES(?,?,?,?,?,?,'planned',NULL,1,?)`,
      )
      .run(
        'operation-1',
        'work-1',
        1,
        'action',
        JSON.stringify({ id: 'tool', version: '1' }),
        '1',
        operationToken,
      );
    store.db.prepare('INSERT INTO operations VALUES(?)').run('operation-1');
  });
  return { directory, store, operations: new OperationStore(store) };
}

const authorization = {
  principal: 'owner',
  policyRevision: 'policy-1',
  tool: { id: 'tool', version: '1' } as { id: string; version: string } & Json,
  input: 1 as const,
};

function admit(operations: OperationStore, attemptId = 'attempt-1') {
  return operations.admitAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId,
    modelTurn: false,
    approvalRequired: false,
    authorized: authorization,
    now: 100,
  });
}

test('admission rejects stale operation authority without spending capacity', () => {
  const { store, operations } = fixture({ operationToken: 'control-stale' });

  expect(admit(operations)).toEqual({ admitted: false });
  expect(store.requests('work-1')[0]?.status).toBe('planned');
  expect(store.work('work-1')).toMatchObject({ spent: 0, status: 'active', eligible: 1 });
  expect(store.db.prepare('SELECT * FROM attempts').all()).toEqual([]);
  expect(store.authorizations('work-1')).toEqual([]);
});

test('admission atomically fences Work and records authority before invocation', () => {
  const { store, operations } = fixture();

  expect(admit(operations)).toEqual({ admitted: true, sequence: 1 });
  expect(store.requests('work-1')[0]?.status).toBe('admitted');
  expect(store.work('work-1')).toMatchObject({
    spent: 1,
    tool_executions: 1,
    status: 'waiting',
    eligible: 0,
  });
  expect(store.db.prepare('SELECT status,owner_epoch FROM attempts').get()).toEqual({
    status: 'admitted',
    owner_epoch: store.epoch,
  });
  expect(store.authorizations('work-1')).toMatchObject([
    { action: 'call', allowed: true, targetId: 'operation-1' },
  ]);
});

test('admission storage failure rolls back capacity, authority and Work state together', () => {
  const { store, operations } = fixture();
  store.db.exec(
    "CREATE TRIGGER reject_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'injected admission failure'); END;",
  );

  expect(() => admit(operations)).toThrow('injected admission failure');
  expect(store.requests('work-1')[0]?.status).toBe('planned');
  expect(store.work('work-1')).toMatchObject({
    spent: 0,
    tool_executions: 0,
    status: 'active',
    eligible: 1,
  });
  expect(store.db.prepare('SELECT * FROM attempts').all()).toEqual([]);
  expect(store.db.prepare('SELECT * FROM capacity_entries').all()).toEqual([]);
  expect(store.authorizations('work-1')).toEqual([]);
});

test('only a conclusive no-effect failure plans a retry', () => {
  const { store, operations } = fixture();
  admit(operations);
  const noEffect: Outcome = {
    status: 'failure',
    effect: 'none',
    reason: { code: 'TEMPORARY', message: 'Try again' },
  };

  expect(
    operations.settleAttempt({
      workId: 'work-1',
      operationId: 'operation-1',
      attemptId: 'attempt-1',
      outcome: noEffect,
      retryMaxAttempts: 2,
      approvalRequired: false,
    }),
  ).toEqual({ retryPlanned: true, sequence: 1 });
  expect(store.requests('work-1')[0]).toMatchObject({ status: 'planned', outcome: null });
  expect(store.work('work-1')).toMatchObject({ status: 'active', eligible: 1, concern: null });

  admit(operations, 'attempt-2');
  const unknown: Outcome = {
    status: 'unknown',
    reason: { code: 'LOST', message: 'Outcome was lost' },
  };
  expect(
    operations.settleAttempt({
      workId: 'work-1',
      operationId: 'operation-1',
      attemptId: 'attempt-2',
      outcome: unknown,
      retryMaxAttempts: 3,
      approvalRequired: false,
    }),
  ).toEqual({ retryPlanned: false, sequence: 2 });
  expect(store.requests('work-1')[0]?.status).toBe('unknown');
  expect(store.work('work-1')).toMatchObject({ status: 'waiting', eligible: 0 });
});

test('startup recovery converts every admitted attempt to unknown without replay', () => {
  const { store, operations } = fixture();
  admit(operations);

  operations.recoverAdmittedAttempts();

  expect(store.requests('work-1')[0]).toMatchObject({ status: 'unknown' });
  expect(store.db.prepare('SELECT status FROM attempts').get()).toEqual({ status: 'unknown' });
  expect(store.work('work-1')).toMatchObject({
    status: 'waiting',
    eligible: 0,
    concern: JSON.stringify({
      code: 'INTERRUPTED',
      message: 'Admission has no conclusive durable outcome',
    }),
  });
  expect(
    store.db.prepare("SELECT kind FROM progress WHERE kind='attempt.uncertain'").all(),
  ).toHaveLength(1);
});

test('a late conclusive outcome settles evidence without reopening closed Work', () => {
  const { store, operations } = fixture();
  admit(operations);
  store.write(() => {
    store.db.prepare("UPDATE work SET status='closed',eligible=0,closure=? WHERE id=?").run(
      JSON.stringify({
        status: 'canceled',
        reason: { code: 'CANCELED', message: 'Stop' },
      }),
      'work-1',
    );
  });

  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'success', value: 42 },
    retryMaxAttempts: 1,
    approvalRequired: false,
  });

  expect(store.requests('work-1')[0]?.status).toBe('settled');
  expect(store.work('work-1')).toMatchObject({ status: 'closed', eligible: 0 });
  expect(store.db.prepare('SELECT body FROM attempt_outcomes').get()).toEqual({
    body: JSON.stringify({ status: 'success', value: 42 }),
  });
});

test('settlement transitions preserve Work/operation invariants across outcome classes', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('success', 'none', 'partial', 'occurred', 'unknown'),
      fc.integer({ min: 1, max: 4 }),
      fc.boolean(),
      (kind, retryMaxAttempts, closeBeforeSettlement) => {
        const { store, operations } = fixture();
        admit(operations);
        if (closeBeforeSettlement)
          store.write(() => {
            store.db
              .prepare("UPDATE work SET status='closed',eligible=0,closure=? WHERE id='work-1'")
              .run(
                JSON.stringify({
                  status: 'canceled',
                  reason: { code: 'CANCELED', message: 'Property fixture closed Work' },
                }),
              );
          });
        const outcome: Outcome =
          kind === 'success'
            ? { status: 'success', value: retryMaxAttempts }
            : kind === 'unknown'
              ? { status: 'unknown', reason: { code: 'LOST', message: 'Unknown outcome' } }
              : {
                  status: 'failure',
                  effect: kind,
                  reason: { code: 'FAILED', message: `${kind} effect` },
                };

        const settled = operations.settleAttempt({
          workId: 'work-1',
          operationId: 'operation-1',
          attemptId: 'attempt-1',
          outcome,
          retryMaxAttempts,
          approvalRequired: false,
        });
        const work = store.work('work-1');
        const operation = store.requests('work-1')[0]!;
        const attempt = store.db
          .prepare('SELECT status FROM attempts WHERE id=?')
          .get('attempt-1') as { status: string };
        const mayRetry = !closeBeforeSettlement && kind === 'none' && retryMaxAttempts > 1;

        expect(settled.retryPlanned).toBe(mayRetry);
        expect(attempt.status).toBe(kind === 'unknown' ? 'unknown' : 'settled');
        expect(operation.status).toBe(
          mayRetry ? 'planned' : kind === 'unknown' ? 'unknown' : 'settled',
        );
        expect(work.eligible).toBe(closeBeforeSettlement ? 0 : kind === 'unknown' ? 0 : 1);
        expect(work.status).toBe(
          closeBeforeSettlement ? 'closed' : kind === 'unknown' ? 'waiting' : 'active',
        );
        if (work.status === 'closed') expect(operation.status).not.toBe('planned');
        expect(store.db.prepare('SELECT * FROM capacity_entries').all()).toHaveLength(1);
        expect(store.db.prepare('SELECT * FROM attempt_outcomes').all()).toHaveLength(1);
      },
    ),
    { numRuns: 40 },
  );
});

test('an owner can settle an unknown effect without rewriting the unknown attempt', () => {
  const { store, operations } = fixture();
  admit(operations);
  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'unknown', reason: { code: 'LOST', message: 'Receipt was lost' } },
    retryMaxAttempts: 1,
    approvalRequired: false,
  });
  const request = {
    requestId: requestId('resolve-1'),
    operationId: 'operation-1',
    resolution: { status: 'success' as const, value: 42 },
  };

  const first = operations.resolveUnknown(
    { principal: 'owner', source: 'test' },
    'work-1' as WorkId,
    request,
    { retryMaxAttempts: 1, approvalRequired: false, now: 200 },
  );
  const repeated = operations.resolveUnknown(
    { principal: 'owner', source: 'test' },
    'work-1' as WorkId,
    request,
    { retryMaxAttempts: 1, approvalRequired: false, now: 300 },
  );

  expect(first).toEqual(repeated);
  expect(first).toMatchObject({ status: 'accepted', value: { action: 'settled' } });
  expect(store.requests('work-1')[0]).toMatchObject({
    status: 'settled',
    outcome: JSON.stringify({ status: 'success', value: 42 }),
  });
  expect(store.db.prepare('SELECT status FROM attempts').get()).toEqual({ status: 'unknown' });
  expect(store.work('work-1')).toMatchObject({ status: 'active', eligible: 1, concern: null });
  expect(store.db.prepare('SELECT recorded_at FROM effect_resolutions').get()).toEqual({
    recorded_at: 200,
  });
  expect(
    store.db.prepare("SELECT kind FROM progress WHERE kind='effect.resolved'").all(),
  ).toHaveLength(1);
});

test('a not-applied resolution retries only within Tool policy and rejects identity reuse', () => {
  const { store, operations } = fixture();
  admit(operations);
  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'unknown', reason: { code: 'LOST', message: 'Receipt was lost' } },
    retryMaxAttempts: 2,
    approvalRequired: false,
  });
  const request = {
    requestId: requestId('resolve-retry'),
    operationId: 'operation-1',
    resolution: {
      status: 'not-applied' as const,
      reason: { code: 'NOT_FOUND', message: 'Remote lookup found no effect' },
    },
  };

  expect(
    operations.resolveUnknown({ principal: 'owner', source: 'test' }, 'work-1' as WorkId, request, {
      retryMaxAttempts: 2,
      approvalRequired: false,
      now: 200,
    }),
  ).toMatchObject({ status: 'accepted', value: { action: 'retry-planned' } });
  expect(store.requests('work-1')[0]).toMatchObject({ status: 'planned', outcome: null });
  expect(
    operations.resolveUnknown(
      { principal: 'owner', source: 'test' },
      'work-1' as WorkId,
      { ...request, resolution: { status: 'success', value: 7 } },
      { retryMaxAttempts: 2, approvalRequired: false, now: 300 },
    ),
  ).toMatchObject({ status: 'conflict', reason: { code: 'IDENTITY_CONFLICT' } });
});

test('resolution storage failure rolls back the receipt and every state transition', () => {
  const { store, operations } = fixture();
  admit(operations);
  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'unknown', reason: { code: 'LOST', message: 'Receipt was lost' } },
    retryMaxAttempts: 1,
    approvalRequired: false,
  });
  store.db.exec(
    "CREATE TRIGGER reject_resolution BEFORE INSERT ON effect_resolutions BEGIN SELECT RAISE(ABORT,'injected resolution failure'); END;",
  );

  expect(() =>
    operations.resolveUnknown(
      { principal: 'owner', source: 'test' },
      'work-1' as WorkId,
      {
        requestId: requestId('resolve-rollback'),
        operationId: 'operation-1',
        resolution: { status: 'success', value: 42 },
      },
      { retryMaxAttempts: 1, approvalRequired: false, now: 200 },
    ),
  ).toThrow('injected resolution failure');
  expect(store.requests('work-1')[0]?.status).toBe('unknown');
  expect(store.work('work-1')).toMatchObject({ status: 'waiting', eligible: 0 });
  expect(store.db.prepare('SELECT * FROM receipts').all()).toEqual([]);
  expect(store.db.prepare('SELECT * FROM effect_resolutions').all()).toEqual([]);
  expect(store.db.prepare("SELECT kind FROM progress WHERE kind='effect.resolved'").all()).toEqual(
    [],
  );
});

test('a committed resolution receipt survives restart and prevents duplicate evidence', () => {
  const { directory, store, operations } = fixture();
  admit(operations);
  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'unknown', reason: { code: 'LOST', message: 'Receipt was lost' } },
    retryMaxAttempts: 1,
    approvalRequired: false,
  });
  const request = {
    requestId: requestId('resolve-before-restart'),
    operationId: 'operation-1',
    resolution: { status: 'success' as const, value: 42 },
  };
  const committed = operations.resolveUnknown(
    { principal: 'owner', source: 'test' },
    'work-1' as WorkId,
    request,
    { retryMaxAttempts: 1, approvalRequired: false, now: 200 },
  );
  store.close();
  const reopened = new SqliteStore(directory, () => 300);
  stores.push(reopened);

  expect(
    new OperationStore(reopened).resolveUnknown(
      { principal: 'owner', source: 'test' },
      'work-1' as WorkId,
      request,
      { retryMaxAttempts: 1, approvalRequired: false, now: 300 },
    ),
  ).toEqual(committed);
  expect(reopened.db.prepare('SELECT * FROM effect_resolutions').all()).toHaveLength(1);
  expect(
    reopened.db.prepare("SELECT * FROM progress WHERE kind='effect.resolved'").all(),
  ).toHaveLength(1);
});

test('an admitted reconciliation lookup becomes safely replayable after restart', () => {
  const { directory, store, operations } = fixture();
  admit(operations);
  operations.settleAttempt({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    outcome: { status: 'unknown', reason: { code: 'LOST', message: 'Receipt was lost' } },
    retryMaxAttempts: 1,
    approvalRequired: false,
  });
  expect(
    operations.admitReconciliation({
      workId: 'work-1',
      operationId: 'operation-1',
      attemptId: 'attempt-1',
      reconciliationId: 'reconcile-1',
      now: 200,
    }),
  ).toBe(true);
  store.close();
  const reopened = new SqliteStore(directory, () => 300);
  stores.push(reopened);
  const restored = new OperationStore(reopened);

  restored.recoverAdmittedReconciliations();
  expect(reopened.db.prepare('SELECT status FROM effect_reconciliation_attempts').get()).toEqual({
    status: 'planned',
  });
  expect(
    restored.admitReconciliation({
      workId: 'work-1',
      operationId: 'operation-1',
      attemptId: 'attempt-1',
      reconciliationId: 'reconcile-1',
      now: 300,
    }),
  ).toBe(true);
  restored.settleReconciliation({
    workId: 'work-1',
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    reconciliationId: 'reconcile-1',
    result: { status: 'success', value: 42 },
    retryMaxAttempts: 1,
    approvalRequired: false,
    now: 400,
  });

  expect(reopened.requests('work-1')[0]?.status).toBe('settled');
  expect(reopened.db.prepare('SELECT status FROM attempts').get()).toEqual({ status: 'unknown' });
  expect(reopened.db.prepare('SELECT status FROM effect_reconciliation_attempts').get()).toEqual({
    status: 'settled',
  });
  expect(reopened.db.prepare('SELECT * FROM effect_resolutions').all()).toEqual([]);
  expect(reopened.db.prepare('SELECT * FROM tool_effect_resolutions').all()).toHaveLength(1);
  expect(
    reopened.db
      .prepare("SELECT kind FROM progress WHERE kind='effect.reconciliation_interrupted'")
      .all(),
  ).toHaveLength(1);
});

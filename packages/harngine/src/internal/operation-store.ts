import { approvalAllows, consumeApproval } from './approval.js';
import { entityId } from './id.js';
import {
  requestId,
  RuntimeError,
  type EffectResolutionAcceptance,
  type Identity,
  type Json,
  type Outcome,
  type Policy,
  type Receipt,
  type ReconciliationResult,
  type ResolveEffectRequest,
  type WorkId,
} from './contracts.js';
import { canonical } from '../schema.js';
import { exact } from './core.js';
import type { RequestRow, SqliteStore } from './store.js';

export interface CallAuthorizationRecord {
  readonly principal: string;
  readonly policyRevision: string;
  readonly tool: Identity & Json;
  readonly input: Json;
}

export interface AttemptAdmission {
  readonly workId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly modelTurn: boolean;
  readonly approvalRequired: boolean;
  readonly authorized: CallAuthorizationRecord;
  readonly now: number;
}

export interface AttemptSettlement {
  readonly workId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly outcome: Outcome;
  readonly retryMaxAttempts: number;
  readonly approvalRequired: boolean;
}

export interface ReconciliationAdmission {
  readonly workId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly reconciliationId: string;
  readonly now: number;
}

export interface ReconciliationSettlement {
  readonly workId: string;
  readonly operationId: string;
  readonly attemptId: string;
  readonly reconciliationId: string;
  readonly result: ReconciliationResult;
  readonly retryMaxAttempts: number;
  readonly approvalRequired: boolean;
  readonly now: number;
}

/** Semantic transactions for the external-effect boundary. */
export class OperationStore {
  constructor(private readonly store: SqliteStore) {}

  denyCall(workId: string, operationId: string, authorized: CallAuthorizationRecord): boolean {
    const outcome: Outcome = {
      status: 'failure',
      effect: 'none',
      reason: { code: 'ACCESS_DENIED', message: 'Tool Call is not authorized' },
    };
    return this.store.write(() => {
      const operation = this.operation(workId, operationId);
      if (!operation || operation.status !== 'planned') return false;
      this.store.db
        .prepare("UPDATE requests SET status='settled',outcome=? WHERE id=?")
        .run(canonical(outcome), operationId);
      this.store.db
        .prepare("UPDATE work SET status='active',eligible=1 WHERE id=? AND status!='closed'")
        .run(workId);
      this.store.event(workId, 'authorization.denied', {
        action: 'call',
        principal: authorized.principal,
        policyRevision: authorized.policyRevision,
        operationId,
        tool: authorized.tool,
      });
      this.store.authorization({
        action: 'call',
        principal: authorized.principal,
        policyRevision: authorized.policyRevision,
        allowed: false,
        workId,
        targetId: operationId,
        subject: authorized.tool,
        value: authorized.input,
      });
      return true;
    });
  }

  admitAttempt(input: AttemptAdmission): { admitted: boolean; sequence?: number } {
    return this.store.write(() => {
      const current = this.store.work(input.workId);
      const operation = this.operation(input.workId, input.operationId);
      const policy = JSON.parse(current.policy) as Policy;
      if (
        !operation ||
        current.status === 'closed' ||
        current.control_token !== operation.control_token ||
        current.spent >= policy.maxAttempts ||
        (input.modelTurn &&
          policy.maxModelTurns !== undefined &&
          current.model_turns >= policy.maxModelTurns) ||
        (!input.modelTurn &&
          policy.maxToolExecutions !== undefined &&
          current.tool_executions >= policy.maxToolExecutions) ||
        operation.status !== 'planned'
      )
        return { admitted: false };
      if (!approvalAllows(this.store, operation, input.approvalRequired, input.now))
        return { admitted: false };
      const sequence =
        (
          this.store.db
            .prepare('SELECT COUNT(*) AS count FROM attempts WHERE operation_id=?')
            .get(input.operationId) as { count: number }
        ).count + 1;
      this.store.db
        .prepare("INSERT INTO attempts VALUES(?,?,?,'admitted',?)")
        .run(input.attemptId, input.operationId, sequence, this.store.epoch);
      this.store.db
        .prepare('INSERT INTO capacity_entries VALUES(?,?,1)')
        .run(input.attemptId, input.workId);
      consumeApproval(this.store, input.operationId, input.attemptId);
      this.store.db
        .prepare("UPDATE requests SET status='admitted' WHERE id=?")
        .run(input.operationId);
      this.store.event(input.workId, 'authorization.allowed', {
        action: 'call',
        principal: input.authorized.principal,
        policyRevision: input.authorized.policyRevision,
        operationId: input.operationId,
        tool: input.authorized.tool,
      });
      this.store.authorization({
        action: 'call',
        principal: input.authorized.principal,
        policyRevision: input.authorized.policyRevision,
        allowed: true,
        workId: input.workId,
        targetId: input.operationId,
        subject: input.authorized.tool,
        value: input.authorized.input,
      });
      this.store.db
        .prepare(
          input.modelTurn
            ? "UPDATE work SET spent=spent+1,model_turns=model_turns+1,status='waiting',eligible=0 WHERE id=?"
            : "UPDATE work SET spent=spent+1,tool_executions=tool_executions+1,status='waiting',eligible=0 WHERE id=?",
        )
        .run(input.workId);
      this.store.event(input.workId, 'attempt.admitted', {
        operationId: input.operationId,
        attemptId: input.attemptId,
        attempt: sequence,
      });
      return { admitted: true, sequence };
    });
  }

  settleAttempt(input: AttemptSettlement): { retryPlanned: boolean; sequence: number } {
    return this.store.write(() => {
      const attempt = this.store.db
        .prepare(
          `SELECT a.sequence,a.status FROM attempts a
           JOIN requests r ON r.id=a.operation_id
           WHERE a.id=? AND a.operation_id=? AND r.work_id=?`,
        )
        .get(input.attemptId, input.operationId, input.workId) as
        | { sequence: number; status: string }
        | undefined;
      if (!attempt || attempt.status !== 'admitted')
        throw new RuntimeError('INVALID_TRANSITION', 'Attempt is not admitted for this operation');
      const current = this.store.work(input.workId);
      const conclusive = input.outcome.status !== 'unknown';
      const retryPlanned =
        current.status !== 'closed' &&
        input.outcome.status === 'failure' &&
        input.outcome.effect === 'none' &&
        !input.approvalRequired &&
        attempt.sequence < input.retryMaxAttempts;
      this.store.db
        .prepare('INSERT INTO attempt_outcomes VALUES(?,?)')
        .run(input.attemptId, canonical(input.outcome));
      this.store.db
        .prepare('UPDATE attempts SET status=? WHERE id=?')
        .run(conclusive ? 'settled' : 'unknown', input.attemptId);
      this.store.db
        .prepare('UPDATE requests SET status=?,outcome=? WHERE id=?')
        .run(
          retryPlanned ? 'planned' : conclusive ? 'settled' : 'unknown',
          retryPlanned ? null : canonical(input.outcome),
          input.operationId,
        );
      this.store.db
        .prepare('UPDATE work SET status=?,eligible=?,concern=? WHERE id=?')
        .run(
          current.status === 'closed'
            ? 'closed'
            : retryPlanned || conclusive
              ? 'active'
              : 'waiting',
          current.status !== 'closed' && (retryPlanned || conclusive) ? 1 : 0,
          input.outcome.status === 'unknown' ? canonical(input.outcome.reason) : null,
          input.workId,
        );
      this.store.event(input.workId, 'attempt.outcome_recorded', {
        operationId: input.operationId,
        attemptId: input.attemptId,
        attempt: attempt.sequence,
        outcome: input.outcome as unknown as Json,
      });
      if (retryPlanned)
        this.store.event(input.workId, 'attempt.retry_planned', {
          operationId: input.operationId,
          attempt: attempt.sequence + 1,
        });
      return { retryPlanned, sequence: attempt.sequence };
    });
  }

  resolveUnknown(
    caller: { readonly principal: string; readonly source: string },
    workId: WorkId,
    request: ResolveEffectRequest,
    policy: {
      readonly retryMaxAttempts: number;
      readonly approvalRequired: boolean;
      readonly now: number;
    },
  ): Receipt<EffectResolutionAcceptance> {
    requestId(request.requestId);
    exact(request, ['requestId', 'operationId', 'resolution']);
    if (!request.operationId || request.operationId.length > 256)
      throw new RuntimeError('INVALID_ID', 'Operation identity must have 1–256 characters');
    if (!['success', 'failure', 'not-applied'].includes(request.resolution.status))
      throw new RuntimeError('INVALID_DATA', 'Unknown effect resolution status');
    if (request.resolution.status === 'success') {
      exact(request.resolution, ['status', 'value']);
    } else {
      exact(
        request.resolution,
        request.resolution.status === 'failure'
          ? ['status', 'effect', 'reason']
          : ['status', 'reason'],
      );
      exact(request.resolution.reason, ['code', 'message']);
      if (
        typeof request.resolution.reason.code !== 'string' ||
        !request.resolution.reason.code ||
        typeof request.resolution.reason.message !== 'string'
      )
        throw new RuntimeError('INVALID_DATA', 'Resolution reason requires code and message');
      if (
        request.resolution.status === 'failure' &&
        !['partial', 'occurred'].includes(request.resolution.effect)
      )
        throw new RuntimeError(
          'INVALID_DATA',
          'Resolved failure effect must be partial or occurred',
        );
    }
    const scope = canonical([caller.principal, caller.source]);
    const command = canonical(request);
    return this.store.write(() => {
      const work = this.store.work(workId);
      if (work.principal !== caller.principal)
        throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
      const prior = this.store.db
        .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
        .get(scope, request.requestId) as { command: string; receipt: string } | undefined;
      if (prior)
        return prior.command === command
          ? (JSON.parse(prior.receipt) as Receipt<EffectResolutionAcceptance>)
          : {
              requestId: request.requestId,
              status: 'conflict',
              reason: {
                code: 'IDENTITY_CONFLICT',
                message: 'Resolution identity has different content',
              },
            };

      const operation = this.operation(workId, request.operationId);
      let receipt: Receipt<EffectResolutionAcceptance>;
      if (!operation || operation.status !== 'unknown' || work.status === 'closed') {
        receipt = {
          requestId: request.requestId,
          status: 'rejected',
          target: workId,
          reason: {
            code: work.status === 'closed' ? 'WORK_CLOSED' : 'EFFECT_NOT_UNKNOWN',
            message:
              work.status === 'closed'
                ? 'Closed Work cannot resolve an effect'
                : 'Operation does not have an unknown effect',
          },
        };
        this.store.db
          .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
          .run(scope, request.requestId, command, workId, canonical(receipt));
        return receipt;
      }
      const attempt = this.store.db
        .prepare(
          "SELECT id,sequence FROM attempts WHERE operation_id=? AND status='unknown' ORDER BY sequence DESC LIMIT 1",
        )
        .get(request.operationId) as { id: string; sequence: number } | undefined;
      if (!attempt)
        throw new RuntimeError('STORAGE_FORMAT', 'Unknown operation has no unknown attempt');
      if (
        this.store.db
          .prepare(
            "SELECT 1 FROM effect_reconciliation_attempts WHERE attempt_id=? AND status='admitted'",
          )
          .get(attempt.id)
      ) {
        receipt = {
          requestId: request.requestId,
          status: 'rejected',
          target: workId,
          reason: {
            code: 'RECONCILIATION_ACTIVE',
            message: 'Tool reconciliation is currently checking this effect',
          },
        };
        this.store.db
          .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
          .run(scope, request.requestId, command, workId, canonical(receipt));
        return receipt;
      }
      const applied = this.applyResolution({
        workId,
        operationId: request.operationId,
        attemptSequence: attempt.sequence,
        resolution: request.resolution,
        retryMaxAttempts: policy.retryMaxAttempts,
        approvalRequired: policy.approvalRequired,
      });
      receipt = {
        requestId: request.requestId,
        status: 'accepted',
        target: workId,
        value: { operationId: request.operationId, attemptId: attempt.id, action: applied.action },
      };
      this.store.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
        .run(scope, request.requestId, command, workId, canonical(receipt));
      this.store.db
        .prepare(
          `INSERT INTO effect_resolutions
           (id,operation_id,attempt_id,source_scope,request_id,resolution,recorded_at)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          entityId('resolution'),
          request.operationId,
          attempt.id,
          scope,
          request.requestId,
          canonical({
            conclusion: request.resolution,
            action: applied.action,
            outcome: applied.outcome,
          }),
          policy.now,
        );
      this.store.event(workId, 'effect.resolved', {
        operationId: request.operationId,
        attemptId: attempt.id,
        principal: caller.principal,
        origin: 'manual',
        conclusion: request.resolution,
        action: applied.action,
        outcome: applied.outcome,
      });
      return receipt;
    });
  }

  admitReconciliation(input: ReconciliationAdmission): boolean {
    return this.store.write(() => {
      const work = this.store.work(input.workId);
      const operation = this.operation(input.workId, input.operationId);
      const attempt = this.store.db
        .prepare('SELECT status FROM attempts WHERE id=? AND operation_id=?')
        .get(input.attemptId, input.operationId) as { status: string } | undefined;
      if (
        work.status === 'closed' ||
        operation?.status !== 'unknown' ||
        attempt?.status !== 'unknown' ||
        this.store.db
          .prepare(
            `SELECT 1 FROM effect_resolutions WHERE attempt_id=?
             UNION ALL
             SELECT 1 FROM tool_effect_resolutions WHERE attempt_id=?`,
          )
          .get(input.attemptId, input.attemptId)
      )
        return false;
      const existing = this.store.db
        .prepare('SELECT id,status FROM effect_reconciliation_attempts WHERE attempt_id=?')
        .get(input.attemptId) as { id: string; status: string } | undefined;
      if (existing && (existing.id !== input.reconciliationId || existing.status !== 'planned'))
        return false;
      if (existing)
        this.store.db
          .prepare(
            "UPDATE effect_reconciliation_attempts SET status='admitted',owner_epoch=?,recorded_at=? WHERE id=?",
          )
          .run(this.store.epoch, input.now, input.reconciliationId);
      else
        this.store.db
          .prepare("INSERT INTO effect_reconciliation_attempts VALUES(?,?,?,'admitted',?,NULL,?)")
          .run(
            input.reconciliationId,
            input.operationId,
            input.attemptId,
            this.store.epoch,
            input.now,
          );
      this.store.event(input.workId, 'effect.reconciliation_admitted', {
        operationId: input.operationId,
        attemptId: input.attemptId,
        reconciliationId: input.reconciliationId,
      });
      return true;
    });
  }

  settleReconciliation(input: ReconciliationSettlement): void {
    this.store.write(() => {
      const reconciliation = this.store.db
        .prepare(
          `SELECT status FROM effect_reconciliation_attempts
           WHERE id=? AND operation_id=? AND attempt_id=?`,
        )
        .get(input.reconciliationId, input.operationId, input.attemptId) as
        | { status: string }
        | undefined;
      if (reconciliation?.status !== 'admitted')
        throw new RuntimeError('INVALID_TRANSITION', 'Reconciliation is not admitted');
      this.store.db
        .prepare(
          "UPDATE effect_reconciliation_attempts SET status='settled',outcome=?,recorded_at=? WHERE id=?",
        )
        .run(canonical(input.result), input.now, input.reconciliationId);
      this.store.event(input.workId, 'effect.reconciliation_outcome', {
        operationId: input.operationId,
        attemptId: input.attemptId,
        reconciliationId: input.reconciliationId,
        result: input.result,
      });
      if (input.result.status === 'unknown') {
        this.store.db
          .prepare(
            "UPDATE work SET status='waiting',eligible=0,concern=? WHERE id=? AND status!='closed'",
          )
          .run(canonical(input.result.reason), input.workId);
        return;
      }
      const attempt = this.store.db
        .prepare('SELECT sequence,status FROM attempts WHERE id=? AND operation_id=?')
        .get(input.attemptId, input.operationId) as
        | { sequence: number; status: string }
        | undefined;
      const operation = this.operation(input.workId, input.operationId);
      if (attempt?.status !== 'unknown' || operation?.status !== 'unknown')
        throw new RuntimeError(
          'INVALID_TRANSITION',
          'Unknown effect changed during reconciliation',
        );
      const applied = this.applyResolution({
        workId: input.workId,
        operationId: input.operationId,
        attemptSequence: attempt.sequence,
        resolution: input.result,
        retryMaxAttempts: input.retryMaxAttempts,
        approvalRequired: input.approvalRequired,
      });
      this.store.db
        .prepare(
          `INSERT INTO tool_effect_resolutions
           (id,operation_id,attempt_id,reconciliation_attempt_id,resolution,recorded_at)
           VALUES(?,?,?,?,?,?)`,
        )
        .run(
          entityId('resolution'),
          input.operationId,
          input.attemptId,
          input.reconciliationId,
          canonical({ conclusion: input.result, action: applied.action, outcome: applied.outcome }),
          input.now,
        );
      this.store.event(input.workId, 'effect.reconciled', {
        operationId: input.operationId,
        attemptId: input.attemptId,
        reconciliationId: input.reconciliationId,
        origin: 'tool',
        conclusion: input.result,
        action: applied.action,
        outcome: applied.outcome,
      });
    });
  }

  recoverAdmittedReconciliations(): void {
    this.store.write(() => {
      const admitted = this.store.db
        .prepare(
          `SELECT e.id,e.operation_id,e.attempt_id,r.work_id
           FROM effect_reconciliation_attempts e
           JOIN requests r ON r.id=e.operation_id
           WHERE e.status='admitted'`,
        )
        .all() as { id: string; operation_id: string; attempt_id: string; work_id: string }[];
      for (const row of admitted) {
        this.store.db
          .prepare("UPDATE effect_reconciliation_attempts SET status='planned' WHERE id=?")
          .run(row.id);
        this.store.event(row.work_id, 'effect.reconciliation_interrupted', {
          operationId: row.operation_id,
          attemptId: row.attempt_id,
          reconciliationId: row.id,
        });
      }
    });
  }

  recoverAdmittedAttempts(repeatable?: (request: RequestRow) => boolean): void {
    this.store.write(() => {
      const pending = this.store.db
        .prepare(
          "SELECT r.* FROM requests r JOIN attempts a ON a.operation_id=r.id WHERE a.status='admitted'",
        )
        .all() as RequestRow[];
      for (const request of pending) {
        const interrupted = repeatable?.(request) === true;
        const outcome: Outcome = interrupted
          ? {
              status: 'failure',
              effect: 'none',
              reason: {
                code: 'MODEL_INTERRUPTED',
                message: 'Model request was interrupted',
              },
            }
          : {
              status: 'unknown',
              reason: {
                code: 'INTERRUPTED',
                message: 'Admission has no conclusive durable outcome',
              },
            };
        const attempt = this.store.db
          .prepare("SELECT id FROM attempts WHERE operation_id=? AND status='admitted'")
          .get(request.id) as { id: string };
        if (interrupted)
          this.store.db
            .prepare('INSERT INTO attempt_outcomes VALUES(?,?)')
            .run(attempt.id, canonical(outcome));
        this.store.db
          .prepare("UPDATE attempts SET status=? WHERE operation_id=? AND status='admitted'")
          .run(interrupted ? 'settled' : 'unknown', request.id);
        this.store.db
          .prepare('UPDATE requests SET status=?,outcome=? WHERE id=?')
          .run(interrupted ? 'settled' : 'unknown', canonical(outcome), request.id);
        this.store.db
          .prepare(
            interrupted
              ? "UPDATE work SET status=CASE WHEN status='closed' THEN status ELSE 'active' END,eligible=CASE WHEN status='closed' THEN 0 ELSE 1 END,concern=NULL WHERE id=?"
              : "UPDATE work SET status=CASE WHEN status='closed' THEN status ELSE 'waiting' END,eligible=0,concern=? WHERE id=?",
          )
          .run(...(interrupted ? [request.work_id] : [canonical(outcome.reason), request.work_id]));
        this.store.event(
          request.work_id,
          interrupted ? 'attempt.interrupted' : 'attempt.uncertain',
          {
            operationId: request.id,
          },
        );
      }
    });
  }

  private applyResolution(input: {
    workId: string;
    operationId: string;
    attemptSequence: number;
    resolution: Exclude<ReconciliationResult, { status: 'unknown' }>;
    retryMaxAttempts: number;
    approvalRequired: boolean;
  }): { readonly action: 'settled' | 'retry-planned'; readonly outcome: Outcome } {
    const work = this.store.work(input.workId);
    const outcome: Outcome =
      input.resolution.status === 'success'
        ? input.resolution
        : input.resolution.status === 'failure'
          ? input.resolution
          : {
              status: 'failure',
              effect: 'none',
              reason: input.resolution.reason,
            };
    const retryPlanned =
      input.resolution.status === 'not-applied' &&
      work.status !== 'closed' &&
      !input.approvalRequired &&
      input.attemptSequence < input.retryMaxAttempts;
    this.store.db
      .prepare('UPDATE requests SET status=?,outcome=? WHERE id=?')
      .run(
        retryPlanned ? 'planned' : 'settled',
        retryPlanned ? null : canonical(outcome),
        input.operationId,
      );
    this.store.db
      .prepare(
        `UPDATE work SET
          status=CASE WHEN status='closed' THEN 'closed' ELSE 'active' END,
          eligible=CASE WHEN status='closed' THEN 0 ELSE 1 END,
          concern=CASE WHEN status='closed' THEN concern ELSE NULL END
         WHERE id=?`,
      )
      .run(input.workId);
    return { action: retryPlanned ? 'retry-planned' : 'settled', outcome };
  }

  private operation(workId: string, operationId: string): RequestRow | undefined {
    return this.store.requests(workId).find((candidate) => candidate.id === operationId);
  }
}

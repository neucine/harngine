import { approvals, expireApprovals, inspectApproval, replyApproval } from './approval.js';
import {
  RuntimeError,
  type ApprovalReply,
  type Json,
  type ReplyRequest,
  type WaitRef,
  type WorkRef,
} from './contracts.js';
import type { SqliteStore } from './store.js';
import type { PolicyEvaluator } from './policy-evaluator.js';
import { expireWaits, inspectWait, isWorkflowWait, replyWait, workflowWaits } from './wait.js';

/** Owns durable human waits, Tool approvals, expiry, and deadline discovery. */
export class WaitManager {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: () => number,
    private readonly policy: PolicyEvaluator,
  ) {}

  approvals(workId: string) {
    return approvals(this.store, workId);
  }

  waits(workId: string) {
    return workflowWaits(this.store, workId);
  }

  approval<O extends Json, R extends Json>(
    caller: { readonly principal: string; readonly source: string },
    work: WorkRef<O, R>,
    wait: WaitRef,
  ) {
    return inspectApproval(this.store, caller, work, wait);
  }

  wait<O extends Json, R extends Json>(
    caller: { readonly principal: string; readonly source: string },
    work: WorkRef<O, R>,
    wait: WaitRef,
  ) {
    return inspectWait(this.store, caller, work, wait);
  }

  async reply<O extends Json, R extends Json>(
    caller: { readonly principal: string; readonly source: string },
    work: WorkRef<O, R>,
    request: ApprovalReply | ReplyRequest,
  ) {
    const access = this.policy.canRespond({
      principal: caller.principal,
      workId: work.id,
      interactionId: request.wait.id,
    });
    const allowed = typeof access === 'boolean' ? access : await access;
    this.store.write(() =>
      this.store.authorization({
        action: 'respond',
        principal: caller.principal,
        policyRevision: this.policy.revision,
        allowed,
        workId: work.id,
        targetId: `${request.wait.id}:${request.requestId}`,
        subject: { interactionId: request.wait.id },
        value: request as unknown as Json,
      }),
    );
    if (!allowed) throw new RuntimeError('ACCESS_DENIED', 'Interaction response is not authorized');
    return isWorkflowWait(this.store, request.wait)
      ? replyWait(this.store, caller, work, request, this.clock)
      : replyApproval(this.store, caller, work, request as ApprovalReply, this.clock);
  }

  expire(): void {
    const now = this.clock();
    expireApprovals(this.store, now);
    expireWaits(this.store, now);
  }

  nextDeadline(): number | null {
    const next = this.store.db
      .prepare(
        "SELECT MIN(deadline) AS deadline FROM (SELECT expires_at AS deadline FROM waits WHERE admitted_attempt_id IS NULL AND invalidation IS NULL AND status IN('pending','approved') UNION ALL SELECT deadline FROM workflow_waits WHERE status='pending' AND deadline IS NOT NULL)",
      )
      .get() as { deadline: number | null };
    return next.deadline;
  }
}

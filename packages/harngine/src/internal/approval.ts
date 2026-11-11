import { entityId } from './id.js';
import {
  RuntimeError,
  requestId,
  type ApprovalPolicy,
  type ApprovalRecord,
  type ApprovalReply,
  type ApprovalAcceptance,
  type Receipt,
  type WorkRef,
  type WaitRef,
  type WorkId,
  type ObjectiveRevision,
  type ControlToken,
  type ProgressCursor,
  type Reason,
} from './contracts.js';
import { canonical, copy, frozen } from '../schema.js';
import { exact, reason } from './core.js';
import type { SqliteStore, RequestRow } from './store.js';

interface WaitRow {
  id: string;
  work_id: string;
  operation_id: string;
  binding: string;
  approvers: string;
  expires_at: number;
  status: ApprovalRecord['status'];
  invalidation: ApprovalRecord['invalidation'];
  admitted_attempt_id: string | null;
}
function binding(call: RequestRow): string {
  return canonical({
    workId: call.work_id,
    operationId: call.id,
    tool: JSON.parse(call.tool),
    input: JSON.parse(call.input),
    objectiveRevision: call.objective_revision,
    controlToken: call.control_token,
    context: [],
    admissionLimit: 1,
  });
}
function byOperation(store: SqliteStore, id: string): WaitRow | undefined {
  return store.db.prepare('SELECT * FROM waits WHERE operation_id=?').get(id) as
    | WaitRow
    | undefined;
}
export function approvals(store: SqliteStore, workId: string): ApprovalRecord[] {
  return (
    store.db.prepare('SELECT * FROM waits WHERE work_id=? ORDER BY rowid').all(workId) as WaitRow[]
  ).map((w) => describe(w));
}
function describe(wait: WaitRow): ApprovalRecord {
  const action = JSON.parse(wait.binding);
  return frozen({
    wait: { id: wait.id, workId: wait.work_id as WorkId },
    operationId: wait.operation_id,
    tool: action.tool,
    input: action.input,
    objectiveRevision: action.objectiveRevision as ObjectiveRevision,
    controlToken: action.controlToken as ControlToken,
    approvers: JSON.parse(wait.approvers),
    expiresAt: wait.expires_at,
    admissionLimit: 1,
    status: wait.status,
    invalidation: wait.invalidation,
    admittedAttemptId: wait.admitted_attempt_id,
  });
}
export function inspectApproval(
  store: SqliteStore,
  caller: { principal: string },
  work: WorkRef,
  ref: WaitRef,
): ApprovalRecord {
  return describe(authorized(store, caller, work, ref, true));
}
function authorized(
  store: SqliteStore,
  caller: { principal: string },
  work: WorkRef,
  ref: WaitRef,
  inspection = false,
): WaitRow {
  const current = store.work(work.id);
  if (canonical(work.definition) !== current.definition || ref.workId !== work.id)
    throw new RuntimeError('SCOPE_MISMATCH', 'Approval target does not match Work');
  const wait = store.db
    .prepare('SELECT * FROM waits WHERE id=? AND work_id=?')
    .get(ref.id, work.id) as WaitRow | undefined;
  if (!wait) throw new RuntimeError('NOT_FOUND', 'Approval Wait not found');
  if (
    !(JSON.parse(wait.approvers) as string[]).includes(caller.principal) &&
    !(inspection && current.principal === caller.principal)
  ) {
    throw new RuntimeError('ACCESS_DENIED', 'Caller is not an eligible responder');
  }
  return wait;
}
/** Called inside decision commit. The immutable Operation supplies all binding fields. */
export function planApproval(
  store: SqliteStore,
  call: RequestRow,
  policy: ApprovalPolicy,
  now: number,
): void {
  const expires = now + policy.timeoutMs;
  if (!Number.isSafeInteger(expires))
    throw new RuntimeError('INVALID_TIME', 'Approval deadline exceeds supported clock range');
  store.db
    .prepare("INSERT INTO waits VALUES(?,?,?,?,?,?,'pending',NULL,NULL)")
    .run(
      entityId('approval'),
      call.work_id,
      call.id,
      binding(call),
      canonical(policy.approvers),
      expires,
    );
  store.db.prepare("UPDATE work SET status='waiting',eligible=0 WHERE id=?").run(call.work_id);
}
function expireOne(store: SqliteStore, wait: WaitRow): void {
  // An approved reply remains a historical settlement, even when its unused grant expires.
  store.db
    .prepare(
      "UPDATE waits SET status=CASE WHEN status='pending' THEN 'expired' ELSE status END,invalidation='expired' WHERE id=?",
    )
    .run(wait.id);
  settleWithoutAttempt(
    store,
    wait,
    'APPROVAL_EXPIRED',
    'Approval was not usable before its deadline',
  );
}
function settleWithoutAttempt(
  store: SqliteStore,
  wait: WaitRow,
  code: string,
  message: string,
): void {
  store.db
    .prepare("UPDATE requests SET status='settled',outcome=? WHERE id=? AND status='planned'")
    .run(
      canonical({ status: 'failure', effect: 'none', reason: { code, message } }),
      wait.operation_id,
    );
  store.db
    .prepare("UPDATE work SET status='active',eligible=1 WHERE id=? AND status!='closed'")
    .run(wait.work_id);
  store.event(wait.work_id, 'approval.settled', { waitId: wait.id, code });
  store.event(wait.work_id, 'call.settled', {
    operationId: wait.operation_id,
    outcome: { status: 'failure', effect: 'none', reason: { code, message } },
  });
}
export function expireApprovals(store: SqliteStore, now: number): void {
  store.write(() => {
    const expired = store.db
      .prepare(
        "SELECT * FROM waits WHERE expires_at<=? AND admitted_attempt_id IS NULL AND invalidation IS NULL AND status IN ('pending','approved')",
      )
      .all(now) as WaitRow[];
    for (const wait of expired) expireOne(store, wait);
  });
}
/** Must run inside the same transaction that fences authority/withdraws unadmitted plans. */
export function withdrawApprovals(store: SqliteStore, workId: string): void {
  const withdrawn = store.db
    .prepare(
      "SELECT id FROM waits WHERE work_id=? AND admitted_attempt_id IS NULL AND invalidation IS NULL AND status IN ('pending','approved') ORDER BY rowid",
    )
    .all(workId) as { id: string }[];
  store.db
    .prepare(
      "UPDATE waits SET status=CASE WHEN status='pending' THEN 'withdrawn' ELSE status END,invalidation='withdrawn' WHERE work_id=? AND admitted_attempt_id IS NULL AND invalidation IS NULL AND status IN ('pending','approved')",
    )
    .run(workId);
  for (const wait of withdrawn)
    store.event(workId, 'interaction.settled', { waitId: wait.id, status: 'withdrawn' });
}
/** Admission guard; expiry is recorded before returning false. */
export function approvalAllows(
  store: SqliteStore,
  call: RequestRow,
  required: boolean,
  now: number,
): boolean {
  const wait = byOperation(store, call.id);
  if (!wait) {
    if (required)
      throw new RuntimeError('APPROVAL_MISSING', 'Required approval binding is missing');
    return true;
  }
  if (wait.binding !== binding(call))
    throw new RuntimeError('APPROVAL_BINDING', 'Approval does not match the recorded action');
  if (wait.invalidation || wait.admitted_attempt_id || wait.status !== 'approved') return false;
  if (now >= wait.expires_at) {
    expireOne(store, wait);
    return false;
  }
  return true;
}
export function consumeApproval(store: SqliteStore, operationId: string, attemptId: string): void {
  store.db
    .prepare(
      "UPDATE waits SET admitted_attempt_id=? WHERE operation_id=? AND status='approved' AND invalidation IS NULL AND admitted_attempt_id IS NULL",
    )
    .run(attemptId, operationId);
}
export function replyApproval(
  store: SqliteStore,
  caller: { principal: string; source: string },
  work: WorkRef,
  input: ApprovalReply,
  clock: () => number,
): Receipt<ApprovalAcceptance> {
  const request = copy(input);
  requestId(request.requestId);
  // Access is checked before disclosing any original receipt, including after Work closes.
  authorized(store, caller, work, request.wait);
  const scope = canonical([caller.principal, caller.source]);
  const command = canonical({ type: 'reply', target: work, request });
  const previous = store.db
    .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
    .get(scope, request.requestId) as { command: string; receipt: string } | undefined;
  if (previous)
    return frozen(
      previous.command === command
        ? JSON.parse(previous.receipt)
        : {
            requestId: request.requestId,
            status: 'conflict',
            target: work.id,
            reason: { code: 'IDENTITY_CONFLICT', message: 'Reply identity has different content' },
          },
    );
  let invalid: Reason | undefined;
  try {
    exact(request, ['requestId', 'wait', 'payload']);
    exact(request.wait, ['id', 'workId']);
    exact(request.payload, ['decision']);
    if (!['approve', 'deny'].includes(request.payload.decision))
      throw new RuntimeError('INVALID_REPLY', 'Expected approve or deny');
  } catch (error) {
    invalid = reason(error);
  }
  return frozen(
    store.write(() => {
      const wait = authorized(store, caller, work, request.wait);
      const current = store.work(work.id);
      const call = store.requests(work.id).find((r) => r.id === wait.operation_id)!;
      let rejection = invalid;
      if (
        current.status === 'closed' ||
        call.control_token !== current.control_token ||
        wait.invalidation ||
        call.status !== 'planned'
      ) {
        rejection = {
          code: 'STALE_APPROVAL',
          message: 'Approval no longer authorizes a planned action',
        };
      } else if (wait.status !== 'pending')
        rejection = { code: 'WAIT_SETTLED', message: 'Approval already has a reply' };
      else if (clock() >= wait.expires_at) {
        expireOne(store, wait);
        rejection = {
          code: 'APPROVAL_EXPIRED',
          message: 'The reply reached core acceptance at or after the deadline',
        };
      } else if (wait.binding !== binding(call))
        rejection = {
          code: 'APPROVAL_BINDING',
          message: 'The planned action differs from the approval binding',
        };
      let receipt: Receipt<ApprovalAcceptance>;
      if (rejection)
        receipt = {
          requestId: request.requestId,
          status: 'rejected',
          target: work.id,
          reason: rejection,
        };
      else {
        const approved = request.payload.decision === 'approve';
        store.db
          .prepare('UPDATE waits SET status=? WHERE id=?')
          .run(approved ? 'approved' : 'denied', wait.id);
        if (approved)
          store.db.prepare("UPDATE work SET status='active',eligible=1 WHERE id=?").run(work.id);
        else
          settleWithoutAttempt(
            store,
            wait,
            'APPROVAL_DENIED',
            'The authorized responder declined this action',
          );
        receipt = {
          requestId: request.requestId,
          status: 'accepted',
          target: work.id,
          value: { wait: request.wait, decision: request.payload.decision },
        };
      }
      receipt.cursor = store.event(work.id, 'approval.reply', {
        waitId: wait.id,
        status: receipt.status,
        ...(receipt.status === 'accepted' ? { decision: request.payload.decision } : {}),
      }) as ProgressCursor;
      store.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
        .run(scope, request.requestId, command, work.id, canonical(receipt));
      return receipt;
    }),
  );
}

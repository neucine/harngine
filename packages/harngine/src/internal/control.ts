import { entityId } from './id.js';
import {
  RuntimeError,
  requestId,
  type AnyWorkflow,
  type CancelRequest,
  type ReviseRequest,
  type Json,
  type Receipt,
  type ControlAcceptance,
  type ControlToken,
  type Closure,
  type ObjectiveRevision,
  type WorkId,
  type ProgressCursor,
  type Reason,
  type WorkRef,
} from './contracts.js';
import { canonical, copy, validate } from '../schema.js';
import { exact, reason } from './core.js';
import { withdrawWaits } from './wait.js';
import { disposeInputs } from './input.js';
import { withdrawApprovals } from './approval.js';
import type { SqliteStore } from './store.js';

type ControlRequest = CancelRequest | ReviseRequest<Json>;
export interface ControlResult {
  receipt: Receipt<ControlAcceptance>;
  changed: boolean;
}

/** Accept control and its receipt in one transaction. Never execute user behavior here. */
export function controlWork(
  store: SqliteStore,
  caller: { principal: string; source: string },
  target: WorkRef,
  kind: 'cancel' | 'revise',
  input: ControlRequest,
  definition: AnyWorkflow | undefined,
  closed: (workId: WorkId, closure: Closure) => void = () => {},
): ControlResult {
  const request = copy(input);
  requestId(request.requestId);
  const scope = canonical([caller.principal, caller.source]);
  const command = canonical({ type: kind, target, request });
  const row = store.work(target.id);
  if (row.principal !== caller.principal)
    throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
  const previous = store.db
    .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
    .get(scope, request.requestId) as { command: string; receipt: string } | undefined;
  // Check retries before the current lifecycle/token. A lost acknowledgement remains recoverable.
  if (previous)
    return {
      receipt:
        previous.command === command
          ? JSON.parse(previous.receipt)
          : {
              requestId: request.requestId,
              status: 'conflict',
              target: target.id,
              reason: {
                code: 'IDENTITY_CONFLICT',
                message: 'Request identity has different content',
              },
            },
      changed: false,
    };

  let invalid: Reason | undefined;
  try {
    exact(
      request,
      kind === 'cancel'
        ? ['requestId', 'expectedControl', 'reason']
        : ['requestId', 'expectedControl', 'objective'],
    );
    if (typeof request.expectedControl !== 'string' || !request.expectedControl)
      throw new RuntimeError('INVALID_CONTROL', 'Expected a control token');
    if (kind === 'cancel') {
      if (!('reason' in request) || typeof request.reason !== 'string' || !request.reason)
        throw new RuntimeError('INVALID_REASON', 'Cancellation needs a reason');
    } else {
      if (!definition)
        throw new RuntimeError('UNAVAILABLE', 'Pinned objective contract is unavailable');
      validate(definition.objective, (request as ReviseRequest<Json>).objective);
    }
  } catch (error) {
    invalid = reason(error);
  }

  return store.write(() => {
    const current = store.work(target.id);
    let receipt: Receipt<ControlAcceptance>;
    let changed = false;
    if (current.status === 'closed')
      receipt = {
        requestId: request.requestId,
        status: 'rejected',
        target: target.id,
        reason: { code: 'WORK_CLOSED', message: 'Closed Work cannot accept a new control command' },
      };
    else if (current.control_token !== request.expectedControl)
      receipt = {
        requestId: request.requestId,
        status: 'conflict',
        target: target.id,
        reason: {
          code: 'STALE_CONTROL',
          message: 'Inspect current intent before submitting a new command',
        },
      };
    else if (
      kind === 'revise' &&
      store.db
        .prepare(
          `SELECT 1 FROM child_work c JOIN work w ON w.id=c.child_work_id
           WHERE c.parent_work_id=? AND w.status!='closed' LIMIT 1`,
        )
        .get(target.id)
    )
      receipt = {
        requestId: request.requestId,
        status: 'rejected',
        target: target.id,
        reason: {
          code: 'CHILD_ACTIVE',
          message: 'Work with an active child cannot be revised',
        },
      };
    else if (invalid)
      receipt = {
        requestId: request.requestId,
        status: 'rejected',
        target: target.id,
        reason: invalid,
      };
    else {
      const token = entityId('control') as ControlToken;
      const revision = (current.objective_revision +
        (kind === 'revise' ? 1 : 0)) as ObjectiveRevision;
      // Only unadmitted plans are withdrawn; admitted calls retain their original accounting.
      store.db
        .prepare("UPDATE requests SET status='withdrawn' WHERE work_id=? AND status='planned'")
        .run(target.id);
      withdrawApprovals(store, target.id);
      withdrawWaits(store, target.id);
      disposeInputs(store, target.id, kind === 'revise' ? 'superseded' : 'canceled', {
        code: kind === 'revise' ? 'SUPERSEDED' : 'CANCELED',
        message:
          kind === 'revise'
            ? 'Input belongs to the previous objective revision'
            : 'Work was canceled',
      });
      if (kind === 'cancel') {
        const descendants = store.db
          .prepare(
            `WITH RECURSIVE descendants(id,depth) AS (
               SELECT child_work_id,1 FROM child_work WHERE parent_work_id=?
               UNION ALL
               SELECT c.child_work_id,d.depth+1
               FROM child_work c JOIN descendants d ON c.parent_work_id=d.id
             )
             SELECT w.id,d.depth FROM descendants d JOIN work w ON w.id=d.id
             WHERE w.status!='closed' ORDER BY d.depth DESC`,
          )
          .all(target.id) as { id: string; depth: number }[];
        for (const descendant of descendants) {
          const childClosure: Closure = {
            status: 'canceled',
            reason: { code: 'PARENT_CANCELED', message: 'Parent Work was canceled' },
          };
          store.db
            .prepare("UPDATE requests SET status='withdrawn' WHERE work_id=? AND status='planned'")
            .run(descendant.id);
          withdrawApprovals(store, descendant.id);
          withdrawWaits(store, descendant.id);
          disposeInputs(store, descendant.id, 'canceled', childClosure.reason);
          store.db
            .prepare(
              "UPDATE work SET status='closed',eligible=0,closure=?,control_token=? WHERE id=?",
            )
            .run(canonical(childClosure), entityId('control'), descendant.id);
          closed(descendant.id as WorkId, childClosure);
          store.event(descendant.id, 'work.canceled', {
            reason: childClosure.reason,
            parentWorkId: target.id,
          });
        }
        const closure = {
          status: 'canceled' as const,
          reason: { code: 'CANCELED', message: (request as CancelRequest).reason },
        };
        store.db
          .prepare(
            "UPDATE work SET status='closed',eligible=0,closure=?,control_token=? WHERE id=?",
          )
          .run(canonical(closure), token, target.id);
        closed(target.id, closure);
      } else {
        const objective = canonical((request as ReviseRequest<Json>).objective);
        const unresolved = store
          .requests(target.id)
          .some((r) => r.status === 'admitted' || r.status === 'unknown');
        store.db
          .prepare(
            'UPDATE work SET objective=?,objective_revision=?,control_token=?,status=?,eligible=? WHERE id=?',
          )
          .run(
            objective,
            revision,
            token,
            unresolved ? 'waiting' : 'active',
            unresolved ? 0 : 1,
            target.id,
          );
        store.db
          .prepare('INSERT INTO objective_revisions VALUES(?,?,?,?)')
          .run(target.id, revision, objective, token);
      }
      const cursor = store.event(target.id, kind === 'cancel' ? 'work.canceled' : 'work.revised', {
        revision,
        controlToken: token,
      }) as ProgressCursor;
      receipt = {
        requestId: request.requestId,
        status: 'accepted',
        target: target.id,
        cursor,
        value: { revision, controlToken: token },
      };
      changed = true;
    }
    if (receipt.status !== 'accepted')
      receipt.cursor = store.event(target.id, 'control.disposed', {
        status: receipt.status,
        reason: receipt.reason,
      }) as ProgressCursor;
    store.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(scope, request.requestId, command, target.id as WorkId, canonical(receipt));
    return { receipt, changed };
  });
}

import { entityId } from './id.js';
import {
  RuntimeError,
  requestId,
  type AnyWorkflow,
  type InputRequest,
  type InputAcceptance,
  type InputRecord,
  type InputDisposition,
  type Receipt,
  type Reason,
  type WorkRef,
  type ObjectiveRevision,
  type ProgressCursor,
} from './contracts.js';
import { canonical, copy, validate } from '../schema.js';
import { exact, reason } from './core.js';
import type { SqliteStore } from './store.js';

interface InputRow {
  id: string;
  accepted_sequence: number;
  objective_revision: number;
  payload: string;
  status: InputRecord['status'];
  reason: string | null;
  decision_sequence: number | null;
}
function record(row: InputRow): InputRecord {
  return {
    id: row.id,
    sequence: row.accepted_sequence,
    objectiveRevision: row.objective_revision as ObjectiveRevision,
    payload: JSON.parse(row.payload),
    status: row.status,
    reason: row.reason ? JSON.parse(row.reason) : null,
    decision: row.decision_sequence,
  };
}
export function inputRecords(store: SqliteStore, workId: string): InputRecord[] {
  return (
    store.db
      .prepare('SELECT * FROM inputs WHERE work_id=? ORDER BY accepted_sequence')
      .all(workId) as InputRow[]
  ).map(record);
}
export function pendingInputs(store: SqliteStore, workId: string, limit: number): InputRecord[] {
  return (
    store.db
      .prepare(
        "SELECT * FROM inputs WHERE work_id=? AND status='pending' ORDER BY accepted_sequence LIMIT ?",
      )
      .all(workId, limit) as InputRow[]
  ).map(record);
}
export function latestInputSequence(store: SqliteStore, workId: string): number {
  return (
    store.db
      .prepare('SELECT COALESCE(MAX(accepted_sequence),0) AS n FROM inputs WHERE work_id=?')
      .get(workId) as { n: number }
  ).n;
}
export function inputCount(store: SqliteStore, workId: string): number {
  return (
    store.db
      .prepare("SELECT COUNT(*) AS n FROM inputs WHERE work_id=? AND status='pending'")
      .get(workId) as { n: number }
  ).n;
}
/** Accept evidence and its receipt atomically; acceptance does not acknowledge incorporation. */
export function acceptInput(
  store: SqliteStore,
  caller: { principal: string; source: string },
  target: WorkRef,
  input: InputRequest,
  definition: AnyWorkflow | undefined,
  transaction = true,
): Receipt<InputAcceptance> {
  const row = store.work(target.id);
  if (row.principal !== caller.principal)
    throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
  const request = copy(input);
  requestId(request.requestId);
  const scope = canonical([caller.principal, caller.source]);
  const command = canonical({ type: 'input', target, request });
  const previous = store.db
    .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
    .get(scope, request.requestId) as { command: string; receipt: string } | undefined;
  if (previous)
    return previous.command === command
      ? JSON.parse(previous.receipt)
      : {
          requestId: request.requestId,
          status: 'conflict',
          target: target.id,
          reason: { code: 'IDENTITY_CONFLICT', message: 'Request identity has different content' },
        };
  let invalid: Reason | undefined;
  try {
    exact(request, ['requestId', 'objectiveRevision', 'payload']);
    if (!Number.isSafeInteger(request.objectiveRevision) || request.objectiveRevision < 1)
      throw new RuntimeError('INVALID_REVISION', 'Expected an objective revision');
    if (!definition) throw new RuntimeError('UNAVAILABLE', 'Pinned input contract is unavailable');
    if (!definition.input)
      throw new RuntimeError('INPUT_UNSUPPORTED', 'Workflow does not accept ordinary input');
    validate(definition.input.schema, request.payload);
  } catch (error) {
    invalid = reason(error);
  }
  const commit = () => {
    const current = store.work(target.id);
    let receipt: Receipt<InputAcceptance>;
    let rejection = invalid;
    if (current.status === 'closed')
      rejection = { code: 'WORK_CLOSED', message: 'Ordinary input intake is closed' };
    else if (current.objective_revision !== request.objectiveRevision)
      rejection = {
        code: 'STALE_REVISION',
        message: 'Input targets a different objective revision',
      };
    else if (!invalid && inputCount(store, target.id) >= definition!.input!.maxPending)
      rejection = { code: 'INPUT_CAPACITY', message: 'Pending input capacity is full' };
    if (rejection) {
      const cursor = store.event(target.id, 'input.rejected', {
        reason: rejection,
      }) as ProgressCursor;
      receipt = {
        requestId: request.requestId,
        status: 'rejected',
        target: target.id,
        cursor,
        reason: rejection,
      };
    } else {
      const sequence = latestInputSequence(store, target.id) + 1;
      const id = entityId('input');
      const cursor = store.event(target.id, 'input.accepted', {
        id,
        sequence,
        objectiveRevision: request.objectiveRevision,
      }) as ProgressCursor;
      receipt = {
        requestId: request.requestId,
        status: 'accepted',
        target: target.id,
        cursor,
        value: { id, sequence },
      };
    }
    store.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(scope, request.requestId, command, target.id, canonical(receipt));
    if (receipt.status === 'accepted') {
      store.db
        .prepare(
          "INSERT INTO inputs(id,work_id,accepted_sequence,objective_revision,source_scope,request_id,payload,status) VALUES(?,?,?,?,?,?,?,'pending')",
        )
        .run(
          receipt.value.id,
          target.id,
          receipt.value.sequence,
          current.objective_revision,
          scope,
          request.requestId,
          canonical(request.payload),
        );
      // This first sequential profile incorporates evidence after outstanding calls settle.
      const outstanding = store
        .requests(target.id)
        .some((r) => r.status === 'planned' || r.status === 'admitted' || r.status === 'unknown');
      const activeChild = store.db
        .prepare(
          `SELECT 1 FROM child_work c JOIN work w ON w.id=c.child_work_id
           WHERE c.parent_work_id=? AND w.status!='closed' LIMIT 1`,
        )
        .get(target.id);
      if (!outstanding && !activeChild)
        store.db.prepare("UPDATE work SET status='active',eligible=1 WHERE id=?").run(target.id);
    }
    return receipt;
  };
  return transaction ? store.write(commit) : commit();
}
/** Called only inside the decision transaction after proposal validation. */
export function incorporateInputs(
  store: SqliteStore,
  workId: string,
  sequence: number,
  dispositions: readonly InputDisposition[],
): void {
  for (const disposition of dispositions) {
    const update = store.db
      .prepare(
        "UPDATE inputs SET status=?,reason=?,decision_sequence=? WHERE id=? AND work_id=? AND status='pending'",
      )
      .run(
        disposition.status,
        disposition.status === 'ignored' ? canonical(disposition.reason) : null,
        sequence,
        disposition.id,
        workId,
      );
    if (update.changes !== 1)
      throw new RuntimeError(
        'STALE_INPUT',
        'Input disposition no longer matches the decision boundary',
      );
    store.event(
      workId,
      'input.settled',
      {
        id: disposition.id,
        status: disposition.status,
        ...(disposition.status === 'ignored' ? { reason: disposition.reason } : {}),
      },
      sequence,
    );
  }
}
/** Revision and closure dispose remaining evidence without claiming behavior incorporated it. */
export function disposeInputs(
  store: SqliteStore,
  workId: string,
  status: 'superseded' | 'canceled' | 'failed',
  reason: Reason,
): void {
  const pending = store.db
    .prepare(
      "SELECT id FROM inputs WHERE work_id=? AND status='pending' ORDER BY accepted_sequence",
    )
    .all(workId) as { id: string }[];
  store.db
    .prepare("UPDATE inputs SET status=?,reason=? WHERE work_id=? AND status='pending'")
    .run(status, canonical(reason), workId);
  for (const input of pending)
    store.event(workId, 'input.settled', { id: input.id, status, reason });
}

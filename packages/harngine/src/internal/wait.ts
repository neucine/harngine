import { entityId } from './id.js';
import {
  RuntimeError,
  requestId,
  type AnyWorkflow,
  type WaitPlan,
  type WorkflowWait,
  type ReplyRequest,
  type ReplyAcceptance,
  type Receipt,
  type WorkRef,
  type WaitRef,
  type WorkId,
  type ObjectiveRevision,
  type ControlToken,
  type ProgressCursor,
  type Reason,
} from './contracts.js';
import { canonical, copy, frozen, key, resolveSchema, schema, validate } from '../schema.js';
import { exact, reason, waitLeaves } from './core.js';
import type { SqliteStore, WorkRow } from './store.js';
interface WaitRow {
  id: string;
  work_id: string;
  slot: string;
  decision_sequence: number;
  kind: 'reply' | 'timer';
  objective_revision: number;
  control_token: string;
  schema: string | null;
  prompt: string | null;
  timer_operation: 'sleep' | 'now' | null;
  timer_delay_ms: number | null;
  interaction_type: 'question' | 'approval' | null;
  presentation: string | null;
  responders: string;
  deadline: number | null;
  status: WorkflowWait['status'];
  payload: string | null;
  responded_by: string | null;
}
function describe(row: WaitRow, blocking: boolean): WorkflowWait {
  return frozen({
    wait: { id: row.id, workId: row.work_id as WorkId },
    slot: row.slot,
    kind: row.kind,
    decisionSequence: row.decision_sequence,
    objectiveRevision: row.objective_revision as ObjectiveRevision,
    controlToken: row.control_token as ControlToken,
    schema: row.schema ? JSON.parse(row.schema) : null,
    prompt: row.prompt,
    blocking,
    interaction: row.interaction_type ?? 'question',
    presentation: row.presentation === null ? null : JSON.parse(row.presentation),
    operation: row.timer_operation,
    delayMs: row.timer_delay_ms,
    responders: JSON.parse(row.responders),
    deadline: row.deadline,
    status: row.status,
    payload: row.payload === null ? null : JSON.parse(row.payload),
    respondedBy: row.responded_by,
  });
}
export function workflowWaits(store: SqliteStore, workId: string): WorkflowWait[] {
  const blocking = new Set(
    (
      store.db.prepare('SELECT wait_id FROM wake_dependencies WHERE work_id=?').all(workId) as {
        wait_id: string;
      }[]
    ).map((row) => row.wait_id),
  );
  return (
    store.db
      .prepare('SELECT * FROM workflow_waits WHERE work_id=? ORDER BY decision_sequence,rowid')
      .all(workId) as WaitRow[]
  ).map((row) => describe(row, blocking.has(row.id)));
}
function authorized(
  store: SqliteStore,
  caller: { principal: string },
  work: WorkRef,
  ref: WaitRef,
  inspection = false,
): WaitRow {
  const current = store.work(work.id);
  if (!ref || canonical(work.definition) !== current.definition || ref.workId !== work.id)
    throw new RuntimeError('SCOPE_MISMATCH', 'Wait target does not match Work');
  const row = store.db
    .prepare('SELECT * FROM workflow_waits WHERE id=? AND work_id=?')
    .get(ref.id, work.id) as WaitRow | undefined;
  if (!row) throw new RuntimeError('NOT_FOUND', 'Workflow Wait not found');
  if (
    !(JSON.parse(row.responders) as string[]).includes(caller.principal) &&
    !(inspection && current.principal === caller.principal)
  )
    throw new RuntimeError('ACCESS_DENIED', 'Caller is not an eligible responder');
  return row;
}
export function inspectWait(
  store: SqliteStore,
  caller: { principal: string },
  work: WorkRef,
  ref: WaitRef,
): WorkflowWait {
  const row = authorized(store, caller, work, ref, true);
  const blocking = Boolean(
    store.db
      .prepare('SELECT 1 FROM wake_dependencies WHERE work_id=? AND wait_id=?')
      .get(work.id, row.id),
  );
  return describe(row, blocking);
}
export function isWorkflowWait(store: SqliteStore, ref: WaitRef): boolean {
  return Boolean(
    ref &&
      typeof ref.id === 'string' &&
      store.db.prepare('SELECT id FROM workflow_waits WHERE id=?').get(ref.id),
  );
}
/** Internal resolved predicate: leaves refer to durable identities, never mutable slot lookups. */
type Condition = { type: 'wait'; id: string } | { type: 'all' | 'any'; conditions: Condition[] };
export function validateWaitBindings(
  plan: WaitPlan,
  waits: readonly WorkflowWait[],
  controlToken: string,
): void {
  const existing = new Map(waits.map((wait) => [wait.slot, wait]));
  const planned = new Set<string>();
  for (const leaf of waitLeaves(plan)) {
    const saved = existing.get(leaf.slot);
    if (leaf.type === 'existing') {
      if (!saved || saved.controlToken !== controlToken || saved.status === 'withdrawn')
        throw new RuntimeError(
          'STALE_WAIT',
          'Existing wait must belong to the current authority scope',
        );
    } else {
      if (saved || planned.has(leaf.slot))
        throw new RuntimeError(
          'DUPLICATE_SLOT',
          'Wait slots are unique within Work and a proposal',
        );
      planned.add(leaf.slot);
    }
  }
}
export function clearWakeCondition(store: SqliteStore, workId: string): void {
  store.db.prepare('DELETE FROM wake_dependencies WHERE work_id=?').run(workId);
  // wake_wait_id is the retired single-wait column, retained for the version-5 migration.
  store.db.prepare('UPDATE work SET wake_wait_id=NULL,wake_condition=NULL WHERE id=?').run(workId);
}
/** All registrations, resolved references and the predicate commit atomically with state. */
export function planWait(
  store: SqliteStore,
  row: WorkRow,
  sequence: number,
  plan: WaitPlan,
  definition: AnyWorkflow,
  now: number,
): boolean {
  const refs = new Map<string, string>();
  for (const leaf of waitLeaves(plan)) {
    let wait = store.db
      .prepare('SELECT * FROM workflow_waits WHERE work_id=? AND slot=?')
      .get(row.id, leaf.slot) as WaitRow | undefined;
    if (leaf.type === 'existing') {
      if (!wait || wait.control_token !== row.control_token || wait.status === 'withdrawn')
        throw new RuntimeError(
          'STALE_WAIT',
          'Existing wait must belong to the current authority scope',
        );
    } else {
      if (wait) throw new RuntimeError('DUPLICATE_SLOT', 'Wait slots are unique within Work');
      const delay = leaf.type === 'timer' ? leaf.delayMs : leaf.timeoutMs;
      const deadline = delay === undefined ? null : now + delay;
      if (deadline !== null && !Number.isSafeInteger(deadline))
        throw new RuntimeError('INVALID_TIME', 'Wait deadline exceeds clock range');
      const contract =
        leaf.type === 'reply'
          ? (definition.replySchemas?.find((s) => key(s) === key(leaf.schema)) ??
            resolveSchema(leaf.schema))
          : null;
      const id = entityId('wait');
      store.db
        .prepare(
          "INSERT INTO workflow_waits(id,work_id,slot,decision_sequence,kind,objective_revision,control_token,schema,responders,deadline,status,prompt,timer_operation,timer_delay_ms,interaction_type,presentation) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)",
        )
        .run(
          id,
          row.id,
          leaf.slot,
          sequence,
          leaf.type,
          row.objective_revision,
          row.control_token,
          contract ? canonical(contract) : null,
          canonical(
            leaf.type === 'reply'
              ? leaf.responders.map((responder) =>
                  responder === '$owner' ? row.principal : responder,
                )
              : [],
          ),
          deadline,
          leaf.type === 'reply' ? (leaf.prompt ?? null) : null,
          leaf.type === 'timer' ? (leaf.operation ?? null) : null,
          leaf.type === 'timer' ? leaf.delayMs : null,
          leaf.type === 'reply' ? (leaf.interaction ?? 'question') : null,
          leaf.type === 'reply' && leaf.presentation !== undefined
            ? canonical(leaf.presentation)
            : null,
        );
      wait = store.db.prepare('SELECT * FROM workflow_waits WHERE id=?').get(id) as WaitRow;
    }
    refs.set(leaf.slot, wait!.id);
    if (wait!.status === 'pending' && wait!.deadline !== null && now >= wait!.deadline)
      settleDeadline(store, wait!);
  }
  const resolve = (node: WaitPlan): Condition =>
    'conditions' in node
      ? { type: node.type, conditions: node.conditions.map(resolve) }
      : { type: 'wait', id: refs.get(node.slot)! };
  store.db
    .prepare('UPDATE work SET wake_condition=? WHERE id=?')
    .run(canonical(resolve(plan)), row.id);
  for (const id of new Set(refs.values()))
    store.db.prepare('INSERT INTO wake_dependencies VALUES(?,?)').run(row.id, id);
  return (
    (plan.type === 'reply' && plan.blocking === false) ||
    conditionSatisfied(store, row.id, row.control_token)
  );
}
function conditionSatisfied(store: SqliteStore, workId: string, controlToken: string): boolean {
  const saved = store.db.prepare('SELECT wake_condition FROM work WHERE id=?').get(workId) as {
    wake_condition: string | null;
  };
  if (!saved.wake_condition) return false;
  const rows = store.db
    .prepare('SELECT id,status FROM workflow_waits WHERE work_id=? AND control_token=?')
    .all(workId, controlToken) as { id: string; status: string }[];
  const settled = new Set(
    rows.filter((row) => ['replied', 'expired', 'fired'].includes(row.status)).map((row) => row.id),
  );
  const evaluate = (condition: Condition): boolean =>
    condition.type === 'wait'
      ? settled.has(condition.id)
      : condition.type === 'all'
        ? condition.conditions.every(evaluate)
        : condition.conditions.some(evaluate);
  return evaluate(JSON.parse(saved.wake_condition));
}
/** Notifications cannot bypass an outstanding managed call in the sequential dispatcher. */
function wake(store: SqliteStore, wait: WaitRow): void {
  const dependent = store.db
    .prepare('SELECT 1 FROM wake_dependencies WHERE work_id=? AND wait_id=?')
    .get(wait.work_id, wait.id);
  if (!dependent || !conditionSatisfied(store, wait.work_id, wait.control_token)) return;
  store.db
    .prepare(
      "UPDATE work SET status='active',eligible=1 WHERE id=? AND status!='closed' AND control_token=? AND NOT EXISTS(SELECT 1 FROM requests WHERE work_id=? AND status IN ('planned','admitted','unknown'))",
    )
    .run(wait.work_id, wait.control_token, wait.work_id);
}
function settleDeadline(store: SqliteStore, wait: WaitRow): void {
  const status = wait.kind === 'timer' ? 'fired' : 'expired';
  store.db
    .prepare("UPDATE workflow_waits SET status=? WHERE id=? AND status='pending'")
    .run(status, wait.id);
  wake(store, wait);
  store.event(wait.work_id, 'wait.settled', { waitId: wait.id, status });
}
export function expireWaits(store: SqliteStore, now: number): void {
  store.write(() => {
    const rows = store.db
      .prepare("SELECT * FROM workflow_waits WHERE status='pending' AND deadline<=?")
      .all(now) as WaitRow[];
    for (const wait of rows) settleDeadline(store, wait);
  });
}
export function withdrawWaits(store: SqliteStore, workId: string): void {
  const withdrawn = store.db
    .prepare(
      "SELECT id FROM workflow_waits WHERE work_id=? AND kind='reply' AND status='pending' ORDER BY rowid",
    )
    .all(workId) as { id: string }[];
  store.db
    .prepare("UPDATE workflow_waits SET status='withdrawn' WHERE work_id=? AND status='pending'")
    .run(workId);
  for (const wait of withdrawn)
    store.event(workId, 'interaction.settled', { waitId: wait.id, status: 'withdrawn' });
  clearWakeCondition(store, workId);
}
export function replyWait(
  store: SqliteStore,
  caller: { principal: string; source: string },
  work: WorkRef,
  input: ReplyRequest,
  clock: () => number,
): Receipt<ReplyAcceptance> {
  const request = copy(input);
  requestId(request.requestId);
  const original = authorized(store, caller, work, request.wait);
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
    if (original.kind !== 'reply' || !original.schema)
      throw new RuntimeError('INVALID_REPLY', 'Timers cannot receive replies');
    // Stored contracts remain usable when Workflow code is unavailable. Never weaken validation.
    validate(schema(JSON.parse(original.schema)), request.payload);
  } catch (error) {
    invalid = reason(error);
  }
  return frozen(
    store.write(() => {
      const wait = authorized(store, caller, work, request.wait);
      const current = store.work(work.id);
      let rejection = invalid;
      if (
        current.status === 'closed' ||
        wait.control_token !== current.control_token ||
        wait.status === 'withdrawn'
      )
        rejection = { code: 'STALE_WAIT', message: 'Wait no longer belongs to active authority' };
      else if (wait.status !== 'pending')
        rejection = { code: 'WAIT_SETTLED', message: 'Wait has already settled' };
      else if (wait.deadline !== null && clock() >= wait.deadline) {
        settleDeadline(store, wait);
        rejection = {
          code: 'WAIT_EXPIRED',
          message: 'Reply reached core acceptance at or after the deadline',
        };
      }
      let receipt: Receipt<ReplyAcceptance>;
      if (rejection)
        receipt = {
          requestId: request.requestId,
          status: 'rejected',
          target: work.id,
          reason: rejection,
        };
      else {
        store.db
          .prepare("UPDATE workflow_waits SET status='replied',payload=?,responded_by=? WHERE id=?")
          .run(canonical(request.payload), caller.principal, wait.id);
        wake(store, wait);
        receipt = {
          requestId: request.requestId,
          status: 'accepted',
          target: work.id,
          value: { wait: request.wait },
        };
      }
      receipt.cursor = store.event(work.id, 'wait.reply', {
        waitId: wait.id,
        status: receipt.status,
        ...(receipt.status === 'accepted' ? { resolution: 'replied' } : {}),
      }) as ProgressCursor;
      store.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
        .run(scope, request.requestId, command, work.id, canonical(receipt));
      return receipt;
    }),
  );
}

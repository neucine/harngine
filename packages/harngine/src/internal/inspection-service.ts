import { canonical, frozen } from '../schema.js';
import {
  RuntimeError,
  type CallRecord,
  type Closure,
  type ControlToken,
  type Json,
  type ObjectiveRevision,
  type ProgressCursor,
  type Reason,
  type SessionId,
  type Snapshot,
  type WorkId,
  type WorkRef,
} from './contracts.js';
import type { DefinitionRegistry } from './definition-registry.js';
import { inputRecords } from './input.js';
import type { RequestRow, SqliteStore, WorkRow } from './store.js';
import type { WaitManager } from './wait-manager.js';

export interface RuntimeWorkRecord {
  readonly ref: WorkRef;
  readonly kind: 'agent' | 'workflow';
  readonly objective: Json;
  readonly status: WorkRow['status'];
  readonly closure: Closure | null;
  readonly sessionId: SessionId | null;
  readonly parentId: WorkId | null;
  readonly childWorkIds: readonly WorkId[];
  readonly queued: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Renders committed durable state without owning telemetry or execution transitions. */
export class InspectionService {
  constructor(
    private readonly store: SqliteStore,
    private readonly registry: DefinitionRegistry,
    private readonly waits: WaitManager,
    private readonly isClosed: () => boolean,
  ) {}

  diagnosticRecords(workId: WorkId): readonly { table: string; key: string; value: Json }[] {
    this.open();
    return frozen(this.store.rawRecords(workId));
  }

  workRecord(caller: { readonly principal: string }, id: WorkId): RuntimeWorkRecord {
    this.open();
    const row = this.store.work(id);
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
    return this.projectWork(row);
  }

  workRecords(caller: { readonly principal: string }): readonly RuntimeWorkRecord[] {
    this.open();
    const rows = this.store.db
      .prepare('SELECT * FROM work WHERE principal=?')
      .all(caller.principal) as WorkRow[];
    return frozen(rows.map((row) => this.projectWork(row)));
  }

  eventCursor(
    caller: { readonly principal: string },
    ref: WorkRef,
    eventId: string,
  ): ProgressCursor {
    this.authorize(caller, ref);
    const row = this.store.db
      .prepare('SELECT sequence FROM progress WHERE work_id=? AND event_id=?')
      .get(ref.id, eventId) as { sequence: number } | undefined;
    if (!row) throw new RuntimeError('INVALID_CURSOR', 'Event cursor is unavailable');
    return row.sequence as ProgressCursor;
  }

  authorize(caller: { readonly principal: string }, ref: WorkRef): WorkRow {
    this.open();
    const row = this.store.work(ref.id);
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
    if (row.definition !== canonical(ref.definition))
      throw new RuntimeError('CONTRACT_MISMATCH', 'Work definition does not match reference');
    return row;
  }

  snapshot<O extends Json, R extends Json>(
    caller: { readonly principal: string },
    ref: WorkRef<O, R>,
  ): Snapshot<O, R> {
    const row = this.authorize(caller, ref);
    const definition = this.registry.workflow(JSON.parse(row.definition));
    const unavailable = !definition || definition.tools.some((tool) => !this.registry.tool(tool));
    const concerns: Reason[] = row.concern ? [JSON.parse(row.concern)] : [];
    if (unavailable && row.status !== 'closed')
      concerns.push({
        code: 'DEFINITION_UNAVAILABLE',
        message: 'Pinned behavior or tool is missing; execution is blocked',
      });
    for (const call of this.store.requests(row.id)) {
      if (
        (call.status === 'admitted' || call.status === 'unknown') &&
        !concerns.some((concern) => concern.code === 'UNRESOLVED_ATTEMPT')
      )
        concerns.push({
          code: 'UNRESOLVED_ATTEMPT',
          message: 'An admitted action lacks a conclusive outcome',
        });
    }
    return frozen({
      id: row.id as WorkId,
      objective: JSON.parse(row.objective),
      state: JSON.parse(row.state),
      context: JSON.parse(row.context),
      status: unavailable && row.status !== 'closed' ? 'waiting' : row.status,
      objectiveRevision: row.objective_revision as ObjectiveRevision,
      stateRevision: row.state_revision as ObjectiveRevision,
      controlToken: row.control_token as ControlToken,
      closure: row.closure ? JSON.parse(row.closure) : null,
      calls: this.store.requests(row.id).map(callRecord),
      approvals: this.waits.approvals(row.id),
      waits: this.waits.waits(row.id),
      inputs: inputRecords(this.store, row.id),
      limits: JSON.parse(row.policy),
      usage: {
        decisions: row.decisions,
        attempts: row.spent,
        modelTurns: row.model_turns,
        toolExecutions: row.tool_executions,
      },
      concerns,
      cursor: this.store.cursor(row.id) as ProgressCursor,
    });
  }

  private projectWork(row: WorkRow): RuntimeWorkRecord {
    const definition = JSON.parse(row.definition) as { id: string; version: string };
    const saved = this.store.db
      .prepare('SELECT kind FROM definitions WHERE id=? AND version=? AND kind IN (?,?)')
      .get(definition.id, definition.version, 'agent', 'workflow') as
      | { kind: 'agent' | 'workflow' }
      | undefined;
    if (!saved) throw new RuntimeError('STORAGE_FORMAT', 'Work definition record is missing');
    const times = this.store.db
      .prepare(
        'SELECT MIN(recorded_at) AS created_at,MAX(recorded_at) AS updated_at FROM progress WHERE work_id=?',
      )
      .get(row.id) as { created_at: number | null; updated_at: number | null };
    if (times.created_at === null || times.updated_at === null)
      throw new RuntimeError('STORAGE_FORMAT', 'Work has no durable progress');
    const session = this.store.db
      .prepare('SELECT session_id FROM session_work WHERE work_id=? ORDER BY rowid LIMIT 1')
      .get(row.id) as { session_id: SessionId } | undefined;
    const parent = this.store.db
      .prepare('SELECT parent_work_id FROM child_work WHERE child_work_id=?')
      .get(row.id) as { parent_work_id: string } | undefined;
    const children = this.store.db
      .prepare(
        'SELECT child_work_id FROM child_work WHERE parent_work_id=? ORDER BY decision_sequence,slot',
      )
      .all(row.id) as { child_work_id: string }[];
    return frozen({
      ref: { id: row.id as WorkId, definition },
      kind: saved.kind,
      objective: JSON.parse(row.objective),
      status: row.status,
      closure: row.closure ? JSON.parse(row.closure) : null,
      sessionId: session?.session_id ?? null,
      parentId: (parent?.parent_work_id as WorkId | undefined) ?? null,
      childWorkIds: children.map((child) => child.child_work_id as WorkId),
      queued: Boolean(
        this.store.db.prepare('SELECT 1 FROM session_queue WHERE work_id=?').get(row.id),
      ),
      createdAt: times.created_at,
      updatedAt: times.updated_at,
    });
  }

  private open(): void {
    if (this.isClosed()) throw new RuntimeError('CLOSED', 'Runtime is closed');
  }
}

export function callRecord(row: RequestRow): CallRecord {
  return {
    id: row.id,
    slot: row.slot,
    tool: JSON.parse(row.tool),
    input: JSON.parse(row.input),
    objectiveRevision: row.objective_revision as ObjectiveRevision,
    status: row.status,
    outcome: row.outcome ? JSON.parse(row.outcome) : null,
  };
}

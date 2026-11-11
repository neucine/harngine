import {
  RuntimeError,
  type WorkHistoryOptions,
  type WorkHistory,
  type ProgressCursor,
  type DecisionInspection,
  type CallInspection,
} from './contracts.js';
import { exact } from './core.js';
import { frozen } from '../schema.js';
import type { SqliteStore, RequestRow } from './store.js';

/** Authorization is performed by the caller-bound runtime before these read-only queries. */
export function workHistory(
  store: SqliteStore,
  id: string,
  options: WorkHistoryOptions,
): WorkHistory {
  exact(options, ['after', 'through', 'limit']);
  const head = store.cursor(id);
  const after = options.after ?? 0,
    through = options.through ?? head,
    limit = options.limit ?? 50;
  if (
    !Number.isSafeInteger(after) ||
    !Number.isSafeInteger(through) ||
    after < 0 ||
    through < after ||
    through > head
  )
    throw new RuntimeError('INVALID_CURSOR', 'Expected 0 <= after <= through <= current cursor');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RuntimeError('INVALID_LIMIT', 'History limit must be between 1 and 100');
  const rows = store.db
    .prepare(
      'SELECT * FROM progress WHERE work_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?',
    )
    .all(id, after, through, limit + 1) as {
    sequence: number;
    event_id: string;
    kind: string;
    body: string;
    recorded_at: number | null;
    decision_sequence: number | null;
  }[];
  const events = rows.slice(0, limit).map((row) => ({
    id: row.event_id,
    cursor: row.sequence as ProgressCursor,
    kind: row.kind,
    body: JSON.parse(row.body),
    recordedAt: row.recorded_at,
    decisionSequence: row.decision_sequence,
  }));
  return frozen({
    events,
    nextCursor: (events.at(-1)?.cursor ?? after) as ProgressCursor,
    through: through as ProgressCursor,
    hasMore: rows.length > limit,
  });
}
export function inspectDecision(
  store: SqliteStore,
  id: string,
  sequence: number,
): DecisionInspection {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new RuntimeError('INVALID_SEQUENCE', 'Decision sequence must be a positive safe integer');
  const row = store.db
    .prepare('SELECT * FROM decisions WHERE work_id=? AND sequence=?')
    .get(id, sequence) as
    | { body: string; input_boundary: number; input_ids: string; context: string | null }
    | undefined;
  if (!row) throw new RuntimeError('NOT_FOUND', 'Committed decision not found in this Work');
  return frozen({
    sequence,
    proposal: JSON.parse(row.body),
    inputBoundary: row.input_boundary,
    inputIds: JSON.parse(row.input_ids),
    context: row.context === null ? null : JSON.parse(row.context),
  });
}
export function inspectCall(store: SqliteStore, id: string, operationId: string): CallInspection {
  if (typeof operationId !== 'string' || !operationId)
    throw new RuntimeError('INVALID_OPERATION', 'Call identity is required');
  const row = store.db
    .prepare('SELECT * FROM requests WHERE work_id=? AND id=?')
    .get(id, operationId) as RequestRow | undefined;
  if (!row) throw new RuntimeError('NOT_FOUND', 'Call not found in this Work');
  const attempts = store.db
    .prepare(`SELECT a.id,a.sequence,a.status,COALESCE(c.amount,0) AS charged,o.body AS outcome
    FROM attempts a LEFT JOIN capacity_entries c ON c.attempt_id=a.id LEFT JOIN attempt_outcomes o ON o.attempt_id=a.id
    WHERE a.operation_id=? ORDER BY a.sequence`)
    .all(row.id) as {
    id: string;
    sequence: number;
    status: 'admitted' | 'settled' | 'unknown';
    charged: number;
    outcome: string | null;
  }[];
  return frozen({
    id: row.id,
    slot: row.slot,
    objectiveRevision: row.objective_revision as CallInspection['objectiveRevision'],
    status: row.status,
    outcome: row.outcome === null ? null : JSON.parse(row.outcome),
    tool: JSON.parse(row.tool),
    input: JSON.parse(row.input),
    decisionSequence: row.decision_sequence,
    controlToken: row.control_token as CallInspection['controlToken'],
    attempts: attempts.map((attempt) => ({
      ...attempt,
      outcome: attempt.outcome === null ? null : JSON.parse(attempt.outcome),
    })),
  });
}

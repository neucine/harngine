// Existing migration bodies are immutable: changing one invalidates its checksum.
const initial = `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT;
CREATE TABLE runtime_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL) STRICT;
INSERT INTO runtime_owner VALUES(1,0);
CREATE TABLE definitions (kind TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL,
  PRIMARY KEY(kind,id,version)) STRICT;
CREATE TABLE work (id TEXT PRIMARY KEY, principal TEXT NOT NULL, definition TEXT NOT NULL, objective TEXT NOT NULL,
  state TEXT NOT NULL, policy TEXT NOT NULL, basis INTEGER NOT NULL DEFAULT 0, decisions INTEGER NOT NULL DEFAULT 0,
  spent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('active','waiting','closed')),
  closure TEXT, eligible INTEGER NOT NULL CHECK(eligible IN (0,1)), concern TEXT) STRICT;
CREATE INDEX eligible_work ON work(eligible,id);
CREATE TABLE receipts (source_scope TEXT NOT NULL, request_id TEXT NOT NULL, command TEXT NOT NULL,
  work_id TEXT REFERENCES work(id), receipt TEXT NOT NULL, PRIMARY KEY(source_scope,request_id)) STRICT;
CREATE TABLE decisions (work_id TEXT NOT NULL REFERENCES work(id), sequence INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(work_id,sequence)) STRICT;
CREATE TABLE requests (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work(id), decision_sequence INTEGER NOT NULL,
  slot TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT,
  UNIQUE(work_id,decision_sequence,slot), UNIQUE(work_id,slot),
  FOREIGN KEY(work_id,decision_sequence) REFERENCES decisions(work_id,sequence)) STRICT;
CREATE TABLE operations (id TEXT PRIMARY KEY REFERENCES requests(id)) STRICT;
CREATE TABLE attempts (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  sequence INTEGER NOT NULL, status TEXT NOT NULL, owner_epoch INTEGER NOT NULL,
  UNIQUE(operation_id,sequence)) STRICT;
CREATE TABLE capacity_entries (attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), work_id TEXT NOT NULL REFERENCES work(id), amount INTEGER NOT NULL CHECK(amount=1)) STRICT;
CREATE TABLE attempt_outcomes (attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), body TEXT NOT NULL) STRICT;
CREATE TABLE progress (work_id TEXT NOT NULL REFERENCES work(id), sequence INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(work_id,sequence)) STRICT;
`;
const controls = `
ALTER TABLE work ADD COLUMN objective_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE work ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE work ADD COLUMN control_token TEXT NOT NULL DEFAULT '';
UPDATE work SET control_token=lower(hex(randomblob(16)));
ALTER TABLE requests ADD COLUMN objective_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE requests ADD COLUMN control_token TEXT NOT NULL DEFAULT '';
UPDATE requests SET control_token=(SELECT control_token FROM work WHERE work.id=requests.work_id);
CREATE TABLE objective_revisions (
  work_id TEXT NOT NULL REFERENCES work(id), revision INTEGER NOT NULL, objective TEXT NOT NULL,
  control_token TEXT NOT NULL, PRIMARY KEY(work_id,revision)
) STRICT;
INSERT INTO objective_revisions SELECT id,objective_revision,objective,control_token FROM work;
`;
const approvals = `
CREATE TABLE waits (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  binding TEXT NOT NULL, approvers TEXT NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','expired','withdrawn')),
  invalidation TEXT CHECK(invalidation IN ('expired','withdrawn')),
  admitted_attempt_id TEXT UNIQUE REFERENCES attempts(id)
) STRICT;
CREATE INDEX approval_deadlines ON waits(expires_at) WHERE admitted_attempt_id IS NULL AND invalidation IS NULL AND status IN ('pending','approved');
`;
const inputs = `
CREATE TABLE inputs (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work(id),
  accepted_sequence INTEGER NOT NULL, objective_revision INTEGER NOT NULL,
  source_scope TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','incorporated','ignored','superseded','canceled','failed')),
  reason TEXT, decision_sequence INTEGER,
  UNIQUE(work_id,accepted_sequence), UNIQUE(source_scope,request_id),
  FOREIGN KEY(source_scope,request_id) REFERENCES receipts(source_scope,request_id),
  FOREIGN KEY(work_id,decision_sequence) REFERENCES decisions(work_id,sequence)
) STRICT;
CREATE INDEX pending_inputs ON inputs(work_id,accepted_sequence) WHERE status='pending';
ALTER TABLE decisions ADD COLUMN input_boundary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN input_ids TEXT NOT NULL DEFAULT '[]';
`;
const workflowWaits = `
CREATE TABLE workflow_waits (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work(id), slot TEXT NOT NULL,
  decision_sequence INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reply','timer')),
  objective_revision INTEGER NOT NULL, control_token TEXT NOT NULL, schema TEXT,
  responders TEXT NOT NULL, deadline INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','replied','expired','fired','withdrawn')),
  payload TEXT, responded_by TEXT,
  UNIQUE(work_id,slot), FOREIGN KEY(work_id,decision_sequence) REFERENCES decisions(work_id,sequence)
) STRICT;
CREATE INDEX workflow_wait_deadlines ON workflow_waits(deadline) WHERE status='pending' AND deadline IS NOT NULL;
ALTER TABLE work ADD COLUMN wake_wait_id TEXT REFERENCES workflow_waits(id);
`;
const waitConditions = `
ALTER TABLE work ADD COLUMN wake_condition TEXT;
CREATE TABLE wake_dependencies (
  work_id TEXT NOT NULL REFERENCES work(id), wait_id TEXT NOT NULL REFERENCES workflow_waits(id),
  PRIMARY KEY(work_id,wait_id)
) STRICT;
CREATE INDEX wait_dependents ON wake_dependencies(wait_id,work_id);
UPDATE work SET wake_condition=json_object('type','wait','id',wake_wait_id) WHERE wake_wait_id IS NOT NULL;
INSERT INTO wake_dependencies SELECT id,wake_wait_id FROM work WHERE wake_wait_id IS NOT NULL;
`;
const sessions = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, principal TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','closed')), version INTEGER NOT NULL,
  cursor INTEGER NOT NULL, max_entries INTEGER NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER
) STRICT;
CREATE TABLE session_receipts (
  source_scope TEXT NOT NULL, request_id TEXT NOT NULL, session_id TEXT REFERENCES sessions(id),
  PRIMARY KEY(source_scope,request_id),
  FOREIGN KEY(source_scope,request_id) REFERENCES receipts(source_scope,request_id)
) STRICT;
CREATE TABLE session_entries (
  session_id TEXT NOT NULL REFERENCES sessions(id), sequence INTEGER NOT NULL, version INTEGER NOT NULL,
  source TEXT NOT NULL, recorded_at INTEGER NOT NULL, body TEXT NOT NULL,
  source_scope TEXT NOT NULL, request_id TEXT NOT NULL,
  PRIMARY KEY(session_id,sequence), UNIQUE(source_scope,request_id),
  FOREIGN KEY(source_scope,request_id) REFERENCES session_receipts(source_scope,request_id)
) STRICT;
CREATE TABLE session_work (
  session_id TEXT NOT NULL REFERENCES sessions(id), work_id TEXT NOT NULL REFERENCES work(id),
  PRIMARY KEY(session_id,work_id)
) STRICT;
`;
const inspection = `
ALTER TABLE progress ADD COLUMN recorded_at INTEGER;
ALTER TABLE progress ADD COLUMN decision_sequence INTEGER;
ALTER TABLE decisions ADD COLUMN context TEXT;
`;
const harness = `
ALTER TABLE work ADD COLUMN context TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN agent TEXT;
ALTER TABLE sessions ADD COLUMN foreground_work_id TEXT REFERENCES work(id);
`;
const interactionPrompts = `
ALTER TABLE workflow_waits ADD COLUMN prompt TEXT;
`;
const workflowTimerMetadata = `
ALTER TABLE workflow_waits ADD COLUMN timer_operation TEXT;
ALTER TABLE workflow_waits ADD COLUMN timer_delay_ms INTEGER;
`;
const interactionPresentation = `
ALTER TABLE workflow_waits ADD COLUMN interaction_type TEXT;
ALTER TABLE workflow_waits ADD COLUMN presentation TEXT;
`;
const layeredUsage = `
ALTER TABLE work ADD COLUMN model_turns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work ADD COLUMN tool_executions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work ADD COLUMN operations INTEGER NOT NULL DEFAULT 0;
`;
const publicProjections = `
ALTER TABLE progress ADD COLUMN projection TEXT;
`;
const authorizationDecisions = `
CREATE TABLE authorization_decisions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('start','call','respond')),
  principal TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  work_id TEXT,
  target_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  safe_reason TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE(action,target_id)
) STRICT;
CREATE INDEX authorization_work ON authorization_decisions(work_id,recorded_at,id);
`;
const sessionQueue = `
CREATE TABLE session_queue (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL,
  work_id TEXT NOT NULL UNIQUE REFERENCES work(id),
  PRIMARY KEY(session_id,sequence),
  FOREIGN KEY(session_id,sequence) REFERENCES session_entries(session_id,sequence)
) STRICT;
CREATE INDEX queued_session_work ON session_queue(session_id,sequence);
`;
const effectResolutions = `
CREATE TABLE effect_resolutions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  source_scope TEXT NOT NULL,
  request_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE(source_scope,request_id),
  FOREIGN KEY(source_scope,request_id) REFERENCES receipts(source_scope,request_id)
) STRICT;
CREATE INDEX effect_resolution_operation ON effect_resolutions(operation_id,recorded_at,id);
`;
const effectReconciliation = `
CREATE TABLE effect_reconciliation_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  status TEXT NOT NULL CHECK(status IN ('planned','admitted','settled')),
  owner_epoch INTEGER NOT NULL,
  outcome TEXT,
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE TABLE tool_effect_resolutions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  reconciliation_attempt_id TEXT NOT NULL UNIQUE REFERENCES effect_reconciliation_attempts(id),
  resolution TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE INDEX tool_effect_resolution_operation
  ON tool_effect_resolutions(operation_id,recorded_at,id);
`;
const childWork = `
CREATE TABLE child_work (
  parent_work_id TEXT NOT NULL REFERENCES work(id),
  slot TEXT NOT NULL,
  child_work_id TEXT NOT NULL UNIQUE REFERENCES work(id),
  decision_sequence INTEGER NOT NULL,
  control_token TEXT NOT NULL,
  PRIMARY KEY(parent_work_id,slot),
  FOREIGN KEY(parent_work_id,decision_sequence) REFERENCES decisions(work_id,sequence)
) STRICT;
CREATE INDEX child_work_parent ON child_work(parent_work_id,decision_sequence);
`;
const executableCalls = `
ALTER TABLE child_work ADD COLUMN call_id TEXT;
ALTER TABLE child_work ADD COLUMN mode TEXT NOT NULL DEFAULT 'sequential' CHECK(mode IN ('sequential','concurrent'));
ALTER TABLE child_work ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'workflow' CHECK(target_kind IN ('agent','workflow'));
ALTER TABLE child_work ADD COLUMN join_decision INTEGER;
ALTER TABLE child_work ADD COLUMN join_slot TEXT;
UPDATE child_work SET call_id='call_' || lower(hex(randomblob(12)));
CREATE UNIQUE INDEX child_work_call ON child_work(call_id);
`;
const executableCallBackfill = `
UPDATE child_work
SET target_kind='agent'
WHERE EXISTS (
  SELECT 1
  FROM work w
  JOIN definitions d
    ON d.kind='agent'
   AND d.id=json_extract(w.definition,'$.id')
   AND d.version=json_extract(w.definition,'$.version')
  WHERE w.id=child_work.child_work_id
);
`;
const sessionHandoff = `
ALTER TABLE authorization_decisions RENAME TO authorization_decisions_previous;
CREATE TABLE authorization_decisions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('start','call','respond','handoff')),
  principal TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  work_id TEXT,
  target_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  safe_reason TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE(action,target_id)
) STRICT;
INSERT INTO authorization_decisions
  SELECT id,action,principal,policy_revision,allowed,work_id,target_id,subject,input_digest,
    safe_reason,recorded_at
  FROM authorization_decisions_previous;
DROP TABLE authorization_decisions_previous;
CREATE INDEX authorization_work ON authorization_decisions(work_id,recorded_at,id);
`;
export const migrations = [
  initial,
  controls,
  approvals,
  inputs,
  workflowWaits,
  waitConditions,
  sessions,
  inspection,
  harness,
  interactionPrompts,
  workflowTimerMetadata,
  interactionPresentation,
  layeredUsage,
  publicProjections,
  authorizationDecisions,
  sessionQueue,
  effectResolutions,
  effectReconciliation,
  childWork,
  executableCalls,
  executableCallBackfill,
  sessionHandoff,
] as const;

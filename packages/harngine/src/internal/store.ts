import Database from 'better-sqlite3';
import { mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { entityId } from './id.js';
import { RuntimeError, type Json } from './contracts.js';
import { canonical, digest } from '../schema.js';
import type { TelemetryEvent, TelemetrySink } from '../telemetry.js';

import { migrations } from './migrations.js';

export interface WorkRow {
  id: string;
  principal: string;
  definition: string;
  objective: string;
  state: string;
  policy: string;
  basis: number;
  decisions: number;
  spent: number;
  model_turns: number;
  tool_executions: number;
  operations: number;
  status: 'active' | 'waiting' | 'closed';
  closure: string | null;
  eligible: number;
  concern: string | null;
  objective_revision: number;
  state_revision: number;
  control_token: string;
  context: string;
}
export interface RequestRow {
  id: string;
  work_id: string;
  decision_sequence: number;
  slot: string;
  tool: string;
  input: string;
  status: 'planned' | 'admitted' | 'settled' | 'unknown' | 'withdrawn';
  outcome: string | null;
  objective_revision: number;
  control_token: string;
}
export interface AuthorizationDecision {
  readonly id: string;
  readonly action: 'start' | 'call' | 'respond';
  readonly principal: string;
  readonly policyRevision: string;
  readonly allowed: boolean;
  readonly workId: string | null;
  readonly targetId: string;
  readonly subject: Json;
  readonly inputDigest: string;
  readonly safeReason: string;
  readonly recordedAt: number;
}
export class SqliteStore {
  readonly db: Database.Database;
  readonly epoch: number;
  private readonly lock: Database.Database;
  private closed = false;
  private telemetryCursor = 0;
  constructor(
    directory: string,
    private readonly clock: () => number = Date.now,
    private readonly telemetry?: TelemetrySink,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = realpathSync(directory);
    if (path !== resolve(directory))
      throw new RuntimeError(
        'INVALID_DIRECTORY',
        'Use a canonical directory without symlink aliases',
      );
    for (const name of [
      'owner.sqlite',
      'owner.sqlite-journal',
      'state.sqlite',
      'state.sqlite-wal',
      'state.sqlite-shm',
    ]) {
      const stat = lstatSync(join(path, name), { throwIfNoEntry: false });
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
        throw new RuntimeError('INVALID_DIRECTORY', 'Aliased database files are unsupported');
    }
    this.lock = new Database(join(path, 'owner.sqlite'), { timeout: 0 });
    try {
      this.lock.pragma('journal_mode=DELETE');
      this.lock.exec('BEGIN EXCLUSIVE');
    } catch (error) {
      this.lock.close();
      throw new RuntimeError('OWNER_BUSY', `Cannot acquire runtime ownership: ${String(error)}`);
    }
    let db: Database.Database | undefined;
    try {
      db = new Database(join(path, 'state.sqlite'));
      this.db = db;
      db.pragma('foreign_keys=ON');
      db.pragma('journal_mode=WAL');
      db.pragma('synchronous=FULL');
      if (
        db.pragma('foreign_keys', { simple: true }) !== 1 ||
        db.pragma('journal_mode', { simple: true }) !== 'wal' ||
        db.pragma('synchronous', { simple: true }) !== 2
      )
        throw new RuntimeError('STORAGE_CONFIGURATION', 'Required durability settings unavailable');
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      if (!exists) {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all();
        if (tables.length)
          throw new RuntimeError('STORAGE_FORMAT', 'Unrecognized nonempty database');
        db.transaction(() => {
          db!.exec(migrations[0]);
          db!.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(digest(migrations[0]));
        }).immediate();
      }
      const applied = db
        .prepare('SELECT version,checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      if (
        !applied.length ||
        applied.length > migrations.length ||
        applied.some((m, i) => m.version !== i + 1 || m.checksum !== digest(migrations[i]))
      ) {
        throw new RuntimeError('STORAGE_FORMAT', 'Unsupported or changed migration');
      }
      db.transaction(() => {
        for (let i = applied.length; i < migrations.length; i++) {
          db!.exec(migrations[i]!);
          db!
            .prepare('INSERT INTO schema_migrations VALUES(?,?)')
            .run(i + 1, digest(migrations[i]));
        }
      }).immediate();
      this.epoch = db
        .transaction(() => {
          db!.exec('UPDATE runtime_owner SET epoch=epoch+1 WHERE singleton=1');
          return (db!.prepare('SELECT epoch FROM runtime_owner').get() as { epoch: number }).epoch;
        })
        .immediate();
      this.telemetryCursor = (
        db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM progress').get() as { n: number }
      ).n;
    } catch (error) {
      db?.close();
      this.lock.close();
      throw error;
    }
  }
  write<T>(body: () => T): T {
    if (this.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
    const result = this.db
      .transaction(() => {
        const epoch = (
          this.db.prepare('SELECT epoch FROM runtime_owner').get() as { epoch: number }
        ).epoch;
        if (epoch !== this.epoch)
          throw new RuntimeError('STALE_OWNER', 'Execution ownership changed');
        const result = body();
        this.capturePublicProjections();
        return result;
      })
      .immediate();
    this.flushTelemetry();
    return result;
  }
  private flushTelemetry(): void {
    if (!this.telemetry) return;
    const rows = this.db
      .prepare(
        `SELECT rowid,work_id,event_id,kind,recorded_at,decision_sequence
         FROM progress WHERE rowid>? ORDER BY rowid`,
      )
      .all(this.telemetryCursor) as {
      rowid: number;
      work_id: string;
      event_id: string;
      kind: string;
      recorded_at: number;
      decision_sequence: number | null;
    }[];
    for (const row of rows) {
      this.telemetryCursor = row.rowid;
      const event: TelemetryEvent = Object.freeze({
        object: 'telemetry_event',
        type: 'progress.committed',
        workId: row.work_id as TelemetryEvent['workId'],
        eventId: row.event_id,
        kind: row.kind,
        recordedAt: row.recorded_at,
        decisionSequence: row.decision_sequence,
      });
      try {
        this.telemetry.emit(event);
      } catch {
        // Telemetry is post-commit and must never change execution outcomes.
      }
    }
  }
  private capturePublicProjections(): void {
    const workIds = this.db
      .prepare('SELECT DISTINCT work_id FROM progress WHERE projection IS NULL')
      .all() as { work_id: string }[];
    for (const { work_id: workId } of workIds) {
      const work = this.work(workId);
      const closure = work.closure ? JSON.parse(work.closure) : null;
      const waits = this.db
        .prepare(
          `SELECT w.id,w.prompt,w.schema,w.interaction_type,w.presentation,
            EXISTS(SELECT 1 FROM wake_dependencies d WHERE d.work_id=w.work_id AND d.wait_id=w.id) AS blocking
           FROM workflow_waits w WHERE w.work_id=? AND w.kind='reply' AND w.status='pending'
           ORDER BY w.decision_sequence,w.rowid`,
        )
        .all(workId) as {
        id: string;
        prompt: string | null;
        schema: string | null;
        interaction_type: string | null;
        presentation: string | null;
        blocking: number;
      }[];
      const approvals = this.db
        .prepare(
          `SELECT a.id,r.tool,r.input FROM waits a JOIN requests r ON r.id=a.operation_id
           WHERE a.work_id=? AND a.status='pending' AND a.invalidation IS NULL
           ORDER BY r.decision_sequence,a.rowid`,
        )
        .all(workId) as { id: string; tool: string; input: string }[];
      const timerPending = Boolean(
        this.db
          .prepare(
            "SELECT 1 FROM workflow_waits WHERE work_id=? AND kind='timer' AND status='pending' LIMIT 1",
          )
          .get(workId),
      );
      const effectUnknown = Boolean(
        this.db
          .prepare("SELECT 1 FROM requests WHERE work_id=? AND status='unknown' LIMIT 1")
          .get(workId),
      );
      const waitingFor =
        closure || work.status !== 'waiting'
          ? null
          : effectUnknown
            ? 'effect-resolution'
            : approvals.length
              ? 'approval'
              : waits.some((wait) => Boolean(wait.blocking))
                ? waits.some(
                    (wait) =>
                      Boolean(wait.blocking) &&
                      (wait.interaction_type ?? 'question') === 'approval',
                  )
                  ? 'approval'
                  : 'question'
                : timerPending
                  ? 'timer'
                  : 'external-result';
      const queued = Boolean(
        this.db.prepare('SELECT 1 FROM session_queue WHERE work_id=?').get(workId),
      );
      const projection = canonical({
        id: workId,
        objective: JSON.parse(work.objective),
        status: closure
          ? closure.status
          : queued
            ? 'queued'
            : work.status === 'waiting'
              ? 'waiting'
              : 'running',
        closure,
        waitingFor,
        interactions: [
          ...waits.map((wait) => ({
            id: wait.id,
            type: wait.interaction_type ?? 'question',
            blocking: Boolean(wait.blocking),
            prompt: wait.prompt,
            response: wait.schema ? JSON.parse(wait.schema).jsonSchema : null,
            presentation: wait.presentation ? JSON.parse(wait.presentation) : null,
          })),
          ...approvals.map((approval) => ({
            id: approval.id,
            type: 'approval',
            blocking: true,
            tool: JSON.parse(approval.tool),
            presentation: JSON.parse(approval.input),
          })),
        ],
      });
      this.db
        .prepare('UPDATE progress SET projection=? WHERE work_id=? AND projection IS NULL')
        .run(projection, workId);
    }
  }
  publicProjection(workId: string, eventId: string): Json | undefined {
    const row = this.db
      .prepare('SELECT projection FROM progress WHERE work_id=? AND event_id=?')
      .get(workId, eventId) as { projection: string | null } | undefined;
    return row?.projection ? JSON.parse(row.projection) : undefined;
  }
  register(records: { kind: string; id: string; version: string; manifest: unknown }[]): void {
    this.write(() => {
      for (const record of records) {
        const manifest = canonical(record.manifest);
        const prior = this.db
          .prepare('SELECT manifest FROM definitions WHERE kind=? AND id=? AND version=?')
          .get(record.kind, record.id, record.version) as { manifest: string } | undefined;
        if (prior && prior.manifest !== manifest)
          throw new RuntimeError(
            'REGISTRATION_CONFLICT',
            `${record.kind} ${record.id}/${record.version} changed`,
          );
        if (!prior)
          this.db
            .prepare('INSERT INTO definitions VALUES(?,?,?,?)')
            .run(record.kind, record.id, record.version, manifest);
      }
    });
  }
  work(id: string): WorkRow {
    const row = this.db.prepare('SELECT * FROM work WHERE id=?').get(id) as WorkRow | undefined;
    if (!row) throw new RuntimeError('NOT_FOUND', 'Work not found');
    return row;
  }
  requests(id: string): RequestRow[] {
    return this.db
      .prepare('SELECT * FROM requests WHERE work_id=? ORDER BY decision_sequence,slot')
      .all(id) as RequestRow[];
  }
  authorization(input: {
    action: AuthorizationDecision['action'];
    principal: string;
    policyRevision: string;
    allowed: boolean;
    workId?: string;
    targetId: string;
    subject: Json;
    value: Json;
    safeReason?: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO authorization_decisions
         (id,action,principal,policy_revision,allowed,work_id,target_id,subject,input_digest,safe_reason,recorded_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entityId('auth'),
        input.action,
        input.principal,
        input.policyRevision,
        input.allowed ? 1 : 0,
        input.workId ?? null,
        input.targetId,
        canonical(input.subject),
        digest(input.value),
        input.safeReason ?? (input.allowed ? 'allowed' : 'policy_denied'),
        this.clock(),
      );
  }
  authorizations(workId?: string): AuthorizationDecision[] {
    const rows = (
      workId
        ? this.db
            .prepare(
              'SELECT * FROM authorization_decisions WHERE work_id=? ORDER BY recorded_at,id',
            )
            .all(workId)
        : this.db.prepare('SELECT * FROM authorization_decisions ORDER BY recorded_at,id').all()
    ) as {
      id: string;
      action: AuthorizationDecision['action'];
      principal: string;
      policy_revision: string;
      allowed: number;
      work_id: string | null;
      target_id: string;
      subject: string;
      input_digest: string;
      safe_reason: string;
      recorded_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      principal: row.principal,
      policyRevision: row.policy_revision,
      allowed: Boolean(row.allowed),
      workId: row.work_id,
      targetId: row.target_id,
      subject: JSON.parse(row.subject),
      inputDigest: row.input_digest,
      safeReason: row.safe_reason,
      recordedAt: row.recorded_at,
    }));
  }
  rawRecords(workId: string): { table: string; key: string; value: Json }[] {
    this.work(workId);
    const records: { table: string; key: string; value: Json }[] = [];
    const append = (table: string, key: string, rows: Record<string, unknown>[]) => {
      for (const row of rows)
        records.push({
          table,
          key: String(row[key]),
          value: Object.fromEntries(
            Object.entries(row).map(([name, value]) => [name, value as Json]),
          ),
        });
    };
    append('work', 'id', [
      this.db.prepare('SELECT * FROM work WHERE id=?').get(workId)! as Record<string, unknown>,
    ]);
    append(
      'authorization_decisions',
      'id',
      this.db
        .prepare('SELECT * FROM authorization_decisions WHERE work_id=? ORDER BY recorded_at,id')
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'progress',
      'event_id',
      this.db
        .prepare('SELECT * FROM progress WHERE work_id=? ORDER BY sequence')
        .all(workId) as Record<string, unknown>[],
    );
    for (const table of ['decisions', 'requests', 'inputs', 'workflow_waits'] as const)
      append(
        table,
        table === 'decisions' ? 'sequence' : 'id',
        this.db
          .prepare(`SELECT * FROM ${table} WHERE work_id=? ORDER BY rowid`)
          .all(workId) as Record<string, unknown>[],
      );
    append(
      'attempts',
      'id',
      this.db
        .prepare(
          'SELECT a.* FROM attempts a JOIN requests r ON r.id=a.operation_id WHERE r.work_id=? ORDER BY a.rowid',
        )
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'attempt_outcomes',
      'attempt_id',
      this.db
        .prepare(
          'SELECT o.* FROM attempt_outcomes o JOIN attempts a ON a.id=o.attempt_id JOIN requests r ON r.id=a.operation_id WHERE r.work_id=? ORDER BY o.rowid',
        )
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'effect_reconciliation_attempts',
      'id',
      this.db
        .prepare(
          'SELECT e.* FROM effect_reconciliation_attempts e JOIN requests r ON r.id=e.operation_id WHERE r.work_id=? ORDER BY e.rowid',
        )
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'effect_resolutions',
      'id',
      this.db
        .prepare(
          'SELECT e.* FROM effect_resolutions e JOIN requests r ON r.id=e.operation_id WHERE r.work_id=? ORDER BY e.rowid',
        )
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'tool_effect_resolutions',
      'id',
      this.db
        .prepare(
          'SELECT e.* FROM tool_effect_resolutions e JOIN requests r ON r.id=e.operation_id WHERE r.work_id=? ORDER BY e.rowid',
        )
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'waits',
      'id',
      this.db.prepare('SELECT * FROM waits WHERE work_id=? ORDER BY rowid').all(workId) as Record<
        string,
        unknown
      >[],
    );
    append(
      'session_work',
      'session_id',
      this.db
        .prepare('SELECT * FROM session_work WHERE work_id=? ORDER BY rowid')
        .all(workId) as Record<string, unknown>[],
    );
    append(
      'child_work',
      'child_work_id',
      this.db
        .prepare(
          'SELECT * FROM child_work WHERE parent_work_id=? OR child_work_id=? ORDER BY decision_sequence,slot',
        )
        .all(workId, workId) as Record<string, unknown>[],
    );
    return records;
  }
  event(id: string, kind: string, body: Json, decisionSequence: number | null = null): number {
    const sequence = this.cursor(id) + 1;
    this.db
      .prepare(
        'INSERT INTO progress(work_id,sequence,event_id,kind,body,recorded_at,decision_sequence) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, sequence, entityId('event'), kind, canonical(body), this.clock(), decisionSequence);
    return sequence;
  }
  cursor(id: string): number {
    return (
      this.db
        .prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM progress WHERE work_id=?')
        .get(id) as { n: number }
    ).n;
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
      this.lock.close();
    }
  }
}

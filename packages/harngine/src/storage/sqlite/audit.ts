import { decodeStoredJson } from './codec.js';
import {
  progressAuditEntry,
  authorizationAuditEntry,
  sessionAuditEntries,
  sessionEntryAuditEntry,
  interactionAuditEntry,
} from '../../projection/audit.js';
import { createHash } from 'node:crypto';
import type {
  Audit,
  AuditEntry,
  AuditExportBatch,
  AuditExportOptions,
  AuditOptions,
  AuditPage,
  AuditQuery,
} from '../../application/contracts.js';
import type { Json, SessionId, WorkId } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import type { SqliteStore } from './store.js';

interface AuditCursor {
  readonly recordedAt: number;
  readonly id: string;
}

interface ProgressAuditRow {
  event_id: string;
  kind: string;
  body: string;
  recorded_at: number | null;
  decision_sequence: number | null;
  work_id: string;
  principal: string;
}

interface SessionAuditRow {
  id: string;
  principal: string;
  title: string;
  status: 'active' | 'closed';
  created_at: number;
  closed_at: number | null;
}

interface SessionEntryAuditRow {
  session_id: string;
  sequence: number;
  recorded_at: number;
  body: string;
  principal: string;
}

interface InteractionAuditRow {
  id: string;
  work_id: string;
  principal: string;
  interaction_type: 'question' | 'approval' | null;
  kind: string;
  status: string;
  decision_sequence: number | null;
  operation_id: string | null;
  recorded_at: number | null;
  session_id: string | null;
}

const categories = new Set<import('../../core/audit.js').AuditCategory>([
  'work',
  'decision',
  'authorization',
  'guardrail',
  'attempt',
  'interaction',
  'session',
]);

function encodeCursor(entry: AuditEntry): string {
  return Buffer.from(
    JSON.stringify({ recordedAt: entry.recordedAt, id: entry.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): AuditCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AuditCursor;
    if (
      !Number.isSafeInteger(parsed.recordedAt) ||
      parsed.recordedAt < 0 ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    )
      throw new Error('invalid cursor');
    return parsed;
  } catch {
    throw new ValidationError({
      code: 'INVALID_PAGE',
      message: 'Invalid Audit page token',
    });
  }
}

function attribute(key: string, value: string | number): Json {
  return {
    key,
    value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
  };
}

function otelEntry(entry: AuditEntry, traceKey: string): Json {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const attributes: Json[] = [
    attribute('service.name', 'harngine'),
    attribute('harngine.audit.category', entry.category),
    attribute('harngine.audit.action', entry.action),
    attribute('harngine.principal', entry.principal),
    attribute('harngine.audit.id', entry.id),
  ];
  if (entry.correlation.workId)
    attributes.push(attribute('harngine.work.id', entry.correlation.workId));
  if (entry.correlation.sessionId)
    attributes.push(attribute('harngine.session.id', entry.correlation.sessionId));
  if (entry.correlation.decisionSequence !== undefined)
    attributes.push(attribute('harngine.decision.sequence', entry.correlation.decisionSequence));
  if (entry.correlation.callId)
    attributes.push(attribute('harngine.call.id', entry.correlation.callId));
  if (entry.correlation.attemptId)
    attributes.push(attribute('harngine.attempt.id', entry.correlation.attemptId));
  if (entry.correlation.interactionId)
    attributes.push(attribute('harngine.interaction.id', entry.correlation.interactionId));
  if (entry.outcome) attributes.push(attribute('harngine.outcome', entry.outcome));
  if (entry.reason) {
    attributes.push(attribute('harngine.reason.code', entry.reason.code));
    attributes.push(attribute('harngine.reason.message', entry.reason.message));
  }
  if (entry.guardrail) {
    attributes.push(attribute('harngine.guardrail.id', entry.guardrail.id));
    attributes.push(attribute('harngine.guardrail.revision', entry.guardrail.revision));
  }
  return {
    traceId: hash(`harngine:trace:${traceKey}`).slice(0, 32),
    spanId: hash(`harngine:span:${entry.id}`).slice(0, 16),
    name: `harngine.${entry.category}.${entry.action}`,
    kind: 'SPAN_KIND_INTERNAL',
    startTimeUnixNano: String(entry.recordedAt * 1_000_000),
    endTimeUnixNano: String(entry.recordedAt * 1_000_000),
    attributes,
    status: {
      code:
        entry.outcome === 'denied' ||
        entry.outcome === 'failed' ||
        entry.outcome === 'canceled' ||
        entry.outcome === 'unknown'
          ? 'STATUS_CODE_ERROR'
          : 'STATUS_CODE_OK',
    },
  };
}

/** A read-only projection over committed state. It has no execution callbacks. */
export class AuditReader implements Audit {
  constructor(
    private readonly store: SqliteStore,
    private readonly principal: string,
    private readonly options: AuditOptions = {},
    private readonly clock: () => number = Date.now,
  ) {}

  private collect(): AuditEntry[] {
    const work = this.store.db
      .prepare('SELECT id,definition,principal FROM work WHERE principal=?')
      .all(this.principal) as {
      id: string;
      definition: string;
      principal: string;
    }[];
    const workById = new Map(work.map((row) => [row.id, row]));
    const sessionsByWork = new Map(
      (
        this.store.db
          .prepare(
            `SELECT sw.work_id,MIN(sw.session_id) AS session_id
             FROM session_work sw JOIN sessions s ON s.id=sw.session_id
             WHERE s.principal=? GROUP BY sw.work_id`,
          )
          .all(this.principal) as { work_id: string; session_id: string }[]
      ).map((row) => [row.work_id, row.session_id]),
    );
    const decisions = new Map(
      (
        this.store.db
          .prepare(
            `SELECT d.work_id,d.sequence,d.body
             FROM decisions d JOIN work w ON w.id=d.work_id
             WHERE w.principal=?`,
          )
          .all(this.principal) as {
          work_id: string;
          sequence: number;
          body: string;
        }[]
      ).map((row) => [
        `${row.work_id}\0${row.sequence}`,
        decodeStoredJson(row.body, 'decisions.body') as Json,
      ]),
    );
    const progress = this.store.db
      .prepare(
        `SELECT p.event_id,p.kind,p.body,p.recorded_at,p.decision_sequence,p.work_id,w.principal
         FROM progress p JOIN work w ON w.id=p.work_id
         WHERE w.principal=?`,
      )
      .all(this.principal) as ProgressAuditRow[];
    const entries: AuditEntry[] = [];
    for (const row of progress) {
      const entry = progressAuditEntry({
        id: row.event_id,
        kind: row.kind,
        body: decodeStoredJson(row.body, 'progress.body') as Json,
        recordedAt: row.recorded_at,
        decisionSequence: row.decision_sequence,
        workId: row.work_id as WorkId,
        principal: row.principal,
        sessionId: (sessionsByWork.get(row.work_id) as SessionId | undefined) ?? null,
        ...(row.decision_sequence === null
          ? {}
          : {
              decision: decisions.get(`${row.work_id}\0${row.decision_sequence}`),
            }),
        ...(row.kind === 'work.accepted'
          ? {
              workDefinition: decodeStoredJson(
                workById.get(row.work_id)?.definition ?? '{}',
                'work.definition',
              ) as Json,
            }
          : {}),
      });
      if (entry) entries.push(entry);
    }
    for (const authorization of this.store
      .authorizations()
      .filter((item) => item.principal === this.principal)) {
      entries.push(
        authorizationAuditEntry(
          authorization,
          authorization.workId
            ? ((sessionsByWork.get(authorization.workId) as SessionId | undefined) ?? null)
            : null,
        ),
      );
    }
    const sessions = this.store.db
      .prepare('SELECT * FROM sessions WHERE principal=?')
      .all(this.principal) as SessionAuditRow[];
    for (const session of sessions) {
      entries.push(
        ...sessionAuditEntries({
          id: session.id as SessionId,
          principal: session.principal,
          status: session.status,
          createdAt: session.created_at,
          closedAt: session.closed_at,
        }),
      );
    }
    const sessionEntries = this.store.db
      .prepare(
        `SELECT e.session_id,e.sequence,e.recorded_at,e.body,s.principal
         FROM session_entries e JOIN sessions s ON s.id=e.session_id
         WHERE s.principal=?`,
      )
      .all(this.principal) as SessionEntryAuditRow[];
    for (const entry of sessionEntries) {
      entries.push(
        sessionEntryAuditEntry({
          sessionId: entry.session_id as SessionId,
          sequence: entry.sequence,
          recordedAt: entry.recorded_at,
          principal: entry.principal,
          body: decodeStoredJson(entry.body, 'session_entries.body') as Json,
        }),
      );
    }
    const interactions = this.store.db
      .prepare(
        `SELECT ww.id,ww.work_id,w.principal,ww.interaction_type,ww.kind,ww.status,
           ww.decision_sequence,NULL AS operation_id,
           COALESCE(
             (SELECT p.recorded_at FROM progress p
              WHERE p.work_id=ww.work_id AND p.decision_sequence=ww.decision_sequence
                AND p.kind='decision.committed' LIMIT 1),
             (SELECT MIN(p.recorded_at) FROM progress p WHERE p.work_id=ww.work_id),
             0
           ) AS recorded_at,
           (SELECT MIN(sw.session_id) FROM session_work sw WHERE sw.work_id=ww.work_id)
             AS session_id
         FROM workflow_waits ww JOIN work w ON w.id=ww.work_id
         WHERE w.principal=?
         UNION ALL
         SELECT a.id,a.work_id,w.principal,'approval','approval',a.status,
           r.decision_sequence,a.operation_id,
           COALESCE(
             (SELECT p.recorded_at FROM progress p
              WHERE p.work_id=a.work_id AND p.decision_sequence=r.decision_sequence
                AND p.kind='decision.committed' LIMIT 1),
             (SELECT MIN(p.recorded_at) FROM progress p WHERE p.work_id=a.work_id),
             0
           ),
           (SELECT MIN(sw.session_id) FROM session_work sw WHERE sw.work_id=a.work_id)
         FROM waits a JOIN requests r ON r.id=a.operation_id
         JOIN work w ON w.id=a.work_id
         WHERE w.principal=?`,
      )
      .all(this.principal, this.principal) as InteractionAuditRow[];
    for (const interaction of interactions) {
      entries.push(
        interactionAuditEntry({
          id: interaction.id,
          workId: interaction.work_id as WorkId,
          principal: interaction.principal,
          interactionType: interaction.interaction_type,
          kind: interaction.kind,
          status: interaction.status,
          decisionSequence: interaction.decision_sequence,
          operationId: interaction.operation_id,
          recordedAt: interaction.recorded_at,
          sessionId: interaction.session_id as SessionId | null,
        }),
      );
    }
    return entries.sort((left, right) => {
      const time = right.recordedAt - left.recordedAt;
      if (time !== 0) return time;
      return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
    });
  }

  private retained(): AuditEntry[] {
    const retention = this.options.retention;
    if (
      retention?.maxAgeMs !== undefined &&
      (!Number.isSafeInteger(retention.maxAgeMs) || retention.maxAgeMs < 0)
    )
      throw new ValidationError({
        code: 'INVALID_RETENTION',
        message: 'Audit retention maxAgeMs must be a non-negative safe integer',
      });
    if (
      retention?.maxEntries !== undefined &&
      (!Number.isSafeInteger(retention.maxEntries) || retention.maxEntries < 0)
    )
      throw new ValidationError({
        code: 'INVALID_RETENTION',
        message: 'Audit retention maxEntries must be a non-negative safe integer',
      });
    const cutoff = retention?.maxAgeMs === undefined ? 0 : this.clock() - retention.maxAgeMs;
    let entries = this.collect().filter((entry) => entry.recordedAt >= cutoff);
    if (retention?.maxEntries !== undefined) entries = entries.slice(0, retention.maxEntries);
    return entries;
  }

  private filtered(options: AuditQuery): AuditEntry[] {
    const selectedCategories =
      options.category === undefined
        ? undefined
        : new Set(Array.isArray(options.category) ? options.category : [options.category]);
    if (selectedCategories)
      for (const category of selectedCategories)
        if (!categories.has(category))
          throw new ValidationError({
            code: 'INVALID_FILTER',
            message: 'Invalid Audit category',
          });
    for (const value of [options.since, options.until]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        throw new ValidationError({
          code: 'INVALID_FILTER',
          message: 'Audit time bounds must be non-negative safe integers',
        });
    }
    if (options.since !== undefined && options.until !== undefined && options.since > options.until)
      throw new ValidationError({
        code: 'INVALID_FILTER',
        message: 'Audit since must not exceed until',
      });
    return this.retained().filter((entry) => {
      if (selectedCategories && !selectedCategories.has(entry.category)) return false;
      if (options.workId && entry.correlation.workId !== options.workId) return false;
      if (options.sessionId && entry.correlation.sessionId !== options.sessionId) return false;
      if (options.since !== undefined && entry.recordedAt < options.since) return false;
      if (options.until !== undefined && entry.recordedAt > options.until) return false;
      return true;
    });
  }

  async list(options: AuditQuery = {}): Promise<AuditPage> {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ValidationError({
        code: 'INVALID_LIMIT',
        message: 'Audit page limit must be between 1 and 100',
      });
    const after = options.after ? decodeCursor(options.after) : undefined;
    const rows = this.filtered(options).filter(
      (entry) =>
        !after ||
        entry.recordedAt < after.recordedAt ||
        (entry.recordedAt === after.recordedAt && entry.id < after.id),
    );
    const selected = rows.slice(0, limit);
    return Object.freeze({
      object: 'list',
      entries: Object.freeze(selected),
      next: rows.length > limit && selected.at(-1) ? encodeCursor(selected.at(-1)!) : null,
    });
  }

  private redacted(entry: AuditEntry): AuditEntry {
    if (!this.options.redact) return entry;
    const replacement = this.options.redact(entry);
    if (!replacement || typeof replacement !== 'object')
      throw new ValidationError({
        code: 'INVALID_REDACTION',
        message: 'Audit redactor must return an object',
      });
    if (replacement.reason === undefined) return entry;
    if (
      !replacement.reason ||
      typeof replacement.reason.code !== 'string' ||
      !replacement.reason.code ||
      replacement.reason.code.length > 128 ||
      typeof replacement.reason.message !== 'string' ||
      !replacement.reason.message ||
      replacement.reason.message.length > 2000
    )
      throw new ValidationError({
        code: 'INVALID_REDACTION',
        message: 'Audit redactor reason must contain bounded code and message strings',
      });
    return Object.freeze({
      ...entry,
      reason: Object.freeze({
        code: replacement.reason.code,
        message: replacement.reason.message,
      }),
    });
  }

  async export(options: AuditExportOptions): Promise<{
    readonly object: 'audit_export';
    readonly format: 'json' | 'otel';
    readonly exported: number;
    readonly next: string | null;
  }> {
    const limit = options.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new ValidationError({
        code: 'INVALID_LIMIT',
        message: 'Audit export limit must be between 1 and 10000',
      });
    const format = options.format ?? 'json';
    if (format !== 'json' && format !== 'otel')
      throw new ValidationError({
        code: 'INVALID_FILTER',
        message: 'Audit export format must be json or otel',
      });
    const after = options.after ? decodeCursor(options.after) : undefined;
    const rows = this.filtered(options).filter(
      (entry) =>
        !after ||
        entry.recordedAt < after.recordedAt ||
        (entry.recordedAt === after.recordedAt && entry.id < after.id),
    );
    const selected = rows.slice(0, limit);
    const entries = Object.freeze(selected.map((entry) => this.redacted(entry)));
    let batch: AuditExportBatch;
    if (format === 'json') {
      batch = Object.freeze({
        object: 'audit_export_batch',
        format,
        entries,
      });
    } else {
      const groups = new Map<string, Json[]>();
      for (const entry of entries) {
        const traceKey =
          entry.correlation.workId ?? entry.correlation.sessionId ?? `principal:${entry.principal}`;
        const spans = groups.get(traceKey) ?? [];
        spans.push(otelEntry(entry, traceKey));
        groups.set(traceKey, spans);
      }
      batch = Object.freeze({
        object: 'audit_export_batch',
        format,
        resourceSpans: [
          {
            resource: {
              attributes: [attribute('service.name', 'harngine')],
            },
            scopeSpans: [...groups.values()].map((spans) => ({
              scope: { name: 'harngine.audit', version: '0.1.0' },
              spans,
            })),
          },
        ],
      });
    }
    await options.sink.write(batch);
    return Object.freeze({
      object: 'audit_export',
      format,
      exported: entries.length,
      next: rows.length > limit && selected.at(-1) ? encodeCursor(selected.at(-1)!) : null,
    });
  }
}

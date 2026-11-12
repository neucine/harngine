import { createHash } from 'node:crypto';
import type {
  Audit,
  AuditCategory,
  AuditEntry,
  AuditExportBatch,
  AuditExportOptions,
  AuditOptions,
  AuditPage,
  AuditQuery,
  AuditTarget,
} from '../app.js';
import type { Json, SessionId, WorkId } from '../types.js';
import { ValidationError } from '../errors.js';
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

const categories = new Set<AuditCategory>([
  'work',
  'decision',
  'authorization',
  'guardrail',
  'attempt',
  'interaction',
  'session',
]);

function object(value: Json | undefined): Record<string, Json> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : undefined;
}

function text(value: Json | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function reason(value: Json | undefined): AuditEntry['reason'] | undefined {
  const selected = object(value);
  const code = text(selected?.code);
  const message = text(selected?.message);
  return code && message ? { code, message } : undefined;
}

function identity(value: Json | undefined): AuditTarget | undefined {
  const selected = object(value);
  const id = text(selected?.id);
  if (!id) return undefined;
  const kind = text(selected?.kind);
  const revision = text(selected?.version) ?? text(selected?.revision);
  return {
    id,
    ...(kind === 'agent' || kind === 'workflow' || kind === 'tool' ? { kind } : {}),
    ...(revision ? { revision } : {}),
  };
}

function definition(value: string): AuditEntry['definition'] | undefined {
  const selected = object(JSON.parse(value) as Json);
  const id = text(selected?.id);
  const revision = text(selected?.version);
  const kind = text(selected?.kind);
  if (!id || !revision || (kind !== 'agent' && kind !== 'workflow')) return undefined;
  return {
    object: kind,
    kind,
    id,
    revision: revision as `rev_${string}`,
  };
}

function classify(kind: string): AuditCategory {
  if (kind.startsWith('decision.')) return 'decision';
  if (kind.startsWith('authorization.')) return 'authorization';
  if (kind.startsWith('guardrail.')) return 'guardrail';
  if (kind.startsWith('attempt.')) return 'attempt';
  if (kind.startsWith('approval.') || kind.startsWith('wait.') || kind.startsWith('interaction.'))
    return 'interaction';
  if (kind.startsWith('session.')) return 'session';
  return 'work';
}

function eventCorrelation(
  body: Record<string, Json>,
  workId: string,
  decisionSequence: number | null,
  sessionId: string | null,
): AuditEntry['correlation'] {
  const attemptId = text(body.attemptId);
  const operationId = text(body.operationId) ?? text(body.callId);
  const interactionId = text(body.waitId) ?? text(body.interactionId);
  return {
    workId: workId as WorkId,
    ...(sessionId ? { sessionId: sessionId as SessionId } : {}),
    ...(decisionSequence === null ? {} : { decisionSequence }),
    ...(operationId ? { callId: operationId } : {}),
    ...(attemptId ? { attemptId } : {}),
    ...(interactionId ? { interactionId } : {}),
  };
}

function eventOutcome(kind: string, body: Record<string, Json>): string | undefined {
  if (kind === 'authorization.allowed') return 'allowed';
  if (kind === 'authorization.denied') return 'denied';
  if (kind === 'work.closed') return text(body.status);
  if (kind === 'input.settled' || kind === 'wait.settled' || kind === 'interaction.settled')
    return text(body.status);
  if (kind === 'attempt.outcome_recorded' || kind === 'call.settled') {
    const outcome = object(body.outcome);
    return text(outcome?.status);
  }
  return undefined;
}

function eventReason(kind: string, body: Record<string, Json>): AuditEntry['reason'] | undefined {
  if (kind === 'guardrail.decided' || kind === 'attempt.blocked' || kind === 'input.rejected')
    return reason(body.reason);
  return undefined;
}

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
      ).map((row) => [`${row.work_id}\0${row.sequence}`, JSON.parse(row.body) as Json]),
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
      const body = object(JSON.parse(row.body) as Json) ?? {};
      const category = classify(row.kind);
      if (category === 'authorization') continue;
      const correlation = eventCorrelation(
        body,
        row.work_id,
        row.decision_sequence,
        sessionsByWork.get(row.work_id) ?? null,
      );
      const decision =
        row.decision_sequence === null
          ? undefined
          : object(decisions.get(`${row.work_id}\0${row.decision_sequence}`));
      const proposal = object(decision?.proposal);
      const selectedReason = eventReason(row.kind, body);
      const selectedOutcome =
        row.kind === 'decision.committed' ? text(proposal?.type) : eventOutcome(row.kind, body);
      const guardrail = object(body.guardrail);
      const guardrailId = text(guardrail?.id);
      const guardrailRevision = text(guardrail?.revision);
      const workDefinition =
        row.kind === 'work.accepted'
          ? definition(workById.get(row.work_id)?.definition ?? '{}')
          : undefined;
      entries.push(
        Object.freeze({
          object: 'audit_entry',
          id: row.event_id,
          category,
          action: row.kind,
          recordedAt: row.recorded_at ?? 0,
          principal: row.principal,
          correlation: Object.freeze(correlation),
          ...(selectedOutcome ? { outcome: selectedOutcome } : {}),
          ...(selectedReason ? { reason: Object.freeze(selectedReason) } : {}),
          ...(guardrailId && guardrailRevision
            ? {
                guardrail: Object.freeze({
                  id: guardrailId,
                  revision: guardrailRevision as `rev_${string}`,
                }),
              }
            : {}),
          ...(workDefinition ? { definition: workDefinition } : {}),
        }),
      );
    }
    for (const authorization of this.store
      .authorizations()
      .filter((item) => item.principal === this.principal)) {
      const target = identity(authorization.subject);
      entries.push(
        Object.freeze({
          object: 'audit_entry',
          id: authorization.id,
          category: 'authorization',
          action: authorization.action,
          recordedAt: authorization.recordedAt,
          principal: authorization.principal,
          correlation: Object.freeze({
            ...(authorization.workId
              ? {
                  workId: authorization.workId as WorkId,
                  ...(sessionsByWork.get(authorization.workId)
                    ? {
                        sessionId: sessionsByWork.get(authorization.workId) as SessionId,
                      }
                    : {}),
                }
              : {}),
            ...(authorization.action === 'call' ? { callId: authorization.targetId } : {}),
            authorizationId: authorization.id,
          }),
          outcome: authorization.allowed ? 'allowed' : 'denied',
          reason: Object.freeze({
            code: authorization.allowed ? 'ALLOWED' : 'DENIED',
            message: authorization.safeReason,
          }),
          policyRevision: authorization.policyRevision,
          ...(target ? { target } : {}),
        }),
      );
    }
    const sessions = this.store.db
      .prepare('SELECT * FROM sessions WHERE principal=?')
      .all(this.principal) as SessionAuditRow[];
    const sessionIds = new Set(sessions.map((session) => session.id));
    for (const session of sessions) {
      entries.push(
        Object.freeze({
          object: 'audit_entry',
          id: `session_created_${session.id}`,
          category: 'session',
          action: 'session.created',
          recordedAt: session.created_at,
          principal: session.principal,
          correlation: Object.freeze({ sessionId: session.id as SessionId }),
          outcome: 'committed',
        }),
      );
      if (session.closed_at !== null)
        entries.push(
          Object.freeze({
            object: 'audit_entry',
            id: `session_closed_${session.id}`,
            category: 'session',
            action: 'session.closed',
            recordedAt: session.closed_at,
            principal: session.principal,
            correlation: Object.freeze({ sessionId: session.id as SessionId }),
            outcome: session.status,
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
      const body = object(JSON.parse(entry.body) as Json) ?? {};
      const type = text(body.type) ?? 'entry';
      const workRef = object(body.work);
      const workId = text(workRef?.id);
      entries.push(
        Object.freeze({
          object: 'audit_entry',
          id: `session_entry_${entry.session_id}_${entry.sequence}`,
          category: 'session',
          action: `session.${type}`,
          recordedAt: entry.recorded_at,
          principal: entry.principal,
          correlation: Object.freeze({
            ...(sessionIds.has(entry.session_id)
              ? { sessionId: entry.session_id as SessionId }
              : {}),
            ...(workId ? { workId: workId as WorkId } : {}),
          }),
          outcome: 'committed',
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
        Object.freeze({
          object: 'audit_entry',
          id: `interaction_${interaction.kind === 'approval' ? 'approval' : 'workflow'}_${interaction.id}`,
          category: 'interaction',
          action: `${interaction.interaction_type ?? interaction.kind}.${interaction.status}`,
          recordedAt: interaction.recorded_at ?? 0,
          principal: interaction.principal,
          correlation: Object.freeze({
            workId: interaction.work_id as WorkId,
            ...(interaction.session_id ? { sessionId: interaction.session_id as SessionId } : {}),
            ...(interaction.decision_sequence === null
              ? {}
              : { decisionSequence: interaction.decision_sequence }),
            ...(interaction.operation_id ? { callId: interaction.operation_id } : {}),
            interactionId: interaction.id,
          }),
          outcome: interaction.status,
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

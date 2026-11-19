import type { Json, SessionId, WorkId } from './types.js';
import type { DefinitionRef, DefinitionType } from './definition.js';

export type AuditCategory =
  | 'work'
  | 'decision'
  | 'authorization'
  | 'guardrail'
  | 'attempt'
  | 'interaction'
  | 'session';

/** Stable correlation fields only. Audit entries never contain payload content. */
export interface AuditCorrelation {
  readonly workId?: WorkId;
  readonly sessionId?: SessionId;
  readonly decisionSequence?: number;
  readonly callId?: string;
  readonly attemptId?: string;
  readonly interactionId?: string;
  readonly authorizationId?: string;
}

export interface AuditTarget {
  readonly id: string;
  readonly type?: DefinitionType;
  readonly revision?: string;
}

export interface AuditEntry {
  readonly object: 'audit_entry';
  readonly id: string;
  readonly category: AuditCategory;
  readonly action: string;
  readonly recordedAt: number;
  readonly principal: string;
  readonly correlation: AuditCorrelation;
  readonly outcome?: string;
  readonly reason?: { readonly code: string; readonly message: string };
  readonly policyRevision?: string;
  readonly target?: AuditTarget;
  readonly guardrail?: { readonly id: string; readonly revision: `rev_${string}` };
  readonly definition?: DefinitionRef;
}

export interface AuditQuery {
  readonly category?: AuditCategory | readonly AuditCategory[];
  readonly workId?: WorkId;
  readonly sessionId?: SessionId;
  readonly since?: number;
  readonly until?: number;
  readonly after?: string;
  readonly limit?: number;
}

export interface AuditPage {
  readonly object: 'list';
  readonly entries: readonly AuditEntry[];
  readonly next: string | null;
}

export interface AuditRetention {
  /** Read-time age limit. Execution authority and source rows are never deleted. */
  readonly maxAgeMs?: number;
  /** Maximum number of entries retained in the audit projection. */
  readonly maxEntries?: number;
}

/** A final-stage hook for masking safe reason text before export. */
export type AuditRedactor = (entry: AuditEntry) => {
  readonly reason?: { readonly code: string; readonly message: string };
};

export interface AuditOptions {
  readonly retention?: AuditRetention;
  readonly redact?: AuditRedactor;
}

export interface JsonAuditExport {
  readonly object: 'audit_export_batch';
  readonly format: 'json';
  readonly entries: readonly AuditEntry[];
}

/** OTLP/HTTP JSON traces payload, suitable for a collector's `/v1/traces` endpoint. */
export interface OtelAuditExport {
  readonly object: 'audit_export_batch';
  readonly format: 'otel';
  readonly resourceSpans: Json;
}

export type AuditExportBatch = JsonAuditExport | OtelAuditExport;

export interface AuditExportSink {
  write(batch: AuditExportBatch): void | Promise<void>;
}

export interface AuditExportOptions extends AuditQuery {
  readonly format?: 'json' | 'otel';
  readonly sink: AuditExportSink;
}

export interface Audit {
  list(options?: AuditQuery): Promise<AuditPage>;
  export(options: AuditExportOptions): Promise<{
    readonly object: 'audit_export';
    readonly format: 'json' | 'otel';
    readonly exported: number;
    readonly next: string | null;
  }>;
}

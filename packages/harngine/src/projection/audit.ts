import type { AuditCategory, AuditEntry, AuditTarget } from '../core/audit.js';
import type { Json, SessionId, WorkId } from '../core/types.js';

/** One committed progress fact and the committed records needed to describe it. */
export interface ProgressAuditFact {
  readonly id: string;
  readonly kind: string;
  readonly body: Json;
  readonly recordedAt: number | null;
  readonly decisionSequence: number | null;
  readonly workId: WorkId;
  readonly principal: string;
  readonly sessionId: SessionId | null;
  readonly decision?: Json | undefined;
  readonly workDefinition?: Json;
}

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
    ...(kind === 'agent' || kind === 'workflow' || kind === 'tool' ? { type: kind } : {}),
    ...(revision ? { revision } : {}),
  };
}

function definition(value: Json): AuditEntry['definition'] | undefined {
  const selected = object(value);
  const id = text(selected?.id);
  const revision = text(selected?.version);
  const kind = text(selected?.kind);
  if (!id || !revision || (kind !== 'agent' && kind !== 'workflow')) return undefined;
  return {
    object: 'definition',
    type: kind,
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

/** Project a committed progress fact into safe, read-only audit metadata. */
export function progressAuditEntry(fact: ProgressAuditFact): AuditEntry | null {
  const body = object(fact.body) ?? {};
  const category = classify(fact.kind);
  // Authorization has its own committed decision row; the progress event must not duplicate it.
  if (category === 'authorization') return null;
  const correlation = eventCorrelation(body, fact.workId, fact.decisionSequence, fact.sessionId);
  const proposal = object(object(fact.decision)?.proposal);
  const selectedReason = eventReason(fact.kind, body);
  const selectedOutcome =
    fact.kind === 'decision.committed' ? text(proposal?.type) : eventOutcome(fact.kind, body);
  const guardrail = object(body.guardrail);
  const guardrailId = text(guardrail?.id);
  const guardrailRevision = text(guardrail?.revision);
  const workDefinition =
    fact.kind === 'work.accepted' && fact.workDefinition
      ? definition(fact.workDefinition)
      : undefined;
  return Object.freeze({
    object: 'audit_entry',
    id: fact.id,
    category,
    action: fact.kind,
    recordedAt: fact.recordedAt ?? 0,
    principal: fact.principal,
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
  });
}

/** The authorization decision row is the source fact for this entry. */
export function authorizationAuditEntry(
  fact: {
    readonly id: string;
    readonly action: 'start' | 'call' | 'respond' | 'handoff';
    readonly recordedAt: number;
    readonly principal: string;
    readonly workId: string | null;
    readonly targetId: string;
    readonly allowed: boolean;
    readonly safeReason: string;
    readonly policyRevision: string;
    readonly subject: Json;
  },
  sessionId: SessionId | null,
): AuditEntry {
  const target = identity(fact.subject);
  return Object.freeze({
    object: 'audit_entry',
    id: fact.id,
    category: 'authorization',
    action: fact.action,
    recordedAt: fact.recordedAt,
    principal: fact.principal,
    correlation: Object.freeze({
      ...(fact.workId ? { workId: fact.workId as WorkId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(fact.action === 'call' ? { callId: fact.targetId } : {}),
      authorizationId: fact.id,
    }),
    outcome: fact.allowed ? 'allowed' : 'denied',
    reason: Object.freeze({
      code: fact.allowed ? 'ALLOWED' : 'DENIED',
      message: fact.safeReason,
    }),
    policyRevision: fact.policyRevision,
    ...(target ? { target } : {}),
  });
}

/** Session rows are the source facts; derived IDs keep each audit entry tied to its row. */
export function sessionAuditEntries(fact: {
  readonly id: SessionId;
  readonly principal: string;
  readonly status: 'active' | 'closed';
  readonly createdAt: number;
  readonly closedAt: number | null;
}): readonly AuditEntry[] {
  const entries: AuditEntry[] = [
    Object.freeze({
      object: 'audit_entry',
      id: `session_created_${fact.id}`,
      category: 'session',
      action: 'session.created',
      recordedAt: fact.createdAt,
      principal: fact.principal,
      correlation: Object.freeze({ sessionId: fact.id }),
      outcome: 'committed',
    }),
  ];
  if (fact.closedAt !== null)
    entries.push(
      Object.freeze({
        object: 'audit_entry',
        id: `session_closed_${fact.id}`,
        category: 'session',
        action: 'session.closed',
        recordedAt: fact.closedAt,
        principal: fact.principal,
        correlation: Object.freeze({ sessionId: fact.id }),
        outcome: fact.status,
      }),
    );
  return entries;
}

/** A committed session entry is the source fact. Its content stays out of the audit entry. */
export function sessionEntryAuditEntry(fact: {
  readonly sessionId: SessionId;
  readonly sequence: number;
  readonly recordedAt: number;
  readonly principal: string;
  readonly body: Json;
}): AuditEntry {
  const body = object(fact.body) ?? {};
  const type = text(body.type) ?? 'entry';
  const workId = text(object(body.work)?.id);
  return Object.freeze({
    object: 'audit_entry',
    id: `session_entry_${fact.sessionId}_${fact.sequence}`,
    category: 'session',
    action: `session.${type}`,
    recordedAt: fact.recordedAt,
    principal: fact.principal,
    correlation: Object.freeze({
      sessionId: fact.sessionId,
      ...(workId ? { workId: workId as WorkId } : {}),
    }),
    outcome: 'committed',
  });
}

/** The committed interaction row supplies current status; no payload is copied into audit. */
export function interactionAuditEntry(fact: {
  readonly id: string;
  readonly workId: WorkId;
  readonly principal: string;
  readonly interactionType: 'question' | 'approval' | null;
  readonly kind: string;
  readonly status: string;
  readonly decisionSequence: number | null;
  readonly operationId: string | null;
  readonly recordedAt: number | null;
  readonly sessionId: SessionId | null;
}): AuditEntry {
  return Object.freeze({
    object: 'audit_entry',
    id: `interaction_${fact.kind === 'approval' ? 'approval' : 'workflow'}_${fact.id}`,
    category: 'interaction',
    action: `${fact.interactionType ?? fact.kind}.${fact.status}`,
    recordedAt: fact.recordedAt ?? 0,
    principal: fact.principal,
    correlation: Object.freeze({
      workId: fact.workId,
      ...(fact.sessionId ? { sessionId: fact.sessionId } : {}),
      ...(fact.decisionSequence === null ? {} : { decisionSequence: fact.decisionSequence }),
      ...(fact.operationId ? { callId: fact.operationId } : {}),
      interactionId: fact.id,
    }),
    outcome: fact.status,
  });
}

import type { WorkEvent } from '../core/inspection.js';
import type { Work } from '../core/work.js';
import type { Json } from '../core/types.js';
import type {
  GuardrailInspectionEntry,
  InputInspectionEntry,
  InspectionEntry,
} from '../core/inspection.js';
import type { ModelUsage } from '../core/model.js';
import { workReference } from './definition.js';
import type { ExecutionSnapshot } from '../core/work.js';
import type { Interaction } from '../core/interaction.js';

/** Derive a public interaction from a committed execution snapshot. */
export function interactionFromSnapshot(
  snapshot: ExecutionSnapshot,
  id: string,
  recorded?: Interaction,
): Interaction | undefined {
  if (recorded) return recorded;
  const wait = snapshot.waits.find((candidate) => candidate.wait.id === id);
  if (wait)
    return wait.interaction === 'question'
      ? {
          object: 'interaction',
          id,
          type: 'question',
          prompt: wait.prompt ?? 'Response required',
          response: wait.schema?.jsonSchema ?? {},
          blocking: wait.blocking,
        }
      : {
          object: 'interaction',
          id,
          type: 'approval',
          blocking: wait.blocking,
          title: wait.prompt ?? 'Approval required',
          details: wait.presentation,
        };
  const approval = snapshot.approvals.find((candidate) => candidate.wait.id === id);
  if (!approval) return;
  return {
    object: 'interaction',
    id,
    type: 'approval',
    blocking: true,
    title: `Approve ${approval.tool.id}?`,
    details: approval.input,
    tool: { id: approval.tool.id, revision: approval.tool.version },
  };
}

/** Map committed facts that need no further reads to inspection entries. */
export function simpleInspectionEntry(
  event: WorkEvent,
  record: Work,
  diagnostic: boolean,
): InspectionEntry | null {
  const body = event.body as Record<string, Json>;
  const base = {
    object: 'inspection_entry' as const,
    id: event.id as `event_${string}`,
    recordedAt: event.recordedAt,
    ...(event.decisionSequence === null ? {} : { decisionSequence: event.decisionSequence }),
  };
  if (
    event.kind === 'model.progress' &&
    ['started', 'reasoning', 'completed'].includes(String(body.type))
  ) {
    const phase = body.type as 'started' | 'reasoning' | 'completed';
    const text = typeof body.text === 'string' ? body.text : undefined;
    const usage =
      body.usage && typeof body.usage === 'object' && !Array.isArray(body.usage)
        ? (body.usage as ModelUsage)
        : undefined;
    return Object.freeze({
      ...base,
      type: 'model.progress',
      phase,
      ...(text ? { text } : {}),
      ...(usage ? { usage } : {}),
      presentation: {
        title:
          phase === 'started'
            ? 'Model started'
            : phase === 'completed'
              ? 'Model response ready'
              : 'Model reasoning summary',
        summary:
          text ??
          (phase === 'started'
            ? 'Generating a response'
            : usage
              ? `${usage.inputTokens ?? 0} input · ${usage.outputTokens ?? 0} output tokens`
              : 'Response received'),
      },
    });
  }
  if (event.kind === 'guardrail.decided') {
    const stage = body.stage;
    const guardrail = body.guardrail;
    const action = body.action;
    const recordedReason =
      body.reason && typeof body.reason === 'object' && !Array.isArray(body.reason)
        ? (body.reason as { code?: unknown; message?: unknown })
        : undefined;
    if (
      !['model-input', 'model-output', 'tool-input', 'tool-output'].includes(String(stage)) ||
      !guardrail ||
      typeof guardrail !== 'object' ||
      Array.isArray(guardrail) ||
      typeof guardrail.id !== 'string' ||
      typeof guardrail.revision !== 'string' ||
      !guardrail.revision.startsWith('rev_') ||
      !['allow', 'redact', 'block'].includes(String(action))
    )
      return null;
    const reason =
      typeof recordedReason?.code === 'string' && typeof recordedReason.message === 'string'
        ? { code: recordedReason.code, message: recordedReason.message }
        : undefined;
    return Object.freeze({
      ...base,
      type: 'guardrail',
      presentation: {
        title: `Guardrail ${String(action)}`,
        summary: reason?.message ?? `${String(stage)} policy applied by ${String(guardrail.id)}`,
      },
      stage: stage as GuardrailInspectionEntry['stage'],
      guardrail: {
        id: guardrail.id as string,
        revision: guardrail.revision as `rev_${string}`,
      },
      action: action as GuardrailInspectionEntry['action'],
      ...(reason ? { reason } : {}),
    });
  }
  if (event.kind === 'work.accepted')
    return Object.freeze({
      ...base,
      type: 'work.started',
      presentation: { title: 'Work started', summary: 'Accepted the objective for execution' },
      definition: workReference(record),
    });
  if (
    event.kind === 'input.accepted' ||
    event.kind === 'input.rejected' ||
    event.kind === 'input.settled'
  ) {
    const status =
      event.kind === 'input.accepted'
        ? 'accepted'
        : event.kind === 'input.rejected'
          ? 'rejected'
          : (body.status as InputInspectionEntry['status']);
    const reason = body.reason as { code: string; message: string } | undefined;
    return Object.freeze({
      ...base,
      type: 'input',
      ...(typeof body.id === 'string' ? { inputId: body.id } : {}),
      status,
      presentation: {
        title: `Input ${status}`,
        ...(reason ? { summary: reason.message } : {}),
      },
      ...(diagnostic && reason ? { diagnostic: { reason } } : {}),
    });
  }
  if (event.kind === 'work.closed' || event.kind === 'work.canceled') {
    const closure = record.closure;
    if (!closure) return null;
    return Object.freeze({
      ...base,
      type: 'work.closed',
      presentation: {
        title: closure.status === 'completed' ? 'Work completed' : `Work ${closure.status}`,
        ...(closure.status === 'completed' ? {} : { summary: closure.reason.message }),
      },
      status: closure.status,
      ...(closure.status === 'completed'
        ? { result: closure.result }
        : { error: { code: closure.reason.code, message: closure.reason.message } }),
    });
  }
  return null;
}

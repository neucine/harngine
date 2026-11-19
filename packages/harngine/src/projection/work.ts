import type { Json, WorkId } from '../core/types.js';
import type { Closure, ExecutionSnapshot } from '../core/execution.js';
import type { Work } from '../core/work.js';
import type { WorkSnapshot, WorkStatus, WorkSummary } from '../core/work.js';
import type { Interaction } from '../core/interaction.js';
import { workReference } from './definition.js';

export function recordStatus(record: Work): WorkStatus {
  if (record.closure) return record.closure.status;
  if (record.queued) return 'queued';
  return record.status === 'waiting' ? 'waiting' : 'running';
}

export function workSummary(record: Work): WorkSummary {
  return Object.freeze({
    object: 'work',
    id: record.ref.id,
    definition: workReference(record),
    objective: record.objective,
    status: recordStatus(record),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    childWorkIds: record.childWorkIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function workStatus(snapshot: ExecutionSnapshot): WorkStatus {
  if (!snapshot.closure) return snapshot.status === 'waiting' ? 'waiting' : 'running';
  return snapshot.closure.status;
}

/** Project a direct engine inspection of current Work state. */
export function publicSnapshot<O extends Json, R extends Json>(
  snapshot: ExecutionSnapshot<O, R>,
  record: Work,
): WorkSnapshot<O, R> {
  const closure = snapshot.closure;
  const interactions = Object.freeze([
    ...snapshot.waits
      .filter(
        (wait) =>
          wait.kind === 'reply' && wait.status === 'pending' && wait.interaction === 'question',
      )
      .map((wait) => ({
        object: 'interaction' as const,
        id: wait.wait.id,
        type: 'question' as const,
        prompt: wait.prompt ?? 'Response required',
        response: wait.schema?.jsonSchema ?? {},
        blocking: wait.blocking,
      })),
    ...snapshot.waits
      .filter(
        (wait) =>
          wait.kind === 'reply' && wait.status === 'pending' && wait.interaction === 'approval',
      )
      .map((wait) => ({
        object: 'interaction' as const,
        id: wait.wait.id,
        type: 'approval' as const,
        blocking: wait.blocking,
        title: wait.prompt ?? 'Approval required',
        details: wait.presentation,
      })),
    ...snapshot.approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval) => ({
        object: 'interaction' as const,
        id: approval.wait.id,
        type: 'approval' as const,
        blocking: true,
        title: `Approve ${approval.tool.id}?`,
        details: approval.input,
        tool: { id: approval.tool.id, revision: approval.tool.version },
      })),
  ]);
  const waitingFor =
    record.queued || workStatus(snapshot) !== 'waiting'
      ? undefined
      : snapshot.concerns.some((concern) => concern.code === 'DEFINITION_UNAVAILABLE')
        ? ('definition-unavailable' as const)
        : snapshot.calls.some((call) => call.status === 'unknown')
          ? ('effect-resolution' as const)
          : interactions.some(
                (interaction) => interaction.blocking && interaction.type === 'approval',
              )
            ? ('approval' as const)
            : interactions.some(
                  (interaction) => interaction.blocking && interaction.type === 'question',
                )
              ? ('question' as const)
              : snapshot.waits.some((wait) => wait.kind === 'timer' && wait.status === 'pending')
                ? ('timer' as const)
                : ('external-result' as const);
  return Object.freeze({
    object: 'work',
    id: snapshot.id,
    definition: workReference(record),
    objective: snapshot.objective,
    status: record.queued ? 'queued' : workStatus(snapshot),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    childWorkIds: record.childWorkIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(closure?.status === 'completed' ? { result: closure.result } : {}),
    ...(closure && closure.status !== 'completed'
      ? { error: { code: closure.reason.code, message: closure.reason.message } }
      : {}),
    usage: snapshot.usage,
    limits: snapshot.limits,
    interactions,
    ...(waitingFor ? { waitingFor } : {}),
  });
}

/** Decode the public state stored with an event, preserving that event's point in time. */
export function projectionSnapshot<O extends Json, R extends Json>(
  value: Json,
  record: Work,
): WorkSnapshot<O, R> {
  const projection = value as {
    id: WorkId;
    objective: O;
    status: WorkStatus;
    closure: Closure<R> | null;
    waitingFor?: WorkSnapshot['waitingFor'] | null;
    interactions: {
      id: string;
      type: 'question' | 'approval';
      blocking: boolean;
      prompt?: string | null;
      response?: Json;
      presentation?: Json;
      tool?: { id: string; version: string };
    }[];
  };
  return Object.freeze({
    object: 'work',
    id: projection.id,
    definition: workReference(record),
    objective: projection.objective,
    status: projection.status,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    childWorkIds: record.childWorkIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(projection.closure?.status === 'completed' ? { result: projection.closure.result } : {}),
    ...(projection.closure && projection.closure.status !== 'completed'
      ? {
          error: {
            code: projection.closure.reason.code,
            message: projection.closure.reason.message,
          },
        }
      : {}),
    interactions: Object.freeze(
      projection.interactions.map(
        (interaction): Interaction =>
          interaction.type === 'question'
            ? {
                object: 'interaction',
                id: interaction.id,
                type: 'question',
                blocking: interaction.blocking,
                prompt: interaction.prompt ?? 'Response required',
                response: interaction.response ?? {},
              }
            : {
                object: 'interaction',
                id: interaction.id,
                type: 'approval',
                blocking: interaction.blocking,
                title: interaction.prompt ?? `Approve ${interaction.tool?.id ?? 'action'}?`,
                details: interaction.presentation ?? null,
                ...(interaction.tool
                  ? {
                      tool: {
                        id: interaction.tool.id,
                        revision: interaction.tool.version,
                      },
                    }
                  : {}),
              },
      ),
    ),
    ...(projection.waitingFor ? { waitingFor: projection.waitingFor } : {}),
  });
}

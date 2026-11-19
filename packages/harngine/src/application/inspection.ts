import { interactionFromSnapshot, simpleInspectionEntry } from '../projection/inspection.js';
import type {
  ExecutionSnapshot,
  CallInspection,
  DecisionInspection,
  WorkEvent,
  WorkRef,
} from '../core/execution.js';
import type { Work } from '../core/work.js';
import { Runtime, type Caller } from '../engine/runtime.js';
import type { Json, WorkId } from '../core/types.js';
import { translateError } from './error.js';
import type { ModelRequest, ModelResponse } from '../core/model.js';
import type {
  CallInspectionEntry,
  DecisionInspectionEntry,
  DefinitionRef,
  InspectionEntry,
  InspectionPage,
  Interaction,
  InteractionInspectionEntry,
} from './contracts.js';
import { reference, workReference } from '../projection/definition.js';
import { publicSnapshot } from '../projection/work.js';

/** Read-only Work history projection; events and committed records remain authoritative. */
export class WorkInspection<O extends Json, R extends Json> {
  constructor(
    private readonly runtime: Runtime,
    private readonly caller: Caller,
    private readonly ref: WorkRef<O, R>,
  ) {}

  private get id(): WorkId {
    return this.ref.id;
  }
  private async decisionEntry(
    event: WorkEvent,
    record: Work,
    snapshot: ExecutionSnapshot,
    diagnostic: boolean,
  ): Promise<DecisionInspectionEntry | null> {
    if (event.decisionSequence === null) return null;
    const api = this.runtime.forCaller(this.caller);
    const decision = (await api.work.decision(
      this.ref,
      event.decisionSequence,
    )) as DecisionInspection;
    const proposal = decision.proposal.type;
    const title = record.kind === 'agent' ? 'Agent decision' : 'Workflow decision';
    const proposalSummary =
      proposal === 'call'
        ? record.kind === 'agent'
          ? 'Selected the next model or Tool operation'
          : 'Selected the next Tool operation'
        : proposal === 'wait'
          ? 'Paused for a recorded condition'
          : proposal === 'child'
            ? 'Delegated one child Work'
            : proposal === 'children'
              ? 'Started parallel child Work'
              : proposal === 'join'
                ? 'Joined concurrent child Work'
                : proposal === 'complete'
                  ? 'Completed the objective'
                  : 'Failed the objective';
    let details: DecisionInspectionEntry['diagnostic'];
    if (diagnostic) {
      const modelCalls = (
        await Promise.all(
          snapshot.calls
            .filter((call) => call.slot.startsWith('model:'))
            .map((call) => api.work.call(this.ref, call.id)),
        )
      ).sort((left, right) => left.decisionSequence - right.decisionSequence);
      const proposed = modelCalls.find((call) => call.decisionSequence === event.decisionSequence);
      const interpreted = modelCalls
        .filter(
          (call) =>
            call.decisionSequence < event.decisionSequence! && call.outcome?.status === 'success',
        )
        .at(-1);
      const modelCall = interpreted ?? proposed;
      const modelRequest = modelCall?.input as unknown as ModelRequest | undefined;
      const modelResponse =
        interpreted?.outcome?.status === 'success'
          ? (interpreted.outcome.value as unknown as ModelResponse)
          : undefined;
      const workflowContext = decision.context
        ? {
            objective: decision.context.objective,
            state: decision.context.state,
            basis: decision.context.basis,
            objectiveRevision: decision.context.objectiveRevision,
            stateRevision: decision.context.stateRevision,
          }
        : null;
      details = {
        context: modelRequest?.context ?? workflowContext,
        ...(modelRequest ? { modelRequest } : {}),
        ...(modelResponse ? { modelResponse } : {}),
        interpretation: decision.proposal as unknown as Json,
      };
    }
    return Object.freeze({
      object: 'inspection_entry',
      id: event.id as `event_${string}`,
      type: 'decision',
      recordedAt: event.recordedAt,
      decisionSequence: event.decisionSequence,
      presentation: { title, summary: proposalSummary },
      source: record.kind,
      disposition: 'committed',
      inputIds: decision.inputIds,
      proposal,
      ...(details ? { diagnostic: details } : {}),
    });
  }

  private async callEntry(
    event: WorkEvent,
    diagnostic: boolean,
  ): Promise<CallInspectionEntry | null> {
    const body = event.body as Record<string, Json>;
    let callId = typeof body.operationId === 'string' ? body.operationId : undefined;
    const api = this.runtime.forCaller(this.caller);
    if (!callId && typeof body.attemptId === 'string') {
      const snapshot = await api.work.inspect(this.ref);
      for (const candidate of snapshot.calls) {
        const inspected = await api.work.call(this.ref, candidate.id);
        if (inspected.attempts.some((attempt) => attempt.id === body.attemptId)) {
          callId = candidate.id;
          break;
        }
      }
    }
    if (!callId) return null;
    const call = (await api.work.call(this.ref, callId)) as CallInspection;
    if (call.slot.startsWith('model:')) return null;
    const rawOutcome = body.outcome ?? body.result;
    const eventOutcome =
      rawOutcome && typeof rawOutcome === 'object' && !Array.isArray(rawOutcome)
        ? (rawOutcome as Record<string, Json>)
        : undefined;
    const phase: CallInspectionEntry['phase'] =
      event.kind === 'call.committed'
        ? 'committed'
        : event.kind === 'effect.resolved' || event.kind === 'effect.reconciled'
          ? 'resolved'
          : event.kind === 'effect.reconciliation_admitted'
            ? 'reconciling'
            : event.kind === 'effect.reconciliation_interrupted'
              ? 'uncertain'
              : event.kind === 'effect.reconciliation_outcome'
                ? eventOutcome?.status === 'unknown'
                  ? 'uncertain'
                  : 'resolved'
                : event.kind === 'authorization.allowed'
                  ? 'authorized'
                  : event.kind === 'authorization.denied'
                    ? 'rejected'
                    : event.kind === 'attempt.admitted'
                      ? 'admitted'
                      : event.kind === 'attempt.retry_planned'
                        ? 'retrying'
                        : event.kind === 'attempt.uncertain'
                          ? 'uncertain'
                          : eventOutcome?.status === 'unknown'
                            ? 'uncertain'
                            : 'settled';
    const attemptSequence =
      typeof body.attempt === 'number'
        ? event.kind === 'attempt.retry_planned'
          ? Math.max(0, body.attempt - 1)
          : body.attempt
        : call.attempts.length;
    const selectedAttempt =
      typeof body.attemptId === 'string'
        ? call.attempts.find((attempt) => attempt.id === body.attemptId)
        : undefined;
    const outcome =
      eventOutcome ??
      (event.kind === 'authorization.denied' || event.kind === 'attempt.uncertain'
        ? (call.outcome ?? undefined)
        : undefined);
    const attempt = selectedAttempt
      ? {
          id: selectedAttempt.id,
          sequence: selectedAttempt.sequence,
          status:
            event.kind === 'attempt.admitted' ? ('admitted' as const) : selectedAttempt.status,
          ...(event.kind !== 'attempt.admitted' && selectedAttempt.outcome
            ? { outcome: selectedAttempt.outcome as unknown as Json }
            : {}),
        }
      : undefined;
    return Object.freeze({
      object: 'inspection_entry',
      id: event.id as `event_${string}`,
      type: 'call',
      recordedAt: event.recordedAt,
      ...(event.decisionSequence === null ? {} : { decisionSequence: event.decisionSequence }),
      presentation: {
        title: `Tool Call · ${call.tool.id}`,
        summary:
          phase === 'committed'
            ? 'Validated and committed for execution'
            : phase === 'admitted'
              ? `Admitted attempt ${attemptSequence}`
              : phase === 'retrying'
                ? 'A retry is planned after a conclusive no-effect failure'
                : phase === 'reconciling'
                  ? 'The Tool is checking the uncertain external effect'
                  : phase === 'settled'
                    ? 'Recorded a conclusive outcome'
                    : phase === 'resolved'
                      ? event.kind === 'effect.resolved'
                        ? 'An operator resolved the uncertain external effect'
                        : 'The Tool reconciled the uncertain external effect'
                      : phase === 'uncertain'
                        ? 'The external effect is uncertain'
                        : phase === 'rejected'
                          ? 'Execution was not authorized'
                          : 'Execution was authorized',
      },
      callId,
      tool: reference('tool', call.tool.id, call.tool.version) as DefinitionRef & {
        type: 'tool';
      },
      phase,
      attemptCount: attemptSequence,
      ...(diagnostic
        ? {
            diagnostic: {
              input: call.input,
              ...(outcome ? { outcome: outcome as Json } : {}),
              attempts: attempt ? [attempt] : [],
            },
          }
        : {}),
    });
  }

  private async inspectionEntry(
    event: WorkEvent,
    record: Work,
    snapshot: ExecutionSnapshot,
    diagnostic: boolean,
  ): Promise<InspectionEntry | null> {
    const body = event.body as Record<string, Json>;
    const base = {
      object: 'inspection_entry' as const,
      id: event.id as `event_${string}`,
      recordedAt: event.recordedAt,
      ...(event.decisionSequence === null ? {} : { decisionSequence: event.decisionSequence }),
    };
    const simple = simpleInspectionEntry(event, record, diagnostic);
    if (simple) return simple;
    if (event.kind === 'decision.committed')
      return this.decisionEntry(event, record, snapshot, diagnostic);
    if (
      event.kind === 'child.started' ||
      event.kind === 'call.joined' ||
      event.kind === 'child.closed'
    ) {
      const childWorkId = body.childWorkId;
      const slot = body.slot;
      const callId = body.callId;
      const mode = body.mode;
      if (
        typeof childWorkId !== 'string' ||
        typeof slot !== 'string' ||
        typeof callId !== 'string' ||
        (mode !== 'sequential' && mode !== 'concurrent')
      )
        return null;
      const childRecord = this.runtime.workRecord(this.caller, childWorkId as WorkId);
      const phase =
        event.kind === 'child.started'
          ? ('started' as const)
          : event.kind === 'call.joined'
            ? ('joined' as const)
            : ('closed' as const);
      const status =
        phase === 'closed' &&
        (body.closure === 'completed' || body.closure === 'failed' || body.closure === 'canceled')
          ? body.closure
          : undefined;
      return Object.freeze({
        ...base,
        type: 'child',
        presentation: {
          title:
            phase === 'started'
              ? 'Child Call started'
              : phase === 'joined'
                ? 'Child Call joined'
                : 'Child Call closed',
          summary:
            phase === 'started'
              ? `Started ${childRecord.ref.definition.id}`
              : phase === 'joined'
                ? `Joined ${String(body.joinSlot)}`
                : `Child Work ${status ?? 'closed'}`,
        },
        callId,
        childWorkId: childWorkId as WorkId,
        slot,
        phase,
        mode,
        ...(typeof body.joinSlot === 'string' ? { joinSlot: body.joinSlot } : {}),
        definition: workReference(childRecord),
        ...(status ? { status } : {}),
      });
    }
    if (
      event.kind === 'call.committed' ||
      event.kind === 'call.settled' ||
      event.kind === 'authorization.allowed' ||
      event.kind === 'authorization.denied' ||
      event.kind === 'attempt.admitted' ||
      event.kind === 'attempt.outcome_recorded' ||
      event.kind === 'attempt.retry_planned' ||
      event.kind === 'attempt.uncertain' ||
      event.kind === 'effect.resolved' ||
      event.kind === 'effect.reconciliation_admitted' ||
      event.kind === 'effect.reconciliation_interrupted' ||
      event.kind === 'effect.reconciliation_outcome' ||
      event.kind === 'effect.reconciled'
    )
      return this.callEntry(event, diagnostic);
    if (
      event.kind === 'interaction.requested' ||
      event.kind === 'interaction.settled' ||
      event.kind === 'approval.reply' ||
      event.kind === 'approval.settled' ||
      event.kind === 'wait.reply' ||
      event.kind === 'wait.settled'
    ) {
      const recordedInteraction =
        body.interaction && typeof body.interaction === 'object' && !Array.isArray(body.interaction)
          ? (body.interaction as Record<string, Json>)
          : undefined;
      const id =
        typeof body.waitId === 'string'
          ? body.waitId
          : typeof recordedInteraction?.id === 'string'
            ? recordedInteraction.id
            : undefined;
      if (!id) return null;
      const recorded = recordedInteraction as unknown as Interaction | undefined;
      const interaction = interactionFromSnapshot(snapshot, id, recorded);
      if (!interaction) return null;
      const workflowWait = snapshot.waits.find((candidate) => candidate.wait.id === id);
      if (event.kind === 'wait.settled' && workflowWait?.kind !== 'reply') return null;
      if (
        (event.kind === 'approval.reply' || event.kind === 'wait.reply') &&
        body.status !== 'accepted'
      )
        return null;
      const status: InteractionInspectionEntry['status'] =
        event.kind === 'interaction.requested'
          ? 'pending'
          : body.status === 'withdrawn'
            ? 'withdrawn'
            : body.decision === 'approve'
              ? 'approved'
              : body.decision === 'deny'
                ? 'denied'
                : body.resolution === 'replied'
                  ? 'replied'
                  : typeof body.code === 'string' && body.code.includes('DENIED')
                    ? 'denied'
                    : 'expired';
      return Object.freeze({
        ...base,
        type: 'interaction',
        presentation: {
          title: interaction.type === 'approval' ? `Approval ${status}` : `Question ${status}`,
          summary: interaction.type === 'approval' ? interaction.title : interaction.prompt,
        },
        interaction,
        status,
      });
    }
    return null;
  }

  async inspect(
    options: { detail?: 'story' | 'diagnostic'; after?: string; limit?: number } = {},
  ): Promise<InspectionPage<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const after = options.after ? await api.work.eventCursor(this.ref, options.after) : undefined;
      const history = await api.work.history(this.ref, {
        ...(after === undefined ? {} : { after }),
        limit: options.limit ?? 100,
      });
      const record = this.runtime.workRecord(this.caller, this.id);
      const snapshot = await api.work.inspect(this.ref);
      const entries = (
        await Promise.all(
          history.events.map((event) =>
            this.inspectionEntry(event, record, snapshot, options.detail === 'diagnostic'),
          ),
        )
      ).filter((entry): entry is InspectionEntry => entry !== null);
      return Object.freeze({
        object: 'inspection',
        work: publicSnapshot(snapshot, record),
        entries: Object.freeze(entries),
        next: history.events.at(-1)?.id ?? options.after ?? null,
        hasMore: history.hasMore,
      });
    } catch (error) {
      throw translateError(error);
    }
  }
}

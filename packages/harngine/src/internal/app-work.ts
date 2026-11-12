import type {
  Closure,
  ControlToken,
  Snapshot,
  CallInspection,
  DecisionInspection,
  WorkEvent,
  WorkRef,
} from './contracts.js';
import type { RuntimeWorkRecord } from './inspection-service.js';
import { Runtime, type Caller, type RuntimeDefinitionRecord } from './runtime.js';
import type { Json, SessionId, WorkId } from '../types.js';
import {
  commandError,
  ConflictError,
  NotFoundError,
  translateError,
  ValidationError,
  WorkCanceledError,
  WorkFailedError,
} from '../errors.js';
import type { Agent as PublicAgent } from '../agent.js';
import type { Workflow as PublicWorkflow } from '../workflow.js';
import type { ModelRequest, ModelResponse, ModelUsage } from '../model.js';
import type {
  CallInspectionEntry,
  CancelOptions,
  DecisionInspectionEntry,
  Definition,
  DefinitionDescription,
  DefinitionReference,
  EffectResolution,
  ExecutableDefinitionReference,
  ExecutionLimits,
  GuardrailInspectionEntry,
  InputInspectionEntry,
  InspectionEntry,
  InspectionPage,
  Interaction,
  InteractionInspectionEntry,
  SessionState,
  Watch,
  Work,
  WorkSnapshot,
  WorkStatus,
  WorkSummary,
  WorkUpdate,
} from '../app.js';
import { generatedRequestId, reference } from './app-codecs.js';

function toolReferences(value: unknown): readonly (DefinitionReference & { kind: 'tool' })[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.map((item) => {
      const selected = item as { id: string; version: string };
      return reference('tool', selected.id, selected.version) as DefinitionReference & {
        kind: 'tool';
      };
    }),
  );
}

function schemaValue(value: unknown): Json {
  if (value && typeof value === 'object' && 'jsonSchema' in value)
    return (value as { jsonSchema: Json }).jsonSchema;
  return {};
}

export function definitionDescription(record: RuntimeDefinitionRecord): DefinitionDescription {
  const manifest = record.manifest as Record<string, Json>;
  const base = {
    id: record.id,
    revision: record.version as `rev_${string}`,
    availability: record.available ? ('available' as const) : ('unavailable' as const),
  };
  if (record.kind === 'tool')
    return Object.freeze({
      ...base,
      object: 'tool',
      kind: 'tool',
      ...(typeof manifest.description === 'string' ? { description: manifest.description } : {}),
      input: schemaValue(manifest.input),
      output: schemaValue(manifest.output),
      effect: manifest.effect as 'read' | 'write',
      capabilities: (manifest.capabilities ??
        (manifest.effect === 'read'
          ? { effect: 'read', invocation: 'repeatable' }
          : {
              effect: 'write',
              idempotency: 'none',
              reconciliation: manifest.reconcilable === true ? 'automatic' : 'manual',
              reversibility: 'unknown',
            })) as import('../tool.js').ToolCapabilities,
      reconcilable: manifest.reconcilable === true,
      ...(manifest.approval === undefined ? {} : { approval: manifest.approval }),
      retry: manifest.retry ?? {},
      guardrails: guardrailDescriptions(manifest.guardrails),
    });
  const policy = (manifest.policy ?? {}) as Record<string, Json>;
  if (record.kind === 'workflow')
    return Object.freeze({
      ...base,
      object: 'workflow',
      kind: 'workflow',
      objective: schemaValue(manifest.objective),
      result: schemaValue(manifest.result),
      tools: toolReferences(manifest.tools),
      children: Object.freeze(
        Array.isArray(manifest.children)
          ? manifest.children.map((value) => {
              const child = value as { id: string; version: string; kind: 'agent' | 'workflow' };
              return reference(
                child.kind,
                child.id,
                child.version,
              ) as ExecutableDefinitionReference;
            })
          : [],
      ),
      limits: {
        operations: policy.maxOperations ?? policy.maxDecisions ?? null,
        toolExecutions: policy.maxToolExecutions ?? policy.maxAttempts ?? null,
        childWork: policy.maxChildWork ?? null,
      },
    });
  const instructions = Array.isArray(manifest.instructions)
    ? (manifest.instructions as string[])
    : typeof manifest.instructions === 'string'
      ? [manifest.instructions]
      : [];
  const model = (manifest.model ?? {}) as Record<string, Json>;
  return Object.freeze({
    ...base,
    object: 'agent',
    kind: 'agent',
    instructions: Object.freeze(instructions),
    objective: schemaValue(manifest.objective),
    result: schemaValue(manifest.result),
    model: {
      id: typeof model.id === 'string' ? model.id : 'unavailable',
      capabilities: model.capabilities ?? {},
    },
    tools: toolReferences(manifest.tools),
    delegates: Object.freeze(
      Array.isArray(manifest.delegates)
        ? manifest.delegates.map((value) => {
            const delegate = value as { id: string; version: string; kind: 'agent' | 'workflow' };
            return reference(
              delegate.kind,
              delegate.id,
              delegate.version,
            ) as ExecutableDefinitionReference;
          })
        : [],
    ),
    context: manifest.context ?? {},
    limits: {
      modelTurns: policy.maxModelTurns ?? policy.maxDecisions ?? null,
      toolExecutions: policy.maxToolExecutions ?? policy.maxAttempts ?? null,
      childWork: policy.maxChildWork ?? null,
    },
    guardrails: guardrailDescriptions(manifest.guardrails),
  });
}

function guardrailDescriptions(value: Json | undefined) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.map((entry) => {
      const guardrail = entry as unknown as {
        id: string;
        revision: `rev_${string}`;
        stages: readonly string[];
      };
      return Object.freeze({
        id: guardrail.id,
        revision: guardrail.revision,
        stages: Object.freeze([...guardrail.stages]) as GuardrailInspectionEntry['stage'][],
      });
    }),
  );
}

export function runtimeDefinition(
  runtime: Runtime,
  selected: DefinitionReference,
): RuntimeDefinitionRecord {
  const record = runtime
    .definitionRecords()
    .find(
      (candidate) =>
        candidate.kind === selected.kind &&
        candidate.id === selected.id &&
        candidate.version === selected.revision,
    );
  if (!record)
    throw new NotFoundError({ code: 'NOT_FOUND', message: 'Definition revision not found' });
  return record;
}

export function workReference(record: RuntimeWorkRecord): ExecutableDefinitionReference {
  return reference(
    record.kind,
    record.ref.definition.id,
    record.ref.definition.version,
  ) as ExecutableDefinitionReference;
}

export function recordStatus(record: RuntimeWorkRecord): WorkStatus {
  if (record.closure) return record.closure.status;
  if (record.queued) return 'queued';
  return record.status === 'waiting' ? 'waiting' : 'running';
}

export function workSummary(record: RuntimeWorkRecord): WorkSummary {
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

export function workLimits(
  definition: Definition,
  requested: ExecutionLimits | undefined,
  ceiling: ExecutionLimits | undefined,
): Partial<import('./contracts.js').Policy> | undefined {
  const publicDefinition = definition as PublicAgent<any, any> | PublicWorkflow<any, any>;
  const agentDefinition = 'instructions' in publicDefinition;
  const supported = agentDefinition
    ? new Set(['modelTurns', 'toolExecutions', 'childWork', 'depth'])
    : new Set(['operations', 'toolExecutions', 'childWork', 'depth']);
  for (const [name, value] of Object.entries(requested ?? {})) {
    if (!supported.has(name) || !Number.isSafeInteger(value) || value < 1)
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: `Invalid ${name} Work limit`,
      });
    const appLimit = ceiling?.[name as keyof ExecutionLimits];
    if (appLimit !== undefined && value > appLimit)
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: `${name} cannot exceed the App limit`,
      });
  }
  const configured = publicDefinition.limits;
  const depth = requested?.depth ?? ceiling?.depth ?? 8;
  if (agentDefinition) {
    const definitionLimits = configured as PublicAgent['limits'];
    const modelTurns = Math.min(
      requested?.modelTurns ?? definitionLimits.modelTurns,
      ceiling?.modelTurns ?? definitionLimits.modelTurns,
    );
    const toolExecutions = Math.min(
      requested?.toolExecutions ?? definitionLimits.toolExecutions,
      ceiling?.toolExecutions ?? definitionLimits.toolExecutions,
    );
    const childWork = Math.min(
      requested?.childWork ?? definitionLimits.childWork,
      ceiling?.childWork ?? definitionLimits.childWork,
    );
    if (
      modelTurns > definitionLimits.modelTurns ||
      toolExecutions > definitionLimits.toolExecutions ||
      childWork > definitionLimits.childWork
    )
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: 'Work limits may only narrow the Agent definition',
      });
    return {
      maxModelTurns: modelTurns,
      maxToolExecutions: toolExecutions,
      maxChildWork: childWork,
      maxDepth: depth,
      maxAttempts: modelTurns + toolExecutions,
      maxDecisions: modelTurns + toolExecutions + 1,
    };
  }
  const definitionLimits = configured as PublicWorkflow['limits'];
  const operations = Math.min(
    requested?.operations ?? definitionLimits.operations,
    ceiling?.operations ?? definitionLimits.operations,
  );
  const toolExecutions = Math.min(
    requested?.toolExecutions ?? definitionLimits.toolExecutions,
    ceiling?.toolExecutions ?? definitionLimits.toolExecutions,
  );
  const childWork = Math.min(
    requested?.childWork ?? definitionLimits.childWork,
    ceiling?.childWork ?? definitionLimits.childWork,
  );
  if (
    operations > definitionLimits.operations ||
    toolExecutions > definitionLimits.toolExecutions ||
    childWork > definitionLimits.childWork
  )
    throw new ValidationError({
      code: 'INVALID_POLICY',
      message: 'Work limits may only narrow the Workflow definition',
    });
  return {
    maxOperations: operations,
    maxToolExecutions: toolExecutions,
    maxChildWork: childWork,
    maxDepth: depth,
    maxDecisions: operations,
    maxAttempts: toolExecutions,
  };
}

export function sessionState(value: {
  id: SessionId;
  title: string;
  status: 'active' | 'closed';
  agent: { id: string; version: string } | null;
  foregroundWork: WorkRef | null;
  queuedWork: readonly WorkRef[];
  createdAt: number;
  updatedAt: number;
}): SessionState {
  if (!value.agent)
    throw new ConflictError({ code: 'SESSION_AGENT_MISSING', message: 'Session has no Agent' });
  return Object.freeze({
    object: 'session',
    id: value.id,
    title: value.title,
    status: value.status === 'active' ? 'open' : 'closed',
    agent: reference('agent', value.agent.id, value.agent.version) as DefinitionReference & {
      kind: 'agent';
    },
    foregroundWorkId: value.foregroundWork?.id ?? null,
    queuedWorkIds: Object.freeze(value.queuedWork.map((work) => work.id)),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function workStatus(snapshot: Snapshot): WorkStatus {
  if (!snapshot.closure) return snapshot.status === 'waiting' ? 'waiting' : 'running';
  return snapshot.closure.status;
}

export function publicSnapshot<O extends Json, R extends Json>(
  snapshot: Snapshot<O, R>,
  record: RuntimeWorkRecord,
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

export function projectionSnapshot<O extends Json, R extends Json>(
  value: Json,
  record: RuntimeWorkRecord,
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

function unwrapClosure<R extends Json>(closure: Closure<R>): R {
  if (closure.status === 'completed') return closure.result;
  if (closure.status === 'canceled') throw new WorkCanceledError(closure.reason);
  throw new WorkFailedError(closure.reason);
}

export class WorkHandle<O extends Json, R extends Json> implements Work<O, R> {
  readonly id: WorkId;

  constructor(
    private readonly runtime: Runtime,
    private readonly caller: Caller,
    private readonly ref: WorkRef<O, R>,
    private readonly steerable: boolean,
    private readonly session?: { readonly id: SessionId },
  ) {
    this.id = ref.id;
  }

  async snapshot(): Promise<WorkSnapshot<O, R>> {
    try {
      return publicSnapshot(
        await this.runtime.forCaller(this.caller).work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async result(options: { signal?: AbortSignal } = {}): Promise<R> {
    try {
      return unwrapClosure(
        await this.runtime.forCaller(this.caller).work.result(this.ref, options),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async cancel(reason = 'Canceled by application', options: CancelOptions = {}) {
    const api = this.runtime.forCaller(this.caller);
    try {
      const before = await api.work.inspect(this.ref);
      if (before.closure)
        return publicSnapshot(before, this.runtime.workRecord(this.caller, this.id));
      const receipt = await api.work.cancel(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        expectedControl: before.controlToken as ControlToken,
        reason,
      });
      if (receipt.status !== 'accepted') {
        const after = await api.work.inspect(this.ref);
        if (after.closure)
          return publicSnapshot(after, this.runtime.workRecord(this.caller, this.id));
        throw commandError(receipt.reason, receipt.status);
      }
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async resolveEffect(
    callId: string,
    resolution: EffectResolution,
    options: { idempotencyKey?: string } = {},
  ): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const receipt = await api.work.resolveEffect(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        operationId: callId,
        resolution,
      });
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async respond(
    interactionId: string,
    response: Json,
    options: { idempotencyKey?: string } = {},
  ): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const before = await api.work.inspect(this.ref);
      const approval = before.approvals.find((candidate) => candidate.wait.id === interactionId);
      const interaction = [
        ...before.waits.map((wait) => wait.wait),
        ...before.approvals.map((approval) => approval.wait),
      ].find((wait) => wait.id === interactionId);
      if (!interaction)
        throw new ConflictError({
          code: 'INTERACTION_CLOSED',
          message: 'The interaction is no longer open',
        });
      if (approval && typeof response !== 'boolean')
        throw new ValidationError({
          code: 'INVALID_DATA',
          message: 'Approval responses must be Boolean',
        });
      const receipt = await api.work.reply(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        wait: interaction,
        payload: approval ? { decision: response ? 'approve' : 'deny' } : response,
      });
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async steer(input: O, options: { idempotencyKey?: string } = {}): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      if (!this.steerable)
        throw new ConflictError({
          code: 'STEERING_UNSUPPORTED',
          message: 'Only Agent-backed Work accepts steering',
        });
      const before = await api.work.inspect(this.ref);
      if (before.closure)
        throw new ConflictError({
          code: 'WORK_CLOSED',
          message: 'Completed Work cannot be steered',
        });
      const receipt = await api.work.steer(
        this.ref,
        {
          requestId: generatedRequestId(options.idempotencyKey),
          objectiveRevision: before.objectiveRevision,
          payload: input,
        },
        this.session,
      );
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async watch(
    options: { after?: string; signal?: AbortSignal } = {},
  ): Promise<Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>>> {
    const api = this.runtime.forCaller(this.caller);
    const initial = await api.work.inspect(this.ref);
    let value = publicSnapshot(initial, this.runtime.workRecord(this.caller, this.id));
    let sequence = initial.cursor;
    let cursor: string | null = null;
    let reset = false;
    if (options.after) {
      try {
        sequence = await api.work.eventCursor(this.ref, options.after);
        value = projectionSnapshot<O, R>(
          await api.work.projection(this.ref, options.after),
          this.runtime.workRecord(this.caller, this.id),
        );
        cursor = options.after;
      } catch {
        reset = true;
      }
    }
    if ((!options.after || reset) && sequence > 0) {
      const page = await api.work.history(this.ref, {
        after: (sequence - 1) as typeof sequence,
        through: sequence,
        limit: 1,
      });
      cursor = page.events[0]?.id ?? null;
    }
    const watcher: Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>> = {
      get value() {
        return value;
      },
      get cursor() {
        return cursor;
      },
      get reset() {
        return reset;
      },
      async *[Symbol.asyncIterator]() {
        while (true) {
          options.signal?.throwIfAborted();
          const page = await api.work.history(thisRef, { after: sequence, limit: 100 });
          if (!page.events.length) {
            if ((await api.work.inspect(thisRef)).closure) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
            continue;
          }
          for (const event of page.events) {
            options.signal?.throwIfAborted();
            sequence = event.cursor;
            value = projectionSnapshot<O, R>(
              await api.work.projection(thisRef, event.id),
              thisRuntime.workRecord(thisCaller, thisRef.id),
            );
            cursor = event.id;
            yield {
              durable: true,
              id: event.id,
              value: {
                object: 'work_update',
                type: 'work.updated',
                event: event.kind,
                snapshot: value,
              },
            };
          }
          if (
            value.status === 'completed' ||
            value.status === 'failed' ||
            value.status === 'canceled'
          )
            return;
        }
      },
    };
    const thisRef = this.ref;
    const thisRuntime = this.runtime;
    const thisCaller = this.caller;
    return watcher;
  }

  private interaction(
    snapshot: Snapshot,
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

  private async decisionEntry(
    event: WorkEvent,
    record: RuntimeWorkRecord,
    snapshot: Snapshot,
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
      tool: reference('tool', call.tool.id, call.tool.version) as DefinitionReference & {
        kind: 'tool';
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
    record: RuntimeWorkRecord,
    snapshot: Snapshot,
    diagnostic: boolean,
  ): Promise<InspectionEntry | null> {
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
      const interaction = this.interaction(snapshot, id, recorded);
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

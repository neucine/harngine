import type { Json, SessionId, WorkId } from './types.js';
import type { Workflow as PublicWorkflow } from './workflow.js';
import type { Tool as PublicTool } from './tool.js';
import type { Agent as PublicAgent } from './agent.js';
import type { ModelContext, ModelRequest, ModelResponse, ModelUsage } from './model.js';
import type { TelemetrySink } from './telemetry.js';
import type { GuardrailStage } from './guardrail.js';
import type { StateStoreConfiguration, StateStoreContract } from './state-store.js';

export type Definition = PublicWorkflow<any, any> | PublicAgent<any, any>;
export type RegisteredDefinition = Definition | PublicTool<any, any>;

export type DefinitionKind = 'agent' | 'workflow' | 'tool';

export interface DefinitionReference {
  readonly object: DefinitionKind;
  readonly kind: DefinitionKind;
  readonly id: string;
  readonly revision: `rev_${string}`;
}

export type ExecutableDefinitionReference = DefinitionReference & {
  readonly kind: 'agent' | 'workflow';
};

type ObjectiveOf<D> =
  D extends PublicWorkflow<infer O, any> ? O : D extends PublicAgent<infer O, any> ? O : never;
type ResultOf<D> =
  D extends PublicWorkflow<any, infer R> ? R : D extends PublicAgent<any, infer R> ? R : never;

export type WorkStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled';

export interface WorkSummary<O extends Json = Json> {
  readonly object: 'work';
  readonly id: WorkId;
  readonly definition: ExecutableDefinitionReference;
  readonly objective: O;
  readonly status: WorkStatus;
  readonly sessionId?: SessionId;
  readonly parentId?: WorkId;
  readonly childWorkIds: readonly WorkId[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkSnapshot<O extends Json = Json, R extends Json = Json> extends WorkSummary<O> {
  readonly result?: R;
  readonly error?: { readonly code: string; readonly message: string };
  readonly interactions: readonly Interaction[];
  /** Execution accounting on direct snapshots; event projections may omit it. */
  readonly usage?: {
    readonly decisions: number;
    readonly attempts: number;
    readonly modelTurns: number;
    readonly toolExecutions: number;
  };
  readonly limits?: {
    readonly maxDecisions: number;
    readonly maxAttempts: number;
    readonly maxModelTurns?: number;
    readonly maxToolExecutions?: number;
    readonly maxOperations?: number;
    readonly maxChildWork?: number;
    readonly maxDepth?: number;
  };
  readonly waitingFor?:
    | 'approval'
    | 'question'
    | 'timer'
    | 'effect-resolution'
    | 'external-result'
    | 'definition-unavailable';
}

export type Interaction =
  | {
      readonly object: 'interaction';
      readonly id: string;
      readonly type: 'question';
      readonly prompt: string;
      readonly response: Json;
      readonly blocking: boolean;
    }
  | {
      readonly object: 'interaction';
      readonly id: string;
      readonly type: 'approval';
      readonly blocking: boolean;
      readonly title: string;
      readonly details: Json;
      readonly tool?: { readonly id: string; readonly revision: string };
    };

export type WorkUpdate<O extends Json = Json, R extends Json = Json> = {
  readonly object: 'work_update';
  readonly type: 'work.updated';
  readonly event: string;
  readonly snapshot: WorkSnapshot<O, R>;
};

export type WatchedUpdate<U> =
  | { readonly durable: true; readonly id: string; readonly value: U }
  | { readonly durable: false; readonly value: U };

export interface Watch<S, U> extends AsyncIterable<WatchedUpdate<U>> {
  readonly value: S;
  readonly cursor: string | null;
  readonly reset: boolean;
}

export interface InspectionPresentation {
  readonly title: string;
  readonly summary?: string;
  readonly data?: Json;
}

interface InspectionEntryBase {
  readonly object: 'inspection_entry';
  readonly id: `event_${string}`;
  readonly recordedAt: number | null;
  readonly decisionSequence?: number;
  readonly presentation: InspectionPresentation;
}

export interface WorkStartedInspectionEntry extends InspectionEntryBase {
  readonly type: 'work.started';
  readonly definition: ExecutableDefinitionReference;
}

export interface InputInspectionEntry extends InspectionEntryBase {
  readonly type: 'input';
  readonly inputId?: string;
  readonly status:
    | 'accepted'
    | 'rejected'
    | 'incorporated'
    | 'ignored'
    | 'superseded'
    | 'canceled'
    | 'failed';
  readonly diagnostic?: { readonly reason?: { readonly code: string; readonly message: string } };
}

export interface DecisionInspectionEntry extends InspectionEntryBase {
  readonly type: 'decision';
  readonly source: 'agent' | 'workflow';
  readonly disposition: 'committed' | 'rejected' | 'superseded';
  readonly inputIds: readonly string[];
  readonly proposal: 'call' | 'child' | 'children' | 'join' | 'wait' | 'complete' | 'fail';
  readonly diagnostic?: {
    readonly context: ModelContext | Json | null;
    readonly modelRequest?: ModelRequest;
    readonly modelResponse?: ModelResponse;
    readonly interpretation: Json;
  };
}

export interface ModelProgressInspectionEntry extends InspectionEntryBase {
  readonly type: 'model.progress';
  readonly phase: 'started' | 'reasoning' | 'completed';
  readonly text?: string;
  readonly usage?: ModelUsage;
}

export interface GuardrailInspectionEntry extends InspectionEntryBase {
  readonly type: 'guardrail';
  readonly stage: GuardrailStage;
  readonly guardrail: { readonly id: string; readonly revision: `rev_${string}` };
  readonly action: 'allow' | 'redact' | 'block';
  readonly reason?: { readonly code: string; readonly message: string };
}

export interface CallInspectionEntry extends InspectionEntryBase {
  readonly type: 'call';
  readonly callId: string;
  readonly tool: DefinitionReference & { readonly kind: 'tool' };
  readonly phase:
    | 'committed'
    | 'authorized'
    | 'rejected'
    | 'admitted'
    | 'reconciling'
    | 'retrying'
    | 'settled'
    | 'resolved'
    | 'uncertain';
  readonly attemptCount: number;
  readonly diagnostic?: {
    readonly input: Json;
    readonly outcome?: Json;
    readonly attempts: readonly {
      readonly id: string;
      readonly sequence: number;
      readonly status: 'admitted' | 'settled' | 'unknown';
      readonly outcome?: Json;
    }[];
  };
}

export interface InteractionInspectionEntry extends InspectionEntryBase {
  readonly type: 'interaction';
  readonly interaction: Interaction;
  readonly status: 'pending' | 'approved' | 'denied' | 'replied' | 'expired' | 'withdrawn';
}

export interface ChildInspectionEntry extends InspectionEntryBase {
  readonly type: 'child';
  readonly callId: string;
  readonly childWorkId: WorkId;
  readonly slot: string;
  readonly phase: 'started' | 'joined' | 'closed';
  readonly mode: 'sequential' | 'concurrent';
  readonly joinSlot?: string;
  readonly definition: ExecutableDefinitionReference;
  readonly status?: 'completed' | 'failed' | 'canceled';
}

export interface WorkClosedInspectionEntry extends InspectionEntryBase {
  readonly type: 'work.closed';
  readonly status: 'completed' | 'failed' | 'canceled';
  readonly result?: Json;
  readonly error?: { readonly code: string; readonly message: string };
}

export type InspectionEntry =
  | WorkStartedInspectionEntry
  | InputInspectionEntry
  | DecisionInspectionEntry
  | CallInspectionEntry
  | ModelProgressInspectionEntry
  | GuardrailInspectionEntry
  | InteractionInspectionEntry
  | ChildInspectionEntry
  | WorkClosedInspectionEntry;

export interface InspectionPage<O extends Json = Json, R extends Json = Json> {
  readonly object: 'inspection';
  readonly work: WorkSnapshot<O, R>;
  readonly entries: readonly InspectionEntry[];
  readonly next: string | null;
  readonly hasMore: boolean;
}

export interface StartOptions {
  readonly context?: readonly Json[];
  readonly idempotencyKey?: string;
  readonly limits?: ExecutionLimits;
}

export interface CloseOptions {
  /** Abort current provider and Tool invocations instead of waiting for them. Defaults to true. */
  readonly abortInFlight?: boolean;
}

export interface ExecutionLimits {
  readonly modelTurns?: number;
  readonly toolExecutions?: number;
  readonly operations?: number;
  readonly childWork?: number;
  readonly depth?: number;
}

export interface CancelOptions {
  readonly idempotencyKey?: string;
}

export type EffectResolution =
  | { readonly status: 'success'; readonly value: Json }
  | {
      readonly status: 'failure';
      readonly effect: 'partial' | 'occurred';
      readonly reason: { readonly code: string; readonly message: string };
    }
  | {
      readonly status: 'not-applied';
      readonly reason: { readonly code: string; readonly message: string };
    };

export interface Work<O extends Json = Json, R extends Json = Json> {
  readonly id: WorkId;
  snapshot(): Promise<WorkSnapshot<O, R>>;
  result(options?: { signal?: AbortSignal }): Promise<R>;
  cancel(reason?: string, options?: CancelOptions): Promise<WorkSnapshot<O, R>>;
  resolveEffect(
    callId: string,
    resolution: EffectResolution,
    options?: { readonly idempotencyKey?: string },
  ): Promise<WorkSnapshot<O, R>>;
  respond(
    interactionId: string,
    response: Json,
    options?: { readonly idempotencyKey?: string },
  ): Promise<WorkSnapshot<O, R>>;
  steer(input: O, options?: { readonly idempotencyKey?: string }): Promise<WorkSnapshot<O, R>>;
  watch(options?: {
    after?: string;
    signal?: AbortSignal;
  }): Promise<Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>>>;
  inspect(options?: {
    detail?: 'story' | 'diagnostic';
    after?: string;
    limit?: number;
  }): Promise<InspectionPage<O, R>>;
}

export interface AppScope {
  readonly sessions: Sessions;
  readonly works: Works;
  start<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions,
  ): Promise<Work<ObjectiveOf<D>, ResultOf<D>>>;
  start(
    definition: ExecutableDefinitionReference,
    objective: Json,
    options?: StartOptions,
  ): Promise<Work>;
  run<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<ResultOf<D>>;
  run(
    definition: ExecutableDefinitionReference,
    objective: Json,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<Json>;
}

export interface App extends AppScope {
  readonly sessions: Sessions;
  readonly works: Works;
  readonly definitions: Definitions;
  readonly diagnostics: Diagnostics;
  readonly storage: StateStoreContract;
  describe(definition: RegisteredDefinition): DefinitionDescription;
  forPrincipal(principal: string): AppScope;
  /**
   * Stop background execution and close storage. In-flight providers are aborted by default;
   * set `abortInFlight` to false to wait for their current invocation.
   */
  close(options?: CloseOptions): Promise<void>;
}

export interface DiagnosticRecord {
  readonly object: 'diagnostic_record';
  readonly table: string;
  readonly key: string;
  readonly value: Json;
}

export interface DiagnosticPage {
  readonly object: 'list';
  readonly records: readonly DiagnosticRecord[];
  readonly next: string | null;
}

export interface Diagnostics {
  records(
    workId: WorkId,
    options?: { readonly after?: string; readonly limit?: number },
  ): Promise<DiagnosticPage>;
}

interface DefinitionDescriptionBase {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly availability: 'available' | 'unavailable';
}

export interface AgentDescription extends DefinitionDescriptionBase {
  readonly object: 'agent';
  readonly kind: 'agent';
  readonly instructions: readonly string[];
  readonly objective: Json;
  readonly result: Json;
  readonly model: { readonly id: string; readonly capabilities: Json };
  readonly tools: readonly (DefinitionReference & { readonly kind: 'tool' })[];
  readonly delegates: readonly ExecutableDefinitionReference[];
  readonly context: Json;
  readonly limits: Json;
  readonly guardrails: readonly GuardrailDescription[];
}

export interface WorkflowDescription extends DefinitionDescriptionBase {
  readonly object: 'workflow';
  readonly kind: 'workflow';
  readonly objective: Json;
  readonly result: Json;
  readonly tools: readonly (DefinitionReference & { readonly kind: 'tool' })[];
  readonly children: readonly ExecutableDefinitionReference[];
  readonly limits: Json;
}

export interface ToolDescription extends DefinitionDescriptionBase {
  readonly object: 'tool';
  readonly kind: 'tool';
  readonly description?: string;
  readonly input: Json;
  readonly output: Json;
  readonly effect: 'read' | 'write';
  readonly capabilities: import('./tool.js').ToolCapabilities;
  readonly reconcilable: boolean;
  readonly approval?: Json;
  readonly retry: Json;
  readonly guardrails: readonly GuardrailDescription[];
}

export interface GuardrailDescription {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly stages: readonly GuardrailStage[];
}

export type DefinitionDescription = AgentDescription | WorkflowDescription | ToolDescription;

export interface Definitions {
  list(options?: {
    readonly kind?: DefinitionKind;
    readonly id?: string;
    readonly availability?: 'available' | 'unavailable';
    readonly page?: string;
    readonly limit?: number;
  }): Promise<{
    readonly object: 'list';
    readonly definitions: readonly DefinitionDescription[];
    readonly next: string | null;
  }>;
  get(reference: DefinitionReference): Promise<DefinitionDescription>;
}

export interface Works {
  list(options?: {
    readonly status?: WorkStatus | readonly WorkStatus[];
    readonly definition?: ExecutableDefinitionReference;
    readonly sessionId?: SessionId;
    readonly page?: string;
    readonly limit?: number;
  }): Promise<{
    readonly object: 'list';
    readonly works: readonly WorkSummary[];
    readonly next: string | null;
  }>;
  get(id: WorkId): Promise<Work>;
}

export interface Message {
  readonly object: 'message';
  readonly id: string;
  readonly author: 'human' | 'agent';
  readonly content: Json;
  readonly recordedAt: number;
  readonly workId?: WorkId;
}

export interface SessionState {
  readonly object: 'session';
  readonly id: SessionId;
  readonly title: string;
  readonly status: 'open' | 'closed';
  readonly agent: DefinitionReference & { readonly kind: 'agent' };
  readonly foregroundWorkId: WorkId | null;
  readonly queuedWorkIds: readonly WorkId[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionSnapshot extends SessionState {
  readonly recentMessages: readonly Message[];
  readonly foregroundWork: WorkSnapshot | null;
}

export interface SessionHandoff {
  readonly object: 'session_handoff';
  readonly id: `handoff_${string}`;
  readonly from: DefinitionReference & { readonly kind: 'agent' };
  readonly to: DefinitionReference & { readonly kind: 'agent' };
  readonly reason?: string;
  readonly recordedAt: number;
  readonly sessionVersion: number;
}

export interface SessionHandoffOptions {
  readonly reason?: string;
  readonly idempotencyKey?: string;
}

export type SessionUpdate = {
  readonly object: 'session_update';
  readonly type: 'session.updated';
  readonly event: 'message.appended' | 'ownership.changed' | 'work.updated' | 'session.closed';
  readonly workId?: WorkId;
  readonly snapshot: SessionSnapshot;
};

export interface Session<O extends Json = Json, R extends Json = Json> {
  readonly id: SessionId;
  snapshot(): Promise<SessionSnapshot>;
  messages(options?: { before?: string; limit?: number }): Promise<readonly Message[]>;
  /** Return durable ownership transfers, newest first. */
  handoffs(options?: { before?: string; limit?: number }): Promise<readonly SessionHandoff[]>;
  /**
   * Transfer future conversation ownership to an exact Agent revision after the Session is idle.
   * The previous typed handle rejects `send()` after an accepted transfer.
   */
  handoff<NO extends Json, NR extends Json>(
    agent: PublicAgent<NO, NR>,
    options?: SessionHandoffOptions,
  ): Promise<Session<NO, NR>>;
  handoff(
    agent: DefinitionReference & { readonly kind: 'agent' },
    options?: SessionHandoffOptions,
  ): Promise<Session>;
  send(
    message: O,
    options?: { readonly limits?: ExecutionLimits; readonly idempotencyKey?: string },
  ): Promise<{ message: Message; work: Work<O, R> }>;
  watch(options?: {
    after?: string;
    signal?: AbortSignal;
  }): Promise<Watch<SessionSnapshot, SessionUpdate>>;
  close(options?: { readonly idempotencyKey?: string }): Promise<SessionState>;
}

export interface Sessions {
  create<O extends Json, R extends Json>(options: {
    agent: PublicAgent<O, R>;
    title: string;
    idempotencyKey?: string;
  }): Promise<Session<O, R>>;
  create(options: {
    agent: DefinitionReference & { readonly kind: 'agent' };
    title: string;
    idempotencyKey?: string;
  }): Promise<Session>;
  get(id: SessionId): Promise<Session>;
  list(options?: { page?: string; limit?: number }): Promise<{
    readonly object: 'list';
    readonly sessions: readonly SessionState[];
    readonly next: string | null;
  }>;
}

export interface AppOptions {
  readonly directory: string;
  readonly principal?: string;
  readonly workflows?: readonly PublicWorkflow<any, any>[];
  readonly agents?: readonly PublicAgent<any, any>[];
  readonly tools?: readonly PublicTool<any, any>[];
  readonly access?: AccessPolicy | { readonly allowAuthenticated: true };
  readonly limits?: ExecutionLimits;
  readonly telemetry?: TelemetrySink;
  readonly stateStore?: StateStoreConfiguration;
}

export interface AccessPolicy {
  readonly revision: string;
  canStart(input: {
    principal: string;
    definition: { id: string; revision: string };
    objective: Json;
  }): boolean | Promise<boolean>;
  canCall(input: {
    principal: string;
    workId: WorkId;
    target: {
      kind: 'tool' | 'agent' | 'workflow';
      id: string;
      revision: string;
    };
    /** Compatibility alias for Tool-only policies. It names the selected CallTarget. */
    tool: { id: string; revision: string };
    input: Json;
  }): boolean | Promise<boolean>;
  canRespond(input: {
    principal: string;
    workId: WorkId;
    interactionId: string;
  }): boolean | Promise<boolean>;
  /** Explicitly authorize an idle conversation ownership transfer between Agent revisions. */
  canHandoff?(input: {
    principal: string;
    sessionId: SessionId;
    fromAgent: { readonly id: string; readonly revision: string };
    toAgent: { readonly id: string; readonly revision: string };
    reason?: string;
  }): boolean | Promise<boolean>;
}

export { createApp } from './internal/app-application.js';

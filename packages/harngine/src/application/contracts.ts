import type { Json, SessionId, WorkId } from '../core/types.js';
import type { Workflow } from '../authoring/workflow.js';
import type { Agent } from '../authoring/agent.js';
import type { Tool as PublicTool } from '../authoring/tool.js';
import type { ModelDelta } from '../core/model.js';
import type { TelemetrySink } from '../core/telemetry.js';
import type { StateStoreConfiguration, StateStoreContract } from '../storage/sqlite/contracts.js';
import type {
  DefinitionDescription,
  DefinitionRef,
  DefinitionType,
  ExecutableDefinitionRef,
} from '../core/definition.js';
export type {
  DefinitionDescription,
  DefinitionRef,
  DefinitionType,
  ExecutableDefinitionRef,
  AgentDescription,
  WorkflowDescription,
  ToolDescription,
  GuardrailDescription,
} from '../core/definition.js';

export type Definition = Workflow<any, any> | Agent<any, any>;
export type RegisteredDefinition = Definition | PublicTool<any, any>;

type ObjectiveOf<D> =
  D extends Workflow<infer O, any> ? O : D extends Agent<infer O, any> ? O : never;
type ResultOf<D> = D extends Workflow<any, infer R> ? R : D extends Agent<any, infer R> ? R : never;

import type { WorkSnapshot, WorkSummary, WorkStatus, WorkUpdate, Watch } from '../core/work.js';
export type {
  WorkSnapshot,
  WorkSummary,
  WorkStatus,
  WorkUpdate,
  WatchedUpdate,
  Watch,
} from '../core/work.js';
export type { Interaction } from '../core/interaction.js';

import type { InspectionPage } from '../core/inspection.js';
export type {
  InspectionPage,
  InspectionEntry,
  InspectionPresentation,
  WorkStartedInspectionEntry,
  InputInspectionEntry,
  DecisionInspectionEntry,
  ModelProgressInspectionEntry,
  GuardrailInspectionEntry,
  CallInspectionEntry,
  InteractionInspectionEntry,
  ChildInspectionEntry,
  WorkClosedInspectionEntry,
} from '../core/inspection.js';

export interface StartOptions {
  readonly context?: readonly Json[];
  readonly idempotencyKey?: string;
  readonly limits?: ExecutionLimits;
}

export interface CloseOptions {
  /** Abort current provider and Tool invocations instead of waiting for them. Defaults to true. */
  readonly abortInFlight?: boolean;
}

import type { ExecutionLimits } from '../core/work.js';
export type { ExecutionLimits } from '../core/work.js';

export interface CancelOptions {
  readonly idempotencyKey?: string;
}

import type { EffectResolution } from '../core/operation.js';
export type { EffectResolution } from '../core/operation.js';

export interface WorkHandle<O extends Json = Json, R extends Json = Json> {
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
    /**
     * Observe ordered provider items while this watch is being consumed.
     * Callbacks are transient and stop when iteration ends or `signal` aborts.
     */
    onModelDelta?: (delta: ModelDelta) => void;
  }): Promise<Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>>>;
  inspect(options?: {
    detail?: 'story' | 'diagnostic';
    after?: string;
    limit?: number;
  }): Promise<InspectionPage<O, R>>;
}

import type { Audit, AuditOptions } from '../core/audit.js';
export type {
  AuditCategory,
  AuditCorrelation,
  AuditTarget,
  AuditEntry,
  AuditQuery,
  AuditPage,
  AuditRetention,
  AuditRedactor,
  AuditOptions,
  JsonAuditExport,
  OtelAuditExport,
  AuditExportBatch,
  AuditExportSink,
  AuditExportOptions,
  Audit,
} from '../core/audit.js';

export interface AppScope {
  readonly audit: Audit;
  readonly sessions: Sessions;
  readonly works: Works;
  start<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions,
  ): Promise<WorkHandle<ObjectiveOf<D>, ResultOf<D>>>;
  start(
    definition: ExecutableDefinitionRef,
    objective: Json,
    options?: StartOptions,
  ): Promise<WorkHandle>;
  run<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<ResultOf<D>>;
  run(
    definition: ExecutableDefinitionRef,
    objective: Json,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<Json>;
}

export interface App extends AppScope {
  readonly audit: Audit;
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

import type { DiagnosticPage } from '../core/inspection.js';
export type { DiagnosticRecord, DiagnosticPage } from '../core/inspection.js';

export interface Diagnostics {
  records(
    workId: WorkId,
    options?: { readonly after?: string; readonly limit?: number },
  ): Promise<DiagnosticPage>;
}

export interface Definitions {
  list(options?: {
    readonly type?: DefinitionType;
    readonly id?: string;
    readonly availability?: 'available' | 'unavailable';
    readonly page?: string;
    readonly limit?: number;
  }): Promise<{
    readonly object: 'list';
    readonly definitions: readonly DefinitionDescription[];
    readonly next: string | null;
  }>;
  get(reference: DefinitionRef): Promise<DefinitionDescription>;
}

export interface Works {
  list(options?: {
    readonly status?: WorkStatus | readonly WorkStatus[];
    readonly definition?: ExecutableDefinitionRef;
    readonly sessionId?: SessionId;
    readonly page?: string;
    readonly limit?: number;
  }): Promise<{
    readonly object: 'list';
    readonly works: readonly WorkSummary[];
    readonly next: string | null;
  }>;
  get(id: WorkId): Promise<WorkHandle>;
}

import type {
  Message,
  SessionSnapshot,
  SessionState,
  SessionUpdate,
  SessionHandoff,
  SessionHandoffOptions,
} from '../core/session.js';
export type {
  Message,
  SessionSnapshot,
  SessionState,
  SessionUpdate,
  SessionHandoff,
  SessionHandoffOptions,
} from '../core/session.js';

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
    agent: Agent<NO, NR>,
    options?: SessionHandoffOptions,
  ): Promise<Session<NO, NR>>;
  handoff(
    agent: DefinitionRef & { readonly type: 'agent' },
    options?: SessionHandoffOptions,
  ): Promise<Session>;
  send(
    message: O,
    options?: { readonly limits?: ExecutionLimits; readonly idempotencyKey?: string },
  ): Promise<{ message: Message; work: WorkHandle<O, R> }>;
  watch(options?: {
    after?: string;
    signal?: AbortSignal;
  }): Promise<Watch<SessionSnapshot, SessionUpdate>>;
  close(options?: { readonly idempotencyKey?: string }): Promise<SessionState>;
}

export interface Sessions {
  create<O extends Json, R extends Json>(options: {
    agent: Agent<O, R>;
    title: string;
    idempotencyKey?: string;
  }): Promise<Session<O, R>>;
  create(options: {
    agent: DefinitionRef & { readonly type: 'agent' };
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
  readonly workflows?: readonly Workflow<any, any>[];
  readonly agents?: readonly Agent<any, any>[];
  readonly tools?: readonly PublicTool<any, any>[];
  readonly access?: AccessPolicy | { readonly allowAuthenticated: true };
  readonly limits?: ExecutionLimits;
  readonly telemetry?: TelemetrySink;
  readonly stateStore?: StateStoreConfiguration;
  readonly audit?: AuditOptions;
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
      type: 'tool' | 'agent' | 'workflow';
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

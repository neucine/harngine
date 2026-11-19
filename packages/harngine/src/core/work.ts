import type { Approval } from './interaction.js';
import type { Call } from './operation.js';
import type { InputDisposition } from './interaction.js';
import type { InputPolicy } from './interaction.js';
import type { Input } from './interaction.js';
import type { Interaction } from './interaction.js';
import type { Tool } from './operation.js';
import type { WaitPlan } from './interaction.js';
import type { Wait } from './interaction.js';
import type {
  ControlToken,
  Identity,
  Json,
  ObjectiveRevision,
  ProgressCursor,
  Reason,
  RequestId,
  Schema,
  SessionId,
  WorkId,
} from './types.js';
import type { ExecutableDefinitionRef } from './definition.js';

export type WorkStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled';

export interface WorkSummary<O extends Json = Json> {
  readonly object: 'work';
  readonly id: WorkId;
  readonly definition: ExecutableDefinitionRef;
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

export interface ExecutionLimits {
  readonly modelTurns?: number;
  readonly toolExecutions?: number;
  readonly operations?: number;
  readonly childWork?: number;
  readonly depth?: number;
}

export interface ExecutionPolicy {
  readonly maxDecisions: number;
  readonly maxAttempts: number;
  readonly maxOperations?: number;
  readonly maxModelTurns?: number;
  readonly maxToolExecutions?: number;
  readonly maxChildWork?: number;
  readonly maxDepth?: number;
}
export interface ChildWorkRecord {
  readonly callId: string;
  readonly slot: string;
  readonly work: WorkRef;
  readonly objective: Json;
  readonly definitionKind: 'agent' | 'workflow';
  readonly mode: 'sequential' | 'concurrent';
  readonly joinSlot: string | null;
  readonly status: 'active' | 'waiting' | 'closed';
  readonly closure: Closure | null;
}
export interface View<O extends Json = Json, S extends Json = Json, I extends Json = Json> {
  readonly workId: WorkId;
  readonly objective: O;
  readonly state: S;
  /** Bounded context selected before this Work was accepted. */
  readonly context: readonly Json[];
  readonly basis: number;
  readonly objectiveRevision: ObjectiveRevision;
  readonly stateRevision: ObjectiveRevision;
  readonly controlToken: ControlToken;
  readonly calls: Readonly<Record<string, Call>>;
  readonly children: Readonly<Record<string, ChildWorkRecord>>;
  readonly waits: Readonly<Record<string, Wait>>;
  readonly inputs: readonly Input<I>[];
  readonly inputBoundary: number;
  readonly hasMoreInputs: boolean;
}
export type Proposal<S extends Json = Json, R extends Json = Json> = {
  readonly dispositions?: readonly InputDisposition[];
} & (
  | { type: 'call'; state: S; call: { slot: string; tool: Identity; input: Json } }
  | {
      type: 'child';
      state: S;
      child: {
        slot: string;
        definition: Identity;
        objective: Json;
        mode?: 'sequential' | 'concurrent';
      };
    }
  | {
      type: 'children';
      state: S;
      children: readonly {
        slot: string;
        definition: Identity;
        objective: Json;
        mode?: 'sequential' | 'concurrent';
      }[];
    }
  | { type: 'join'; state: S; join: { slot: string; child: string } }
  | { type: 'complete'; result: R }
  | { type: 'fail'; reason: Reason }
  | { type: 'wait'; state: S; until?: WaitPlan }
);
export interface Workflow<
  O extends Json = Json,
  S extends Json = Json,
  R extends Json = Json,
  I extends Json = Json,
> extends Identity {
  readonly artifactDigest: string;
  readonly objective: Schema<O>;
  readonly state: Schema<S>;
  readonly result: Schema<R>;
  readonly input?: InputPolicy<I>;
  readonly replySchemas?: readonly Schema[];
  readonly policy: ExecutionPolicy;
  readonly tools: readonly Identity[];
  readonly children?: readonly Identity[];
  readonly initial: (objective: O) => S;
  readonly decide: (view: View<O, S, I>) => Proposal<S, R>;
}
export interface WorkRef<O extends Json = Json, R extends Json = Json, I extends Json = Json> {
  readonly id: WorkId;
  readonly definition: Identity;
  readonly __objective?: O;
  readonly __result?: R;
  readonly __input?: I;
}
export type Receipt<T, Target = WorkId, Cursor = ProgressCursor> = {
  requestId: RequestId;
  cursor?: Cursor;
} & (
  | { status: 'accepted'; target: Target; value: T }
  | { status: 'rejected' | 'conflict'; target?: Target; reason: Reason }
);
export type Closure<R extends Json = Json> =
  | { status: 'completed'; result: R }
  | { status: 'failed' | 'canceled'; reason: Reason };
/** Execution state returned by the engine. Public Work views are projected from this shape. */
export interface ExecutionSnapshot<O extends Json = Json, R extends Json = Json> {
  readonly id: WorkId;
  readonly objective: O;
  readonly state: Json;
  readonly context: readonly Json[];
  readonly objectiveRevision: ObjectiveRevision;
  readonly stateRevision: ObjectiveRevision;
  readonly controlToken: ControlToken;
  readonly status: 'active' | 'waiting' | 'closed';
  readonly closure: Closure<R> | null;
  readonly calls: readonly Call[];
  readonly approvals: readonly Approval[];
  readonly waits: readonly Wait[];
  readonly inputs: readonly Input[];
  readonly limits: ExecutionPolicy;
  readonly usage: {
    readonly decisions: number;
    readonly attempts: number;
    readonly modelTurns: number;
    readonly toolExecutions: number;
  };
  readonly concerns: readonly Reason[];
  readonly cursor: ProgressCursor;
}
export type AnyWorkflow = Workflow<any, any, any, any>;
export type AnyTool = Tool<any, any>;

export interface CancelRequest {
  readonly requestId: RequestId;
  readonly expectedControl: ControlToken;
  readonly reason: string;
}
export interface ReviseRequest<O extends Json> {
  readonly requestId: RequestId;
  readonly expectedControl: ControlToken;
  readonly objective: O;
}
export interface ControlAcceptance {
  readonly revision: ObjectiveRevision;
  readonly controlToken: ControlToken;
}

/** Current durable Work metadata used alongside an execution snapshot or committed event. */
export interface Work {
  readonly ref: WorkRef;
  readonly kind: 'agent' | 'workflow';
  readonly objective: Json;
  readonly status: 'active' | 'waiting' | 'closed';
  readonly closure: Closure | null;
  readonly sessionId: SessionId | null;
  readonly parentId: WorkId | null;
  readonly childWorkIds: readonly WorkId[];
  readonly queued: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

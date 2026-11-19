import type { CallRecord } from './operation.js';
import type { ControlToken } from './types.js';
import type { Identity } from './types.js';
import type { ObjectiveRevision } from './types.js';
import type { Outcome } from './operation.js';
import type { ProgressCursor } from './types.js';
import type { Proposal } from './work.js';
import type { Json, WorkId } from './types.js';
import type { ExecutableDefinitionReference, DefinitionReference } from './definition.js';
import type { WorkSnapshot, Interaction } from './work.js';
import type { ModelContext, ModelRequest, ModelResponse, ModelUsage } from './model.js';
import type { GuardrailStage } from './guardrail.js';

// -- Inspection

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
  readonly tool: DefinitionReference & { readonly type: 'tool' };
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

export interface WorkHistoryOptions {
  after?: ProgressCursor;
  through?: ProgressCursor;
  limit?: number;
}
export interface WorkEvent {
  readonly id: string;
  readonly cursor: ProgressCursor;
  readonly kind: string;
  readonly body: Json;
  readonly recordedAt: number | null;
  readonly decisionSequence: number | null;
}
export interface WorkHistory {
  readonly events: readonly WorkEvent[];
  readonly nextCursor: ProgressCursor;
  readonly through: ProgressCursor;
  readonly hasMore: boolean;
}
export interface DecisionInspection {
  readonly sequence: number;
  readonly proposal: Proposal;
  readonly inputBoundary: number;
  readonly inputIds: readonly string[];
  readonly context: {
    readonly objective: Json;
    readonly state: Json;
    readonly basis: number;
    readonly objectiveRevision: ObjectiveRevision;
    readonly stateRevision: ObjectiveRevision;
    readonly controlToken: ControlToken;
  } | null;
}
export interface CallInspection extends CallRecord {
  readonly tool: Identity;
  readonly input: Json;
  readonly decisionSequence: number;
  readonly controlToken: ControlToken;
  readonly attempts: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly status: 'admitted' | 'settled' | 'unknown';
    readonly charged: number;
    readonly outcome: Outcome | null;
  }[];
}

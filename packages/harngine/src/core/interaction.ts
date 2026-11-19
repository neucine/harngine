import type { ControlToken } from './types.js';
import type { Identity } from './types.js';
import type { ObjectiveRevision } from './types.js';
import type { Reason } from './types.js';
import type { RequestId } from './types.js';
import type { Json, Schema, WorkId } from './types.js';

/** A question or approval shown in a public Work snapshot. */
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

export interface ApprovalPolicy {
  readonly approvers: readonly string[];
  readonly timeoutMs: number;
}
export interface WaitRef {
  readonly id: string;
  readonly workId: WorkId;
}
export interface ApprovalReply {
  readonly requestId: RequestId;
  readonly wait: WaitRef;
  readonly payload: { readonly decision: 'approve' | 'deny' };
}
export interface ApprovalAcceptance {
  readonly wait: WaitRef;
  readonly decision: 'approve' | 'deny';
}
export interface Approval {
  readonly wait: WaitRef;
  readonly operationId: string;
  readonly tool: Identity;
  readonly input: Json;
  readonly objectiveRevision: ObjectiveRevision;
  readonly controlToken: ControlToken;
  readonly approvers: readonly string[];
  readonly expiresAt: number;
  readonly admissionLimit: 1;
  readonly status: 'pending' | 'approved' | 'denied' | 'expired' | 'withdrawn';
  readonly invalidation: 'expired' | 'withdrawn' | null;
  readonly admittedAttemptId: string | null;
}

/** Ordinary evidence; this cannot authorize a call or settle an approval. */
export interface InputPolicy<I extends Json = Json> {
  readonly schema: Schema<I>;
  readonly maxPending: number;
  readonly batchSize: number;
}
export interface InputRequest<I extends Json = Json> {
  readonly requestId: RequestId;
  readonly objectiveRevision: ObjectiveRevision;
  readonly payload: I;
}
export interface InputAcceptance {
  readonly id: string;
  readonly sequence: number;
}
export type InputDisposition =
  | { readonly id: string; readonly status: 'incorporated' }
  | { readonly id: string; readonly status: 'ignored'; readonly reason: Reason };
export interface Input<I extends Json = Json> extends InputAcceptance {
  readonly objectiveRevision: ObjectiveRevision;
  readonly payload: I;
  readonly status: 'pending' | 'incorporated' | 'ignored' | 'superseded' | 'canceled' | 'failed';
  readonly reason: Reason | null;
  readonly decision: number | null;
}

export type WaitPlan =
  | {
      readonly type: 'reply';
      readonly slot: string;
      readonly schema: Identity;
      readonly prompt?: string;
      readonly blocking?: boolean;
      readonly interaction?: 'question' | 'approval';
      readonly presentation?: Json;
      readonly responders: readonly string[];
      readonly timeoutMs?: number;
    }
  | {
      readonly type: 'timer';
      readonly slot: string;
      readonly delayMs: number;
      readonly operation?: 'sleep' | 'now';
    }
  | { readonly type: 'existing'; readonly slot: string }
  | { readonly type: 'all' | 'any'; readonly conditions: readonly WaitPlan[] };
export interface ReplyRequest {
  readonly requestId: RequestId;
  readonly wait: WaitRef;
  readonly payload: Json;
}
export interface ReplyAcceptance {
  readonly wait: WaitRef;
}
export interface Wait {
  readonly wait: WaitRef;
  readonly slot: string;
  readonly kind: 'reply' | 'timer';
  readonly decisionSequence: number;
  readonly objectiveRevision: ObjectiveRevision;
  readonly controlToken: ControlToken;
  readonly schema: Schema | null;
  readonly prompt: string | null;
  readonly blocking: boolean;
  readonly interaction: 'question' | 'approval';
  readonly presentation: Json;
  readonly operation: 'sleep' | 'now' | null;
  readonly delayMs: number | null;
  readonly responders: readonly string[];
  readonly deadline: number | null;
  readonly status: 'pending' | 'replied' | 'expired' | 'fired' | 'withdrawn';
  readonly payload: Json;
  readonly respondedBy: string | null;
}

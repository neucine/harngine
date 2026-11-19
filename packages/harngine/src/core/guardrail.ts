export type GuardrailStage = 'model-input' | 'model-output' | 'tool-input' | 'tool-output';

import type { Json } from './types.js';

export interface GuardrailSubject {
  readonly type: 'agent' | 'tool';
  readonly id: string;
  readonly revision: `rev_${string}`;
}

export interface GuardrailReason {
  readonly code: string;
  readonly message: string;
}

export type GuardrailResult =
  | { readonly action: 'allow' }
  | { readonly action: 'redact'; readonly value: Json; readonly reason: GuardrailReason }
  | { readonly action: 'block'; readonly reason: GuardrailReason };

export interface Guardrail {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly stages: readonly GuardrailStage[];
  check(input: {
    readonly stage: GuardrailStage;
    readonly value: Json;
    readonly subject: GuardrailSubject;
    readonly signal: AbortSignal;
  }): GuardrailResult | Promise<GuardrailResult>;
}

export interface GuardrailDecision {
  readonly object: 'guardrail_decision';
  readonly stage: GuardrailStage;
  readonly guardrail: { readonly id: string; readonly revision: `rev_${string}` };
  readonly action: 'allow' | 'redact' | 'block';
  readonly reason?: GuardrailReason;
}

export interface GuardrailRun {
  readonly allowed: boolean;
  readonly value: Json;
  readonly decisions: readonly GuardrailDecision[];
}

import { RuntimeError } from './internal/contracts.js';
import { copy, frozen } from './schema.js';
import type { Json } from './types.js';

export type GuardrailStage = 'model-input' | 'model-output' | 'tool-input' | 'tool-output';

export interface GuardrailSubject {
  readonly kind: 'agent' | 'tool';
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

const stages: readonly GuardrailStage[] = [
  'model-input',
  'model-output',
  'tool-input',
  'tool-output',
];

function reason(value: unknown, fallbackCode: string): GuardrailReason {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as { code?: unknown; message?: unknown };
    if (
      typeof candidate.code === 'string' &&
      candidate.code.trim() &&
      candidate.code.length <= 128 &&
      typeof candidate.message === 'string' &&
      candidate.message.trim() &&
      candidate.message.length <= 2000
    )
      return Object.freeze({ code: candidate.code, message: candidate.message });
  }
  return Object.freeze({
    code: fallbackCode,
    message: 'Guardrail returned an invalid decision',
  });
}

export function guardrail(definition: Guardrail): Guardrail {
  if (Object.keys(definition).some((name) => !['id', 'revision', 'stages', 'check'].includes(name)))
    throw new RuntimeError('UNSUPPORTED', 'Unsupported Guardrail configuration');
  if (!definition.id || definition.id.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Guardrail id must contain 1–256 characters');
  if (!definition.revision.startsWith('rev_') || definition.revision.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Guardrail revision must be a rev_ identity');
  if (
    !Array.isArray(definition.stages) ||
    definition.stages.length === 0 ||
    definition.stages.some((stage) => !stages.includes(stage)) ||
    new Set(definition.stages).size !== definition.stages.length
  )
    throw new RuntimeError('INVALID_DEFINITION', 'Guardrail stages must be unique and supported');
  if (typeof definition.check !== 'function')
    throw new RuntimeError('INVALID_DEFINITION', 'Guardrail requires a check function');
  return Object.freeze({
    id: definition.id,
    revision: definition.revision,
    stages: Object.freeze([...definition.stages]),
    check: definition.check,
  });
}

export function guardrailIdentity(definition: Guardrail): {
  readonly id: string;
  readonly revision: `rev_${string}`;
} {
  return Object.freeze({
    id: definition.id,
    revision: definition.revision,
  });
}

export function guardrailsForStage(
  definitions: readonly Guardrail[],
  stage: GuardrailStage,
): readonly Guardrail[] {
  return definitions.filter((definition) => definition.stages.includes(stage));
}

/** Run a fail-closed, ordered guardrail pipeline. Only decisions, never transformed values, are safe to record. */
export async function runGuardrails(
  definitions: readonly Guardrail[],
  input: {
    readonly stage: GuardrailStage;
    readonly value: Json;
    readonly subject: GuardrailSubject;
    readonly signal: AbortSignal;
  },
): Promise<GuardrailRun> {
  let value = input.value;
  const decisions: GuardrailDecision[] = [];
  for (const definition of guardrailsForStage(definitions, input.stage)) {
    input.signal.throwIfAborted();
    let result: GuardrailResult;
    try {
      result = await definition.check({ ...input, value });
    } catch {
      const blockedReason = Object.freeze({
        code: 'GUARDRAIL_FAILED',
        message: `Guardrail ${definition.id} failed closed`,
      });
      decisions.push(
        Object.freeze({
          object: 'guardrail_decision',
          stage: input.stage,
          guardrail: guardrailIdentity(definition),
          action: 'block',
          reason: blockedReason,
        }),
      );
      return Object.freeze({
        allowed: false,
        value,
        decisions: Object.freeze(decisions),
      });
    }
    if (!result || typeof result !== 'object' || !('action' in result)) {
      const blockedReason = reason(result, 'GUARDRAIL_INVALID');
      decisions.push(
        Object.freeze({
          object: 'guardrail_decision',
          stage: input.stage,
          guardrail: guardrailIdentity(definition),
          action: 'block',
          reason: blockedReason,
        }),
      );
      return Object.freeze({
        allowed: false,
        value,
        decisions: Object.freeze(decisions),
      });
    }
    if (result.action === 'allow') {
      decisions.push(
        Object.freeze({
          object: 'guardrail_decision',
          stage: input.stage,
          guardrail: guardrailIdentity(definition),
          action: 'allow',
        }),
      );
      continue;
    }
    if (result.action === 'redact') {
      try {
        value = frozen(copy(result.value));
      } catch {
        value = null;
        const blockedReason = Object.freeze({
          code: 'GUARDRAIL_INVALID',
          message: `Guardrail ${definition.id} returned invalid redacted JSON`,
        });
        decisions.push(
          Object.freeze({
            object: 'guardrail_decision',
            stage: input.stage,
            guardrail: guardrailIdentity(definition),
            action: 'block',
            reason: blockedReason,
          }),
        );
        return Object.freeze({
          allowed: false,
          value,
          decisions: Object.freeze(decisions),
        });
      }
      decisions.push(
        Object.freeze({
          object: 'guardrail_decision',
          stage: input.stage,
          guardrail: guardrailIdentity(definition),
          action: 'redact',
          reason: reason(result.reason, 'GUARDRAIL_REDACTED'),
        }),
      );
      continue;
    }
    if (result.action === 'block') {
      decisions.push(
        Object.freeze({
          object: 'guardrail_decision',
          stage: input.stage,
          guardrail: guardrailIdentity(definition),
          action: 'block',
          reason: reason(result.reason, 'GUARDRAIL_BLOCKED'),
        }),
      );
      return Object.freeze({
        allowed: false,
        value,
        decisions: Object.freeze(decisions),
      });
    }
    const blockedReason = reason(result, 'GUARDRAIL_INVALID');
    decisions.push(
      Object.freeze({
        object: 'guardrail_decision',
        stage: input.stage,
        guardrail: guardrailIdentity(definition),
        action: 'block',
        reason: blockedReason,
      }),
    );
    return Object.freeze({
      allowed: false,
      value,
      decisions: Object.freeze(decisions),
    });
  }
  return Object.freeze({
    allowed: true,
    value,
    decisions: Object.freeze(decisions),
  });
}

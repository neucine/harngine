import type { Json } from './types.js';
import type { GuardrailDescription } from './guardrail.js';
export type { GuardrailDescription } from './guardrail.js';

export interface WriteToolCapabilities {
  /** The Tool promises how repeated calls carrying the same operation key behave. */
  readonly idempotency: 'none' | 'operation-key' | 'intrinsic';
  /** Whether an applied write can be reversed outside Harngine. */
  readonly reversibility: 'unknown' | 'reversible' | 'irreversible';
}

export type ToolCapabilities =
  | { readonly effect: 'read'; readonly invocation: 'repeatable' }
  | (WriteToolCapabilities & {
      readonly effect: 'write';
      readonly reconciliation: 'manual' | 'automatic';
    });

export type DefinitionType = 'agent' | 'workflow' | 'tool';

/** `object` identifies the public schema; `type` names the definition's role. */
export interface DefinitionRef {
  readonly object: 'definition';
  readonly type: DefinitionType;
  readonly id: string;
  readonly revision: `rev_${string}`;
}

export type ExecutableDefinitionRef = DefinitionRef & {
  readonly type: 'agent' | 'workflow';
};

/** Read view of a registered definition. It has data for display, not executable functions. */
interface DefinitionDescriptionBase {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly availability: 'available' | 'unavailable';
}

export interface AgentDescription extends DefinitionDescriptionBase {
  readonly object: 'definition';
  readonly type: 'agent';
  readonly instructions: readonly string[];
  readonly objective: Json;
  readonly result: Json;
  readonly model: { readonly id: string; readonly capabilities: Json };
  readonly tools: readonly (DefinitionRef & { readonly type: 'tool' })[];
  readonly delegates: readonly ExecutableDefinitionRef[];
  readonly context: Json;
  readonly limits: Json;
  readonly guardrails: readonly GuardrailDescription[];
}

export interface WorkflowDescription extends DefinitionDescriptionBase {
  readonly object: 'definition';
  readonly type: 'workflow';
  readonly objective: Json;
  readonly result: Json;
  readonly tools: readonly (DefinitionRef & { readonly type: 'tool' })[];
  readonly children: readonly ExecutableDefinitionRef[];
  readonly limits: Json;
}

export interface ToolDescription extends DefinitionDescriptionBase {
  readonly object: 'definition';
  readonly type: 'tool';
  readonly description?: string;
  readonly input: Json;
  readonly output: Json;
  readonly effect: 'read' | 'write';
  readonly capabilities: ToolCapabilities;
  readonly reconcilable: boolean;
  readonly approval?: Json;
  readonly retry: Json;
  readonly guardrails: readonly GuardrailDescription[];
}

export type DefinitionDescription = AgentDescription | WorkflowDescription | ToolDescription;

/** One exact registered revision, including its durable manifest and current availability. */
export interface DefinitionRegistration {
  readonly kind: 'agent' | 'workflow' | 'tool';
  readonly id: string;
  readonly version: string;
  readonly manifest: Json;
  readonly available: boolean;
}

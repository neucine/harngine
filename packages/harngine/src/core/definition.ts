import type { Json } from './types.js';
import type { GuardrailStage } from './guardrail.js';
import type { ToolCapabilities } from './tool.js';

export type DefinitionType = 'agent' | 'workflow' | 'tool';

/** `object` identifies the public schema; `type` names the definition's role. */
export interface DefinitionReference {
  readonly object: 'definition';
  readonly type: DefinitionType;
  readonly id: string;
  readonly revision: `rev_${string}`;
}

export type ExecutableDefinitionReference = DefinitionReference & {
  readonly type: 'agent' | 'workflow';
};

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
  readonly tools: readonly (DefinitionReference & { readonly type: 'tool' })[];
  readonly delegates: readonly ExecutableDefinitionReference[];
  readonly context: Json;
  readonly limits: Json;
  readonly guardrails: readonly GuardrailDescription[];
}

export interface WorkflowDescription extends DefinitionDescriptionBase {
  readonly object: 'definition';
  readonly type: 'workflow';
  readonly objective: Json;
  readonly result: Json;
  readonly tools: readonly (DefinitionReference & { readonly type: 'tool' })[];
  readonly children: readonly ExecutableDefinitionReference[];
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

export interface GuardrailDescription {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly stages: readonly GuardrailStage[];
}

export type DefinitionDescription = AgentDescription | WorkflowDescription | ToolDescription;

/** One exact registered revision, including its durable manifest and current availability. */
export interface RuntimeDefinitionRecord {
  readonly kind: 'agent' | 'workflow' | 'tool';
  readonly id: string;
  readonly version: string;
  readonly manifest: Json;
  readonly available: boolean;
}

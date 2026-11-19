import type { Json } from '../core/types.js';
import type {
  DefinitionDescription,
  DefinitionType,
  DefinitionReference,
  ExecutableDefinitionReference,
} from '../core/definition.js';
import type { RuntimeDefinitionRecord } from '../core/definition.js';
import type { RuntimeWorkRecord } from '../core/work.js';
import type { GuardrailStage } from '../core/guardrail.js';

export function reference(kind: DefinitionType, id: string, revision: string): DefinitionReference {
  return Object.freeze({
    object: 'definition',
    type: kind,
    id,
    revision: revision as `rev_${string}`,
  });
}

function toolReferences(value: unknown): readonly (DefinitionReference & { type: 'tool' })[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.map((item) => {
      const selected = item as { id: string; version: string };
      return reference('tool', selected.id, selected.version) as DefinitionReference & {
        type: 'tool';
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
      object: 'definition',
      type: 'tool',
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
            })) as import('../authoring/tool.js').ToolCapabilities,
      reconcilable: manifest.reconcilable === true,
      ...(manifest.approval === undefined ? {} : { approval: manifest.approval }),
      retry: manifest.retry ?? {},
      guardrails: guardrailDescriptions(manifest.guardrails),
    });
  const policy = (manifest.policy ?? {}) as Record<string, Json>;
  if (record.kind === 'workflow')
    return Object.freeze({
      ...base,
      object: 'definition',
      type: 'workflow',
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
    object: 'definition',
    type: 'agent',
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
        stages: Object.freeze([...guardrail.stages]) as GuardrailStage[],
      });
    }),
  );
}

export function workReference(record: RuntimeWorkRecord): ExecutableDefinitionReference {
  return reference(
    record.kind,
    record.ref.definition.id,
    record.ref.definition.version,
  ) as ExecutableDefinitionReference;
}

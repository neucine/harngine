import { Runtime, type DefinitionRegistration } from '../engine/runtime.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import type { Agent as PublicAgent } from '../authoring/agent.js';
import type { Workflow as PublicWorkflow } from '../authoring/workflow.js';
import type { Definition, DefinitionRef, ExecutionLimits } from './contracts.js';

export function runtimeDefinition(
  runtime: Runtime,
  selected: DefinitionRef,
): DefinitionRegistration {
  const record = runtime
    .definitionRecords()
    .find(
      (candidate) =>
        candidate.kind === selected.type &&
        candidate.id === selected.id &&
        candidate.version === selected.revision,
    );
  if (!record)
    throw new NotFoundError({ code: 'NOT_FOUND', message: 'Definition revision not found' });
  return record;
}

export function workLimits(
  definition: Definition,
  requested: ExecutionLimits | undefined,
  ceiling: ExecutionLimits | undefined,
): Partial<import('../core/execution.js').ExecutionPolicy> | undefined {
  const publicDefinition = definition as PublicAgent<any, any> | PublicWorkflow<any, any>;
  // A Work may narrow its definition and App limits, but cannot expand either budget.
  const agentDefinition = 'instructions' in publicDefinition;
  const supported = agentDefinition
    ? new Set(['modelTurns', 'toolExecutions', 'childWork', 'depth'])
    : new Set(['operations', 'toolExecutions', 'childWork', 'depth']);
  for (const [name, value] of Object.entries(requested ?? {})) {
    if (!supported.has(name) || !Number.isSafeInteger(value) || value < 1)
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: `Invalid ${name} Work limit`,
      });
    const appLimit = ceiling?.[name as keyof ExecutionLimits];
    if (appLimit !== undefined && value > appLimit)
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: `${name} cannot exceed the App limit`,
      });
  }
  const configured = publicDefinition.limits;
  const depth = requested?.depth ?? ceiling?.depth ?? 8;
  if (agentDefinition) {
    const definitionLimits = configured as PublicAgent['limits'];
    const modelTurns = Math.min(
      requested?.modelTurns ?? definitionLimits.modelTurns,
      ceiling?.modelTurns ?? definitionLimits.modelTurns,
    );
    const toolExecutions = Math.min(
      requested?.toolExecutions ?? definitionLimits.toolExecutions,
      ceiling?.toolExecutions ?? definitionLimits.toolExecutions,
    );
    const childWork = Math.min(
      requested?.childWork ?? definitionLimits.childWork,
      ceiling?.childWork ?? definitionLimits.childWork,
    );
    if (
      modelTurns > definitionLimits.modelTurns ||
      toolExecutions > definitionLimits.toolExecutions ||
      childWork > definitionLimits.childWork
    )
      throw new ValidationError({
        code: 'INVALID_POLICY',
        message: 'Work limits may only narrow the Agent definition',
      });
    return {
      maxModelTurns: modelTurns,
      maxToolExecutions: toolExecutions,
      maxChildWork: childWork,
      maxDepth: depth,
      maxAttempts: modelTurns + toolExecutions,
      maxDecisions: modelTurns + toolExecutions + 1,
    };
  }
  const definitionLimits = configured as PublicWorkflow['limits'];
  const operations = Math.min(
    requested?.operations ?? definitionLimits.operations,
    ceiling?.operations ?? definitionLimits.operations,
  );
  const toolExecutions = Math.min(
    requested?.toolExecutions ?? definitionLimits.toolExecutions,
    ceiling?.toolExecutions ?? definitionLimits.toolExecutions,
  );
  const childWork = Math.min(
    requested?.childWork ?? definitionLimits.childWork,
    ceiling?.childWork ?? definitionLimits.childWork,
  );
  if (
    operations > definitionLimits.operations ||
    toolExecutions > definitionLimits.toolExecutions ||
    childWork > definitionLimits.childWork
  )
    throw new ValidationError({
      code: 'INVALID_POLICY',
      message: 'Work limits may only narrow the Workflow definition',
    });
  return {
    maxOperations: operations,
    maxToolExecutions: toolExecutions,
    maxChildWork: childWork,
    maxDepth: depth,
    maxDecisions: operations,
    maxAttempts: toolExecutions,
  };
}

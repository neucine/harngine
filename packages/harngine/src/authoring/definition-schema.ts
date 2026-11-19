import { RuntimeError, type Workflow, type Tool } from '../core/execution.js';
import type { Json } from '../core/types.js';
import { assertSchema, copy, frozen, identity, key } from '../support/schema.js';

export function workflow<O extends Json, S extends Json, R extends Json, I extends Json = Json>(
  definition: Workflow<O, S, R, I>,
): Workflow<O, S, R, I> {
  if (
    Object.keys(definition).some(
      (k) =>
        ![
          'id',
          'version',
          'artifactDigest',
          'objective',
          'state',
          'result',
          'policy',
          'tools',
          'children',
          'initial',
          'decide',
          'input',
          'replySchemas',
        ].includes(k),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported Workflow configuration');
  if (
    Object.keys(definition.policy).some(
      (k) =>
        ![
          'maxDecisions',
          'maxAttempts',
          'maxOperations',
          'maxModelTurns',
          'maxToolExecutions',
          'maxChildWork',
          'maxDepth',
        ].includes(k),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported policy configuration');
  identity(definition);
  if (!definition.artifactDigest)
    throw new RuntimeError('INVALID_DEFINITION', 'An implementation artifact digest is required');
  for (const limit of [
    definition.policy.maxDecisions,
    definition.policy.maxAttempts,
    definition.policy.maxOperations,
    definition.policy.maxModelTurns,
    definition.policy.maxToolExecutions,
    definition.policy.maxChildWork,
    definition.policy.maxDepth,
  ]) {
    if (limit === undefined) continue;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RuntimeError('INVALID_POLICY', 'Positive finite execution limits are required');
  }
  if (definition.input !== undefined) {
    const input = definition.input;
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).some((k) => !['schema', 'maxPending', 'batchSize'].includes(k)) ||
      !Number.isSafeInteger(input.maxPending) ||
      input.maxPending < 1 ||
      !Number.isSafeInteger(input.batchSize) ||
      input.batchSize < 1 ||
      input.batchSize > input.maxPending
    ) {
      throw new RuntimeError(
        'INVALID_POLICY',
        'Input needs finite positive maxPending and batchSize <= maxPending',
      );
    }
    assertSchema(input.schema);
  }
  if (definition.replySchemas !== undefined) {
    if (!Array.isArray(definition.replySchemas))
      throw new RuntimeError('INVALID_SCHEMA', 'Expected reply schema registrations');
    const seen = new Set<string>();
    for (const contract of definition.replySchemas) {
      assertSchema(contract);
      if (seen.has(key(contract)))
        throw new RuntimeError('REGISTRATION_CONFLICT', 'Duplicate reply schema');
      seen.add(key(contract));
    }
  }
  if (definition.children !== undefined) {
    if (!Array.isArray(definition.children))
      throw new RuntimeError('INVALID_DEFINITION', 'Expected child Work definitions');
    const seen = new Set<string>();
    for (const child of definition.children) {
      const childKey = key(identity(child));
      if (seen.has(childKey))
        throw new RuntimeError('REGISTRATION_CONFLICT', 'Duplicate child Work definition');
      seen.add(childKey);
    }
  }
  return Object.freeze({
    ...definition,
    ...(definition.replySchemas
      ? { replySchemas: Object.freeze([...definition.replySchemas]) }
      : {}),
    ...(definition.input ? { input: Object.freeze({ ...definition.input }) } : {}),
    policy: frozen(copy(definition.policy)),
    tools: frozen(copy(definition.tools)),
    ...(definition.children ? { children: frozen(copy(definition.children)) } : {}),
  });
}
export function tool<I extends Json, O extends Json>(definition: Tool<I, O>): Tool<I, O> {
  if (
    Object.keys(definition).some(
      (k) =>
        ![
          'id',
          'version',
          'artifactDigest',
          'description',
          'input',
          'output',
          'effect',
          'capabilities',
          'invoke',
          'approval',
          'retry',
          'unknownEffect',
          'category',
          'guardrails',
          'reconcile',
        ].includes(k),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported tool configuration');
  identity(definition);
  if (!definition.artifactDigest || !['read', 'write'].includes(definition.effect))
    throw new RuntimeError('INVALID_DEFINITION', 'Tool requires artifact and effect declarations');
  if (definition.capabilities !== undefined) {
    const capabilities = definition.capabilities;
    if (
      capabilities.effect !== definition.effect ||
      (capabilities.effect === 'read' && capabilities.invocation !== 'repeatable') ||
      (capabilities.effect === 'write' &&
        (!['none', 'operation-key', 'intrinsic'].includes(capabilities.idempotency) ||
          !['manual', 'automatic'].includes(capabilities.reconciliation) ||
          !['unknown', 'reversible', 'irreversible'].includes(capabilities.reversibility)))
    )
      throw new RuntimeError('INVALID_DEFINITION', 'Invalid Tool capability declaration');
  }
  if (definition.reconcile && definition.effect !== 'write')
    throw new RuntimeError('INVALID_DEFINITION', 'Only write Tools can reconcile effects');
  if (
    definition.retry !== undefined &&
    (!Number.isSafeInteger(definition.retry.maxAttempts) || definition.retry.maxAttempts < 1)
  )
    throw new RuntimeError('INVALID_POLICY', 'Tool retry maxAttempts must be a positive integer');
  if (
    definition.unknownEffect !== undefined &&
    !['wait', 'fail'].includes(definition.unknownEffect)
  )
    throw new RuntimeError('INVALID_POLICY', 'Unsupported unknown-effect policy');
  if (
    definition.description !== undefined &&
    (typeof definition.description !== 'string' ||
      !definition.description.trim() ||
      definition.description.length > 4000)
  )
    throw new RuntimeError('INVALID_DEFINITION', 'Tool description must have 1–4000 characters');
  if (definition.approval !== undefined) {
    const approval = definition.approval;
    if (
      !approval ||
      typeof approval !== 'object' ||
      Object.keys(approval).some((k) => !['approvers', 'timeoutMs'].includes(k)) ||
      !Array.isArray(approval.approvers) ||
      !approval.approvers.length ||
      approval.approvers.some((p) => typeof p !== 'string' || !p) ||
      !Number.isSafeInteger(approval.timeoutMs) ||
      approval.timeoutMs < 1 ||
      approval.timeoutMs > 365 * 24 * 60 * 60 * 1000
    ) {
      throw new RuntimeError(
        'UNSUPPORTED',
        'Unsupported approval policy; declare approvers and a bounded timeoutMs',
      );
    }
    return Object.freeze({ ...definition, approval: frozen(copy(approval)) });
  }
  return Object.freeze({ ...definition });
}

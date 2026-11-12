import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { RuntimeError, type Workflow, type Tool, type Identity } from './internal/contracts.js';
import type { Json, Schema } from './types.js';

// Canonicalization rejects values JSON.stringify would silently drop or coerce.
export function canonical(value: unknown): string {
  const active = new Set<object>();
  function walk(v: unknown, depth: number): Json {
    if (depth > 64) throw new RuntimeError('INVALID_DATA', 'Data exceeds nesting limit');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
    if (typeof v !== 'object' || !v || active.has(v))
      throw new RuntimeError('INVALID_DATA', 'Expected acyclic JSON data');
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new RuntimeError('INVALID_DATA', 'Expected plain JSON object');
    if (Object.getOwnPropertySymbols(v).length)
      throw new RuntimeError('INVALID_DATA', 'Symbol keys are not durable');
    active.add(v);
    let result: Json;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new RuntimeError('INVALID_DATA', 'Sparse or decorated arrays are not supported');
      result = v.map((item) => walk(item, depth + 1));
    } else {
      const out: Record<string, Json> = Object.create(null);
      for (const key of Object.keys(v).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
        if (!('value' in descriptor))
          throw new RuntimeError('INVALID_DATA', 'Accessors are not durable data');
        out[key] = walk(descriptor.value, depth + 1);
      }
      result = out;
    }
    active.delete(v);
    return result;
  }
  const result = JSON.stringify(walk(value, 0));
  if (Buffer.byteLength(result) > 1024 * 1024)
    throw new RuntimeError('INVALID_DATA', 'Data exceeds 1 MiB limit');
  return result;
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}
export function copy<T>(value: T): T {
  return JSON.parse(canonical(value)) as T;
}
export function key(ref: Identity): string {
  return canonical([ref.id, ref.version]);
}
export function identity(ref: Identity): Identity {
  if (!ref.id || !ref.version || ref.id.length > 256 || ref.version.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Invalid definition identity');
  return { id: ref.id, version: ref.version };
}
const validators = new WeakMap<object, ValidateFunction>();
const contracts = new Map<string, Schema>();
export function schema<T extends Json>(definition: Schema<T>): Schema<T> {
  if (Object.keys(definition).some((k) => !['id', 'version', 'jsonSchema'].includes(k)))
    throw new RuntimeError('UNSUPPORTED', 'Unsupported schema configuration');
  identity(definition);
  const result = frozen(copy(definition));
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const validator = ajv.compile(result.jsonSchema as object | boolean);
  if ('$async' in validator && validator.$async)
    throw new RuntimeError('UNSUPPORTED', 'Async validation is not supported');
  validators.set(result, validator);
  contracts.set(key(result), result);
  return result;
}
export function resolveSchema(ref: Identity): Schema | undefined {
  return contracts.get(key(ref));
}
export function assertSchema(contract: Schema): void {
  if (!validators.has(contract))
    throw new RuntimeError('INVALID_SCHEMA', 'Use schema() to create a registered contract');
}
export function validate<T extends Json>(contract: Schema<T>, value: unknown): T {
  const candidate = copy(value);
  const validator = validators.get(contract);
  if (!validator)
    throw new RuntimeError('INVALID_SCHEMA', 'Use schema() to create a registered contract');
  if (!validator(candidate))
    throw new RuntimeError('INVALID_DATA', JSON.stringify(validator.errors));
  return candidate as T;
}
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

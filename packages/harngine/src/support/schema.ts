import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { RuntimeError, type Identity } from '../core/execution.js';
import type { Json, Schema } from '../core/types.js';

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

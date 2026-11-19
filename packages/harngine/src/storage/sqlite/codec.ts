import { RuntimeError } from '../../core/types.js';

/** Report malformed stored JSON with its column name. `T` is the caller's expected shape. */
export function decodeStoredJson<T>(value: string, column: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new RuntimeError('CORRUPT_STATE', `Invalid stored ${column}`);
  }
}

import type { Reason } from '../core/types.js';
import {
  ConflictError,
  HarngineError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
} from '../core/errors.js';

const validationCodes = new Set([
  'INVALID_CONTEXT',
  'INVALID_DATA',
  'INVALID_DEFINITION',
  'INVALID_ID',
  'INVALID_LIMIT',
  'INVALID_POLICY',
  'INVALID_SCHEMA',
  'INVALID_TITLE',
  'UNSUPPORTED',
]);

export function commandError(reason: Reason, status: 'rejected' | 'conflict'): HarngineError {
  const value = { code: reason.code, message: reason.message };
  if (
    status === 'conflict' ||
    reason.code === 'WORK_CLOSED' ||
    reason.code === 'SESSION_BUSY' ||
    reason.code === 'STALE_CONTROL'
  )
    return new ConflictError(value);
  if (reason.code === 'NOT_FOUND') return new NotFoundError(value);
  if (reason.code === 'ACCESS_DENIED') return new UnauthorizedError(value);
  if (
    reason.code === 'UNAVAILABLE' ||
    reason.code === 'AGENT_UNAVAILABLE' ||
    reason.code === 'DEFINITION_UNAVAILABLE'
  )
    return new UnavailableError(value);
  if (validationCodes.has(reason.code)) return new ValidationError(value);
  return new HarngineError(value);
}

export function translateError(error: unknown): Error {
  if (error instanceof HarngineError) return error;
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const reason = { code: (error as { code: string }).code, message: error.message };
    if (reason.code === 'NOT_FOUND') return new NotFoundError(reason);
    if (reason.code === 'ACCESS_DENIED') return new UnauthorizedError(reason);
    if (reason.code === 'UNAVAILABLE' || reason.code === 'CLOSED')
      return new UnavailableError(reason);
    if (reason.code.includes('CONFLICT') || reason.code === 'CONTRACT_MISMATCH')
      return new ConflictError(reason);
    if (validationCodes.has(reason.code)) return new ValidationError(reason);
    return new HarngineError(reason);
  }
  return new HarngineError({ code: 'INTERNAL', message: 'Harngine encountered an internal error' });
}

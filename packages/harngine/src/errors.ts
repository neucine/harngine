import type { Reason } from './internal/contracts.js';
import type { Json } from './types.js';
import type { WorkId } from './types.js';

export type PublicError = {
  object: 'error';
  code: string;
  message: string;
  details?: Json;
};

export class HarngineError extends Error {
  readonly code: string;
  readonly details?: Json;

  constructor(error: Omit<PublicError, 'object'> | PublicError) {
    super(error.message);
    this.name = new.target.name;
    this.code = error.code;
    if (error.details !== undefined) this.details = error.details;
  }

  toJSON(): PublicError {
    return {
      object: 'error',
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export class ValidationError extends HarngineError {}
export class NotFoundError extends HarngineError {}
export class UnauthorizedError extends HarngineError {}
export class ConflictError extends HarngineError {}
export class UnavailableError extends HarngineError {
  readonly retryable: boolean;

  constructor(
    error: Omit<PublicError, 'object'> | PublicError,
    options: { retryable?: boolean } = {},
  ) {
    super(error);
    this.retryable = options.retryable ?? false;
  }
}

export class WorkFailedError extends HarngineError {
  readonly reason: Reason;
  readonly workId?: WorkId;

  constructor(reason: Reason, options: { readonly workId?: WorkId } = {}) {
    const normalized = publicWorkReason(reason);
    super({
      ...normalized,
      ...(options.workId ? { details: { workId: options.workId } } : {}),
    });
    this.reason = normalized;
    if (options.workId) this.workId = options.workId;
  }
}

export class WorkCanceledError extends HarngineError {
  readonly reason: Reason;
  readonly workId?: WorkId;

  constructor(reason: Reason, options: { readonly workId?: WorkId } = {}) {
    super({
      ...reason,
      ...(options.workId ? { details: { workId: options.workId } } : {}),
    });
    this.reason = reason;
    if (options.workId) this.workId = options.workId;
  }
}

export class ToolCallError extends HarngineError {
  readonly effect: 'none' | 'partial' | 'occurred';

  constructor(reason: Reason, effect: 'none' | 'partial' | 'occurred') {
    super(reason);
    this.effect = effect;
  }
}

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

export function publicWorkReason(reason: Reason): Reason {
  if (reason.code === 'DECISION_LIMIT' || reason.code === 'ATTEMPT_LIMIT')
    return { code: 'LIMIT_EXCEEDED', message: reason.message };
  return reason;
}

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

import type { Reason } from './execution.js';
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

function publicWorkReason(reason: Reason): Reason {
  if (reason.code === 'DECISION_LIMIT' || reason.code === 'ATTEMPT_LIMIT')
    return { code: 'LIMIT_EXCEEDED', message: reason.message };
  return reason;
}

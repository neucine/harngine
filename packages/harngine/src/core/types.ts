/** A value that can cross Harngine's durable and provider-neutral boundaries. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type WorkId = `work_${string}`;
export type SessionId = `session_${string}`;

/** A named JSON Schema contract with its inferred TypeScript value type. */
export interface Schema<T extends Json = Json> {
  readonly id: string;
  readonly version: string;
  readonly jsonSchema: Json;
  readonly __type?: T;
}

declare const brand: unique symbol;
export type RequestId = string & { readonly [brand]: 'RequestId' };
export type ControlToken = string & { readonly [brand]: 'ControlToken' };
export type ObjectiveRevision = number & { readonly [brand]: 'ObjectiveRevision' };
export type ProgressCursor = number & { readonly [brand]: 'ProgressCursor' };
export type Reason = Readonly<{ code: string; message: string }>;
export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}
export function requestId(value: string): RequestId {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new RuntimeError('INVALID_ID', 'Request identity must have 1–256 characters');
  return value as RequestId;
}
export interface Identity {
  readonly id: string;
  readonly version: string;
}

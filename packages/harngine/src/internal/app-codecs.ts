import { createHash } from 'node:crypto';
import type { RequestId } from './contracts.js';
import { entityId } from './id.js';
import type { SessionId } from '../types.js';
import { ValidationError } from '../errors.js';
import type { DefinitionKind, DefinitionReference } from '../app.js';

/** Validates a caller idempotency key or creates a new request identity. */
export function generatedRequestId(key?: string): RequestId {
  if (key !== undefined) {
    if (!key || key.length > 240)
      throw new ValidationError({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'An idempotency key must contain 1–240 characters',
      });
    return `req_${key}` as RequestId;
  }
  return entityId('req') as RequestId;
}

export function reference(kind: DefinitionKind, id: string, revision: string): DefinitionReference {
  return Object.freeze({
    object: kind,
    kind,
    id,
    revision: revision as `rev_${string}`,
  });
}

export function sessionPageToken(rowId: number): string {
  return Buffer.from(String(rowId)).toString('base64url');
}

export function parseSessionPageToken(token: string): number {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const value = Number(decoded);
  if (!/^\d+$/.test(decoded) || !Number.isSafeInteger(value) || value < 1)
    throw new ValidationError({ code: 'INVALID_PAGE', message: 'Invalid Session page token' });
  return value;
}

function messagePrefix(sessionId: SessionId): string {
  const scope = createHash('sha256')
    .update(sessionId)
    .digest()
    .subarray(0, 12)
    .toString('base64url');
  return `message_${scope}_`;
}

export function messageId(sessionId: SessionId, sequence: number): `message_${string}` {
  return `${messagePrefix(sessionId)}${sequence.toString(36)}` as `message_${string}`;
}

export function messageSequence(sessionId: SessionId, id: string): number {
  const prefix = messagePrefix(sessionId);
  if (!id.startsWith(prefix))
    throw new ValidationError({
      code: 'INVALID_PAGE',
      message: 'Message cursor does not belong to this Session',
    });
  const encoded = id.slice(prefix.length);
  if (!/^[0-9a-z]+$/.test(encoded))
    throw new ValidationError({ code: 'INVALID_PAGE', message: 'Invalid Message cursor' });
  const sequence = Number.parseInt(encoded, 36);
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new ValidationError({ code: 'INVALID_PAGE', message: 'Invalid Message cursor' });
  return sequence;
}

export interface SessionWatchCursor {
  readonly session: number;
  readonly version: number;
  readonly workId?: string;
  readonly workSequence?: number;
  readonly workEvent?: string;
  readonly queuedWorkIds?: readonly string[];
}

export function encodeSessionCursor(value: SessionWatchCursor): string {
  return `cursor_${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}

export function decodeSessionCursor(value: string): SessionWatchCursor {
  if (!value.startsWith('cursor_')) throw new Error('invalid cursor');
  const parsed = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as
    | SessionWatchCursor
    | undefined;
  if (
    !parsed ||
    !Number.isSafeInteger(parsed.session) ||
    parsed.session < 0 ||
    !Number.isSafeInteger(parsed.version) ||
    parsed.version < 1
  )
    throw new Error('invalid cursor');
  return parsed;
}

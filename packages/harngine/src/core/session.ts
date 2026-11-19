import type { AnyAgent } from './agent.js';
import type { Closure } from './work.js';
import type { Policy } from './work.js';
import type { Receipt } from './work.js';
import type { WorkRef } from './work.js';
import type { Identity, Json, RequestId, SessionId, WorkId } from './types.js';
import type { DefinitionReference } from './definition.js';
import type { WorkSnapshot } from './work.js';

export interface Message {
  readonly object: 'message';
  readonly id: string;
  readonly author: 'human' | 'agent';
  readonly content: Json;
  readonly recordedAt: number;
  readonly workId?: WorkId;
}

export interface SessionState {
  readonly object: 'session';
  readonly id: SessionId;
  readonly title: string;
  readonly status: 'open' | 'closed';
  readonly agent: DefinitionReference & { readonly type: 'agent' };
  readonly foregroundWorkId: WorkId | null;
  readonly queuedWorkIds: readonly WorkId[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionSnapshot extends SessionState {
  readonly recentMessages: readonly Message[];
  readonly foregroundWork: WorkSnapshot | null;
}

export interface SessionHandoff {
  readonly object: 'session_handoff';
  readonly id: `handoff_${string}`;
  readonly from: DefinitionReference & { readonly type: 'agent' };
  readonly to: DefinitionReference & { readonly type: 'agent' };
  readonly reason?: string;
  readonly recordedAt: number;
  readonly sessionVersion: number;
}

export interface SessionHandoffOptions {
  readonly reason?: string;
  readonly idempotencyKey?: string;
}

export type SessionUpdate = {
  readonly object: 'session_update';
  readonly type: 'session.updated';
  readonly event: 'message.appended' | 'ownership.changed' | 'work.updated' | 'session.closed';
  readonly workId?: WorkId;
  readonly snapshot: SessionSnapshot;
};

declare const brand: unique symbol;
export type SessionVersion = number & { readonly [brand]: 'SessionVersion' };
export type SessionCursor = number & { readonly [brand]: 'SessionCursor' };
export interface SessionRef {
  readonly id: SessionId;
}
export type SessionReceipt<T> = Receipt<T, SessionId, SessionCursor>;
export interface SessionCreate {
  readonly requestId: RequestId;
  readonly title: string;
  readonly maxEntries?: number;
  readonly agent?: AnyAgent;
}
export interface SessionSend {
  readonly requestId: RequestId;
  readonly content: Json;
  readonly limits?: Partial<Policy>;
}
export interface SessionSendAcceptance extends SessionChange {
  readonly sequence: SessionCursor;
  readonly work: WorkRef;
  readonly route: 'started' | 'queued';
}
export type SessionContent =
  | {
      readonly type: 'input';
      readonly content: Json;
      readonly work?: WorkRef;
      readonly route?: 'started' | 'queued';
    }
  | { readonly type: 'output'; readonly content: Json; readonly work?: WorkRef }
  | { readonly type: 'work'; readonly work: WorkRef }
  | { readonly type: 'result'; readonly work: WorkRef };
export interface SessionRecord {
  readonly requestId: RequestId;
  readonly expectedVersion: SessionVersion;
  readonly entry: SessionContent;
}
export interface SessionClose {
  readonly requestId: RequestId;
  readonly expectedVersion: SessionVersion;
}
export interface SessionHandoffRequest {
  readonly requestId: RequestId;
  readonly expectedVersion: SessionVersion;
  readonly agent: Identity;
  readonly reason?: string;
}
export interface SessionHandoffAcceptance extends SessionChange {
  readonly sequence: SessionCursor;
  readonly fromAgent: Identity;
  readonly toAgent: Identity;
  readonly reason?: string;
}
export interface SessionChange {
  readonly version: SessionVersion;
}
export interface SessionRecordAcceptance extends SessionChange {
  readonly sequence: SessionCursor;
}
export interface ExecutionSessionSnapshot {
  readonly id: SessionId;
  readonly title: string;
  readonly status: 'active' | 'closed';
  readonly version: SessionVersion;
  readonly cursor: SessionCursor;
  readonly maxEntries: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly closedAt: number | null;
  readonly agent: Identity | null;
  readonly foregroundWork: WorkRef | null;
  readonly queuedWork: readonly WorkRef[];
}
export interface SessionEntry {
  readonly sequence: SessionCursor;
  readonly version: SessionVersion;
  readonly source: string;
  readonly recordedAt: number;
  readonly entry:
    | Exclude<SessionContent, { type: 'result' }>
    | { readonly type: 'result'; readonly work: WorkRef; readonly closure: Closure }
    | {
        readonly type: 'handoff';
        readonly fromAgent: Identity;
        readonly toAgent: Identity;
        readonly reason?: string;
      };
}
export interface SessionHistoryOptions {
  readonly after?: SessionCursor;
  readonly before?: SessionCursor;
  readonly limit?: number;
}
export interface SessionHistory {
  readonly entries: readonly SessionEntry[];
  readonly nextCursor: SessionCursor;
  readonly hasMore: boolean;
  readonly version: SessionVersion;
}

/** Durable inspection records; none grants authority to execute. */

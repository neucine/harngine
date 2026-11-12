import type {
  Agent as CoreAgent,
  ProgressCursor,
  SessionCursor,
  SessionVersion,
  WorkRef,
} from './contracts.js';
import { Runtime, type Caller } from './runtime.js';
import type { Json, SessionId, WorkId } from '../types.js';
import {
  commandError,
  ConflictError,
  translateError,
  UnavailableError,
  ValidationError,
} from '../errors.js';
import type { Agent as PublicAgent } from '../agent.js';
import type {
  DefinitionReference,
  ExecutionLimits,
  Message,
  Session,
  SessionHandoff,
  SessionHandoffOptions,
  Sessions,
  SessionSnapshot,
  SessionState,
  SessionUpdate,
  Watch,
  Work,
  WorkSnapshot,
} from '../app.js';
import {
  WorkHandle,
  projectionSnapshot,
  publicSnapshot,
  sessionState,
  workLimits,
} from './app-work.js';
import {
  decodeSessionCursor,
  encodeSessionCursor,
  generatedRequestId,
  handoffId,
  handoffSequence,
  messageId,
  messageSequence,
  parseSessionPageToken,
  reference,
  sessionPageToken,
  type SessionWatchCursor,
} from './app-codecs.js';

export class SessionHandle<O extends Json, R extends Json> implements Session<O, R> {
  constructor(
    readonly id: SessionId,
    private readonly runtime: Runtime,
    private readonly caller: Caller,
    private readonly agent: PublicAgent<O, R> | undefined,
    private readonly expectedAgent: DefinitionReference & { readonly kind: 'agent' },
    private sessionVersion: SessionVersion,
    private readonly limitCeiling?: ExecutionLimits,
  ) {}

  private async messagesThrough(cursor: SessionCursor, limit = 50): Promise<readonly Message[]> {
    if (cursor === 0) return Object.freeze([]);
    const history = await this.runtime
      .forCaller(this.caller)
      .session.history({ id: this.id }, { before: (cursor + 1) as SessionCursor, limit });
    return Object.freeze(
      history.entries.flatMap((entry): Message[] => {
        if (entry.entry.type !== 'input' && entry.entry.type !== 'output') return [];
        return [
          Object.freeze({
            object: 'message',
            id: messageId(this.id, entry.sequence),
            author: entry.entry.type === 'input' ? 'human' : 'agent',
            content: entry.entry.content,
            recordedAt: entry.recordedAt,
            ...('work' in entry.entry && entry.entry.work ? { workId: entry.entry.work.id } : {}),
          }),
        ];
      }),
    );
  }

  private async snapshotAt(cursor: SessionWatchCursor): Promise<SessionSnapshot> {
    const api = this.runtime.forCaller(this.caller);
    const low = await api.session.inspect({ id: this.id });
    const recentMessages = await this.messagesThrough(cursor.session as SessionCursor, 100);
    const foregroundId = (cursor.workId as WorkId | undefined) ?? null;
    let foregroundWork: WorkSnapshot | null = null;
    if (foregroundId) {
      const ref = await api.session.work({ id: this.id }, foregroundId);
      foregroundWork =
        cursor.workId === foregroundId && cursor.workEvent
          ? projectionSnapshot(
              await api.work.projection(ref, cursor.workEvent),
              this.runtime.workRecord(this.caller, foregroundId),
            )
          : publicSnapshot(
              await api.work.inspect(ref),
              this.runtime.workRecord(this.caller, foregroundId),
            );
    }
    return Object.freeze({
      ...sessionState({
        ...low,
        status: low.status === 'closed' && cursor.version >= low.version ? 'closed' : 'active',
        foregroundWork: foregroundId ? { id: foregroundId, definition: low.agent! } : null,
        queuedWork: (cursor.queuedWorkIds ?? []).map((id) => ({
          id: id as WorkId,
          definition: low.agent!,
        })),
      }),
      recentMessages,
      foregroundWork,
    });
  }

  async snapshot(): Promise<SessionSnapshot> {
    try {
      const api = this.runtime.forCaller(this.caller);
      const value = await api.session.inspect({ id: this.id });
      let workSequence: number | undefined;
      let workEvent: string | undefined;
      if (value.foregroundWork) {
        const work = await api.work.inspect(value.foregroundWork);
        workSequence = work.cursor;
        if (work.cursor > 0) {
          const page = await api.work.history(value.foregroundWork, {
            after: (work.cursor - 1) as typeof work.cursor,
            through: work.cursor,
            limit: 1,
          });
          workEvent = page.events[0]?.id;
        }
      }
      return this.snapshotAt({
        session: value.cursor,
        version: value.version,
        queuedWorkIds: value.queuedWork.map((work) => work.id),
        ...(value.foregroundWork ? { workId: value.foregroundWork.id } : {}),
        ...(workSequence === undefined ? {} : { workSequence }),
        ...(workEvent === undefined ? {} : { workEvent }),
      });
    } catch (error) {
      throw translateError(error);
    }
  }

  async messages(options: { before?: string; limit?: number } = {}): Promise<readonly Message[]> {
    try {
      const api = this.runtime.forCaller(this.caller);
      const snapshot = await api.session.inspect({ id: this.id });
      let before = (snapshot.cursor + 1) as SessionCursor;
      if (options.before !== undefined) {
        before = messageSequence(this.id, options.before) as SessionCursor;
      }
      const history = await api.session.history(
        { id: this.id },
        { before, limit: options.limit ?? 50 },
      );
      return Object.freeze(
        history.entries.flatMap((entry): Message[] => {
          if (entry.entry.type !== 'input' && entry.entry.type !== 'output') return [];
          return [
            Object.freeze({
              object: 'message',
              id: messageId(this.id, entry.sequence),
              author: entry.entry.type === 'input' ? 'human' : 'agent',
              content: entry.entry.content,
              recordedAt: entry.recordedAt,
              ...('work' in entry.entry && entry.entry.work ? { workId: entry.entry.work.id } : {}),
            }),
          ];
        }),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async handoffs(
    options: { before?: string; limit?: number } = {},
  ): Promise<readonly SessionHandoff[]> {
    try {
      const api = this.runtime.forCaller(this.caller);
      const snapshot = await api.session.inspect({ id: this.id });
      const limit = options.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new ValidationError({
          code: 'INVALID_LIMIT',
          message: 'Handoff page limit must be between 1 and 100',
        });
      let before =
        options.before === undefined
          ? snapshot.cursor + 1
          : handoffSequence(this.id, options.before);
      const selected: SessionHandoff[] = [];
      while (selected.length < limit && before > 1) {
        const history = await api.session.history(
          { id: this.id },
          { before: before as SessionCursor, limit: 100 },
        );
        for (const entry of [...history.entries].reverse()) {
          if (entry.entry.type !== 'handoff') continue;
          selected.push(
            Object.freeze({
              object: 'session_handoff',
              id: handoffId(this.id, entry.sequence),
              from: reference(
                'agent',
                entry.entry.fromAgent.id,
                entry.entry.fromAgent.version,
              ) as DefinitionReference & { readonly kind: 'agent' },
              to: reference(
                'agent',
                entry.entry.toAgent.id,
                entry.entry.toAgent.version,
              ) as DefinitionReference & { readonly kind: 'agent' },
              ...(entry.entry.reason ? { reason: entry.entry.reason } : {}),
              recordedAt: entry.recordedAt,
              sessionVersion: entry.version,
            }),
          );
          if (selected.length === limit) break;
        }
        if (!history.hasMore || !history.entries.length) break;
        before = history.entries[0]!.sequence;
      }
      return Object.freeze(selected.reverse());
    } catch (error) {
      throw translateError(error);
    }
  }

  async handoff<NO extends Json, NR extends Json>(
    agent: PublicAgent<NO, NR>,
    options?: SessionHandoffOptions,
  ): Promise<Session<NO, NR>>;
  async handoff(
    agent: DefinitionReference & { readonly kind: 'agent' },
    options?: SessionHandoffOptions,
  ): Promise<Session>;
  async handoff<NO extends Json, NR extends Json>(
    selected: PublicAgent<NO, NR> | (DefinitionReference & { readonly kind: 'agent' }),
    options: SessionHandoffOptions = {},
  ): Promise<Session<NO, NR>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const target =
        'kind' in selected
          ? (this.runtime.executable(selected) as PublicAgent<NO, NR> | undefined)
          : selected;
      if (!target)
        throw new UnavailableError({
          code: 'AGENT_UNAVAILABLE',
          message: 'The exact target Agent revision is unavailable',
        });
      const current = await api.session.inspect({ id: this.id });
      const currentMatches =
        current.agent?.id === this.expectedAgent.id &&
        current.agent.version === this.expectedAgent.revision;
      if (!currentMatches && !options.idempotencyKey)
        throw new ConflictError({
          code: 'SESSION_HANDED_OFF',
          message: 'Inspect the Session and use its current Agent handle',
        });
      const targetAgent = reference('agent', target.id, target.revision) as DefinitionReference & {
        readonly kind: 'agent';
      };
      const receipt = await api.session.handoff(
        { id: this.id },
        {
          requestId: generatedRequestId(options.idempotencyKey),
          expectedVersion: currentMatches ? current.version : this.sessionVersion,
          agent: { id: target.id, version: target.revision },
          ...(options.reason ? { reason: options.reason } : {}),
        },
      );
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return new SessionHandle(
        this.id,
        this.runtime,
        this.caller,
        target,
        targetAgent,
        receipt.value.version,
        this.limitCeiling,
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async watch(
    options: { after?: string; signal?: AbortSignal } = {},
  ): Promise<Watch<SessionSnapshot, SessionUpdate>> {
    const api = this.runtime.forCaller(this.caller);
    let reset = false;
    let state: SessionWatchCursor;
    if (options.after) {
      try {
        state = decodeSessionCursor(options.after);
        if (state.session > (await api.session.inspect({ id: this.id })).cursor)
          throw new Error('invalid cursor');
      } catch {
        reset = true;
        state = await this.currentWatchCursor();
      }
    } else state = await this.currentWatchCursor();
    let value = await this.snapshotAt(state);
    let cursor = encodeSessionCursor(state);
    const thisSession = this;
    return {
      get value() {
        return value;
      },
      get cursor() {
        return cursor;
      },
      get reset() {
        return reset;
      },
      async *[Symbol.asyncIterator]() {
        while (true) {
          options.signal?.throwIfAborted();
          const low = await api.session.inspect({ id: thisSession.id });
          const sessionChanges = await api.session.history(
            { id: thisSession.id },
            { after: state.session as SessionCursor, limit: 100 },
          );
          let yielded = false;
          if (state.workId) {
            const ref = await api.session.work({ id: thisSession.id }, state.workId as WorkId);
            const page = await api.work.history(ref, {
              after: (state.workSequence ?? 0) as ProgressCursor,
              limit: 100,
            });
            for (const event of page.events) {
              state = {
                ...state,
                workSequence: event.cursor,
                workEvent: event.id,
              };
              value = await thisSession.snapshotAt(state);
              cursor = encodeSessionCursor(state);
              yielded = true;
              yield {
                durable: true,
                id: cursor,
                value: {
                  object: 'session_update',
                  type: 'session.updated',
                  event: 'work.updated',
                  workId: state.workId as WorkId,
                  snapshot: value,
                },
              };
            }
          }
          for (const entry of sessionChanges.entries) {
            state = { ...state, session: entry.sequence, version: entry.version };
            if (entry.entry.type === 'input' && entry.entry.work) {
              if (entry.entry.route === 'queued')
                state = {
                  ...state,
                  queuedWorkIds: [...(state.queuedWorkIds ?? []), entry.entry.work.id],
                };
              else {
                state = {
                  ...state,
                  workId: entry.entry.work.id,
                  workSequence: 0,
                };
                delete (state as { workEvent?: string }).workEvent;
              }
            } else if (
              (entry.entry.type === 'output' || entry.entry.type === 'result') &&
              entry.entry.work?.id === state.workId
            ) {
              state = {
                session: entry.sequence,
                version: entry.version,
                ...(state.queuedWorkIds ? { queuedWorkIds: state.queuedWorkIds } : {}),
              };
            } else if (entry.entry.type === 'work') {
              const promotedWorkId = entry.entry.work.id;
              state = {
                ...state,
                workId: promotedWorkId,
                workSequence: 0,
                queuedWorkIds: (state.queuedWorkIds ?? []).filter((id) => id !== promotedWorkId),
              };
              delete (state as { workEvent?: string }).workEvent;
            }
            value = await thisSession.snapshotAt(state);
            cursor = encodeSessionCursor(state);
            yielded = true;
            yield {
              durable: true,
              id: cursor,
              value: {
                object: 'session_update',
                type: 'session.updated',
                event:
                  entry.entry.type === 'input' || entry.entry.type === 'output'
                    ? 'message.appended'
                    : entry.entry.type === 'handoff'
                      ? 'ownership.changed'
                      : 'work.updated',
                ...('work' in entry.entry && entry.entry.work
                  ? { workId: entry.entry.work.id }
                  : {}),
                snapshot: value,
              },
            };
          }
          if (low.status === 'closed' && state.version < low.version) {
            state = { ...state, version: low.version };
            value = await thisSession.snapshotAt(state);
            cursor = encodeSessionCursor(state);
            yield {
              durable: true,
              id: cursor,
              value: {
                object: 'session_update',
                type: 'session.updated',
                event: 'session.closed',
                snapshot: value,
              },
            };
            return;
          }
          if (low.status === 'closed') return;
          if (!yielded) await new Promise((resolve) => setTimeout(resolve, 20));
        }
      },
    };
  }

  private async currentWatchCursor(): Promise<SessionWatchCursor> {
    const api = this.runtime.forCaller(this.caller);
    const session = await api.session.inspect({ id: this.id });
    if (!session.foregroundWork)
      return {
        session: session.cursor,
        version: session.version,
        queuedWorkIds: session.queuedWork.map((work) => work.id),
      };
    const work = await api.work.inspect(session.foregroundWork);
    let workEvent: string | undefined;
    if (work.cursor > 0) {
      const page = await api.work.history(session.foregroundWork, {
        after: (work.cursor - 1) as ProgressCursor,
        through: work.cursor,
        limit: 1,
      });
      workEvent = page.events[0]?.id;
    }
    return {
      session: session.cursor,
      version: session.version,
      queuedWorkIds: session.queuedWork.map((work) => work.id),
      workId: session.foregroundWork.id,
      workSequence: work.cursor,
      ...(workEvent ? { workEvent } : {}),
    };
  }

  async send(
    content: O,
    options: { limits?: ExecutionLimits; idempotencyKey?: string } = {},
  ): Promise<{ message: Message; work: Work<O, R> }> {
    const api = this.runtime.forCaller(this.caller);
    try {
      if (!this.agent)
        throw new UnavailableError({
          code: 'AGENT_UNAVAILABLE',
          message: 'The Session Agent revision is unavailable',
        });
      const current = await api.session.inspect({ id: this.id });
      if (
        !current.agent ||
        current.agent.id !== this.expectedAgent.id ||
        current.agent.version !== this.expectedAgent.revision
      )
        throw new ConflictError({
          code: 'SESSION_HANDED_OFF',
          message: 'Inspect the Session and use its current Agent handle',
        });
      const limits = workLimits(this.agent, options.limits, this.limitCeiling);
      const receipt = await api.session.send(
        { id: this.id },
        {
          requestId: generatedRequestId(options.idempotencyKey),
          content,
          ...(limits ? { limits } : {}),
        },
      );
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      this.sessionVersion = receipt.value.version;
      const page = await api.session.history(
        { id: this.id },
        { after: (receipt.value.sequence - 1) as SessionCursor },
      );
      const entry = page.entries[0]!;
      return {
        message: {
          object: 'message',
          id: messageId(this.id, entry.sequence),
          author: 'human',
          content,
          recordedAt: entry.recordedAt,
          workId: receipt.value.work.id,
        },
        work: new WorkHandle(this.runtime, this.caller, receipt.value.work as WorkRef<O, R>, true, {
          id: this.id,
        }),
      };
    } catch (error) {
      throw translateError(error);
    }
  }

  async close(options: { idempotencyKey?: string } = {}): Promise<SessionState> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const before = await api.session.inspect({ id: this.id });
      if (before.status === 'closed') return this.snapshot();
      if (before.foregroundWork)
        throw new ConflictError({
          code: 'SESSION_BUSY',
          message: 'Session has active foreground Work',
          details: { workId: before.foregroundWork.id },
        });
      if (before.queuedWork.length)
        throw new ConflictError({
          code: 'SESSION_BUSY',
          message: 'Session has queued Work',
          details: { workId: before.queuedWork[0]!.id },
        });
      const receipt = await api.session.close(
        { id: this.id },
        {
          requestId: generatedRequestId(options.idempotencyKey),
          expectedVersion: before.version,
        },
      );
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return this.snapshot();
    } catch (error) {
      throw translateError(error);
    }
  }
}

export class SessionManager implements Sessions {
  constructor(
    private readonly runtime: Runtime,
    private readonly caller: Caller,
    private readonly agents: ReadonlyMap<string, PublicAgent<any, any>>,
    private readonly limitCeiling?: ExecutionLimits,
  ) {}

  async create<O extends Json, R extends Json>(options: {
    agent: PublicAgent<O, R>;
    title: string;
    idempotencyKey?: string;
  }): Promise<Session<O, R>>;
  async create(options: {
    agent: DefinitionReference & { kind: 'agent' };
    title: string;
    idempotencyKey?: string;
  }): Promise<Session>;
  async create<O extends Json, R extends Json>(options: {
    agent: PublicAgent<O, R> | (DefinitionReference & { kind: 'agent' });
    title: string;
    idempotencyKey?: string;
  }): Promise<Session<O, R>> {
    const selected =
      'kind' in options.agent
        ? this.agents.get(`${options.agent.id}@${options.agent.revision}`)
        : options.agent;
    if (!selected)
      throw new UnavailableError({
        code: 'AGENT_UNAVAILABLE',
        message: 'The exact Agent revision is unavailable',
      });
    const receipt = await this.runtime.forCaller(this.caller).session.create({
      requestId: generatedRequestId(options.idempotencyKey),
      title: options.title,
      agent: selected as unknown as CoreAgent,
    });
    if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
    const currentAgent = reference(
      'agent',
      selected.id,
      selected.revision,
    ) as DefinitionReference & { readonly kind: 'agent' };
    return new SessionHandle(
      receipt.value.id,
      this.runtime,
      this.caller,
      selected,
      currentAgent,
      1 as SessionVersion,
      this.limitCeiling,
    );
  }

  async get(id: SessionId): Promise<Session> {
    const api = this.runtime.forCaller(this.caller);
    const ref = await api.session.get(id);
    const snapshot = await api.session.inspect(ref);
    if (!snapshot.agent)
      throw new ConflictError({ code: 'SESSION_AGENT_MISSING', message: 'Session has no Agent' });
    const selected = this.agents.get(`${snapshot.agent.id}@${snapshot.agent.version}`);
    const currentAgent = reference(
      'agent',
      snapshot.agent.id,
      snapshot.agent.version,
    ) as DefinitionReference & { readonly kind: 'agent' };
    return new SessionHandle(
      id,
      this.runtime,
      this.caller,
      selected,
      currentAgent,
      snapshot.version,
      this.limitCeiling,
    );
  }

  async list(options: { page?: string; limit?: number } = {}) {
    try {
      const page = await this.runtime.forCaller(this.caller).session.list({
        ...(options.page === undefined ? {} : { beforeRowId: parseSessionPageToken(options.page) }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      return Object.freeze({
        object: 'list',
        sessions: Object.freeze(page.sessions.map(sessionState)),
        next: page.hasMore && page.nextRowId !== null ? sessionPageToken(page.nextRowId) : null,
      });
    } catch (error) {
      throw translateError(error);
    }
  }
}

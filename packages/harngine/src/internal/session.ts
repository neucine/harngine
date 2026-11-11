import { entityId } from './id.js';
import {
  RuntimeError,
  requestId,
  type SessionId,
  type SessionRef,
  type SessionReceipt,
  type SessionCreate,
  type SessionRecord,
  type SessionClose,
  type SessionSnapshot,
  type SessionHistory,
  type SessionHistoryOptions,
  type SessionVersion,
  type SessionCursor,
  type SessionChange,
  type SessionRecordAcceptance,
  type SessionEntry,
  type Reason,
  type WorkRef,
} from './contracts.js';
import { canonical, copy, frozen, identity } from '../schema.js';
import { exact, reason } from './core.js';
import type { SqliteStore } from './store.js';
interface Row {
  id: string;
  principal: string;
  title: string;
  status: 'active' | 'closed';
  version: number;
  cursor: number;
  max_entries: number;
  created_at: number;
  closed_at: number | null;
  agent: string | null;
  foreground_work_id: string | null;
}
interface Caller {
  principal: string;
  source: string;
}
/** Interaction records only. This facility never schedules Work or invokes behavior. */
export function sessionApi(
  store: SqliteStore,
  caller: Caller,
  ensureOpen: () => void,
  committed: () => void,
  clock: () => number,
) {
  function authorize(ref: SessionRef): Row {
    ensureOpen();
    exact(ref, ['id']);
    if (typeof ref.id !== 'string' || !ref.id)
      throw new RuntimeError('INVALID_ID', 'Session identity required');
    const row = store.db.prepare('SELECT * FROM sessions WHERE id=?').get(ref.id) as
      | Row
      | undefined;
    if (!row) throw new RuntimeError('NOT_FOUND', 'Session not found');
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Session belongs to another principal');
    return row;
  }
  function checkWork(work: WorkRef): void {
    exact(work, ['id', 'definition']);
    exact(work.definition, ['id', 'version']);
    const row = store.work(work.id);
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
    if (row.definition !== canonical(work.definition))
      throw new RuntimeError('CONTRACT_MISMATCH', 'Work definition does not match reference');
  }
  const scope = canonical([caller.principal, caller.source]);
  function prior<T>(
    id: string,
    command: string,
    target?: SessionId,
  ): SessionReceipt<T> | undefined {
    const saved = store.db
      .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
      .get(scope, id) as { command: string; receipt: string } | undefined;
    if (!saved) return;
    return saved.command === command
      ? JSON.parse(saved.receipt)
      : {
          requestId: requestId(id),
          status: 'conflict',
          ...(target ? { target } : {}),
          reason: { code: 'IDENTITY_CONFLICT', message: 'Request identity has different content' },
        };
  }
  function save<T>(
    id: string,
    command: string,
    sessionId: SessionId | null,
    receipt: SessionReceipt<T>,
  ): void {
    store.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(scope, id, command, null, canonical(receipt));
    store.db.prepare('INSERT INTO session_receipts VALUES(?,?,?)').run(scope, id, sessionId);
  }
  function snapshot(ref: SessionRef): SessionSnapshot {
    const row = authorize(ref);
    const foreground = row.foreground_work_id ? store.work(row.foreground_work_id) : null;
    const updatedAt = (
      store.db
        .prepare(
          `SELECT MAX(recorded_at) AS value FROM (
             SELECT ? AS recorded_at
             UNION ALL SELECT closed_at FROM sessions WHERE id=?
             UNION ALL SELECT recorded_at FROM session_entries WHERE session_id=?
             UNION ALL
               SELECT p.recorded_at FROM progress p
               JOIN session_work sw ON sw.work_id=p.work_id
               WHERE sw.session_id=?
           )`,
        )
        .get(row.created_at, ref.id, ref.id, ref.id) as { value: number }
    ).value;
    return frozen({
      id: ref.id,
      title: row.title,
      status: row.status,
      version: row.version as SessionVersion,
      cursor: row.cursor as SessionCursor,
      maxEntries: row.max_entries,
      createdAt: row.created_at,
      updatedAt,
      closedAt: row.closed_at,
      agent: row.agent ? JSON.parse(row.agent) : null,
      foregroundWork: foreground
        ? { id: foreground.id as WorkRef['id'], definition: JSON.parse(foreground.definition) }
        : null,
      queuedWork: (
        store.db
          .prepare(
            `SELECT w.id,w.definition FROM session_queue q JOIN work w ON w.id=q.work_id
             WHERE q.session_id=? ORDER BY q.sequence`,
          )
          .all(ref.id) as { id: WorkRef['id']; definition: string }[]
      ).map((work) => ({ id: work.id, definition: JSON.parse(work.definition) })),
    });
  }
  function mutate<T extends SessionChange>(
    ref: SessionRef,
    kind: 'record' | 'close',
    raw: SessionRecord | SessionClose,
  ): SessionReceipt<T> {
    authorize(ref);
    const request = copy(raw);
    requestId(request.requestId);
    // Check referenced Work access even before replaying an old acknowledgement.
    if (
      kind === 'record' &&
      'entry' in request &&
      request.entry &&
      typeof request.entry === 'object' &&
      'work' in request.entry
    )
      checkWork(request.entry.work!);
    const command = canonical({ type: `session.${kind}`, target: ref, request });
    const previous = prior<T>(request.requestId, command, ref.id);
    if (previous) return frozen(previous);
    let invalid: Reason | undefined;
    try {
      exact(
        request,
        kind === 'record'
          ? ['requestId', 'expectedVersion', 'entry']
          : ['requestId', 'expectedVersion'],
      );
      if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)
        throw new RuntimeError('INVALID_VERSION', 'Expected a Session version');
      if (kind === 'record') {
        const entry = (request as SessionRecord).entry;
        if (!entry || typeof entry !== 'object')
          throw new RuntimeError('INVALID_ENTRY', 'Session entry required');
        if (entry.type === 'input') {
          exact(entry, ['type', 'content', 'work', 'route']);
          canonical(entry.content);
          if (entry.work) checkWork(entry.work);
        } else if (entry.type === 'output') {
          exact(entry, ['type', 'content', 'work']);
          canonical(entry.content);
        } else if (entry.type === 'work' || entry.type === 'result') {
          exact(entry, ['type', 'work']);
          checkWork(entry.work);
        } else throw new RuntimeError('INVALID_ENTRY', 'Unsupported Session entry type');
      }
    } catch (error) {
      invalid = reason(error);
    }
    const receipt = store.write(() => {
      const row = authorize(ref);
      let rejection = invalid;
      const entry = kind === 'record' ? (request as SessionRecord).entry : undefined;
      let recorded: SessionEntry['entry'] | undefined;
      if (row.version !== request.expectedVersion)
        rejection = {
          code: 'STALE_VERSION',
          message: 'Inspect the Session before issuing a new mutation',
        };
      else if (!invalid) {
        if (kind === 'close' && row.status === 'closed')
          rejection = { code: 'SESSION_CLOSED', message: 'Session is already closed' };
        else if (
          kind === 'close' &&
          (row.foreground_work_id ||
            store.db.prepare('SELECT 1 FROM session_queue WHERE session_id=?').get(ref.id))
        )
          rejection = { code: 'SESSION_BUSY', message: 'Session still has pending Work' };
        if (entry) {
          const work = 'work' in entry ? entry.work : undefined;
          if (work) checkWork(work);
          const linked =
            work &&
            store.db
              .prepare('SELECT 1 FROM session_work WHERE session_id=? AND work_id=?')
              .get(ref.id, work.id);
          if (
            row.status === 'closed' &&
            !(linked && (entry.type === 'output' || entry.type === 'result'))
          )
            rejection = {
              code: 'SESSION_CLOSED',
              message: 'Closed Sessions accept only outputs/results for associated Work',
            };
          else if ((entry.type === 'result' || entry.type === 'output') && work && !linked)
            rejection = {
              code: 'WORK_NOT_ASSOCIATED',
              message: 'Associate this Work before recording its output or result',
            };
          else if (row.cursor >= row.max_entries)
            rejection = { code: 'SESSION_CAPACITY', message: 'Session entry capacity is full' };
          else if (entry.type === 'result') {
            const closure = store.work(entry.work.id).closure;
            if (!closure)
              rejection = { code: 'RESULT_PENDING', message: 'Work has no saved closure yet' };
            else recorded = { type: 'result', work: entry.work, closure: JSON.parse(closure) };
          } else recorded = entry;
        }
      }
      let result: SessionReceipt<T>;
      if (rejection)
        result = {
          requestId: request.requestId,
          status: rejection.code === 'STALE_VERSION' ? 'conflict' : 'rejected',
          target: ref.id,
          cursor: row.cursor as SessionCursor,
          reason: rejection,
        };
      else {
        const version = (row.version + 1) as SessionVersion;
        const cursor = (row.cursor + (kind === 'record' ? 1 : 0)) as SessionCursor;
        const value = (kind === 'record' ? { version, sequence: cursor } : { version }) as T;
        result = {
          requestId: request.requestId,
          status: 'accepted',
          target: ref.id,
          cursor,
          value,
        };
        const now = clock();
        if (kind === 'close')
          store.db
            .prepare("UPDATE sessions SET status='closed',version=?,closed_at=? WHERE id=?")
            .run(version, now, ref.id);
        else
          store.db
            .prepare('UPDATE sessions SET version=?,cursor=? WHERE id=?')
            .run(version, cursor, ref.id);
        save(request.requestId, command, ref.id, result);
        if (kind === 'record') {
          store.db
            .prepare('INSERT INTO session_entries VALUES(?,?,?,?,?,?,?,?)')
            .run(
              ref.id,
              cursor,
              version,
              caller.source,
              now,
              canonical(recorded),
              scope,
              request.requestId,
            );
          if (entry!.type === 'work')
            store.db
              .prepare('INSERT INTO session_work VALUES(?,?) ON CONFLICT DO NOTHING')
              .run(ref.id, entry!.work.id);
        }
        return result;
      }
      save(request.requestId, command, ref.id, result);
      return result;
    });
    committed();
    return frozen(receipt);
  }
  return {
    create: async (raw: SessionCreate): Promise<SessionReceipt<SessionRef>> => {
      ensureOpen();
      const request = copy(raw);
      requestId(request.requestId);
      const command = canonical({ type: 'session.create', request });
      const previous = prior<SessionRef>(request.requestId, command);
      if (previous) return frozen(previous);
      let invalid: Reason | undefined;
      const maxEntries = request.maxEntries === undefined ? 10000 : request.maxEntries;
      try {
        exact(request, ['requestId', 'title', 'maxEntries', 'agent']);
        if (
          typeof request.title !== 'string' ||
          !request.title.trim() ||
          request.title.length > 256
        )
          throw new RuntimeError('INVALID_TITLE', 'Title must have 1–256 characters');
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000)
          throw new RuntimeError('INVALID_POLICY', 'maxEntries must be from 1 to 100000');
      } catch (error) {
        invalid = reason(error);
      }
      const receipt = store.write(() => {
        let result: SessionReceipt<SessionRef>;
        let id: SessionId | null = null;
        if (invalid) result = { requestId: request.requestId, status: 'rejected', reason: invalid };
        else {
          id = entityId('session') as SessionId;
          const agent = request.agent ? identity(request.agent) : null;
          store.db
            .prepare(
              "INSERT INTO sessions(id,principal,title,status,version,cursor,max_entries,created_at,closed_at,agent) VALUES(?,?,?,'active',1,0,?,?,NULL,?)",
            )
            .run(
              id,
              caller.principal,
              request.title,
              maxEntries,
              clock(),
              agent ? canonical(agent) : null,
            );
          result = {
            requestId: request.requestId,
            status: 'accepted',
            target: id,
            cursor: 0 as SessionCursor,
            value: { id },
          };
        }
        save(request.requestId, command, id, result);
        return result;
      });
      committed();
      return frozen(receipt);
    },
    get: async (id: SessionId): Promise<SessionRef> => {
      authorize({ id });
      return frozen({ id });
    },
    inspect: async (ref: SessionRef): Promise<SessionSnapshot> => snapshot(ref),
    list: async (options: { beforeRowId?: number; limit?: number } = {}) => {
      ensureOpen();
      exact(options, ['beforeRowId', 'limit']);
      const beforeRowId = options.beforeRowId ?? Number.MAX_SAFE_INTEGER;
      const limit = options.limit ?? 20;
      if (!Number.isSafeInteger(beforeRowId) || beforeRowId < 1)
        throw new RuntimeError('INVALID_CURSOR', 'Invalid Session page token');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new RuntimeError('INVALID_LIMIT', 'Page limit must be from 1 to 100');
      const rows = store.db
        .prepare(
          'SELECT rowid,id FROM sessions WHERE principal=? AND rowid<? ORDER BY rowid DESC LIMIT ?',
        )
        .all(caller.principal, beforeRowId, limit + 1) as { rowid: number; id: SessionId }[];
      const selected = rows.slice(0, limit);
      return frozen({
        sessions: selected.map((row) => snapshot({ id: row.id })),
        nextRowId: selected.at(-1)?.rowid ?? null,
        hasMore: rows.length > limit,
      });
    },
    record: async (
      ref: SessionRef,
      request: SessionRecord,
    ): Promise<SessionReceipt<SessionRecordAcceptance>> => mutate(ref, 'record', request),
    close: async (ref: SessionRef, request: SessionClose): Promise<SessionReceipt<SessionChange>> =>
      mutate(ref, 'close', request),
    history: async (
      ref: SessionRef,
      options: SessionHistoryOptions = {},
    ): Promise<SessionHistory> => {
      const row = authorize(ref);
      exact(options, ['after', 'before', 'limit']);
      if (options.after !== undefined && options.before !== undefined)
        throw new RuntimeError('INVALID_CURSOR', 'Use either after or before, not both');
      const after = options.after === undefined ? 0 : options.after;
      const before = options.before === undefined ? row.cursor + 1 : options.before;
      const limit = options.limit === undefined ? 50 : options.limit;
      if (!Number.isSafeInteger(after) || after < 0 || after > row.cursor)
        throw new RuntimeError(
          'INVALID_CURSOR',
          'Cursor must belong to the recorded Session range',
        );
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new RuntimeError('INVALID_LIMIT', 'Page limit must be from 1 to 100');
      if (!Number.isSafeInteger(before) || before < 1 || before > row.cursor + 1)
        throw new RuntimeError(
          'INVALID_CURSOR',
          'Cursor must belong to the recorded Session range',
        );
      const records = (
        options.before === undefined
          ? store.db
              .prepare(
                'SELECT * FROM session_entries WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?',
              )
              .all(ref.id, after, limit + 1)
          : store.db
              .prepare(
                'SELECT * FROM session_entries WHERE session_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?',
              )
              .all(ref.id, before, limit + 1)
      ) as {
        sequence: number;
        version: number;
        source: string;
        recorded_at: number;
        body: string;
      }[];
      const page = records.slice(0, limit);
      if (options.before !== undefined) page.reverse();
      const entries = page.map((r) => ({
        sequence: r.sequence as SessionCursor,
        version: r.version as SessionVersion,
        source: r.source,
        recordedAt: r.recorded_at,
        entry: JSON.parse(r.body),
      }));
      return frozen({
        entries,
        nextCursor: (entries.at(-1)?.sequence ?? after) as SessionCursor,
        hasMore: records.length > limit,
        version: row.version as SessionVersion,
      });
    },
  };
}

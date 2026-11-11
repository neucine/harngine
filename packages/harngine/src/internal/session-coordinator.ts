import { agentCompilation, type Agent as PublicAgent } from '../agent.js';
import { canonical, copy, frozen, validate } from '../schema.js';
import {
  RuntimeError,
  requestId,
  type Agent,
  type AnyAgent,
  type Closure,
  type Json,
  type InputRequest,
  type Policy,
  type Reason,
  type SessionCursor,
  type SessionId,
  type SessionReceipt,
  type SessionRef,
  type SessionSend,
  type SessionSendAcceptance,
  type SessionVersion,
  type WorkId,
  type WorkRef,
  type Workflow,
} from './contracts.js';
import { exact, reason } from './core.js';
import { type DefinitionRegistry, registeredIdentity } from './definition-registry.js';
import { entityId } from './id.js';
import type { PolicyEvaluator } from './policy-evaluator.js';
import type { SqliteStore } from './store.js';
import { acceptInput } from './input.js';

/** Owns Session context reconstruction, publication, queue activation, and lifecycle entries. */
export class SessionCoordinator {
  constructor(
    private readonly store: SqliteStore,
    private readonly registry: DefinitionRegistry,
    private readonly policy: PolicyEvaluator,
    private readonly clock: () => number,
    private readonly checkpoint: (boundary: 'session' | 'input') => void,
    private readonly wake: () => void,
    private readonly isClosed: () => boolean,
  ) {}

  context(
    sessionId: SessionId,
    agent: AnyAgent | PublicAgent<any, any>,
    beforeSequence: number,
  ): Json[] {
    const configuredSession = agentCompilation(agent)
      ? (agent as PublicAgent<any, any>).context.session
      : undefined;
    const contextLimit = agentCompilation(agent)
      ? configuredSession === false
        ? 0
        : (configuredSession?.recent ?? 20)
      : 'context' in agent
        ? (agent as Agent).context.maxEntries
        : 20;
    const records = this.store.db
      .prepare(
        `SELECT body FROM session_entries
         WHERE session_id=?
           AND json_extract(body,'$.type') IN ('input','output')
           AND (sequence<? OR json_extract(body,'$.type')='output')
         ORDER BY sequence DESC LIMIT ?`,
      )
      .all(sessionId, beforeSequence, contextLimit) as { body: string }[];
    return records.reverse().map((record) => JSON.parse(record.body) as Json);
  }

  async send(
    caller: { readonly principal: string; readonly source: string },
    session: SessionRef,
    raw: SessionSend,
  ): Promise<SessionReceipt<SessionSendAcceptance>> {
    if (this.isClosed()) throw new RuntimeError('CLOSED', 'Runtime is closed');
    exact(session, ['id']);
    const request = copy(raw);
    requestId(request.requestId);
    const scope = canonical([caller.principal, caller.source]);
    const command = canonical({ type: 'session.send', target: session, request });
    const prior = this.store.db
      .prepare('SELECT command,receipt FROM receipts WHERE source_scope=? AND request_id=?')
      .get(scope, request.requestId) as { command: string; receipt: string } | undefined;
    if (prior)
      return frozen(
        prior.command === command
          ? JSON.parse(prior.receipt)
          : {
              requestId: request.requestId,
              status: 'conflict',
              target: session.id,
              reason: {
                code: 'IDENTITY_CONFLICT',
                message: 'Request identity has different content',
              },
            },
      );
    let invalid: Reason | undefined;
    try {
      exact(request, ['requestId', 'content', 'limits']);
      canonical(request.content);
    } catch (error) {
      invalid = reason(error);
    }
    const preliminary = this.store.db
      .prepare('SELECT principal,agent FROM sessions WHERE id=?')
      .get(session.id) as { principal: string; agent: string | null } | undefined;
    if (!preliminary) throw new RuntimeError('NOT_FOUND', 'Session not found');
    if (preliminary.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Session belongs to another principal');
    let startAllowed: boolean | undefined;
    if (!invalid && preliminary.agent) {
      const access = this.policy.canStart({
        principal: caller.principal,
        definition: JSON.parse(preliminary.agent),
        objective: request.content,
      });
      startAllowed = typeof access === 'boolean' ? access : await access;
      if (!startAllowed)
        invalid = { code: 'ACCESS_DENIED', message: 'Starting Session Work is not authorized' };
    }
    const receipt = this.store.write((): SessionReceipt<SessionSendAcceptance> => {
      const row = this.store.db.prepare('SELECT * FROM sessions WHERE id=?').get(session.id) as
        | {
            id: string;
            principal: string;
            status: string;
            version: number;
            cursor: number;
            max_entries: number;
            agent: string | null;
            foreground_work_id: string | null;
          }
        | undefined;
      if (!row) throw new RuntimeError('NOT_FOUND', 'Session not found');
      if (row.principal !== caller.principal)
        throw new RuntimeError('ACCESS_DENIED', 'Session belongs to another principal');
      let rejection = invalid;
      const registered = row.agent ? this.registry.agent(JSON.parse(row.agent)) : undefined;
      if (row.status !== 'active')
        rejection = { code: 'SESSION_CLOSED', message: 'Session is closed' };
      else if (!registered)
        rejection = { code: 'AGENT_UNAVAILABLE', message: 'Session has no available Agent' };
      else if (row.cursor >= row.max_entries)
        rejection = { code: 'SESSION_CAPACITY', message: 'Session entry capacity is full' };
      let result: SessionReceipt<SessionSendAcceptance>;
      let workId: string | null = null;
      if (rejection)
        result = {
          requestId: request.requestId,
          status: 'rejected',
          target: session.id as SessionId,
          cursor: row.cursor as SessionCursor,
          reason: rejection,
        };
      else {
        const agent = registered!;
        const agentIdentity = registeredIdentity(agent);
        const definition = this.registry.workflow(agentIdentity)!;
        let objective: Json;
        let state: Json;
        try {
          objective = validate(agent.objective, request.content);
          state = validate(definition.state, definition.initial(frozen(objective)));
          if (request.limits) {
            exact(request.limits, [
              'maxDecisions',
              'maxAttempts',
              'maxOperations',
              'maxModelTurns',
              'maxToolExecutions',
            ]);
            for (const [name, limit] of Object.entries(request.limits)) {
              const configured = definition.policy[name as keyof Policy];
              if (
                !Number.isSafeInteger(limit) ||
                (limit as number) < 1 ||
                configured === undefined ||
                (limit as number) > configured
              )
                throw new RuntimeError(
                  'INVALID_POLICY',
                  'Session Work limits may only narrow the Agent definition',
                );
            }
          }
        } catch (error) {
          const problem = reason(error);
          result = {
            requestId: request.requestId,
            status: 'rejected',
            target: session.id as SessionId,
            cursor: row.cursor as SessionCursor,
            reason: problem,
          };
          this.recordCommand(scope, request.requestId, command, session.id, result, null);
          if (startAllowed !== undefined)
            this.recordStartAuthorization(
              caller.principal,
              startAllowed,
              scope,
              request,
              preliminary.agent,
            );
          return result;
        }
        const route = row.foreground_work_id ? ('queued' as const) : ('started' as const);
        const sequence = row.cursor + 1;
        const context = route === 'started' ? this.context(session.id, agent, sequence) : [];
        workId = entityId('work');
        const controlToken = entityId('control');
        this.store.db
          .prepare(
            `INSERT INTO work(id,principal,definition,objective,state,policy,status,eligible,control_token,context)
             VALUES(?,?,?,?,?,?,'active',?, ?,?)`,
          )
          .run(
            workId,
            caller.principal,
            canonical(agentIdentity),
            canonical(objective),
            canonical(state),
            canonical({ ...definition.policy, ...(request.limits ?? {}) }),
            route === 'started' ? 1 : 0,
            controlToken,
            canonical(context),
          );
        this.store.db
          .prepare('INSERT INTO objective_revisions VALUES(?,1,?,?)')
          .run(workId, canonical(objective), controlToken);
        this.store.event(workId, 'work.accepted', {});
        const work = { id: workId as WorkId, definition: agentIdentity };
        const version = (row.version + 1) as SessionVersion;
        const cursor = (row.cursor + 1) as SessionCursor;
        result = {
          requestId: request.requestId,
          status: 'accepted',
          target: session.id as SessionId,
          cursor,
          value: { version, sequence: cursor, work, route },
        };
        this.recordCommand(scope, request.requestId, command, session.id, result, workId);
        this.store.db
          .prepare(
            route === 'started'
              ? 'UPDATE sessions SET version=?,cursor=?,foreground_work_id=? WHERE id=?'
              : 'UPDATE sessions SET version=?,cursor=? WHERE id=?',
          )
          .run(
            ...(route === 'started'
              ? [version, cursor, workId, session.id]
              : [version, cursor, session.id]),
          );
        this.store.db.prepare('INSERT INTO session_work VALUES(?,?)').run(session.id, workId);
        this.store.db
          .prepare('INSERT INTO session_entries VALUES(?,?,?,?,?,?,?,?)')
          .run(
            session.id,
            cursor,
            version,
            caller.source,
            this.clock(),
            canonical({ type: 'input', content: request.content, work, route }),
            scope,
            request.requestId,
          );
        if (route === 'queued')
          this.store.db
            .prepare('INSERT INTO session_queue VALUES(?,?,?)')
            .run(session.id, cursor, workId);
        if (startAllowed !== undefined)
          this.recordStartAuthorization(
            caller.principal,
            startAllowed,
            scope,
            request,
            preliminary.agent,
            workId,
          );
        return result;
      }
      if (startAllowed !== undefined)
        this.recordStartAuthorization(
          caller.principal,
          startAllowed,
          scope,
          request,
          preliminary.agent,
          workId,
        );
      this.recordCommand(scope, request.requestId, command, session.id, result, workId);
      return result;
    });
    this.checkpoint('session');
    if (receipt.status === 'accepted') this.wake();
    return frozen(receipt);
  }

  work(caller: { readonly principal: string }, session: SessionRef, workId: WorkId): WorkRef {
    if (this.isClosed()) throw new RuntimeError('CLOSED', 'Runtime is closed');
    const row = this.store.db
      .prepare('SELECT principal FROM sessions WHERE id=?')
      .get(session.id) as { principal: string } | undefined;
    if (!row) throw new RuntimeError('NOT_FOUND', 'Session not found');
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Session belongs to another principal');
    const linked = this.store.db
      .prepare('SELECT 1 FROM session_work WHERE session_id=? AND work_id=?')
      .get(session.id, workId);
    if (!linked) throw new RuntimeError('NOT_FOUND', 'Work is not associated with Session');
    const work = this.store.work(workId);
    if (work.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
    return frozen({ id: workId, definition: JSON.parse(work.definition) });
  }

  steer<O extends Json, R extends Json, I extends Json>(
    caller: { readonly principal: string; readonly source: string },
    session: SessionRef,
    work: WorkRef<O, R, I>,
    request: InputRequest<NoInfer<I>>,
    definition: Workflow | undefined,
  ) {
    if (this.isClosed()) throw new RuntimeError('CLOSED', 'Runtime is closed');
    const receipt = this.store.write(() => {
      const sessionRow = this.store.db
        .prepare('SELECT * FROM sessions WHERE id=?')
        .get(session.id) as
        | {
            principal: string;
            status: string;
            version: number;
            cursor: number;
            max_entries: number;
            foreground_work_id: string | null;
          }
        | undefined;
      if (!sessionRow) throw new RuntimeError('NOT_FOUND', 'Session not found');
      if (sessionRow.principal !== caller.principal)
        throw new RuntimeError('ACCESS_DENIED', 'Session belongs to another principal');
      if (sessionRow.status !== 'active')
        throw new RuntimeError('SESSION_CLOSED', 'Session is closed');
      if (sessionRow.foreground_work_id !== work.id)
        throw new RuntimeError('WORK_CLOSED', 'Work is not the Session foreground Work');
      if (sessionRow.cursor >= sessionRow.max_entries)
        throw new RuntimeError('SESSION_CAPACITY', 'Session entry capacity is full');
      const accepted = acceptInput(this.store, caller, work, request, definition, false);
      if (accepted.status !== 'accepted') return accepted;
      const version = sessionRow.version + 1;
      const cursor = sessionRow.cursor + 1;
      this.store.db
        .prepare('UPDATE sessions SET version=?,cursor=? WHERE id=?')
        .run(version, cursor, session.id);
      this.store.db
        .prepare('INSERT INTO session_receipts VALUES(?,?,?)')
        .run(canonical([caller.principal, caller.source]), request.requestId, session.id);
      this.store.db
        .prepare('INSERT INTO session_entries VALUES(?,?,?,?,?,?,?,?)')
        .run(
          session.id,
          cursor,
          version,
          caller.source,
          this.clock(),
          canonical({ type: 'input', content: request.payload, work }),
          canonical([caller.principal, caller.source]),
          request.requestId,
        );
      return accepted;
    });
    this.checkpoint('input');
    this.wake();
    return frozen(receipt);
  }

  recoverPublications(): void {
    this.store.write(() => {
      const closed = this.store.db
        .prepare(
          "SELECT w.id,w.closure FROM work w JOIN sessions s ON s.foreground_work_id=w.id WHERE w.status='closed' AND w.closure IS NOT NULL",
        )
        .all() as { id: string; closure: string }[];
      for (const row of closed) this.publishClosure(row.id as WorkId, JSON.parse(row.closure));
    });
  }

  private recordCommand(
    scope: string,
    id: string,
    command: string,
    sessionId: string,
    receipt: SessionReceipt<SessionSendAcceptance>,
    workId: string | null,
  ): void {
    this.store.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(scope, id, command, workId, canonical(receipt));
    this.store.db.prepare('INSERT INTO session_receipts VALUES(?,?,?)').run(scope, id, sessionId);
  }

  private recordStartAuthorization(
    principal: string,
    allowed: boolean,
    scope: string,
    request: SessionSend,
    agent: string | null,
    workId?: string | null,
  ): void {
    this.store.authorization({
      action: 'start',
      principal,
      policyRevision: this.policy.revision,
      allowed,
      ...(workId ? { workId } : {}),
      targetId: `${scope}:${request.requestId}`,
      subject: agent ? JSON.parse(agent) : null,
      value: request.content,
    });
  }

  publishClosure(workId: WorkId, closure: Closure): void {
    const queued = this.store.db
      .prepare(
        `SELECT s.id,s.principal,s.version,s.cursor FROM session_queue q
         JOIN sessions s ON s.id=q.session_id WHERE q.work_id=?`,
      )
      .get(workId) as
      | { id: string; principal: string; version: number; cursor: number }
      | undefined;
    if (queued) {
      const work = this.store.work(workId);
      const ref = { id: workId, definition: JSON.parse(work.definition) };
      const version = queued.version + 1;
      const cursor = queued.cursor + 1;
      this.store.db.prepare('DELETE FROM session_queue WHERE work_id=?').run(workId);
      this.appendEntry(queued, version, cursor, { type: 'result', work: ref, closure }, workId);
      this.store.db
        .prepare('UPDATE sessions SET version=?,cursor=? WHERE id=?')
        .run(version, cursor, queued.id);
      return;
    }
    const sessions = this.store.db
      .prepare('SELECT * FROM sessions WHERE foreground_work_id=?')
      .all(workId) as {
      id: string;
      principal: string;
      version: number;
      cursor: number;
      max_entries: number;
    }[];
    for (const session of sessions) {
      let cursor = session.cursor;
      const version = session.version + 1;
      const work = this.store.work(workId);
      const registration = this.registry.registration(JSON.parse(work.definition));
      const authored = registration ? agentCompilation(registration) : undefined;
      const presentation =
        closure.status === 'completed' && authored
          ? (registration as PublicAgent<any, any>).publish
          : closure.status === 'completed'
            ? (value: Json) => value
            : false;
      let content: Json | undefined;
      if (closure.status === 'completed' && presentation !== false)
        try {
          content = presentation(closure.result);
          canonical(content);
        } catch (error) {
          this.store.event(workId, 'session.publication.failed', {
            code: 'INVALID_PRESENTATION',
            message: error instanceof Error ? error.message : 'Result presentation failed',
          });
        }
      cursor++;
      const ref = { id: workId, definition: JSON.parse(work.definition) };
      this.appendEntry(
        session,
        version,
        cursor,
        content !== undefined && cursor <= session.max_entries
          ? { type: 'output', content, work: ref }
          : { type: 'result', work: ref, closure },
        workId,
      );
      const next = this.store.db
        .prepare(
          `SELECT q.sequence,w.id,w.definition FROM session_queue q
           JOIN work w ON w.id=q.work_id WHERE q.session_id=? ORDER BY q.sequence LIMIT 1`,
        )
        .get(session.id) as { sequence: number; id: WorkId; definition: string } | undefined;
      if (next) {
        const nextAgent = this.registry.agent(JSON.parse(next.definition));
        if (nextAgent) {
          const context = this.context(session.id as SessionId, nextAgent, next.sequence);
          this.store.db
            .prepare('UPDATE work SET context=?,eligible=1 WHERE id=?')
            .run(canonical(context), next.id);
        } else this.store.db.prepare('UPDATE work SET eligible=1 WHERE id=?').run(next.id);
        this.store.db.prepare('DELETE FROM session_queue WHERE work_id=?').run(next.id);
        this.store.event(next.id, 'work.activated', { sessionId: session.id });
        cursor++;
        this.appendEntry(
          session,
          version,
          cursor,
          { type: 'work', work: { id: next.id, definition: JSON.parse(next.definition) } },
          next.id,
        );
      }
      this.store.db
        .prepare('UPDATE sessions SET version=?,cursor=?,foreground_work_id=? WHERE id=?')
        .run(version, cursor, next?.id ?? null, session.id);
    }
  }

  private appendEntry(
    session: { id: string; principal: string },
    version: number,
    cursor: number,
    entry: Json,
    workId: WorkId,
  ): void {
    const request = entityId('req');
    const scope = canonical([session.principal, 'harngine']);
    const receipt = {
      requestId: request,
      status: 'accepted',
      target: session.id,
      cursor,
      value: { version, sequence: cursor },
    };
    this.store.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(
        scope,
        request,
        canonical({ type: 'session.lifecycle', workId, cursor }),
        workId,
        canonical(receipt),
      );
    this.store.db
      .prepare('INSERT INTO session_receipts VALUES(?,?,?)')
      .run(scope, request, session.id);
    this.store.db
      .prepare('INSERT INTO session_entries VALUES(?,?,?,?,?,?,?,?)')
      .run(session.id, cursor, version, 'harngine', this.clock(), canonical(entry), scope, request);
  }
}

import type { Agent as PublicAgent } from '../agent.js';
import { canonical, copy, frozen, validate } from '../schema.js';
import type { Workflow as PublicWorkflow } from '../workflow.js';
import {
  RuntimeError,
  requestId,
  type Agent,
  type Json,
  type Policy,
  type ProgressCursor,
  type Reason,
  type Receipt,
  type RequestId,
  type WorkId,
  type Workflow,
  type WorkRef,
} from './contracts.js';
import { exact, reason } from './core.js';
import { type DefinitionRegistry, registeredIdentity } from './definition-registry.js';
import { entityId } from './id.js';
import type { PolicyEvaluator } from './policy-evaluator.js';
import type { SqliteStore } from './store.js';

export interface Start<O extends Json> {
  requestId: RequestId;
  objective: O;
  context?: readonly Json[];
  limits?: Partial<Policy>;
}

/** Owns idempotent Work admission, validation, authorization evidence, and initial state. */
export class WorkService {
  constructor(
    private readonly store: SqliteStore,
    private readonly registry: DefinitionRegistry,
    private readonly policy: PolicyEvaluator,
    private readonly checkpoint: () => void,
    private readonly wake: () => void,
    private readonly isClosed: () => boolean,
  ) {}

  async start<O extends Json, S extends Json, R extends Json, I extends Json>(
    caller: { readonly principal: string; readonly source: string },
    registration: Workflow<O, S, R, I> | PublicWorkflow<O, R> | Agent<O, R, I> | PublicAgent<O, R>,
    input: Start<O>,
  ): Promise<Receipt<WorkRef<O, R, I>>> {
    if (this.isClosed()) throw new RuntimeError('CLOSED', 'Runtime is closed');
    const requestWithDefaults = { ...input, context: input.context ?? [] } as Start<O>;
    const request = copy(requestWithDefaults);
    requestId(request.requestId);
    const registrationIdentity = registeredIdentity(registration);
    const definition = this.registry.workflow(registrationIdentity) as
      | Workflow<O, S, R, I>
      | undefined;
    const command = canonical({ definition: registrationIdentity, request });
    const scope = canonical([caller.principal, caller.source]);
    const previous = this.store.db
      .prepare('SELECT command,receipt,work_id FROM receipts WHERE source_scope=? AND request_id=?')
      .get(scope, request.requestId) as
      | { command: string; receipt: string; work_id: string | null }
      | undefined;
    if (previous) {
      if (previous.work_id && this.store.work(previous.work_id).principal !== caller.principal)
        throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
      if (previous.command !== command)
        return {
          requestId: request.requestId,
          status: 'conflict',
          reason: { code: 'IDENTITY_CONFLICT', message: 'Request identity has different content' },
        };
      return JSON.parse(previous.receipt);
    }
    let state: Json = null;
    let rejection: Reason | undefined;
    try {
      exact(request, ['requestId', 'objective', 'context', 'limits']);
      if (!Array.isArray(request.context) || request.context.length > 100)
        throw new RuntimeError('INVALID_CONTEXT', 'Context must contain at most 100 JSON values');
      canonical(request.context);
      if (!definition || !this.registry.isRegistration(registrationIdentity, registration))
        throw new RuntimeError('UNAVAILABLE', 'Use the registered Agent or Workflow definition');
      const objective = validate(definition.objective, request.objective);
      state = validate(definition.state, definition.initial(frozen(objective)));
      if (request.limits) {
        exact(request.limits, [
          'maxDecisions',
          'maxAttempts',
          'maxOperations',
          'maxModelTurns',
          'maxToolExecutions',
          'maxChildWork',
          'maxDepth',
        ]);
        for (const [name, limit] of Object.entries(request.limits)) {
          if (!Number.isSafeInteger(limit) || (limit as number) <= 0)
            throw new RuntimeError('INVALID_POLICY', 'Work limits must be positive integers');
          if (name === 'maxDepth') {
            if ((limit as number) > 8)
              throw new RuntimeError('INVALID_POLICY', 'Work depth may not exceed the default');
            continue;
          }
          const configured = definition.policy[name as keyof Policy];
          if (configured === undefined || (limit as number) > configured)
            throw new RuntimeError('INVALID_POLICY', 'Work limits may only narrow the definition');
        }
      }
    } catch (error) {
      rejection = reason(error);
    }
    const startChecked = !rejection;
    const startAccess = rejection
      ? true
      : this.policy.canStart({
          principal: caller.principal,
          definition: registrationIdentity,
          objective: request.objective,
        });
    const startAllowed = typeof startAccess === 'boolean' ? startAccess : await startAccess;
    if (!rejection && !startAllowed)
      rejection = { code: 'ACCESS_DENIED', message: 'Starting this definition is not authorized' };
    const receipt = this.store.write((): Receipt<WorkRef<O, R, I>> => {
      let result: Receipt<WorkRef<O, R, I>>;
      if (rejection)
        result = { requestId: request.requestId, status: 'rejected', reason: rejection };
      else {
        const id = entityId('work') as WorkId;
        const controlToken = entityId('control');
        this.store.db
          .prepare(
            "INSERT INTO work(id,principal,definition,objective,state,policy,status,eligible,control_token,context) VALUES(?,?,?,?,?,?,'active',1,?,?)",
          )
          .run(
            id,
            caller.principal,
            canonical(registrationIdentity),
            canonical(request.objective),
            canonical(state),
            canonical({ ...definition!.policy, ...(request.limits ?? {}) }),
            controlToken,
            canonical(request.context),
          );
        this.store.db
          .prepare('INSERT INTO objective_revisions VALUES(?,1,?,?)')
          .run(id, canonical(request.objective), controlToken);
        const cursor = this.store.event(id, 'work.accepted', {}) as ProgressCursor;
        result = {
          requestId: request.requestId,
          status: 'accepted',
          target: id,
          cursor,
          value: { id, definition: registrationIdentity },
        };
      }
      if (startChecked)
        this.store.authorization({
          action: 'start',
          principal: caller.principal,
          policyRevision: this.policy.revision,
          allowed: startAllowed,
          ...(result.status === 'accepted' ? { workId: result.target } : {}),
          targetId: `${scope}:${request.requestId}`,
          subject: { id: registrationIdentity.id, version: registrationIdentity.version },
          value: request.objective,
        });
      this.store.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
        .run(
          scope,
          request.requestId,
          command,
          result.status === 'accepted' ? result.target : null,
          canonical(result),
        );
      return result;
    });
    this.checkpoint();
    this.wake();
    return frozen(receipt);
  }
}

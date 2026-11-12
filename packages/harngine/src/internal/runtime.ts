import { setTimeout as delay } from 'node:timers/promises';
import {
  RuntimeError,
  type AnyWorkflow,
  type AnyTool,
  type AnyAgent,
  type Agent,
  type Workflow,
  type Json,
  type WorkRef,
  type WorkId,
  type Closure,
  type Snapshot,
  type ProgressCursor,
  type CancelRequest,
  type ReviseRequest,
  type ApprovalReply,
  type WaitRef,
  type InputRequest,
  type ReplyRequest,
  type SessionCreate,
  type SessionHandoffRequest,
  type SessionRef,
  type SessionSend,
  type ResolveEffectRequest,
} from './contracts.js';
import { copy, frozen } from '../schema.js';
import { acceptInput } from './input.js';
import { workHistory, inspectDecision, inspectCall } from './inspection.js';
import type { WorkHistoryOptions } from './contracts.js';
import { sessionApi } from './session.js';
import { SqliteStore, type WorkRow } from './store.js';
import { OperationExecutor } from './operation-executor.js';
import type { Agent as PublicAgent } from '../agent.js';
import type { Workflow as PublicWorkflow } from '../workflow.js';
import type { Tool as PublicTool } from '../tool.js';
import { DefinitionRegistry, registeredIdentity } from './definition-registry.js';
import { Scheduler } from './scheduler.js';
import { ExecutionEngine } from './execution-engine.js';
import { PolicyEvaluator, type RuntimeAccessPolicy } from './policy-evaluator.js';
import { WaitManager } from './wait-manager.js';
import { ControlService } from './control-service.js';
import { SessionCoordinator } from './session-coordinator.js';
import { InspectionService, type RuntimeWorkRecord } from './inspection-service.js';
import { WorkService, type Start } from './work-service.js';
import { ChildWorkManager } from './child-work-manager.js';
import type { TelemetrySink } from '../telemetry.js';
export type { RuntimeWorkRecord } from './inspection-service.js';
export type { RuntimeAccessPolicy } from './policy-evaluator.js';
export type { Start } from './work-service.js';
export interface RuntimeOptions {
  directory: string;
  definitions?: readonly (AnyWorkflow | PublicWorkflow<any, any>)[];
  agents?: readonly (AnyAgent | PublicAgent<any, any>)[];
  tools?: readonly (AnyTool | PublicTool<any, any>)[];
  access?: RuntimeAccessPolicy;
  telemetry?: TelemetrySink;
}
export interface Caller {
  principal: string;
  source: string;
}
export interface RuntimeDefinitionRecord {
  readonly kind: 'agent' | 'workflow' | 'tool';
  readonly id: string;
  readonly version: string;
  readonly manifest: Json;
  readonly available: boolean;
}

// Internal constructor seam for deterministic process-crash tests, not an extension hook.
export type Checkpoint = (
  boundary:
    | 'accepted'
    | 'decision'
    | 'admission'
    | 'outcome'
    | 'closure'
    | 'control'
    | 'proposal'
    | 'beforeAdmission'
    | 'reply'
    | 'input'
    | 'session'
    | 'resolution'
    | 'reconciliationAdmission'
    | 'reconciliationOutcome',
) => void;
export class Runtime {
  private readonly store: SqliteStore;
  private readonly registry: DefinitionRegistry;
  private readonly executionEngine: ExecutionEngine;
  private readonly scheduler: Scheduler;
  private readonly operationExecutor: OperationExecutor;
  private readonly policy: PolicyEvaluator;
  private readonly waitManager: WaitManager;
  private readonly controlService: ControlService;
  private readonly sessionCoordinator: SessionCoordinator;
  private readonly inspection: InspectionService;
  private readonly workService: WorkService;
  private readonly childWorkManager: ChildWorkManager;
  /** Privileged, unstable storage inspection used only by the App diagnostics facade. */
  diagnosticRecords(workId: WorkId): readonly {
    table: string;
    key: string;
    value: Json;
  }[] {
    return this.inspection.diagnosticRecords(workId);
  }
  definitionRecords(): readonly RuntimeDefinitionRecord[] {
    if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
    return this.registry.records();
  }
  executable(reference: {
    kind: 'agent' | 'workflow';
    id: string;
    revision: string;
  }): PublicAgent<any, any> | PublicWorkflow<any, any> | undefined {
    if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
    return this.registry.executable(reference);
  }
  workRecord(caller: Caller, id: WorkId): RuntimeWorkRecord {
    return this.inspection.workRecord(caller, id);
  }
  workRecords(caller: Caller): readonly RuntimeWorkRecord[] {
    return this.inspection.workRecords(caller);
  }
  constructor(
    options: RuntimeOptions,
    private readonly checkpoint: Checkpoint = () => {},
    private readonly clock: () => number = Date.now,
  ) {
    if (
      Object.keys(options).some(
        (k) => !['directory', 'definitions', 'agents', 'tools', 'access', 'telemetry'].includes(k),
      )
    )
      throw new RuntimeError('UNSUPPORTED', 'Unsupported runtime options');
    this.policy = new PolicyEvaluator(options.access);
    this.store = new SqliteStore(options.directory, this.clock, options.telemetry);
    try {
      this.waitManager = new WaitManager(this.store, this.clock, this.policy);
      this.registry = new DefinitionRegistry(this.store, options);
      this.sessionCoordinator = new SessionCoordinator(
        this.store,
        this.registry,
        this.policy,
        this.clock,
        (boundary) => this.checkpoint(boundary),
        () => this.scheduler.wake(),
        () => this.scheduler.closed,
      );
      this.childWorkManager = new ChildWorkManager(this.store);
      this.operationExecutor = new OperationExecutor({
        store: this.store,
        tools: this.registry.tools,
        access: this.policy,
        shouldContinue: () => this.scheduler.shouldContinue,
        checkpoint: this.checkpoint,
        clock: this.clock,
        fail: (row, problem) => this.executionEngine.fail(row, problem),
      });
      this.executionEngine = new ExecutionEngine({
        store: this.store,
        registry: this.registry,
        operations: this.operationExecutor,
        access: this.policy,
        shouldContinue: () => this.scheduler.shouldContinue,
        beforeCycle: () => {
          this.scheduler.expireNow();
          this.scheduler.refreshDeadline();
        },
        checkpoint: this.checkpoint,
        clock: this.clock,
        publishClosure: (workId, closure) => {
          this.childWorkManager.publishClosure(workId, closure);
          this.sessionCoordinator.publishClosure(workId, closure);
        },
      });
      this.scheduler = new Scheduler({
        drive: () => this.executionEngine.drive(),
        expireDeadlines: () => this.waitManager.expire(),
        nextDeadline: () => this.waitManager.nextDeadline(),
        abortInFlight: () => this.operationExecutor.abortAll(),
        clock: this.clock,
      });
      this.inspection = new InspectionService(
        this.store,
        this.registry,
        this.waitManager,
        () => this.scheduler.closed,
      );
      this.workService = new WorkService(
        this.store,
        this.registry,
        this.policy,
        () => this.checkpoint('accepted'),
        () => this.scheduler.wake(),
        () => this.scheduler.closed,
      );
      this.controlService = new ControlService({
        store: this.store,
        registry: this.registry,
        operations: this.operationExecutor,
        checkpoint: () => this.checkpoint('control'),
        wake: () => this.scheduler.wake(),
        publishClosure: (workId, closure) => {
          this.childWorkManager.publishClosure(workId, closure);
          this.sessionCoordinator.publishClosure(workId, closure);
        },
      });
      this.operationExecutor.recover();
      this.sessionCoordinator.recoverPublications();
      this.scheduler.expireNow();
    } catch (error) {
      this.store.close();
      throw error;
    }
  }
  forCaller(context: Caller) {
    if (!context.principal || !context.source)
      throw new RuntimeError('ACCESS_DENIED', 'Trusted caller context required');
    const caller = frozen(copy(context));
    const sessions = sessionApi(
      this.store,
      caller,
      () => {
        if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
      },
      () => this.checkpoint('session'),
      this.clock,
    );
    return {
      session: {
        ...sessions,
        create: (request: SessionCreate) => {
          if (request.agent && !this.registry.isAgent(request.agent))
            throw new RuntimeError('UNAVAILABLE', 'Use a registered Agent');
          return sessions.create({
            ...request,
            ...(request.agent ? { agent: registeredIdentity(request.agent) } : {}),
          } as SessionCreate);
        },
        send: (session: SessionRef, request: SessionSend) =>
          this.sessionCoordinator.send(caller, session, request),
        handoff: (session: SessionRef, request: SessionHandoffRequest) => {
          if (!this.registry.agent(request.agent))
            throw new RuntimeError('UNAVAILABLE', 'Use a registered Agent');
          return this.sessionCoordinator.handoff(caller, session, request);
        },
        work: async (session: SessionRef, workId: WorkId): Promise<WorkRef> => {
          return this.sessionCoordinator.work(caller, session, workId);
        },
      },
      work: {
        start: <O extends Json, S extends Json, R extends Json, I extends Json>(
          definition:
            | Workflow<O, S, R, I>
            | PublicWorkflow<O, R>
            | Agent<O, R, I>
            | PublicAgent<O, R>,
          request: Start<O>,
        ) => this.workService.start(caller, definition, request),
        input: async <O extends Json, R extends Json, I extends Json>(
          work: WorkRef<O, R, I>,
          request: InputRequest<NoInfer<I>>,
        ) => {
          const row = this.authorize(caller, work);
          const receipt = acceptInput(
            this.store,
            caller,
            work,
            request,
            this.registry.workflow(JSON.parse(row.definition)),
          );
          this.checkpoint('input');
          this.scheduler.wake();
          return frozen(receipt);
        },
        steer: async <O extends Json, R extends Json, I extends Json>(
          work: WorkRef<O, R, I>,
          request: InputRequest<NoInfer<I>>,
          session?: SessionRef,
        ) => {
          const row = this.authorize(caller, work);
          const definition = this.registry.workflow(JSON.parse(row.definition));
          if (!session) {
            const receipt = acceptInput(this.store, caller, work, request, definition);
            this.checkpoint('input');
            this.scheduler.wake();
            return frozen(receipt);
          }
          return this.sessionCoordinator.steer(caller, session, work, request, definition);
        },
        approval: async <O extends Json, R extends Json>(work: WorkRef<O, R>, wait: WaitRef) => {
          if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
          return this.waitManager.approval(caller, work, wait);
        },
        wait: async <O extends Json, R extends Json>(work: WorkRef<O, R>, ref: WaitRef) => {
          if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
          return this.waitManager.wait(caller, work, ref);
        },
        reply: async <O extends Json, R extends Json>(
          work: WorkRef<O, R>,
          request: ApprovalReply | ReplyRequest,
        ) => {
          if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
          const receipt = await this.waitManager.reply(caller, work, request);
          this.checkpoint('reply');
          this.scheduler.wake();
          return receipt;
        },
        resolveEffect: async <O extends Json, R extends Json>(
          work: WorkRef<O, R>,
          request: ResolveEffectRequest,
        ) => {
          if (this.scheduler.closed) throw new RuntimeError('CLOSED', 'Runtime is closed');
          this.authorize(caller, work);
          const receipt = this.operationExecutor.resolveUnknown(caller, work.id, request);
          this.checkpoint('resolution');
          if (receipt.status === 'accepted') this.scheduler.wake();
          return frozen(receipt);
        },
        cancel: <O extends Json, R extends Json>(work: WorkRef<O, R>, request: CancelRequest) =>
          this.controlService.apply(caller, work, 'cancel', request),
        revise: <O extends Json, R extends Json>(work: WorkRef<O, R>, request: ReviseRequest<O>) =>
          this.controlService.apply(caller, work, 'revise', request),
        get: async <O extends Json, S extends Json, R extends Json, I extends Json>(
          id: WorkId,
          definition: Workflow<O, S, R, I> | Agent<O, R, I>,
        ): Promise<WorkRef<O, R, I>> => {
          const definitionIdentity = registeredIdentity(definition);
          if (!this.registry.isRegistration(definitionIdentity, definition))
            throw new RuntimeError(
              'CONTRACT_MISMATCH',
              'Use the registered definition to restore a typed reference',
            );
          const ref = { id, definition: definitionIdentity } as WorkRef<O, R, I>;
          this.authorize(caller, ref);
          return frozen(ref);
        },
        inspect: async <O extends Json, R extends Json>(
          work: WorkRef<O, R>,
        ): Promise<Snapshot<O, R>> => this.inspect(caller, work),
        history: async (work: WorkRef, options: WorkHistoryOptions = {}) => {
          this.authorize(caller, work);
          return workHistory(this.store, work.id, options);
        },
        eventCursor: async (work: WorkRef, eventId: string): Promise<ProgressCursor> => {
          return this.inspection.eventCursor(caller, work, eventId);
        },
        projection: async (work: WorkRef, eventId: string) => {
          this.authorize(caller, work);
          const projection = this.store.publicProjection(work.id, eventId);
          if (!projection) throw new RuntimeError('NOT_FOUND', 'Work update not found');
          return frozen(projection);
        },
        decision: async (work: WorkRef, sequence: number) => {
          this.authorize(caller, work);
          return inspectDecision(this.store, work.id, sequence);
        },
        call: async (work: WorkRef, operationId: string) => {
          this.authorize(caller, work);
          return inspectCall(this.store, work.id, operationId);
        },
        result: async <O extends Json, R extends Json>(
          work: WorkRef<O, R>,
          options: { signal?: AbortSignal } = {},
        ): Promise<Closure<R>> => {
          while (true) {
            options.signal?.throwIfAborted();
            const snapshot = this.inspect(caller, work);
            if (snapshot.closure) return snapshot.closure;
            if (this.scheduler.failure) throw this.scheduler.failure.error;
            await delay(10, undefined, options.signal ? { signal: options.signal } : undefined);
          }
        },
      },
    };
  }
  private authorize(caller: Caller, ref: WorkRef): WorkRow {
    return this.inspection.authorize(caller, ref);
  }
  private inspect<O extends Json, R extends Json>(
    caller: Caller,
    ref: WorkRef<O, R>,
  ): Snapshot<O, R> {
    return this.inspection.snapshot(caller, ref);
  }
  /** Start automatic execution. Supervise this promise: it resolves on close or rejects on failure. */
  start(): Promise<void> {
    return this.scheduler.start();
  }
  /** Drive all currently eligible Work; waiting/uncertain Work does not busy-loop. */
  drain(): Promise<void> {
    return this.scheduler.drain();
  }
  async close(options: { readonly abortInFlight?: boolean } = {}): Promise<void> {
    await this.scheduler.close(() => this.store.close(), options);
  }
}
export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options);
}

import type { Json, SessionId, WorkId } from '../types.js';
import {
  commandError,
  NotFoundError,
  translateError,
  UnavailableError,
  ValidationError,
} from '../errors.js';
import {
  Runtime,
  type Caller,
  type RuntimeAccessPolicy,
  type RuntimeDefinitionRecord,
} from './runtime.js';
import type { Agent as PublicAgent } from '../agent.js';
import type { Workflow as PublicWorkflow } from '../workflow.js';
import type {
  App,
  AppOptions,
  AppScope,
  AuditOptions,
  Definition,
  DefinitionDescription,
  DefinitionKind,
  DefinitionReference,
  Definitions,
  DiagnosticPage,
  Diagnostics,
  ExecutableDefinitionReference,
  ExecutionLimits,
  RegisteredDefinition,
  Sessions,
  StartOptions,
  Work,
  Works,
  WorkStatus,
} from '../app.js';
import {
  WorkHandle,
  definitionDescription,
  recordStatus,
  runtimeDefinition,
  workLimits,
  workSummary,
} from './app-work.js';
import { generatedRequestId } from './app-codecs.js';
import { SessionManager } from './app-session.js';

type ObjectiveOf<D> =
  D extends PublicWorkflow<infer O, any> ? O : D extends PublicAgent<infer O, any> ? O : never;
type ResultOf<D> =
  D extends PublicWorkflow<any, infer R> ? R : D extends PublicAgent<any, infer R> ? R : never;

function runtimeAccess(options: AppOptions): RuntimeAccessPolicy {
  if (options.access && 'allowAuthenticated' in options.access)
    return {
      revision: 'access_allow_authenticated',
      canStart: () => true,
      canCall: () => true,
      canRespond: () => true,
      canHandoff: () => true,
    };
  if (options.access) {
    const policy = options.access;
    return {
      revision: policy.revision,
      canStart: ({ principal, definition, objective }) =>
        policy.canStart({
          principal,
          definition: { id: definition.id, revision: definition.version },
          objective,
        }),
      canCall: ({ principal, workId, target, tool, input }) =>
        policy.canCall({
          principal,
          workId,
          target: {
            kind: target.kind,
            id: target.id,
            revision: target.version,
          },
          tool: { id: tool.id, revision: tool.version },
          input,
        }),
      canRespond: (input) => policy.canRespond(input),
      canHandoff: ({ principal, sessionId, fromAgent, toAgent, reason }) =>
        policy.canHandoff?.({
          principal,
          sessionId,
          fromAgent: { id: fromAgent.id, revision: fromAgent.version },
          toAgent: { id: toAgent.id, revision: toAgent.version },
          ...(reason === undefined ? {} : { reason }),
        }) ?? false,
    };
  }
  const local = options.principal ?? 'local';
  return {
    revision: 'access_local',
    canStart: ({ principal }) => principal === local,
    canCall: ({ principal }) => principal === local,
    canRespond: ({ principal }) => principal === local,
    canHandoff: ({ principal }) => principal === local,
  };
}

function encodePageToken(value: Json): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePageToken<T>(value: string, message: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new ValidationError({ code: 'INVALID_PAGE', message });
  }
}

function pageLimit(value: number | undefined, resource: string): number {
  const limit = value ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ValidationError({
      code: 'INVALID_LIMIT',
      message: `${resource} page limit must be between 1 and 100`,
    });
  return limit;
}

class DefinitionManager implements Definitions {
  constructor(private readonly runtime: Runtime) {}

  async list(
    options: {
      kind?: DefinitionKind;
      id?: string;
      availability?: 'available' | 'unavailable';
      page?: string;
      limit?: number;
    } = {},
  ) {
    const limit = pageLimit(options.limit, 'Definition');
    const allowedKinds = new Set<DefinitionKind>(['agent', 'workflow', 'tool']);
    if (options.kind !== undefined && !allowedKinds.has(options.kind))
      throw new ValidationError({ code: 'INVALID_FILTER', message: 'Invalid Definition kind' });
    if (options.id !== undefined && (!options.id || options.id.length > 256))
      throw new ValidationError({ code: 'INVALID_FILTER', message: 'Invalid Definition ID' });
    if (
      options.availability !== undefined &&
      options.availability !== 'available' &&
      options.availability !== 'unavailable'
    )
      throw new ValidationError({
        code: 'INVALID_FILTER',
        message: 'Invalid Definition availability',
      });
    let after: { kind: DefinitionKind; id: string; revision: string } | undefined;
    if (options.page !== undefined) {
      after = decodePageToken(options.page, 'Invalid Definition page token');
      if (
        !after ||
        !allowedKinds.has(after.kind) ||
        typeof after.id !== 'string' ||
        typeof after.revision !== 'string'
      )
        throw new ValidationError({
          code: 'INVALID_PAGE',
          message: 'Invalid Definition page token',
        });
    }
    const keyOf = (record: RuntimeDefinitionRecord) =>
      `${record.kind}\u0000${record.id}\u0000${record.version}`;
    const afterKey = after ? `${after.kind}\u0000${after.id}\u0000${after.revision}` : undefined;
    const rows = this.runtime
      .definitionRecords()
      .filter((record) => options.kind === undefined || record.kind === options.kind)
      .filter((record) => options.id === undefined || record.id === options.id)
      .filter(
        (record) =>
          options.availability === undefined ||
          (record.available ? 'available' : 'unavailable') === options.availability,
      )
      .filter((record) => afterKey === undefined || keyOf(record) > afterKey);
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return Object.freeze({
      object: 'list',
      definitions: Object.freeze(selected.map(definitionDescription)),
      next:
        rows.length > limit && last
          ? encodePageToken({ kind: last.kind, id: last.id, revision: last.version })
          : null,
    });
  }

  async get(selected: DefinitionReference): Promise<DefinitionDescription> {
    const record = this.runtime
      .definitionRecords()
      .find(
        (candidate) =>
          candidate.kind === selected.kind &&
          candidate.id === selected.id &&
          candidate.version === selected.revision,
      );
    if (!record)
      throw new NotFoundError({ code: 'NOT_FOUND', message: 'Definition revision not found' });
    return definitionDescription(record);
  }
}

class WorkManager implements Works {
  constructor(
    private readonly runtime: Runtime,
    private readonly caller: Caller,
  ) {}

  async list(
    options: {
      status?: WorkStatus | readonly WorkStatus[];
      definition?: ExecutableDefinitionReference;
      sessionId?: SessionId;
      page?: string;
      limit?: number;
    } = {},
  ) {
    const limit = pageLimit(options.limit, 'Work');
    const requestedStatuses =
      options.status === undefined
        ? undefined
        : new Set(Array.isArray(options.status) ? options.status : [options.status]);
    const allowedStatuses = new Set<WorkStatus>([
      'queued',
      'running',
      'waiting',
      'completed',
      'failed',
      'canceled',
    ]);
    if (
      requestedStatuses?.size === 0 ||
      [...(requestedStatuses ?? [])].some((s) => !allowedStatuses.has(s))
    )
      throw new ValidationError({ code: 'INVALID_FILTER', message: 'Invalid Work status' });
    let after: { createdAt: number; id: string } | undefined;
    if (options.page !== undefined) {
      after = decodePageToken(options.page, 'Invalid Work page token');
      if (
        !after ||
        !Number.isSafeInteger(after.createdAt) ||
        after.createdAt < 0 ||
        typeof after.id !== 'string'
      )
        throw new ValidationError({ code: 'INVALID_PAGE', message: 'Invalid Work page token' });
    }
    const rows = [...this.runtime.workRecords(this.caller)]
      .filter((record) => !requestedStatuses || requestedStatuses.has(recordStatus(record)))
      .filter(
        (record) =>
          !options.definition ||
          (record.kind === options.definition.kind &&
            record.ref.definition.id === options.definition.id &&
            record.ref.definition.version === options.definition.revision),
      )
      .filter((record) => !options.sessionId || record.sessionId === options.sessionId)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.ref.id.localeCompare(left.ref.id),
      )
      .filter(
        (record) =>
          !after ||
          record.createdAt < after.createdAt ||
          (record.createdAt === after.createdAt && record.ref.id < after.id),
      );
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return Object.freeze({
      object: 'list',
      works: Object.freeze(selected.map(workSummary)),
      next:
        rows.length > limit && last
          ? encodePageToken({ createdAt: last.createdAt, id: last.ref.id })
          : null,
    });
  }

  async get(id: WorkId): Promise<Work> {
    try {
      const record = this.runtime.workRecord(this.caller, id);
      return new WorkHandle(
        this.runtime,
        this.caller,
        record.ref,
        record.kind === 'agent',
        record.sessionId ? { id: record.sessionId } : undefined,
      );
    } catch (error) {
      throw translateError(error);
    }
  }
}

class Scope implements AppScope {
  readonly audit;
  readonly sessions: Sessions;
  readonly works: Works;

  constructor(
    protected readonly runtime: Runtime,
    protected readonly caller: Caller,
    private readonly schedulerError: () => unknown,
    protected readonly agents: ReadonlyMap<string, PublicAgent<any, any>>,
    protected readonly limitCeiling?: ExecutionLimits,
    protected readonly auditOptions?: AuditOptions,
  ) {
    this.audit = runtime.audit(caller, auditOptions);
    this.sessions = new SessionManager(runtime, caller, agents, limitCeiling);
    this.works = new WorkManager(runtime, caller);
  }

  async start<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions,
  ): Promise<Work<ObjectiveOf<D>, ResultOf<D>>>;
  async start(
    definition: ExecutableDefinitionReference,
    objective: Json,
    options?: StartOptions,
  ): Promise<Work>;
  async start(
    definition: Definition | ExecutableDefinitionReference,
    objective: Json,
    options: StartOptions = {},
  ): Promise<Work> {
    const failed = this.schedulerError();
    if (failed) throw translateError(failed);
    try {
      const executable = 'kind' in definition ? this.runtime.executable(definition) : definition;
      if (!executable)
        throw new UnavailableError({
          code: 'DEFINITION_UNAVAILABLE',
          message: 'The exact definition revision is unavailable',
        });
      const limits = workLimits(executable, options.limits, this.limitCeiling);
      const receipt = await this.runtime.forCaller(this.caller).work.start(executable, {
        requestId: generatedRequestId(options.idempotencyKey),
        objective,
        context: options.context ?? [],
        ...(limits ? { limits } : {}),
      });
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return new WorkHandle(this.runtime, this.caller, receipt.value, 'model' in executable);
    } catch (error) {
      throw translateError(error);
    }
  }

  async run<D extends Definition>(
    definition: D,
    objective: ObjectiveOf<D>,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<ResultOf<D>>;
  async run(
    definition: ExecutableDefinitionReference,
    objective: Json,
    options?: StartOptions & { signal?: AbortSignal },
  ): Promise<Json>;
  async run(
    definition: Definition | ExecutableDefinitionReference,
    objective: Json,
    options: StartOptions & { signal?: AbortSignal } = {},
  ): Promise<Json> {
    const work =
      'kind' in definition
        ? await this.start(definition, objective, options)
        : await this.start(definition, objective, options);
    return work.result(options.signal ? { signal: options.signal } : undefined);
  }
}

class Application extends Scope implements App {
  readonly definitions: Definitions;
  readonly diagnostics: Diagnostics;
  readonly storage;
  private failure: unknown;
  private readonly supervision: Promise<void>;
  constructor(
    runtime: Runtime,
    caller: Caller,
    agents: ReadonlyMap<string, PublicAgent<any, any>>,
    limits?: ExecutionLimits,
    audit?: AuditOptions,
  ) {
    const state: { failure?: unknown } = {};
    super(runtime, caller, () => state.failure, agents, limits, audit);
    this.storage = runtime.stateStore;
    this.supervision = runtime.start().catch((error: unknown) => {
      state.failure = error;
      this.failure = error;
    });
    this.definitions = new DefinitionManager(runtime);
    this.diagnostics = Object.freeze({
      records: async (
        workId: WorkId,
        options: { after?: string; limit?: number } = {},
      ): Promise<DiagnosticPage> => {
        try {
          const limit = options.limit ?? 100;
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new ValidationError({
              code: 'INVALID_LIMIT',
              message: 'Diagnostic page limit must be between 1 and 500',
            });
          let offset = 0;
          if (options.after) {
            try {
              const decoded = JSON.parse(
                Buffer.from(options.after, 'base64url').toString('utf8'),
              ) as { workId: string; offset: number };
              if (
                decoded.workId !== workId ||
                !Number.isSafeInteger(decoded.offset) ||
                decoded.offset < 0
              )
                throw new Error('invalid cursor');
              offset = decoded.offset;
            } catch {
              throw new ValidationError({
                code: 'INVALID_PAGE',
                message: 'Invalid diagnostic page token',
              });
            }
          }
          const records = runtime.diagnosticRecords(workId);
          const page = records.slice(offset, offset + limit).map((record) =>
            Object.freeze({
              object: 'diagnostic_record' as const,
              ...record,
            }),
          );
          const nextOffset = offset + page.length;
          return Object.freeze({
            object: 'list',
            records: Object.freeze(page),
            next:
              nextOffset < records.length
                ? Buffer.from(JSON.stringify({ workId, offset: nextOffset })).toString('base64url')
                : null,
          });
        } catch (error) {
          if (error instanceof ValidationError) throw error;
          throw translateError(error);
        }
      },
    });
  }

  forPrincipal(principal: string): AppScope {
    if (!principal)
      throw new ValidationError({ code: 'INVALID_PRINCIPAL', message: 'Principal required' });
    return new Scope(
      this.runtime,
      { principal, source: 'harngine-app' },
      () => this.failure,
      this.agents,
      this.limitCeiling,
      this.auditOptions,
    );
  }

  describe(definition: RegisteredDefinition): DefinitionDescription {
    const kind: DefinitionKind =
      'execute' in definition ? 'tool' : 'instructions' in definition ? 'agent' : 'workflow';
    const record = runtimeDefinition(this.runtime, {
      object: kind,
      kind,
      id: definition.id,
      revision: definition.revision,
    });
    return definitionDescription(record);
  }

  async close(options: { readonly abortInFlight?: boolean } = {}): Promise<void> {
    try {
      await this.runtime.close(options);
      await this.supervision;
      if (this.failure) throw this.failure;
    } catch (error) {
      throw translateError(error);
    }
  }
}

export function createApp(options: AppOptions): App {
  const runtime = new Runtime({
    directory: options.directory,
    ...(options.workflows ? { definitions: options.workflows } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    access: runtimeAccess(options),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.stateStore ? { stateStore: options.stateStore } : {}),
  });
  const agents = new Map(
    (options.agents ?? []).map((agent) => [`${agent.id}@${agent.revision}`, agent] as const),
  );
  return new Application(
    runtime,
    { principal: options.principal ?? 'local', source: 'harngine-app' },
    agents,
    options.limits,
    options.audit,
  );
}

import type {
  AnyWorkflow,
  Closure,
  Outcome,
  Proposal,
  Tool as CoreTool,
  View,
  WorkId,
  Workflow as CoreWorkflow,
} from './internal/contracts.js';
import { RuntimeError } from './internal/contracts.js';
import type { Json, Schema } from './types.js';
import { ToolCallError, WorkCanceledError, WorkFailedError } from './errors.js';
import { definitionRevision } from './build/manifest.js';
import { toolIdentity, type Tool as PublicTool } from './tool.js';
import {
  canonical,
  frozen,
  identity,
  key,
  schema,
  validate,
  workflow as coreWorkflow,
} from './schema.js';

type WorkflowTool<I extends Json = Json, O extends Json = Json> = CoreTool<I, O> | PublicTool<I, O>;

export interface ChildDefinition<O extends Json = Json, R extends Json = Json> {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly objective: Schema<O>;
  readonly result: Schema<R>;
}

export interface ChildTask<O extends Json = Json, R extends Json = Json> {
  readonly definition: ChildDefinition<O, R>;
  readonly objective: O;
}

export interface CallHandle<O extends Json = Json, R extends Json = Json> {
  readonly slot: string;
  readonly definition: ChildDefinition<O, R>;
  readonly __objective?: O;
  readonly __result?: R;
}

export interface Question<R extends Json> {
  response(): Promise<R>;
}

export interface Flow {
  call<I extends Json, O extends Json>(
    name: string,
    tool: WorkflowTool<I, O>,
    input: I,
  ): Promise<O>;
  call<O extends Json, R extends Json>(
    name: string,
    target: ChildDefinition<O, R>,
    objective: O,
  ): Promise<R>;
  child<O extends Json, R extends Json>(
    name: string,
    definition: ChildDefinition<O, R>,
    objective: O,
  ): Promise<R>;
  start<O extends Json, R extends Json>(
    name: string,
    target: ChildDefinition<O, R>,
    objective: O,
  ): Promise<CallHandle<O, R>>;
  join<R extends Json>(name: string, call: CallHandle<any, R>): Promise<R>;
  all<T extends readonly ChildTask<any, any>[]>(
    name: string,
    tasks: T,
  ): Promise<{
    -readonly [K in keyof T]: T[K] extends ChildTask<any, infer R> ? R : never;
  }>;
  ask<R extends Json>(
    name: string,
    request: {
      readonly prompt: string;
      readonly response: Schema<R>;
      readonly responders?: readonly string[];
      readonly timeoutMs?: number;
    },
  ): Promise<R>;
  question<R extends Json>(
    name: string,
    request: {
      readonly prompt: string;
      readonly response: Schema<R>;
      readonly responders?: readonly string[];
      readonly timeoutMs?: number;
    },
  ): Question<R>;
  approval(
    name: string,
    details: Json,
    options?: { readonly approvers?: readonly string[]; readonly timeoutMs?: number },
  ): Promise<void>;
  now(name: string): Promise<number>;
  sleep(name: string, durationMs: number): Promise<void>;
  fail(error: { code: string; message: string }): never;
}

export interface WorkflowDefinition<O extends Json, R extends Json> {
  readonly id: string;
  readonly objective: Schema<O>;
  readonly result: Schema<R>;
  readonly tools?: readonly WorkflowTool<any, any>[];
  readonly children?: readonly ChildDefinition<any, any>[];
  readonly limits?: {
    readonly operations?: number;
    readonly toolExecutions?: number;
    readonly childWork?: number;
  };
  readonly run: (objective: O, flow: Flow) => R | Promise<R>;
}

export interface Workflow<O extends Json = Json, R extends Json = Json> {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly objective: Schema<O>;
  readonly result: Schema<R>;
  readonly tools: readonly WorkflowTool<any, any>[];
  readonly children: readonly ChildDefinition<any, any>[];
  readonly limits: {
    readonly operations: number;
    readonly toolExecutions: number;
    readonly childWork: number;
  };
  readonly run: (objective: O, flow: Flow) => R | Promise<R>;
  readonly __objective?: O;
  readonly __result?: R;
}

type Internals = { workflow: AnyWorkflow; tools: readonly WorkflowTool<any, any>[] };
const internalDefinitions = new WeakMap<object, Internals>();

class WorkflowFailure extends Error {
  constructor(readonly reason: { code: string; message: string }) {
    super(reason.message);
  }
}

const approvalResponse = schema<boolean>({
  id: 'harngine.workflow.approval-response',
  version: '1',
  jsonSchema: { type: 'boolean' },
});

function validateOperationName(name: string): void {
  if (!name || name.length > 256)
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'Workflow operation names must contain 1–256 characters',
    );
}

function recordedOutcome<I extends Json>(
  name: string,
  tool: WorkflowTool<I, Json>,
  input: I,
  view: View,
): Outcome | undefined {
  const recorded = view.calls[name];
  if (!recorded) return;
  if (
    key(recorded.tool) !== key(toolIdentity(tool)) ||
    canonical(recorded.input) !== canonical(input)
  )
    throw new RuntimeError(
      'INVALID_DEFINITION',
      `Workflow operation ${JSON.stringify(name)} changed during replay`,
    );
  return recorded.outcome ?? undefined;
}

async function replay<O extends Json, R extends Json>(
  definition: WorkflowDefinition<O, R>,
  tools: ReadonlyMap<string, WorkflowTool<any, any>>,
  children: ReadonlyMap<string, ChildDefinition<any, any>>,
  view: View<O, null, never>,
): Promise<Proposal<null, R>> {
  let pending: Proposal<null, R> | undefined;
  let pendingNonblockingRegistration = false;
  let invalid: Error | undefined;
  let wakePending!: () => void;
  const pendingReady = new Promise<void>((resolve) => {
    wakePending = resolve;
  });

  const blockedByPending = <V>(): Promise<V> => {
    if (pendingNonblockingRegistration) return new Promise<V>(() => {});
    invalid = new RuntimeError(
      'INVALID_DEFINITION',
      'Concurrent or unawaited Workflow operations are not supported',
    );
    wakePending();
    return new Promise<V>(() => {});
  };

  const reply = <V extends Json>(
    name: string,
    request: {
      prompt: string;
      response: Schema<V>;
      responders?: readonly string[];
      timeoutMs?: number;
    },
    options: {
      blocking: boolean;
      interaction: 'question' | 'approval';
      presentation?: Json;
    },
  ): Promise<V> => {
    validateOperationName(name);
    if (pending) return blockedByPending<V>();
    const saved = view.waits[name];
    if (!saved) {
      pending = {
        type: 'wait',
        state: null,
        until: {
          type: 'reply',
          slot: name,
          schema: identity(request.response),
          prompt: request.prompt,
          blocking: options.blocking,
          interaction: options.interaction,
          ...(options.presentation === undefined ? {} : { presentation: options.presentation }),
          responders: request.responders ?? ['$owner'],
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        },
      };
      pendingNonblockingRegistration = !options.blocking;
      queueMicrotask(wakePending);
      return new Promise<V>(() => {});
    }
    if (
      saved.kind !== 'reply' ||
      !saved.schema ||
      key(saved.schema) !== key(request.response) ||
      saved.prompt !== request.prompt ||
      saved.interaction !== options.interaction ||
      canonical(saved.presentation) !== canonical(options.presentation ?? null)
    )
      return Promise.reject(
        new RuntimeError(
          'INVALID_DEFINITION',
          `Workflow interaction ${JSON.stringify(name)} changed during replay`,
        ),
      );
    if (saved.status === 'replied')
      return Promise.resolve(validate(request.response, saved.payload));
    if (saved.status === 'expired')
      return Promise.reject(
        new WorkflowFailure({ code: 'DEADLINE_EXCEEDED', message: 'Interaction expired' }),
      );
    pending = { type: 'wait', state: null, until: { type: 'existing', slot: name } };
    queueMicrotask(wakePending);
    return new Promise<V>(() => {});
  };

  const flow: Flow = Object.freeze({
    call<I extends Json, V extends Json>(
      name: string,
      selected: WorkflowTool<I, V> | ChildDefinition<I, V>,
      input: I,
    ): Promise<V> {
      validateOperationName(name);
      if (!isWorkflowTool(selected)) {
        const target = selected as ChildDefinition<I, V>;
        if (children.get(key(executableIdentity(target))) !== target)
          throw new RuntimeError(
            'INVALID_DEFINITION',
            'flow.call must use a declared Tool or executable target',
          );
        return replayChild(name, target, input, 'sequential');
      }
      if (tools.get(key(toolIdentity(selected))) !== selected)
        throw new RuntimeError('INVALID_DEFINITION', 'flow.call must use a declared Tool');
      if (pending) return blockedByPending<V>();
      if (view.children[name])
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'Workflow operation kind changed during replay'),
        );
      const outcome = recordedOutcome(name, selected as WorkflowTool<I, Json>, input, view);
      if (!outcome) {
        pending = {
          type: 'call',
          state: null,
          call: { slot: name, tool: toolIdentity(selected), input },
        };
        queueMicrotask(wakePending);
        return new Promise<V>(() => {});
      }
      if (outcome.status === 'success') return Promise.resolve(outcome.value as V);
      if (outcome.status === 'failure')
        return Promise.reject(new ToolCallError(outcome.reason, outcome.effect));
      return new Promise<V>(() => {});
    },
    child<CO extends Json, CR extends Json>(
      name: string,
      selected: ChildDefinition<CO, CR>,
      objective: CO,
    ): Promise<CR> {
      validateOperationName(name);
      const selectedIdentity = executableIdentity(selected);
      if (children.get(key(selectedIdentity)) !== selected)
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'flow.child must use a declared Agent or Workflow',
        );
      return replayChild(name, selected, objective, 'sequential');
    },
    start<CO extends Json, CR extends Json>(
      name: string,
      selected: ChildDefinition<CO, CR>,
      objective: CO,
    ): Promise<CallHandle<CO, CR>> {
      validateOperationName(name);
      const selectedIdentity = executableIdentity(selected);
      if (children.get(key(selectedIdentity)) !== selected)
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'flow.start must use a declared Agent or Workflow',
        );
      if (pending) return blockedByPending<CallHandle<CO, CR>>();
      const saved = view.children[name];
      if (!saved) {
        if (view.calls[name])
          return Promise.reject(
            new RuntimeError('INVALID_DEFINITION', 'Workflow operation kind changed during replay'),
          );
        pending = {
          type: 'child',
          state: null,
          child: { slot: name, definition: selectedIdentity, objective, mode: 'concurrent' },
        };
        queueMicrotask(wakePending);
        return new Promise<CallHandle<CO, CR>>(() => {});
      }
      if (
        key(saved.work.definition) !== key(selectedIdentity) ||
        canonical(saved.objective) !== canonical(objective) ||
        saved.mode !== 'concurrent'
      )
        return Promise.reject(
          new RuntimeError(
            'INVALID_DEFINITION',
            `Workflow child ${JSON.stringify(name)} changed during replay`,
          ),
        );
      return Promise.resolve(
        Object.freeze({
          slot: name,
          definition: selected as ChildDefinition<CO, CR>,
        }),
      );
    },
    join<CR extends Json>(name: string, call: CallHandle<any, CR>): Promise<CR> {
      validateOperationName(name);
      if (
        !call ||
        typeof call !== 'object' ||
        typeof call.slot !== 'string' ||
        typeof call.definition !== 'object'
      )
        throw new RuntimeError('INVALID_DEFINITION', 'flow.join requires a flow.start handle');
      const selectedIdentity = executableIdentity(call.definition);
      if (children.get(key(selectedIdentity)) !== call.definition)
        throw new RuntimeError('INVALID_DEFINITION', 'flow.join must use a declared target');
      if (pending) return blockedByPending<CR>();
      const saved = view.children[call.slot];
      if (!saved)
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'flow.join target has not been started'),
        );
      if (key(saved.work.definition) !== key(selectedIdentity))
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'Workflow join target changed during replay'),
        );
      if (saved.joinSlot !== null && saved.joinSlot !== name)
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'Workflow child already has a different join'),
        );
      if (saved.joinSlot === null) {
        pending = { type: 'join', state: null, join: { slot: name, child: call.slot } };
        queueMicrotask(wakePending);
        return new Promise<CR>(() => {});
      }
      if (!saved.closure) return new Promise<CR>(() => {});
      if (saved.closure.status === 'completed')
        return Promise.resolve(validate(call.definition.result, saved.closure.result));
      return Promise.reject(executableClosureError(saved.work.id, saved.closure));
    },
    all<T extends readonly ChildTask<any, any>[]>(
      name: string,
      tasks: T,
    ): Promise<{
      -readonly [K in keyof T]: T[K] extends ChildTask<any, infer V> ? V : never;
    }> {
      validateOperationName(name);
      if (!Array.isArray(tasks) || !tasks.length || tasks.length > 100)
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'flow.all requires between 1 and 100 child tasks',
        );
      if (pending)
        return blockedByPending() as Promise<{
          -readonly [K in keyof T]: T[K] extends ChildTask<any, infer V> ? V : never;
        }>;
      const planned = tasks.map((task, index) => {
        const slot = `${name}:${index}`;
        validateOperationName(slot);
        const selectedIdentity = executableIdentity(task.definition);
        if (children.get(key(selectedIdentity)) !== task.definition)
          throw new RuntimeError('INVALID_DEFINITION', 'flow.all must use declared definitions');
        return {
          slot,
          definition: selectedIdentity,
          objective: task.objective,
          mode: 'sequential' as const,
        };
      });
      const saved = planned.map((item) => view.children[item.slot]);
      if (saved.every((item) => item === undefined)) {
        pending = { type: 'children', state: null, children: planned };
        queueMicrotask(wakePending);
        return new Promise(() => {});
      }
      if (saved.some((item) => item === undefined))
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'Workflow child batch is only partially durable'),
        );
      const values: Json[] = [];
      for (let index = 0; index < planned.length; index++) {
        const item = planned[index]!;
        const recorded = saved[index]!;
        if (
          key(recorded.work.definition) !== key(item.definition) ||
          canonical(recorded.objective) !== canonical(item.objective)
        )
          return Promise.reject(
            new RuntimeError(
              'INVALID_DEFINITION',
              `Workflow child batch ${JSON.stringify(name)} changed during replay`,
            ),
          );
        if (!recorded.closure) return new Promise(() => {});
        if (recorded.closure.status !== 'completed')
          return Promise.reject(executableClosureError(recorded.work.id, recorded.closure));
        values.push(validate(tasks[index]!.definition.result, recorded.closure.result));
      }
      return Promise.resolve(values) as Promise<{
        -readonly [K in keyof T]: T[K] extends ChildTask<any, infer V> ? V : never;
      }>;
    },
    ask<V extends Json>(
      name: string,
      request: {
        prompt: string;
        response: Schema<V>;
        responders?: readonly string[];
        timeoutMs?: number;
      },
    ): Promise<V> {
      return reply(name, request, { blocking: true, interaction: 'question' });
    },
    question<V extends Json>(
      name: string,
      request: {
        prompt: string;
        response: Schema<V>;
        responders?: readonly string[];
        timeoutMs?: number;
      },
    ): Question<V> {
      validateOperationName(name);
      const saved = view.waits[name];
      if (!saved && !pending) {
        void reply(name, request, { blocking: false, interaction: 'question' });
      } else if (saved) {
        if (
          saved.kind !== 'reply' ||
          !saved.schema ||
          key(saved.schema) !== key(request.response) ||
          saved.prompt !== request.prompt ||
          saved.interaction !== 'question'
        )
          throw new RuntimeError(
            'INVALID_DEFINITION',
            `Workflow interaction ${JSON.stringify(name)} changed during replay`,
          );
      } else {
        void blockedByPending<V>();
      }
      return Object.freeze({
        response: () => reply(name, request, { blocking: true, interaction: 'question' }),
      });
    },
    async approval(
      name: string,
      details: Json,
      options: { approvers?: readonly string[]; timeoutMs?: number } = {},
    ): Promise<void> {
      canonical(details);
      const approved = await reply(
        name,
        {
          prompt: `Approve ${name}?`,
          response: approvalResponse,
          ...(options.approvers === undefined ? {} : { responders: options.approvers }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        },
        { blocking: true, interaction: 'approval', presentation: details },
      );
      if (!approved)
        throw new WorkflowFailure({
          code: 'APPROVAL_REJECTED',
          message: `Approval ${JSON.stringify(name)} was rejected`,
        });
    },
    now(name: string): Promise<number> {
      validateOperationName(name);
      if (pending) return blockedByPending<number>();
      const saved = view.waits[name];
      if (!saved) {
        pending = {
          type: 'wait',
          state: null,
          until: { type: 'timer', slot: name, delayMs: 0, operation: 'now' },
        };
        queueMicrotask(wakePending);
        return new Promise<number>(() => {});
      }
      if (saved.kind !== 'timer' || saved.operation !== 'now' || saved.delayMs !== 0)
        return Promise.reject(
          new RuntimeError(
            'INVALID_DEFINITION',
            `Workflow operation ${JSON.stringify(name)} changed during replay`,
          ),
        );
      if (saved.status === 'fired') return Promise.resolve(saved.deadline!);
      pending = { type: 'wait', state: null, until: { type: 'existing', slot: name } };
      queueMicrotask(wakePending);
      return new Promise<number>(() => {});
    },
    sleep(name: string, durationMs: number): Promise<void> {
      validateOperationName(name);
      if (!Number.isSafeInteger(durationMs) || durationMs < 0)
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'flow.sleep duration must be a positive integer'),
        );
      if (pending) return blockedByPending<void>();
      const saved = view.waits[name];
      if (!saved) {
        pending = {
          type: 'wait',
          state: null,
          until: { type: 'timer', slot: name, delayMs: durationMs, operation: 'sleep' },
        };
        queueMicrotask(wakePending);
        return new Promise<void>(() => {});
      }
      if (saved.kind !== 'timer' || saved.operation !== 'sleep' || saved.delayMs !== durationMs)
        return Promise.reject(
          new RuntimeError(
            'INVALID_DEFINITION',
            `Workflow operation ${JSON.stringify(name)} changed during replay`,
          ),
        );
      if (saved.status === 'fired') return Promise.resolve();
      pending = { type: 'wait', state: null, until: { type: 'existing', slot: name } };
      queueMicrotask(wakePending);
      return new Promise<void>(() => {});
    },
    fail(error: { code: string; message: string }): never {
      if (!error.code || !error.message)
        throw new RuntimeError('INVALID_DEFINITION', 'flow.fail requires a code and message');
      throw new WorkflowFailure(error);
    },
  });

  const execution = Promise.resolve().then(() => definition.run(view.objective, flow));
  return Promise.race([
    execution.then(
      (result): Proposal<null, R> => {
        if (pending)
          throw new RuntimeError(
            'INVALID_DEFINITION',
            'Workflow returned while a durable operation was still pending',
          );
        return { type: 'complete', result };
      },
      (error): Proposal<null, R> => {
        if (error instanceof WorkflowFailure) return { type: 'fail', reason: error.reason };
        if (error instanceof WorkFailedError || error instanceof WorkCanceledError)
          return { type: 'fail', reason: error.reason };
        if (error instanceof ToolCallError)
          return { type: 'fail', reason: { code: 'TOOL_FAILED', message: error.message } };
        throw error;
      },
    ),
    pendingReady.then(() => {
      if (invalid) throw invalid;
      if (!pending)
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'Workflow replay did not produce an operation',
        );
      return pending;
    }),
  ]);

  function replayChild<CO extends Json, CR extends Json>(
    name: string,
    selected: ChildDefinition<CO, CR>,
    objective: CO,
    mode: 'sequential' | 'concurrent',
  ): Promise<CR> {
    const selectedIdentity = executableIdentity(selected);
    if (pending) return blockedByPending<CR>();
    const saved = view.children[name];
    if (!saved) {
      if (view.calls[name])
        return Promise.reject(
          new RuntimeError('INVALID_DEFINITION', 'Workflow operation kind changed during replay'),
        );
      pending = {
        type: 'child',
        state: null,
        child: { slot: name, definition: selectedIdentity, objective, mode },
      };
      queueMicrotask(wakePending);
      return new Promise<CR>(() => {});
    }
    if (
      key(saved.work.definition) !== key(selectedIdentity) ||
      canonical(saved.objective) !== canonical(objective) ||
      saved.mode !== mode
    )
      return Promise.reject(
        new RuntimeError(
          'INVALID_DEFINITION',
          `Workflow child ${JSON.stringify(name)} changed during replay`,
        ),
      );
    if (!saved.closure) return new Promise<CR>(() => {});
    if (saved.closure.status === 'completed')
      return Promise.resolve(validate(selected.result, saved.closure.result));
    return Promise.reject(executableClosureError(saved.work.id, saved.closure));
  }
}

export function workflow<O extends Json, R extends Json>(
  definition: WorkflowDefinition<O, R>,
): Workflow<O, R>;
export function workflow<O extends Json, R extends Json>(
  definition: WorkflowDefinition<O, R>,
): Workflow<O, R> {
  if (
    Object.keys(definition).some(
      (name) => !['id', 'objective', 'result', 'tools', 'children', 'limits', 'run'].includes(name),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported Workflow configuration');
  if (!definition.id || definition.id.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Workflow id must contain 1–256 characters');
  const declaredTools = definition.tools ?? [];
  const tools = new Map<string, WorkflowTool<any, any>>();
  for (const selected of declaredTools) {
    const toolKey = key(toolIdentity(selected));
    if (tools.has(toolKey))
      throw new RuntimeError('REGISTRATION_CONFLICT', 'Workflow Tools must be unique');
    tools.set(toolKey, selected);
  }
  const declaredChildren = definition.children ?? [];
  const children = new Map<string, ChildDefinition<any, any>>();
  for (const selected of declaredChildren) {
    const childKey = key(executableIdentity(selected));
    if (children.has(childKey))
      throw new RuntimeError('REGISTRATION_CONFLICT', 'Workflow children must be unique');
    children.set(childKey, selected);
  }
  const limits = {
    operations: definition.limits?.operations ?? 1_000,
    toolExecutions: definition.limits?.toolExecutions ?? 100,
    childWork: definition.limits?.childWork ?? 100,
  };
  if (
    !Number.isSafeInteger(limits.operations) ||
    limits.operations < 1 ||
    !Number.isSafeInteger(limits.toolExecutions) ||
    limits.toolExecutions < 1 ||
    !Number.isSafeInteger(limits.childWork) ||
    limits.childWork < 1
  )
    throw new RuntimeError('INVALID_POLICY', 'Workflow limits must be positive finite integers');
  const revision = definitionRevision('workflow', definition.id, {
    id: definition.id,
    objective: definition.objective,
    result: definition.result,
    tools: declaredTools.map(toolIdentity),
    children: declaredChildren.map(executableIdentity),
    limits,
  });
  const artifactDigest = revision.slice(4);
  const result: Workflow<O, R> = Object.freeze({
    id: definition.id,
    revision,
    objective: definition.objective,
    result: definition.result,
    tools: Object.freeze([...declaredTools]),
    children: Object.freeze([...declaredChildren]),
    limits: frozen(limits),
    run: definition.run,
  });
  const state = schema<null>({
    id: `${definition.id}.workflow-state`,
    version: revision,
    jsonSchema: { type: 'null' },
  });
  const compiled = coreWorkflow<O, null, R, never>({
    id: definition.id,
    version: revision,
    artifactDigest,
    objective: definition.objective,
    state,
    result: definition.result,
    policy: {
      maxDecisions: limits.operations,
      maxAttempts: limits.toolExecutions,
      maxOperations: limits.operations,
      maxToolExecutions: limits.toolExecutions,
      maxChildWork: limits.childWork,
    },
    tools: declaredTools.map(toolIdentity),
    children: declaredChildren.map(executableIdentity),
    initial: () => null,
    decide: ((view: View<O, null, never>) =>
      replay(definition, tools, children, view)) as unknown as (
      view: View<O, null, never>,
    ) => Proposal<null, R>,
  });
  internalDefinitions.set(result, {
    workflow: compiled as unknown as AnyWorkflow,
    tools: declaredTools,
  });
  return result;
}

export function workflowInternals(value: unknown): Internals | undefined {
  return value && typeof value === 'object' ? internalDefinitions.get(value) : undefined;
}

export function workflowIdentity(value: CoreWorkflow<any, any, any, any> | Workflow<any, any>): {
  id: string;
  version: string;
} {
  const internal = workflowInternals(value);
  return internal ? identity(internal.workflow) : identity(value as CoreWorkflow);
}

function executableIdentity(value: ChildDefinition<any, any>): { id: string; version: string } {
  return { id: value.id, version: value.revision };
}

function isWorkflowTool(
  value: WorkflowTool<any, any> | ChildDefinition<any, any>,
): value is WorkflowTool<any, any> {
  return 'effect' in value;
}

function executableClosureError(
  workId: WorkId,
  closure: Extract<Closure, { status: 'failed' | 'canceled' }>,
): WorkFailedError | WorkCanceledError {
  return closure.status === 'canceled'
    ? new WorkCanceledError(closure.reason, { workId })
    : new WorkFailedError(closure.reason, { workId });
}

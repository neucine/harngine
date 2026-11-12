import type {
  Agent as CoreAgent,
  AnyTool,
  AnyWorkflow,
  Proposal,
  Tool as CoreTool,
  View,
} from './internal/contracts.js';
import { RuntimeError } from './internal/contracts.js';
import type { Json, Schema } from './types.js';
import type {
  ContextConfiguration,
  ModelAdapter,
  ModelItem,
  ModelRequest,
  ModelResponse,
} from './model.js';
import { digest, identity, key, schema, tool as coreTool, validate, workflow } from './schema.js';
import type { Tool as PublicTool } from './tool.js';
import { toolIdentity } from './tool.js';
import type { Workflow as PublicWorkflow } from './workflow.js';
import { definitionRevision } from './build/manifest.js';
import { ContextEngine } from './internal/context-engine.js';
import { guardrailIdentity, type Guardrail } from './guardrail.js';

type AgentTool<I extends Json = Json, O extends Json = Json> = CoreTool<I, O> | PublicTool<I, O>;
export type AgentTarget<O extends Json = Json, R extends Json = Json> =
  | Agent<O, R>
  | PublicWorkflow<O, R>;

export interface AgentDelegate<O extends Json = Json, R extends Json = Json> {
  readonly target: AgentTarget<O, R>;
  readonly description: string;
  readonly mode?: 'sequential' | 'concurrent';
}

export interface AgentDefinition<O extends Json, R extends Json = string> {
  readonly id: string;
  readonly instructions: string | readonly string[];
  readonly objective: Schema<O>;
  readonly result?: Schema<R>;
  readonly model: ModelAdapter;
  readonly tools?: readonly AgentTool<any, any>[];
  readonly delegates?: readonly AgentDelegate<any, any>[];
  readonly limits?: {
    readonly modelTurns?: number;
    readonly toolExecutions?: number;
    readonly childWork?: number;
  };
  readonly context?: ContextConfiguration;
  readonly guardrails?: readonly Guardrail[];
  readonly publish?: false | ((result: R) => Json);
}

export interface Agent<O extends Json = Json, R extends Json = Json> {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly instructions: readonly string[];
  readonly objective: Schema<O>;
  readonly result: Schema<R>;
  readonly model: ModelAdapter;
  readonly tools: readonly AgentTool<any, any>[];
  readonly delegates: readonly AgentDelegate<any, any>[];
  readonly limits: {
    readonly modelTurns: number;
    readonly toolExecutions: number;
    readonly childWork: number;
  };
  readonly context: Required<Pick<ContextConfiguration, 'reserveForOutput' | 'maxInputTokens'>> &
    Pick<ContextConfiguration, 'session' | 'policy'>;
  readonly guardrails: readonly Guardrail[];
  readonly publish: false | ((result: R) => Json);
  readonly __objective?: O;
  readonly __result?: R;
}

type State = { phase: 'model' | 'tools'; turn: number; toolIndex: number } & Json;
type Internals = { workflow: AnyWorkflow; tools: readonly (AnyTool | PublicTool<any, any>)[] };
const internalDefinitions = new WeakMap<object, Internals>();

const objectSchema = (properties: Record<string, Json>, required: string[]): Json => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

function responseSchema(
  id: string,
  version: string,
  callables: readonly { readonly id: string; readonly input: Schema }[],
): Schema<Json> {
  const toolCalls = callables.map((selected) =>
    objectSchema(
      {
        type: { const: 'tool-call' },
        providerCallId: { type: 'string', minLength: 1 },
        tool: { const: selected.id },
        input: selected.input.jsonSchema,
      },
      ['type', 'providerCallId', 'tool', 'input'],
    ),
  );
  return schema<Json>({
    id: `${id}.model-response`,
    version,
    jsonSchema: objectSchema(
      {
        object: { const: 'model_response' },
        items: {
          type: 'array',
          items: {
            oneOf: [
              objectSchema({ type: { const: 'text' }, text: { type: 'string' } }, ['type', 'text']),
              ...toolCalls,
              objectSchema({ type: { const: 'data' }, value: {} }, ['type', 'value']),
            ],
          },
        },
        finishReason: {
          enum: ['stop', 'tool-calls', 'length', 'content-filter', 'other'],
        },
        usage: { type: 'object' },
        provider: { type: 'object' },
      },
      ['object', 'items', 'finishReason'],
    ),
  });
}

function normalizedModelResponse(response: ModelResponse): ModelResponse {
  if (!response.usage) return response;
  const usage = response.usage;
  for (const value of [usage.inputTokens, usage.outputTokens, usage.totalTokens])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw new RuntimeError('MODEL_USAGE', 'Model token usage must be nonnegative integers');
  if (
    usage.cost &&
    (!Number.isSafeInteger(usage.cost.amountMicros) ||
      usage.cost.amountMicros < 0 ||
      !usage.cost.currency.trim())
  )
    throw new RuntimeError('MODEL_USAGE', 'Model cost requires nonnegative micros and a currency');
  const totalTokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return {
    ...response,
    usage: { ...usage, totalTokens },
  };
}

export function agent<O extends Json>(
  definition: AgentDefinition<O, string> & { readonly result?: undefined },
): Agent<O, string>;
export function agent<O extends Json, R extends Json>(
  definition: AgentDefinition<O, R> & {
    readonly result: Schema<R>;
    readonly publish: false | ((result: R) => Json);
  },
): Agent<O, R>;
export function agent<O extends Json, R extends Json>(
  definition: AgentDefinition<O, R>,
): Agent<O, R> {
  const configured = definition;
  const instructions = Object.freeze(
    (typeof definition.instructions === 'string'
      ? [definition.instructions]
      : [...definition.instructions]
    ).map((value) => value.trim()),
  );
  if (!instructions.length || instructions.some((value) => !value))
    throw new RuntimeError('INVALID_DEFINITION', 'Agent instructions are required');
  if (!definition.id || definition.id.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Agent id must contain 1–256 characters');
  if (!definition.model.id || definition.model.id.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Model adapter id must contain 1–256 characters');
  const tools = definition.tools ?? [];
  if (tools.some((selected) => !selected.description?.trim()))
    throw new RuntimeError('INVALID_DEFINITION', 'Every model-facing Tool needs a description');
  if (new Set(tools.map((selected) => key(toolIdentity(selected)))).size !== tools.length)
    throw new RuntimeError('REGISTRATION_CONFLICT', 'Agent Tools must be unique');
  const delegates = definition.delegates ?? [];
  if (
    delegates.some(
      (delegate) =>
        !delegate.description?.trim() ||
        !['sequential', 'concurrent'].includes(delegate.mode ?? 'sequential'),
    )
  )
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'Every Agent delegate needs a description and supported mode',
    );
  if (new Set(delegates.map((delegate) => delegate.target.id)).size !== delegates.length)
    throw new RuntimeError('REGISTRATION_CONFLICT', 'Agent delegates must be unique');
  const guardrails = definition.guardrails ?? [];
  if (
    new Set(guardrails.map((item) => `${item.id}\0${item.revision}`)).size !== guardrails.length ||
    guardrails.some((item) => item.stages.some((stage) => !stage.startsWith('model-')))
  )
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'Agent guardrails must be unique and use model input/output stages',
    );
  const callableIds = [
    ...tools.map((selected) => selected.id),
    ...delegates.map((selected) => selected.target.id),
  ];
  if (new Set(callableIds).size !== callableIds.length)
    throw new RuntimeError('REGISTRATION_CONFLICT', 'Agent Tool and delegate ids must be unique');
  if (callableIds.length && !definition.model.capabilities.tools)
    throw new RuntimeError('UNSUPPORTED_MODEL', 'Model adapter does not support native Tool calls');
  if (definition.result && !definition.model.capabilities.structuredOutput)
    throw new RuntimeError('UNSUPPORTED_MODEL', 'Model adapter does not support structured output');
  if (definition.result && definition.publish === undefined)
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'An Agent with a structured result must declare publish or disable publication',
    );
  const limits = {
    modelTurns: configured.limits?.modelTurns ?? 50,
    toolExecutions: configured.limits?.toolExecutions ?? 100,
    childWork: configured.limits?.childWork ?? 100,
  };
  if (
    !Number.isSafeInteger(limits.modelTurns) ||
    limits.modelTurns < 1 ||
    !Number.isSafeInteger(limits.toolExecutions) ||
    limits.toolExecutions < 1 ||
    !Number.isSafeInteger(limits.childWork) ||
    limits.childWork < 1
  )
    throw new RuntimeError('INVALID_POLICY', 'Agent limits must be positive finite integers');
  const context = {
    session: configured.context?.session ?? { recent: 20 },
    reserveForOutput:
      configured.context?.reserveForOutput ??
      definition.model.capabilities.defaultOutputReserve ??
      4_000,
    maxInputTokens:
      configured.context?.maxInputTokens ??
      Math.max(
        1,
        (definition.model.capabilities.contextWindow ?? 32_768) -
          (configured.context?.reserveForOutput ??
            definition.model.capabilities.defaultOutputReserve ??
            4_000),
      ),
    ...(configured.context?.policy ? { policy: configured.context.policy } : {}),
  };
  if (
    !Number.isSafeInteger(context.reserveForOutput) ||
    context.reserveForOutput < 0 ||
    !Number.isSafeInteger(context.maxInputTokens) ||
    context.maxInputTokens < 1 ||
    (context.session !== false &&
      (!Number.isSafeInteger(context.session.recent) || context.session.recent < 0))
  )
    throw new RuntimeError('INVALID_POLICY', 'Agent context limits must be finite integers');
  if (
    definition.model.tokenizer &&
    (!definition.model.tokenizer.id || typeof definition.model.tokenizer.count !== 'function')
  )
    throw new RuntimeError('INVALID_DEFINITION', 'Model tokenizer requires an id and count method');
  const contextEngine = new ContextEngine({
    maxInputTokens: context.maxInputTokens,
    ...(context.policy ? { policy: context.policy } : {}),
    ...(definition.model.tokenizer
      ? {
          countTokens: definition.model.tokenizer.count,
          accountingId: definition.model.tokenizer.id,
        }
      : {}),
  });
  const modelArtifact = digest({
    id: definition.model.id,
    capabilities: definition.model.capabilities,
    tokenizer: definition.model.tokenizer?.id ?? null,
  });
  const revision = definitionRevision('agent', definition.id, {
    id: definition.id,
    instructions,
    objective: definition.objective,
    result: definition.result?.jsonSchema ?? { type: 'string' },
    model: { id: definition.model.id, artifactDigest: modelArtifact },
    tools: tools.map(toolIdentity),
    guardrails: guardrails.map(guardrailIdentity),
    delegates: delegates.map((delegate) => ({
      target: { id: delegate.target.id, version: delegate.target.revision },
      description: delegate.description,
      mode: delegate.mode ?? 'sequential',
    })),
    limits,
    context: {
      session: context.session,
      reserveForOutput: context.reserveForOutput,
      maxInputTokens: context.maxInputTokens,
      policy: context.policy?.id ?? null,
      accounting: definition.model.tokenizer?.id ?? 'harngine.utf8-estimate-v1',
    },
    publish:
      definition.publish === false ? false : definition.publish ? 'presentation' : 'text-default',
  });
  const artifactDigest = revision.slice(4);
  const resultContract = (definition.result ??
    schema<string>({
      id: `${definition.id}.result`,
      version: revision,
      jsonSchema: { type: 'string' },
    })) as Schema<R>;
  const modelOutput = responseSchema(definition.id, revision, [
    ...tools.map((selected) => ({ id: selected.id, input: selected.input })),
    ...delegates.map((delegate) => ({ id: delegate.target.id, input: delegate.target.objective })),
  ]);
  const modelInput = schema<Json>({
    id: `${definition.id}.model-request`,
    version: revision,
    jsonSchema: { type: 'object' },
  });
  const modelTool = coreTool<Json, Json>({
    id: `${definition.id}.model`,
    version: revision,
    artifactDigest: modelArtifact,
    input: modelInput,
    output: modelOutput,
    effect: 'read',
    category: 'model',
    ...(guardrails.length ? { guardrails } : {}),
    async invoke({ input, signal, progress }) {
      try {
        const generated = await configured.model.generate(input as unknown as ModelRequest, {
          signal,
          emit: () => {},
          ...(progress ? { progress } : {}),
        });
        const response = normalizedModelResponse(generated);
        return { status: 'success', value: validate(modelOutput, response as unknown as Json) };
      } catch (error) {
        const interrupted = signal.aborted;
        return {
          status: 'failure',
          effect: 'none',
          reason: {
            code: interrupted ? 'MODEL_INTERRUPTED' : 'MODEL_FAILED',
            message: interrupted
              ? 'Model request was interrupted'
              : error instanceof Error
                ? error.message
                : 'Model generation failed',
          },
        };
      }
    },
  });
  const result: Agent<O, R> = Object.freeze({
    id: definition.id,
    revision,
    instructions,
    objective: definition.objective,
    result: resultContract,
    model: definition.model,
    tools: Object.freeze([...tools]),
    delegates: Object.freeze([...delegates]),
    limits: Object.freeze(limits),
    context: Object.freeze(context),
    guardrails: Object.freeze([...guardrails]),
    publish:
      definition.publish === false ? false : (definition.publish ?? ((value: R) => value as Json)),
  });
  const state = schema<State>({
    id: `${definition.id}.agent-state-v2`,
    version: revision,
    jsonSchema: objectSchema(
      {
        phase: { enum: ['model', 'tools'] },
        turn: { type: 'integer', minimum: 0 },
        toolIndex: { type: 'integer', minimum: 0 },
      },
      ['phase', 'turn', 'toolIndex'],
    ),
  });
  const toolById = new Map(tools.map((selected) => [selected.id, selected]));
  const delegateById = new Map(delegates.map((selected) => [selected.target.id, selected]));
  const request = (view: View): Json => {
    const catalog: ModelRequest['tools'] = [
      ...tools.map((selected) => ({
        id: selected.id,
        kind: 'tool' as const,
        description: selected.description!,
        inputSchema: selected.input.jsonSchema,
        outputSchema: selected.output.jsonSchema,
      })),
      ...delegates.map((delegate) => ({
        id: delegate.target.id,
        kind: 'instructions' in delegate.target ? ('agent' as const) : ('workflow' as const),
        description: delegate.description,
        inputSchema: delegate.target.objective.jsonSchema,
        outputSchema: delegate.target.result.jsonSchema,
      })),
    ];
    const base = {
      instructions,
      objective: view.objective,
      tools: catalog,
      ...(definition.result ? { result: definition.result.jsonSchema } : {}),
    } as unknown as Json;
    const turn =
      view.state && typeof view.state === 'object' && 'turn' in view.state
        ? Number(view.state.turn)
        : 0;
    return {
      object: 'model_request',
      instructions: [...instructions],
      context: contextEngine.resolve(view, base, turn),
      tools: catalog,
      ...(definition.result ? { result: definition.result.jsonSchema } : {}),
    } as unknown as Json;
  };
  const compiled = workflow<O, State, R>({
    id: definition.id,
    version: revision,
    artifactDigest,
    objective: definition.objective,
    state,
    result: resultContract,
    input: { schema: definition.objective, maxPending: 100, batchSize: 100 },
    policy: {
      maxDecisions: limits.modelTurns + limits.toolExecutions + 1,
      maxAttempts: limits.modelTurns + limits.toolExecutions,
      maxModelTurns: limits.modelTurns,
      maxToolExecutions: limits.toolExecutions,
      maxChildWork: limits.childWork,
    },
    tools: [identity(modelTool), ...tools.map(toolIdentity)],
    children: delegates.map((delegate) => ({
      id: delegate.target.id,
      version: delegate.target.revision,
    })),
    initial: () => ({ phase: 'model', turn: 0, toolIndex: 0 }),
    decide(view): Proposal<State, R> {
      const finish = (proposal: Proposal<State, R>): Proposal<State, R> => ({
        ...proposal,
        dispositions: view.inputs.map((input) => ({
          id: input.id,
          status: 'incorporated' as const,
        })),
      });
      const modelSlot = `model:${view.state.turn}`;
      if (view.inputs.length && view.calls[modelSlot]) {
        const nextTurn = view.state.turn + 1;
        return finish({
          type: 'call',
          state: { phase: 'model', turn: nextTurn, toolIndex: 0 },
          call: {
            slot: `model:${nextTurn}`,
            tool: identity(modelTool),
            input: request(view),
          },
        });
      }
      const modelCall = view.calls[modelSlot];
      if (!modelCall)
        return finish({
          type: 'call',
          state: view.state,
          call: {
            slot: modelSlot,
            tool: identity(modelTool),
            input: request(view),
          },
        });
      if (!modelCall.outcome) return finish({ type: 'wait', state: view.state });
      if (modelCall.outcome.status !== 'success') {
        if (modelCall.outcome.reason.code === 'MODEL_INTERRUPTED') {
          const nextTurn = view.state.turn + 1;
          return finish({
            type: 'call',
            state: { phase: 'model', turn: nextTurn, toolIndex: 0 },
            call: {
              slot: `model:${nextTurn}`,
              tool: identity(modelTool),
              input: request({
                ...view,
                state: { phase: 'model', turn: nextTurn, toolIndex: 0 },
              }),
            },
          });
        }
        return finish({ type: 'fail', reason: modelCall.outcome.reason });
      }
      const saved = modelCall.outcome.value as unknown as ModelResponse;
      const calls = saved.items.filter(
        (item): item is Extract<ModelItem, { type: 'tool-call' }> => item.type === 'tool-call',
      );
      if (new Set(calls.map((call) => call.providerCallId)).size !== calls.length)
        return finish({
          type: 'fail',
          reason: {
            code: 'MODEL_FAILED',
            message: 'Model response contains duplicate provider call ids',
          },
        });
      if (view.state.toolIndex < calls.length) {
        const call = calls[view.state.toolIndex]!;
        const selected = toolById.get(call.tool);
        const delegate = delegateById.get(call.tool);
        if (!selected && !delegate)
          return finish({
            type: 'fail',
            reason: {
              code: 'MODEL_FAILED',
              message: `Model selected unexposed target ${call.tool}`,
            },
          });
        if (delegate) {
          const slot = `delegate:${view.state.turn}:${call.providerCallId}`;
          if (!view.children[slot])
            return finish({
              type: 'child',
              state: {
                phase: 'tools',
                turn: view.state.turn,
                toolIndex: view.state.toolIndex + 1,
              },
              child: {
                slot,
                definition: {
                  id: delegate.target.id,
                  version: delegate.target.revision,
                },
                objective: call.input,
                mode: delegate.mode ?? 'sequential',
              },
            });
        }
        const slot = `tool:${view.state.turn}:${call.providerCallId}`;
        if (!selected)
          return finish({
            type: 'fail',
            reason: { code: 'MODEL_FAILED', message: `Model selected unknown Tool ${call.tool}` },
          });
        if (!view.calls[slot])
          return finish({
            type: 'call',
            state: { phase: 'tools', turn: view.state.turn, toolIndex: view.state.toolIndex + 1 },
            call: { slot, tool: toolIdentity(selected), input: call.input },
          });
      }
      if (Object.values(view.children).some((child) => child.closure === null))
        return finish({ type: 'wait', state: view.state });
      if (calls.length)
        return finish({
          type: 'call',
          state: { phase: 'model', turn: view.state.turn + 1, toolIndex: 0 },
          call: {
            slot: `model:${view.state.turn + 1}`,
            tool: identity(modelTool),
            input: request(view),
          },
        });
      const data = saved.items.find(
        (item): item is Extract<ModelItem, { type: 'data' }> => item.type === 'data',
      );
      if (definition.result && data) return finish({ type: 'complete', result: data.value as R });
      const text = saved.items
        .filter((item): item is Extract<ModelItem, { type: 'text' }> => item.type === 'text')
        .map((item) => item.text)
        .join('');
      if (!definition.result && text) return finish({ type: 'complete', result: text as R });
      return finish({
        type: 'fail',
        reason: { code: 'MODEL_FAILED', message: 'Model produced no usable result' },
      });
    },
  });
  internalDefinitions.set(result, {
    workflow: compiled as unknown as AnyWorkflow,
    tools: [modelTool, ...tools],
  });
  return result;
}

export function agentCompilation(value: unknown): Internals | undefined {
  return value && typeof value === 'object' ? internalDefinitions.get(value) : undefined;
}

export function agentIdentity(value: CoreAgent | Agent): { id: string; version: string } {
  const internal = agentCompilation(value);
  return internal ? identity(internal.workflow) : identity(value as CoreAgent);
}

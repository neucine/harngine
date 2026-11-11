import {
  RuntimeError,
  type Agent,
  type AgentModel,
  type AnyTool,
  type Tool,
  type ContextItem,
  type Identity,
  type InputDisposition,
  type Json,
  type ModelContext,
  type Schema,
  type Workflow,
} from './contracts.js';
import { digest, frozen, identity, key, schema, workflow, tool, validate } from '../schema.js';
import { exact } from './core.js';

export interface AgentDefinition<O extends Json, R extends Json = string, I extends Json = Json> {
  readonly id: string;
  readonly version: string;
  readonly artifactDigest: string;
  readonly instructions: string;
  readonly objective: Schema<O>;
  /** Omit for an ordinary text result; provide a Schema for structured output. */
  readonly result?: Schema<R>;
  readonly input?: Agent<O, R, I>['input'];
  /** Model-provider integration. Harngine generates and validates its response contract. */
  readonly model: AgentModel;
  readonly tools?: readonly AnyTool[];
  readonly policy: Agent<O, R, I>['policy'];
  readonly context?: { readonly maxEntries: number };
  readonly reply?: Agent<O, R, I>['reply'];
}

type State = {
  phase: 'model' | 'interpret' | 'reply';
  turn: number;
  revision: number;
  modelSlot?: string;
  waitSlot?: string;
  question?: string;
};
type ModelCall = { request: ModelContext; responseSchema: Json; ordinal: number };
type AgentResponse<R extends Json = Json> =
  | ({ readonly type: 'call'; readonly tool: Identity & Json; readonly input: Json } & Json)
  | ({ readonly type: 'ask'; readonly question: string } & Json)
  | ({ readonly type: 'complete'; readonly result: R } & Json)
  | ({
      readonly type: 'fail';
      readonly reason: { readonly code: string; readonly message: string } & Json;
    } & Json);
const internals = new WeakMap<
  object,
  { workflow: Workflow<any, State, any, any>; tools: readonly AnyTool[] }
>();

const object = (properties: Record<string, Json>, required = Object.keys(properties)): Json => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const text: Json = { type: 'string', minLength: 1, maxLength: 10_000 };
const literal = (value: string): Json => ({ type: 'string', enum: [value] });

function responseContract(
  id: string,
  version: string,
  result: Schema,
  tools: readonly AnyTool[],
  canAsk: boolean,
): Schema<Json> {
  const variants: Json[] = [];
  for (const tool of tools)
    variants.push(
      object({
        type: literal('call'),
        tool: object({ id: literal(tool.id), version: literal(tool.version) }),
        input: tool.input.jsonSchema,
      }),
    );
  if (canAsk) variants.push(object({ type: literal('ask'), question: text }));
  variants.push(object({ type: literal('complete'), result: result.jsonSchema }));
  variants.push(object({ type: literal('fail'), reason: object({ code: text, message: text }) }));
  return schema({
    id: `${id}.model-response`,
    version,
    jsonSchema: object({ response: { anyOf: variants } }),
  });
}

function modelTool<O extends Json>(
  definition: AgentDefinition<O, any, any>,
  response: Schema<Json>,
  tools: readonly AnyTool[],
): Tool<Json, Json> {
  const input = schema<Json>({
    id: `${definition.id}.model-input`,
    version: definition.version,
    jsonSchema: object({
      request: { type: 'object' },
      responseSchema: { type: 'object' },
      ordinal: { type: 'integer', minimum: 0 },
    }),
  });
  return tool({
    id: `${definition.id}.model`,
    version: definition.version,
    artifactDigest: digest({
      protocol: 'harngine-agent-model-v1',
      adapter: definition.model.artifactDigest,
      response: response.jsonSchema,
      tools: tools.map((tool) => [tool.id, tool.version, tool.artifactDigest]),
    }),
    description: 'Invoke the configured model using Harngine’s generated Agent response contract.',
    input,
    output: response,
    effect: 'read',
    invoke: async ({ input, operationId, attemptId, signal }) => {
      const call = input as unknown as ModelCall;
      const outcome = await definition.model.invoke({
        input: call.request,
        responseSchema: call.responseSchema,
        ordinal: call.ordinal,
        operationId,
        attemptId,
        signal,
      });
      if (outcome.status !== 'success') return outcome;
      try {
        return { status: 'success' as const, value: validate(response, outcome.value) };
      } catch (error) {
        return {
          status: 'failure' as const,
          effect: 'none' as const,
          reason: {
            code: 'MODEL_RESPONSE',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  });
}

function dispositions(inputs: readonly { id: string }[]): readonly InputDisposition[] {
  return inputs.map((input) => ({ id: input.id, status: 'incorporated' as const }));
}
function response<R extends Json>(value: Json): AgentResponse<R> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RuntimeError('MODEL_PROTOCOL', 'Model must return a response envelope');
  exact(value, ['response']);
  const candidate = value.response;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    typeof candidate.type !== 'string'
  )
    throw new RuntimeError('MODEL_PROTOCOL', 'Model must return a supported response');
  if (candidate.type === 'call') {
    exact(candidate, ['type', 'tool', 'input']);
    if (!candidate.tool || typeof candidate.tool !== 'object' || Array.isArray(candidate.tool))
      throw new RuntimeError('MODEL_PROTOCOL', 'Call response requires a tool identity');
    exact(candidate.tool, ['id', 'version']);
    identity(candidate.tool as unknown as Identity);
  } else if (candidate.type === 'ask') {
    exact(candidate, ['type', 'question']);
    if (
      typeof candidate.question !== 'string' ||
      !candidate.question.trim() ||
      candidate.question.length > 10_000
    )
      throw new RuntimeError('MODEL_PROTOCOL', 'Ask response requires a bounded question');
  } else if (candidate.type === 'complete') exact(candidate, ['type', 'result']);
  else if (candidate.type === 'fail') {
    exact(candidate, ['type', 'reason']);
    if (
      !candidate.reason ||
      typeof candidate.reason !== 'object' ||
      Array.isArray(candidate.reason)
    )
      throw new RuntimeError('MODEL_PROTOCOL', 'Fail response requires a reason');
    exact(candidate.reason, ['code', 'message']);
    if (
      typeof candidate.reason.code !== 'string' ||
      !candidate.reason.code ||
      typeof candidate.reason.message !== 'string' ||
      !candidate.reason.message
    )
      throw new RuntimeError('MODEL_PROTOCOL', 'Fail response requires a reason code and message');
  } else throw new RuntimeError('MODEL_PROTOCOL', 'Unknown model response type');
  return candidate as AgentResponse<R>;
}

function selectedContext(values: readonly Json[]): ContextItem[] {
  return values.map((value, index) => {
    const source = { type: 'work_context' as const, index };
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.type === 'input' &&
      'content' in value
    )
      return { type: 'input', content: value.content, source };
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.type === 'output' &&
      'content' in value
    )
      return { type: 'output', content: value.content, source };
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.type === 'result' &&
      'closure' in value
    ) {
      const closure = value.closure;
      return {
        type: 'result',
        content:
          closure &&
          typeof closure === 'object' &&
          !Array.isArray(closure) &&
          closure.status === 'completed' &&
          'result' in closure
            ? closure.result
            : closure,
        source,
      };
    }
    return { type: 'reference', content: value, source };
  }) as ContextItem[];
}

/** Define a protocol-level Agent fixture for execution-core conformance tests. */
export function agent<O extends Json, I extends Json = Json>(
  definition: AgentDefinition<O, string, I> & { readonly result?: undefined },
): Agent<O, string, I>;
export function agent<O extends Json, R extends Json, I extends Json = Json>(
  definition: AgentDefinition<O, R, I> & { readonly result: Schema<R> },
): Agent<O, R, I>;
export function agent<O extends Json, R extends Json, I extends Json = Json>(
  definition: AgentDefinition<O, R, I>,
): Agent<O, R, I> {
  if (
    Object.keys(definition).some(
      (k) =>
        ![
          'id',
          'version',
          'artifactDigest',
          'instructions',
          'objective',
          'result',
          'input',
          'model',
          'tools',
          'policy',
          'context',
          'reply',
        ].includes(k),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported Agent configuration');
  identity(definition);
  identity(definition.model);
  if (
    !definition.artifactDigest ||
    !definition.instructions.trim() ||
    !definition.model.artifactDigest
  )
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'Agent requires instructions, model identity and artifact digests',
    );
  const context = definition.context ?? { maxEntries: 20 };
  if (
    !Number.isSafeInteger(context.maxEntries) ||
    context.maxEntries < 0 ||
    context.maxEntries > 100
  )
    throw new RuntimeError('INVALID_POLICY', 'Agent context maxEntries must be from 0 to 100');
  const tools = definition.tools ?? [];
  if (new Set(tools.map((tool) => key(identity(tool)))).size !== tools.length)
    throw new RuntimeError('REGISTRATION_CONFLICT', 'Agent tools must be unique');
  if (tools.some((tool) => !tool.description?.trim()))
    throw new RuntimeError(
      'INVALID_DEFINITION',
      'Every Tool exposed by an Agent requires a description',
    );
  const resultContract = (definition.result ??
    schema<string>({
      id: `${definition.id}.result`,
      version: definition.version,
      jsonSchema: { type: 'string' },
    })) as Schema<R>;
  const modelResponse = responseContract(
    definition.id,
    definition.version,
    resultContract,
    tools,
    definition.reply !== undefined,
  );
  const model = modelTool(definition, modelResponse, tools);
  const refs = [identity(model), ...tools.map(identity)];
  if (new Set(refs.map(key)).size !== refs.length)
    throw new RuntimeError('REGISTRATION_CONFLICT', 'Agent tools must be unique');
  const stateSchema = schema<State & Json>({
    id: `${definition.id}.agent-state`,
    version: definition.version,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['phase', 'turn', 'revision'],
      properties: {
        phase: { enum: ['model', 'interpret', 'reply'] },
        turn: { type: 'integer', minimum: 0 },
        revision: { type: 'integer', minimum: 1 },
        modelSlot: { type: 'string' },
        waitSlot: { type: 'string' },
        question: { type: 'string' },
      },
    },
  });
  const replySchemas = definition.reply ? [definition.reply.schema] : undefined;
  const request = (
    view: { objective: Json; context: readonly Json[] },
    turn: number,
    items: ContextItem[],
  ) =>
    ({
      instructions: definition.instructions,
      objective: view.objective,
      turn,
      items,
      tools: tools.map((tool) => ({
        id: tool.id,
        version: tool.version,
        description: tool.description!,
        effect: tool.effect,
        inputSchema: tool.input.jsonSchema,
        outputSchema: tool.output.jsonSchema,
      })),
    }) as ModelContext;
  const compiled = workflow<O, State & Json, R, I>({
    id: definition.id,
    version: definition.version,
    artifactDigest: definition.artifactDigest,
    objective: definition.objective,
    state: stateSchema,
    result: resultContract,
    ...(definition.input ? { input: definition.input } : {}),
    ...(replySchemas ? { replySchemas } : {}),
    policy: definition.policy,
    tools: refs,
    initial: () => ({ phase: 'model', turn: 0, revision: 1 }),
    decide: (view) => {
      const state =
        view.state.revision === view.objectiveRevision
          ? view.state
          : { phase: 'model' as const, turn: 0, revision: view.objectiveRevision };
      const ds = dispositions(view.inputs);
      const items: ContextItem[] = [
        ...selectedContext(view.context),
        ...Object.values(view.calls)
          .filter(
            (call) =>
              call.objectiveRevision === view.objectiveRevision &&
              key(call.tool) !== key(model) &&
              call.outcome !== null,
          )
          .map(
            (call) =>
              ({
                type: 'tool_outcome' as const,
                call: {
                  id: call.id,
                  slot: call.slot,
                  tool: { id: call.tool.id, version: call.tool.version },
                  input: call.input,
                },
                outcome: call.outcome!,
                source: { type: 'work_call' as const, id: call.id },
              }) as ContextItem,
          ),
        ...view.inputs.map(
          (input) =>
            ({
              type: 'input' as const,
              content: input.payload,
              source: { type: 'work_input' as const, id: input.id },
            }) as ContextItem,
        ),
      ];
      if (state.phase === 'model') {
        const slot = `r${view.objectiveRevision}:model:${state.turn}`;
        return {
          type: 'call',
          state: {
            phase: 'interpret',
            turn: state.turn,
            revision: view.objectiveRevision,
            modelSlot: slot,
          },
          call: {
            slot,
            tool: identity(model),
            input: {
              request: request(view, state.turn, items),
              responseSchema: modelResponse.jsonSchema,
              ordinal: state.turn,
            },
          },
          dispositions: ds,
        };
      }
      if (state.phase === 'reply') {
        const wait = view.waits[state.waitSlot!];
        if (!wait)
          return {
            type: 'fail',
            reason: { code: 'REPLY_UNAVAILABLE', message: 'The requested reply wait is missing' },
            dispositions: ds,
          };
        if (wait.status === 'pending')
          return {
            type: 'wait',
            state,
            until: { type: 'existing', slot: wait.slot },
            dispositions: ds,
          };
        if (wait.status !== 'replied')
          return {
            type: 'fail',
            reason: { code: 'REPLY_UNAVAILABLE', message: 'The requested reply was not received' },
            dispositions: ds,
          };
        const slot = `r${view.objectiveRevision}:model:${state.turn}`;
        const replyItem = {
          type: 'reply' as const,
          question: state.question!,
          content: wait.payload,
          source: { type: 'reply' as const, waitId: wait.wait.id },
        } as ContextItem;
        return {
          type: 'call',
          state: {
            phase: 'interpret',
            turn: state.turn,
            revision: view.objectiveRevision,
            modelSlot: slot,
          },
          call: {
            slot,
            tool: identity(model),
            input: {
              request: request(view, state.turn, [...items, replyItem]),
              responseSchema: modelResponse.jsonSchema,
              ordinal: state.turn,
            },
          },
          dispositions: ds,
        };
      }
      const modelOutcome = view.calls[state.modelSlot!]?.outcome ?? null;
      if (!modelOutcome)
        return {
          type: 'fail',
          reason: { code: 'MODEL_PROTOCOL', message: 'Model call has no outcome' },
          dispositions: ds,
        };
      if (modelOutcome.status !== 'success')
        return {
          type: 'fail',
          reason: { code: 'MODEL_FAILURE', message: modelOutcome.reason.message },
          dispositions: ds,
        };
      const proposal = response<R>(modelOutcome.value);
      if (proposal.type === 'complete')
        return { type: 'complete', result: proposal.result, dispositions: ds };
      if (proposal.type === 'fail')
        return { type: 'fail', reason: proposal.reason, dispositions: ds };
      if (proposal.type === 'ask') {
        if (!definition.reply)
          return {
            type: 'fail',
            reason: {
              code: 'REPLY_UNSUPPORTED',
              message: 'Agent did not declare a reply contract',
            },
            dispositions: ds,
          };
        const slot = `r${view.objectiveRevision}:reply:${state.turn}`;
        return {
          type: 'wait',
          state: {
            phase: 'reply',
            turn: state.turn + 1,
            revision: view.objectiveRevision,
            waitSlot: slot,
            question: proposal.question,
          },
          until: {
            type: 'reply',
            slot,
            schema: identity(definition.reply.schema),
            responders: definition.reply.responders,
            ...(definition.reply.timeoutMs ? { timeoutMs: definition.reply.timeoutMs } : {}),
          },
          dispositions: ds,
        };
      }
      if (!tools.some((tool) => key(tool) === key(proposal.tool)))
        return {
          type: 'fail',
          reason: { code: 'TOOL_UNAVAILABLE', message: 'Model proposed a tool outside this Agent' },
          dispositions: ds,
        };
      return {
        type: 'call',
        state: { phase: 'model', turn: state.turn + 1, revision: view.objectiveRevision },
        call: {
          slot: `r${view.objectiveRevision}:tool:${state.turn}`,
          tool: proposal.tool,
          input: proposal.input,
        },
        dispositions: ds,
      };
    },
  });
  const result = Object.freeze({
    id: definition.id,
    version: definition.version,
    artifactDigest: definition.artifactDigest,
    instructions: definition.instructions,
    objective: definition.objective,
    result: resultContract,
    ...(definition.input ? { input: definition.input } : {}),
    model: identity(model),
    modelResponse,
    tools: frozen(tools.map(identity)),
    policy: frozen({ ...definition.policy }),
    context: frozen({ ...context }),
    ...(definition.reply
      ? { reply: frozen({ ...definition.reply, responders: [...definition.reply.responders] }) }
      : {}),
  }) as Agent<O, R, I>;
  internals.set(result, { workflow: compiled, tools: Object.freeze([model, ...tools]) });
  return result;
}

export function agentInternals(value: unknown) {
  return value && typeof value === 'object' ? internals.get(value) : undefined;
}

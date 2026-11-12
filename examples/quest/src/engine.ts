import {
  agent,
  createApp,
  schema,
  tool,
  workflow,
  type Agent,
  type App,
  type Json,
  type ModelAdapter,
  type ModelResponse,
} from 'harngine';
import { type SourcedObject } from './world.js';
import { MetProvider } from './met-provider.js';

const text: Json = { type: 'string', minLength: 1, maxLength: 4000 };
const object = (properties: Record<string, Json>, required = Object.keys(properties)): Json => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const perspectiveObjective = schema<Json>({
  id: 'quest.perspective-objective',
  version: '2',
  jsonSchema: object({
    type: { enum: ['arrive', 'wander', 'return'] },
    objectId: { type: 'integer' },
    priorVisits: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
    echoes: { type: 'array', items: text, maxItems: 12 },
  }),
});
const perspectiveResult = schema<Json>({
  id: 'quest.perspective-result',
  version: '2',
  jsonSchema: object({
    message: text,
    question: text,
    objectId: { type: 'integer' },
    source: { type: 'object' },
  }),
});
const objectInput = schema<Json>({
  id: 'quest.object-input',
  version: '2',
  jsonSchema: object({ objectId: { type: 'integer' } }),
});
const sourcedObjectSchema = schema<Json>({
  id: 'quest.sourced-object',
  version: '2',
  jsonSchema: { type: 'object' },
});
const reactionObjective = schema<Json>({
  id: 'quest.reaction-objective',
  version: '2',
  jsonSchema: object({
    kind: { enum: ['interpretation', 'connection'] },
    text,
    objectIds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } },
  }),
});
const reactionResult = schema<Json>({
  id: 'quest.reaction-result',
  version: '2',
  jsonSchema: object({
    text,
    objectIds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } },
    sources: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object' } },
  }),
});

function perspectiveModel(): ModelAdapter {
  return {
    id: 'quest.perspective-keeper',
    capabilities: { tools: true, structuredOutput: true, streaming: false, contextWindow: 16_000 },
    async generate(request): Promise<ModelResponse> {
      const outcome = [...request.context.items]
        .reverse()
        .find((item) => item.type === 'tool_outcome');
      const objective = request.context.objective as {
        type: 'arrive' | 'wander' | 'return';
        objectId: number;
        priorVisits: number[];
        echoes: string[];
      };
      if (!outcome || outcome.type !== 'tool_outcome') {
        return {
          object: 'model_response',
          finishReason: 'tool-calls',
          items: [
            {
              type: 'tool-call',
              providerCallId: `object-${objective.objectId}`,
              tool: 'quest.read-world-object',
              input: { objectId: objective.objectId },
            },
          ],
          provider: { name: 'quest', model: 'perspective-keeper-v1' },
        };
      }
      if (outcome.outcome.status !== 'success')
        throw new Error('The collection record was unavailable');
      const sourced = outcome.outcome.value as unknown as SourcedObject;
      const item = sourced.object;
      const echo = objective.echoes[0];
      const returnLine =
        objective.type === 'return'
          ? echo
            ? ` While you were away, someone left this nearby: “${echo}”`
            : ' The constellation kept your path, quietly, for your return.'
          : echo
            ? ` Another visitor heard something adjacent: “${echo}”`
            : '';
      const historyLine = objective.priorVisits.length
        ? ` This is the ${objective.priorVisits.length + 1}${ordinalSuffix(objective.priorVisits.length + 1)} point on your path.`
        : '';
      const question = item.tags?.[0]?.term
        ? `What changes if you look at this through the motif “${item.tags[0].term}”?`
        : 'Which detail would you carry from this object into another room?';
      return {
        object: 'model_response',
        finishReason: 'stop',
        items: [
          {
            type: 'data',
            value: {
              message: `${item.title} holds the date “${item.objectDate}” in the ${item.department} collection.${historyLine}${returnLine}`,
              question,
              objectId: item.objectID,
              source: sourced.provenance,
            },
          },
        ],
        provider: { name: 'quest', model: 'perspective-keeper-v1' },
      };
    },
  };
}

function ordinalSuffix(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) return 'th';
  return value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
}

export interface QuestEngine {
  readonly app: App;
  readonly perspective: Agent<Json, Json>;
  readonly react: ReturnType<typeof workflow<Json, Json>>;
  close(): Promise<void>;
}

export function createQuestEngine(directory: string, provider: MetProvider): QuestEngine {
  const readObject = tool({
    id: 'quest.read-world-object',
    description: 'Read one bounded public-domain museum object with its provenance.',
    input: objectInput,
    output: sourcedObjectSchema,
    effect: 'read',
    execute: async (input, context) =>
      provider.object(
        Number((input as { objectId: number }).objectId),
        context.signal,
      ) as unknown as Json,
  });
  const inspectObject = workflow({
    id: 'quest.inspect-world-object',
    objective: objectInput,
    result: sourcedObjectSchema,
    tools: [readObject],
    run: (objective, flow) => flow.call('read-source', readObject, objective),
  });
  const react = workflow({
    id: 'quest.world-reaction',
    objective: reactionObjective,
    result: reactionResult,
    children: [inspectObject],
    async run(objective, flow) {
      const value = objective as { kind: string; text: string; objectIds: number[] };
      const results = (await flow.all(
        'listen-across-the-world',
        value.objectIds.map((objectId) => ({ definition: inspectObject, objective: { objectId } })),
      )) as unknown as SourcedObject[];
      const [left, right] = results;
      if (!left || !right)
        return flow.fail({
          code: 'WORLD_INCOMPLETE',
          message: 'The world could not hear both objects',
        });
      const verb =
        value.kind === 'connection'
          ? 'made a new path appear'
          : 'caused a faint correspondence to surface';
      return {
        text: `“${value.text}” ${verb} between ${left.object.title} and ${right.object.title}.`,
        objectIds: value.objectIds,
        sources: [left.provenance, right.provenance],
      };
    },
  });
  const perspective = agent({
    id: 'quest.perspective-keeper',
    instructions: [
      'Offer an open perspective on a museum object, not a task or answer.',
      'Use collection facts only from the Tool outcome. Visitor echoes are interpretations, not facts.',
      'Never declare completion, correctness, or a winning state.',
    ],
    objective: perspectiveObjective,
    result: perspectiveResult,
    publish: (value) => (value as { message: string }).message,
    model: perspectiveModel(),
    tools: [readObject],
    limits: { modelTurns: 3, toolExecutions: 1 },
    context: { session: { recent: 16 }, reserveForOutput: 900, maxInputTokens: 10_000 },
  });
  const app = createApp({
    directory,
    agents: [perspective],
    workflows: [inspectObject, react],
    tools: [readObject],
    access: { allowAuthenticated: true },
    limits: { operations: 50, toolExecutions: 12, modelTurns: 4 },
  });
  return { app, perspective, react, close: () => app.close() };
}

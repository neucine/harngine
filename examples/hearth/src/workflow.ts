import { schema, tool, workflow } from 'harngine';
import { buildHearthWorld, type HearthWorld, type HomeView } from './domain.js';
import { PublicDataClient, type PublicContext } from './public-data.js';

export type AttunementObjective = { viewer: 'alex' | 'sam'; home: HomeView };
const objective = schema<AttunementObjective>({
  id: 'hearth.attunement-objective',
  version: '2',
  jsonSchema: {},
});
const contextSchema = schema<PublicContext>({
  id: 'hearth.public-context',
  version: '2',
  jsonSchema: {},
});
const worldSchema = schema<HearthWorld>({ id: 'hearth.world', version: '2', jsonSchema: {} });
const clockInput = schema<null>({
  id: 'hearth.no-input',
  version: '1',
  jsonSchema: { type: 'null' },
});
const text = schema<string>({
  id: 'hearth.timestamp',
  version: '1',
  jsonSchema: { type: 'string', minLength: 1 },
});

export function hearthDefinitions(publicData: PublicDataClient) {
  const clock = tool({
    id: 'hearth.clock',
    description: 'Record when the home-world was quietly observed.',
    input: clockInput,
    output: text,
    effect: 'read',
    execute: () => new Date().toISOString(),
  });
  const surroundings = tool({
    id: 'hearth.surroundings',
    description:
      'Observe place, local weather and public context without sharing household memory.',
    input: schema<{ address: string; timezone: string; observedAt: string }>({
      id: 'hearth.surroundings-input',
      version: '2',
      jsonSchema: {},
    }),
    output: contextSchema,
    effect: 'read',
    execute: (input, context) =>
      publicData.context(input.address, input.timezone, input.observedAt, context.signal),
  });
  const attune = workflow({
    id: 'hearth.attune-home',
    objective,
    result: worldSchema,
    tools: [clock, surroundings],
    limits: { operations: 4, toolExecutions: 2 },
    async run(input, flow) {
      const observedAt = await flow.call('observation-time', clock, null);
      const context = await flow.call('surroundings', surroundings, {
        address: input.home.address,
        timezone: input.home.timezone,
        observedAt,
      });
      return buildHearthWorld(input.home, context);
    },
  });
  return { attune, tools: [clock, surroundings] };
}

import { schema, tool, workflow, type Json } from 'harngine';
import {
  buildJourneyWorlds,
  buildScoutNotes,
  type AtlasBrief,
  type AtlasResult,
  type GeographyResearch,
  type WeatherResearch,
} from './domain.js';
import type { TravelFactsProvider } from './providers.js';

const objectSchema: Json = { type: 'object', additionalProperties: true };
const briefSchema = schema<AtlasBrief>({
  id: 'roam.atlas-brief',
  version: '2',
  jsonSchema: objectSchema,
});
const geographySchema = schema<GeographyResearch>({
  id: 'roam.geography',
  version: '2',
  jsonSchema: objectSchema,
});
const weatherSchema = schema<WeatherResearch>({
  id: 'roam.weather',
  version: '2',
  jsonSchema: objectSchema,
});
const resultSchema = schema<AtlasResult>({
  id: 'roam.atlas-result',
  version: '2',
  jsonSchema: objectSchema,
});

export function roamDefinitions(provider: TravelFactsProvider) {
  const geography = tool({
    id: 'roam.observe-place',
    description: 'Keep the atlas grounded in named places and recorded geographic provenance.',
    input: briefSchema,
    output: geographySchema,
    effect: 'read',
    execute: (brief, context) => provider.geocode(brief.destinations, context.signal),
  });
  const weather = tool({
    id: 'roam.observe-weather',
    description:
      'Notice seasonal and near-term weather conditions without turning them into a funnel.',
    input: briefSchema,
    output: weatherSchema,
    effect: 'read',
    execute: (brief, context) =>
      provider.weather(brief.destinations, brief.startDate, brief.endDate, context.signal),
  });
  const geographyResearch = workflow({
    id: 'roam.place-scout',
    objective: briefSchema,
    result: geographySchema,
    tools: [geography],
    run: (brief, flow) => flow.call('observe-place', geography, brief),
  });
  const weatherResearch = workflow({
    id: 'roam.weather-scout',
    objective: briefSchema,
    result: weatherSchema,
    tools: [weather],
    run: (brief, flow) => flow.call('observe-weather', weather, brief),
  });
  const growAtlas = workflow({
    id: 'roam.grow-living-atlas',
    objective: briefSchema,
    result: resultSchema,
    tools: [],
    children: [geographyResearch, weatherResearch],
    async run(brief, flow): Promise<AtlasResult> {
      const [, weatherResult] = await flow.all('parallel-place-scouts', [
        { definition: geographyResearch, objective: brief },
        { definition: weatherResearch, objective: brief },
      ] as const);
      return {
        status: 'ready',
        worlds: buildJourneyWorlds(brief),
        scouts: buildScoutNotes(brief, weatherResult),
        observedAt: new Date().toISOString(),
      };
    },
  });
  return {
    geography,
    weather,
    geographyResearch,
    weatherResearch,
    growAtlas,
    all: [geography, weather] as const,
  };
}

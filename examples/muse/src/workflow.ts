import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApp, schema, tool, workflow, type App, type Json, type Workflow } from 'harngine';
import {
  assembleStudio,
  applyEditorialRevision,
  assertPublishable,
  contentHash,
  type PublicationReceipt,
  type ResearchBrief,
  type MuseObjective,
  type SourceEnvelope,
  type StudioDocument,
} from './domain.js';
import { readProvider } from './providers.js';

const objectSchema = (id: string) =>
  schema<Json>({ id, version: '1', jsonSchema: { type: 'object' } });
const arraySchema = (id: string) =>
  schema<Json>({ id, version: '1', jsonSchema: { type: 'array', items: { type: 'object' } } });
const briefSchema = schema<Json>({
  id: 'muse.research-brief',
  version: '3',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      question: { type: 'string', minLength: 12, maxLength: 500 },
      angle: { type: 'string', minLength: 12, maxLength: 800 },
      mode: { enum: ['replay', 'live'] },
      revision: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'integer', minimum: 1 },
          title: { type: 'string', minLength: 8, maxLength: 200 },
          dek: { type: 'string', minLength: 8, maxLength: 400 },
          selectedOutline: { type: 'string', minLength: 1, maxLength: 100 },
          draft: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'string', minLength: 12, maxLength: 4000 },
          },
        },
        required: ['revision', 'title', 'dek', 'selectedOutline', 'draft'],
      },
    },
    required: ['question', 'angle', 'mode'],
  },
});
const sourceListSchema = arraySchema('muse.source-list');
const studioSchema = objectSchema('muse.studio-document');
const publishInputSchema = objectSchema('muse.publish-input');
const receiptSchema = objectSchema('muse.publication-receipt');

const openAlex = tool({
  id: 'muse.read.openalex',
  description: 'Read OpenAlex with a live request or verified deterministic replay.',
  input: briefSchema,
  output: sourceListSchema,
  effect: 'read' as const,
  async execute(input) {
    return readProvider('openalex', input as unknown as ResearchBrief) as unknown as Json;
  },
});
const crossref = tool({
  id: 'muse.read.crossref',
  description: 'Read Crossref with a live request or verified deterministic replay.',
  input: briefSchema,
  output: sourceListSchema,
  effect: 'read' as const,
  async execute(input) {
    return readProvider('crossref', input as unknown as ResearchBrief) as unknown as Json;
  },
});
const commons = tool({
  id: 'muse.read.wikimedia-commons',
  description: 'Read one Wikimedia Commons file with per-file rights metadata.',
  input: briefSchema,
  output: sourceListSchema,
  effect: 'read' as const,
  async execute(input) {
    return readProvider('wikimedia-commons', input as unknown as ResearchBrief) as unknown as Json;
  },
});

const openAlexResearch = workflow({
  id: 'muse.research.openalex',
  objective: briefSchema,
  result: sourceListSchema,
  tools: [openAlex],
  run: (objective, flow) => flow.call('discover-and-relate', openAlex, objective),
});
const crossrefResearch = workflow({
  id: 'muse.research.crossref',
  objective: briefSchema,
  result: sourceListSchema,
  tools: [crossref],
  run: (objective, flow) => flow.call('canonical-metadata', crossref, objective),
});
const commonsResearch = workflow({
  id: 'muse.research.commons',
  objective: briefSchema,
  result: sourceListSchema,
  tools: [commons],
  run: (objective, flow) => flow.call('licensed-visual', commons, objective),
});

export interface MuseAppOptions {
  readonly directory: string;
  readonly publicationDirectory?: string;
}

function markdown(studio: StudioDocument): string {
  const body = studio.draft.map((paragraph) => paragraph.text).join('\n\n');
  const sources = studio.sources
    .map(
      (source) =>
        `- [${source.provider}: ${source.objectId}](${source.sourceUrl}) — ${source.rights}`,
    )
    .join('\n');
  return `# ${studio.title}\n\n_${studio.dek}_\n\n${body}\n\n## Sources and rights\n\n${sources}\n`;
}

export function createMuseApp(options: MuseAppOptions): {
  readonly app: App;
  readonly workflow: Workflow<Json, Json>;
} {
  const publicationDirectory = resolve(
    options.publicationDirectory ?? resolve(options.directory, 'publications'),
  );
  const publish = tool({
    id: 'muse.publish.local',
    description: 'Publish the exactly approved editorial package to the local public-demo outbox.',
    input: publishInputSchema,
    output: receiptSchema,
    effect: 'write',
    capabilities: { idempotency: 'operation-key', reversibility: 'reversible' },
    async execute(input, context) {
      const studio = input as unknown as StudioDocument;
      assertPublishable(studio);
      const payload = markdown(studio);
      const hash = contentHash(payload);
      const file = resolve(publicationDirectory, `${context.idempotencyKey}.md`);
      await mkdir(dirname(file), { recursive: true });
      try {
        const existing = await readFile(file, 'utf8');
        if (existing !== payload)
          context.effectUnknown({
            code: 'PUBLICATION_COLLISION',
            message: 'The operation key already identifies different content.',
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await writeFile(file, payload, { encoding: 'utf8', flag: 'wx' });
      }
      return {
        target: 'local',
        objectId: context.idempotencyKey,
        url: `file://${file}`,
        contentHash: hash,
        publishedAt: new Date().toISOString(),
      } satisfies PublicationReceipt;
    },
  });
  const workflowWithPublisher = workflow({
    id: 'muse.create-publication',
    objective: briefSchema,
    result: studioSchema,
    children: [openAlexResearch, crossrefResearch, commonsResearch],
    tools: [publish],
    async run(objective, flow) {
      const museObjective = objective as unknown as MuseObjective;
      const brief: ResearchBrief = {
        question: museObjective.question,
        angle: museObjective.angle,
        mode: museObjective.mode,
      };
      const values = await flow.all('parallel-research', [
        { definition: openAlexResearch, objective },
        { definition: crossrefResearch, objective },
        { definition: commonsResearch, objective },
      ] as const);
      const sources = values.flat() as unknown as SourceEnvelope[];
      const studio = applyEditorialRevision(assembleStudio(brief, sources), museObjective.revision);
      assertPublishable(studio);
      await flow.approval('approve-publication', {
        action: 'Publish this exact draft and attribution bundle',
        studio: studio as unknown as Json,
      });
      const receipt = await flow.call(
        'publish-approved-package',
        publish,
        studio as unknown as Json,
      );
      return { ...studio, publication: receipt } as unknown as Json;
    },
  });
  const app = createApp({
    directory: options.directory,
    principal: 'muse-owner',
    workflows: [workflowWithPublisher, openAlexResearch, crossrefResearch, commonsResearch],
    tools: [openAlex, crossref, commons, publish],
  });
  return { app, workflow: workflowWithPublisher };
}

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { retrievalTool, type Retriever, type RetrievedPassage } from '@harngine/retrieval';
import {
  agent,
  artifactReference,
  createApp,
  schema,
  tool,
  type App,
  type ArtifactReference,
  type ContextItem,
  type ModelAdapter,
  type ModelRequest,
  type Work,
} from 'harngine';

export type Citation = {
  readonly source: string;
  readonly version: string;
};

export type DueDiligenceRequest = {
  readonly question: string;
  readonly attachments: ArtifactReference[];
};

export type DueDiligenceAnswer = {
  readonly status: 'review';
  readonly summary: string;
  readonly citations: Citation[];
  readonly report: ArtifactReference;
};

type Document = {
  readonly artifact: ArtifactReference;
  readonly text: string;
};

type PublishReceipt = {
  readonly report: ArtifactReference;
};

const digestToken = (text: string) =>
  `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}` as const;

/** Application-owned immutable text storage. Harngine records only the references. */
export class DocumentLibrary implements Retriever {
  private readonly documents = new Map<string, Document>();

  add(name: string, text: string, mediaType = 'text/plain'): ArtifactReference {
    const digest = digestToken(text);
    const artifact = artifactReference({
      id: `attachment:${name}`,
      name,
      mediaType,
      byteLength: Buffer.byteLength(text, 'utf8'),
      digest,
    });
    this.documents.set(`${artifact.id}\0${artifact.digest}`, { artifact, text });
    return artifact;
  }

  read(artifact: ArtifactReference): string {
    const document = this.documents.get(`${artifact.id}\0${artifact.digest}`);
    if (!document) throw new Error(`Artifact ${artifact.id} is unavailable at ${artifact.digest}`);
    if (
      digestToken(document.text) !== artifact.digest ||
      Buffer.byteLength(document.text, 'utf8') !== artifact.byteLength
    )
      throw new Error(`Artifact ${artifact.id} failed content verification`);
    return document.text;
  }

  async search(
    query: string,
    options: { limit: number; signal: AbortSignal },
  ): Promise<readonly RetrievedPassage[]> {
    const terms = query
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    const ranked: (RetrievedPassage & { rank: number })[] = [];
    for (const document of this.documents.values()) {
      options.signal.throwIfAborted();
      for (const [index, text] of document.text.split(/\n\s*\n/).entries()) {
        const normalized = text.toLocaleLowerCase();
        const rank = terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
        if (!rank) continue;
        ranked.push({
          source: document.artifact.id,
          version: document.artifact.digest,
          ...(document.artifact.name ? { title: document.artifact.name } : {}),
          location: `paragraph ${index + 1}`,
          text,
          score: rank,
          rank,
        });
      }
    }
    return ranked
      .sort((left, right) => right.rank - left.rank)
      .slice(0, options.limit)
      .map(({ rank: _rank, ...passage }) => passage);
  }
}

const citation = schema<Citation>({
  id: 'diligence.citation',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'version'],
    properties: {
      source: { type: 'string', minLength: 1 },
      version: { type: 'string', minLength: 1 },
    },
  },
});

const artifact = schema<ArtifactReference>({
  id: 'diligence.artifact',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['object', 'id', 'mediaType', 'byteLength', 'digest'],
    properties: {
      object: { enum: ['artifact'] },
      id: { type: 'string', minLength: 1 },
      mediaType: { type: 'string', minLength: 3 },
      byteLength: { type: 'integer', minimum: 0 },
      digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      name: { type: 'string', minLength: 1 },
    },
  },
});

const request = schema<DueDiligenceRequest>({
  id: 'diligence.request',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['question', 'attachments'],
    properties: {
      question: { type: 'string', minLength: 1 },
      attachments: { type: 'array', minItems: 1, items: artifact.jsonSchema },
    },
  },
});

const publishInput = schema<{
  title: string;
  summary: string;
  citations: Citation[];
  attachments: ArtifactReference[];
}>({
  id: 'diligence.publish-input',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'citations', 'attachments'],
    properties: {
      title: { type: 'string', minLength: 1 },
      summary: { type: 'string', minLength: 1 },
      citations: { type: 'array', minItems: 1, items: citation.jsonSchema },
      attachments: { type: 'array', minItems: 1, items: artifact.jsonSchema },
    },
  },
});

const answer = schema<DueDiligenceAnswer>({
  id: 'diligence.answer',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'citations', 'report'],
    properties: {
      status: { enum: ['review'] },
      summary: { type: 'string', minLength: 1 },
      citations: { type: 'array', minItems: 1, items: citation.jsonSchema },
      report: artifact.jsonSchema,
    },
  },
});

const publishReceipt = schema<PublishReceipt>({
  id: 'diligence.publish-receipt',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['report'],
    properties: { report: artifact.jsonSchema },
  },
});

function successfulToolOutcome(request: ModelRequest, toolId: string) {
  const item = request.context.items.find(
    (candidate) =>
      candidate.type === 'tool_outcome' &&
      candidate.call.tool.id === toolId &&
      candidate.outcome.status === 'success',
  );
  if (item?.type !== 'tool_outcome' || item.outcome.status !== 'success') return undefined;
  return item as Extract<ContextItem, { type: 'tool_outcome' }> & {
    readonly outcome: { readonly status: 'success'; readonly value: unknown };
  };
}

export function dueDiligenceDemoModel(): ModelAdapter {
  return {
    id: 'diligence-demo-model',
    capabilities: { tools: true, structuredOutput: true, streaming: false },
    async generate(modelRequest) {
      const objective = modelRequest.context.objective as DueDiligenceRequest;
      const search = successfulToolOutcome(modelRequest, 'diligence.documents.search');
      const publish = successfulToolOutcome(modelRequest, 'diligence.report.publish');
      if (!search)
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'search-documents',
              tool: 'diligence.documents.search',
              input: { query: objective.question, limit: 4 },
            },
          ],
          finishReason: 'tool-calls',
        };
      if (search.outcome.status !== 'success') throw new Error('Expected document evidence');
      const passages = (
        search.outcome.value as {
          passages: RetrievedPassage[];
        }
      ).passages;
      const citations = [
        ...new Map(
          passages.map((passage) => [
            `${passage.source}\0${passage.version}`,
            { source: passage.source, version: passage.version },
          ]),
        ).values(),
      ];
      const summary = passages.map((passage) => passage.text).join(' ');
      if (!publish)
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'publish-report',
              tool: 'diligence.report.publish',
              input: {
                title: `Due diligence: ${objective.question}`,
                summary,
                citations,
                attachments: modelRequest.context.artifacts.filter((item) =>
                  item.id.startsWith('attachment:'),
                ),
              },
            },
          ],
          finishReason: 'tool-calls',
        };
      if (publish.outcome.status !== 'success') throw new Error('Expected a published report');
      return {
        object: 'model_response',
        items: [
          {
            type: 'data',
            value: {
              status: 'review',
              summary,
              citations,
              report: (publish.outcome.value as PublishReceipt).report,
            },
          },
        ],
        finishReason: 'stop',
      };
    },
  };
}

function defineSearch(library: DocumentLibrary) {
  return retrievalTool({
    id: 'diligence.documents.search',
    description: 'Search the application-owned attachment library with source versions.',
    retriever: library,
    maxResults: 10,
  });
}

function definePublish(outputDirectory: string) {
  return tool({
    id: 'diligence.report.publish',
    description: 'Write an exact due-diligence report after approval.',
    input: publishInput,
    output: publishReceipt,
    effect: 'write',
    capabilities: { idempotency: 'operation-key', reversibility: 'reversible' },
    approval: { approvers: ['local'], timeoutMs: 60_000 },
    execute(input) {
      const content = JSON.stringify(input, null, 2);
      const fileName = 'due-diligence-report.json';
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(join(outputDirectory, fileName), content, 'utf8');
      return {
        report: artifactReference({
          id: `report:${fileName}`,
          name: fileName,
          mediaType: 'application/json',
          byteLength: Buffer.byteLength(content, 'utf8'),
          digest: digestToken(content),
        }),
      };
    },
  });
}

export interface DueDiligenceDesk {
  readonly app: App;
  readonly reviewer: ReturnType<typeof defineReviewer>;
  readonly library: DocumentLibrary;
}

function defineReviewer(
  model: ModelAdapter,
  search: ReturnType<typeof defineSearch>,
  publish: ReturnType<typeof definePublish>,
) {
  return agent({
    id: 'diligence.reviewer',
    instructions: [
      'Review only evidence retrieved from the attached documents.',
      'Cite every source version and publish the report through the approval-gated Tool.',
    ],
    objective: request,
    result: answer,
    publish: (result) => result,
    model,
    tools: [search, publish],
  });
}

export function createDueDiligenceDesk(options: {
  readonly directory: string;
  readonly outputDirectory: string;
  readonly library?: DocumentLibrary;
  readonly model?: ModelAdapter;
}): DueDiligenceDesk {
  const library = options.library ?? new DocumentLibrary();
  const search = defineSearch(library);
  const publish = definePublish(options.outputDirectory);
  const reviewer = defineReviewer(options.model ?? dueDiligenceDemoModel(), search, publish);
  return {
    app: createApp({ directory: options.directory, agents: [reviewer] }),
    reviewer,
    library,
  };
}

export async function runDueDiligence(
  desk: DueDiligenceDesk,
  request: DueDiligenceRequest,
): Promise<Work<DueDiligenceRequest, DueDiligenceAnswer>> {
  for (const attachment of request.attachments) desk.library.read(attachment);
  return desk.app.start(desk.reviewer, request);
}

export async function waitForApproval(
  work: Work,
  timeoutMs = 5_000,
): Promise<{
  readonly id: string;
  readonly title: string;
  readonly details: unknown;
  readonly tool?: { readonly id: string; readonly revision: string };
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await work.snapshot();
    const approval = snapshot.interactions.find((interaction) => interaction.type === 'approval');
    if (approval)
      return {
        id: approval.id,
        title: approval.title,
        details: approval.details,
        ...(approval.tool ? { tool: approval.tool } : {}),
      };
    if (snapshot.status === 'completed' || snapshot.status === 'failed')
      throw new Error(`Work ${work.id} closed before requesting approval`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Work ${work.id} did not request approval`);
}

import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent, createApp, schema, type App, type ModelAdapter, type ModelRequest } from 'harngine';
import { retrievalTool, unknownCitations } from '../src/index.js';

const apps: App[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test('retrieval Tool records source identity and version', async () => {
  const wrapped = retrievalTool({
    id: 'test.retrieval.search',
    description: 'Find passages',
    maxResults: 2,
    retriever: {
      async search(query, options) {
        expect(query).toBe('Harngine');
        expect(options.limit).toBe(2);
        return [
          { source: 'doc://guide', version: 'sha256:abc', text: 'A passage', location: 'p.2' },
        ];
      },
    },
  });
  const result = await wrapped.execute(
    { query: 'Harngine' },
    {
      signal: new AbortController().signal,
      idempotencyKey: 'attempt-1',
      fail(error) {
        throw new Error(error.code);
      },
      effectUnknown(error) {
        throw new Error(error.code);
      },
    },
  );
  expect(result).toEqual({
    passages: [
      { source: 'doc://guide', version: 'sha256:abc', text: 'A passage', location: 'p.2' },
    ],
  });
});

test('retrieval Agent uses recorded evidence and accepts only retrieved citations', async () => {
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'retrieval-test-model',
    capabilities: { tools: true, structuredOutput: true, streaming: false },
    async generate(request) {
      requests.push(request);
      if (requests.length === 1)
        return {
          object: 'model_response',
          finishReason: 'tool-calls',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'search-1',
              tool: 'test.retrieval.cited-search',
              input: { query: 'durable execution' },
            },
          ],
        };
      const evidence = request.context.items.find((item) => item.type === 'tool_outcome');
      if (!evidence || evidence.type !== 'tool_outcome' || evidence.outcome.status !== 'success')
        throw new Error('Expected successful retrieval evidence');
      const passage = evidence.outcome.value as {
        passages: { source: string; version: string; text: string }[];
      };
      return {
        object: 'model_response',
        finishReason: 'stop',
        items: [
          {
            type: 'data',
            value: {
              answer: passage.passages[0]!.text,
              citations: [
                {
                  source: passage.passages[0]!.source,
                  version: passage.passages[0]!.version,
                },
              ],
            },
          },
        ],
      };
    },
  };
  const result = schema<{
    answer: string;
    citations: { source: string; version: string }[];
  }>({
    id: 'retrieval-cited-result',
    version: '1',
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'citations'],
      properties: {
        answer: { type: 'string' },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['source', 'version'],
            properties: { source: { type: 'string' }, version: { type: 'string' } },
          },
        },
      },
    },
  });
  const passages = [
    { source: 'docs://durability', version: 'sha256:abc', text: 'Work survives restarts.' },
  ];
  const search = retrievalTool({
    id: 'test.retrieval.cited-search',
    description: 'Find evidence for a question',
    retriever: {
      async search() {
        return passages;
      },
    },
  });
  const assistant = agent({
    id: 'retrieval-cited-agent',
    instructions: 'Retrieve evidence and cite only retrieved passages.',
    objective: schema<string>({
      id: 'retrieval-question',
      version: '1',
      jsonSchema: { type: 'string' },
    }),
    result,
    publish: false,
    model,
    tools: [search],
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-retrieval-agent-')));
  directories.push(directory);
  const app = createApp({ directory, agents: [assistant] });
  apps.push(app);
  const work = await app.start(assistant, 'How does durability work?');
  const answer = (await work.result()) as {
    answer: string;
    citations: { source: string; version: string }[];
  };
  expect(answer.answer).toBe(passages[0]!.text);
  expect(unknownCitations(answer.citations, passages)).toEqual([]);
  expect(unknownCitations([{ source: 'docs://invented', version: '1' }], passages)).toEqual([
    { source: 'docs://invented', version: '1' },
  ]);
  expect(requests).toHaveLength(2);
  expect(await work.inspect({ detail: 'diagnostic' })).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        type: 'call',
        tool: expect.objectContaining({ id: 'test.retrieval.cited-search' }),
        diagnostic: expect.objectContaining({
          outcome: expect.objectContaining({
            value: expect.objectContaining({ passages }),
          }),
        }),
      }),
    ]),
  });
});

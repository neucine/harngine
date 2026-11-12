import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  agent,
  artifactReference,
  artifactReferences,
  createApp,
  schema,
  type App,
  type ArtifactReference,
  type ModelAdapter,
  type ModelRequest,
} from '../src/index.js';

const apps: App[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const digest = `sha256:${'a'.repeat(64)}` as const;

test('artifact references validate metadata without accepting payload fields', () => {
  const artifact = artifactReference({
    id: 'attachment:agreement',
    name: 'agreement.md',
    mediaType: 'text/markdown',
    byteLength: 128,
    digest,
  });
  expect(Object.isFrozen(artifact)).toBe(true);
  expect(
    artifactReferences({
      attachments: [artifact],
      repeated: artifact,
    }),
  ).toEqual([artifact]);
  expect(() =>
    artifactReferences({
      object: 'artifact',
      id: 'attachment:payload',
      mediaType: 'text/plain',
      byteLength: 5,
      digest,
      content: 'secret',
    } as never),
  ).toThrow(/cannot contain payload/);
  expect(() =>
    artifactReference({
      id: 'attachment:invalid',
      mediaType: 'text/plain',
      byteLength: 1,
      digest: 'sha256:not-a-digest' as never,
    }),
  ).toThrow(/sha256/);
});

test('selected Model Context exposes deduplicated attachment references as a sidecar', async () => {
  const requests: ModelRequest[] = [];
  const model: ModelAdapter = {
    id: 'artifact-context-model',
    capabilities: { tools: false, structuredOutput: false, streaming: false },
    async generate(request) {
      requests.push(request);
      return {
        object: 'model_response',
        items: [{ type: 'text', text: 'reviewed' }],
        finishReason: 'stop',
      };
    },
  };
  const attachment = artifactReference({
    id: 'attachment:agreement',
    name: 'agreement.md',
    mediaType: 'text/markdown',
    byteLength: 128,
    digest,
  });
  const objective = schema<{ question: string; attachments: ArtifactReference[] }>({
    id: 'artifact-request',
    version: '1',
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'attachments'],
      properties: {
        question: { type: 'string' },
        attachments: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['object', 'id', 'mediaType', 'byteLength', 'digest'],
            properties: {
              object: { enum: ['artifact'] },
              id: { type: 'string' },
              mediaType: { type: 'string' },
              byteLength: { type: 'integer', minimum: 0 },
              digest: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    },
  });
  const reviewer = agent({
    id: 'artifact-context-reviewer',
    instructions: 'Review the attached evidence.',
    objective,
    model,
  });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-artifact-')));
  directories.push(directory);
  const app = createApp({ directory, agents: [reviewer] });
  apps.push(app);

  await expect(
    app.run(reviewer, {
      question: 'Is the agreement current?',
      attachments: [attachment, attachment],
    }),
  ).resolves.toBe('reviewed');
  expect(requests[0]?.context.artifacts).toEqual([attachment]);
});

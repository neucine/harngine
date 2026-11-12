import { access, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { assembleStudio, assertPublishable, verifyEnvelope } from '../src/domain.js';
import { replaySources } from '../src/replay.js';
import { serveMuse } from '../src/server.js';
import { createMuseApp } from '../src/workflow.js';

const brief = {
  question: 'What does experimental evidence say about remote-work productivity?',
  angle: 'Separate fully remote from hybrid work.',
  mode: 'replay' as const,
};

describe('Muse evidence policy', () => {
  test('verifies replay hashes and preserves claim distinctions', () => {
    expect(replaySources.map(verifyEnvelope)).toHaveLength(5);
    const studio = assembleStudio(brief, replaySources);
    expect(studio.claims.map((claim) => claim.kind)).toEqual([
      'fact',
      'fact',
      'conflict',
      'inference',
      'creative',
    ]);
    expect(() => assertPublishable(studio)).not.toThrow();
  });

  test('rejects a factual claim without retrievable support', () => {
    const studio = assembleStudio(brief, replaySources);
    const claims = studio.claims.map((claim, index) =>
      index === 0 ? { ...claim, evidence: [] } : claim,
    );
    expect(() => assertPublishable({ ...studio, claims })).toThrow('UNSUPPORTED_FACT:claim-1');
  });

  test('blocks publication when the per-file rights review is not clear', () => {
    const studio = assembleStudio(brief, replaySources);
    expect(() =>
      assertPublishable({
        ...studio,
        rightsReview: { status: 'blocked', items: ['Licence missing'] },
      }),
    ).toThrow('RIGHTS_BLOCKED');
  });
});

test('runs parallel research, waits for exact approval, and publishes afterward', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'muse-test-')));
  const publicationDirectory = join(directory, 'outbox');
  const { app, workflow } = createMuseApp({
    directory: join(directory, 'runtime'),
    publicationDirectory,
  });
  try {
    const work = await app.start(workflow, brief);
    let snapshot = await work.snapshot();
    for (let attempt = 0; attempt < 100 && snapshot.interactions.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = await work.snapshot();
    }
    expect(snapshot.childWorkIds).toHaveLength(3);
    expect(snapshot.status).toBe('waiting');
    const approval = snapshot.interactions[0];
    expect(approval?.type).toBe('approval');
    await work.respond(approval!.id, true);
    const result = (await work.result()) as Record<string, unknown>;
    const publication = result.publication as { url: string; objectId: string };
    expect(publication.url).toMatch(/^file:/);
    const published = await readFile(
      join(publicationDirectory, `${publication.objectId}.md`),
      'utf8',
    );
    expect(published).toContain('# What the best remote-work experiments actually show');
    const inspection = await work.inspect({ detail: 'story', limit: 100 });
    expect(
      inspection.entries.filter((entry) => entry.type === 'child' && entry.phase === 'started'),
    ).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test('a denied publication never invokes the write Tool', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'muse-deny-')));
  const publicationDirectory = join(directory, 'outbox');
  const { app, workflow } = createMuseApp({
    directory: join(directory, 'runtime'),
    publicationDirectory,
  });
  try {
    const work = await app.start(workflow, brief);
    let snapshot = await work.snapshot();
    for (let attempt = 0; attempt < 100 && snapshot.interactions.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = await work.snapshot();
    }
    await work.respond(snapshot.interactions[0]!.id, false);
    await expect(work.result()).rejects.toMatchObject({ code: 'APPROVAL_REJECTED' });
    await expect(access(publicationDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await app.close();
  }
});

test('creator can submit a brief, revise the draft, and approve the exact revision', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'muse-studio-')));
  const { app, workflow } = createMuseApp({
    directory: join(directory, 'runtime'),
    publicationDirectory: join(directory, 'outbox'),
  });
  const server = await serveMuse({ app, workflow });
  try {
    const page = await (await fetch(server.url)).text();
    const token = page.match(/__WEIV_PROPS__=\{token:"([a-f0-9]+)"\}/)?.[1];
    expect(token).toBeTruthy();
    const request = async (path: string, value?: unknown) => {
      const response = await fetch(`${server.url}${path}`, {
        method: value === undefined ? 'GET' : 'POST',
        headers: { 'x-muse-token': token!, 'content-type': 'application/json' },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      return { response, value: (await response.json()) as Record<string, unknown> };
    };
    expect((await request('/api/state')).value.status).toBe('idle');
    expect((await request('/api/research', brief)).response.status).toBe(202);
    let state = (await request('/api/state')).value;
    for (let attempt = 0; attempt < 100 && !state.studio; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = (await request('/api/state')).value;
    }
    const firstWorkId = String(state.id);
    const studio = state.studio as unknown as ReturnType<typeof assembleStudio>;
    const space = state.space as {
      nodes: Array<{ id: string; dormant: boolean }>;
      relations: unknown[];
      lineage: unknown[];
      conversations: unknown[];
      sparks: Array<{ id: string; saved: boolean }>;
    };
    expect(state.status).toBe('waiting');
    expect(space.nodes.length).toBeGreaterThan(5);
    const firstNode = space.nodes[0]!;
    const secondNode = space.nodes[1]!;
    expect(
      (
        await request('/api/gesture', {
          action: 'juxtapose',
          nodeIds: [firstNode.id, secondNode.id],
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await request('/api/gesture', {
          action: 'sleep',
          nodeIds: [firstNode.id],
        })
      ).response.status,
    ).toBe(200);
    const conversation = await request('/api/conversation', {
      perspective: 'contrarian',
      nodeId: firstNode.id,
      prompt: 'What changes if I put this beside its opposite?',
    });
    expect(conversation.response.status).toBe(200);
    expect(String((conversation.value.conversation as Record<string, unknown>).response)).toContain(
      'live tension',
    );
    const sparked = await request('/api/spark', {
      seed: 'What is an office for when focused work can happen anywhere?',
      perspective: 'metaphorist',
      nodeIds: [firstNode.id, secondNode.id],
    });
    expect(sparked.response.status).toBe(200);
    const spark = sparked.value.spark as Record<string, unknown>;
    expect(spark.title).toBe('A workplace made of rhythm');
    expect((spark.evidence as unknown[]).length).toBeGreaterThan(0);
    const saved = await request('/api/spark/save', { sparkId: spark.id });
    expect(saved.response.status).toBe(200);
    expect((saved.value.spark as Record<string, unknown>).saved).toBe(true);
    expect(
      (
        await request('/api/revision', {
          baseWorkId: firstWorkId,
          title: 'A creator-edited headline about hybrid work',
          dek: studio.dek,
          selectedOutline: studio.outlines[1]!.name,
          draft: studio.draft.map((paragraph, index) =>
            index === 0
              ? `${paragraph.text} This framing was added by the creator.`
              : paragraph.text,
          ),
        })
      ).response.status,
    ).toBe(202);
    state = (await request('/api/state')).value;
    for (let attempt = 0; attempt < 100 && (!state.studio || state.id === firstWorkId); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = (await request('/api/state')).value;
    }
    const revised = state.studio as unknown as ReturnType<typeof assembleStudio>;
    expect(state.id).not.toBe(firstWorkId);
    expect(state.revision).toBe(1);
    expect(revised.title).toBe('A creator-edited headline about hybrid work');
    expect(revised.selectedOutline).toBe(studio.outlines[1]!.name);
    expect((await request('/api/approval', { value: true })).response.status).toBe(202);
    for (let attempt = 0; attempt < 100 && state.status !== 'completed'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = (await request('/api/state')).value;
    }
    expect(state.status).toBe('completed');
    expect((state.result as Record<string, unknown>).title).toBe(
      'A creator-edited headline about hybrid work',
    );
  } finally {
    await server.close();
    await app.close();
  }
});

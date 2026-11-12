import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createQuestEngine } from '../src/engine.js';
import { MetProvider } from '../src/met-provider.js';
import { page } from '../src/page.js';
import { WorldStore } from '../src/world-store.js';
import { firstObjectId, objectIds, worldObject } from '../src/world.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe('Met provider', () => {
  it('replays a real response without network access and preserves provenance', async () => {
    let fetched = false;
    const provider = new MetProvider({
      mode: 'replay',
      fetch: async () => {
        fetched = true;
        throw new Error('network must not be used');
      },
    });
    const result = await provider.object(firstObjectId);
    expect(fetched).toBe(false);
    expect(result.object.title).toContain('Astrolabe');
    expect(result.provenance).toMatchObject({
      provider: 'met',
      objectId: firstObjectId,
      mode: 'replay',
      licence: 'CC0-1.0',
      contentHash: '1e6b3d229cc63997cc5208c0e2c2206db6bcaa0ef10cec0356e5aad195ef89be',
    });
  });

  it('rejects a modified replay recording', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'quest-recording-')), 'recording.json');
    const source = join(process.cwd(), 'examples/quest/recordings/met-objects.json');
    const recording = JSON.parse(readFileSync(source, 'utf8'));
    recording.objects[0].payload.title = 'tampered';
    writeFileSync(path, JSON.stringify(recording));
    await expect(
      new MetProvider({ mode: 'replay', recordingPath: path }).object(firstObjectId),
    ).rejects.toThrow('hash mismatch');
  });

  it('bounds live access to the world constellation', async () => {
    await expect(new MetProvider({ mode: 'live' }).object(1)).rejects.toThrow('outside this');
  });

  it('writes the replay cache only in explicit safe-write mode', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'quest-safe-write-')), 'recording.json');
    const source = join(process.cwd(), 'examples/quest/recordings/met-objects.json');
    const recording = JSON.parse(readFileSync(source, 'utf8'));
    writeFileSync(path, JSON.stringify(recording));
    const provider = new MetProvider({
      mode: 'safe-write',
      recordingPath: path,
      now: () => new Date('2026-10-11T00:00:00Z'),
      fetch: async () =>
        new Response(JSON.stringify(recording.objects[0].payload), { status: 200 }),
    });
    expect((await provider.object(firstObjectId)).provenance.mode).toBe('safe-write');
    expect(JSON.parse(readFileSync(path, 'utf8')).fetchedAt).toBe('2026-10-11T00:00:00.000Z');
  });
});

describe('Weiv product shell', () => {
  it('loads a compiled module without putting application code inline', () => {
    const html = page('test-token');
    expect(html).toContain('data-token="test-token"');
    expect(html).toContain('src="/main.mjs"');
    expect(html).toContain('href="/styles.css"');
    expect(html).not.toContain('The Lost Navigator');
    expect(readFileSync(join(process.cwd(), 'examples/quest/public/App.mjs'), 'utf8')).toContain(
      'export function mount',
    );
  });

  it('makes the playable loop legible in the cold-start interface', () => {
    const source = readFileSync(join(process.cwd(), 'examples/quest/src/ui/App.weiv'), 'utf8');
    expect(source).toContain('Together, discover what connects these objects.');
    expect(source).toContain('1 · Choose a lens');
    expect(source).toContain('3 · Pull a thread');
    expect(source).toContain('4 · Make or challenge a connection');
    expect(source).toContain('Reveal the echo');
  });
});

describe('durable cultural world', () => {
  it('keeps each visitor perspective private and never creates a completion state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quest-engine-'));
    const directory = join(root, 'execution');
    mkdirSync(directory);
    const engine = createQuestEngine(realpathSync(directory), new MetProvider({ mode: 'replay' }));
    cleanup.push(() => engine.close());
    const visitor = engine.app.forPrincipal('visitor_test');
    const session = await visitor.sessions.create({
      agent: engine.perspective,
      title: 'Private path',
    });
    const { work } = await session.send({
      type: 'arrive',
      objectId: firstObjectId,
      priorVisits: [],
      echoes: [],
    });
    const result = (await work.result()) as { message: string; question: string };
    expect(result.message).toContain('Astrolabe');
    expect(result.question).toMatch(/\?$/);
    expect(JSON.stringify(result)).not.toMatch(/solved|complete|winner/i);
    await expect(
      engine.app.forPrincipal('another_visitor').sessions.get(session.id),
    ).rejects.toThrow('another principal');
  });

  it('turns a contribution into a durable two-object world reaction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quest-reaction-'));
    const directory = join(root, 'execution');
    mkdirSync(directory);
    const engine = createQuestEngine(realpathSync(directory), new MetProvider({ mode: 'replay' }));
    cleanup.push(() => engine.close());
    const work = await engine.app.forPrincipal('quest:world').start(engine.react, {
      kind: 'connection',
      text: 'Both turn measurement into ornament',
      objectIds: [objectIds[0], objectIds[1]],
    });
    const result = (await work.result()) as { text: string; sources: unknown[] };
    expect(result.text).toContain('made a new path appear');
    expect(result.sources).toHaveLength(2);
    expect((await work.snapshot()).childWorkIds).toHaveLength(2);
  });

  it('persists paths, shared interpretations, trails, and later visitor echoes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quest-world-'));
    const path = join(root, 'world.sqlite');
    const store = new WorldStore(path);
    const provider = new MetProvider({ mode: 'replay' });
    const objects = await Promise.all(
      objectIds.map(async (id) => worldObject(await provider.object(id))),
    );
    const ada = store.enter('Ada');
    const bell = store.enter('Bell');
    const bellBefore = store.authenticate(bell.visitorToken);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const thoughtId = store.interpret(
      ada.visitorId,
      firstObjectId,
      'The rings feel like a portable horizon',
    );
    store.connect(ada.visitorId, objectIds[0], objectIds[1], 'Ways of measuring distance');
    store.rememberReaction({
      visitorId: ada.visitorId,
      triggerId: thoughtId,
      text: 'A new correspondence surfaced.',
      objectIds: [objectIds[0], objectIds[1]],
      sources: [],
      workId: 'work_test',
    });
    expect(store.echoesSince(bellBefore, firstObjectId)).toContain(
      'The rings feel like a portable horizon',
    );
    const state = store.state(ada.visitorId, objects, 'replay') as Record<string, unknown>;
    expect(state).not.toHaveProperty('solved');
    expect(state.interpretations).toHaveLength(1);
    expect(state.reactions).toHaveLength(1);
    store.close();

    const reopened = new WorldStore(path);
    cleanup.push(() => reopened.close());
    expect(reopened.authenticate(ada.visitorToken).id).toBe(ada.visitorId);
    expect(
      (reopened.state(ada.visitorId, objects, 'replay') as { connections: unknown[] }).connections,
    ).toHaveLength(4);
  });
});

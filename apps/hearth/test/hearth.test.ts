import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openHearth, type HearthState } from '../src/app.js';
import { buildHearthWorld } from '../src/domain.js';
import { hearthPage } from '../src/page.js';
import { PublicDataClient } from '../src/public-data.js';
import { HomeStore } from '../src/store.js';

async function recording(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`recordings/${name}`, import.meta.url), 'utf8'));
}
async function recordedClient() {
  const [place, weather, guidance] = await Promise.all([
    recording('nominatim-wellington.json'),
    recording('open-meteo-wellington.json'),
    recording('data-govt-wellington.json'),
  ]);
  const request: typeof fetch = async (input) => {
    const url = String(input);
    const value = url.includes('nominatim')
      ? place
      : url.includes('open-meteo')
        ? weather
        : guidance;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return new PublicDataClient(request, 'Hearth-test/replay');
}
async function settled(state: () => Promise<HearthState>): Promise<HearthState> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await state();
    if (value.work.status === 'completed') return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Hearth did not settle');
}

describe('Hearth living home-world', () => {
  test('replays real surroundings into household weather and a seasonal memory garden', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'hearth-world-')));
    const store = new HomeStore(join(directory, 'home.json'));
    const view = await store.view('alex');
    const context = await (await recordedClient()).context(
      view.address,
      view.timezone,
      '2026-10-11T00:00:00.000Z',
    );
    const world = buildHearthWorld(view, context);
    expect(world.season.name).toBe('Spring');
    expect(world.localWeather.summary).toBeTruthy();
    expect(world.blooms.some((bloom) => bloom.chapter === 'A moving-home chapter')).toBe(true);
    expect(world.blooms.some((bloom) => bloom.private)).toBe(true);
    expect(world.opening?.why).toContain('Private words were not shared');
  });

  test('private traces stay in their author’s lens', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'hearth-consent-')));
    const store = new HomeStore(join(directory, 'home.json'));
    await store.checkIn({
      author: 'alex',
      energy: 1,
      feeling: 'fragile',
      note: 'Not ready to explain.',
      visibility: 'private',
      now: '2026-10-11T18:00:00+13:00',
    });
    const alex = await store.view('alex');
    const sam = await store.view('sam');
    expect(alex.checkIns.some((item) => item.feeling === 'fragile')).toBe(true);
    expect(sam.checkIns.some((item) => item.feeling === 'fragile')).toBe(false);
    expect(sam.memories.some((item) => item.id === 'quiet-corner')).toBe(false);
  });

  test('a new perspective becomes a new durable attunement and survives re-entry', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'hearth-durable-')));
    const file = join(directory, 'home-memory.json');
    const hearth = await openHearth({
      directory,
      store: new HomeStore(file),
      publicData: await recordedClient(),
    });
    let first: HearthState;
    try {
      first = await settled(() => hearth.state('alex'));
      await hearth.checkIn({
        viewer: 'alex',
        energy: 5,
        feeling: 'hopeful',
        note: 'The rooms are beginning to feel like ours.',
        visibility: 'shared',
      });
      const next = await settled(() => hearth.state('alex'));
      expect(next.work.id).not.toBe(first.work.id);
      expect(next.world?.version).toBeGreaterThan(first.world?.version ?? 0);
      expect(
        next.world?.householdWeather.perspectives.some((item) => item.feeling === 'hopeful'),
      ).toBe(true);
    } finally {
      await hearth.close();
    }
    const restored = await openHearth({
      directory,
      store: new HomeStore(file),
      publicData: await recordedClient(),
    });
    try {
      const state = await settled(() => restored.state('alex'));
      expect(
        state.world?.householdWeather.perspectives.some((item) => item.feeling === 'hopeful'),
      ).toBe(true);
    } finally {
      await restored.close();
    }
  });

  test('mounts a Weiv-first interface with non-transactional signature interactions', () => {
    const html = hearthPage('test-token');
    expect(html).toContain('globalThis.__WEIV_PROPS__={token:"test-token"}');
    expect(html).toContain('/main.mjs');
    const component = readFileSync(join(process.cwd(), 'apps/hearth/src/ui/App.weiv'), 'utf8');
    expect(component).toContain('Living hearth');
    expect(component).toContain('Seasonal memory garden');
    expect(component).toContain('How Hearth listens');
    expect(component).toContain('Read the household weather');
    expect(component).toContain('Place your pulse · 30 seconds');
    expect(component).toContain('Two pulses, one small opening');
    expect(component).toContain('Shape the shared hearth');
    expect(component).toContain('for="bloom in world.blooms"');
    expect(component).toContain('on:click="openPulse"');
    expect(existsSync(join(process.cwd(), 'apps/hearth/public/App.mjs'))).toBe(true);
  });
});

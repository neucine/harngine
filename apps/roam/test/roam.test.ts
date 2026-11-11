import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  buildJourneyWorlds,
  demoBrief,
  type GeographyResearch,
  type WeatherResearch,
} from '../src/domain.js';
import { roamPage } from '../src/page.js';
import type { TravelFactsProvider } from '../src/providers.js';
import { openRoam, type RoamRoom } from '../src/room.js';

const directories: string[] = [];
const rooms: RoamRoom[] = [];
afterEach(async () => {
  for (const room of rooms.splice(0)) await room.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const provider: TravelFactsProvider = {
  async geocode(destinations): Promise<GeographyResearch> {
    return {
      provenance: {
        provider: 'Deterministic geography test adapter',
        state: 'cached',
        fetchedAt: '2026-10-11T00:00:00.000Z',
        url: 'https://example.invalid/geography',
        note: 'Test-only recorded geography.',
      },
      places: destinations.map((item, index) => ({
        id: item.id,
        requestedName: item.name,
        displayName: `${item.name}, Japan`,
        latitude: item.latitude,
        longitude: item.longitude,
        osmType: 'relation',
        osmId: 100 + index,
      })),
    };
  },
  async weather(destinations, startDate): Promise<WeatherResearch> {
    return {
      provenance: {
        provider: 'Deterministic weather test adapter',
        state: 'cached',
        fetchedAt: '2026-10-11T00:00:00.000Z',
        url: 'https://example.invalid/weather',
        note: 'Test-only recorded weather.',
      },
      places: destinations.map((item) => ({
        id: item.id,
        name: item.name,
        timezone: 'Asia/Tokyo',
        days: [
          {
            date: startDate,
            temperatureMin: 14,
            temperatureMax: 22,
            precipitationProbability: 60,
            weatherCode: 2,
          },
        ],
      })),
    };
  },
};

async function until(
  room: RoamRoom,
  predicate: (state: Awaited<ReturnType<RoamRoom['state']>>) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await room.state();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Roam did not reach the expected state');
}

test('three journey worlds cover the shared window and preserve distinct atmospheres', () => {
  const brief = demoBrief(new Date('2026-10-11T12:00:00Z'));
  const worlds = buildJourneyWorlds(brief);
  expect(worlds.map((world) => world.id)).toEqual([
    'lantern-drift',
    'electric-quiet',
    'mountain-breath',
  ]);
  expect(worlds.every((world) => world.days.length === 7)).toBe(true);
  expect(worlds[0]!.days[0]!.date).toBe('2026-10-15');
  expect(new Set(worlds.map((world) => world.atmosphere)).size).toBe(3);
  expect(worlds.every((world) => world.signalEchoes.includes('step-free where possible'))).toBe(
    true,
  );
});

test('persistent scouts adapt journey worlds to signals, reactions and changing conditions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'harngine-roam-atlas-'));
  directories.push(directory);
  const room = await openRoam({ directory, provider, now: new Date('2026-10-11T12:00:00Z') });
  rooms.push(room);
  let state = await until(room, (value) => value.work.status === 'completed');
  expect(state.work.childWorkIds).toHaveLength(2);
  expect(state.worlds).toHaveLength(3);
  expect(state.scouts.map((scout) => scout.lens)).toEqual([
    'atmosphere',
    'rhythm & access',
    'surprising connections',
  ]);
  expect(state.scouts[0]!.changed).toContain('rain-shaped');
  const firstWorkId = state.work.id;
  await room.addSignal({ kind: 'mood', text: 'the hush after rainfall', author: 'maya' });
  state = await until(
    room,
    (value) => value.work.status === 'completed' && value.work.id !== firstWorkId,
  );
  expect(state.brief.signals.at(-1)).toMatchObject({
    kind: 'mood',
    text: 'the hush after rainfall',
  });
  expect(state.worlds[0]!.signalEchoes).toContain('the hush after rainfall');
  await room.nudge('mountain-breath', 'closer');
  state = await until(
    room,
    (value) => value.work.status === 'completed' && value.brief.activeWorldId === 'mountain-breath',
  );
  expect(state.brief.reactions['mountain-breath']).toBe(3);
  expect(state.memory.previousPulses).toBeGreaterThanOrEqual(2);
  await room.weave('signal-pause');
  state = await until(
    room,
    (value) => value.work.status === 'completed' && value.brief.signals.at(-1)?.author === 'group',
  );
  expect(state.brief.signals.at(-1)?.text).toContain('one beautiful pause each day');
  await room.saveTrail('mountain-breath');
  expect((await room.state()).brief.savedTrails.at(-1)).toMatchObject({
    worldId: 'mountain-breath',
    title: 'Mountain breath',
  });
  await room.close();
  rooms.splice(rooms.indexOf(room), 1);
  const restored = await openRoam({ directory, provider });
  rooms.push(restored);
  const resumed = await restored.state();
  expect(resumed.brief.activeWorldId).toBe('mountain-breath');
  expect(resumed.brief.signals.at(-1)?.text).toContain('the hush after rainfall');
});

test('the public page mounts a Weiv living atlas with signature interactions', () => {
  const html = roamPage('test-token');
  expect(html).toContain('globalThis.__WEIV_PROPS__={token:"test-token"}');
  expect(html).toContain('<script type="module" src="/main.mjs"></script>');
  const component = readFileSync(join(process.cwd(), 'apps/roam/src/ui/App.weiv'), 'utf8');
  expect(component).toContain('PULL A POSSIBILITY CLOSER');
  expect(component).toContain('Make one day everyone wants to live.');
  expect(component).toContain('drop it on the world');
  expect(component).toContain('pull closer');
  expect(component).toContain('push away');
  expect(component).toContain('weave these desires');
  expect(component).toContain('save this trail');
  expect(component).toContain('WALK THROUGH THE RESULTING DAY');
  expect(component).toContain('ALTERNATE-DAY SIMULATION');
  expect(component).toContain('Signals, not requirements');
  expect(component).toContain('The scouts notice differently');
  expect(component).not.toContain('plan to approve');
  expect(component).not.toContain('Approve shape');
  expect(component).not.toContain('planning estimate');
  expect(existsSync(join(process.cwd(), 'apps/roam/public/App.mjs'))).toBe(true);
});

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp, type App, type InspectionEntry, type Work, type WorkSnapshot } from 'harngine';
import {
  buildJourneyWorlds,
  demoBrief,
  type AtlasBrief,
  type AtlasResult,
  type GeographyResearch,
  type SignalKind,
  type WeatherResearch,
} from './domain.js';
import { liveTravelFacts, type TravelFactsProvider } from './providers.js';
import { roamDefinitions } from './workflow.js';

export interface RoamState {
  brief: AtlasBrief;
  work: WorkSnapshot<AtlasBrief, AtlasResult>;
  worlds: ReturnType<typeof buildJourneyWorlds>;
  scouts: AtlasResult['scouts'];
  geography: GeographyResearch | null;
  weather: WeatherResearch | null;
  story: readonly InspectionEntry[];
  memory: { revisions: number; previousPulses: number };
}
export interface RoamRoom {
  state(): Promise<RoamState>;
  create(input: {
    origin: string;
    startDate: string;
    endDate: string;
    signals: string[];
  }): Promise<void>;
  focus(worldId: string): Promise<void>;
  addSignal(input: { kind: SignalKind; text: string; author: string }): Promise<void>;
  nudge(worldId: string, direction: 'closer' | 'away'): Promise<void>;
  weave(signalId: string): Promise<void>;
  saveTrail(worldId: string): Promise<void>;
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export async function openRoam(
  options: { directory?: string; provider?: TravelFactsProvider; now?: Date } = {},
): Promise<RoamRoom> {
  const requestedDirectory = resolve(
    options.directory ?? process.env.ROAM_DIRECTORY ?? '.harngine/roam',
  );
  mkdirSync(requestedDirectory, { recursive: true });
  const directory = realpathSync(requestedDirectory);
  const configPath = join(directory, 'room.json');
  const loaded = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, 'utf8')) as {
        brief: AtlasBrief;
        workId?: string;
        revision?: number;
        priorWorkIds?: string[];
      })
    : { brief: demoBrief(options.now), revision: 1, priorWorkIds: [] };
  const stored = Array.isArray(loaded.brief?.signals)
    ? loaded
    : {
        brief: demoBrief(options.now),
        revision: (loaded.revision ?? 0) + 1,
        priorWorkIds: loaded.workId ? [loaded.workId] : [],
      };
  const definitions = roamDefinitions(
    options.provider ?? liveTravelFacts(join(directory, 'provider-cache.json')),
  );
  const app: App = createApp({
    directory,
    principal: 'maya',
    workflows: [definitions.geographyResearch, definitions.weatherResearch, definitions.growAtlas],
    tools: [...definitions.all],
    access: { allowAuthenticated: true },
  });
  let work: Work<AtlasBrief, AtlasResult>;
  if (stored.workId)
    work = (await app.works.get(stored.workId as `work_${string}`)) as Work<
      AtlasBrief,
      AtlasResult
    >;
  else {
    work = await app.forPrincipal('maya').start(definitions.growAtlas, stored.brief, {
      idempotencyKey: `roam:${stored.brief.roomId}:pulse:1`,
    });
    stored.workId = work.id;
    writeFileSync(configPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  }
  function save() {
    writeFileSync(configPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  }
  async function research() {
    const snapshot = await work.snapshot();
    let geography: GeographyResearch | null = null;
    let weather: WeatherResearch | null = null;
    for (const id of snapshot.childWorkIds) {
      const child = await app.works.get(id);
      const state = await child.snapshot();
      if (state.status !== 'completed') continue;
      if (state.definition.id === definitions.geographyResearch.id)
        geography = state.result as GeographyResearch;
      if (state.definition.id === definitions.weatherResearch.id)
        weather = state.result as WeatherResearch;
    }
    return { geography, weather };
  }
  async function pulse(nextBrief: AtlasBrief, reason: string) {
    const snapshot = await work.snapshot();
    if (!['completed', 'failed', 'canceled'].includes(snapshot.status))
      await work.cancel(reason, {
        idempotencyKey: `atlas-revise:${snapshot.id}:${stored.revision ?? 1}`,
      });
    stored.priorWorkIds = [...(stored.priorWorkIds ?? []), snapshot.id];
    stored.revision = (stored.revision ?? 1) + 1;
    stored.brief = nextBrief;
    work = await app.forPrincipal('maya').start(definitions.growAtlas, nextBrief, {
      idempotencyKey: `roam:${nextBrief.roomId}:pulse:${stored.revision}`,
    });
    stored.workId = work.id;
    save();
  }
  function knownWorld(worldId: string) {
    return buildJourneyWorlds(stored.brief).some((world) => world.id === worldId);
  }
  return {
    async state() {
      const [snapshot, inspection, facts] = await Promise.all([
        work.snapshot(),
        work.inspect({ detail: 'story', limit: 100 }),
        research(),
      ]);
      const result = snapshot.status === 'completed' ? snapshot.result : null;
      return {
        brief: stored.brief,
        work: snapshot,
        worlds: result?.worlds ?? buildJourneyWorlds(stored.brief),
        scouts: result?.scouts ?? [],
        ...facts,
        story: inspection.entries,
        memory: {
          revisions: stored.revision ?? 1,
          previousPulses: stored.priorWorkIds?.length ?? 0,
        },
      };
    },
    async create(input) {
      const origin = input.origin.trim();
      if (origin.length < 2 || origin.length > 80)
        throw new Error('Origin must be 2–80 characters');
      const start = Date.parse(`${input.startDate}T00:00:00Z`);
      const end = Date.parse(`${input.endDate}T00:00:00Z`);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
        throw new Error('Choose a valid date range');
      if (Math.round((end - start) / 86_400_000) !== 6)
        throw new Error('This atlas vignette currently spans exactly seven days');
      const now = new Date().toISOString();
      const signals = input.signals
        .slice(0, 8)
        .map((text, index) => ({
          id: `signal-${Date.now()}-${index}`,
          kind: 'fascination' as const,
          text: text.trim(),
          author: 'maya',
          createdAt: now,
        }))
        .filter((signal) => signal.text);
      await pulse(
        {
          ...stored.brief,
          title: 'Japan, still becoming',
          origin,
          startDate: input.startDate,
          endDate: input.endDate,
          activeWorldId: 'lantern-drift',
          signals: signals.length ? signals : stored.brief.signals,
          reactions: {},
        },
        'A new shared atlas was opened',
      );
    },
    async focus(worldId) {
      if (!knownWorld(worldId)) throw new Error('Unknown journey world');
      stored.brief = { ...stored.brief, activeWorldId: worldId };
      save();
    },
    async addSignal(input) {
      const text = input.text.trim();
      if (text.length < 2 || text.length > 120)
        throw new Error('A signal must be 2–120 characters');
      if (!['desire', 'mood', 'fascination', 'rhythm', 'constraint'].includes(input.kind))
        throw new Error('Unknown signal kind');
      const signal = {
        id: `signal-${Date.now()}`,
        kind: input.kind,
        text,
        author: input.author || 'maya',
        createdAt: new Date().toISOString(),
      };
      await pulse(
        { ...stored.brief, signals: [...stored.brief.signals, signal].slice(-24) },
        'The group added a new signal',
      );
    },
    async nudge(worldId, direction) {
      if (!knownWorld(worldId)) throw new Error('Unknown journey world');
      const count =
        Number(stored.brief.reactions[worldId] ?? 0) + (direction === 'closer' ? 1 : -1);
      await pulse(
        {
          ...stored.brief,
          activeWorldId: worldId,
          reactions: { ...stored.brief.reactions, [worldId]: count },
        },
        `The group pulled a world ${direction}`,
      );
    },
    async weave(signalId) {
      const latest = stored.brief.signals.at(-1);
      const other = stored.brief.signals.find((signal) => signal.id === signalId);
      if (!latest || !other) throw new Error('Choose two desires to weave');
      const signal = {
        id: `signal-weave-${Date.now()}`,
        kind: 'desire' as const,
        text: `${latest.text} + ${other.text}`,
        author: 'group',
        createdAt: new Date().toISOString(),
      };
      await pulse(
        { ...stored.brief, signals: [...stored.brief.signals, signal].slice(-24) },
        'Two participant desires were woven together',
      );
    },
    async saveTrail(worldId) {
      const world = buildJourneyWorlds(stored.brief).find((item) => item.id === worldId);
      if (!world) throw new Error('Unknown journey world');
      const desire = stored.brief.signals.at(-1)?.text ?? world.atmosphere;
      stored.brief = {
        ...stored.brief,
        activeWorldId: worldId,
        savedTrails: [
          ...(stored.brief.savedTrails ?? []),
          {
            id: `trail-${Date.now()}`,
            worldId,
            title: world.title,
            desire,
            savedAt: new Date().toISOString(),
          },
        ].slice(-12),
      };
      save();
    },
    async refresh() {
      await pulse(stored.brief, 'The scouts checked changing conditions');
    },
    close: () => app.close(),
  };
}

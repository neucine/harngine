import { createApp, type App, type Work, type WorkSnapshot } from 'harngine';
import type { HearthWorld, PersonId, Visibility } from './domain.js';
import { PublicDataClient } from './public-data.js';
import { HomeStore } from './store.js';
import { hearthDefinitions, type AttunementObjective } from './workflow.js';

export type HearthState = {
  viewer: PersonId;
  participants: { id: PersonId; name: string; initials: string; colour: string }[];
  work: WorkSnapshot<AttunementObjective, HearthWorld>;
  world: HearthWorld | null;
  story: Awaited<ReturnType<Work['inspect']>>;
};
export type Hearth = {
  state(viewer: PersonId): Promise<HearthState>;
  checkIn(input: {
    viewer: PersonId;
    energy: number;
    feeling: string;
    note: string;
    visibility: Visibility;
  }): Promise<void>;
  adoptRitual(viewer: PersonId, openingId: string): Promise<void>;
  dismiss(viewer: PersonId, openingId: string): Promise<void>;
  close(): Promise<void>;
};

export async function openHearth(options: {
  directory: string;
  store: HomeStore;
  publicData?: PublicDataClient;
}): Promise<Hearth> {
  const definitions = hearthDefinitions(options.publicData ?? new PublicDataClient());
  const app: App = createApp({
    directory: options.directory,
    workflows: [definitions.attune],
    tools: definitions.tools,
    access: {
      revision: 'hearth-consent-v2',
      canStart: ({ principal, objective }) =>
        principal === `household:${(objective as { viewer?: string }).viewer}`,
      canCall: ({ principal }) => principal === 'household:alex' || principal === 'household:sam',
      canRespond: () => false,
    },
  });
  const works = new Map<string, Work<AttunementObjective, HearthWorld>>();
  async function current(viewer: PersonId) {
    const home = await options.store.view(viewer);
    const key = `${viewer}:${home.version}`;
    let work = works.get(key);
    if (!work) {
      work = await app
        .forPrincipal(`household:${viewer}`)
        .start(
          definitions.attune,
          { viewer, home },
          { idempotencyKey: `attune:${home.homeId}:${key}` },
        );
      works.set(key, work);
    }
    return { home, work };
  }
  return {
    async state(viewer) {
      const { home, work } = await current(viewer);
      const snapshot = (await work.snapshot()) as WorkSnapshot<AttunementObjective, HearthWorld>;
      return {
        viewer,
        participants: home.participants,
        work: snapshot,
        world: snapshot.result ?? null,
        story: await work.inspect({ detail: 'story', limit: 40 }),
      };
    },
    async checkIn(input) {
      await options.store.checkIn({
        author: input.viewer,
        energy: input.energy,
        feeling: input.feeling,
        note: input.note,
        visibility: input.visibility,
        now: new Date().toISOString(),
      });
      await current(input.viewer);
    },
    async adoptRitual(viewer, openingId) {
      const { work } = await current(viewer);
      const snapshot = (await work.snapshot()) as WorkSnapshot<AttunementObjective, HearthWorld>;
      const opening = snapshot.result?.opening;
      if (!opening || opening.id !== openingId)
        throw new Error('This opening is no longer present');
      await options.store.adoptRitual({
        id: opening.id,
        ...opening.ritual,
        by: viewer,
        now: new Date().toISOString(),
      });
      await current(viewer);
    },
    async dismiss(viewer, openingId) {
      await options.store.dismissOpening(openingId, viewer, new Date().toISOString());
      await current(viewer);
    },
    close: () => app.close(),
  };
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  defaultHome,
  type CheckIn,
  type HomeRecord,
  type HomeView,
  type PersonId,
  type Ritual,
  type Visibility,
} from './domain.js';

export class HomeStore {
  private serial = Promise.resolve();
  constructor(private readonly file: string) {}
  private async read(): Promise<HomeRecord> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as HomeRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultHome();
      throw error;
    }
  }
  private async save(record: HomeRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const next = `${this.file}.next`;
    await writeFile(next, JSON.stringify(record, null, 2), { mode: 0o600 });
    await rename(next, this.file);
  }
  async view(viewer: PersonId): Promise<HomeView> {
    const record = await this.read();
    if (!record.participants.some((person) => person.id === viewer))
      throw new Error('Unknown household member');
    const visible = (value: CheckIn | HomeRecord['memories'][number] | Ritual) =>
      value.visibility === 'shared' ||
      ('author' in value
        ? value.author === viewer
        : 'contributors' in value
          ? value.contributors.includes(viewer)
          : value.createdBy === viewer);
    return {
      ...record,
      viewer,
      checkIns: record.checkIns.filter(visible),
      memories: record.memories.filter(visible),
      rituals: record.rituals.filter(visible),
    };
  }
  async checkIn(input: {
    author: PersonId;
    energy: number;
    feeling: string;
    note: string;
    visibility: Visibility;
    now: string;
  }): Promise<number> {
    if (!Number.isInteger(input.energy) || input.energy < 1 || input.energy > 5)
      throw new Error('Energy must be from 1 to 5');
    if (!input.feeling.trim() || input.feeling.length > 40)
      throw new Error('Choose a short feeling word');
    if (input.note.length > 280) throw new Error('A trace can be at most 280 characters');
    return this.mutate((record) =>
      record.checkIns.push({
        id: randomUUID(),
        author: input.author,
        energy: input.energy as CheckIn['energy'],
        feeling: input.feeling.trim(),
        note: input.note.trim(),
        visibility: input.visibility,
        createdAt: input.now,
      }),
    );
  }
  async adoptRitual(input: {
    id: string;
    title: string;
    description: string;
    cadence: string;
    by: PersonId;
    now: string;
  }): Promise<number> {
    return this.mutate((record) => {
      if (!record.rituals.some((ritual) => ritual.id === input.id))
        record.rituals.push({
          id: input.id,
          title: input.title,
          description: input.description,
          cadence: input.cadence,
          createdAt: input.now,
          createdBy: input.by,
          visibility: 'shared',
        });
    });
  }
  async dismissOpening(id: string, by: PersonId, now: string): Promise<number> {
    return this.mutate((record) => {
      if (!record.dismissedOpenings.some((item) => item.id === id && item.by === by))
        record.dismissedOpenings.push({ id, by, at: now });
    });
  }
  private async mutate(change: (record: HomeRecord) => unknown): Promise<number> {
    let version = 0;
    this.serial = this.serial.then(async () => {
      const record = await this.read();
      change(record);
      record.version += 1;
      version = record.version;
      await this.save(record);
    });
    await this.serial;
    return version;
  }
}

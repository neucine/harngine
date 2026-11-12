import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectIds, type MetObject, type SourcedObject } from './world.js';

export type ProviderMode = 'replay' | 'live' | 'safe-write';

interface RecordedObject {
  readonly contentHash: string;
  readonly payload: MetObject;
}

interface Recording {
  readonly recordingVersion: 1;
  readonly provider: 'met';
  readonly providerVersion: 'collection-api-v1';
  readonly fetchedAt: string;
  readonly source: string;
  readonly licence: 'CC0-1.0';
  readonly objects: readonly RecordedObject[];
}

const endpoint = 'https://collectionapi.metmuseum.org/public/collection/v1/objects';
const allowed = new Set<number>(objectIds);
const defaultRecordingPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../recordings/met-objects.json',
);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function normalized(value: Record<string, unknown>): MetObject {
  const fields = [
    'artistDisplayName',
    'classification',
    'creditLine',
    'culture',
    'department',
    'dimensions',
    'dynasty',
    'isPublicDomain',
    'medium',
    'objectBeginDate',
    'objectDate',
    'objectEndDate',
    'objectID',
    'objectName',
    'objectURL',
    'period',
    'primaryImage',
    'primaryImageSmall',
    'reign',
    'rightsAndReproduction',
    'tags',
    'title',
  ] as const;
  return Object.fromEntries(fields.map((field) => [field, value[field] ?? ''])) as MetObject;
}

export interface MetProviderOptions {
  readonly mode: ProviderMode;
  readonly recordingPath?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export class MetProvider {
  private readonly path: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(private readonly options: MetProviderOptions) {
    this.path = options.recordingPath ?? defaultRecordingPath;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async object(objectId: number, signal?: AbortSignal): Promise<SourcedObject> {
    if (!allowed.has(objectId)) throw new Error('Object is outside this case');
    if (this.options.mode === 'replay') return this.replay(objectId);
    const response = await this.fetcher(`${endpoint}/${objectId}`, {
      ...(signal ? { signal } : {}),
      headers: { Accept: 'application/json', 'User-Agent': 'Harngine-Quest/0.1' },
    });
    if (!response.ok) throw new Error(`The Met returned ${response.status}`);
    const object = normalized((await response.json()) as Record<string, unknown>);
    if (object.objectID !== objectId || !object.isPublicDomain)
      throw new Error('Provider response did not match the allowed public-domain object');
    const fetchedAt = this.now().toISOString();
    const hash = contentHash(object);
    if (this.options.mode === 'safe-write') await this.record(object, fetchedAt, hash);
    return this.sourced(object, fetchedAt, hash, this.options.mode);
  }

  private async replay(objectId: number): Promise<SourcedObject> {
    const recording = JSON.parse(await readFile(this.path, 'utf8')) as Recording;
    const saved = recording.objects.find((item) => item.payload.objectID === objectId);
    if (!saved) throw new Error(`No replay recording for Met object ${objectId}`);
    const actual = contentHash(saved.payload);
    if (actual !== saved.contentHash) throw new Error(`Recording hash mismatch for ${objectId}`);
    return this.sourced(saved.payload, recording.fetchedAt, saved.contentHash, 'replay');
  }

  private sourced(
    object: MetObject,
    fetchedAt: string,
    hash: string,
    mode: ProviderMode,
  ): SourcedObject {
    return {
      object,
      provenance: {
        provider: 'met',
        providerVersion: 'collection-api-v1',
        objectId: object.objectID,
        fetchedAt,
        mode,
        licence: 'CC0-1.0',
        rights: object.rightsAndReproduction || 'Public domain; collection data provided under CC0',
        sourceLink: object.objectURL,
        apiLink: `${endpoint}/${object.objectID}`,
        contentHash: hash,
      },
    };
  }

  private async record(object: MetObject, fetchedAt: string, hash: string): Promise<void> {
    const recording = JSON.parse(await readFile(this.path, 'utf8')) as Recording;
    const objects = [
      ...recording.objects.filter((item) => item.payload.objectID !== object.objectID),
      { contentHash: hash, payload: object },
    ].sort((left, right) => left.payload.objectID - right.payload.objectID);
    const next: Recording = { ...recording, fetchedAt, objects };
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
  }
}

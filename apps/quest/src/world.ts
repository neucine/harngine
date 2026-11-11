import type { Json } from 'harngine';

export const worldId = 'museum-of-nearby-things';
export const worldTitle = 'The Museum of Nearby Things';
export const objectIds = [444408, 337061, 198556, 544887] as const;
export const firstObjectId = objectIds[0];

export interface MetObject extends Record<string, Json> {
  readonly objectID: number;
  readonly title: string;
  readonly objectName: string;
  readonly artistDisplayName: string;
  readonly objectDate: string;
  readonly objectBeginDate: number;
  readonly objectEndDate: number;
  readonly medium: string;
  readonly classification: string;
  readonly creditLine: string;
  readonly department: string;
  readonly culture: string;
  readonly isPublicDomain: boolean;
  readonly primaryImage: string;
  readonly primaryImageSmall: string;
  readonly objectURL: string;
  readonly rightsAndReproduction: string;
  readonly tags: { readonly term: string; readonly Wikidata_URL?: string | null }[];
}

export interface Provenance extends Record<string, Json> {
  readonly provider: 'met';
  readonly providerVersion: 'collection-api-v1';
  readonly objectId: number;
  readonly fetchedAt: string;
  readonly mode: 'replay' | 'live' | 'safe-write';
  readonly licence: 'CC0-1.0';
  readonly rights: string;
  readonly sourceLink: string;
  readonly apiLink: string;
  readonly contentHash: string;
}

export interface SourcedObject {
  readonly object: MetObject;
  readonly provenance: Provenance;
}

export interface WorldObject {
  readonly id: number;
  readonly title: string;
  readonly kind: string;
  readonly date: string;
  readonly maker: string;
  readonly place: string;
  readonly material: string;
  readonly image: string;
  readonly motifs: readonly string[];
  readonly source: Provenance;
}

export function worldObject(source: SourcedObject): WorldObject {
  const object = source.object;
  return {
    id: object.objectID,
    title: object.title,
    kind: object.objectName || object.classification || 'Collection object',
    date: object.objectDate,
    maker: object.artistDisplayName || 'Maker unrecorded',
    place: object.culture || object.department,
    material: object.medium,
    image: object.primaryImageSmall,
    motifs: (object.tags ?? []).map((tag) => tag.term),
    source: source.provenance,
  };
}

export const editorialTrails = [
  { from: 444408, to: 337061, label: 'Ways of holding the sky', origin: 'curatorial' },
  { from: 337061, to: 198556, label: 'Knowledge made physical', origin: 'curatorial' },
  { from: 198556, to: 544887, label: 'Rooms, emblems, and power', origin: 'curatorial' },
] as const;

export const worldCopy = {
  title: worldTitle,
  subtitle: 'A living constellation of objects and the meanings people leave between them.',
  invitation:
    'There is nothing to finish here. Wander until something catches, leave a thought if you wish, and return later to see what grew nearby.',
} as const;

import { RuntimeError } from './internal/contracts.js';
import type { Json } from './types.js';

export type ArtifactReference = {
  readonly object: 'artifact';
  /** Stable application-owned handle used to resolve the content. */
  readonly id: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: `sha256:${string}`;
  readonly name?: string;
};

export type ArtifactReferenceInput = Omit<ArtifactReference, 'object'>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const FIELDS = new Set(['object', 'id', 'mediaType', 'byteLength', 'digest', 'name']);

/** Validate and freeze metadata for immutable application-owned content. */
export function artifactReference(input: ArtifactReferenceInput): ArtifactReference {
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 256)
    throw new RuntimeError('INVALID_DATA', 'Artifact id must contain 1–256 characters');
  if (typeof input.mediaType !== 'string' || !MEDIA_TYPE.test(input.mediaType))
    throw new RuntimeError('INVALID_DATA', 'Artifact mediaType must be a base MIME type');
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0)
    throw new RuntimeError('INVALID_DATA', 'Artifact byteLength must be a non-negative integer');
  if (typeof input.digest !== 'string' || !DIGEST.test(input.digest))
    throw new RuntimeError('INVALID_DATA', 'Artifact digest must be a lowercase sha256 digest');
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 512)
  )
    throw new RuntimeError('INVALID_DATA', 'Artifact name must contain 1–512 characters');
  return Object.freeze({
    object: 'artifact',
    id: input.id,
    mediaType: input.mediaType,
    byteLength: input.byteLength,
    digest: input.digest,
    ...(input.name === undefined ? {} : { name: input.name }),
  });
}

/**
 * Collect artifact references embedded in a selected JSON value.
 * An object using the reserved `object: 'artifact'` discriminator is validated rather than ignored.
 */
export function artifactReferences(value: Json): readonly ArtifactReference[] {
  const found = new Map<string, ArtifactReference>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) pending.push(current[index]);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record.object === 'artifact') {
      for (const field of Object.keys(record))
        if (!FIELDS.has(field))
          throw new RuntimeError(
            'INVALID_DATA',
            'Artifact references cannot contain payload or unrecognized fields',
          );
      const reference = artifactReference(record as unknown as ArtifactReferenceInput);
      found.set(`${reference.id}\0${reference.digest}`, reference);
      continue;
    }
    const values = Object.values(record);
    for (let index = values.length - 1; index >= 0; index--) pending.push(values[index]);
  }
  return Object.freeze([...found.values()]);
}

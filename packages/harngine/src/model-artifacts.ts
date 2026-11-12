import { createHash } from 'node:crypto';
import type { ArtifactReference } from './artifact.js';

export const DEFAULT_MODEL_ARTIFACT_LIMITS = Object.freeze({
  maxArtifacts: 8,
  maxArtifactBytes: 20 * 1024 * 1024,
  maxTotalArtifactBytes: 20 * 1024 * 1024,
});

export type ArtifactResolver = (
  reference: ArtifactReference,
  options: { readonly signal: AbortSignal },
) => Promise<Uint8Array>;

export interface ResolvedModelArtifact {
  readonly reference: ArtifactReference;
  readonly bytes: Uint8Array;
}

export interface ResolveModelArtifactsOptions {
  readonly resolve: ArtifactResolver;
  readonly allowedMediaTypes: readonly string[];
  readonly signal: AbortSignal;
  readonly maxArtifacts?: number;
  readonly maxArtifactBytes?: number;
  readonly maxTotalArtifactBytes?: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Model artifact ${name} must be a positive integer`);
  return value;
}

/**
 * Resolve application-owned bytes for the Artifact References selected into a model turn.
 * Callers must encode the verified bytes inline before starting provider I/O.
 */
export async function resolveModelArtifacts(
  references: readonly ArtifactReference[],
  options: ResolveModelArtifactsOptions,
): Promise<readonly ResolvedModelArtifact[]> {
  const maxArtifacts = positiveInteger(
    options.maxArtifacts ?? DEFAULT_MODEL_ARTIFACT_LIMITS.maxArtifacts,
    'maxArtifacts',
  );
  const maxArtifactBytes = positiveInteger(
    options.maxArtifactBytes ?? DEFAULT_MODEL_ARTIFACT_LIMITS.maxArtifactBytes,
    'maxArtifactBytes',
  );
  const maxTotalArtifactBytes = positiveInteger(
    options.maxTotalArtifactBytes ?? DEFAULT_MODEL_ARTIFACT_LIMITS.maxTotalArtifactBytes,
    'maxTotalArtifactBytes',
  );
  if (references.length > maxArtifacts)
    throw new Error(`Model input has ${references.length} Artifacts; maximum is ${maxArtifacts}`);

  const allowed = new Set(options.allowedMediaTypes.map((mediaType) => mediaType.toLowerCase()));
  if (allowed.size === 0) throw new Error('Model artifact media type allowlist is empty');

  let selectedBytes = 0;
  for (const reference of references) {
    options.signal.throwIfAborted();
    const mediaType = reference.mediaType.toLowerCase();
    if (!allowed.has(mediaType))
      throw new Error(
        `Model input does not support Artifact ${reference.id} with media type ${reference.mediaType}`,
      );
    if (reference.byteLength > maxArtifactBytes)
      throw new Error(
        `Artifact ${reference.id} has ${reference.byteLength} bytes; maximum per Artifact is ${maxArtifactBytes}`,
      );
    selectedBytes += reference.byteLength;
    if (selectedBytes > maxTotalArtifactBytes)
      throw new Error(
        `Model input Artifacts exceed the ${maxTotalArtifactBytes}-byte total maximum`,
      );
  }

  const resolved: ResolvedModelArtifact[] = [];
  for (const reference of references) {
    options.signal.throwIfAborted();
    let bytes: Uint8Array;
    try {
      bytes = await options.resolve(reference, { signal: options.signal });
    } catch (error) {
      options.signal.throwIfAborted();
      throw error;
    }
    options.signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array))
      throw new Error(`Artifact resolver returned invalid content for ${reference.id}`);
    if (bytes.byteLength !== reference.byteLength)
      throw new Error(
        `Artifact ${reference.id} expected ${reference.byteLength} bytes but resolved ${bytes.byteLength}`,
      );
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== reference.digest)
      throw new Error(`Artifact ${reference.id} failed SHA-256 content verification`);
    resolved.push(Object.freeze({ reference, bytes }));
  }
  return Object.freeze(resolved);
}

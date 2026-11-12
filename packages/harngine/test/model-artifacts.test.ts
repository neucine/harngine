import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { artifactReference, resolveModelArtifacts, type ArtifactReference } from '../src/index.js';

function reference(id: string, bytes: Uint8Array, mediaType = 'image/png'): ArtifactReference {
  return artifactReference({
    id,
    mediaType,
    byteLength: bytes.byteLength,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

describe('model artifact resolution', () => {
  test('resolves only the selected references and verifies exact bytes', async () => {
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const documentBytes = new TextEncoder().encode('%PDF-1.7\nfixture');
    const image = reference('image', imageBytes);
    const document = reference('document', documentBytes, 'application/pdf');
    const resolvedIds: string[] = [];
    const result = await resolveModelArtifacts([image, document], {
      allowedMediaTypes: ['image/png', 'application/pdf'],
      signal: new AbortController().signal,
      async resolve(candidate) {
        resolvedIds.push(candidate.id);
        return candidate.id === image.id ? imageBytes : documentBytes;
      },
    });

    expect(resolvedIds).toEqual(['image', 'document']);
    expect(result.map(({ reference }) => reference.id)).toEqual(['image', 'document']);
  });

  test('rejects byte length and digest mismatches', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const artifact = reference('verified-image', bytes);

    await expect(
      resolveModelArtifacts([artifact], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        resolve: async () => Uint8Array.from([1, 2]),
      }),
    ).rejects.toThrow('expected 3 bytes but resolved 2');
    await expect(
      resolveModelArtifacts([artifact], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        resolve: async () => Uint8Array.from([1, 2, 4]),
      }),
    ).rejects.toThrow('failed SHA-256 content verification');
  });

  test('rejects unsupported types, excessive counts, and excessive bytes before resolution', async () => {
    const png = Uint8Array.from([1, 2, 3]);
    const image = reference('image', png);
    const text = reference('text', png, 'text/plain');
    let resolutions = 0;
    const resolve = async () => {
      resolutions++;
      return png;
    };

    await expect(
      resolveModelArtifacts([text], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        resolve,
      }),
    ).rejects.toThrow('does not support Artifact text');
    await expect(
      resolveModelArtifacts([image, image], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        maxArtifacts: 1,
        resolve,
      }),
    ).rejects.toThrow('maximum is 1');
    await expect(
      resolveModelArtifacts([image], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        maxArtifactBytes: 2,
        resolve,
      }),
    ).rejects.toThrow('maximum per Artifact is 2');
    await expect(
      resolveModelArtifacts([image, image], {
        allowedMediaTypes: ['image/png'],
        signal: new AbortController().signal,
        maxTotalArtifactBytes: 5,
        resolve,
      }),
    ).rejects.toThrow('5-byte total maximum');
    expect(resolutions).toBe(0);
  });

  test('honors cancellation before and during application resolution', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const image = reference('image', bytes);
    const before = new AbortController();
    before.abort(new Error('cancelled before resolution'));
    await expect(
      resolveModelArtifacts([image], {
        allowedMediaTypes: ['image/png'],
        resolve: async () => bytes,
        signal: before.signal,
      }),
    ).rejects.toThrow();

    const during = new AbortController();
    const pending = resolveModelArtifacts([image], {
      allowedMediaTypes: ['image/png'],
      signal: during.signal,
      resolve: async (_candidate, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          });
        }),
    });
    during.abort(new Error('cancelled during resolution'));
    await expect(pending).rejects.toThrow('cancelled during resolution');
  });
});

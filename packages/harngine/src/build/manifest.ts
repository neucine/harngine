import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RuntimeError } from '../internal/contracts.js';
import { digest } from '../schema.js';
import type { Json } from '../types.js';

interface RevisionManifest {
  readonly format: 1;
  readonly definitions: Readonly<Record<string, string>>;
}

let cachedPath: string | undefined;
let cachedManifest: RevisionManifest | undefined;

function manifest(): RevisionManifest {
  const path = resolve(process.env.HARNGINE_MANIFEST ?? '.harngine/manifest.json');
  if (path === cachedPath && cachedManifest) return cachedManifest;
  let parsed: RevisionManifest;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as RevisionManifest;
  } catch {
    throw new RuntimeError(
      'DEFINITION_MANIFEST_MISSING',
      `Generated definition manifest not found at ${path}; run harngine-manifest with Bun`,
    );
  }
  if (parsed.format !== 1 || !parsed.definitions || typeof parsed.definitions !== 'object')
    throw new RuntimeError('INVALID_DEFINITION_MANIFEST', 'Invalid Harngine definition manifest');
  cachedPath = path;
  cachedManifest = parsed;
  return parsed;
}

export function definitionRevision(
  kind: 'agent' | 'workflow' | 'tool',
  id: string,
  config: unknown,
) {
  const source = manifest().definitions[`${kind}:${id}`];
  if (!source)
    throw new RuntimeError(
      'DEFINITION_MANIFEST_MISSING',
      `Definition ${kind}:${id} is absent from the generated manifest`,
    );
  // A base64url-encoded 96-bit digest keeps prefixed revisions compact while retaining practical
  // collision resistance for definition-scale content addressing.
  const compact = Buffer.from(
    digest({ source, config } as unknown as Json).slice(0, 24),
    'hex',
  ).toString('base64url');
  return `rev_${compact}` as const;
}

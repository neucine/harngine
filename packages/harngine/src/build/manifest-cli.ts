#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? join(root, '.harngine/manifest.json'));
const ignored = new Set(['.git', '.harngine', 'coverage', 'dist', 'node_modules']);
const extensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const files: string[] = [];

function visit(directory: string): void {
  for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) visit(path);
    else if ([...extensions].some((extension) => name.endsWith(extension))) files.push(path);
  }
}

visit(root);
const sources = new Map<string, string>();
const owners = new Map<string, Set<string>>();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  sources.set(file, source);
  for (const match of source.matchAll(/\bid\s*:\s*(['"])([^'"\\]{1,256})\1/g)) {
    const found = owners.get(match[2]!) ?? new Set<string>();
    found.add(file);
    owners.set(match[2]!, found);
  }
}

function dependency(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return;
  const path = resolve(dirname(from), specifier);
  const suffix = extname(path);
  const candidates = suffix
    ? [path, ...[...extensions].map((extension) => `${path.slice(0, -suffix.length)}${extension}`)]
    : [...extensions].map((extension) => `${path}${extension}`);
  candidates.push(...[...extensions].map((extension) => join(path, `index${extension}`)));
  return candidates.find((candidate) => sources.has(candidate));
}

function sourceDigest(start: Set<string>): string {
  const related = new Set<string>();
  const pending = [...start];
  while (pending.length) {
    const file = pending.pop()!;
    if (related.has(file)) continue;
    related.add(file);
    const source = sources.get(file)!;
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g,
    )) {
      const imported = dependency(file, match[1]!);
      if (imported && !related.has(imported)) pending.push(imported);
    }
  }
  const hash = createHash('sha256');
  for (const file of [...related].sort())
    hash.update(relative(root, file)).update('\0').update(sources.get(file)!).update('\0');
  return hash.digest('hex');
}

const definitions: Record<string, string> = {};
for (const id of [...owners.keys()].sort()) {
  const source = sourceDigest(owners.get(id)!);
  for (const kind of ['agent', 'workflow', 'tool'] as const) definitions[`${kind}:${id}`] = source;
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ format: 1, definitions }, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote ${Object.keys(definitions).length} Harngine definition entries to ${output}`);

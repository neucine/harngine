#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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
const hash = createHash('sha256');
const ids = new Set<string>();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  hash.update(relative(root, file)).update('\0').update(source).update('\0');
  for (const match of source.matchAll(/\bid\s*:\s*(['"])([^'"\\]{1,256})\1/g)) ids.add(match[2]!);
}
const source = hash.digest('hex');
const definitions: Record<string, string> = {};
for (const id of [...ids].sort())
  for (const kind of ['agent', 'workflow', 'tool'] as const) definitions[`${kind}:${id}`] = source;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ format: 1, definitions }, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote ${Object.keys(definitions).length} Harngine definition entries to ${output}`);

import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtime = process.env.HARNGINE_NODE_BINARY ?? join(root, 'node_modules/node/bin/node');
execFileSync(runtime, [join(root, 'scripts/coding-magpie-smoke.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

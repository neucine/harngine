import { rm } from 'node:fs/promises';

const outputs = [
  'packages/harngine/dist',
  'packages/codex-cli/dist',
  'apps/coding/agent/dist',
  'apps/coding/cli/dist',
  'apps/coding/demo/dist',
  'apps/hearth/dist',
  'apps/quest/dist',
  'apps/roam/dist',
  'apps/muse/dist',
];

await Promise.all(outputs.map((output) => rm(output, { recursive: true, force: true })));

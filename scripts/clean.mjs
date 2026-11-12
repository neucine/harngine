import { rm } from 'node:fs/promises';

const outputs = [
  'packages/harngine/dist',
  'packages/codex-cli/dist',
  'apps/coding/agent/dist',
  'apps/coding/cli/dist',
  'apps/coding/demo/dist',
  'examples/hearth/dist',
  'examples/quest/dist',
  'examples/roam/dist',
  'examples/muse/dist',
];

await Promise.all(outputs.map((output) => rm(output, { recursive: true, force: true })));

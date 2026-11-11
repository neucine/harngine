import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const safePath = process.env.PATH.split(':')
  .filter(
    (entry) => !entry.includes('node_modules/.bin') && !entry.includes('/codex-cli/codex-path'),
  )
  .join(':');
const node = safePath
  .split(':')
  .map((entry) => join(entry, 'node'))
  .find(existsSync);
if (!node) throw new Error('Node.js is required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argumentsForTarget = process.argv.slice(3);
const repositoryArgument = argumentsForTarget.indexOf('--repo');
if (repositoryArgument >= 0) {
  const repository = argumentsForTarget[repositoryArgument + 1];
  if (!repository || !existsSync(repository) || !statSync(repository).isDirectory()) {
    console.error(
      `Repository directory does not exist: ${repository ?? '(missing)'}. Pass an actual path, for example --repo .`,
    );
    process.exit(2);
  }
}
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PATH: safePath },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('bun', ['packages/harngine/src/build/manifest-cli.ts']);
run(node, ['node_modules/typescript/bin/tsc', '-b', 'apps/coding/cli', '--force']);
const target = 'apps/coding/cli/dist/cli.js';
run(node, [resolve(root, target), ...argumentsForTarget]);

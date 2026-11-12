import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/coding/desktop');
const output = resolve(desktop, 'server');
const args = process.argv.slice(2);
const at = args.indexOf('--repo');
if (at < 0 || !args[at + 1]) throw new Error('Usage: bun run agent:desktop --repo <path>');
const repo = resolve(args[at + 1]);
if (!existsSync(repo) || !statSync(repo).isDirectory())
  throw new Error(`Repository directory does not exist: ${repo}`);
const run = (command, commandArgs, cwd = root, env = process.env) => {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
};
run('bun', ['packages/harngine/src/build/manifest-cli.ts']);
run('bun', ['node_modules/typescript/bin/tsc', '-b', 'apps/coding/agent', '--force']);
mkdirSync(resolve(output, 'bin'), { recursive: true });
run('bun', [
  'build',
  'apps/coding/agent/src/main.ts',
  '--target=node',
  '--external=better-sqlite3',
  `--outfile=${resolve(output, 'main.mjs')}`,
]);
cpSync(resolve(root, 'node_modules/node/bin/node'), resolve(output, 'bin/node'));
cpSync(
  resolve(root, 'node_modules/better-sqlite3'),
  resolve(output, 'node_modules/better-sqlite3'),
  { recursive: true, force: true },
);
cpSync(resolve(root, '.harngine/manifest.json'), resolve(output, 'manifest.json'));
const codex = spawnSync('which', ['codex'], { encoding: 'utf8' });
writeFileSync(
  resolve(output, 'config.json'),
  JSON.stringify({ repo, ...(codex.status === 0 ? { codexCli: codex.stdout.trim() } : {}) }),
);
writeFileSync(
  resolve(desktop, 'web/agent-config.ts'),
  `export const workspace = ${JSON.stringify(repo)};\n`,
);
const neivRoot = process.env.NEIV_ROOT ?? resolve(desktop, '../../../../neiv');
const neiv = resolve(neivRoot, 'packages/neiv/bin/neiv.mjs');
const weivPackage = resolve(neivRoot, '../weiv/packages/weiv');
const selectedWeivPackage = process.env.WEIV_PACKAGE_ROOT || weivPackage;
if (!existsSync(resolve(selectedWeivPackage, 'bin/weiv.mjs')))
  throw new Error('Coding Desktop requires the current Weiv checkout. Set WEIV_PACKAGE_ROOT to its packages/weiv directory.');
run(process.execPath, [neiv, 'build', desktop], neivRoot, { ...process.env, WEIV_PACKAGE_ROOT: selectedWeivPackage });
console.log(`Desktop app ready: ${resolve(desktop, 'build/NeivApp.app')}`);

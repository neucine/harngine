import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const nodeRuntime = process.env.HARNGINE_NODE_BINARY ?? join(root, 'node_modules/node/bin/node');
const directory = mkdtempSync(join(tmpdir(), 'harngine-quickstart-'));
try {
  execFileSync('bun', ['pm', 'pack', '--destination', directory], {
    cwd: join(root, 'packages/harngine'),
    stdio: 'pipe',
  });
  const tarball = join(
    directory,
    readdirSync(directory).find((name) => name.endsWith('.tgz')),
  );
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { harngine: `file:${tarball}` },
    }),
  );
  copyFileSync(join(root, 'examples/quickstart/demo.mjs'), join(directory, 'demo.mjs'));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: directory,
    stdio: 'inherit',
  });
  execFileSync('bun', [join(directory, 'node_modules/.bin/harngine-manifest')], {
    cwd: directory,
    stdio: 'inherit',
  });
  execFileSync(nodeRuntime, ['demo.mjs'], { cwd: directory, stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}

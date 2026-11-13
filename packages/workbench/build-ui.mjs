import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'public');
mkdirSync(output, { recursive: true });
const source = join(root, 'src/ui');
const fingerprintFile = join(output, 'source.sha256');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function fingerprint() {
  const hash = createHash('sha256');
  for (const path of files(source).sort()) {
    hash.update(path.slice(source.length));
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}
function useCheckedInAssets() {
  if (
    existsSync(join(output, 'bundle.mjs')) &&
    existsSync(fingerprintFile) &&
    readFileSync(fingerprintFile, 'utf8').trim() === fingerprint()
  )
    return;
  throw new Error(
    'Weiv compiler is unavailable and checked-in Workbench assets do not match the UI source',
  );
}
const compiler = join(root, '../../node_modules/weivjs/bin/weiv.mjs');
if (!existsSync(compiler)) {
  useCheckedInAssets();
  process.exit(0);
}
const result = spawnSync(
  process.execPath,
  [compiler, 'compile', 'emit', 'app', join(root, 'src/ui/App.weiv'), output],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  if (
    /Could not resolve weiv binary|Expected optional dependency/.test(result.stdout + result.stderr)
  ) {
    useCheckedInAssets();
    process.exit(0);
  }
  throw new Error(result.stdout + result.stderr);
}
const generated = readFileSync(join(output, 'styles.css'), 'utf8');
writeFileSync(
  join(output, 'styles.css'),
  readFileSync(join(root, 'src/ui/styles.css'), 'utf8').trimEnd() + '\n' + generated.trimEnd() + '\n',
);
copyFileSync(join(root, 'src/ui/index.html'), join(output, 'index.html'));
writeFileSync(fingerprintFile, fingerprint() + '\n');
for (const file of ['server.ts', 'package.json']) rmSync(join(output, file), { force: true });

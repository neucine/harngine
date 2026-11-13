import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const packages = ['harngine', 'claude-messages', 'http', 'mcp', 'openai-responses', 'retrieval'];

execFileSync('npm', ['whoami'], { stdio: 'inherit' });
const destination = mkdtempSync(join(tmpdir(), 'harngine-release-'));
try {
  for (const name of packages) {
    const cwd = resolve(root, 'packages', name);
    execFileSync('bun', ['pm', 'pack', '--destination', destination], { cwd, stdio: 'inherit' });
    const prefix = name === 'harngine' ? 'harngine-' : `harngine-${name}-`;
    const tarball = readdirSync(destination).find(
      (file) => file.startsWith(prefix) && file.endsWith('.tgz'),
    );
    if (!tarball) throw new Error(`Missing tarball for ${name}`);
    execFileSync('npm', ['publish', join(destination, tarball), '--access', 'public'], {
      stdio: 'inherit',
    });
  }
} finally {
  rmSync(destination, { recursive: true, force: true });
}

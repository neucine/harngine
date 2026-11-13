import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const packages = ['harngine', 'claude-messages', 'http', 'mcp', 'openai-responses', 'retrieval'];

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function packageName(name) {
  return name === 'harngine' ? 'harngine' : `@harngine/${name}`;
}

function isPublished(name, version) {
  try {
    const published = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return published === version;
  } catch {
    return false;
  }
}

function hasGitHubRelease(tag) {
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const version = JSON.parse(
  readFileSync(resolve(root, 'packages/harngine/package.json'), 'utf8'),
).version;
const tag = `v${version}`;

for (const name of packages) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'),
  );
  if (manifest.version !== version) {
    throw new Error(
      `${manifest.name}@${manifest.version} does not match release version ${version}`,
    );
  }
}

execFileSync('npm', ['whoami'], { stdio: 'inherit' });
execFileSync('gh', ['auth', 'status'], { stdio: 'inherit' });
const remoteTag = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
  encoding: 'utf8',
}).trim();
if (!remoteTag) throw new Error(`Release tag ${tag} has not been pushed to origin`);

const destination = mkdtempSync(join(tmpdir(), 'harngine-release-'));
try {
  for (const name of packages) {
    const npmName = packageName(name);
    if (isPublished(npmName, version)) {
      console.log(`Skipping ${npmName}@${version}: already published`);
      continue;
    }

    const cwd = resolve(root, 'packages', name);
    run('bun', ['pm', 'pack', '--destination', destination], { cwd });
    const prefix = name === 'harngine' ? 'harngine-' : `harngine-${name}-`;
    const tarball = readdirSync(destination).find(
      (file) => file.startsWith(prefix) && file.endsWith('.tgz'),
    );
    if (!tarball) throw new Error(`Missing tarball for ${name}`);
    run('npm', ['publish', join(destination, tarball), '--access', 'public']);
  }
} finally {
  rmSync(destination, { recursive: true, force: true });
}

if (hasGitHubRelease(tag)) {
  console.log(`Skipping GitHub release ${tag}: already exists`);
} else {
  run(
    'gh',
    [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--title',
      `Harngine ${tag}`,
      '--generate-notes',
      '--latest',
    ],
    { cwd: root },
  );
}

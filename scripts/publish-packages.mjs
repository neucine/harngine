import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const configDirectory = process.env.NPM_TOKEN ? mkdtempSync(join(tmpdir(), 'harngine-npm-')) : null;
if (configDirectory) {
  const config = join(configDirectory, 'npmrc');
  writeFileSync(config, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`, {
    mode: 0o600,
  });
  process.env.NPM_CONFIG_USERCONFIG = config;
}
if (process.env.GITHUB_RELEASE_TOKEN) process.env.GH_TOKEN = process.env.GITHUB_RELEASE_TOKEN;
try {
  execFileSync('npm', ['whoami'], { stdio: 'inherit' });
  execFileSync('gh', ['auth', 'status'], { stdio: 'inherit' });
  const remoteTag = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    encoding: 'utf8',
  }).trim();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (remoteTag) {
    const tagged = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`], {
      encoding: 'utf8',
    }).trim();
    const target = tagged ? tagged.split(/\s/)[0] : remoteTag.split(/\s/)[0];
    if (target !== commit) throw new Error(`Release tag ${tag} points to another commit`);
  } else {
    if (!process.env.BUILDKITE) throw new Error(`Release tag ${tag} has not been pushed to origin`);
    run('gh', [
      'api',
      'repos/neucine/harngine/git/refs',
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${commit}`,
    ]);
  }

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
} finally {
  if (configDirectory) rmSync(configDirectory, { recursive: true, force: true });
}

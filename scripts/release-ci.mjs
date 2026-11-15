import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const names = ['harngine', 'claude-messages', 'http', 'mcp', 'openai-responses', 'retrieval'];
const branchPattern = /^release\/v(\d+\.\d+\.\d+)$/;
const command = process.argv[2];
const run = (file, args) => execFileSync(file, args, { cwd: root, encoding: 'utf8' }).trim();
const version = JSON.parse(readFileSync(resolve(root, 'packages/harngine/package.json'))).version;
const sha = process.env.BUILDKITE_COMMIT;

function checkVersions(expected) {
  if (version !== expected) throw new Error(`Harngine version ${version} differs from ${expected}`);
  for (const name of names) {
    const manifest = JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`)));
    if (manifest.version !== expected)
      throw new Error(`${manifest.name} version differs from ${expected}`);
  }
}

function checkCommit() {
  if (!sha || run('git', ['rev-parse', 'HEAD']) !== sha)
    throw new Error('Checkout differs from Buildkite commit');
}

function meta(key, value) {
  return run('buildkite-agent', [
    'meta-data',
    value === undefined ? 'get' : 'set',
    key,
    ...(value === undefined ? [] : [value]),
  ]);
}

if (command === 'candidate') {
  const match = branchPattern.exec(process.env.BUILDKITE_BRANCH ?? '');
  if (!match) throw new Error('Expected a release/vX.Y.Z branch');
  checkCommit();
  checkVersions(match[1]);
  console.log(`Candidate v${version} at ${sha}`);
} else if (command === 'detect') {
  if (process.env.BUILDKITE_BRANCH !== 'main') throw new Error('Release detection requires main');
  checkCommit();
  const pulls = JSON.parse(run('gh', ['api', `repos/neucine/harngine/commits/${sha}/pulls`]));
  const matches = pulls.filter(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === sha &&
      pr.base.ref === 'main' &&
      branchPattern.test(pr.head.ref),
  );
  if (matches.length > 1) throw new Error('Multiple merged release PRs point to this commit');
  if (matches.length === 0) {
    console.log('Ordinary main commit');
  } else {
    const selected = branchPattern.exec(matches[0].head.ref)[1];
    checkVersions(selected);
    meta('release_commit', sha);
    meta('release_tag', `v${selected}`);
    execFileSync('buildkite-agent', ['pipeline', 'upload', '.buildkite/merged-release.yml'], {
      cwd: root,
      stdio: 'inherit',
    });
    console.log(`Release v${selected} from PR #${matches[0].number} awaits approval`);
  }
} else if (command === 'publish') {
  checkCommit();
  checkVersions(meta('release_tag').slice(1));
  if (meta('release_commit') !== sha)
    throw new Error('Approved release commit differs from checkout');
  execFileSync('node', ['scripts/publish-packages.mjs'], { cwd: root, stdio: 'inherit' });
} else {
  throw new Error('Usage: node scripts/release-ci.mjs candidate|detect|publish');
}

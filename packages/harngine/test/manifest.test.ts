import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('definition source revisions follow local dependencies without following unrelated UI files', () => {
  const root = mkdtempSync(join(tmpdir(), 'harngine-manifest-'));
  const output = join(root, 'manifest.json');
  const script = resolve('packages/harngine/src/build/manifest-cli.ts');
  const generate = () => {
    execFileSync('bun', [script, root, output], { stdio: 'pipe' });
    return JSON.parse(readFileSync(output, 'utf8')).definitions['agent:example.agent'];
  };
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/agent.ts'),
      "import { answer } from './answer.js';\nexport const definition = { id: 'example.agent', answer };\n",
    );
    writeFileSync(join(root, 'src/answer.ts'), 'export const answer = 42;\n');
    writeFileSync(join(root, 'src/page.ts'), 'export const heading = "First";\n');
    const first = generate();
    writeFileSync(join(root, 'src/page.ts'), 'export const heading = "Second";\n');
    expect(generate()).toBe(first);
    writeFileSync(join(root, 'src/answer.ts'), 'export const answer = 43;\n');
    expect(generate()).not.toBe(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

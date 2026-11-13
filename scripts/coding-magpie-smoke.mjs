import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodingApp } from '../apps/coding/agent/dist/app.js';

process.env.HARNGINE_CODING_PROVIDER ??= 'openai-responses';
process.env.HARNGINE_CODING_API_BASE_URL ??= 'http://127.0.0.1:3425/v1';
process.env.HARNGINE_CODING_API_TOKEN ??= 'magpie';
process.env.CODEX_MODEL ??= 'codex/gpt-6.1-sol';

if (process.env.HARNGINE_SMOKE_DEBUG) {
  const request = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await request(input, init);
    if (String(input).endsWith('/responses')) console.error(await response.clone().text());
    return response;
  };
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-magpie-coding-')));
writeFileSync(join(root, 'README.md'), 'Magpie coding smoke marker: durable-agent-ok\n');

let coding;
try {
  coding = createCodingApp({ repo: root, writable: false });
  const work = await coding.app.start(
    coding.assistant,
    'Call coding.read for README.md, then reply with the exact marker line from that file.',
  );
  const answer = await work.result({ signal: AbortSignal.timeout(180_000) });
  assert.match(String(answer), /durable-agent-ok/);
  const inspection = await work.inspect({ detail: 'diagnostic' });
  const read = inspection.entries.find(
    (entry) =>
      entry.type === 'call' &&
      entry.phase === 'settled' &&
      entry.tool.id === 'coding.read' &&
      entry.diagnostic?.outcome?.status === 'success',
  );
  assert(read, 'Coding Agent did not complete the coding.read Tool call');
  console.log(
    JSON.stringify({
      provider: process.env.HARNGINE_CODING_PROVIDER,
      model: process.env.CODEX_MODEL,
      answer,
      tool: read.tool.id,
    }),
  );
} finally {
  await coding?.app.close();
  rmSync(root, { recursive: true, force: true });
}

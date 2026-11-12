import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const nodeRuntime = process.env.HARNGINE_NODE_BINARY ?? join(root, 'node_modules/node/bin/node');
const temp = realpathSync(mkdtempSync(join(root, '.tmp-package-')));
const environment = { ...process.env, TMPDIR: temp };
try {
  execFileSync('bun', ['pm', 'pack', '--destination', temp], {
    cwd: join(root, 'packages/harngine'),
    stdio: 'pipe',
  });
  const tarball = join(temp, 'harngine-0.1.0-alpha.0.tgz');
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  assert(files.includes('package/dist/index.js'));
  assert(files.includes('package/dist/internal/index.js'));
  assert(files.includes('package/LICENSE'));
  assert(!files.includes('/src/') && !files.includes('/test/') && !files.includes('ARCHITECTURE'));
  execFileSync('bun', ['pm', 'pack', '--destination', temp], {
    cwd: join(root, 'packages/workbench'),
    stdio: 'pipe',
  });
  const workbenchTarball = join(
    temp,
    readdirSync(temp).find((name) => name.includes('workbench') && name.endsWith('.tgz')),
  );
  const workbenchFiles = execFileSync('tar', ['-tzf', workbenchTarball], { encoding: 'utf8' });
  assert(workbenchFiles.includes('package/dist/index.js'));
  assert(workbenchFiles.includes('package/dist/cli.js'));
  assert(workbenchFiles.includes('package/LICENSE'));
  execFileSync('bun', ['pm', 'pack', '--destination', temp], {
    cwd: join(root, 'packages/mcp'),
    stdio: 'pipe',
  });
  const mcpTarball = join(
    temp,
    readdirSync(temp).find((name) => name.includes('mcp') && name.endsWith('.tgz')),
  );
  const mcpFiles = execFileSync('tar', ['-tzf', mcpTarball], { encoding: 'utf8' });
  assert(mcpFiles.includes('package/dist/index.js'));
  assert(mcpFiles.includes('package/dist/catalog.js'));
  execFileSync('bun', ['pm', 'pack', '--destination', temp], {
    cwd: join(root, 'packages/http'),
    stdio: 'pipe',
  });
  const httpTarball = join(
    temp,
    readdirSync(temp).find((name) => name.includes('http') && name.endsWith('.tgz')),
  );
  const httpFiles = execFileSync('tar', ['-tzf', httpTarball], { encoding: 'utf8' });
  assert(httpFiles.includes('package/dist/index.js'));
  assert(httpFiles.includes('package/openapi.yaml'));
  writeFileSync(
    join(temp, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      trustedDependencies: [],
      dependencies: {
        harngine: tarball,
        '@harngine/http': httpTarball,
        '@harngine/mcp': mcpTarball,
        '@harngine/workbench': workbenchTarball,
      },
      overrides: { harngine: tarball },
    }),
  );
  execFileSync('bun', ['install'], { cwd: temp, stdio: 'pipe', env: environment });
  const source = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createApp, schema, tool, workflow } from 'harngine';
    import { createHarngineHttpServer } from '@harngine/http';
    import { mcpToolCatalog, mcpToolFromCatalog } from '@harngine/mcp';
    import { serveWorkbench } from '@harngine/workbench';

    const openapi = readFileSync(
      new URL(import.meta.resolve('@harngine/http/openapi.yaml')),
      'utf8',
    );
    assert.match(openapi, /^openapi: 3\\.1\\.0$/m);

    const number = schema({ id: 'smoke.number', version: '1', jsonSchema: { type: 'integer' } });
    const double = tool({ id: 'smoke.double', description: 'Double an integer.', input: number,
      output: number, effect: 'read', execute: value => value * 2 });
    const calculation = workflow({ id: 'smoke.calculation', objective: number, result: number,
      tools: [double], run: (objective, flow) => flow.call('double', double, objective) });
    const app = createApp({ directory: join(process.cwd(), 'runtime'), workflows: [calculation], tools: [double] });
    assert.equal(await app.run(calculation, 21), 42);
    const work = await app.start(calculation, 5);
    assert.equal(await work.result(), 10);
    const page = await work.inspect({ detail: 'diagnostic' });
    assert.equal(page.work.status, 'completed');
    assert(page.entries.some(entry => entry.type === 'work.closed'));
    const remote = mcpToolFromCatalog(mcpToolCatalog({
      object: 'mcp_tool_catalog',
      tools: [{ name: 'lookup', inputSchema: {
        type: 'object', required: ['id'], properties: { id: { type: 'string' } },
      } }],
    }), {
      id: 'smoke.remote',
      name: 'lookup',
      effect: 'read',
      client: { async callTool(input) {
        return { content: [{ type: 'text', text: 'Found ' + input.arguments.id }] };
      } },
    });
    assert.equal(remote.id, 'smoke.remote');
    assert.equal(typeof createHarngineHttpServer, 'function');
    assert.deepEqual(await remote.execute({ id: 'record' }, {
      signal: new AbortController().signal,
      idempotencyKey: 'smoke-mcp',
      fail(error) { throw new Error(error.code); },
      effectUnknown(error) { throw new Error(error.code); },
    }), { content: [{ type: 'text', text: 'Found record' }] });
    const raw = await app.diagnostics.records(work.id, { limit: 2 });
    assert.equal(raw.records[0].table, 'work');
    const server = await serveWorkbench({ app });
    const definitions = await fetch(server.url + 'api/v1/definitions', {
      headers: { authorization: 'Bearer ' + server.capability },
    });
    assert.equal(definitions.status, 200);
    assert.equal((await definitions.json()).definitions.length, 2);
    await server.close();
    await app.close();
    console.log('Packed public package passed Node ' + process.versions.node + ' smoke test');
  `;
  writeFileSync(join(temp, 'smoke.mjs'), source);
  execFileSync('bun', [join(temp, 'node_modules/.bin/harngine-manifest')], {
    cwd: temp,
    stdio: 'pipe',
    env: environment,
  });
  execFileSync(nodeRuntime, ['smoke.mjs'], { cwd: temp, stdio: 'inherit' });
  execFileSync('bun', [join(root, 'packages/workbench/dist/cli.js'), '--help'], {
    cwd: temp,
    stdio: 'pipe',
    env: environment,
  });

  const consumer = `
    import { agent, createApp, schema, tool, workflow, type ModelAdapter, type Work } from 'harngine';
    const text = schema<string>({ id: 'typed.text', version: '1', jsonSchema: { type: 'string' } });
    const echo = tool({ id: 'typed.echo', description: 'Echo text.', input: text, output: text,
      effect: 'read', execute: value => value });
    const flow = workflow({ id: 'typed.flow', objective: text, result: text, tools: [echo],
      run: (objective, api) => api.call('echo', echo, objective) });
    declare const model: ModelAdapter;
    const assistant = agent({ id: 'typed.agent', instructions: 'Answer.', objective: text, model });
    declare const app: ReturnType<typeof createApp>;
    async function check() {
      const work: Work<string, string> = await app.start(flow, 'hello');
      const result: string = await app.run(assistant, 'hello');
      // @ts-expect-error Objective type is inferred from the Workflow.
      await app.run(flow, 42);
      void work; void result;
    }
    void check;
  `;
  writeFileSync(join(temp, 'consumer.ts'), consumer);
  execFileSync(
    'bun',
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--strict',
      '--noEmit',
      '--target',
      'ES2024',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--skipLibCheck',
      'consumer.ts',
    ],
    { cwd: temp, stdio: 'inherit', env: environment },
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

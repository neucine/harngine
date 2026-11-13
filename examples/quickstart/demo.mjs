import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp, schema, tool, workflow } from 'harngine';

const directory = realpathSync(
  process.env.HARNGINE_DEMO_DIRECTORY ?? mkdtempSync(join(tmpdir(), 'harngine-demo-')),
);
const number = schema({ id: 'demo.number', version: '1', jsonSchema: { type: 'integer' } });
const record = tool({
  id: 'demo.record',
  description: 'Record one durable calculation.',
  input: number,
  output: number,
  effect: 'read',
  execute(value) {
    return value * 2;
  },
});
const calculation = workflow({
  id: 'demo.calculation',
  objective: number,
  result: number,
  tools: [record],
  async run(value, flow) {
    const answer = await flow.call('record', record, value);
    await flow.sleep('restart-window', 2_000);
    return answer;
  },
});

if (process.argv[2] === 'worker') {
  const app = createApp({ directory, workflows: [calculation], tools: [record] });
  const work = await app.start(calculation, 21);
  process.send?.({ type: 'started', id: work.id });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = await work.snapshot();
    if (snapshot.waitingFor === 'timer') {
      process.send?.({ type: 'timer', id: work.id });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
} else {
  const child = fork(import.meta.filename, ['worker'], {
    env: { ...process.env, HARNGINE_DEMO_DIRECTORY: directory },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  try {
    const timer = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Work did not reach its durable timer')),
        15_000,
      );
      child.on('message', (message) => {
        if (message.type === 'timer') {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      child.once('exit', () => reject(new Error('Worker exited before the timer')));
    });
    child.kill('SIGKILL');
    await once(child, 'exit');
    console.log(`Killed process while ${timer.id} waited on a durable timer.`);

    const app = createApp({ directory, workflows: [calculation], tools: [record] });
    try {
      const work = await app.works.get(timer.id);
      const result = await work.result();
      const inspection = await work.inspect({ detail: 'diagnostic' });
      assert.equal(result, 42);
      assert.equal(inspection.work.status, 'completed');
      const settled = inspection.entries.filter(
        (entry) => entry.type === 'call' && entry.phase === 'settled',
      );
      assert.equal(settled.length, 1);
      assert.equal(settled[0].attemptCount, 1);
      assert(inspection.entries.some((entry) => entry.type === 'work.closed'));
      console.log(`Recovered ${work.id}: result=${result}, settled tool calls=${settled.length}`);
      console.log('Inspection:', inspection.entries.map((entry) => entry.type).join(' -> '));
      console.log(`SQLite work directory: ${directory}`);
    } finally {
      await app.close();
    }
  } catch (error) {
    child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

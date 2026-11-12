import { agent, createApp, schema } from '../dist/index.js';

const [directory] = process.argv.slice(2);
const text = schema({ id: 'text', version: '1', jsonSchema: { type: 'string' } });
let started;
const workReady = new Promise((resolve) => {
  started = resolve;
});
const model = {
  id: 'crash-model',
  capabilities: { tools: false, structuredOutput: false, streaming: true },
  async generate() {
    const workId = await workReady;
    process.send({ workId });
    return new Promise(() => {});
  },
};
const assistant = agent({
  id: 'crash-agent',
  instructions: 'Answer.',
  objective: text,
  model,
});
const app = createApp({ directory, agents: [assistant] });
const work = await app.start(assistant, 'recover this request');
started(work.id);
await new Promise(() => {});

#!/usr/bin/env node
import { createCodingApp } from '@harngine/coding-agent';
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
if (args.includes('--help') || !option('--repo') || !option('--task')) {
  console.log(
    'Usage: bun run agent:coding --repo <path> --task <request> [--write] [--session <id>] [--model <id>]',
  );
  process.exit(args.includes('--help') ? 0 : 2);
}
const { app, assistant, root } = createCodingApp({
  repo: option('--repo')!,
  writable: args.includes('--write'),
  ...(option('--model') ? { modelId: option('--model')! } : {}),
});
try {
  const session = option('--session')
    ? await app.sessions.get(option('--session') as `session_${string}`)
    : await app.sessions.create({ agent: assistant, title: `Coding: ${root}` });
  console.log(`Session ${session.id}`);
  const { work } = await session.send(option('--task')!);
  console.log(`Work ${work.id}`);
  console.log(await work.result());
} finally {
  await app.close();
}

# harngine

Harngine is an execution framework for agent applications. Applications define Agents, Workflows,
and Tools; Harngine runs them as durable, inspectable Work. Model providers answer a turn;
Harngine runs the application around those turns.

The npm package is not published yet. The installation commands below apply after publication.

```bash
bun add harngine
bunx harngine-manifest
```

It has five execution concepts: an **Agent** uses a model, a **Workflow** uses application code with
constrained durable replay, both direct durable **Work**, Work invokes typed **Tools**, and an
optional **Session** carries user-facing continuity across several Work executions.

Workflows may create first-class child Work with `flow.child()` or bounded durable fan-out/fan-in
with `flow.all()`. `flow.call()` can target an explicitly declared Agent or Workflow, while
`flow.start()` and `flow.join()` coordinate one concurrent child Call. Agents can expose explicit
`delegates` with semantic descriptions; registration alone does not make another definition
callable. A child cannot widen its principal, child-Work allowance, or depth. Tool definitions
expose explicit read/write, idempotency, reconciliation, and reversibility capabilities.
`createApp()` also accepts an optional payload-free post-commit telemetry sink; durable execution
evidence remains available through Work inspection. The optional `@harngine/evaluation` companion
turns that evidence into bounded benchmarks and usage metrics without adding an execution path.
Large attachments and generated outputs use validated, content-addressed `ArtifactReference`
records. The selected model turn receives these references through `ModelContext.artifacts`; the
application retains and authorizes access to the bytes.

```ts
import { agent, createApp, schema, tool, type ModelAdapter } from "harngine";

declare const model: ModelAdapter;
const text = schema<string>({
  id: "example.text",
  version: "1",
  jsonSchema: { type: "string" },
});
const search = tool({
  id: "example.search",
  description: "Search the knowledge base.",
  input: text,
  output: text,
  effect: "read",
  execute: async (query) => `Found: ${query}`,
});
const assistant = agent({
  id: "example.assistant",
  instructions: "Search when evidence is needed, then answer.",
  objective: text,
  model,
  tools: [search],
});

const app = createApp({
  directory: ".harngine",
  agents: [assistant],
  tools: [search],
});
console.log(await app.run(assistant, "What does the policy say?"));
await app.close();
```

Use `app.start()` for a Work handle with snapshots, watching, inspection, steering,
interactions, cancellation, and an awaitable result. Use `app.sessions` for long-lived chat or task
continuity. `session.send()` creates Work and queues it behind an active foreground Work;
`work.steer()` directs new input to one exact active Work. When a later objective needs another
specialist, an authorized application can call `session.handoff(exactAgent)` while the Session is
idle. The same conversation continues under the new Agent revision, `session.handoffs()` retains
the lineage, and the older typed handle rejects further `send()` calls.

`app.close()` aborts an active provider or Tool invocation by default. Model turns interrupted by
shutdown remain durable and retry when the App reopens. Use `app.close({ abortInFlight: false })`
to wait for the current invocation instead.

Harngine records Tool calls before execution, separates model choice from execution authority, and
restores accepted Work from SQLite after process failure. Bun generates immutable definition
revisions and drives development; installed framework code runs on Node.js.

Read the repository [README](https://github.com/neucine/harngine#readme) for Sessions, Workflows,
access policy, context selection, UI watchers, and execution semantics.

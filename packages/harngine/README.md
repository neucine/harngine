# harngine

Harngine is an execution framework for agent applications. Applications define Agents, Workflows,
and Tools; Harngine runs them as durable, inspectable Work. Model providers answer a turn;
Harngine runs the application around those turns.

The npm package is not published yet. The installation commands below apply after publication.
For an install from a locally packed tarball and a process restart demonstration, use the
[quickstart](../../examples/quickstart/README.md).

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
application retains and authorizes access to the bytes. A provider adapter can opt into native
image or PDF input with an application resolver; Harngine verifies each selected reference's size
and SHA-256 digest before provider I/O.

```ts
import { agent, createApp, guardrail, schema, tool, type ModelAdapter } from "harngine";

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
const residentPii = guardrail({
  id: "example.redact-email",
  revision: "rev_example_redact_email_v1",
  stages: ["model-input"],
  check({ value }) {
    const redacted = JSON.stringify(value).replace(
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
      "[redacted-email]",
    );
    return redacted === JSON.stringify(value)
      ? { action: "allow" }
      : {
          action: "redact",
          value: JSON.parse(redacted),
          reason: { code: "PII_REDACTED", message: "Email redacted" },
        };
  },
});
const assistant = agent({
  id: "example.assistant",
  instructions: "Search when evidence is needed, then answer.",
  objective: text,
  model,
  tools: [search],
  guardrails: [residentPii],
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

An active Work watcher can receive ordered provider previews without putting token deltas into
durable history:

```ts
const watching = await work.watch({
  onModelDelta(delta) {
    if (delta.item.type === "text") renderPreview(delta.item.text);
  },
});

for await (const update of watching) renderDurableUpdate(update.value);
const result = await work.result();
```

`ModelDelta` carries the Work, Call, and Attempt IDs plus an item sequence. The callback exists only
while the watcher is being consumed, stops after `signal` aborts, and is not replayed after
reconnect. The final validated `ModelResponse`, ordinary Work updates, snapshots, and inspection
remain authoritative. A model-output guardrail suppresses live previews because partial provider
output cannot be trusted ahead of the complete output decision.

Adapters for structured APIs can use `createModelOutputTextPreview()` to extract safe text from a
streamed JSON response envelope. It emits only direct `items[*].text` string values, ignores nested
Tool inputs, handles escape sequences across arbitrary chunks, and bounds preview output.

`app.close()` aborts an active provider or Tool invocation by default. Model turns interrupted by
shutdown remain durable and retry when the App reopens. Use `app.close({ abortInFlight: false })`
to wait for the current invocation instead.

Harngine records Tool calls before execution, separates model choice from execution authority, and
restores accepted Work from SQLite after process failure. Bun generates immutable definition
revisions and drives development; installed framework code runs on Node.js.

Guardrails are immutable policy attached to an Agent or Tool definition. Agent guardrails run
around model input and output; Tool guardrails run before invocation and after a successful result.
They return `allow`, `redact`, or `block`. Redacted values are validated against the boundary
schema before use, failures and malformed results fail closed, and inspection records only the
guardrail identity, action, stage, and safe reason. A blocked Tool input creates no Attempt or
external effect. A blocked write result records `effect: "occurred"` and is never retried.

The state-store contract provides atomic transactions, exclusive runtime ownership, ownership
epoch fencing, idempotent receipts, and inspectable history. `createApp()` defaults to the
`better-sqlite3` backend; pass
`stateStore: { backend: "node-sqlite" }` to use Node's built-in SQLite implementation. Both run
the same schema, migrations, and execution semantics, and `app.storage` exposes the active
backend contract.

Production hosts can read a payload-safe audit projection and export it without making telemetry
the execution source of truth:

```ts
const app = createApp({
  directory: ".harngine",
  agents: [assistant],
  audit: {
    retention: { maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxEntries: 100_000 },
    redact: (entry) =>
      entry.reason?.code === "ACCESS_DENIED"
        ? { reason: { code: entry.reason.code, message: "Not authorized" } }
        : {},
  },
});

const page = await app.audit.list({ category: ["authorization", "guardrail"] });
await app.audit.export({
  format: "otel",
  sink: {
    async write(batch) {
      await sendToCollector(batch); // OTLP/HTTP JSON traces payload
    },
  },
});
```

Audit entries cover Work lifecycle, decisions, authorization, guardrails, Attempts, Interactions,
and Session lineage. They expose stable correlation IDs, category, action, outcome, policy and
guardrail identity, and safe reason fields; objectives, prompts, messages, Tool input/output, and
model payloads are absent. Retention filters only the audit projection and never deletes execution
authority required for restart. Export runs after the projection is read, applies the configured
reason redactor, and cannot change Work state when a sink fails.

Read the repository [README](https://github.com/neucine/harngine#readme) for Sessions, Workflows,
access policy, context selection, UI watchers, and execution semantics.

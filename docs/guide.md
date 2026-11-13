# Harngine guide

Run the commands in this guide from the repository root.

**An execution framework for agent applications.**

Harngine provides the execution layer around language models. Applications define Agents,
Workflows, and Tools; Harngine runs them as durable, inspectable Work that can wait for people,
accept steering, survive process restarts, and continue safely across external effects.

For the runtime boundaries and durability model, read the [core architecture guide](architecture.md).
For the optional HTTP server and its OpenAPI 3.1 contract, read the [HTTP API guide](api.md).

Model providers answer a turn. Harngine runs the application around those turns.

> Harngine is pre-release software. The public API may change before the first stable release.

## Try the coding app

Harngine Coding is a macOS desktop app that can inspect a repository, answer coding questions, and propose edits for your approval. It shows the agent's replies and tool activity as work happens.

```bash
bun install
bun run coding:desktop --repo "$PWD"
open -n apps/coding/desktop/build/NeivApp.app
```

The desktop build currently needs local [Neiv](https://github.com/neucine/neiv) and
[Weiv](https://github.com/neucine/weiv) checkouts at `../neiv` and `../weiv`, with the matching
Weiv compiler and package runtime built. Local development defaults to Magpie; OpenAI and
compatible provider settings are also supported. See the
[Coding Desktop guide](../apps/coding/desktop/README.md) for setup and use.

## What Harngine provides

- **Model-directed Agents** with a provider-neutral request and response boundary.
- **Code-directed Workflows** written as ordinary async TypeScript with constrained replay and
  durable named operations.
- **Typed Tools** with input/output validation, approval policy, retry evidence, cancellation, and
  explicit handling for uncertain external effects.
- **Durable Work** with stable identity, restart recovery, limits, cancellation, steering, and an
  awaitable result.
- **Sessions** for user-facing continuity across several independent objectives.
- **Human interaction** through durable questions and approvals.
- **Inspection** showing context, model responses, decisions, Tool activity, interactions, and
  terminal results.
- **Post-commit telemetry** through an optional payload-free sink that cannot alter execution.
- **Inspection-based benchmarks** through the optional evaluation companion, with Work-tree usage,
  outcomes, child Calls and application-defined scorers.
- **Workbench**, a browser application for running and inspecting Agents and Workflows during
  development.

## Flagship reference application

[Quest](../examples/quest/README.md) is a persistent social cultural world built from real Met collection
records. It demonstrates private durable perspectives, shared interpretation, visitor-made trails,
parallel world reactions, reconnect, and provenance-preserving replay without a completion gate.

```bash
bun run demo:quest
```

[Hearth](../examples/hearth/README.md) is an ambient shared home-world built on Harngine. Its living
hearthscape, seasonal memory garden, consent-aware perspectives and gentle ritual composer combine
durable household memory with live OpenStreetMap, Open-Meteo and data.govt.nz context. Moving home
appears as one chapter in the household’s evolving story, not as the product definition.

```bash
bun run demo:hearth
```

[Muse](../examples/muse/README.md) is an evidence-backed creator studio showing provenance, bounded
parallel research, rights gates, exact approval, and safe publication on the same execution
substrate.

```bash
bun run demo:muse
```

[Roam](../examples/roam/README.md) is a collaborative living atlas where shared moods, fascinations,
rhythms and constraints grow into evolving journey worlds, grounded by persistent place scouts
and visible environmental observations.

```bash
bun run demo:roam
```

## Position

Harngine sits between an application's intent and uncertain model or external-system behavior:

```text
application
    │
    ▼
Agent or Workflow ──directs──▶ Work ──calls──▶ Tool
                                  │
                                  └── may belong to a Session
```

The application owns its product UI, users, authentication, domain policy, and definition of
success. Model adapters own provider transport. Tool adapters own integrations with external
systems. Harngine owns durable execution, validation, authority checks, waits, recovery, and the
record of what ran.

For a product-scale reference, see [Quest](../examples/quest/README.md), a living museum constellation
with persistent visitors, private perspectives, shared cultural memory, parallel child Work,
deterministic replay of real Met records, provenance, and reconnect.

The current release runs as an embedded Node.js runtime backed by SQLite. Bun is the workspace,
build, manifest, formatting, and test tool.

Muse defaults to deterministic replay; opt into provider revalidation with
`bun run demo:muse:live`.

One application process owns a Harngine runtime directory at a time. Work and Sessions remain
inspectable across app restarts, while active Work needs its original Agent and Tool revisions to
continue.

## Five concepts

- **Agent** — a reusable model-directed definition that chooses exposed Tools and produces a
  result.
- **Workflow** — a reusable code-directed definition for explicit orchestration and human waits.
- **Tool** — a typed boundary to an external operation. Model output can request a Tool; Harngine
  validates and authorizes the Call before execution.
- **Work** — one durable execution of an objective. It owns status, Calls, interactions, limits,
  result, and inspection history.
- **Session** — optional interaction continuity across multiple Work executions.

`App` is the application facade for registering definitions and accessing Work and Sessions. It is
not another execution primitive.

Serialized public values identify themselves with `object` (for example, `work`, `session`, or
`model_response`). `kind` identifies a definition namespace and `type` identifies a variant within
an object. Generated entity IDs use readable prefixes with compact opaque suffixes, such as
`work_...`, `session_...`, and `rev_...`.

## Install

Harngine 0.1.0 is published on npm. It requires Node.js 24.21 or later in the 24.x line. Bun is used for project tooling and generating the definition manifest:

```bash
bun add harngine
```

Definition revisions are generated from source and configuration:

```bash
bunx harngine-manifest
```

## Create an Agent

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
  description: "Search the application knowledge base.",
  input: text,
  output: text,
  effect: "read",
  execute: async (query) => `Evidence for ${query}`,
});

const assistant = agent({
  id: "example.assistant",
  instructions: "Search when evidence is needed, then answer concisely.",
  objective: text,
  model,
  tools: [search],
});

const app = createApp({
  directory: ".harngine/example",
  agents: [assistant],
  tools: [search],
});

console.log(await app.run(assistant, "What does the policy say?"));
await app.close();
```

`app.run()` starts Work and waits for its result. Use `app.start()` when the application needs to
observe or control execution.

`app.close()` stops background execution and aborts an active model or Tool invocation by default.
An interrupted model turn remains in Work inspection, and reopening the App retries that Agent turn
from its durable state. Pass `{ abortInFlight: false }` when shutdown should wait for the current
invocation to settle. Adapters and Tools should honor their `AbortSignal` promptly; durable effect
reconciliation still handles a write whose remote outcome remains uncertain.

`ModelAdapter` is the provider boundary. Core Harngine owns durable turns, Tool authorization,
approvals, effects, recovery, and provenance; an adapter translates one provider protocol into
Harngine's structured model request and response. Optional adapters can therefore target the
OpenAI Responses or Claude Messages compatibility APIs without coupling the core runtime or
application Agent to one vendor SDK. Adapters may also advertise `inputModalities` and opt into
provider-native Artifact transport through an application-owned `resolveArtifact` callback.

Adapter packages share a conformance suite in
[`model-adapter-conformance.ts`](../packages/harngine/test/model-adapter-conformance.ts). It covers
structured text, finish reasons, usage, Tool proposals, optional fields, malformed output, provider
failures, timeouts, and advertised capabilities. A new adapter should use the same suite before
adding live provider smoke tests.

The maintained OpenAI Responses and Claude Messages adapters consume provider streams, advertise
`streaming`, and call `emit()` with preview text extracted from complete structured-envelope text
fields. Their `accessToken` is optional only when `baseUrl` explicitly names a local compatible
router. The development Codex CLI adapter remains non-streaming because its event protocol does
not provide the same stable text-delta boundary.

Other adapters that stream a JSON response envelope can use `createModelOutputTextPreview()`. Its
incremental parser emits only direct `items[*].text` strings, ignores nested Tool inputs, handles
JSON escapes across chunks, and enforces a bounded preview length.

## Discover MCP Tool contracts

`discoverMcpTools()` captures selected MCP server contracts into a bounded, immutable catalog
snapshot. Review and persist that snapshot in application source rather than registering a remote
server's changing Tool list at runtime:

```ts
import {
  discoverMcpTools,
  mcpToolCatalog,
  mcpToolFromCatalog,
} from "@harngine/mcp";

// Run during authoring, review the result, and persist it in source.
const discovered = await discoverMcpTools(client, { maxTools: 128 });

const catalog = mcpToolCatalog(discovered);
const lookup = mcpToolFromCatalog(catalog, {
  id: "my-app.lookup",
  name: "lookup",
  effect: "read",
  client,
});
```

Discovery supplies the remote description and input schema. Application source still chooses the
stable Harngine ID, effect and write capabilities. The selected snapshot fields participate in the
definition configuration, so a contract change produces a new exact definition revision while
existing Work keeps its original revision. MCP annotations do not grant authority, and runtime
discovery cannot let a model expose a new Tool to itself. MCP prompts and resources remain
application context unless a selected input explicitly enters a model turn. The pinned contract
cannot detect a remote server that changes behavior without changing its advertised schema.

## Observe long-running Work

```ts
const work = await app.start(assistant, "Investigate the authentication failure");
const watching = await work.watch();

render(watching.value);
for await (const update of watching) {
  renderUpdate(update.value);
}

const answer = await work.result();
```

An Agent model adapter can expose ordered partial items without making them durable:

```ts
const watching = await work.watch({
  onModelDelta(delta) {
    if (delta.item.type === "text") renderPreview(delta.item.text);
  },
});

for await (const update of watching) renderUpdate(update.value);
```

The callback is active only while the watcher is being consumed and stops on iteration end or
abort. `ModelDelta` includes Work, Call, and Attempt correlation plus an item sequence. It is not
replayable, does not advance the durable cursor, and never appears in inspection. The final
validated model response remains authoritative. Model-output guardrails suppress previews so a
partial response cannot bypass the complete output decision.

Durable updates carry `event_...` IDs. A disconnected client can reopen Work by its `work_...` ID
and resume watching from its last cursor:

```ts
const work = await app.works.get(workId);
const watching = await work.watch({ after: lastEventId });
```

Active Agent Work accepts steering without changing its original objective:

```ts
await work.steer("Focus on refresh-token reuse");
```

Steering is accepted only while that exact Work is active. It does not silently create replacement
Work or erase an admitted Tool effect.

## Continue through a Session

A Session carries human and Agent Messages across separate objectives while keeping every
execution independently inspectable:

```ts
const session = await app.sessions.create({
  agent: assistant,
  title: "Repository assistant",
});

const first = await session.send("Inspect the authentication code");
console.log(await first.work.result());

const second = await session.send("What tests should we add for that fix?");
console.log(await second.work.result());
```

A Session has at most one foreground Work. `session.send()` atomically records the human Message
and creates new Work. When Work is already active, the new Work waits in the Session's durable FIFO
queue. Use `first.work.steer()` to influence that exact Work while it is active.

An application can transfer future conversation ownership to another exact Agent revision after
the Session becomes idle:

```ts
const billingSession = await session.handoff(billingSpecialist, {
  reason: "Duplicate charge requires billing review",
  idempotencyKey: "transfer-order-842-billing",
});

const specialist = await billingSession.send({
  request: "Review the duplicate charge",
});
```

`session.handoff()` requires the caller to pass the Session's handoff access policy and rejects an
active or queued Session with `SESSION_BUSY`. It preserves the existing messages, appends durable
from/to Agent lineage available through `session.handoffs()`, and returns a typed handle for the new
Agent. The old handle rejects `send()` with `SESSION_HANDED_OFF`. Handoff transfers the
user-facing voice; child Work remains a separate delegation mechanism beneath whichever Agent owns
the current conversation.

## Control model context

Agent context is resolved into a provider-neutral, inspectable snapshot for each model turn. An
Agent can bound retained Session history, reserve output capacity, set an input-token budget, and
provide a named selection policy. Required Work input cannot be dropped by that policy. Optional
history and prior model/Tool outcomes retain provenance so inspection can explain their source.

A Model adapter may expose a named tokenizer for provider/model-aware accounting. Without one,
Harngine uses its documented UTF-8 estimate. Selection and accounting happen before the model call;
the execution kernel consumes the resulting `ModelContext` and does not act as implicit memory.

Large documents, code files and generated outputs can cross execution as content-addressed
references instead of payloads:

```ts
import { artifactReference } from "harngine";

const agreement = artifactReference({
  id: "attachment:master-services-agreement",
  name: "master-services-agreement.pdf",
  mediaType: "application/pdf",
  byteLength: 184_320,
  digest: "sha256:...",
});

const review = await app.run(reviewer, {
  question: "Summarize the renewal terms",
  attachments: [agreement],
});
```

`ArtifactReference` carries identity, media type, size and digest but no bytes. Harngine validates
and deduplicates references found in the objective and selected Context Items, then exposes them
through `ModelContext.artifacts`. The application owns storage, authorization, retention and
resolution; a Tool that reads content verifies the digest and byte length before use. This supports
document and code workflows.

The OpenAI Responses and Claude Messages adapters can opt into provider-native image and PDF input.
Their `resolveArtifact` option receives only references already selected into
`ModelContext.artifacts`. Harngine's shared resolver checks the media-type allowlist, count, byte
bounds, exact byte length and SHA-256 digest before an adapter creates provider content parts or
starts provider I/O. The default raw bound is 8 Artifacts and 20 MiB in total; applications and
adapters can choose tighter or reviewed limits. GIF, JPEG, PNG and WebP map to images, and
`application/pdf` maps to a document. The complete `ModelRequest` still travels as JSON text.

Native input is opt-in because a compatible router may route to a model without that capability.
Without a resolver, references remain metadata only. Harngine core does not store binary payloads,
parse PDFs, run OCR, or transport audio, video or realtime voice. Applications own binary storage
and extraction; adapter packages own provider wire encoding.

## Write a Workflow

A Workflow uses named durable operations. Harngine replays completed operations after restart
instead of repeating their effects.

```ts
import { workflow } from "harngine";

const investigate = workflow({
  id: "example.investigate",
  objective: text,
  result: text,
  tools: [search],
  async run(objective, flow) {
    const evidence = await flow.call("search", search, objective);

    await flow.approval("publish", {
      title: "Publish this finding?",
      details: { evidence },
    });

    return evidence;
  },
});
```

Workflows can delegate to declared Agents or Workflows as first-class child Work:

```ts
const parent = workflow({
  id: "example.parent",
  objective: text,
  result: text,
  children: [assistant],
  run: (objective, flow) => flow.child("assistant", assistant, objective),
});
```

Use `flow.call(name, target, objective)` to wait for one child Closure. Use a named
`flow.start(name, target, objective)` handle when the parent has useful work to do first, then pass
that handle to `flow.join(joinName, handle)`. Both operations replay by name and keep one durable
Call identity and one child Work ID. A failed or canceled child Call throws `WorkFailedError` or
`WorkCanceledError` with the child `work_...` identity so Workflow code can catch it and choose a
recorded recovery path.

An Agent can expose the same kind of composition through `delegates`. Each delegate declares one
exact Agent or Workflow revision, a semantic description, and an optional
`sequential | concurrent` mode. The model sees the delegates in its Tool-call catalog, but
selecting one starts child Work; it is not a Tool Attempt. Registration alone never exposes a
delegate. The parent receives the child Closure as required model context on its next turn.

Use `flow.all(name, tasks)` for an explicit bounded fan-out/fan-in of child Work. The entire batch
is admitted atomically with durable indexed slots; results retain task order, each child recovers
independently, and canceling the parent cancels open descendants. Ordinary concurrent or unawaited
Workflow promises remain unsupported because they have no durable identity or replay ordering.
Parent snapshots expose child Work IDs, and story inspection records child Call start, join, and
closure with their Call IDs and modes. Child Work does not publish a separate Session message.
Attached children cannot outlive successful parent completion; detached child execution remains
deferred.

Questions and approvals appear in `work.snapshot().interactions` and in Work and Session watchers.
Resolve them with `work.respond(interaction.id, response)`.
Direct Work snapshots also expose `usage` and `limits` for model turns, Tool executions, decisions,
and attempts. Event projections can omit these accounting fields; request a direct snapshot when
displaying current or historical counters.

## Resolve an uncertain Tool effect

A write Tool that loses its external receipt leaves Work waiting rather than guessing whether the
effect occurred. A Tool can provide a read-only lookup that Harngine durably admits and invokes
automatically:

```ts
const charge = tool({
  id: "billing.charge",
  input: chargeRequest,
  output: chargeReceipt,
  effect: "write",
  capabilities: {
    idempotency: "operation-key",
    reversibility: "irreversible",
  },
  retry: { maxAttempts: 2 },
  execute: (input, context) => billing.charge(input, context.idempotencyKey),
  reconcile: async (_input, context) => {
    const receipt = await billing.findByIdempotencyKey(context.idempotencyKey);
    return receipt
      ? { status: "success", value: receipt }
      : {
          status: "not-applied",
          reason: { code: "NOT_FOUND", message: "No charge exists" },
        };
  },
});
```

Every Tool exposes explicit safety capabilities. Reads are repeatable. Writes conservatively
default to no idempotency guarantee, manual reconciliation, and unknown reversibility; a Tool may
declare intrinsic or operation-key idempotency and reversible or irreversible consequences.
Automatic reconciliation is derived from the presence of `reconcile`. Retry count remains a
separate execution policy: it never makes an uncertain write safe to repeat.

Reconciliation must only observe external state. Harngine may safely repeat that lookup after a
process crash, but it never automatically repeats the unknown write. A conclusive result settles or
safely retries the operation. An inconclusive result remains waiting for an operator.

Inspection exposes the uncertain Call so an operator can record a durable, idempotent fallback:

```ts
const inspection = await work.inspect({ detail: "diagnostic" });
const uncertain = inspection.entries.find(
  (entry) => entry.type === "call" && entry.phase === "uncertain",
);

if (uncertain?.type === "call") {
  await work.resolveEffect(
    uncertain.callId,
    { status: "success", value: recoveredResult },
    { idempotencyKey: operatorRequestId },
  );
}
```

An operator may instead conclude `failure` with a `partial` or `occurred` effect, or `not-applied`
with a reason. A not-applied conclusion retries only when the Tool retry and approval policies make
that safe. Harngine preserves the unknown attempt and appends separate Tool or operator resolution
evidence.

## Inspect execution

```ts
const story = await work.inspect({ detail: "story" });
const diagnostic = await work.inspect({ detail: "diagnostic" });
```

Story inspection explains execution using Work, decisions, Calls, Interactions, and results.
Diagnostic inspection adds normalized model requests and responses plus validated Tool details.
Model responses may include normalized input, output, and total token usage plus cost in
currency-denominated micros. Inspection does not expose hidden model reasoning.

For a principal-scoped operational projection, `app.audit.list()` reads committed Work,
decision, authorization, guardrail, Attempt, Interaction, and Session evidence without payloads.
Configure retention and safe-reason redaction in `createApp({ audit })`, then export JSON or an
OTLP/HTTP JSON traces payload through an application sink. Retention is read-time projection
policy: it never removes execution authority needed for restart. An unavailable collector rejects
the explicit export call and leaves Work unchanged.

Hosts may provide access policy for four decisions: who may start a definition, call a Tool, respond
to an Interaction, and hand off Session ownership. Authorization and human approval are separate
gates.

## Use Workbench

Workbench discovers definitions, creates Sessions and Work, accepts live prompts, handles
Interactions, displays transient model previews, reviews payload-safe audit evidence, and displays
story or diagnostic inspection. The HTTP adapter enables model previews only when a Work event
request opts in with `modelDeltas=1`.

Export an App factory from a project module, then run:

```bash
bunx harngine-workbench ./src/harngine.ts
```

The launcher supervises source reloads with Bun. Each App generation executes on Node.js and keeps
durable state in the configured Harngine directory.

## Repository

This is a Bun workspace:

```text
packages/harngine   public framework and embedded SQLite runtime
packages/workbench  browser development and inspection application
packages/codex-cli  development adapter using local Codex CLI authentication
packages/openai-responses   OpenAI Responses compatible model adapter
packages/claude-messages  Claude Messages compatible model adapter
packages/mcp        MCP catalog discovery and selected Tool bridge
packages/retrieval  versioned retrieval Tools and citation checks
packages/evaluation inspection-based Work-tree metrics, scorers and benchmark reports
packages/http       authenticated Node HTTP adapter and OpenAPI contract
apps/coding/agent        repository coding agent and local HTTP server
apps/coding/cli          command line interface for the coding agent
apps/coding/demo         fictional workspace coding showcase
apps/coding/desktop      Neiv and Weiv coding desktop UI
examples/hearth          shared home-world reference application
examples/quest           persistent social cultural-world reference application
examples/roam            collaborative travel reference application
examples/muse            evidence-backed creator-studio reference application
examples/support         support triage, ownership handoff and approval-gated refund demo
examples/due-diligence   attachment review, cited retrieval and approved report publication
```

Run the project checks:

```bash
bun install
bun run manifest
bun run check
bun run test:package
```

The Coding desktop app is the primary live end-to-end check. It exercises the desktop UI, provider
adapter and stream, durable Work events and a real `coding.read` call. The launch procedure and
expected result are in the [Coding desktop guide](../apps/coding/desktop/README.md#live-compatibility-router-check).

The headless Magpie smoke remains a terminal and automation fallback for both compatibility
protocols:

```bash
bun run smoke:coding:magpie

HARNGINE_CODING_PROVIDER=claude-messages \
CODEX_MODEL=opencode-go/deepseek-v4.1-flash \
bun run smoke:coding:magpie
```

Set `HARNGINE_NODE_BINARY` to choose the Node.js executable used by the smoke. These live checks
are separate from normal tests, so CI does not depend on a running local router.

Run the local showcases:

```bash
bun run build
bun run demo:coding
bun run coding:cli --repo . # interactive read/edit terminal
bun run coding:cli --repo . --task "Explain this repository" # one-shot automation
bun run coding:desktop --repo . # build the app, then open it in Finder
bun run demo:quest
bun run demo:roam
bun run demo:support
bun run demo:support:cli
node examples/due-diligence/dist/main.js
```

Package documentation:

- [`harngine`](../packages/harngine/README.md)
- [`@harngine/workbench`](../packages/workbench/README.md)
- [Codex CLI development adapter](../packages/codex-cli/README.md)
- [OpenAI Responses adapter](../packages/openai-responses/README.md)
- [Claude Messages adapter](../packages/claude-messages/README.md)
- [MCP Tool bridge](../packages/mcp/README.md)
- [Retrieval Tool bridge](../packages/retrieval/README.md)
- [Evaluation companion](../packages/evaluation/README.md)
- [HTTP adapter and OpenAPI contract](../packages/http/README.md)
- [Coding agent](../apps/coding/agent/README.md)
- [Coding application layout](../apps/coding/README.md)
- [Coding CLI](../apps/coding/cli/README.md)
- [Coding Session demo](../apps/coding/demo/README.md)
- [Coding desktop](../apps/coding/desktop/README.md)
- [Quest living cultural-world reference](../examples/quest/README.md)
- [Roam travel reference](../examples/roam/README.md)
- [Muse creator-studio reference](../examples/muse/README.md)

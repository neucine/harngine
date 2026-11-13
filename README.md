# Harngine

[简体中文](README.zh-CN.md)

<img src="docs/social-preview.svg" alt="Harngine: durable, inspectable work for agent applications" width="560">

Harngine is a TypeScript runtime for agents and workflows. It keeps model decisions, Tool calls,
approvals, and results durable enough to inspect or resume after a restart.

Harngine is pre-release software. Its public API may change.

**See it run:** [two-minute recovery demo](examples/quickstart/README.md) ·
[69-second Support Desk walkthrough](https://github.com/neucine/harngine/releases/download/v0.1.0/walkthrough.mp4) ·
[framework introduction video](https://youtu.be/upyXdDo2EPY)

The recovery demo uses the published package without a model account. It kills a process while a
Workflow waits on a durable timer, opens the same SQLite directory in a new process, and verifies
the result and recorded Tool call. With Node.js 24.21 and Bun installed:

```bash
mkdir harngine-recovery && cd harngine-recovery
curl -fsSLO https://raw.githubusercontent.com/neucine/harngine/main/examples/quickstart/demo.mjs
printf '{"private":true,"type":"module"}\n' > package.json
npm install harngine@0.1.0
bunx harngine-manifest
node demo.mjs
```

Expected result: `Recovered ...: result=42, settled tool calls=1`. See the
[demo guide](examples/quickstart/README.md) for its scope and the SQLite evidence it leaves behind.

# Get Started

Harngine requires Node.js 24.21. Install the framework package from npm:

```bash
npm install harngine
```

Optional integrations are published under the `@harngine` scope. Install only the ones your
application uses:

```bash
npm install \
  @harngine/openai-responses \
  @harngine/claude-messages \
  @harngine/mcp \
  @harngine/retrieval \
  @harngine/http
```

## Framework and example applications

The npm package `harngine` is the framework. Your application defines Agents or Workflows and
Tools, starts Work, and uses the runtime to recover and inspect it. For example, the
[recovery quickstart](examples/quickstart/README.md) defines a Workflow with a named Tool call and
a durable timer:

```ts
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
```

Here `number` and `record` are the example's declared schema and Tool. The [framework guide](docs/guide.md)
covers the complete API, persistence, approvals, and inspection.

The Coding CLI and Support Desk below are **applications built with Harngine**. They demonstrate
what the framework can support; neither application is required to use the npm package.

# Application examples

To run the Coding CLI and repository examples, clone the source and install its workspace:

```bash
git clone https://github.com/neucine/harngine.git
cd harngine
bun install
```

## Coding CLI

Harngine Coding is a terminal agent for repository work. It starts in read-only mode, streams live
progress, keeps Tool calls compact, and asks before applying each exact file change.

```bash
bun run coding:cli --repo .
```

Use `/write` to switch to an edit Session. `/sessions` and `--continue` resume saved work. For
automation, pass `--task`; add `--json` for one machine-readable result.

Local development defaults to Magpie and `codex/gpt-6.1-sol`. If Magpie is unavailable, the
interactive setup offers OpenAI, Claude, or Magpie. To use OpenAI directly:

```bash
OPENAI_API_KEY=... bun run coding:cli \
  --repo . \
  --provider openai \
  --model <model-id>
```

See the [Coding CLI guide](apps/coding/cli/README.md) for providers, thinking output, approvals,
one-shot runs, and Session commands.

The macOS app uses the same Agent and durable history:

```bash
bun run coding:desktop --repo "$PWD"
open -n apps/coding/desktop/build/NeivApp.app
```

Desktop builds currently need local [Neiv](https://github.com/neucine/neiv) and
[Weiv](https://github.com/neucine/weiv) checkouts. See the
[Coding Desktop guide](apps/coding/desktop/README.md).

## Support Desk

The offline Support Desk example follows a duplicate charge from customer request to an
approval-gated refund. It shows account evidence, a policy lookup, a durable Triage → Billing
handoff, the exact approval, and the completed audit trail.

```bash
bun run demo:support
```

Open the printed URL, select **Run review**, then approve the exact NZ$49 refund. No provider key,
payment service, or network connection is required.

Use `bun run demo:support:cli` for the same case in the terminal. See the
[Support Desk guide](examples/support/README.md).

## More application examples

- [Quest](examples/quest/README.md): a shared, persistent museum world with offline replay.
- [All examples](examples): support, museum, home, creative research, travel, and due diligence.

# Development

## Build and verify

```bash
bun run build
bun run check
```

Read the [framework guide](docs/guide.md), [package reference](packages/harngine/README.md), or
[architecture notes](docs/architecture.md). Harngine runs on an embedded Node.js runtime backed by
SQLite; Bun manages the workspace and builds.

# License

Harngine is licensed under the [Mozilla Public License 2.0](LICENSE). See
[CONTRIBUTING.md](CONTRIBUTING.md) for verification and [SECURITY.md](SECURITY.md) for private
vulnerability reporting.

# Harngine

[简体中文](README.zh-CN.md)

<img src="docs/social-preview.svg" alt="Harngine: durable, inspectable work for agent applications" width="560">

Harngine is a TypeScript runtime for agents and workflows. It keeps model decisions, Tool calls,
approvals, and results durable enough to inspect or resume after a restart.

Harngine is pre-release software. Its public API may change.

[Run the two-minute recovery demo](examples/quickstart/README.md) with the published package. It
kills a process during a durable wait and recovers the result from a new process without a model
account.

# Get Started

Harngine requires Node.js 24.21. Install the framework package from npm:

```bash
npm install harngine
```

Optional integrations are published under the `@harngine` scope. Install only those your
application uses.

## Framework example

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

The [framework introduction video](https://youtu.be/upyXdDo2EPY) explains where the runtime fits.
The applications below illustrate what can be built with it.

# Application examples

These applications run from a source checkout (`git clone https://github.com/neucine/harngine.git`,
then `cd harngine` and `bun install`). They are separate from the npm framework quickstart.

## Coding CLI

Harngine Coding is a terminal agent for repository work, with inspectable progress and approval
before file edits. See the [CLI guide](apps/coding/cli/README.md) for setup and commands. A
[macOS desktop guide](apps/coding/desktop/README.md) is also available.

## Support Desk

The offline Support Desk example follows a duplicate charge through an approval-gated refund.
Watch the [69-second walkthrough](https://github.com/neucine/harngine/releases/download/v0.1.0/walkthrough.mp4)
or use the [Support Desk guide](examples/support/README.md) to run it.

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

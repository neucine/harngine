# Harngine

Harngine runs agents and workflows as durable, inspectable work. It records model decisions, tool calls, approvals, and results, so an application can recover after a restart and show what happened.

Harngine is pre-release software; its public API may change.

## Try the coding app

The macOS coding app can inspect a repository, answer questions, and propose edits for your approval. It shows replies and tool activity as the agent works.

```bash
bun install
bun run agent:desktop --repo /absolute/path/to/your/repository
```

Open `apps/coding/desktop/build/NeivApp.app` in Finder. You need a working Codex CLI login and a local Neiv checkout at `../neiv`. See the [Coding Desktop guide](apps/coding/desktop/README.md) for setup and use.

## Build with Harngine

Define an **Agent** for model-directed work, a **Workflow** for explicit orchestration, and typed **Tools** for external operations. Harngine runs each objective as **Work**. A **Session** keeps several objectives together for a user.

The npm package is not published yet. To explore the framework from this repository:

```bash
bun install
bun run build
```

The [framework guide](docs/guide.md) covers creating Agents and Workflows, watching Work, using Sessions, handling uncertain tool effects, and inspecting execution. The [package reference](packages/harngine/README.md) and [Workbench guide](packages/workbench/README.md) cover the public APIs and development UI.

Model adapters integrate [OpenAI Responses](packages/codex-api/README.md) and [Claude Messages](packages/claude-messages/README.md) compatible endpoints, including streaming previews and unauthenticated local routers with an explicit base URL. Optional integration packages discover and bridge selected [MCP tools](packages/mcp/README.md) and expose [retrieval services](packages/retrieval/README.md) as Harngine Tools. [Evaluation](packages/evaluation/README.md) runs bounded Work-tree evidence and scorer benchmarks without entering the execution core. Large attachments and generated files cross Work and Model Context as content-addressed references; application storage retains the bytes. Work watchers and the HTTP adapter can forward transient model previews, while Workbench and HTTP expose the payload-safe `app.audit` projection. Audit evidence exports as JSON or OTLP/HTTP JSON.

## Examples

- [Coding app](apps/coding/README.md) — a repository agent with CLI and desktop interfaces.
- [Quest](apps/quest/README.md) — a persistent cultural world with shared and private perspectives.
- [Hearth](apps/hearth/README.md) — a shared home world with durable memory.
- [Muse](apps/muse/README.md) — a creator studio with research and approval steps.
- [Roam](apps/roam/README.md) — a collaborative journey atlas.
- [Support](apps/support/README.md) — MCP catalog selection, policy retrieval, conversation handoff and approval-gated billing.
- [Due diligence](apps/due-diligence/README.md) — attachment references, cited review and approved publication.

Harngine currently runs as an embedded Node.js runtime backed by SQLite. Bun is used for the workspace, builds, and tests.

## License

Harngine is licensed under the [Mozilla Public License 2.0](LICENSE).

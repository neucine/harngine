# Repository coding agent

## Model providers

The coding app defaults to the local Magpie gateway at `http://127.0.0.1:3425/v1`, using
`codex/gpt-6.1-sol` through the streaming OpenAI Responses adapter. This avoids the ChatGPT model
backend and does not require a Codex CLI login.

Public users can select OpenAI directly. Keep the key in the environment:

```bash
OPENAI_API_KEY=... bun run coding:cli \
  --repo . \
  --provider openai \
  --model <openai-model-id> \
  --task "Explain this repository"
```

Use `--base-url` for an OpenAI Responses compatible gateway. The standard `OPENAI_API_KEY`,
`HARNGINE_CODING_API_TOKEN`, and `CODEX_ACCESS_TOKEN` names are accepted in that order.

For a Claude Messages compatible endpoint, use `--provider claude` with an explicit model and
`ANTHROPIC_API_KEY` or `HARNGINE_CODING_API_TOKEN`. The adapter sends `POST /messages` with Claude
Messages headers and structured output.

Provider settings can also come from `HARNGINE_CODING_PROVIDER`,
`HARNGINE_CODING_API_BASE_URL`, `HARNGINE_CODING_API_TOKEN`, and `CODEX_MODEL`.

## Live router integration

The Coding desktop app is the primary end-to-end check for a compatibility API. It exercises the
real desktop UI, model adapter, provider stream, HTTP events and `coding.read` Tool in one run. See
[Coding desktop](../desktop/README.md#live-compatibility-router-check) for the macOS launch and
verification steps.

The headless command remains an optional fallback for terminals and automation. When Magpie is
available at its default local URL, it runs the same coding Agent path through the OpenAI Responses
adapter:

```bash
bun run smoke:coding:magpie
```

The smoke creates a temporary repository, asks the Agent to read its marker file through `coding.read`, verifies the answer and settled Tool Call, then removes the repository. The script expects Magpie's development token and default model unless `HARNGINE_CODING_API_TOKEN`, `HARNGINE_CODING_API_BASE_URL`, or `CODEX_MODEL` override them. Set `HARNGINE_SMOKE_DEBUG=1` to print the raw Responses stream.

Run the same end-to-end path through the Claude Messages compatibility API:

```bash
HARNGINE_CODING_PROVIDER=claude-messages \
CODEX_MODEL=opencode-go/deepseek-v4.1-flash \
bun run smoke:coding:magpie
```

Both commands build the workspace first. `HARNGINE_NODE_BINARY` can select another Node.js executable when the repository's bundled runtime is unsuitable for the host, for example `HARNGINE_NODE_BINARY="$(command -v node)" bun run smoke:coding:magpie`.

This application owns the Harngine coding agent, desktop server, and repository HTTP routes. The command line entry point lives in `apps/coding/cli`; the Neiv and Weiv UI lives in `apps/coding/desktop`. It keeps Work and Session history in `<repo>/.harngine/coding-agent`.

Without `--write`, the agent can only read files and search with `rg`. With `--write`, it can replace a unique exact fragment in an existing file and run a bounded command using `bun`, `npm`, `pnpm`, `yarn`, `node`, or `git`. Commands do not run through a shell. Paths are relative to the selected repository and cannot escape it through `..` or symlinks. The `.git` and `.harngine` directories are excluded from file edits. Each edit records before and after file fingerprints in `.harngine/coding-agent/edit-journal` before writing, so Harngine can reconcile an interrupted write after restart.

## Specialists and durable composition

`createCodingApp()` now exposes a researcher, implementer, and reviewer Agent as explicit
specialists. The main `coding.orchestrator` Agent sees those definitions as model-facing delegates;
the read-only checkout exposes the researcher and reviewer, while a writable checkout also exposes
the implementer. Registration by itself does not make a specialist callable.

The same app includes `coding.collaborative-review`, a Workflow that starts repository research as a
concurrent child Call, performs a blocking review child Call, then joins the research Closure. The
parent, children, exact revisions, Call IDs, modes, join and closure remain independently
inspectable. The Coding integration tests exercise the delegate catalog and this concurrent
research/review path with a deterministic model adapter.

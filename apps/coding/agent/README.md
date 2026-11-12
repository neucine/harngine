# Repository coding agent

## OpenAI Responses compatible router

The coding agent defaults to the locally configured Codex CLI. To send model turns directly to a Responses compatible router such as Magpie, run:

```bash
HARNGINE_CODING_PROVIDER=openai-responses \
HARNGINE_CODING_API_BASE_URL=http://127.0.0.1:3425/v1 \
HARNGINE_CODING_API_TOKEN=magpie \
CODEX_MODEL=codex/gpt-6-sol \
bun run agent:coding --repo . --task "Explain this repository"
```

Use the bearer value required by your router in `HARNGINE_CODING_API_TOKEN`. Set `CODEX_MODEL` to an ID returned by its `/models` endpoint. Without `HARNGINE_CODING_API_BASE_URL`, this adapter targets OpenAI's Responses endpoint. The adapter speaks the OpenAI Responses protocol regardless of which upstream model Magpie routes to. The desktop app uses its Codex CLI configuration when opened normally from Finder.

For a Claude Messages compatible endpoint, use `HARNGINE_CODING_PROVIDER=claude-messages` with the same base URL, token, and model settings. That adapter sends `POST /messages` with Claude Messages headers and structured output. It requires an explicit `CODEX_MODEL`.

## Live router smoke

When Magpie is available at its default local URL, run the real coding Agent through the OpenAI Responses adapter:

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

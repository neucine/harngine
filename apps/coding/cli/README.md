# Harngine Coding CLI

Harngine Coding is an interactive terminal for repository work. It uses the same durable Agent,
Tools, Sessions and inspection history as the Harngine coding desktop.

Local development defaults to Magpie at `http://127.0.0.1:3425/v1`, using
`codex/gpt-6.1-sol` through the streaming OpenAI Responses adapter. It does not use the ChatGPT
model backend. From the repository root:

```bash
bun run coding:cli --repo .
```

The CLI prints the selected model and provider before each one-shot run. `/status` shows the same
information in an interactive Session.

If local Magpie is running, the CLI uses it automatically. Otherwise, an interactive launch asks
whether to use OpenAI, Claude, or Magpie. OpenAI and Claude setup prompts for a missing model and
API key; the key is masked and kept in memory for that process only.

The default Session is read only. Type a request and press Enter:

```text
[read] repo › Explain why token refresh tests fail
```

Use `/write` to open an edit Session. Before Harngine changes a file, it shows the exact removed and
added text and waits for approval:

```text
Approval required · Edit tokens.ts
File: src/tokens.ts
Remove:
- if (family.revoked) return
Add:
+ if (family.revoked) throw new Error('revoked')
Approve this exact change? [y/N]
```

Typing `n` leaves the file unchanged. After an approved edit, the edit and its journal are durable,
so a later run can inspect or reconcile the same Work.

## Commands

| Command | Action |
| --- | --- |
| `/help` | Show CLI and interactive help |
| `/new` | Start a fresh Session in the current access mode |
| `/read` | Switch to a new read-only Session |
| `/write` | Switch to a new edit Session |
| `/sessions` | List saved coding Sessions |
| `/session <id>` | Open a saved Session |
| `/status` | Show Session, mode, current Work and last run time |
| `/quit` or `/exit` | Leave the interactive CLI |

Session and Work IDs, an animated `Thinking`/`Working` indicator, Tool activity, approval diffs and
timing go to stderr. The Agent answer stays on stdout, so normal one-shot commands remain safe to
pipe. Thinking previews and Tool activity use dim styling. A Tool row changes in place from
`→ Read package.json` while running to `✓ Read package.json` when it settles. After the final reply,
the thinking indicator collapses to one compact
`✓ Thought for 4.2s` line. Provider reasoning summaries appear inside the animated indicator and
are removed when the reply finishes; pass `--show-thinking` to keep them expanded in the progress
output. `Ctrl+C` asks the active Work to stop. Animation is disabled for redirected output and
`--json`.

Provider text is used as a live preview in the animated thinking indicator while a model turn runs.
That provisional prose never enters the terminal transcript. When the run finishes, the final answer
is printed once, followed by the collapsed thinking time. This keeps interim narration out of both
interactive sessions and redirected output.

## Providers

Use OpenAI directly with your own API key and model:

```bash
OPENAI_API_KEY=... bun run coding:cli \
  --repo . \
  --provider openai \
  --model <model-id> \
  --task "Explain the test failure"
```

`OPENAI_API_KEY` is read from the environment so the token is not shown in the command, shell
history, or Bun's command log. `HARNGINE_CODING_API_TOKEN` also works for compatible gateways. Use
`--base-url` for a non-default OpenAI Responses endpoint.

For Claude Messages compatible endpoints:

```bash
ANTHROPIC_API_KEY=... bun run coding:cli \
  --repo . \
  --provider claude \
  --model <model-id> \
  --base-url <messages-endpoint>
```

Provider environment overrides are also supported: `HARNGINE_CODING_PROVIDER`,
`HARNGINE_CODING_API_BASE_URL`, `HARNGINE_CODING_API_TOKEN`, `OPENAI_MODEL`,
`ANTHROPIC_MODEL`, and `CODEX_MODEL`.
Use `--provider codex` to select the locally authenticated Codex CLI and its models.

## One-shot and automation

Run one read-only task:

```bash
bun run coding:cli --repo . --task "Explain the test failure"
```

Allow edits and checks:

```bash
bun run coding:cli --repo . --task "Fix the failing token test" --write
```

Edit mode still asks before each exact file change. Use `--yes` only in an explicitly trusted
automation where approval has already been decided. A non-interactive stdin session cannot answer
an approval prompt and denies edits by default.

Resume Work from a prior terminal invocation:

```bash
bun run coding:cli --repo . --list-sessions
bun run coding:cli --repo . --session session_example --task "Continue with the check"
bun run coding:cli --repo . --continue --task "Review the latest read Session"
```

`--continue` selects the latest CLI Session for the chosen mode. Read and edit Sessions cannot be
silently interchanged; add or remove `--write` to select the matching mode.

Pass a task through stdin for shell pipelines:

```bash
printf 'List the highest-risk incomplete areas\n' |
  bun run coding:cli --repo .
```

Add `--json` for one machine-readable object on stdout:

```bash
printf 'Summarize the repository\n' |
  bun run coding:cli --repo . --json
```

The object contains the Session ID, Work ID, status, elapsed time, usage, result and durable event
types. A failed or canceled run still prints one object, with `result: null` and an `error` message,
then exits non-zero. Progress and thinking previews are suppressed in JSON mode.

## Options

| Option | Description |
| --- | --- |
| `--repo <path>` | Repository to inspect; defaults to the current directory |
| `--task <request>` | Run one task; positional text and piped stdin also work |
| `--write` | Allow exact edits and bounded checks |
| `--session <id>` | Resume a specific Session in the matching mode |
| `--continue` | Resume the latest Session for the selected mode |
| `--provider <name>` | `magpie` (default), `openai`, `claude`, or `codex` |
| `--model <id>` | Select the provider model |
| `--base-url <url>` | Override the provider API endpoint |
| `--show-thinking` | Keep provider reasoning summaries in progress output |
| `--no-color` | Disable terminal styling |
| `--yes` | Approve exact edits without prompting for this run |
| `--json` | Print one JSON result; requires one-shot input |
| `--list-sessions` | List saved CLI coding Sessions |
| `--help`, `-h` | Show help |

Harngine stores Session and Work history under `<repo>/.harngine/coding-agent`.

# Repository coding CLI

This command line app uses `@harngine/coding-agent` to run one task per invocation.

```bash
bun run agent:coding --repo /path/to/repository --task 'Inspect the failing tests and explain the cause'
bun run agent:coding --repo /path/to/repository --task 'Fix the failing tests' --write
```

The CLI prints the Session ID and final answer. Pass `--session <id>` with the same repository and access mode to continue. Use `--model <id>` to choose a Codex CLI model. A configured local Codex login is required.

Use `--write` to allow file edits and checks. Supported commands can execute project scripts.

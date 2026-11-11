# Repository coding agent

This application owns the Harngine coding agent, desktop server, and repository HTTP routes. The command line entry point lives in `apps/coding/cli`; the Neiv and Weiv UI lives in `apps/coding/desktop`. It keeps Work and Session history in `<repo>/.harngine/coding-agent`.

Without `--write`, the agent can only read files and search with `rg`. With `--write`, it can replace a unique exact fragment in an existing file and run a bounded command using `bun`, `npm`, `pnpm`, `yarn`, `node`, or `git`. Commands do not run through a shell. Paths are relative to the selected repository and cannot escape it through `..` or symlinks. The `.git` and `.harngine` directories are excluded from file edits. Each edit records before and after file fingerprints in `.harngine/coding-agent/edit-journal` before writing, so Harngine can reconcile an interrupted write after restart.

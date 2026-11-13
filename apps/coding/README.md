# Coding application

The coding application has four parts:

- `agent/` defines the repository agent and exposes `startCodingServer()` for the local HTTP API.
- `cli/` provides interactive, resumable terminal Sessions plus one-shot and JSON automation.
- `desktop/` packages a standalone Neiv app with the coding server and contains the Weiv and native UI.
- `demo/` is the fictional workspace showcase.

From the repository root, run `bun run coding:cli --repo .` for an interactive terminal with live
Tool activity, exact edit approval, saved Sessions and `Ctrl+C` cancellation. Run
`bun run coding:desktop --repo .` to build the desktop app, then open the built `.app` in Finder.

See the [Coding CLI guide](cli/README.md) for commands, one-shot input, JSON output and automation
approval.

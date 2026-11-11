# Coding application

The coding application has four parts:

- `agent/` defines the repository agent and exposes `startCodingServer()` for the local HTTP API.
- `cli/` runs one task from the terminal.
- `desktop/` packages a standalone Neiv app with the coding server and contains the Weiv and native UI.
- `demo/` is the fictional workspace showcase.

From the repository root, run `bun run agent:coding --help` for the optional terminal interface or `bun run agent:desktop --repo .` to build the desktop app. Open the built `.app` in Finder.

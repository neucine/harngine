# Harngine Coding Desktop

Harngine Coding is a macOS app for working with a repository through a coding agent. Ask it to explain code, investigate a problem, or propose an edit. The conversation shows the agent's replies, tool activity, and progress as the task runs.

## Get started

You need Bun, a local [Neiv](https://github.com/neucine/neiv) checkout, and a working Codex CLI login. From the Harngine repository root, run:

```bash
bun install
bun run agent:desktop --repo /absolute/path/to/your/repository
```

The command builds `apps/coding/desktop/build/NeivApp.app`. Double click that app in Finder. You can close the terminal after the build finishes. The app starts its local server when it opens and stops the server when it closes.

The repository path is saved in the app at build time. Run the build command again to point the app at a different repository. If Neiv is outside `../neiv`, set `NEIV_ROOT` to its checkout path before building.

## Work with the agent

Type a task in the message box and select **Run task**. The app starts in read mode, suitable for questions and investigation. Select **Allow edits and checks** to let the agent propose file changes and run checks. The app asks you to approve each proposed edit and shows the text being replaced.

The conversation includes agent replies and a tool record that opens while the task runs, folds when it finishes, and can be reopened afterward. A live Thinking status appears during model work; available provider thinking summaries appear in the record. Tool and status updates stream as the task runs. With the current Codex CLI structured-output transport, answer text arrives after each model invocation finishes rather than token by token. **Activity** shows the detailed model and tool events, including token usage; **Files** previews repository files; **Git** shows the current branch and local changes. You can steer or stop a running task, answer its questions, and queue another task while it works.

Sessions and their history are saved in the selected repository. An older session may use an Agent revision that is no longer in the current build. You can still read its history; choose **Start new session** to continue with the current Agent. Earlier messages do not carry into the new session.

## If the app cannot connect

Close the app and open the built `NeivApp.app` again. If it still reports a local server startup failure, read the server log at `~/Library/Logs/Neiv/dev.neucine.harngine.coding-server.log`. The app also shows this path in the error message. Make sure your Codex CLI login works by running `codex --version` and `codex` in Terminal, then rebuild the app if the CLI location changed.

## For developers

The desktop app uses Neiv and Weiv with Harngine's local HTTP API. See the [coding agent](../agent/README.md), [coding application layout](../README.md), and [Neiv local HTTP guide](https://github.com/neucine/neiv/blob/main/docs/api.md#local-http-client-and-server-apps) for implementation details.

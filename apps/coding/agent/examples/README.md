# Coding recovery examples

## Approval survives a restart

The [pending approval example](pending-approval-restart.mjs) starts a coding task, reads a test, and stops while an edit waits for approval. Its parent kills the process, opens the same Work in a new process, and checks that the exact approval is still waiting and the file is unchanged. After approval, the Work applies one edit and runs two Node tests. A fixed model response makes the sequence repeatable; this example tests the runtime path, not model quality.

From the Harngine repository root, install dependencies and build the coding agent:

```bash
bun install
bun run manifest
bun node_modules/typescript/bin/tsc -b apps/coding/agent --force
./node_modules/node/bin/node apps/coding/agent/examples/pending-approval-restart.mjs
```

The script prints the temporary evidence directory. Inspect or remove it when finished.

## Edit survives an interrupted reply

This example applies an approved edit, kills the coding process before its final reply, then opens the same Work in a new process. It checks that the file contains the change and the Work has one settled edit call. A fixed model response makes the interruption repeatable; this example does not measure model quality.

After the same build, run:

```bash
./node_modules/node/bin/node apps/coding/agent/examples/interrupted-edit.mjs
```

The script prints the temporary evidence directory. Inspect or remove it when finished. The process is killed **after** the edit call settles. For recovery when a file write itself has an uncertain outcome, see the [edit journal test](../test/recovery.test.ts).

## Resolve an edit whose result was lost

The [uncertain edit example](uncertain-edit-work.mjs) runs a small Workflow with a file edit Tool. It writes the file, then deliberately reports that the result was lost. The running Work records an uncertain Call. A read-only reconciliation checks the edit journal and file, then resolves that same Call without repeating the write. This is a controlled failure demonstration, not a process kill or a run of the interactive coding agent.

From the repository root, generate the definition manifest and run:

```bash
bun run manifest
./node_modules/node/bin/node apps/coding/agent/examples/uncertain-edit-work.mjs
```

The output shows the Call ID, one write attempt, one reconciliation lookup, and the temporary evidence directory.

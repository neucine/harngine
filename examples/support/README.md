# Customer support refund demo

This is the most familiar place to start: a customer says they were charged twice. A triage
specialist checks the account and refund policy, transfers the conversation to billing, and pauses
for a person to approve the exact refund before the write runs.

## Watch the walkthrough

[![Customer support refund walkthrough](https://raw.githubusercontent.com/neucine/promotion/main/projects/harngine/support-refund/poster.png)](https://github.com/neucine/promotion/tree/main/projects/harngine/support-refund)

The [69-second walkthrough](https://github.com/neucine/promotion/tree/main/projects/harngine/support-refund)
shows this specific Harngine example: a support inbox, a durable Triage → Billing handoff, and an
approval-gated refund.

```bash
bun install --frozen-lockfile
bun run demo:support
```

Open the printed local URL. The browser walkthrough takes about one minute:

1. Open the selected case in the support inbox and select **Run review**.
2. See the account evidence, policy citation, billing handoff, and pending refund approval in the
   customer context rail.
3. Confirm that the payment provider has not received a refund, then select
   **Approve exact refund**.
4. See the customer response, refund receipt, Tool history, handoff, and retained audit evidence.

No provider key, payment provider, or network connection is required. The model, account service,
policy search, and refund are deterministic local adapters wired through the real Harngine runtime.

Use `bun run demo:support:cli` for the same case as a short terminal narrative. Add `-- --json` for
the complete conversation, Tool calls, handoffs, and audit metadata.

## What this example demonstrates

This focused demo exercises the boundary between conversation continuity and specialist
execution. A triage Agent reads account state through a Tool selected from a persisted MCP catalog,
retrieves a versioned policy passage, returns a structured decision, and then the application
transfers Session ownership to a billing Agent only after triage Work is idle. Billing owns the
continuing conversation and performs a write through an exact approval.

The account catalog, model turns, policy retrieval, and refund are recorded Calls. The handoff is a
durable Session entry. The refund does not execute until the operator approves its exact input.

## Boundaries

- **Triage** owns the first objective and can read policy through `support.knowledge.search`.
- **MCP discovery** captures `account_status` as a catalog snapshot. Application source selects the
  stable Harngine ID and marks it as a read; MCP annotations do not grant authority.
- **Application routing** interprets the structured decision and calls `session.handoff()`. A model
  cannot reassign ownership by itself.
- **Billing** receives a new handle whose Agent revision owns the next objective. The old triage
  handle rejects `send()` with `SESSION_HANDED_OFF`.
- **Approval** is attached to `support.billing.refund`; the demo answers as a local support
  operator after displaying the exact Tool and input.
- **Lineage** remains on one Session. `session.handoffs()` reports exact from/to Agent revisions and
  `session.messages()` retains both specialists' published messages.
- **Audit** reads committed Work, decisions, authorization, guardrails, Attempts, interactions, and
  Session entries. The exported OTLP/JSON contains stable correlation IDs and safe status/reason
  fields, never objectives, prompts, messages, Tool input/output, or model payloads.
- **Live previews** are transient provider items delivered to an active Work watcher. They are not
  replayable, are excluded from inspection and restart history, and stop when the watcher aborts.
  Model-output guardrails suppress preview delivery so unvalidated output cannot bypass policy.

The example intentionally leaves the customer channel, authentication, ticketing integration, and
payment provider to the application. The browser screen and CLI both use the same local runtime.

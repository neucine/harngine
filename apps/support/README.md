# Support routing

This focused demo exercises the boundary between conversation continuity and specialist
execution. A triage Agent reads account state through a Tool selected from a persisted MCP catalog,
retrieves a versioned policy passage, returns a structured decision, and then the application
transfers Session ownership to a billing Agent only after triage Work is idle. Billing owns the
continuing conversation and performs a write through an exact approval.

```bash
bun run build
node apps/support/dist/main.js
```

The run prints the triage decision and its policy citation, the durable MCP and retrieval Calls,
the handoff lineage, the pending refund approval, the final structured answer, and the complete
conversation.

The default model, MCP client and retriever are deterministic and require no provider credentials.
The flow uses the real Harngine runtime: the account catalog, model turns, retrieval and refund are
recorded Calls, the handoff is a durable Session entry, and the refund does not execute until an
operator approves it.

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

The example intentionally leaves the customer channel, authentication, ticketing integration,
payment provider and product UI to the application.

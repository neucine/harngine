import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createSupportDesk,
  routeSupportConversation,
  waitForApproval,
  type SupportRequest,
} from './app.js';
import type { AuditExportBatch, ModelDelta } from 'harngine';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-')));
const desk = createSupportDesk({
  directory,
  audit: {
    retention: { maxEntries: 5_000 },
    redact: (entry) =>
      entry.reason?.code === 'SENSITIVE_DATA_REDACTED'
        ? {
            reason: {
              code: entry.reason.code,
              message: 'Sensitive support data was redacted',
            },
          }
        : {},
  },
});
const request: SupportRequest = {
  request: 'My card was charged twice for the same annual plan.',
  orderId: 'order-842',
  amountCents: 4_900,
};
const { values } = parseArgs({
  options: {
    cli: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

try {
  const livePreview: string[] = [];
  const routed = await routeSupportConversation(desk, request, {
    onModelDelta: (delta: ModelDelta) => {
      if (delta.item.type === 'text') livePreview.push(delta.item.text);
    },
  });
  const approval = await waitForApproval(routed.billingWork);
  await routed.billingWork.respond(approval.id, true);
  const resolution = await routed.billingWork.result();
  const handoffs = await routed.billingSession.handoffs();
  const messages = await routed.billingSession.messages();
  const triageStory = await routed.triageWork.inspect({ detail: 'story' });
  const audit = await desk.app.audit.list({ limit: 100 });
  const auditBatches: AuditExportBatch[] = [];
  const auditExport = await desk.app.audit.export({
    format: 'otel',
    limit: 5_000,
    sink: { write: (batch) => void auditBatches.push(batch) },
  });

  const evidence = {
    triage: routed.decision,
    ownership: handoffs,
    approval,
    resolution,
    conversation: messages,
    mcpEvidence: triageStory.entries.filter(
      (entry) => entry.type === 'call' && entry.tool?.id === 'support.account.status',
    ),
    retrievalEvidence: triageStory.entries.filter(
      (entry) => entry.type === 'call' && entry.tool?.id === 'support.knowledge.search',
    ),
    livePreview,
    audit: {
      entries: audit.entries.length,
      categories: [...new Set(audit.entries.map((entry) => entry.category))].sort(),
      exported: auditExport.exported,
      format: auditExport.format,
      batches: auditBatches.length,
    },
  };
  if (values.json) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    const refund = approval.details as { orderId: string; amountCents: number };
    const staff = handoffs[0];
    console.log(`
Harngine demo: customer support refund

Customer
  "${request.request}"
  Order ${request.orderId} · ${formatMoney(request.amountCents)}

1. Triage specialist investigates
  Account tool: two settled charges found.
  Policy tool: ${routed.decision.citations[0]?.source}
  Decision: ${routed.decision.summary}
  Next: transfer this conversation to billing.

2. Conversation moves to billing
  ${staff?.from.id ?? 'triage'} → ${staff?.to.id ?? 'billing specialist'}
  The original specialist can no longer send on this Session.
  Conversation history and the handoff reason remain inspectable.

3. Refund pauses for a person
  Proposed: refund ${formatMoney(refund.amountCents)} for ${refund.orderId}.
  The Tool has not run yet.
  Supervisor approval: granted by the local demo operator.

4. Customer response
  ${resolution.message}
  Refund receipt: ${resolution.receipt.refundId}

What Harngine proved
  ✓ Two real Tool calls supplied account and policy evidence.
  ✓ The billing handoff is an explicit Session entry.
  ✓ A person approved the exact order and amount before the write ran.
  ✓ ${audit.entries.length} payload-safe audit entries export as ${auditExport.format}.

Run with --json to inspect the complete conversation, calls, and audit metadata.
`);
  }
} finally {
  await desk.app.close();
  rmSync(directory, { recursive: true, force: true });
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
  }).format(cents / 100);
}

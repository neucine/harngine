import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
} finally {
  await desk.app.close();
  rmSync(directory, { recursive: true, force: true });
}

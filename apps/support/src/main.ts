import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSupportDesk,
  routeSupportConversation,
  waitForApproval,
  type SupportRequest,
} from './app.js';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-')));
const desk = createSupportDesk({ directory });
const request: SupportRequest = {
  request: 'My card was charged twice for the same annual plan.',
  orderId: 'order-842',
  amountCents: 4_900,
};

try {
  const routed = await routeSupportConversation(desk, request);
  const approval = await waitForApproval(routed.billingWork);
  await routed.billingWork.respond(approval.id, true);
  const resolution = await routed.billingWork.result();
  const handoffs = await routed.billingSession.handoffs();
  const messages = await routed.billingSession.messages();
  const triageStory = await routed.triageWork.inspect({ detail: 'story' });

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
      },
      null,
      2,
    ),
  );
} finally {
  await desk.app.close();
  rmSync(directory, { recursive: true, force: true });
}

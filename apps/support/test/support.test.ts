import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  createSupportDesk,
  routeSupportConversation,
  waitForApproval,
  type SupportRequest,
} from '../src/app.js';

test('support routing retrieves policy, hands off idle ownership and approves a refund', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-test-')));
  const mcpCalls: unknown[] = [];
  const desk = createSupportDesk({
    directory,
    mcpClient: {
      async callTool(input) {
        mcpCalls.push(input);
        return { content: [{ type: 'text', text: 'Order order-842 has two settled charges.' }] };
      },
    },
  });
  const request: SupportRequest = {
    request: 'I was charged twice for order 842.',
    orderId: 'order-842',
    amountCents: 4_900,
  };

  try {
    const routed = await routeSupportConversation(desk, request);
    expect(mcpCalls).toEqual([{ name: 'account_status', arguments: { orderId: 'order-842' } }]);
    expect(routed.decision).toMatchObject({
      disposition: 'handoff',
      department: 'billing',
      citations: [
        {
          source: 'policy://support/duplicate-charges',
          version: 'sha256:demo-duplicate-charge-policy',
        },
      ],
    });

    const approval = await waitForApproval(routed.billingWork);
    expect(approval).toMatchObject({
      tool: { id: 'support.billing.refund' },
      details: { orderId: 'order-842', amountCents: 4_900 },
    });
    await routed.billingWork.respond(approval.id, true);

    await expect(routed.billingWork.result()).resolves.toEqual({
      status: 'resolved',
      message: 'The duplicate charge was refunded after operator approval.',
      receipt: {
        refundId: 'refund_order-842',
        orderId: 'order-842',
        amountCents: 4_900,
        status: 'approved',
      },
    });
    await expect(routed.triageSession.send(request)).rejects.toMatchObject({
      code: 'SESSION_HANDED_OFF',
    });
    await expect(routed.billingSession.handoffs()).resolves.toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ id: desk.triage.id }),
        to: expect.objectContaining({ id: desk.billing.id }),
        reason: 'Duplicate-charge policy requires the billing specialist.',
      }),
    ]);

    const messages = await routed.billingSession.messages();
    expect(messages.map((message) => message.author)).toEqual(['human', 'agent', 'human', 'agent']);
    expect(messages[1]?.content).toMatchObject({
      disposition: 'handoff',
      citations: [expect.objectContaining({ source: 'policy://support/duplicate-charges' })],
    });
    expect(messages[3]?.content).toMatchObject({ status: 'resolved' });

    await expect(routed.triageWork.inspect({ detail: 'story' })).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          type: 'call',
          tool: expect.objectContaining({ id: 'support.account.status' }),
        }),
        expect.objectContaining({
          type: 'call',
          tool: expect.objectContaining({ id: 'support.knowledge.search' }),
        }),
      ]),
    });
  } finally {
    await desk.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

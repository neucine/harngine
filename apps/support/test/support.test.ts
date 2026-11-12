import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  createSupportDesk,
  routeSupportConversation,
  supportDemoModel,
  waitForApproval,
  type SupportRequest,
} from '../src/app.js';
import type { AuditExportBatch } from 'harngine';

for (const backend of ['better-sqlite3', 'node-sqlite'] as const)
  test(`support high-assurance flow with ${backend}`, async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-test-')));
    const mcpCalls: unknown[] = [];
    const modelRequests: unknown[] = [];
    const demo = supportDemoModel();
    const desk = createSupportDesk({
      directory,
      stateStore: { backend },
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
      model: {
        ...demo,
        async generate(request, options) {
          modelRequests.push(request);
          return demo.generate(request, options);
        },
      },
      mcpClient: {
        async callTool(input) {
          mcpCalls.push(input);
          return {
            content: [
              {
                type: 'text',
                text: 'Account acct-demo-842 shows order order-842 has two settled charges.',
              },
            ],
          };
        },
      },
    });
    const request: SupportRequest = {
      request: 'I was charged twice for order 842. Email alice@example.com.',
      orderId: 'order-842',
      amountCents: 4_900,
      customerEmail: 'alice@example.com',
    };

    try {
      expect(desk.storage).toMatchObject({
        backend,
        engine: 'sqlite',
        durability: 'full',
        transactions: 'atomic',
        ownership: 'exclusive',
        ownershipFencing: true,
      });
      const previews: string[] = [];
      const routed = await routeSupportConversation(desk, request, {
        onModelDelta: (delta) => {
          if (delta.item.type === 'text') previews.push(delta.item.text);
        },
      });
      expect(previews).toContain('Checking account evidence and the duplicate-charge policy…');
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
      expect(JSON.stringify(modelRequests)).toContain('[redacted-email]');
      expect(JSON.stringify(modelRequests)).toContain('[redacted-account]');
      expect(JSON.stringify(modelRequests)).not.toContain('alice@example.com');
      expect(JSON.stringify(modelRequests)).not.toContain('acct-demo-842');
      await expect(routed.triageWork.snapshot()).resolves.toMatchObject({
        objective: {
          request: request.request,
          customerEmail: 'alice@example.com',
        },
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
      expect(messages.map((message) => message.author)).toEqual([
        'human',
        'agent',
        'human',
        'agent',
      ]);
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
      const triageInspection = await routed.triageWork.inspect({ detail: 'diagnostic' });
      expect(triageInspection.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'guardrail',
            stage: 'model-input',
            action: 'redact',
          }),
          expect.objectContaining({
            type: 'guardrail',
            stage: 'tool-output',
            action: 'redact',
          }),
        ]),
      );
      expect(JSON.stringify(triageInspection.entries)).not.toContain('alice@example.com');
      expect(JSON.stringify(triageInspection.entries)).not.toContain('acct-demo-842');

      const audit = await desk.app.audit.list({ limit: 100 });
      expect(new Set(audit.entries.map((entry) => entry.category))).toEqual(
        new Set([
          'work',
          'decision',
          'authorization',
          'guardrail',
          'attempt',
          'interaction',
          'session',
        ]),
      );
      const batches: AuditExportBatch[] = [];
      await desk.app.audit.export({
        format: 'otel',
        sink: { write: (batch) => void batches.push(batch) },
      });
      expect(batches).toHaveLength(1);
      expect(JSON.stringify(batches)).not.toContain('alice@example.com');
      expect(JSON.stringify(batches)).not.toContain('acct-demo-842');
      expect(JSON.stringify(batches)).not.toContain(request.request);
    } finally {
      await desk.app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

for (const backend of ['better-sqlite3', 'node-sqlite'] as const)
  test(`excessive refund input is blocked before approval and execution on ${backend}`, async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-block-')));
    let refunds = 0;
    const desk = createSupportDesk({
      directory,
      stateStore: { backend },
      onRefund() {
        refunds++;
      },
    });
    const request: SupportRequest = {
      request: 'Please refund both charges for order 842.',
      orderId: 'order-842',
      amountCents: 50_000,
    };
    try {
      const routed = await routeSupportConversation(desk, request);
      await expect(routed.billingWork.result()).rejects.toMatchObject({ code: 'MODEL_FAILED' });
      expect(refunds).toBe(0);
      await expect(routed.billingWork.snapshot()).resolves.toMatchObject({
        status: 'failed',
        interactions: [],
      });
      const inspection = await routed.billingWork.inspect({ detail: 'diagnostic' });
      expect(inspection.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'guardrail',
            stage: 'tool-input',
            action: 'block',
            guardrail: expect.objectContaining({ id: 'support.refund-limit' }),
            reason: expect.objectContaining({ code: 'REFUND_LIMIT' }),
          }),
          expect.objectContaining({
            type: 'call',
            tool: expect.objectContaining({ id: 'support.billing.refund' }),
            attemptCount: 0,
          }),
        ]),
      );
    } finally {
      await desk.app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

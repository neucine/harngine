import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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
import { supportPage } from '../src/page.js';
import { serveSupport } from '../src/server.js';
import type { AuditExportBatch } from 'harngine';

test('CLI demo explains the customer refund story without JSON', () => {
  const output = execFileSync(process.execPath, ['examples/support/dist/main.js', '--cli'], {
    encoding: 'utf8',
  });
  expect(output).toContain('Harngine demo: customer support refund');
  expect(output).toContain('Account tool: two settled charges found.');
  expect(output).toContain('Refund pauses for a person');
  expect(output).toContain('The duplicate charge was refunded after operator approval.');
  expect(output).not.toContain('"triage":');
});

test('browser demo makes the refund decision trail understandable before it runs', () => {
  const html = supportPage('test-token');
  expect(html).toContain('data-token="test-token"');
  expect(html).toContain('--canvas:#f2f4f3');
  expect(html).toContain('src="/main.mjs"');

  const source = readFileSync(join(process.cwd(), 'examples/support/src/ui/App.weiv'), 'utf8');
  expect(source).toContain('Run the refund review');
  expect(source).toContain('Run review');
  expect(source).toContain('Approval required');
  expect(source).toContain('payment provider has not received this request');
  expect(source).toContain('Approve exact refund');
  expect(source).toContain('Refund ran only after approval');
  expect(source).toContain('Run another case');
});

test('public support path investigates, pauses, approves, and exposes audit evidence', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-support-web-')));
  let refunded = 0;
  const desk = createSupportDesk({
    directory,
    onRefund() {
      refunded++;
    },
  });
  const server = await serveSupport({ desk });

  try {
    const unauthorized = await fetch(`${server.url}/api/case`, { method: 'POST' });
    expect(unauthorized.status).toBe(403);

    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    const token = html.match(/data-token="([^"]+)"/)?.[1];
    expect(token).toBeTruthy();

    expect((await fetch(`${server.url}/App.mjs`)).status).toBe(200);
    expect((await fetch(`${server.url}/styles.css`)).status).toBe(200);

    const headers = { 'x-support-token': token! };
    const opened = await fetch(`${server.url}/api/case`, { method: 'POST', headers });
    expect(opened.status).toBe(200);
    const pending = (await opened.json()) as {
      triage: { summary: string; citations: { source: string }[] };
      approval: { tool: string; details: { orderId: string; amountCents: number } };
      investigation: { tool: string; phase: string }[];
      previews: string[];
    };
    expect(pending.triage).toMatchObject({
      summary: 'Two settled charges need specialist review.',
      citations: [{ source: 'policy://support/duplicate-charges' }],
    });
    expect(pending.approval).toMatchObject({
      tool: 'support.billing.refund',
      details: { orderId: 'order-842', amountCents: 4_900 },
    });
    expect(pending.investigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'support.account.status', phase: 'settled' }),
        expect.objectContaining({ tool: 'support.knowledge.search', phase: 'settled' }),
        expect.objectContaining({ tool: 'support.billing.refund' }),
      ]),
    );
    expect(pending.previews).toContain(
      'Checking account evidence and the duplicate-charge policy…',
    );
    expect(pending.previews).toContain('Preparing the approval-gated billing action…');
    expect(refunded).toBe(0);

    const approved = await fetch(`${server.url}/api/approve`, { method: 'POST', headers });
    expect(approved.status).toBe(200);
    const completion = (await approved.json()) as {
      resolution: {
        status: string;
        receipt: { refundId: string; orderId: string; amountCents: number };
      };
      handoff: { from: { id: string }; to: { id: string } };
      evidence: { tool: string; phase: string }[];
      audit: { entries: number; categories: string[] };
    };
    expect(completion.resolution).toMatchObject({
      status: 'resolved',
      receipt: {
        refundId: 'refund_order-842',
        orderId: 'order-842',
        amountCents: 4_900,
      },
    });
    expect(completion.handoff).toMatchObject({
      from: { id: 'support.triage' },
      to: { id: 'support.billing-specialist' },
    });
    expect(completion.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'support.account.status', phase: 'settled' }),
        expect.objectContaining({ tool: 'support.knowledge.search', phase: 'settled' }),
        expect.objectContaining({ tool: 'support.billing.refund', phase: 'settled' }),
      ]),
    );
    expect(completion.audit.entries).toBeGreaterThan(0);
    expect(completion.audit.categories).toEqual(
      expect.arrayContaining([
        'work',
        'decision',
        'authorization',
        'guardrail',
        'attempt',
        'interaction',
        'session',
      ]),
    );
    expect(refunded).toBe(1);

    const reset = await fetch(`${server.url}/api/reset`, { method: 'POST', headers });
    expect(reset.status).toBe(200);
    const reopened = await fetch(`${server.url}/api/case`, { method: 'POST', headers });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()) as unknown).toMatchObject({
      approval: {
        tool: 'support.billing.refund',
        details: { orderId: 'order-842', amountCents: 4_900 },
      },
    });
    expect(refunded).toBe(1);
  } finally {
    await server.close();
    await desk.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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

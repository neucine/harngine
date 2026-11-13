import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeSupportConversation,
  waitForApproval,
  type RoutedSupportConversation,
  type SupportDesk,
  type SupportRequest,
} from './app.js';
import { supportPage } from './page.js';
import type { CallInspectionEntry, InspectionEntry } from 'harngine';

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), '../public');
const assets = new Map([
  ['/App.mjs', 'text/javascript; charset=utf-8'],
  ['/main.mjs', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
]);

const request: SupportRequest = {
  request: 'My card was charged twice for the same annual plan.',
  orderId: 'order-842',
  amountCents: 4_900,
};

type Approval = Awaited<ReturnType<typeof waitForApproval>>;
type ActiveCase = {
  readonly routed: RoutedSupportConversation;
  readonly approval: Approval;
  readonly previews: string[];
  readonly billingWatch: Promise<void>;
  readonly cancelBillingWatch: () => void;
};

export async function serveSupport(options: { desk: SupportDesk; port?: number }) {
  const token = randomBytes(24).toString('hex');
  let origin = '';
  let active: ActiveCase | null = null;
  let completed: unknown = null;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return json(403, { error: 'Local origin required' });
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(supportPage(token));
        return;
      }
      if (req.method === 'GET' && req.url && assets.has(req.url)) {
        const path = join(publicDirectory, req.url.slice(1));
        if (!existsSync(path)) return json(503, { error: 'Build the support UI first' });
        res.writeHead(200, { 'Content-Type': assets.get(req.url)! });
        res.end(readFileSync(path));
        return;
      }
      if (req.headers['x-support-token'] !== token)
        return json(403, { error: 'Open the support demo first' });
      if (req.method === 'POST' && req.url === '/api/case') {
        if (completed) return json(200, completed);
        if (!active) {
          const previews: string[] = [];
          const routed = await routeSupportConversation(options.desk, request, {
            onModelDelta(delta) {
              if (delta.item.type === 'text') previews.push(delta.item.text);
            },
          });
          const billingWatchAbort = new AbortController();
          const billingWatch = await routed.billingWork.watch({
            signal: billingWatchAbort.signal,
            onModelDelta(delta) {
              if (delta.item.type === 'text') previews.push(delta.item.text);
            },
          });
          const consumingBilling = (async () => {
            try {
              for await (const _update of billingWatch) {
                // Preview delivery advances durable Work state.
              }
            } catch (error) {
              if (!billingWatchAbort.signal.aborted) throw error;
            }
          })();
          const approval = await waitForApproval(routed.billingWork);
          active = {
            routed,
            approval,
            previews,
            billingWatch: consumingBilling,
            cancelBillingWatch: () => billingWatchAbort.abort(),
          };
        }
        const triage = await active.routed.triageWork.inspect({ detail: 'story' });
        const billing = await active.routed.billingWork.inspect({ detail: 'story' });
        return json(200, caseView(active, evidence(triage.entries, billing.entries)));
      }
      if (req.method === 'POST' && req.url === '/api/approve') {
        if (completed) return json(200, completed);
        if (!active) return json(409, { error: 'Open the customer case first' });
        await active.routed.billingWork.respond(active.approval.id, true);
        await active.billingWatch;
        const resolution = await active.routed.billingWork.result();
        const handoffs = await active.routed.billingSession.handoffs();
        const triage = await active.routed.triageWork.inspect({ detail: 'story' });
        const billing = await active.routed.billingWork.inspect({ detail: 'story' });
        const audit = await options.desk.app.audit.list({
          sessionId: active.routed.billingSession.id,
          limit: 100,
        });
        completed = {
          resolution,
          handoff: handoffs[0],
          evidence: evidence(triage.entries, billing.entries),
          previews: active.previews,
          audit: {
            entries: audit.entries.length,
            categories: [...new Set(audit.entries.map((entry) => entry.category))].sort(),
          },
        };
        return json(200, completed);
      }
      if (req.method === 'POST' && req.url === '/api/reset') {
        active?.cancelBillingWatch();
        active = null;
        completed = null;
        return json(200, { ok: true });
      }
      return json(404, { error: 'Not found' });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : 'Demo request failed' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        active?.cancelBillingWatch();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

function caseView(active: ActiveCase, investigation: ReturnType<typeof evidence>) {
  return {
    customer: request,
    triage: active.routed.decision,
    approval: {
      title: active.approval.title,
      details: active.approval.details,
      tool: active.approval.tool?.id,
    },
    investigation,
    previews: [...new Set(active.previews)],
  };
}

function evidence(triage: readonly InspectionEntry[], billing: readonly InspectionEntry[]) {
  const byTool = new Map<
    string,
    {
      tool: string;
      phase: CallInspectionEntry['phase'];
      attempts: number;
      status: string;
    }
  >();
  for (const entry of [...triage, ...billing]) {
    if (entry.type !== 'call') continue;
    const previous = byTool.get(entry.tool.id);
    byTool.set(entry.tool.id, {
      tool: entry.tool.id,
      phase: entry.phase,
      attempts: Math.max(previous?.attempts ?? 0, entry.attemptCount),
      status: entry.phase === 'settled' || entry.phase === 'resolved' ? 'complete' : entry.phase,
    });
  }
  return [...byTool.values()];
}

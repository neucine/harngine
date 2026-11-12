import { mcpToolCatalog, mcpToolFromCatalog, type McpToolClient } from '@harngine/mcp';
import { retrievalTool, type Retriever, type RetrievedPassage } from '@harngine/retrieval';
import {
  agent,
  createApp,
  schema,
  tool,
  type App,
  type ContextItem,
  type ModelAdapter,
  type ModelRequest,
  type Session,
  type Work,
} from 'harngine';

export type SupportRequest = {
  readonly request: string;
  readonly orderId: string;
  readonly amountCents: number;
};

export type Citation = {
  readonly source: string;
  readonly version: string;
};

export type TriageDecision = {
  readonly disposition: 'handoff';
  readonly department: 'billing';
  readonly summary: string;
  readonly reason: string;
  readonly citations: Citation[];
};

export type RefundReceipt = {
  readonly refundId: string;
  readonly orderId: string;
  readonly amountCents: number;
  readonly status: 'approved';
};

export type BillingResolution = {
  readonly status: 'resolved';
  readonly message: string;
  readonly receipt: RefundReceipt;
};

export interface SupportDesk {
  readonly app: App;
  readonly triage: ReturnType<typeof defineTriageAgent>;
  readonly billing: ReturnType<typeof defineBillingAgent>;
  readonly accountStatus: ReturnType<typeof defineAccountStatusTool>;
  readonly knowledge: ReturnType<typeof defineKnowledgeTool>;
  readonly refund: ReturnType<typeof defineRefundTool>;
}

export interface RoutedSupportConversation {
  readonly triageSession: Session<SupportRequest, TriageDecision>;
  readonly billingSession: Session<SupportRequest, BillingResolution>;
  readonly triageWork: Work<SupportRequest, TriageDecision>;
  readonly billingWork: Work<SupportRequest, BillingResolution>;
  readonly decision: TriageDecision;
}

const supportRequest = schema<SupportRequest>({
  id: 'support.request',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['request', 'orderId', 'amountCents'],
    properties: {
      request: { type: 'string', minLength: 1 },
      orderId: { type: 'string', minLength: 1 },
      amountCents: { type: 'integer', minimum: 1 },
    },
  },
});

const citation = schema<Citation>({
  id: 'support.citation',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'version'],
    properties: {
      source: { type: 'string', minLength: 1 },
      version: { type: 'string', minLength: 1 },
    },
  },
});

const triageDecision = schema<TriageDecision>({
  id: 'support.triage-decision',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['disposition', 'department', 'summary', 'reason', 'citations'],
    properties: {
      disposition: { enum: ['handoff'] },
      department: { enum: ['billing'] },
      summary: { type: 'string', minLength: 1 },
      reason: { type: 'string', minLength: 1 },
      citations: { type: 'array', minItems: 1, items: citation.jsonSchema },
    },
  },
});

const refundReceipt = schema<RefundReceipt>({
  id: 'support.refund-receipt',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['refundId', 'orderId', 'amountCents', 'status'],
    properties: {
      refundId: { type: 'string', minLength: 1 },
      orderId: { type: 'string', minLength: 1 },
      amountCents: { type: 'integer', minimum: 1 },
      status: { enum: ['approved'] },
    },
  },
});

const billingResolution = schema<BillingResolution>({
  id: 'support.billing-resolution',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'message', 'receipt'],
    properties: {
      status: { enum: ['resolved'] },
      message: { type: 'string', minLength: 1 },
      receipt: refundReceipt.jsonSchema,
    },
  },
});

const refundInput = schema<{ orderId: string; amountCents: number }>({
  id: 'support.refund-input',
  version: '1',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['orderId', 'amountCents'],
    properties: {
      orderId: { type: 'string', minLength: 1 },
      amountCents: { type: 'integer', minimum: 1 },
    },
  },
});

const accountCatalog = mcpToolCatalog({
  object: 'mcp_tool_catalog',
  server: { name: 'support-account-fixture', version: '1.0.0' },
  tools: [
    {
      name: 'account_status',
      description: 'Read the charge state for one order.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['orderId'],
        properties: {
          orderId: { type: 'string', minLength: 1 },
        },
      },
    },
  ],
});

function defineAccountStatusTool(client: McpToolClient) {
  return mcpToolFromCatalog(accountCatalog, {
    id: 'support.account.status',
    name: 'account_status',
    description: 'Read the account charge state through the selected MCP catalog.',
    effect: 'read',
    client,
  });
}

function defineKnowledgeTool(retriever: Retriever) {
  return retrievalTool({
    id: 'support.knowledge.search',
    description: 'Find the support policy that applies to a customer request.',
    retriever,
    maxResults: 3,
  });
}

function defineRefundTool() {
  return tool({
    id: 'support.billing.refund',
    description: 'Refund one duplicate charge after operator approval.',
    input: refundInput,
    output: refundReceipt,
    effect: 'write',
    capabilities: { idempotency: 'operation-key', reversibility: 'reversible' },
    approval: { approvers: ['local'], timeoutMs: 60_000 },
    execute(input) {
      return Object.freeze({
        refundId: `refund_${input.orderId}`,
        orderId: input.orderId,
        amountCents: input.amountCents,
        status: 'approved' as const,
      });
    },
  });
}

function defineTriageAgent(
  model: ModelAdapter,
  accountStatus: ReturnType<typeof defineAccountStatusTool>,
  knowledge: ReturnType<typeof defineKnowledgeTool>,
) {
  return agent({
    id: 'support.triage',
    instructions: [
      'You are the first-line support triage Agent.',
      'Read the order charge state through the MCP account Tool.',
      'Use the knowledge Tool before recommending a route.',
      'Billing disputes must transfer ownership to the billing specialist.',
    ],
    objective: supportRequest,
    result: triageDecision,
    publish: (decision) => decision,
    model,
    tools: [accountStatus, knowledge],
  });
}

function defineBillingAgent(model: ModelAdapter, refund: ReturnType<typeof defineRefundTool>) {
  return agent({
    id: 'support.billing-specialist',
    instructions: [
      'You are the billing specialist who now owns the conversation.',
      'Issue a refund only through the approval-gated refund Tool.',
    ],
    objective: supportRequest,
    result: billingResolution,
    publish: (resolution) => resolution,
    model,
    tools: [refund],
  });
}

type SuccessfulToolOutcome = Extract<ContextItem, { type: 'tool_outcome' }> & {
  readonly outcome: { readonly status: 'success'; readonly value: unknown };
};

function successfulToolOutcome(
  request: ModelRequest,
  toolId: string,
): SuccessfulToolOutcome | undefined {
  const item = request.context.items.find(
    (item) =>
      item.type === 'tool_outcome' &&
      item.call.tool.id === toolId &&
      item.outcome.status === 'success',
  );
  if (item?.type !== 'tool_outcome' || item.outcome.status !== 'success') return undefined;
  return item as SuccessfulToolOutcome;
}

/** Deterministic demo model. A production application supplies its own provider adapter. */
export function supportDemoModel(): ModelAdapter {
  return {
    id: 'support-demo-model',
    capabilities: { tools: true, structuredOutput: true, streaming: false },
    async generate(request) {
      const objective = request.context.objective as SupportRequest;
      const account = successfulToolOutcome(request, 'support.account.status');
      const knowledge = successfulToolOutcome(request, 'support.knowledge.search');
      const refund = successfulToolOutcome(request, 'support.billing.refund');

      if (request.tools.some((definition) => definition.id === 'support.knowledge.search')) {
        if (!account)
          return {
            object: 'model_response',
            items: [
              {
                type: 'tool-call',
                providerCallId: 'account-1',
                tool: 'support.account.status',
                input: { orderId: objective.orderId },
              },
            ],
            finishReason: 'tool-calls',
          };
        if (!knowledge)
          return {
            object: 'model_response',
            items: [
              {
                type: 'tool-call',
                providerCallId: 'knowledge-1',
                tool: 'support.knowledge.search',
                input: { query: objective.request, limit: 1 },
              },
            ],
            finishReason: 'tool-calls',
          };
        if (knowledge.outcome.status !== 'success')
          throw new Error('Expected successful knowledge evidence');
        const result = knowledge.outcome.value as { passages: RetrievedPassage[] };
        const passage = result.passages[0];
        if (!passage) throw new Error('Expected a retrieved support policy');
        const accountText = (
          account.outcome.value as {
            content: { type: string; text?: string }[];
          }
        ).content.find((item) => item.type === 'text')?.text;
        if (!accountText?.includes('two settled charges'))
          throw new Error('Expected the MCP account evidence to confirm a duplicate charge');
        return {
          object: 'model_response',
          items: [
            {
              type: 'data',
              value: {
                disposition: 'handoff',
                department: 'billing',
                summary: 'Two settled charges need specialist review.',
                reason: 'Duplicate-charge policy requires the billing specialist.',
                citations: [{ source: passage.source, version: passage.version }],
              },
            },
          ],
          finishReason: 'stop',
        };
      }

      if (!refund)
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: 'refund-1',
              tool: 'support.billing.refund',
              input: {
                orderId: objective.orderId,
                amountCents: objective.amountCents,
              },
            },
          ],
          finishReason: 'tool-calls',
        };
      if (refund.outcome.status !== 'success') throw new Error('Expected a successful refund');
      return {
        object: 'model_response',
        items: [
          {
            type: 'data',
            value: {
              status: 'resolved',
              message: 'The duplicate charge was refunded after operator approval.',
              receipt: refund.outcome.value,
            },
          },
        ],
        finishReason: 'stop',
      };
    },
  };
}

export function createSupportDesk(options: {
  readonly directory: string;
  readonly model?: ModelAdapter;
  readonly retriever?: Retriever;
  readonly mcpClient?: McpToolClient;
}): SupportDesk {
  const model = options.model ?? supportDemoModel();
  const retriever =
    options.retriever ??
    ({
      async search(query) {
        return [
          {
            source: 'policy://support/duplicate-charges',
            version: 'sha256:demo-duplicate-charge-policy',
            title: 'Duplicate charge policy',
            text: 'Verify the duplicate charge and transfer ownership to billing before refunding.',
            score: query ? 1 : 0,
          },
        ];
      },
    } satisfies Retriever);
  const mcpClient =
    options.mcpClient ??
    ({
      async callTool(input) {
        const orderId = String((input.arguments as { orderId?: unknown }).orderId ?? 'unknown');
        return {
          content: [
            {
              type: 'text',
              text: `Order ${orderId} has two settled charges.`,
            },
          ],
        };
      },
    } satisfies McpToolClient);
  const accountStatus = defineAccountStatusTool(mcpClient);
  const knowledge = defineKnowledgeTool(retriever);
  const refund = defineRefundTool();
  const triage = defineTriageAgent(model, accountStatus, knowledge);
  const billing = defineBillingAgent(model, refund);
  return {
    app: createApp({ directory: options.directory, agents: [triage, billing] }),
    triage,
    billing,
    accountStatus,
    knowledge,
    refund,
  };
}

export async function routeSupportConversation(
  desk: SupportDesk,
  request: SupportRequest,
): Promise<RoutedSupportConversation> {
  const triageSession = await desk.app.sessions.create({
    agent: desk.triage,
    title: `Order ${request.orderId}`,
  });
  const { work: triageWork } = await triageSession.send(request);
  const decision = await triageWork.result();
  const billingSession = await triageSession.handoff(desk.billing, {
    reason: decision.reason,
  });
  const { work: billingWork } = await billingSession.send(request);
  return {
    triageSession,
    billingSession,
    triageWork,
    billingWork,
    decision,
  };
}

export async function waitForApproval(
  work: Work,
  timeoutMs = 5_000,
): Promise<{
  readonly id: string;
  readonly title: string;
  readonly details: unknown;
  readonly tool?: { readonly id: string; readonly revision: string };
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await work.snapshot();
    const approval = snapshot.interactions.find((interaction) => interaction.type === 'approval');
    if (approval)
      return {
        id: approval.id,
        title: approval.title,
        details: approval.details,
        ...(approval.tool ? { tool: approval.tool } : {}),
      };
    if (snapshot.status === 'completed' || snapshot.status === 'failed')
      throw new Error(`Work ${work.id} closed before requesting approval`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Work ${work.id} did not request approval`);
}

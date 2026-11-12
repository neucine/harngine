import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { agent, createApp, schema, type App, type ModelAdapter, type ModelRequest } from 'harngine';
import {
  Client,
  createMcpClientSession,
  mcpTool,
  type McpToolClient,
  type McpTransportFactory,
} from '../src/index.js';

const sdkClient: McpToolClient = new Client({ name: 'test', version: '1.0.0' });
void sdkClient;

test('bridge calls a connected MCP server', async () => {
  const server = new McpServer({ name: 'fixture', version: '1.0.0' });
  server.registerTool(
    'lookup',
    {
      description: 'Look up an item',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => ({ content: [{ type: 'text', text: `Found ${id}` }] }),
  );
  const client = new Client({ name: 'harngine-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    expect((await client.listTools()).tools.map((item) => item.name)).toContain('lookup');
    const wrapped = mcpTool({
      id: 'test.mcp.live-lookup',
      name: 'lookup',
      description: 'Look up an item',
      effect: 'read',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      client,
    });
    const result = await wrapped.execute(
      { id: 'A-1' },
      {
        signal: new AbortController().signal,
        idempotencyKey: 'attempt-live',
        fail(error) {
          throw new Error(error.code);
        },
        effectUnknown(error) {
          throw new Error(error.code);
        },
      },
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'Found A-1' }] });
  } finally {
    await client.close();
    await server.close();
  }
});

test('client session keeps its bridge usable across reconnect', async () => {
  const servers: McpServer[] = [];
  const createFixture = async () => {
    const server = new McpServer({ name: 'reconnect-fixture', version: '1.0.0' });
    servers.push(server);
    server.registerTool(
      'lookup',
      {
        description: 'Look up an item',
        inputSchema: z.object({ id: z.string() }),
      },
      async ({ id }) => ({ content: [{ type: 'text', text: `Found ${id}` }] }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    return { server, clientTransport };
  };
  const transports: McpTransportFactory = async () => {
    const fixture = await createFixture();
    return fixture.clientTransport;
  };
  const session = createMcpClientSession({
    clientInfo: { name: 'harngine-test', version: '1.0.0' },
    transport: transports,
  });
  const wrapped = mcpTool({
    id: 'test.mcp.reconnect',
    name: 'lookup',
    description: 'Look up an item',
    effect: 'read',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    client: session,
  });
  try {
    await session.connect();
    await session.reconnect();
    const result = await wrapped.execute(
      { id: 'A-2' },
      {
        signal: new AbortController().signal,
        idempotencyKey: 'attempt-reconnect',
        fail(error) {
          throw new Error(error.code);
        },
        effectUnknown(error) {
          throw new Error(error.code);
        },
      },
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'Found A-2' }] });
  } finally {
    await session.close();
    for (const server of servers) await server.close();
  }
});

test('explicit MCP read tool returns content and structured data', async () => {
  const calls: unknown[] = [];
  const wrapped = mcpTool({
    id: 'test.mcp.lookup',
    name: 'lookup',
    description: 'Look up an item',
    effect: 'read',
    inputSchema: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { type: 'string' } },
    },
    client: {
      async callTool(input) {
        calls.push(input);
        return { content: [{ type: 'text', text: 'Found' }], structuredContent: { id: 'a' } };
      },
    },
  });
  const result = await wrapped.execute(
    { id: 'a' },
    {
      signal: new AbortController().signal,
      idempotencyKey: 'attempt-1',
      fail(error) {
        throw new Error(error.code);
      },
      effectUnknown(error) {
        throw new Error(error.code);
      },
    },
  );
  expect(calls).toEqual([{ name: 'lookup', arguments: { id: 'a' } }]);
  expect(result).toEqual({
    content: [{ type: 'text', text: 'Found' }],
    structuredContent: { id: 'a' },
  });
});

test('MCP write errors preserve uncertain effect', async () => {
  const wrapped = mcpTool({
    id: 'test.mcp.change',
    name: 'change',
    description: 'Change an item',
    effect: 'write',
    inputSchema: { type: 'object' },
    client: {
      async callTool() {
        return { isError: true, content: [] };
      },
    },
  });
  await expect(
    wrapped.execute(
      {},
      {
        signal: new AbortController().signal,
        idempotencyKey: 'attempt-2',
        fail(error) {
          throw new Error(`failed:${error.code}`);
        },
        effectUnknown(error) {
          throw new Error(`unknown:${error.code}`);
        },
      },
    ),
  ).rejects.toThrow('unknown:MCP_TOOL_ERROR');
});

test('Agent restores one MCP write and uses a reconnected session for new Work', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-mcp-agent-')));
  const modelHarnessId = 'test.mcp.recovery-model';
  const apps: App[] = [];
  const servers: McpServer[] = [];
  const writes: string[] = [];
  const transports: McpTransportFactory = async () => {
    const server = new McpServer({ name: 'agent-recovery-fixture', version: '1.0.0' });
    servers.push(server);
    server.registerTool(
      'change',
      {
        description: 'Change one item',
        inputSchema: z.object({ id: z.string() }),
      },
      async ({ id }) => {
        writes.push(id);
        return { content: [{ type: 'text', text: `Changed ${id}` }] };
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    return clientTransport;
  };
  const session = createMcpClientSession({
    clientInfo: { name: 'harngine-agent-test', version: '1.0.0' },
    transport: transports,
  });
  const change = mcpTool({
    id: 'test.mcp.agent-change',
    name: 'change',
    description: 'Change one item',
    effect: 'write',
    writeCapabilities: { idempotency: 'intrinsic', reversibility: 'reversible' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    client: session,
  });
  const text = schema<string>({
    id: 'test.mcp.agent-answer',
    version: '1',
    jsonSchema: { type: 'string' },
  });
  const firstModel: ModelAdapter = {
    id: modelHarnessId,
    capabilities: { tools: true, structuredOutput: false, streaming: false },
    async generate(request: ModelRequest) {
      const evidence = request.context.items.find((entry) => entry.type === 'tool_outcome');
      if (!evidence) {
        const id = String(request.context.objective).includes('item-2') ? 'item-2' : 'item-1';
        return {
          object: 'model_response',
          items: [
            {
              type: 'tool-call',
              providerCallId: `change-${id}`,
              tool: change.id,
              input: { id },
            },
          ],
          finishReason: 'tool-calls',
        };
      }
      if (evidence.type !== 'tool_outcome' || evidence.outcome.status !== 'success')
        throw new Error('Expected the completed MCP write');
      return {
        object: 'model_response',
        items: [
          {
            type: 'text',
            text: (evidence.outcome.value as { content: { text: string }[] }).content[0]!.text,
          },
        ],
        finishReason: 'stop',
      };
    },
  };
  const firstAssistant = agent({
    id: 'test.mcp.recovery-agent',
    instructions: 'Change the item once, then report the result.',
    objective: text,
    model: firstModel,
    tools: [change],
  });
  try {
    await session.connect();
    const first = createApp({ directory, agents: [firstAssistant] });
    apps.push(first);
    const work = await first.start(firstAssistant, 'Change item-1');
    await expect(work.result()).resolves.toBe('Changed item-1');
    expect(writes).toEqual(['item-1']);
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    await session.close();
    await session.reconnect();
    const restored = createApp({ directory, agents: [firstAssistant] });
    apps.push(restored);
    const restoredWork = await restored.works.get(work.id);
    await expect(restoredWork.result()).resolves.toBe('Changed item-1');
    expect(writes).toEqual(['item-1']);
    const settled = (await restoredWork.inspect({ detail: 'diagnostic' })).entries.filter(
      (entry) => entry.type === 'call' && entry.phase === 'settled' && entry.tool.id === change.id,
    );
    expect(settled).toHaveLength(1);
    const next = await restored.start(firstAssistant, 'Change item-2');
    await expect(next.result()).resolves.toBe('Changed item-2');
    expect(writes).toEqual(['item-1', 'item-2']);
  } finally {
    for (const app of apps.splice(0)) await app.close();
    await session.close();
    for (const server of servers) await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

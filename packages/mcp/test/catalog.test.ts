import { expect, test } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  Client,
  discoverMcpTools,
  mcpToolCatalog,
  mcpToolFromCatalog,
  type McpCatalogClient,
} from '../src/index.js';

test('discovery captures a deterministic catalog and selects its exact Tool contract', async () => {
  const server = new McpServer({ name: 'catalog-fixture', version: '1.2.3' });
  server.registerTool(
    'lookup',
    {
      title: 'Lookup',
      description: 'Look up an item',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => ({ content: [{ type: 'text', text: `Found ${id}` }] }),
  );
  const client = new Client({ name: 'harngine-catalog-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const catalog = await discoverMcpTools(client);
    expect(catalog).toMatchObject({
      object: 'mcp_tool_catalog',
      server: { name: 'catalog-fixture', version: '1.2.3' },
      tools: [
        {
          name: 'lookup',
          title: 'Lookup',
          description: 'Look up an item',
          inputSchema: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
        },
      ],
    });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.tools[0]?.inputSchema)).toBe(true);

    const restored = mcpToolCatalog(JSON.parse(JSON.stringify(catalog)));
    const wrapped = mcpToolFromCatalog(restored, {
      id: 'test.mcp.catalog-lookup',
      name: 'lookup',
      effect: 'read',
      client,
    });
    const changedContract = mcpToolFromCatalog(
      mcpToolCatalog({
        object: 'mcp_tool_catalog',
        tools: [
          {
            name: 'lookup',
            description: 'A changed remote contract',
            inputSchema: { type: 'object' },
          },
        ],
      }),
      {
        id: 'test.mcp.catalog-lookup',
        name: 'lookup',
        effect: 'read',
        client,
      },
    );
    expect(changedContract.revision).not.toBe(wrapped.revision);
    const result = await wrapped.execute(
      { id: 'item-1' },
      {
        signal: new AbortController().signal,
        idempotencyKey: 'catalog-attempt',
        fail(error) {
          throw new Error(error.code);
        },
        effectUnknown(error) {
          throw new Error(error.code);
        },
      },
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'Found item-1' }] });
  } finally {
    await client.close();
    await server.close();
  }
});

test('discovery follows pages and enforces its snapshot limit', async () => {
  const pages = new Map<
    string | undefined,
    { tools: { name: string; inputSchema: unknown }[]; nextCursor?: string }
  >([
    [undefined, { tools: [{ name: 'second', inputSchema: { type: 'object' } }], nextCursor: '2' }],
    ['2', { tools: [{ name: 'first', inputSchema: { type: 'object' } }] }],
  ]);
  const client: McpCatalogClient = {
    async listTools(params) {
      return pages.get(params?.cursor)!;
    },
  };
  const catalog = await discoverMcpTools(client);
  expect(catalog.tools.map((tool) => tool.name)).toEqual(['first', 'second']);
  await expect(discoverMcpTools(client, { maxTools: 1 })).rejects.toThrow('1 Tool limit');
});

test('catalog validation rejects duplicate or malformed contracts and missing selections', () => {
  expect(() =>
    mcpToolCatalog({
      object: 'mcp_tool_catalog',
      tools: [
        { name: 'duplicate', inputSchema: { type: 'object' } },
        { name: 'duplicate', inputSchema: { type: 'object' } },
      ],
    }),
  ).toThrow('duplicate Tool duplicate');
  expect(() =>
    mcpToolCatalog({
      object: 'mcp_tool_catalog',
      tools: [{ name: 'invalid', inputSchema: [] }],
    }),
  ).toThrow('inputSchema must be a JSON Schema object');
  expect(() =>
    mcpToolCatalog({
      object: 'mcp_tool_catalog',
      tools: Array.from({ length: 257 }, (_, index) => ({
        name: `tool-${index}`,
        inputSchema: { type: 'object' },
      })),
    }),
  ).toThrow('256 Tool limit');

  const catalog = mcpToolCatalog({
    object: 'mcp_tool_catalog',
    tools: [{ name: 'available', inputSchema: { type: 'object' } }],
  });
  expect(() =>
    mcpToolFromCatalog(catalog, {
      id: 'test.mcp.missing',
      name: 'missing',
      effect: 'read',
      client: {
        async callTool() {
          return { content: [] };
        },
      },
    }),
  ).toThrow('absent from the selected catalog snapshot');
});

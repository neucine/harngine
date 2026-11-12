import {
  Client,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  schema,
  tool,
  type Guardrail,
  type Json,
  type Tool,
  type WriteToolCapabilities,
} from 'harngine';

export { Client, StdioClientTransport, StreamableHTTPClientTransport };

export interface McpToolClient {
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): Promise<{
    content: unknown[];
    structuredContent?: unknown;
    isError?: boolean | undefined;
  }>;
}

export interface McpToolDefinition {
  /** Stable Harngine ID, included in the generated definition manifest. */
  id: string;
  description: string;
  /** MCP tool name on the connected server. */
  name: string;
  client: McpToolClient;
  inputSchema: Json;
  effect: 'read' | 'write';
  writeCapabilities?: WriteToolCapabilities;
  guardrails?: readonly Guardrail[];
}

export type McpTransportFactory = () => Transport | Promise<Transport>;

/** Keeps one stable client reference while its MCP transport is replaced. */
export class McpClientSession implements McpToolClient {
  private current: Client | undefined;

  constructor(
    readonly clientInfo: { name: string; version: string },
    private readonly createTransport: McpTransportFactory,
  ) {}

  get connected(): boolean {
    return this.current !== undefined;
  }

  get client(): Client {
    if (!this.current)
      throw new Error('MCP client is not connected; call connect() or reconnect()');
    return this.current;
  }

  async connect(): Promise<Client> {
    await this.close();
    const client = new Client(this.clientInfo);
    try {
      await client.connect(await this.createTransport());
      this.current = client;
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async reconnect(): Promise<Client> {
    return this.connect();
  }

  async close(): Promise<void> {
    const client = this.current;
    this.current = undefined;
    if (client) await client.close();
  }

  async callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ) {
    return this.client.callTool(input, options);
  }
}

export function createMcpClientSession(options: {
  clientInfo: { name: string; version: string };
  transport: McpTransportFactory;
}): McpClientSession {
  return new McpClientSession(options.clientInfo, options.transport);
}

/** Wrap one explicitly selected MCP tool in Harngine's durable Tool boundary. */
export function mcpTool(definition: McpToolDefinition): Tool {
  if (
    !definition.inputSchema ||
    typeof definition.inputSchema !== 'object' ||
    Array.isArray(definition.inputSchema)
  )
    throw new Error('MCP tool inputSchema must be a JSON Schema object');
  return tool({
    id: definition.id,
    description: definition.description,
    input: schema<Json>({
      id: `${definition.id}.input`,
      version: '1',
      jsonSchema: definition.inputSchema,
    }),
    output: schema<Json>({
      id: `${definition.id}.output`,
      version: '1',
      jsonSchema: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'array' },
          structuredContent: { type: 'object' },
        },
      },
    }),
    effect: definition.effect,
    ...(definition.effect === 'write' && definition.writeCapabilities
      ? { capabilities: definition.writeCapabilities }
      : {}),
    ...(definition.guardrails ? { guardrails: definition.guardrails } : {}),
    async execute(input, context) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return context.fail({
          effect: 'none',
          code: 'MCP_INPUT',
          message: 'Expected object arguments',
        });
      const result = await definition.client.callTool(
        {
          name: definition.name,
          arguments: input as Record<string, unknown>,
        },
        { signal: context.signal },
      );
      if (result.isError) {
        const message = 'MCP tool returned an error';
        if (definition.effect === 'write')
          return context.effectUnknown({ code: 'MCP_TOOL_ERROR', message });
        return context.fail({ effect: 'none', code: 'MCP_TOOL_ERROR', message });
      }
      return {
        content: result.content as Json,
        ...(result.structuredContent &&
        typeof result.structuredContent === 'object' &&
        !Array.isArray(result.structuredContent)
          ? { structuredContent: result.structuredContent as Json }
          : {}),
      };
    },
  });
}

import type { Json } from 'harngine';
import { mcpTool, type McpToolClient, type McpToolDefinition } from './bridge.js';

export interface McpCatalogClient {
  listTools(
    params?: { readonly cursor?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly tools: readonly McpToolListing[];
    readonly nextCursor?: string | undefined;
  }>;
  getServerVersion?(): { readonly name: string; readonly version: string } | undefined;
}

export interface McpToolListing {
  readonly name: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly inputSchema: unknown;
  readonly outputSchema?: unknown;
  readonly annotations?: unknown;
}

export interface McpCatalogTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Json;
  /** Retained for catalog inspection. The bridge still uses Harngine's fixed Tool result. */
  readonly outputSchema?: Json;
  /** MCP annotations are descriptive metadata and never establish Tool authority. */
  readonly annotations?: Json;
}

export interface McpToolCatalog {
  readonly object: 'mcp_tool_catalog';
  readonly server?: {
    readonly name: string;
    readonly version: string;
  };
  readonly tools: readonly McpCatalogTool[];
}

export interface McpCatalogSelection {
  /** Stable Harngine ID, included in application source and the definition manifest. */
  readonly id: string;
  /** Exact MCP server Tool name captured in the selected catalog snapshot. */
  readonly name: string;
  readonly client: McpToolClient;
  readonly effect: 'read' | 'write';
  readonly description?: string;
  readonly writeCapabilities?: McpToolDefinition['writeCapabilities'];
}

export interface McpDiscoveryOptions {
  readonly signal?: AbortSignal;
  /** Hard bound for one snapshot. Defaults to 256. */
  readonly maxTools?: number;
  /** Hard bound for non-aggregating discovery clients. Defaults to 64. */
  readonly maxPages?: number;
}

const DEFAULT_MAX_TOOLS = 256;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;

function durableJson(value: unknown, label: string): Json {
  const active = new Set<object>();
  function walk(input: unknown, depth: number): Json {
    if (depth > 64) throw new Error(`${label} exceeds the nesting limit`);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || !input)
      throw new Error(`${label} must contain JSON values only`);
    if (active.has(input)) throw new Error(`${label} must be acyclic`);
    if (!Array.isArray(input)) {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${label} must use plain JSON objects`);
      if (Object.getOwnPropertySymbols(input).length)
        throw new Error(`${label} cannot contain symbol keys`);
    }
    active.add(input);
    let result: Json;
    if (Array.isArray(input)) {
      if (Object.keys(input).length !== input.length)
        throw new Error(`${label} cannot contain sparse or decorated arrays`);
      result = input.map((item) => walk(item, depth + 1));
    } else {
      const output: Record<string, Json> = Object.create(null);
      for (const key of Object.keys(input).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) throw new Error(`${label} cannot contain accessors`);
        output[key] = walk(descriptor.value, depth + 1);
      }
      result = output;
    }
    active.delete(input);
    return result;
  }
  const result = walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
    throw new Error(`${label} exceeds the 1 MiB catalog limit`);
  return deepFreeze(result);
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function requiredObject(value: unknown, label: string): Record<string, Json> {
  const result = durableJson(value, label);
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error(`${label} must be a JSON Schema object`);
  return result as Record<string, Json>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function normalizeTool(value: unknown): McpCatalogTool {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP discovery returned an invalid Tool descriptor');
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name || record.name.length > 256)
    throw new Error('MCP Tool names must have 1–256 characters');
  const title = optionalText(record.title, 'MCP Tool title');
  const description = optionalText(record.description, 'MCP Tool description');
  const inputSchema = requiredObject(record.inputSchema, 'MCP Tool inputSchema');
  const outputSchema =
    record.outputSchema === undefined
      ? undefined
      : requiredObject(record.outputSchema, 'MCP Tool outputSchema');
  const annotations =
    record.annotations === undefined
      ? undefined
      : requiredObject(record.annotations, 'MCP Tool annotations');
  return deepFreeze({
    name: record.name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    inputSchema,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(annotations === undefined ? {} : { annotations }),
  });
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive`);
  return result;
}

function compareTools(left: McpCatalogTool, right: McpCatalogTool): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function assertCatalogSize(tools: readonly McpCatalogTool[]): void {
  if (tools.length > DEFAULT_MAX_TOOLS)
    throw new Error(`MCP Tool catalog exceeded its ${DEFAULT_MAX_TOOLS} Tool limit`);
  if (Buffer.byteLength(JSON.stringify(tools)) > MAX_CATALOG_BYTES)
    throw new Error('MCP Tool catalog exceeds the 4 MiB catalog limit');
}

/**
 * Capture MCP Tool contracts without registering or exposing them.
 *
 * Persist the returned value in application source, then select the wanted Tools explicitly with
 * `mcpToolFromCatalog()`. A changed snapshot participates in the generated definition revision.
 */
export async function discoverMcpTools(
  client: McpCatalogClient,
  options: McpDiscoveryOptions = {},
): Promise<McpToolCatalog> {
  const maxTools = Math.min(
    positiveLimit(options.maxTools, DEFAULT_MAX_TOOLS, 'MCP discovery maxTools'),
    DEFAULT_MAX_TOOLS,
  );
  const maxPages = positiveLimit(options.maxPages, 64, 'MCP discovery maxPages');
  const tools: McpCatalogTool[] = [];
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await client.listTools(
      cursor ? { cursor } : undefined,
      options.signal ? { signal: options.signal } : {},
    );
    if (!page || !Array.isArray(page.tools))
      throw new Error('MCP discovery returned an invalid Tool page');
    for (const listing of page.tools) {
      const tool = normalizeTool(listing);
      if (names.has(tool.name))
        throw new Error(`MCP discovery returned duplicate Tool ${tool.name}`);
      names.add(tool.name);
      tools.push(tool);
      if (tools.length > maxTools)
        throw new Error(`MCP discovery exceeded its ${maxTools} Tool limit`);
    }
    if (!page.nextCursor) break;
    if (page.nextCursor === cursor) throw new Error('MCP discovery cursor did not advance');
    cursor = page.nextCursor;
    if (pageNumber === maxPages - 1)
      throw new Error(`MCP discovery exceeded its ${maxPages} page limit`);
  }
  const server = client.getServerVersion?.();
  assertCatalogSize(tools);
  return deepFreeze({
    object: 'mcp_tool_catalog' as const,
    ...(server
      ? {
          server: {
            name: server.name,
            version: server.version,
          },
        }
      : {}),
    tools: tools.sort(compareTools),
  });
}

/** Validate and freeze a catalog snapshot persisted as application-owned source or JSON data. */
export function mcpToolCatalog(value: unknown): McpToolCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP Tool catalog must be an object');
  const record = value as Record<string, unknown>;
  if (record.object !== 'mcp_tool_catalog')
    throw new Error('MCP Tool catalog must have object "mcp_tool_catalog"');
  if (!Array.isArray(record.tools)) throw new Error('MCP Tool catalog must contain a tools array');
  if (record.tools.length > DEFAULT_MAX_TOOLS)
    throw new Error(`MCP Tool catalog exceeded its ${DEFAULT_MAX_TOOLS} Tool limit`);
  const names = new Set<string>();
  const tools = record.tools.map((tool) => {
    const normalized = normalizeTool(tool);
    if (names.has(normalized.name))
      throw new Error(`MCP Tool catalog contains duplicate Tool ${normalized.name}`);
    names.add(normalized.name);
    return normalized;
  });
  let server: McpToolCatalog['server'];
  if (record.server !== undefined) {
    if (!record.server || typeof record.server !== 'object' || Array.isArray(record.server))
      throw new Error('MCP Tool catalog server must be an object');
    const candidate = record.server as Record<string, unknown>;
    if (
      typeof candidate.name !== 'string' ||
      !candidate.name ||
      typeof candidate.version !== 'string' ||
      !candidate.version
    )
      throw new Error('MCP Tool catalog server needs a name and version');
    server = { name: candidate.name, version: candidate.version };
  }
  assertCatalogSize(tools);
  return deepFreeze({
    object: 'mcp_tool_catalog' as const,
    ...(server ? { server } : {}),
    tools: tools.sort(compareTools),
  });
}

/**
 * Select one exact Tool from a persisted discovery snapshot.
 *
 * The application still supplies the stable Harngine ID, effect and write capabilities. MCP
 * annotations cannot infer any of those authority-bearing values.
 */
export function mcpToolFromCatalog(catalog: McpToolCatalog, selection: McpCatalogSelection) {
  const discovered = catalog.tools.find((tool) => tool.name === selection.name);
  if (!discovered)
    throw new Error(`MCP Tool ${selection.name} is absent from the selected catalog snapshot`);
  return mcpTool({
    id: selection.id,
    name: discovered.name,
    description:
      selection.description ?? discovered.description ?? discovered.title ?? discovered.name,
    inputSchema: discovered.inputSchema,
    effect: selection.effect,
    client: selection.client,
    ...(selection.writeCapabilities ? { writeCapabilities: selection.writeCapabilities } : {}),
  });
}

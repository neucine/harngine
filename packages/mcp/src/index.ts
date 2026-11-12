export {
  Client,
  McpClientSession,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  createMcpClientSession,
  mcpTool,
  type McpToolClient,
  type McpToolDefinition,
  type McpTransportFactory,
} from './bridge.js';

export {
  discoverMcpTools,
  mcpToolCatalog,
  mcpToolFromCatalog,
  type McpCatalogClient,
  type McpCatalogSelection,
  type McpCatalogTool,
  type McpDiscoveryOptions,
  type McpToolCatalog,
  type McpToolListing,
} from './catalog.js';

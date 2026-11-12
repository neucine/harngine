# MCP Tool bridge and catalog

`@harngine/mcp` connects explicitly selected MCP Tools to Harngine's durable Tool boundary. It also
captures their contracts into application-owned catalog snapshots so schemas do not need to be
hand-copied. It exports the MCP TypeScript client and stdio and Streamable HTTP transports.

```ts
import {
  createMcpClientSession,
  mcpToolFromCatalog,
  mcpToolCatalog,
  StdioClientTransport,
} from '@harngine/mcp';

const client = createMcpClientSession({
  clientInfo: { name: 'my-app', version: '1.0.0' },
  transport: () => new StdioClientTransport({ command: 'my-mcp-server' }),
});
await client.connect();

// Persist this snapshot after reviewing the remote contracts.
// Its selected fields participate in the generated Harngine Tool revision.
const catalog = mcpToolCatalog({
  object: 'mcp_tool_catalog',
  server: { name: 'example-docs', version: '1.4.0' },
  tools: [
    {
      name: 'lookup',
      description: 'Look up an item',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  ],
});

const lookup = mcpToolFromCatalog(catalog, {
  id: 'my-app.lookup',
  name: 'lookup',
  effect: 'read',
  client,
});
```

Pass `lookup` to an Agent's `tools` list. The session keeps one stable client reference for the Tool bridge while replacing its transport. Call `reconnect()` before resuming work after a transport failure or restart, and `close()` when the application shuts down. A reconnect closes the previous transport first.

## Refresh a catalog

Call `discoverMcpTools()` while connected when it is time to review a new remote contract:

```ts
import { discoverMcpTools } from '@harngine/mcp';

const snapshot = await discoverMcpTools(client, {
  maxTools: 128,
  signal: AbortSignal.timeout(10_000),
});
console.log(JSON.stringify(snapshot, null, 2));
```

Discovery walks pages, rejects duplicate names and malformed schemas, bounds the snapshot, sorts
Tools by MCP name, and freezes the result. It accepts at most 256 Tools and 4 MiB of normalized
contracts. Save the reviewed snapshot in a source or JSON module, then load it with
`mcpToolCatalog()` before selecting Tools in application source.

This is an authoring-time operation. Harngine does not register Tools returned by a live server,
allow a model to add one to its own exposure, or refresh definitions while Work is running. A
snapshot change creates a new Harngine definition revision on the next manifest build. Existing
Work stays on its original revision.

The revision pins the reviewed local contract and bridge configuration. It cannot pin a remote
server's implementation when the server changes behavior without changing its advertised schema.

Application source still supplies the stable Harngine ID and read/write effect. MCP annotations are
retained for inspection only; they are not authorization or effect guarantees. Write capabilities,
approval and access policy remain application decisions. An MCP `isError` result on a write is
recorded as an uncertain effect.

If no catalog is useful, `mcpTool()` remains the smaller bridge for a Tool definition whose schema
is already declared in source.

The bridge returns MCP `content` and optional `structuredContent` as a Tool result. Harngine's durable JSON size and schema limits apply.

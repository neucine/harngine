# Harngine Workbench

Workbench is Harngine's browser application for discovering definitions, running Sessions and
Work, responding to Interactions, inspecting execution and reviewing payload-safe audit evidence.
It uses only the public `harngine` API. Work views show transient model previews when the selected
adapter emits them; previews are clearly separated from the durable final result.

The browser UI lives in `src/ui/App.weiv`, with page views in `src/ui/views` and shared controls
in `src/ui/components`. Run `bun run --cwd packages/workbench build:ui` to refresh the checked in
`public` assets. The server serves those assets and loads `src/ui/index.html` as its page template.

```ts
import { serveWorkbench } from '@harngine/workbench';

const server = await serveWorkbench({ app });
console.log(server.url);
```

For local development, export an App factory and launch it with Bun:

```bash
bunx harngine-workbench ./src/harngine.ts
```

To open the development Workbench from another device on a trusted network, bind the machine's
LAN address. The launcher prints an authenticated URL whose fragment carries the temporary browser
capability:

```bash
bunx harngine-workbench ./src/harngine.ts --host 192.168.1.20
```

Host-provided Workbench identities may grant `definitions:read`, `work:read`, `work:control`,
`audit:read` and `diagnostics:read` independently.

# Harngine Workbench

Workbench is Harngine's browser application for discovering definitions, running Sessions and
Work, responding to Interactions, and inspecting execution. It uses only the public `harngine`
API.

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

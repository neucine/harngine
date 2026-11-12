# @harngine/http

Optional Node.js HTTP adapter for a Harngine App. The host supplies authentication and owns the listener lifecycle.

```ts
import { createHarngineHttpServer } from '@harngine/http';

const server = createHarngineHttpServer({
  app,
  authenticate: (request) => request.headers.authorization === `Bearer ${token}` ? 'local-user' : null,
  auditSink: {
    async write(batch) {
      await sendAuditEvidence(batch);
    },
  },
});
server.listen(0, '127.0.0.1');
```

Routes: `GET /health`, `GET /definitions`, `GET /audit`, `POST /audit/export`, `GET /works`, `GET|POST /sessions`, `GET /sessions/:id`, `GET|POST /sessions/:id/messages`, `GET /works/:id`, `GET /works/:id/inspect`, `GET /works/:id/events` (SSE), and `POST /works/:id/{cancel,steer,respond,resolve-effect}`. Each request is authenticated before accessing the App. Work, Session and audit methods run under the returned principal. The adapter never starts a public listener by itself.

`GET /audit` accepts Audit query fields including `category`, `workId`, `sessionId`, `since`,
`until`, `after` and `limit`. `POST /audit/export` requires a host-configured `auditSink`; pass
`format=json` or `format=otel`. Export returns 501 when no sink is configured.

`GET /works/:id/events` is durable by default. Add `modelDeltas=1` to receive transient
`event: model.delta` records from an actively consumed watcher. Those records have no SSE ID and
are not replayed after reconnect.

For a webview with a local file origin, pass `origin: 'null'` and require a separate unguessable request token in `authenticate`. Restrict the server to loopback. A production host should decide which principals may start definitions and call tools through Harngine's access policy.

When a write has an uncertain effect, inspect the Work for the unresolved Call ID, then submit `POST /works/:id/resolve-effect` with `{ "callId": "call_...", "resolution": { "status": "success", "value": "actual Tool result" }, "idempotencyKey": "operator-action-id" }`. A reviewer can also record `not-applied` with a `{code,message}` reason, or `failure` with `effect: "partial" | "occurred"` and a reason. Harngine records the decision and resumes or closes Work according to its execution policy.

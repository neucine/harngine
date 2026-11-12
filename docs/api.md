# HTTP API guide

`@harngine/http` exposes the durable Harngine App API through the Node.js HTTP server returned by
`createHarngineHttpServer()`. The adapter creates no listener, route prefix, account system or
authentication policy by itself.

The authoritative machine-readable contract is
[`packages/http/openapi.yaml`](../packages/http/openapi.yaml). It is an OpenAPI 3.1 document and is
included in the package as `@harngine/http/openapi.yaml`.

## Create the server

```ts
import { createHarngineHttpServer } from '@harngine/http';

const server = createHarngineHttpServer({
  app,
  authenticate(request) {
    return request.headers.authorization === `Bearer ${token}` ? 'local-user' : null;
  },
});

server.listen(3000, '127.0.0.1');
```

The callback returns the principal used for the request or `null` to reject it with `401`. The
adapter authenticates before host routes and before accessing Work, Session or audit state.

Relevant options:

| Option | Purpose |
| --- | --- |
| `authenticate` | Required principal resolver. |
| `origin` | Exact allowed browser origin or origins. |
| `maxBodyBytes` | JSON request-body limit; defaults to 1 MiB. |
| `auditSink` | Host destination required by `POST /audit/export`. |
| `route` | Host-owned routes, invoked after authentication and before built-ins. |

The server listens only where the host asks it to listen. Bind to loopback for a local desktop or
webview integration. A production deployment must add TLS, rate limits, network controls and any
application authorization required beyond Harngine's principal and policy checks.

## Import the OpenAPI document

The package exposes the YAML as a subpath:

```ts
import { readFileSync } from 'node:fs';

const openapi = readFileSync(
  new URL(import.meta.resolve('@harngine/http/openapi.yaml')),
  'utf8',
);
```

You can also load the package file directly in Swagger UI, Redocly, Postman, Insomnia or a client
generator.

The specification documents the built-in JSON and SSE routes. Custom handlers added through
`route` are application-owned and must be documented separately.

## Request conventions

- All built-in routes except CORS `OPTIONS` require authentication.
- JSON bodies must contain one object. Schema validation errors return `400`.
- Harngine IDs are stable strings: Work IDs start with `work_`, Session IDs with `session_`, and
  definition revisions with `rev_`.
- Objectives, messages and Tool values are JSON. The runtime validates them against the selected
  definition.
- Transient model previews do not alter the durable API result.
- Host-specific authorization still applies after authentication.

## Typical Session flow

### 1. List an Agent

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/definitions
```

This route returns available Agent definitions, including the exact `id` and `revision` needed to
create a Session.

### 2. Create a Session

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":{"object":"agent","kind":"agent","id":"example.assistant","revision":"rev_example"}}' \
  http://127.0.0.1:3000/sessions
```

The response is the Session snapshot. A definition reference is accepted only when its exact Agent
revision is available.

### 3. Send a message

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Inspect the repository and summarize it."}' \
  http://127.0.0.1:3000/sessions/$SESSION_ID/messages
```

The API returns `202` with the recorded message and the associated Work snapshot. The Session may
start the Work immediately or queue it behind foreground Work.

### 4. Poll or stream Work

Poll the current snapshot:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/works/$WORK_ID
```

Or open the SSE stream:

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/works/$WORK_ID/events?modelDeltas=1"
```

The first `data:` frame is the current `WorkSnapshot`. Durable updates may include:

```text
id: cursor-value
data: {"object":"work_update","type":"work.updated",...}
```

Pass the last durable SSE `id` as `after` to resume. Transient previews use:

```text
event: model.delta
data: {"object":"model_delta","type":"model.delta",...}
```

Transient previews have no replayable SSE ID. They are delivered only while an active watcher is
connected and cannot be used as durable evidence.

## Human interaction

Inspect the Work snapshot for pending questions or approvals. Respond by exact interaction ID:

```json
{
  "interactionId": "interaction_id",
  "response": true
}
```

Send that body to `POST /works/{workId}/respond`. A question can carry any JSON response; an
approval normally uses `true` or `false`. The runtime validates the interaction state before
accepting the response.

## Steering and cancellation

Steer active Work with:

```json
{
  "input": "Focus on the public API and avoid the examples."
}
```

Send that body to `POST /works/{workId}/steer`.

Cancel with an empty `POST /works/{workId}/cancel`. Cancellation is recorded durably. Aborting a
provider or Tool process is best effort and does not prove that an external write did not happen.

## Recover an uncertain effect

When a write has an unknown outcome, inspect the Work with `detail=diagnostic`, locate the
unresolved Call and submit its exact `callId`.

Successful effect:

```json
{
  "callId": "call_...",
  "resolution": {
    "status": "success",
    "value": "validated Tool result"
  },
  "idempotencyKey": "operator-action-1"
}
```

Not applied:

```json
{
  "callId": "call_...",
  "resolution": {
    "status": "not-applied",
    "reason": { "code": "NOT_SENT", "message": "The remote service has no matching action." }
  }
}
```

Failed after an external effect:

```json
{
  "callId": "call_...",
  "resolution": {
    "status": "failure",
    "effect": "occurred",
    "reason": { "code": "REMOTE_REJECTED", "message": "The remote service rejected a later step." }
  }
}
```

Use `effect: "partial"` when part of the intended external effect occurred. Send the body to
`POST /works/{workId}/resolve-effect`.

## Inspection and audit

Read a compact story:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/works/$WORK_ID/inspect
```

Read payload-rich diagnostics:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/works/$WORK_ID/inspect?detail=diagnostic"
```

Audit is principal-scoped and payload-safe. Supported categories are `work`, `decision`,
`authorization`, `guardrail`, `attempt`, `interaction` and `session`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/audit?category=authorization,guardrail&limit=100"
```

The repeatable `category` parameter also accepts comma-separated categories. Audit filters include
`workId`, `sessionId`, `since`, `until`, `after` and `limit`.

Export requires an `auditSink` in the host configuration:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/audit/export?format=otel&limit=100"
```

Without a sink the route returns `501`. Sink failure can fail export, but cannot change Work state
or make audit the execution source of truth.

## Endpoint summary

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Authenticated adapter health. |
| `GET` | `/definitions` | Available Agent definitions. |
| `GET` | `/sessions` | List Sessions. |
| `POST` | `/sessions` | Create a Session. |
| `GET` | `/sessions/{id}` | Session snapshot. |
| `GET` | `/sessions/{id}/messages` | Recent messages. |
| `POST` | `/sessions/{id}/messages` | Send a message and start or queue Work. |
| `GET` | `/works` | List Work. |
| `GET` | `/works/{id}` | Work snapshot. |
| `GET` | `/works/{id}/inspect` | Story or diagnostic inspection. |
| `GET` | `/works/{id}/events` | Durable SSE updates and optional previews. |
| `POST` | `/works/{id}/cancel` | Cancel Work. |
| `POST` | `/works/{id}/steer` | Add steering input. |
| `POST` | `/works/{id}/respond` | Answer a question or approval. |
| `POST` | `/works/{id}/resolve-effect` | Record an uncertain external outcome. |
| `GET` | `/audit` | Principal-scoped audit page. |
| `POST` | `/audit/export` | Export through the host sink. |

## Errors and status codes

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON, invalid structure, schema validation or an invalid transition request. |
| `401` | The host authentication callback returned no principal. |
| `404` | The route, Work or Session is not visible to the principal. |
| `409` | Durable state conflicts with the requested operation. |
| `500` | Unexpected server or host integration failure. |
| `501` | Audit export was requested without an `auditSink`. |

Error bodies have the form `{"error":"..."}`. Do not use error text as a stable machine code.

## Browser and webview use

Configure `origin` to allow an exact browser origin. A local file webview commonly has the origin
`null`; in that case still require a separate unguessable request token in `authenticate`.

CORS preflight returns `204` only for an allowed origin and `403` otherwise. CORS is not
authentication, and an allowed origin does not grant access to another principal's Work.

## Current scope

The built-in API starts and controls Work, manages Sessions, reads inspection and audit evidence,
and streams updates. It does not provide:

- user or account management
- file upload or artifact-byte serving
- a hosted public listener
- built-in rate limiting
- application-specific authorization
- host-defined route documentation

Keep those responsibilities in the application or a purpose-built gateway.

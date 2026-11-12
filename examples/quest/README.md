# Quest

Quest is a persistent social cultural world built on Harngine and rendered with Weiv. Its first
world, **The Museum of Nearby Things**, places four real public-domain Met objects in a shared
constellation. There is no mystery to solve, score to optimize, or terminal success state. Visitors
wander, form interpretations, draw trails between objects, and return to a world changed by other
people.

```bash
bun run demo:quest
```

The default `replay` mode is deterministic and offline. `--mode live` reads the same bounded object
set from The Met without changing the recording. `--mode safe-write` is the only mode that refreshes
the local replay cache; it validates object identity and public-domain status and writes atomically.

## Experience model

### Playable loop

- **One-sentence promise:** Together, discover what connects these objects.
- **Primary verb:** Pull a thread—make or challenge a connection between two sourced artifacts.
- **First 30 seconds:** Name yourself, choose Power, Measure, or Memory as a lens, and inspect the
  astrolabe. Each choice immediately advances the expedition in place.
- **Three-to-five-minute loop:** choose a lens → inspect an artifact → choose a second artifact →
  make or challenge the connection in one sentence → reveal a source-backed Echo.
- **Cooperative role:** the connection becomes shared memory. Another visitor can encounter it,
  follow it with a new interpretation, or challenge it from another lens.
- **Visible consequence:** a two-object Harngine Workflow runs and the resulting Echo blooms in the
  constellation; the visitor trail remains visible beside both objects.
- **Session arc:** the bounded first expedition ends when the Echo is revealed. It is a local arc,
  not a global solved state.
- **Reason to return:** private perspective Sessions remember each route and surface human echoes
  left nearby after the visitor was away.
- **Free exploration:** after the first Echo, guidance yields to the full constellation; every object,
  interpretation, and trail remains available without a checklist or ending.

The world has three overlapping layers:

- **Collection reality:** titles, dates, makers, media, images, and links remain grounded in recorded
  Met responses with visible provenance.
- **Private perspective:** each visitor owns a durable Harngine Session called the Keeper of
  Nearness. It remembers their route, offers an open question, and carries that perspective across
  restarts without exposing it to another visitor.
- **Shared cultural memory:** interpretations, visitor-made trails, and world reactions persist in
  SQLite and are visible to everyone. Human interpretations are never presented as museum facts.

Two moments are the product’s signature magic:

1. **Return echo.** A returning visitor reopens the same private Session. If another person left an
   interpretation beside the current object while they were away, the Keeper surfaces it as a human
   echo—not an answer or authoritative fact.
2. **Constellation bloom.** Leaving a thought or drawing a trail starts a durable world Workflow. It
   fans out into two child Work records, reads both actual source objects, and persists the resulting
   correspondence in the shared world. The visitor’s small gesture visibly changes what later people
   encounter.

The optional “How this world lives” view explains those mechanics in product language and shows
recent durable reactions. It does not turn the main experience into an execution dashboard.

## Architecture

```text
Weiv browser client
      │ visitor bearer token
      ▼
Quest world store ─── paths, interpretations, trails, reactions
      │
      ├── one Harngine principal + private Session per visitor
      │       └── perspective Agent → bounded Met Tool
      │
      └── shared world principal
              └── reaction Workflow → flow.all → two object child Work records
```

Harngine owns durable execution, Sessions, child Work, context, calls, inspection, and principal
boundaries. Quest owns visitor identity, presence, social memory, editorial trails, and the decision
that this world has no completion state. The deterministic perspective adapter may phrase grounded
records and human echoes; it cannot invent collection facts or create winning state.

The client is a compiler-first `.weiv` component with no frontend runtime dependency. The build
emits static JavaScript and CSS into `public/`; the server provides a small HTML shell and same-origin
JSON API.

## Provider and provenance

The bounded constellation is Met objects 444408, 337061, 198556, and 544887. Each sourced object
preserves provider/version, object ID, fetch time, execution mode, licence and rights, collection and
API links, and a SHA-256 hash of its canonical sanitized response. Replay rejects tampering. Live and
safe-write modes reject IDs outside the constellation and responses that are not public domain.

Future worlds should favor institutional APIs with stable identifiers and explicit rights. Enrichment
sources may add bounded context keyed to those identifiers, but may never silently overwrite a source
record.

## Safety and operating boundaries

- Replay is the public default, so normal use has no provider or inference spend.
- The server binds to loopback, checks host/origin, requires a per-process page token and hashed
  visitor bearer token, caps request size, and rate-limits clients.
- CSP permits application scripts and connections only from self and object images only from The Met.
- Inputs are length-bounded plain text; the deterministic adapter does not execute user-supplied URLs
  or arbitrary HTML.
- Harngine budgets cap model turns, Tool calls, and operations. Story inspection is read-only and
  scoped to the shared world principal.

For internet deployment, add TLS and trusted authentication, a managed database, shared rate limits,
presence expiry, moderation/reporting, and an approved image proxy. Loopback origin checks are not a
public authentication system.

## Acceptance criteria

- A visitor can enter, wander among all four sourced objects, leave an interpretation, and draw a
  named trail without encountering a task list, score, solved flag, or end screen.
- Another visitor sees the shared contribution; a returning visitor can receive a later human echo
  through their original private Session.
- A contribution creates two concurrent child Work records and a persisted, source-backed shared
  reaction.
- Restarting with the same directory preserves visitor authentication, Session identity, paths,
  interpretations, trails, reactions, and Harngine Work.
- One principal cannot inspect another visitor’s private Session.
- Replay performs no network access and rejects modified recordings; live modes remain allowlisted
  and public-domain-only.
- Every object links to its original record and clearly separates collection facts from visitor
  interpretation.
- The Weiv UI works at 360 px and desktop widths with native keyboard controls and readable focus
  order.
- UI compile, TypeScript build, tests, and an HTTP/browser journey pass.

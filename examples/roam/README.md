# Roam

Roam is a living atlas for discovering how a shared journey might feel. A group places moods,
fascinations, rhythms and constraints into a spatial possibility field. Persistent scouts with
different lenses grow several journey worlds, notice surprising connections, and adapt those
worlds as people react or real conditions change.

It is deliberately not a booking funnel. The atlas remains useful if nobody purchases anything:
people can return to remembered signals, compare how different worlds feel, simulate a day turning,
and understand why an idea changed. Live geography and weather ground feasibility and seasonality;
they do not dictate a transaction.

## Run it

```bash
bun run demo:roam
```

The command prints a loopback URL and stores the room in `.harngine/roam`. Add a signal, react to a
world, refresh conditions, or open a fresh atlas. Restarting the process resumes the same shared
memory.

The interface is a Weiv single-file component at `src/ui/App.weiv`. After changing it, rebuild the
checked-in direct-DOM assets from the repository root:

```bash
sh examples/roam/scripts/build-ui.sh
```

## Product promise

Roam helps a group explore possibility before it asks for certainty:

- a zoomable-feeling atmosphere field makes journey worlds spatial and sensory;
- signals preserve nuance instead of reducing taste to scored form fields;
- living route ribbons show rhythm without pretending the week is fixed;
- alternate-day simulations make weather, energy and divergence playful;
- reactions reshape the worlds rather than advancing a conversion funnel;
- scouts keep distinct perspectives on atmosphere, access, rhythm and surprise;
- each durable pulse remembers the group and records the external evidence it observed.

### The playable loop

- **One-sentence promise:** Make one day everyone wants to live.
- **Primary verb:** Drop a desire onto the world.
- **First 30 seconds:** Type a concrete desire—or tap the live “quiet breakfast” example—and
  immediately see three place- and weather-grounded route fragments grow around it.
- **Three-to-five-minute loop:** Drop a desire → inspect the fragments → pull one world closer or
  push it away → weave it with another participant’s desire → walk through the resulting day →
  save the trail.
- **Collaborative tension:** Every journey world exposes signed group gravity. Pulling and pushing
  are equally legible; disagreement changes resonance instead of blocking progress.
- **Immediate consequence:** The submitted desire appears in the shared field, the scouts run a
  durable pulse, world resonance changes, and the new phrase echoes in visible route fragments.
- **Lightweight session arc:** A session begins with one desire and ends with a named saved trail;
  no account, provider credential, checkout or complete trip brief is required.
- **Reason to return:** Saved trails preserve the desire and journey world while scouts can refresh
  real weather and place context around them.
- **Guided live example:** Quiet breakfast, ocean swim, late-night music and hidden architecture
  are one-tap inputs backed by the same real workflow as typed desires—not a mock tour.

### Cold-start usability audit

The first version led with “living atlas,” an atmosphere map and framework concepts before giving
the visitor a concrete action. A cold visitor could admire it without knowing how to play. The
revised first viewport now states the goal, labels step one, provides a single input, offers four
examples, and previews the exact visible consequence before asking the visitor to understand the
map. Navigation labels changed from abstract nouns (“Atlas,” “Signals,” “Memory”) to the more
actionable “Play,” “Desires,” and “Saved trails.” Technical provenance remains available but is no
longer prerequisite knowledge.

The current Tokyo–Hakone vignette is intentionally bounded. It demonstrates the interaction and
durability model, not universal destination coverage.

## Interaction and visual design

The center of gravity is the atmosphere map, not an itinerary table. Coral, blue and green journey
worlds hover over a soft topographic field. Signals appear as tactile fragments. Selecting a world
changes the living ribbon below; selecting a day opens a counterfactual simulation. The scouts and
runtime memory stay one step away in the rail.

There is no approval progress bar, price comparison, reservation card or hold action. A new atlas
can be started end to end, but continued exploration is the default state.

## Harngine architecture

```text
shared living atlas
      │ add signal / react / refresh / return
      ▼
Roam room memory ─── group taste, active world, pulse history
      │
      ▼
durable grow-living-atlas Workflow
  └── parallel persistent scouts
        ├── place scout   ── OpenStreetMap observation
        └── weather scout ── Open-Meteo observation
      │
      ├── atmosphere perspective
      ├── rhythm & access perspective
      └── surprising-connections perspective
      │
      ▼
three evolving journey worlds + alternate-day possibilities
```

Each group signal or reaction creates a new durable atlas pulse. The previous Work ID remains in
room memory, current scouts receive the accumulated brief, and provider caches keep observation
bounded. Harngine provides Work identity, atomic child admission, replay, cancellation and
inspection. Roam owns sensory travel semantics, group memory and product language.

The current scouts complete each observation pulse rather than holding a process open forever.
“Long-running” means continuity across pulses and visits, not an immortal in-memory worker. A
production scheduler could trigger the same refresh boundary when weather or local conditions
materially change.

## Grounding, privacy and cost

- OpenStreetMap receives only place queries.
- Open-Meteo receives only coordinates and dates.
- Names, reactions and signals remain local to the room.
- Every observation exposes provider, freshness, time, link and explanatory note.
- Unavailable data remains unavailable; the atlas does not invent provider facts.
- Public reads are cached and bounded. The local server binds to loopback and uses a page token.
- No supplier, inventory, payment, email, analytics or booking system is contacted.

## Acceptance criteria

- Three sensorially distinct worlds cover the same seven-day window.
- The atmosphere field, route ribbon and alternate-day simulation are directly interactive.
- Adding a signal changes scout notes and echoes through the journey worlds.
- Reactions, the active world and group taste survive process restart.
- Geography and weather run as atomically admitted parallel child Work.
- Earlier pulse IDs remain retained and the current pulse is inspectable.
- Booking, approval, pricing and reservation language do not occupy the primary experience.
- The responsive Weiv interface and focused TypeScript tests pass.

## Weiv integration

Weiv remained the first-choice frontend and compiled the complete interaction model successfully.
Reproducible framework friction found during the original integration is recorded in the Weiv
repository’s `WEIV_FRICTION.md`; the living-atlas work introduced no additional framework-specific
failure.

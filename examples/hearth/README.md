# Hearth

Hearth is Harngine’s flagship reference application: an ambient shared home-world that develops
memory, rhythms, rituals, care and collective awareness over time.

It is not a household task manager. Moving home is one chapter in Harbour House’s story—the first
night among boxes, the hallway echo, the corner that became someone’s own—not the definition of the
product.

## Run

```bash
bun run demo:hearth
```

The demo uses live OpenStreetMap, Open-Meteo and data.govt.nz reads. Household memory remains in
`.harngine/hearth-home/home-memory.json` with mode `0600`. Reusing the directory restores the home’s
perspectives and durable Harngine Work.

## Product promise

**Read the household weather; shape one small moment together.**

Hearth helps a household feel and understand its life together without grading, optimising or
turning it into a queue. It holds:

- remembered moments and the chapters they belong to;
- private and shared perspectives with a boundary chosen at contribution time;
- rhythms that remain tentative until life repeats them;
- rituals kept because they feel meaningful, never because they are due;
- the relation between local season, weather, place and life indoors;
- gentle openings that explain why they appeared and can be dismissed without penalty.

## Participatory loop

- **Primary action:** Place your pulse—energy plus a need, hope or atmosphere—with a private or
  shared boundary chosen before saving.
- **First 30 seconds:** Read the household weather, choose one of four plain-language pulse
  starters, choose its boundary, and see the hearth acknowledge where the signal went.
- **Three-to-five-minute loop:** Place a pulse → notice the shared pattern → warm a suggested small
  ritual or let it pass. There is no score, streak or completion state.
- **Multi-person contribution:** Each household member has a lens. Shared pulses shape the common
  weather; private pulses shape only their author’s view. The interface says how many voices are
  present without exposing private wording.
- **Immediate consequence:** The participant receives an explicit boundary-aware response while a
  new durable Harngine attunement recomposes the Hearthscape.
- **Session arc:** arrive, attune, contribute, notice, optionally shape a ritual, leave.
- **Reason to return:** another household voice arrives, outside weather changes, memories gather,
  or a tentative ritual begins to feel familiar.

The guided example uses intentionally generic language: Alex shares “need: quieter”, Sam shares
“hope: a little closeness”, and Hearth offers window tea. A private note may influence only its
author’s lens; it is never quoted, summarized or counted in another person’s view.

## Cold-start usability audit

The previous slice failed cold start: it showed a beautiful ambient state but left agency in a
sidebar phrase (“Leave a trace”), so a new participant could reasonably ask how to play. The
implemented repair makes the promise, 30-second primary action and three-step loop visible on the
living surface; pre-written pulse starters remove blank-page friction; the save button names the
effect of the selected consent boundary; and the guided two-person example demonstrates the whole
loop without requiring explanatory documentation.

### Signature interactions

**Living hearthscape.** A slow, ambient portrait combines outside weather, season and the energy
that participants chose to share. Different states can coexist; Hearth explicitly refuses to
“even out” two unlike days.

**Seasonal memory garden.** Memories become blooms with stable positions and tones. Shared blooms
inhabit the common garden. Private blooms appear only through their author’s lens. The moving-home
chapter is present as one bloom among later life.

**Household weather.** Personal check-ins become a humane description such as “different skies
under one roof”. It is reflection, not diagnosis, sentiment scoring or performance measurement.

**Ritual composer.** Hearth can offer a small ritual—window tea, lamp hour, a threshold pause—when
weather and visible household context make it timely. The opening states its evidence, can be
dismissed, and becomes shared memory only through an explicit action.

## Experience and visual direction

The primary surface is spatial rather than tabular: a dark living landscape, warm ember, changing
rings, weather texture and a seasonal garden. Editorial serif type and restrained motion make it
feel contemplative rather than operational. There are no checkboxes, progress bars, assignments,
deadlines or completion scores.

Navigation is intentionally small: living hearth, memory garden, rituals, and an optional “How
Hearth listens” view. “Leave a trace” asks only for energy, a feeling word, an optional sentence and
the consent boundary.

## Architecture

```text
Alex lens ─┐                         ┌─ shared memories
           ├─ consent-filtered view ─┤
Sam lens  ─┘                         └─ viewer-private memories
                        │
                        ▼
              durable Harngine attunement
               ├─ recorded observation time
               ├─ OpenStreetMap place
               ├─ Open-Meteo weather
               ├─ data.govt.nz local context
               └─ deterministic home-world composition
                        │
                        ▼
                 Weiv living interface
```

Each memory revision starts a separately identifiable Work for that participant. Stable
idempotency keys make reload and restart safe; Work history explains which public observations
shaped a view. Public-data calls receive address/coordinates only—never participant names, private
words or memory history.

The current vertical slice uses deterministic composition so privacy boundaries are auditable. A
future language-model agent must receive the same already-filtered `HomeView`, never the raw store,
and must preserve provenance on every proactive opening.

## Consent and participant control

- Each participant owns a principal scope (`household:alex`, `household:sam`).
- A contribution is marked `private` or `shared` before it is stored.
- Private check-ins and memories are removed before another participant’s Harngine objective is
  constructed; they are not merely hidden by the browser.
- A private trace may influence its author’s household-weather description, but another lens sees
  neither its text nor derived feeling.
- Gentle openings include “Why am I seeing this?”, “Not for me”, and an explicit keep action.
- Hearth does not infer relationship health, mental health, conflict severity or hidden motives.

## Quiet observation and restraint

The reference slice records surroundings only when a home view is first created for a memory
revision. Harngine replay prevents repeated reads after restart. It does not install a hidden web
server timer. A production follow-up should use a durable Harngine timer to wake at bounded moments
(season change, forecast transition, or an invited ritual window), enforce a daily observation
budget, and remain silent when nothing meaningful changed.

The public Nominatim service has a strict [usage policy](https://operations.osmfoundation.org/policies/nominatim/).
Production must add compliant caching and a suitable hosted or self-hosted provider. Recorded tests
replay sanitized real responses captured on 11 October 2026.

## Weiv-first frontend

The interface is authored in [`src/ui/App.weiv`](src/ui/App.weiv) and compiled with `weivjs@0.1.0`.
The installed compiler uses its compatibility directives (`if`, `for`, `bind:prop`, `on:event`)
and explicit input handlers for one-way bindings. The [Weiv repository](https://github.com/neucine/weiv)
documents the current compiler and frontend APIs.

## Milestones

1. **Living slice (implemented):** living hearthscape, two consent-aware lenses, household weather,
   seasonal memory garden, explainable ritual opening, re-entry, live surroundings and Weiv UI.
2. **Durable observation:** bounded scheduled wakes, material-change detection and a quietness
   budget with visible controls.
3. **Household authorship:** invitations, revocation, memory correction, export, deletion and
   participant-specific retention settings.
4. **Adaptive rituals:** observe whether kept rituals remain welcome; let them fade without framing
   that as failure.
5. **Long-lived agent:** model-assisted reflection over filtered views, with evaluation against
   leakage, overreach, diagnosis and repetitive proactivity.
6. **Public hardening:** accessibility and motion audit, threat model, hosted-geocoder decision,
   encrypted-at-rest memory and recovery drills.

## Acceptance criteria

- Moving appears as one memory chapter, not a plan or dashboard.
- The main interface contains no tasks, deadlines, dependencies, assignees or completion state.
- Alex’s private text and private memories never enter Sam’s `HomeView` or Work objective.
- A shared trace produces a new durable attunement Work and survives restart.
- Every proactive opening explains its inputs and supports dismissal.
- Weather and season shape ambience without turning into alerts.
- The Weiv compiler emits the application, and tests assert current directive usage.
- Recorded real public responses drive deterministic tests.

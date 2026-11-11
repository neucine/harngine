# Muse

Muse is Harngine’s living creative thought-space. Its promise is: **turn three unlikely fragments
into one idea worth keeping**. Sources, facts, tensions, inferences, motifs, and dormant directions
remain available as a constellation that can be revisited and changed.

```bash
bun run demo:muse
```

The space opens itself around a reference question about remote and hybrid work. Three durable
Harngine child Work items read OpenAlex, Crossref, and Wikimedia Commons in parallel. Replay mode
is deterministic and offline-safe; `bun run demo:muse:live` revalidates the fixed provider objects.

## Interaction contract

The primary verb is **Make a Spark**.

- **First 30 seconds:** choose one prepared live seed (or type a question), enter the material, and
  gather a first fragment. The interface responds after every selection with the next useful move.
- **Three-to-five-minute loop:** `seed → gather → collide → react → keep`. Gather two or three
  unlike fragments, choose a studio perspective, Make a Spark, then keep it for incubation or ask
  the material a follow-up question.
- **Direct manipulation:** clicking a node gathers or releases it; semantic gravity rearranges the
  same evidence toward sources, tensions, or poetry.
- **Immediate feedback:** the progress rail, contextual prompt, selected outline, collision state,
  Spark card, attached provenance count, and kept state all update in place.
- **Session arc:** a visitor leaves with one named Spark rather than a finished publication.
- **Reason to return:** kept Sparks remain visibly incubating; dormant directions and the complete
  gesture lineage are retained for re-entry.

The no-credential guided example uses OpenAlex, Crossref, and Wikimedia replay records about remote
and hybrid work. The prepared seed “What is an office for now?” can be taken from seed to a grounded
Contrarian Spark in four visible actions.

The interface is implemented in Weiv 0.1.0. `scripts/build-ui.sh` compiles `src/ui/App.weiv` into
browser JavaScript and CSS. The local server serves only those static assets and its same-origin API.

## Trust and optional crystallization

Material begins in normalized, content-hashed source envelopes. Factual readings retain hashes back
to those envelopes; inference, tension, and creative language remain different node kinds. A
conversation can reinterpret a node but cannot erase its provenance.

The underlying Harngine Work still supports an exact approval and reversible local Markdown
publication. That is an optional crystallization of the space, not its organizing journey. No
provider credential or model bill is required for the reference slice, and no external write occurs.

## Current persistence boundary

Harngine persists research and publication execution. The running Muse process retains constellation
gestures, conversations, dormant state, and lineage for the active space. Moving those creative
events into resumable Harngine Work/Session memory is the next persistence increment; the UI and
event model are already shaped around stable node IDs and append-only lineage events.

## Acceptance criteria

- The UI is a Weiv-compiled spatial constellation rather than a generated report.
- Research fan-out remains three independently inspectable child Work items.
- Semantic gravity visibly rearranges material without changing its meaning or provenance.
- A user can gather two or three nodes, create and keep a provenance-aware Spark, sleep or revive a
  node, and converse with three perspectives.
- Every gesture adds a lineage event; nothing is silently discarded.
- Every factual node retains at least one resolvable source content hash.
- Replay rejects modified fixture data through content-hash verification.
- Publication remains behind exact approval and is not presented as the main path.

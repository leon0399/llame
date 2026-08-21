## Context

See proposal.md — Why. Four shipped facts shape the approach:

- The rail's persisted envelope is one part type (`data-context`) carrying a `producer` and a validated `payload`. Adding a producer is additive by construction: an older reader that does not recognize the producer renders nothing rather than failing, so this is not a coordinated API/worker revision boundary.
- Items are authored where the turn is persisted — `chat-loop.service.ts` already attaches the model-change, tool-availability, and recency-digest items inside the transaction that writes the user message and its run.
- The anchor's instance timezone is resolved in that same place (`resolveInstanceTimezone`), and `formatTemporalAnchor(instant, timeZone)` is already pure and zone-parameterized.
- The shared-chat and fork projections run a text-only egress allowlist that strips every non-text part, so persisting a row adds no public surface.

## Goals / Non-Goals

**Goals:**

- A dated transcript at zero ongoing cache cost: every user turn stamped, every stamp immutable.
- Reuse the rail's persisted-item path end to end — no new part type, no bind-time machinery, no change to `buildContext` or to compaction.
- Leave the multi-reading seam so #454 adds a line rendered from the same stored instant.

**Non-Goals:**

- A reading that is current at request _assembly_. Under a queue delay the newest row is when the turn was accepted, not when the model was called. That gap is small, and closing it costs exactly what persisting avoids.
- Any UI surfacing of message times.
- Reconciling timezones across processes — the stored zone removes the question rather than answering it.

## Decisions

### D1 — Persist the row rather than compute it at bind time

A bind-time row is current at assembly but must vanish from a message once that message is history, so every request re-serializes the previous turn differently from how it was cached. A persisted row is fixed the moment the turn is written, so no message's bytes ever change and the whole history stays cache-stable. The price is that a row states receipt rather than the present instant.

That price is small and the benefit compounds: the surface's value is the _timeline_, and a timeline needs every turn dated, which only immutability makes affordable.

_Alternative rejected:_ bind-time on the newest turn only. It buys assembly-time accuracy — seconds, in the common case — and pays one previous user message of prefix-cache tail on every request, forever, while dating exactly one turn.

### D2 — The payload carries the instant and the timezone

The rail renders an item from its part alone; a renderer receives no message and no environment. Storing `{ instant, timeZone }` therefore makes rendering total and deterministic: no join against `messages.created_at`, no re-resolution of `TZ`, and no way for the process that renders a conversation to disagree with the process that accepted it.

It also makes the row honest across a reconfiguration: an instance that moves timezone does not rewrite what it already told the model.

The stored instant is the turn's acceptance time, captured once in the transaction. `messages.created_at` remains the transaction timestamp used for ordering and records; the payload's instant is what the row states. They agree to within the transaction and are not required to be the same value.

_Alternative rejected:_ render from `messages.created_at`. It would require plumbing the carrying message into the renderer, breaking the rail's part-in/text-out contract for one producer.

### D3 — Authored in the turn transaction, beside the existing producers

The item is created in `buildTurnContextAndParts`, where the other producers' items are already assembled into the turn's parts, using the instance timezone already resolved there for the anchor. One clock read, one zone resolution, both temporal surfaces of a turn agreeing by construction.

### D4 — Uniform wording, receipt semantics

Every row reads the same way whether it is the newest turn or the oldest. Wording that changed when a turn stopped being newest would mutate a persisted message's rendering and forfeit D1's entire benefit. The newest row is the model's freshest clock by position, not by phrasing.

### D5 — The payload is scalar; readings are a rendering concern

The payload stores one instant and one timezone. It does **not** store a list of readings: #454's reading is the same instant rendered against the owner's zone _at render time_, deliberately not stored, since a stored second reading would freeze a preference the owner can change and would need rewriting across history when they change it.

So the extension seam is in the renderer, not the payload — #454 adds a second line computed from the same stored instant. A list in the payload would be generality for a case that will never write to it.

### D6 — Form `snapshot`, producer `temporal`

`notice` is an account of something that happened and supersedes nothing; a timestamp is not an event report. `snapshot` is current state at the moment it was taken, which is what the row records. The producer is named for the domain, not the row, because the stored-timezone reading and any later temporal surface share the slot.

### D7 — Compaction is untouched

The rows are ordinary turn content and are superseded with their turns. The standing-context exclusion exists for values re-supplied on every request; a row is not one, so no clause is added and no additional reliance on model compliance is introduced.

## Risks / Trade-offs

- **The newest row is acceptance time, not assembly time.** Under a queue backlog the model's freshest clock lags reality by the queue delay. → Accepted deliberately; the row's wording states receipt, so it is never wrong, only bounded. A bind-time reading remains available as a later addition if a workload makes the gap matter.
- **Cost grows with turn count.** One line per user turn, versus one line per request for a bind-time row. → Bounded by compaction, which supersedes the rows with the turns they annotate, and cache-read priced in the meantime.
- **The payload duplicates a timestamp the row's message already has.** → Deliberate (D2), and the two are written in the same transaction; the payload's value is the authority for what the row states.
- **A future reader may assume the row tracks the present because it appears every turn.** → The producer's documentation and the rendered wording both state receipt; the anchor's own phrasing rule established the same discipline for the frozen value.

## Open Questions

None. Whether a model presented with both surfaces honors the fresher value over the higher-authority frozen anchor was verified independently by the author: with the anchor explicitly framed as a value that can and will go stale, the model follows the updated timestamps.

## Migration Plan

No schema change and no migration: the row rides the existing `data-context` part type, and a worker that does not recognize the `temporal` producer renders nothing for it rather than rejecting the part.

Deployment order still matters, per the rail's documented rule: **deploy producer-aware workers before the api starts authoring the producer.** An older worker does not fail on the row, it silently renders nothing for it, so a turn stamped by a new api and executed by an old worker reaches the model undated. This is an ordering constraint, not a revision boundary — no quiesce, no drain.

Existing chats simply carry no rows on turns that predate the change. Rollback is reverting the code; rows already written stay in `messages.parts` and render as nothing to a reverted reader.

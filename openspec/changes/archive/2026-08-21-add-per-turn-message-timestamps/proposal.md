## Why

The shipped temporal anchor (#334) is frozen by construction: it states when a chat's context was established and refreshes only at compaction, so a conversation resumed a day later tells the model nothing about when anything in it happened. That is the correct trade for the system prompt — a per-request clock ahead of the cached prefix would forfeit prefix caching for the whole conversation — but it leaves the transcript itself undated.

The context-injection rail (#471–#476) removed the cost of fixing that. Adding a producer is an additive change under one envelope and one persisted part type, so a per-turn timestamp needs no new part schema and no coordinated API/worker revision boundary.

## What Changes

- A new `temporal` context-item producer attaches **one line to every user message**, stating when that turn was received: absolute, with a numeric UTC offset and an IANA identifier, the same shape the anchor already renders.
- The item is **persisted** on the message it belongs to, authored in the same transaction that persists the user message and its run. Its payload carries the turn's instant and the timezone it is to be rendered in, so the rendered line is reproduced identically on every replay without consulting the clock, the environment, or another table.
- Because every message's row is immutable, the transcript becomes a timeline the model can read gaps from, history reconstruction needs no special case, and **no message's serialized form ever changes between requests** — the rendered prefix stays byte-stable, so provider-side prefix caching is unaffected.
- The row states **when the turn was received**, not "the current time". A row that survives replay cannot claim the present instant, and a row whose wording changed once it stopped being the newest turn would break the byte-stability that motivates persisting it at all. The newest row is the model's freshest clock; the rest are history.
- The renderer takes a **list of labeled readings** and v1 passes exactly one. #454's stored-timezone reading becomes a second line rendered from the same stored instant; #455's request-derived reading, being per-request, attaches differently and remains its own problem.
- No exclusion is added to the compaction instruction: these rows are per-turn historical fact rather than standing context, and they are superseded along with the messages that carry them when a checkpoint absorbs those turns.

Not in this change, and deliberately: a bind-time reading that is current at request _assembly_ rather than at turn receipt, #454's row, #455's row, and any UI surfacing of message times.

## Capabilities

### New Capabilities

None. The row extends an existing temporal surface rather than introducing a capability.

### Modified Capabilities

- `temporal-anchor`: gains the per-turn receipt-time row — that every user message carries one, that it is persisted and immutable, that it shares the anchor's format, that it states receipt rather than the present instant, and that it is superseded by compaction with the turns it belongs to.
- `context-injection`: the fixed producer precedence list gains `temporal` as its fourth attached-turn entry.

## Impact

- `apps/api/src/chats/context-item.ts` — `temporal` appended to `CONTEXT_ITEM_PRODUCERS`.
- `apps/api/src/chats/context-item-producers.ts` — the producer: payload validation (instant, timezone) and a renderer taking a list of labeled readings.
- `apps/api/src/chats/chat-loop.service.ts` — the item is created where the other producers' items are already attached to the turn, from the instant that turn was accepted and the instance timezone resolved for the anchor in the same place.
- `apps/api/src/chats/context-builder.ts` — no change: the item renders through the existing persisted-item path.
- `apps/api/src/compaction/compaction.ts` — no change.
- Shares, forks, and exports — no change and no new exposure: the shared-chat projection is a text-only allowlist that already strips every non-text part.
- Cost: one short line per user message, cache-read priced after first write, discarded at compaction along with the turns it annotates.
- No database migration: the payload rides the existing `data-context` part type.

## Why

Pinning is a statement about **importance**, but every pinned surface still orders by activity (or pin-recency as a weak proxy). A long-running reference chat sinks under a throwaway reply; the owner has no way to express sequence. Issue #328 already named the API half; the mixed main-rail favorites index makes **one cross-type owner order** the only coherent model — reordering a type-filtered subset cannot place chats relative to projects.

## What Changes

- **Explicit owner rank on `pins`.** A dense integer `position` (or equivalent rank column) on the per-user pin row, scoped across all item types for that user — not per `item_type`. Migration backfills existing pins deterministically from `pinned_at DESC` (current rail order), preserving membership.
- **New pin lands at the head** of the owner's ranked list without breaking other consumers' reads.
- **Reorder via the unified pin resource** (partial update of the caller's pin set — not a verb handle on chat/project). Identity from the authenticated session only; RLS remains the datastore backstop. Reordering another user's pins is impossible.
- **`GET /pins` returns the mixed list in owner rank order** (replacing “most-recently-pinned first” as the normative order).
- **`GET /chats?pinned=only` and `GET /projects?pinned=only` honor the same rank** (type-filtered projection of the unified order). `pinned=exclude` / default non-pinned listing stays `updatedAt DESC`.
- **Recency digest pinned section follows owner rank** when baselines/re-bakes resolve (closes the “until owner-controlled ordering ships” deferral in that capability). Recent list unchanged (activity order).
- **Web:** main-rail drag-to-reorder is the sole authoring surface; chat/project “Pinned” sections are read-only projections that update via optimistic cache / invalidation after a successful reorder. UI mechanics live in design/tasks only — not in capability specs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `item-pins`: pin entity gains an owner-controlled rank; unified list and reorder API; new pins land at head; pin-recency ceases to be the list order.
- `item-archive`: `?pinned=only` chat/project lists order by the caller's pin rank instead of `updatedAt`; other filter modes keep `updatedAt DESC`.
- `chat-recency-digest`: capped pinned list follows owner pin rank (not last activity); recent list unchanged.

## Impact

- **Schema (`apps/api`)**: add rank column + index on `pins`; migration with `pinned_at DESC` backfill; update `pins_user_pinned_idx` (or successor) for the rail's primary read.
- **API**: reorder endpoint/DTO + OpenAPI regeneration; `PinsRepository.listWithCards` and chat/project `findByOwner` (`pinned=only`) join/order by rank; pin create assigns head position.
- **Security / tenancy**: reorder is owner-scoped; cross-tenant reorder denied (same fail-closed posture as pin/unpin); negative RLS/integration coverage.
- **Web**: rail DnD + optimistic `pins` cache + invalidate/refetch pinned list queries; no reorder controls on secondary sidebars.
- **Closes / advances**: GitHub #328 (API acceptance); digest ordering handshake called out from #307-era digest design.
- **Out of scope**: manual ordering of unpinned lists; per-type independent ranks; folders/nesting; shared/cross-user order; changing what pin/archive mean for access.

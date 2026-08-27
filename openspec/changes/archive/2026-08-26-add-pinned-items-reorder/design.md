## Context

See `proposal.md` for why. Pins today are `(user_id, item_type, item_id, pinned_at)` with list order `pinned_at DESC`. The main rail renders the mixed `GET /pins` list; chat/project sidebars render `?pinned=only` ordered by `updatedAt` (`item-archive`). Issue #328 sketched per-type ranks; the rail's mixed favorites index makes **one cross-type rank** the only coherent authoring model. No DnD library is installed; `framer-motion` is already in `apps/web`.

## Goals / Non-Goals

**Goals:**

- Persist a dense owner rank on the unified `pins` table; expose reorder on the pin resource; honor that rank on `GET /pins`, `?pinned=only` lists, and the digest's pinned section.
- Main-rail drag-to-reorder as the sole authoring UX; secondary Pinned sections update via optimistic cache / invalidation (no local DnD).
- Grip replaces the type icon on row hover only (no reserved empty space at rest).

**Non-Goals:**

- Per-type independent ranks; DnD on `/chat` or `/projects` sidebars; ordering unpinned lists; fractional/lexicographic ranks; adding `@dnd-kit` unless `framer-motion` Reorder proves insufficient during implementation.

## Decisions

### D1 — Cross-type dense `position` on `pins`

**Choice:** `position integer NOT NULL` on `pins`, unique per `(user_id, position)`, ordered ascending (0 = head). One sequence across chats and projects.

**Why:** The rail authors a mixed list; type-filtered surfaces are projections. Dense ints are enough at pin-list scale (ponytail); fractional keys deferred.

**Alternatives:** Per-type positions (#328 default) — rejected (cannot place a chat relative to a project). Sparse/fractional ranks — deferred until write contention appears. Abusing `pinned_at` as rank — rejected (conflates creation time with preference).

**Backfill:** `ROW_NUMBER()` over `(user_id)` ordered by `pinned_at DESC, item_id` → `position` starting at 0. Index: `(user_id, position)` for the rail read; keep or drop the old `pins_user_pinned_idx` as appropriate after cutover.

### D2 — New pin at head; re-pin does not move

On insert of a net-new pin: shift existing positions `+1` (or assign `position = -1` then normalize — prefer a single transaction that inserts at 0 and increments others). Idempotent re-pin: `ON CONFLICT DO NOTHING` leaves `position` untouched.

### D3 — Reorder API shape

**Choice:** `PUT /api/v1/pins/order` (or `PATCH /api/v1/pins` with a body listing ordered `{itemType, itemId}[]`) accepting the **full hydratable** caller pin set (same population as `GET /pins`) in the desired order. Server deletes non-hydratable leftover rows, then assigns `position = 0..n-1` for that user in one transaction. Unknown / not-owned / incomplete hydratable set → `400`. Response: same shape as `GET /pins` (or 204 + client relies on cache) — prefer returning the reordered list for a single cache write.

**Why:** Full-list replace matches the UI (drop produces a complete array) and avoids before/after neighbor edge cases. Not a verb on chat/project (RESTful pins resource).

**Identity:** Session only; RLS + repository `userId` from auth. Cross-tenant negative test required.

### D4 — Listing consumers move together

| Surface                                               | Order after this change             |
| ----------------------------------------------------- | ----------------------------------- |
| `GET /pins`                                           | `position ASC`                      |
| `GET /chats?pinned=only`, `GET /projects?pinned=only` | join/order by pin `position`        |
| `pinned=exclude` / default                            | `updatedAt DESC` (unchanged)        |
| Digest pinned section                                 | pin `position` among eligible chats |
| Digest recent                                         | `updatedAt DESC` (unchanged)        |

Chat/project list SQL for `pinned=only` must stop using sole `orderBy(updatedAt)`. Prefer joining `pins` on `(user_id, item_type, item_id)` rather than client-only sort so every consumer agrees.

### D5 — Web cache ripple (no secondary DnD)

After a rail reorder:

1. Optimistically reorder `pinQueryKeys.list()` cache.
2. Optimistically reorder (or invalidate) chat/project infinite-query caches for `pinned=only` so those sections match immediately.
3. On error, rollback snapshots; on settle, invalidate pins + pinned-only lists.

Secondary sidebars remain non-sortable. Specs stay UI-free; this is the contract for “ripple.”

### D6 — Main-rail DnD UX

- **Library:** `framer-motion` `Reorder.Group` / `Reorder.Item` first (already a dependency). Fall back to `@dnd-kit` only if handle-only activation + Link rows cannot be made reliable.
- **Handle:** On row hover / focus-within, replace the chat/project type icon with `GripVerticalIcon` (option A — no reserved slot at rest). Grip is the **only** drag activator so the `Link` stays clickable.
- **Motion:** Sibling rows shift and open a gap under the pointer while dragging (Reorder default).
- **Collapsed icon rail:** no grip / no reorder (same `group-data-[collapsible=icon]:hidden` posture as other trailing chrome).
- **Touch / narrow:** prefer long-press or always-show grip on `max-md` if hover-only is unusable — implement the minimal fix that keeps option A’s “no reserved desktop space.”

### D7 — Response / OpenAPI

Pin list responses MAY omit exposing `position` as a public field if order is defined solely by array order (preferred: array order is authoritative; avoid a redundant `position` on the wire unless a client needs random access). Reorder DTO + response types + committed `openapi.json` regeneration on `pnpm --filter api build`.

## Risks / Trade-offs

- **[Risk] Concurrent reorders / pin-while-dragging** → Mitigation: last-write-wins on full-list replace; optimistic UI rolls back on 4xx/5xx; invalidate on settle.
- **[Risk] Dense position gaps after unpin** → Accept gaps or compact on unpin/reorder; compacting on every reorder is enough (positions rewritten 0..n-1).
- **[Risk] Digest baselines frozen until re-bake** → Same as today; new rank applies on next baseline/compaction re-resolution, not live into old prompts. Document; do not mutate frozen baselines.
- **[Risk] framer-motion Reorder vs accessible keyboard reorder** → Ship pointer DnD first; keyboard can follow if product requires parity with dnd-kit’s KeyboardSensor.
- **[Trade-off] Full-list PUT vs patch-one-item** → Full list is simpler and matches the rail; large pin sets are still tiny.

## Migration Plan

1. Add `position` (nullable first if needed), backfill from `pinned_at DESC`, set `NOT NULL` + unique `(user_id, position)`.
2. Deploy API that reads/writes `position` and serves reorder; old clients ignoring reorder still see a stable order.
3. Deploy web rail DnD + cache ripple.
4. Rollback: drop reorder route usage; rank column can remain (harmless) or be ignored by readers falling back only if a hotfix requires it — prefer forward fix.

## Open Questions

None that block specs or tasks — grip-on-mobile detail is an implementation tweak under D6.

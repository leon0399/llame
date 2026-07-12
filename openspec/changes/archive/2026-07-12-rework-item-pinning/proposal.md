## Why

Pinning today is a `pinned_at` **column on the `chats` row** and does not exist for projects at all. A column on the item row can only express "this item is pinned" — it cannot express "pinned **by** this user, not by that one." That is a dead end for per-user pinning and for true multi-user chats (where one chat has several users who each keep their own pinned set). The single tractable move that unblocks both is to lift pin state off the item row into a per-user, cross-type index of references — one "user favorites" subsystem that points at chats and projects (and, later, other entities).

## What Changes

- **New `item-pins` capability**: a per-user, polymorphic pin index — a pin is a reference `(user, item_type, item_id)` owned by the pinning user, not an attribute of the item.
- **Unified pin API** replacing the chat-only `PATCH /chats/:id {pinned}`:
  - `GET /api/v1/pins` — the caller's pinned items, mixed across types, newest-pin-first, hydrated with display metadata.
  - `PUT /api/v1/pins/:itemType/:itemId` — pin (idempotent).
  - `DELETE /api/v1/pins/:itemType/:itemId` — unpin (idempotent).
  - Item type + id live in the path on every write — one symmetric resource, no per-type verb handles.
- **Per-user isolation enforced in the datastore**: RLS scopes a pin to its owning user; a user may only pin an item they can currently access (per-type accessibility check at write time — the seam multi-user chats later widen).
- **Pins are the sole source of pin state** — chat and project representations carry no pin field. The unified pinned list surfaces in two places, both composed from the one `GET /pins` query:
  - the main rail gets a "Pinned" section listing pinned chats and projects together;
  - the chat list and the project list each keep a "Pinned" group above their normal contents, derived on the client by intersecting the list with the caller's pinned set.
- **Per-type reference card**: each pinned entry embeds a lean, type-appropriate reference (`oneOf` chat/project card) so future item types contribute their own presentation (e.g. custom project icon/color) without changing the pin contract.
- **Strongly-typed item type**: a DB enum + matching TypeScript union, extensible to future pinnable entities without reworking the pin model.
- **BREAKING (internal)**: the `chats.pinnedAt` column + its pinned-ordering index, the `pinnedAt` field on the chat response, and the `PATCH /chats/:id {pinned}` path are all removed. No backfill and no backward compatibility — existing pins are dropped; only `apps/web` consumes this surface.

## Capabilities

### New Capabilities

- `item-pins`: a per-user, polymorphic pinning subsystem — the pin entity and its datastore-enforced per-user isolation, the unified pin/unpin/list API, viewer-scoped pin state on pinnable resources, and the cross-type pinned list surfaced in the main rail and in each item list's "Pinned" group.

### Modified Capabilities

<!-- None. Chat pinning predates OpenSpec (PoC-era) and has no `chats` spec to delta; its
     pin behavior is removed and re-established, now per-user, inside `item-pins`. The
     `projects` capability's requirements (ownership, filing, visibility) do not change —
     projects merely become a pinnable item type, which `item-pins` owns. -->

## Impact

- **Schema (`apps/api/src/db/schema`)**: new `pins` table + `pin_item_type` enum; **drop** `chats.pinnedAt` and `chats_owner_pinned_updated_idx`. New migration hand-appends `FORCE ROW LEVEL SECURITY` (0011/0018 precedent). No data backfill.
- **API (`apps/api`)**: new `pins/` feature module (controller + service + repository, DTOs incl. the first `oneOf`/discriminator response, RLS policies). `chats` loses the `pinned` field from its update DTO/path **and the `pinnedAt` field from its response**; no pin join is added to any list read (pins is the sole source).
- **Web (`apps/web`)**: new `/pins` service + TanStack Query hooks; the rail (`app-sidebar`) renders the unified Pinned section from the embedded cards; `project-list-sidebar` gains a live pin action + "Pinned"/"All projects" grouping (retiring its "coming soon" placeholder); `chat-item` re-points to the pins API and the chat-list "Pinned" group is recomputed from the pinned id-set instead of `chat.pinnedAt`.
- **Security**: pins are strictly per-user; cross-tenant and unauthenticated (`runAsPublic`) reads must be denied, with a negative test. The write-time accessibility check prevents pinning items the caller cannot see.
- **Tests**: pins RLS integration (isolation + accessibility gate), pins repository/service/controller units, and web unit tests for the rail section, project pin toggle, and re-pointed chat pinning.

## Context

Chat pinning ships today as `chats.pinnedAt` — a `timestamptz` **column on the chat row** (`apps/api/src/db/schema/chats.ts:51-53`) — ordered pinned-first via `chats_owner_pinned_updated_idx`, toggled through `PATCH /api/v1/chats/:id {pinned}`, and rendered as a `PINNED` group in the chat list (`apps/web/lib/services/chat/queries.ts:181,201`). Projects have no pinning: `ProjectListSidebar` shows a disabled "Pin — coming soon" placeholder (`apps/web/app/(chat)/components/project-list-sidebar/index.tsx:80-96`).

A column on the item row encodes "the item is pinned" and works only because a chat has exactly one owner (`chats.ownerUserId` is the tenant boundary). It cannot encode "pinned by user X but not user Y." Per-user pinning — and, later, true multi-user chats where several users each keep their own pinned set — requires pin state to live in a per-user relation.

The target UX is fixed by the design system (`AppShell.dc.html`): the main rail carries a single "Pinned" section that mixes chats and projects in one flat, pin-recency-ordered list (`llame-common.js` `PINNED = [{type,id,label,icon,href}, …]`), and each item list keeps its own "Pinned" group. This is a general per-user _favorites index_ that references chats and projects, not two parallel pin features.

Constraints from the codebase: RLS-in-the-datastore with `FORCE ROW LEVEL SECURITY` is a hard invariant (`apps/api/CLAUDE.md`); every request runs inside `TenantDbService.runAs`; migrations are drizzle-kit-generated with hand-appended `FORCE` (0011/0018 precedent); REST is resource-oriented, no RPC verb handles, DTO in / explicit response type out.

## Goals / Non-Goals

**Goals:**

- Move pin state off the item row into a per-user, cross-type pin index.
- One HTTP resource for pin/unpin/list, symmetric in how it addresses items.
- Datastore-enforced per-user isolation; a user can only pin what they can access.
- One unified pinned list for the rail; viewer-scoped pin state for each item list's "Pinned" group.
- A strongly-typed, additively-extensible item-type enumeration.

**Non-Goals:**

- **True multi-user chats.** This change is the per-user pin _substrate_ that de-risks that epic; it does not add chat participants, rewrite chat RLS from owner-only to membership, fan out message sender attribution, or change run ownership. The write-time accessibility check is the single seam that later widens.
- Manual drag ordering of pins (a `position` column). Order is `pinned_at DESC` only.
- Backfilling or preserving existing chat pins. Existing `chats.pinnedAt` data is dropped.
- Pinning any item type beyond chat and project in this slice.

## Decisions

### D1 — Single polymorphic `pins` table (not per-type tables)

```
pin_item_type = pgEnum('pin_item_type', ['chat','project'])

pins (
  user_id    text  → users.id  ON DELETE CASCADE,   -- text: NextAuth users.id is text
  item_type  pin_item_type NOT NULL,
  item_id    uuid  NOT NULL,                         -- polymorphic: no cross-type FK
  pinned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
)
index pins_user_pinned_idx ON (user_id, pinned_at DESC, item_id)   -- the rail's ORDER BY; item_id breaks pinned_at ties deterministically
```

The rail's primary read is one ordered, mixed-type list served by a single indexed scan (`WHERE user_id=? ORDER BY pinned_at DESC, item_id`). The composite PK gives idempotent pin/unpin and point-lookup membership checks. The enum ships **two values only** (`chat`, `project`) — a deliberate break from this schema's over-provision convention (`run_status` pre-declares 14; `chats.ts:227`): that heuristic pays off when the full vocabulary is spec-defined, but the pinnable-type set is an open product question, and adding a type is never enum-only (it needs an RLS branch + a `RefCard` + a client card), so `ALTER TYPE … ADD VALUE` rides along at zero marginal migration cost.

**Alternative — per-type pin tables (`chat_pins`, `project_pins`).** Buys a real FK + cascade-delete (which would eliminate the D4 orphan filter) and per-arm hydration joins. Reconsidered explicitly after committing to two types (which voids the original "UNION across N tables doesn't scale" argument — a 2-arm UNION is trivial). Still rejected, on the revised rationale: (1) the rail's ordered/limited primary read is a single-index scan on the polymorphic table, whereas a UNION must materialize both arms, merge, and sort every time — no index spans two tables; (2) one table / one repository / one RLS policy set vs two kept in lockstep; (3) a new type costs `ALTER TYPE` + one branch, not a whole new table/migration/repository arm. The price accepted is soft references (no FK) filtered at read (D4) — judged cheaper than two parallel tables + a UNION for the hot query.

### D2 — Item type + id in the path; idempotent `PUT`/`DELETE`

A pin has no mutable field (only existence + a server-set `pinned_at`), so it is a resource addressed by its natural key `(itemType, itemId)`:

```
GET    /api/v1/pins                     → caller's pinned items, mixed, pinned_at DESC
PUT    /api/v1/pins/:itemType/:itemId   → pin   (idempotent)
DELETE /api/v1/pins/:itemType/:itemId   → unpin (idempotent)
```

`PUT` (upsert `ON CONFLICT DO NOTHING`) and `DELETE` are both idempotent, both key the item in the path, neither takes a body. This resolves the asymmetry of a `POST {itemType,itemId}` create paired with path-keyed delete. `:itemType` is validated against the enum by the DTO/pipe; `:itemId` gets `ParseUUIDPipe`. No `/chats/:id/pin` verb handle — that would re-split per type and violate the repo's no-RPC-handle rule.

**Alternative — `POST /pins` with body.** Rejected per the above (asymmetric, and a pin has no body worth carrying).

**Response shape — a pin wrapper embedding a lean per-type reference card.** `GET` returns `PinnedItemResponse[]`; `PUT` returns one `PinnedItemResponse` at `200` (not `201` — idempotent, may create nothing); `DELETE` returns `204`.

```ts
class PinnedItemResponse {
  itemType: "chat" | "project"; // discriminator, on the wrapper
  itemId: string; // uuid
  pinnedAt: string; // type-agnostic ORDER BY key (mirrors the URL key)
  item: ChatRefCard | ProjectRefCard; // oneOf, discriminated by itemType
}
class ChatRefCard {
  id: string;
  title: string | null;
} // null title → client renders the localized placeholder
class ProjectRefCard {
  id: string;
  name: string;
} // icon/color land here additively when custom project presentation ships
```

The discriminator lives on the **wrapper**, not inside the cards, so the chat/project _list_ response types are untouched (they gain no `kind` field) and the ordering key sits at one uniform path. `item` is a **lean reference card**, deliberately NOT the full `ChatListItemResponse`: the card carries only render-stable presentation fields (title/name, later a project icon/color), never the volatile `lastMessage`/run `status` that stream — see D5 for why that bounds client-cache staleness. Each future pinnable type contributes its own `*RefCard` to the `oneOf`, so the pin subsystem stays type-agnostic and per-type presentation is an additive card change, not a pin-schema change.

**Alternative — flatten presentation onto the pin (`{…, title, icon, color}`).** Rejected: every type's presentation fields collapse into one wide all-nullable shape; the `oneOf` card gives each type exactly its own fields. **Alternative — embed the full `ChatListItemResponse`.** Rejected: it duplicates volatile streaming fields into the pins cache, forcing pins invalidation on every run tick (D5).

**Cost owned:** this is the first `oneOf`/discriminator response in the API — the controller needs `@ApiExtraModels(ChatRefCard, ProjectRefCard)` + `schema: { oneOf: [getSchemaPath(…)], discriminator: { propertyName: 'itemType', mapping } }`. Justified by the forward requirement (per-type presentation) and reusable for any typed-reference chrome (search results, mentions).

### D3 — Per-user RLS + write-time accessibility gate

Policies (FORCE, hand-appended in the migration):

- `SELECT` / `DELETE` USING: `user_id = current_setting('app.current_user_id', true)`. Under `runAsPublic` (`current_user = ''`) nothing matches → pins are never exposed on the public path.
- `INSERT` WITH CHECK: `user_id = current_user AND` a per-type accessibility subquery, mirroring the chat→project filing gate (`chats.ts:85`):

  ```sql
  user_id = current_setting('app.current_user_id', true) AND (
    (item_type = 'chat'    AND item_id IN (SELECT id FROM chats    WHERE owner_user_id = current_setting('app.current_user_id', true)))
    OR (item_type = 'project' AND item_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)))
  )
  ```

  Each subquery runs under the referenced table's own RLS, so "accessible" is exactly "the caller can see it." No recursion (chats/projects never scan `pins`). When multi-user chats arrive, only the `chat` branch's predicate widens (owner-or-participant); the pin model is untouched.

  **"Accessible" = owned** for this slice: a user may pin only items they own. A non-owned _public_ chat is deliberately **not** pinnable — allowing the write without a matching read would create an invisible dead pin (the hydration join runs under the caller's authenticated RLS, and `chats_public_read` only matches the no-identity `runAsPublic` path, `chats.ts:93-96`), and "pin" means "keep my own thing handy," not "bookmark a shared link." Bookmarking shared/public content is a separate future decision.

- **Write-denial → HTTP:** an inaccessible or nonexistent `item_id` fails the `WITH CHECK` and surfaces as `42501` (RLS). The service maps it to `NotFoundException` with no existence oracle — exactly the filing-gate precedent (`chats.service.ts:127-164`), never a `500`. Pins has no FK on `item_id`, so `23503` cannot arise from the item (only the server-derived `user_id` FK, which always exists).
- **Idempotent gate is sound:** the security-critical case — pinning an item the caller can't access when no pin exists — is a genuine INSERT, so `WITH CHECK` always fires (→ 404). The only case whose ON-CONFLICT/`WITH CHECK` interaction is Postgres-version-nuanced is _re-pinning an item the caller pinned earlier but has since lost access to_; that resolves to either a `200` no-op or a `404`, and **both are benign** — the pin row already exists and the item is filtered from every read anyway (D4). The gate depends on none of that nuance.

### D4 — Read-time hydration into per-type cards; also the orphan/stale filter

`GET /pins` scans `pins` for the user, then batch-loads each type's **reference card** (chat ids → `{id,title}` from `chats`; project ids → `{id,name}` from `projects`) under RLS, preserving `pinned_at DESC, item_id`, and assembles the `PinnedItemResponse` wrapper (D2). A pin whose item was deleted or is no longer accessible yields no card under RLS and is simply dropped. This makes graceful degradation the default and removes the need for `AFTER DELETE` cleanup triggers (migration exceptions in this codebase). No cross-type FK is therefore needed (D1). Cross-feature reads here are direct Drizzle reads against the shared `../db/schema` under RLS — not `ChatsService`/`ProjectsService` calls — so no `PinsModule`↔`ChatsModule` import and no circular dependency (matches how `chats-repository.ts` imports the whole schema and joins freely; module imports in this repo are for _behavior_, not table reads).

**Read-time filtering is the _only_ cleanup that fully works, and multi-user is why.** No active per-delete cleanup is done. Deletion runs as the deleting user under RLS, and the pins DELETE policy is `user_id = current_user`, so a service-path `DELETE FROM pins WHERE item_id=X` could only remove the _deleter's own_ pins. The moment chats are multi-user, another user's pin to the just-deleted item cannot be reached by an RLS-scoped delete (they ≠ current*user) — so that user's pin dangles regardless and \_must* be dropped at their read anyway. Given read-time filtering is therefore mandatory, an active delete is redundant work that only half-cleans while adding a chats/projects→pins write coupling. Dead rows are pure hygiene (invisible, no leak — UUIDs aren't reused); if table growth ever matters, a periodic sweep under an elevated (cross-user) context is the right tool, not per-delete cleanup.

### D5 — Pins is the sole source of pin truth; the client composes (no viewer field on item lists)

Chat and project **list** responses carry **no** pin information — no `pinnedAt` field, no join. `pins` is a self-contained subsystem and its `GET /pins` is the single source of pin state. Two client surfaces compose the one `usePins()` query:

- **Rail** renders directly from `GET /pins` — the embedded `RefCard` gives title/name (and later per-type icon/color), the client derives icon + href from `itemType`. This covers pinned items even when they fall outside the loaded list window.
- **Per-list "Pinned" group** is built on the client by intersecting the item list (`useChats()`/`useProjects()`) with the pinned id-set from `usePins()`, ordered by `pins.pinnedAt`. The rich rows (`lastMessage`, run `status`) come from the **list** cache — their canonical home, kept fresh by the list's own streaming invalidation — never from the pins cache.

This is why the embedded card is lean (D2): the pins cache holds only render-stable fields, so its staleness surface is bounded to explicit edits (rename/recolor/delete/pin) — the exact invalidations in D5a — and never collides with streaming. Optimistic pin toggle mutates **only** the pins cache (add/remove a ref), and the row re-buckets instantly; no patching a `pinnedAt` inside the list cache.

The chat list SQL loses its pinned-first sort entirely: `findByOwner` orders by `updated_at DESC` only, `chats_owner_pinned_updated_idx` is dropped, `chats_owner_updated_idx` remains. This supersedes an earlier draft that put a viewer-scoped `pinnedAt` on the list responses; that mechanism is rejected because it leaves a pin field on the chat contract and re-adds a per-read join for state the client can compose from the pins query it already holds.

### D5a — Cache invalidation and optimistic pin

Any mutation that changes an item's card fields or its existence invalidates `pinQueryKeys.list()`: chat rename/delete, project rename/(future recolor)/delete, and pin/unpin. Pin/unpin additionally invalidates the affected item's list query so the per-list "Pinned" group re-buckets. Server-side deletion self-heals (D4 drops non-hydratable pins); invalidation only governs _when_ the client refetches.

**Optimistic pin synthesizes the card.** The rail renders from the embedded `RefCard`, so an optimistic pin can't insert a bare ref — the pin action fires from a _rendered_ item row, so the client builds the optimistic `PinnedItemResponse` with a card from that item (`{id,title}` / `{id,name}`) and inserts it into the pins cache; the settle/invalidate reconciles with the server's authoritative card. The per-list "Pinned" group needs only membership (a ref) since its rich row comes from the list cache, but the single optimistic pins-cache entry (card included) serves both surfaces. Unpin is a plain optimistic removal.

### D6 — Drop-and-replace migration, no backfill

Per the change's scope: `DROP COLUMN chats.pinnedAt` + drop `chats_owner_pinned_updated_idx`; `CREATE TYPE pin_item_type` + `CREATE TABLE pins` + index + policies + `FORCE ROW LEVEL SECURITY`. Existing pins are discarded. This keeps the migration a plain generated forward migration plus the hand-appended `FORCE` (no manual `UPDATE`/`INSERT` backfill block).

## Risks / Trade-offs

- **No DB FK on `item_id` (polymorphic).** → Referential validity is enforced at write by D3's accessibility gate; dangling pins are filtered at read by D4. Acceptable because pins are soft references, not integrity-critical relations.
- **Denormalized card duplicates the item's title/name into the pins cache.** → Bounded on purpose: the card carries only render-stable fields (never streaming `lastMessage`/`status`), so staleness occurs only on explicit edit and is covered by the D5a invalidations. The rich per-list rows read from the list cache, not the card, so there is no volatile duplication.
- **First `oneOf`/discriminator response in the API.** → Extra Swagger wiring (`@ApiExtraModels` + `getSchemaPath` + `discriminator`), but justified by a concrete forward requirement (per-type presentation) and reusable for other typed-reference chrome. Establishes the pattern deliberately, not speculatively.
- **Dropping `chats.pinnedAt` + `ChatResponse.pinnedAt` is BREAKING for `apps/web`.** → Only `apps/web` consumes it, updated in the same change; the removed `PATCH /chats {pinned}` field, the removed response field, and the new `/pins` service + client composition land together. No external clients (SDK codegen is deferred).
- **`PUT` with an empty body to create a resource is slightly unusual.** → Justified: the resource genuinely has no client-supplied data; idempotent upsert is the correct semantic and keeps the surface symmetric (D2).
- **Enum widening later needs a migration.** → Accepted; a new `ALTER TYPE ... ADD VALUE` + a new accessibility branch is the intended additive path and matches how `run_status` / `chat_visibility` evolve.

## Migration Plan

1. Schema change in `apps/api/src/db/schema`: add `pin_item_type` enum + `pins` table (`schema/pins.ts`), remove `pinnedAt` and `chats_owner_pinned_updated_idx` from `chats.ts`. Remove `ChatResponse.pinnedAt` + its `toResponse` mapping and the `UpdateChatDto.pinned` field in the same change (API contract, not migration).
2. `pnpm --filter api db:generate`; hand-append `FORCE ROW LEVEL SECURITY` on `pins` to the generated SQL and record it in the `apps/api/CLAUDE.md` "hand-authored exceptions" list.
3. Deploy is forward-only. Rollback = restore the column-based pin (revert migration); acceptable because no pin data is preserved either direction and the feature is internal.
4. Ship API + web together (the `PATCH /chats {pinned}` removal and the rail/list wiring are one release).

## Open Questions

- None blocking. Enum widening for future pinnable types (artifact, knowledge space, memory) is deliberately deferred to when those entities exist and their accessibility predicate is known.

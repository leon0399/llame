## 1. Schema & migration

- [x] 1.1 Add `pin_item_type` pgEnum (`['chat','project']` — two values only, no over-provisioning) and a `pins` table (`apps/api/src/db/schema/pins.ts`): `user_id` text → `users.id` ON DELETE CASCADE, `item_type` enum, `item_id` uuid, `pinned_at` timestamptz NOT NULL default now(), PK `(user_id,item_type,item_id)`, index `pins_user_pinned_idx` on `(user_id, pinned_at DESC, item_id)` (item_id breaks pin-time ties deterministically); export `Pin` type; register in `schema/index.ts`.
- [x] 1.2 Define RLS policies on `pins`: `SELECT`/`DELETE` USING `user_id = current_setting('app.current_user_id', true)`; `INSERT` WITH CHECK adding the per-type accessibility subquery (chat→chats, project→projects owner check) per design D3; `.enableRLS()`.
- [x] 1.3 Remove `pinnedAt` and the `chats_owner_pinned_updated_idx` index from `apps/api/src/db/schema/chats.ts` (keep `chats_owner_updated_idx`).
- [x] 1.4 `pnpm --filter api db:generate` (→ `0023_unique_carmella_unuscione.sql`, renumbered from 0022 after rebasing onto #176's 0022); hand-append `FORCE ROW LEVEL SECURITY` for `pins`; `drizzle-kit check` passes.
- [x] 1.5 Document the new hand-authored migration exception (FORCE append + chats.pinned_at drop) in `apps/api/AGENTS.md` (CLAUDE.md symlink) Gotchas list.

## 2. API — pins feature module

- [x] 2.1 Create `apps/api/src/pins/` module (`pins.module.ts`, register in `app.module.ts`).
- [x] 2.2 `PinsRepository`: `list(userId)` (ordered `pinned_at DESC`), `pin(userId,type,id)` (upsert `ON CONFLICT DO NOTHING`), `unpin(userId,type,id)`, and a `hydrateCards` step batch-loading per-type reference cards by id under RLS (chat → `{id,title}`, project → `{id,name}`) — direct Drizzle reads against the shared schema, dropping pins whose card does not hydrate (design D4).
- [x] 2.3 `PinsService` wrapping the repository inside `TenantDbService.runAs`; map a `42501` RLS `WITH CHECK` denial on `pin(...)` to `NotFoundException` (no existence oracle), mirroring `chats.service.ts:127-164`.
- [x] 2.4 DTOs + response types: `ItemTypeParamDto` (enum-validated `:itemType`, `ParseUUIDPipe` on `:itemId`); `ChatRefCard` (`{id, title|null}`) and `ProjectRefCard` (`{id, name}`); `PinnedItemResponse` (`itemType`, `itemId`, `pinnedAt`, `item: oneOf`) — wire the `oneOf` via `@ApiExtraModels(ChatRefCard, ProjectRefCard)` + `getSchemaPath` + `discriminator { propertyName: 'itemType' }`; nullable fields modeled explicitly.
- [x] 2.5 `PinsController`: `GET /api/v1/pins` (→ `PinnedItemResponse[]`), `PUT /api/v1/pins/:itemType/:itemId` (→ `200 PinnedItemResponse`), `DELETE /api/v1/pins/:itemType/:itemId` (→ `204`); identity from the authenticated session only.

## 3. API — remove all legacy chat-pin wiring (no traces, per M2)

- [x] 3.1 Remove the `pinned` field from `UpdateChatDto` and drop the pin branch in `chats-repository.ts` `update` + the `pinned?: boolean` in `chats.service.ts` patch type; clean orphaned `IsBoolean` import + dangling comment refs.
- [x] 3.2 Remove `pinnedAt` from `ChatResponse` and its `toChatResponse` mapping; remove the pinned-first sort from `findByOwner` (order by `updated_at DESC` only). Delete `chat-pinning.integration.spec.ts`; fix pinned refs in `chats.controller.spec.ts` / `chats-repository.spec.ts` / `chats.dto.spec.ts`.
- [x] 3.3 Confirm chat and project list read paths carry **no** pin field or pins join — pins is the sole source (design D5). No new field is added to projects.

## 4. Web — services & hooks

- [x] 4.1 Add `apps/web/lib/services/pins/` — types (`PinnedItem` with the `oneOf` card), `listPins`, `usePins` (query), `usePinItem`/`useUnpinItem` (mutations → `PUT`/`DELETE /api/v1/pins/:type/:id`) with error toasts; optimistic pin **synthesizes the card** from the clicked item (`{id,title}`/`{id,name}`) into the pins cache, optimistic unpin removes the ref; `pinQueryKeys` factory.
- [x] 4.2 Wire D5a invalidations: pin/unpin invalidates `pinQueryKeys.list()` + the affected item's list; chat rename/delete and project rename/delete also invalidate `pinQueryKeys.list()`.
- [x] 4.3 Re-point chat pinning: `chat-item.tsx` pin button → `usePinItem`/`useUnpinItem`; delete `setChatPinned`/`useSetChatPinned` (`lib/services/chat/management.ts`); rewrite `queries.ts` grouping to bucket the "Pinned" group by membership in the `usePins()` id-set (ordered by `pins.pinnedAt`), not by `chat.pinnedAt`.
- [x] 4.4 Remove the `pinnedAt` field from the web chat type (`lib/services/chat/queries.ts:33`) and any project-type pin remnants — no pin field on either resource type.

## 5. Web — rail & lists UI

- [x] 5.1 Render a "Pinned" section in the main rail (`app-sidebar`) from `usePins()` — mixed chats+projects, `pinned_at DESC`, icon by type, links to the item; matches `AppShell.dc.html` structure.
- [x] 5.2 **Wire the project pin button** — it is currently a disabled "Pin — coming soon" placeholder (`project-list-sidebar/index.tsx:80-96`, the `aria-disabled`/`pointer-events-auto`/`opacity-50` idiom). Replace it with a live pin toggle calling `usePinItem`/`useUnpinItem` (itemType `project`), showing pin vs unpin state per the caller's pinned set — matching `chat-item.tsx`'s pin control — and add a "Pinned" / "All projects" grouping above the rest of the list.
- [x] 5.3 Confirm the chat list "Pinned" group renders from the re-pointed pin state (no visual regression).

## 6. Tests

- [x] 6.1 `pins` RLS integration spec: per-user isolation (A cannot see/unpin B's pin), absent-identity/`runAsPublic` returns none, and the write-time accessibility gate denies pinning an inaccessible item.
- [x] 6.2 `PinsRepository`/`PinsService` unit specs incl. idempotent pin/unpin and hydrate dropping vanished/inaccessible items.
- [x] 6.3 `PinsController` spec: path-keyed pin/unpin, enum + UUID validation on params, typed responses.
- [x] 6.4 Web unit tests: rail Pinned section renders mixed items; project pin toggle; chat pin re-pointed to `/pins`; project list Pinned grouping.
- [ ] 6.5 Run `scripts/rls-test.sh` (schema/RLS touched) and `pnpm --filter api test` + `pnpm --filter web test`; lint/typecheck both apps.

## 7. Docs

- [x] 7.1 Add a dated `CHANGELOG.md` entry; if pinning is on `ROADMAP.md`, remove it there in the same change.

## 1. Schema and pin repository

- [x] 1.1 Add `position` (integer) to `pins` in `apps/api/src/db/schema/pins.ts`, generate migration, backfill existing rows from `pinned_at DESC, item_id` per user starting at 0, enforce `NOT NULL` + unique `(user_id, position)`, and update the rail read index — verify with `pnpm --filter api db:generate` / migrate on a throwaway DB and a unit/integration assertion that backfilled order matches prior `pinned_at` order
- [x] 1.2 Update `PinsRepository.listWithCards` to `ORDER BY position ASC` (stable tie-break) and assign head `position` on net-new pin (shift others) without moving on idempotent re-pin — verify repository unit tests cover list order, new-pin-at-head, and re-pin-no-move
- [x] 1.3 Add repository `reorder(userId, orderedItems)` that rewrites positions `0..n-1` for the caller's full set in one transaction and rejects incomplete/unknown sets — verify unit tests for happy path and rejection cases

## 2. API surface

- [x] 2.1 Expose reorder on the pins controller (DTO + explicit response type, session identity only) per design D3 and regenerate committed `openapi.json` via `pnpm --filter api build` — verify OpenAPI includes the route and `git diff --exit-code` on `openapi.json` is clean after build
- [x] 2.2 Wire service + RLS-scoped path; add integration coverage that owner reorder sticks on `GET /pins` and cross-tenant reorder cannot mutate another user's pins — verify `pnpm --filter api test:integration` filters for pins reorder / RLS pass
- [x] 2.3 Change `findByOwner` / projects list so `pinned=only` orders by pin `position`; leave other pin filters on `updatedAt DESC` — verify API unit/integration tests for both orderings

## 3. Recency digest

- [x] 3.1 Resolve digest pinned selection/order by pin `position` among eligible chats; keep recent on activity order — verify digest unit tests assert owner-rank order for pinned and unchanged recent ordering

## 4. Web client

- [x] 4.1 Add generated/handwritten pin reorder mutation with optimistic `pins` list reorder + invalidate/optimistic update of chat/project `pinned=only` list caches and rollback on error — verify service unit/hook tests for optimistic apply and rollback
- [x] 4.2 Implement main-rail `framer-motion` Reorder on `AppSidebarPinned`: hover/focus replaces type icon with `GripVerticalIcon` (no reserved empty space), handle-only drag, sibling gap animation, persist via reorder mutation — verify Storybook play and/or component tests cover grip reveal and reorder callback; icon-collapsed rail does not offer reorder
- [x] 4.3 Confirm chat/project Pinned sections have no DnD controls and pick up new order from cache/refetch after rail reorder — verify existing list tests still pass and a targeted test shows pinned-only order follows pins cache/API order

## 5. Docs and changelog

- [x] 5.1 Add `CHANGELOG.md` entry (and drop from `ROADMAP.md` if listed); close out #328 acceptance notes as applicable — verify markdownlint on touched docs via `pnpm lint:markdown` for those paths

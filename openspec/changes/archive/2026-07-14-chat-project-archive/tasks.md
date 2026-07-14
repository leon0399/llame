## 1. Schema + migration (apps/api)

- [x] 1.1 Add nullable `archivedAt` timestamptz column to `chats` and `projects` schema (`apps/api/src/db/schema/chats.ts`, `projects.ts`).
- [x] 1.2 Generate the drizzle-kit migration; review the SQL (no RLS change — column under existing owner policies, public-read policies untouched); `drizzle-kit check` passes.
- [x] 1.3 Run `pnpm db:migrate` against dev Postgres and confirm both columns exist.

## 2. DTOs + responses (apps/api)

- [x] 2.1 Add `archived: boolean` (optional, `ValidateIf` semantics) to `UpdateChatDto` and `UpdateProjectDto`.
- [x] 2.2 Add `archivedAt` (`date-time`, nullable) to `ChatResponse`, `ChatListItemResponse`, `ProjectResponse`.
- [x] 2.3 Add `?archived` (`only|with`) and `?pinned` (`only|with|exclude`) with `IsIn` validation to `ListChatsQueryDto` and the projects list query DTO; document absent defaults (`archived`⇒exclude, `pinned`⇒with).
- [x] 2.4 Add `archivedAt` to `ChatRefCard`/`ProjectRefCard` (`apps/api/src/pins/dto/pins.dto.ts`); `listWithCards` (`pins-repository.ts`) selects `archived_at` from `chats`/`projects` and populates it.
- [x] 2.5 Regenerate `apps/api/openapi.json` via build.

## 3. List filtering (apps/api) — `?archived` + `?pinned`

- [x] 3.1 Extend `findByOwner` (`chats-repository.ts`) with `filter.pinned` + `filter.archived`: `pinned=only` ⇒ `WHERE EXISTS (pins WHERE user_id=<owner> AND item_type='chat' AND item_id=chats.id)`; `pinned=exclude` ⇒ `WHERE NOT EXISTS (…)`; `archived=only`⇒`isNotNull(archivedAt)`; `archived=with`⇒no term; absent `archived`⇒`isNull(archivedAt)`. All branches `orderBy(desc(updatedAt))`. Keep `Chat[]` return (no JOIN).
- [x] 3.2 Apply the same `pinned`/`archived` filter + `updatedAt` ordering to the projects list query.
- [x] 3.3 Confirm `?projectId` on `GET /chats` composes with both filters.

## 4. Mutation guard (apps/api)

- [x] 4.1 Add shared `assertNotArchived(resource)` helper throwing `ConflictException` (`409`, "archived; unarchive or delete first").
- [x] 4.2 Call it in `chats.service.updateChat` (skip when `input.archived === false`) and `projects.service.updateProject`.
- [x] 4.3 Call it in `chatLoopService.persistUserMessageAndRun` after the chat is resolved, for a pre-existing chat only (a freshly created chat cannot be archived) — sending to an archived chat is refused with `409`, no auto-unarchive.

## 5. Web: two-query list split + toggle (retires #204)

- [x] 5.1 Define query keys `chatKeys.pinned()` → `?pinned=only&archived=with` and `chatKeys.list()` → `?pinned=exclude` (same for projects); a `projectId` variant for the per-project chat list.
- [x] 5.2 Render a discrete Pinned section (from `pinned()`) above the time-grouped All section (from `list()`); `groupChatsByTimePeriod` no longer splices Pinned out. Same split for the projects list.
- [x] 5.3 Mirror `archivedAt` on web `ChatListItemResponse`/`ChatResponse`/`ProjectResponse`/`ChatRefCard`/`ProjectRefCard` types.
- [x] 5.4 Add `setArchived(itemType, itemId, archived)` mutation implementing the cache plan: archive removes from non-pinned list + flips `archivedAt` in pinned/rail caches (pin rows survive); unarchive flips back + invalidates non-pinned list; `onError` rolls back; toast on success.
- [x] 5.5 Convert the disabled `Archive` menu item in `chat-item.tsx`, `project-list-sidebar/index.tsx`, and `app-sidebar-pinned.tsx` to an Archive⇄Unarchive toggle driven by `archivedAt`.
- [x] 5.6 Render an "Archived" indicator on pinned-rail rows from `archivedAt` (indicator styling is a later change).

## 6. Verification + docs

- [ ] 6.1 RLS negative specs: User B cannot archive/rename/delete-archive User A's item (`404`); archived items absent from other users' default lists; `relforcerowsecurity` still true; a shared (public) archived chat stays reachable.**(not present — unit tests only)**
- [x] 6.2 `409` specs: rename and send-to-archived refused with `409`; unarchive and delete allowed.
- [ ] 6.3 List-filter specs: `?archived`/`?pinned` combinations return the correct sets; Pinned category includes archived pinned items; All category excludes them.**(not present — unit tests only)**
- [x] 6.4 `pnpm --filter api build/test/typecheck/lint`; `pnpm --filter web test/typecheck/lint`; `openspec validate chat-project-archive` clean.**(lint was failing on chats-repository.spec.ts:294 — now fixed)**
- [x] 6.5 CHANGELOG entry (same PR) noting archive ships without an Archived view; UI unarchive is pinned-rail-only for now; the list rework retires #204.

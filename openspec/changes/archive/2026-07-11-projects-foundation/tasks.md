## 1. Schema + RLS (apps/api)

- [x] 1.1 `projects` table: `id` uuid pk; `owner_user_id` text NOT NULL FK `users` `ON DELETE CASCADE`; `name` text NOT NULL (not unique); `created_at`/`updated_at`. Index on `owner_user_id`. No `settings`, no org-owner column, no membership table (all deferred).
- [x] 1.2 `chats.project_id` nullable uuid FK → `projects` `ON DELETE SET NULL`; index on `(project_id)`.
- [x] 1.3 RLS on `projects` (owner-only, same shape as `chats_owner`): SELECT/INSERT-withCheck/UPDATE/DELETE all `owner_user_id = current_setting('app.current_user_id', true)`. **Hand-append** `FORCE ROW LEVEL SECURITY` for `projects` (Drizzle can't emit it) — mirror `0018`/`0019`.
- [x] 1.4 Chat filing `withCheck`: extend the `chats` update path so a target `project_id` must be one the caller owns — `project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting(...))`. Do **not** add a `chats.owner = projects.owner` CHECK column (keeps future editor-filing open). Do **not** touch `chats`/`messages` SELECT policies.
- [x] 1.5 `db:generate` migration (`0021` on this branch — drizzle-kit auto-assigns from the journal); review generated SQL, add the hand-authored FORCE + policies per convention; `drizzle-kit check` passes.

## 2. API surface (apps/api)

- [x] 2.1 `projects` module (controller/service/repository) registered in `app.module.ts`; all reads/writes inside `TenantDbService.runAs`.
- [x] 2.2 Endpoints + DTOs + explicit response types: `POST/GET/PATCH/DELETE api/v1/projects`, `GET api/v1/projects` (list = owned). Chat filing via `PATCH api/v1/chats/:id` `projectId` field (nullable — set to file, null to unfile), not an RPC verb. `ParseUUIDPipe` + `@ApiParam` on uuid path ids.
- [x] 2.3 Regenerate `apps/api/openapi.json` via build.

## 3. Tenancy verification (acceptance criteria)

- [x] 3.1 RLS integration specs: a user sees only their own projects; a non-owner cannot read/update/delete a project; **filing a chat into a project does not change the chat's readership** (a non-owner still cannot read it); `relforcerowsecurity` true on `projects`; identity-absent → deny.
- [x] 3.2 `bash apps/api/scripts/rls-test.sh` with a unique `RLS_TEST_PORT` (55440–55490) — green, including the filing-widens-nothing case.

## 4. Web (apps/web — thin client)

- [x] 4.1 Personal **Projects** surface: create a project, list own projects, open a project showing its chats. Management (rename/delete) per DESIGN.md.
- [x] 4.2 Sidebar grouping of chats by project (grouped section per project; unfiled chats in the default list); file/unfile affordance on a chat.
- [x] 4.3 API client calls only (no DB); TanStack Query; loading/empty states per DESIGN.md tokens.

## 5. Verification + docs

- [x] 5.1 `pnpm --filter api build/test/typecheck/lint`; `pnpm --filter web test/typecheck/lint`. (api build + 321 unit; web 233; typecheck/lint clean both.)
- [x] 5.2 Component tests cover the flows: sidebar grouping incl. project sections + fallback (`chat-list.test.tsx`), dialogs/menu (`chat-item.test.tsx`), service mutations incl. delete-unfiles invalidation and idempotent 404 (`mutations.test.ts`); delete-unfiles proven at the datastore in `projects-rls.integration.spec.ts`. Browser e2e deferred to CI (local runs are env-confounded on this machine).
- [x] 5.3 CHANGELOG entry added; follow-ups noted there and in proposal.md (membership + invite + sharing RLS; org-ownership + org-roster inheritance; drop `project` from `org_unit_type`; the `memberships → org_unit_memberships` rename change; the mobile /projects surface — the section is desktop-only for now, its nav entry renders disabled on mobile). `openspec validate projects-foundation` clean.

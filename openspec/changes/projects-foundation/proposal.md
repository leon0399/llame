## Why

llame's product surface (README, SPEC §1) treats **projects** as first-class shared workspaces. None of that exists yet: a chat belongs to exactly one user (`chats.owner_user_id`) with no way to group it. The org-unit tree (#44) is governance (org → team → department), not a place a person keeps a body of work.

This change lays the **projects foundation**: a project is, at bottom, a **chat group** — a user-owned workspace that owns chats. It is the first, deliberately small slice of the eventual GitHub-repo-style model (user- or org-owned, with invited collaborators). Membership, invitation, and cross-user sharing are the **immediately following change**, split out on purpose: sharing adds the codebase's first cross-tenant chat-read path, and it deserves its own focused, adversarially-reviewed tenant-boundary change rather than riding in the foundation.

## What Changes

- **New `projects` entity** — a terminal workspace (no child units; it groups chats, not sub-projects), stored in its **own `projects` table** (not an `org_unit_type`). A single **user owner** (`owner_user_id text NOT NULL` → `users`), following the `chats` precedent of shipping the single-owner column now and adding any org-owner arm as a later additive migration (chats.ts:24, "additive, not a retrofit").
- **Chats join a project** — `chats.project_id` (nullable uuid FK → `projects`, `ON DELETE SET NULL`): a chat belongs to **0 or 1** project; deleting a project unfiles its chats, it does not destroy conversations.
- **Owner-only visibility** — projects and the chats filed into them stay visible to the owner exactly as chats are today. Projects introduce **no new cross-user access path**: this foundation does not touch `chats`/`messages` read policies. A negative test pins that filing a chat widens nothing.
- **HTTP surface** — project CRUD and chat filing (as a `PATCH /chats/:id` field, not an RPC verb), each behind a DTO + explicit response type (code-first OpenAPI).
- **Web** — a personal **Projects** surface (create/list/open) and sidebar grouping of chats by project.

## Capabilities

### New Capabilities

- `projects`: the project entity (user-owned, terminal, its own table), chat↔project association (file/unfile, delete-unfiles), and the invariant that projects add no cross-user chat visibility.

### Modified Capabilities

<!-- none. No existing capability's behavior changes. -->

## Impact

- **Schema (apps/api, sole DB owner)**: new `projects` table (`id`, `owner_user_id text NOT NULL` FK users cascade, `name`, timestamps) and `chats.project_id` column + FK + index. One drizzle-kit migration (next number after `0021`), with `FORCE ROW LEVEL SECURITY` hand-appended for `projects` per the repo's migration convention.
- **Security / tenancy**: **no cross-tenant surface added.** Project RLS is owner-only (`owner_user_id = current_user`), the same shape as `chats_owner`, with no policy recursion and **no `BYPASSRLS` helper**. `chats`/`messages` read policies are untouched; the only chat write affected is filing, whose `withCheck` requires the target project be one the caller owns. Fails closed on absent identity; a negative test pins that a filed chat is no more visible than before.
- **API**: new `projects` module (controller/service/repository), DTOs + response types, chat-filing on `PATCH /chats`; `openapi.json` regenerated. No removals.
- **Web**: personal Projects surface + sidebar grouping; thin API client only (no DB).
- **Next change (membership + sharing)** — scoped but deferred: `project_memberships` + a lean `project_role` (`owner`/`editor`/`viewer`), invite/remove, and the datastore-enforced cross-user read of a shared project's chats + messages. That change reuses the org-units `42P17` recursion break (a sibling `llame_project_role` `BYPASSRLS` helper) and ships the negative isolation tests — analysis carried in this change's design.md so the follow-up inherits it.
- **Other follow-ups**: org-unit ownership (the additive `owner_org_unit_id` arm) and org-roster inheritance; a project's knowledge/connectors/skills/artifacts (SPEC §1); deprecating the now-unused `project` value from `org_unit_type`. Independent naming hygiene (not a dependency of this slice): renaming the existing `memberships` table to `org_unit_memberships` to disambiguate it from the future `project_memberships` — its own atomic, behavior-preserving change.

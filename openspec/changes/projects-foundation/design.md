## Context

llame has no way to group chats. A chat has a single `owner_user_id` (text → `users`; NextAuth-convention text id) with `FORCE` RLS (`chats_owner`, `chats_public_read`) and messages inherit that via `messages_owner`. The org-unit tree (#44) is governance, not a personal workspace.

This change adds the **projects foundation**: a terminal, user-owned chat group. It is the first slice of an eventual GitHub-repo-style model (user- or org-owned, with invited members), split so the foundation carries **no cross-tenant risk** and the sharing change gets its own focused review.

Owner direction (verbatim intent, informing what the follow-up must support): *"Other users may be invited to both other users' projects and org-owned projects, and in future, when we add org-owned projects, they should inherit memberships of their org unit."* The foundation must not foreclose that; it does not implement it.

## Goals / Non-Goals

**Goals:**

- A `projects` entity in its **own table** (not an `org_unit_type`): terminal, user-owned.
- `chat.project_id` (0-or-1); filing/unfiling; project delete unfiles (never destroys) chats.
- Owner-only visibility, enforced in the datastore, with **no new cross-user access path** and no `BYPASSRLS` machinery.
- A shape that lets the follow-up add membership + sharing (and later org-ownership + inheritance) without reshaping what ships here.

**Non-Goals (all deferred to named follow-ups):**

- Membership, invitation, `project_role`, and cross-user read-sharing of a project's chats — the **next change**.
- Org-unit ownership (`owner_org_unit_id`) and org-roster inheritance.
- A project's knowledge / connectors / skills / artifacts.
- The `memberships → org_unit_memberships` rename (separate, independent change).

## Decisions

### D1. Projects are their own table, not `org_unit_type = 'project'`

A project is terminal (no path, no children), is **user-ownable** (org units are always unit-parented), and will get a **different, smaller role vocabulary** when membership lands. Forcing it through `org_units` would drag in the materialized-path machinery it never uses and make user-ownership a special case in a table built for unit nesting. Separate table.

- *Alternative rejected:* reuse `org_units` with `type='project'` — what the current `org_unit_type` `project` value anticipated; it couples a flat, user-ownable workspace to path-inheritance. That enum value becomes dead and is dropped in a follow-up.

### D2. Single user owner now; org arm is a later additive migration

```
projects(
  id          uuid pk default random,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,          -- required, not unique
  created_at, updated_at
)
```

`owner_user_id` is `text` to match `users.id`. This mirrors the deliberate `chats` decision (chats.ts:23-24: single owner in v0.1, org arm "additive, not a retrofit") — shipping a nullable `owner_org_unit_id` + a two-arm CHECK now would be an always-null column and a CHECK that is really just `NOT NULL`. When org-ownership lands it is an additive migration (drop `owner_user_id` NOT NULL, add `owner_org_unit_id` + exactly-one CHECK).

- *Alternatives rejected:* (a) two-FK + CHECK now — dead column, no reader; (b) `owner_type`/`owner_id` stringly pair — loses FKs and RLS-friendliness. No `settings` jsonb yet — nothing reads it (unlike `org_units`, whose config resolver does); add when a reader exists.

### D3. `chats.project_id` — 0-or-1, `ON DELETE SET NULL`

```
chats.project_id uuid NULL REFERENCES projects(id) ON DELETE SET NULL
+ index on (project_id)
```

A chat is in at most one project (a folder, not a tag; a join table buys nothing here). Deleting a project unfiles its chats rather than cascading conversation history away. Filing is a field on `PATCH /chats/:id` (`projectId`), not an RPC verb, per the resource-design convention.

### D4. RLS — owner-only, no recursion, no `BYPASSRLS`

```
projects_select        USING  owner_user_id = current_setting('app.current_user_id', true)
projects_insert        WITH CHECK owner_user_id = current_setting(...)
projects_update/delete USING  owner_user_id = current_setting(...)
```

Same shape as `chats_owner`; a single row-local column comparison, no cross-table scan, no cycle. `FORCE ROW LEVEL SECURITY` is hand-appended in the migration (Drizzle can't emit it), like `0004`/`0011`/`0018`/`0019`.

`chats`/`messages` read policies are **untouched**. The only new chat-write consideration is filing: setting `chats.project_id = P` must require the caller own `P`. Since a caller can only `UPDATE` a chat they own (`chats_owner`) and can only reference a project they can see (`projects_select` = owner-only), RLS already scopes filing to within-owner; the filing `withCheck` restates "target project is one I own" as `project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE owner_user_id = current_user)`. **No `chats.owner = projects.owner` CHECK column** — that would block a future editor filing their chat into a shared project.

### D5. What the follow-up (membership + sharing) will do — carried here so it inherits the analysis

When membership lands, project↔membership visibility becomes the **same `42P17` recursion class** as org-units: `projects.select` must scan `project_memberships` (a member sees their project), so any `project_memberships` policy scanning `projects` back closes the cycle. The proven break is a `SECURITY DEFINER`/`BYPASSRLS` sibling helper `llame_project_role(project_id, roles[])`, provisioned like `llame_role_on_unit_path` (migration `CREATE FUNCTION` + grant; `docker/postgres/rls-function-owner.sql` reassigns owner to `app_rls`). The helper is needed for **only two** policies (co-member roster SELECT; membership-management writes); the additive `chats_project_member`/`messages_project_member` SELECT policies and chat-filing withCheck stay on non-recursive own-membership-row scans. That change ships the negative isolation tests (non-member denied a shared chat *and* its messages; member-of-A denied B; unfiled stays owner-only). **None of that ships in this foundation** — it is recorded so the next change starts from the right design, not from scratch.

## Risks / Trade-offs

- **[Later org-ownership touches `owner_user_id` nullability]** → accepted; it is a bounded additive migration (drop NOT NULL, add column + CHECK), cheaper overall than shipping a dead column now (chats set this precedent).
- **[Filing could be a vector to widen chat reads]** → it isn't: no read policy changes; filing only sets a column, gated to projects the caller owns. A negative test pins that a filed chat's readership is unchanged and `relforcerowsecurity` stays true on `projects`.
- **[Deleting a user who owns projects]** → `owner_user_id … ON DELETE CASCADE` deletes their projects (which unfile, not delete, chats via `chat.project_id ON DELETE SET NULL`), consistent with `chats.owner_user_id … ON DELETE CASCADE`.

## Migration Plan

1. Schema (drizzle-kit, next migration after `0021`): `projects` table; `chats.project_id` (+ index). Hand-append `FORCE ROW LEVEL SECURITY` for `projects` and the owner-only policies per convention; `drizzle-kit check` passes.
2. API: `projects` module + DTOs + response types; chat filing on `PATCH /chats`; regenerate `openapi.json`.
3. Web: personal Projects surface (create/list/open) + sidebar grouping; thin API client.
4. Verify: `pnpm --filter api build/test/typecheck/lint`; `bash apps/api/scripts/rls-test.sh` (unique port) incl. the filing-widens-nothing negative case.
5. Docs: CHANGELOG; note follow-ups (membership + sharing; org-ownership + inheritance; drop `project` from `org_unit_type`; the rename change).

## Open Questions

_All resolved in the grill:_ folders-only slice (no membership/sharing); `owner_user_id NOT NULL` only (no org arm yet); nothing membership-related ships; chat 0-or-1; project-delete unfiles; filing RLS-scoped with no same-owner CHECK; no `settings` column; `name` required, not unique. Sidebar-grouping visuals and whether a dedicated `/projects` page vs sidebar-only management are implementation-time decisions per DESIGN.md.

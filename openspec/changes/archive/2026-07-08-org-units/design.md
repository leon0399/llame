# Design: org-units — production-grade nested org units & memberships

## Context

The #44 slice on `stack/split-identity` implements: `org_units` (id-based materialized path), `memberships`, `external_identities` — all FORCE-RLS'd with recursion-safe policies; pure path/role helpers with unit tests; `IdentityService` with single-tx owner bootstrap; a partial HTTP surface (create root/child, list visible, grant `admin|member`); 13 RLS integration tests (the CHANGELOG's 12-test #44 commit plus its immediate review-fix commit's owner-mint backstop test).

Two structural constraints shaped it and now bound this design:

1. **RLS recursion**: `org_units` policies scan `memberships`, so `memberships` policies must not scan `org_units` (Postgres rejects the cycle, 42P17). This is why the roster, revoke, and role-change are missing — they all need "caller is member/admin on the unit's path" *inside a memberships policy*.
2. **FORCE RLS**: table owner is subject to policies too (required: single-role self-hosted deployments). Consequence: plain `SECURITY DEFINER` does **not** escape RLS here; an escape hatch needs `BYPASSRLS`.

Known defects (see proposal): path-integrity race (`createChild` vs `move`), orphanable orgs (last owner leaves), immutable ownership (owner mintable only at bootstrap), half-finished HTTP surface, no web UI.

## Goals / Non-Goals

**Goals:**

- DB-enforced tree invariants; `createChild`/`move` race closed.
- Ownerless-org impossibility extended from creation-time to whole lifecycle.
- Ownership transferable; co-owners possible; escalation still impossible for non-owners.
- Complete, RESTful membership + org-unit lifecycle over HTTP with honest error semantics.
- Roster visibility without weakening cross-tenant isolation.
- Minimal, DESIGN.md-conformant web management UI.

**Non-Goals:**

- Invitations/consent flow (#159 — grant remains instance-internal, admin-initiated; SPEC note added; #159 lands before any hosted/multi-org-of-strangers deployment).
- Policy engine, deny rules, decision/audit logging (#45); config resolution (#46).
- `service_account` semantics (#160, settled with #45); HTTP surface for external identities (no consumer until channels, v0.9 — DB behavior spec'd now, surface later).
- Instance scope: admin bootstrap, registration policy, and gating root-org creation (#158). **Seam**: `POST /org-units` root creation stays "any authenticated" here; #158's `root_org_creation` setting will gate it at the service layer — keep the guard in `IdentityService.createRootOrg`, not baked into RLS, so #158 can wrap it without a policy migration.
- Member *search/autocomplete* across the instance (needs a users directory decision; grant takes an exact user id for now).

## Decisions

### D1. Path integrity: deferred constraint trigger + row locks

- **Invariant (DB-enforced)**: `parent_id IS NULL → path = id::text`; else `path = parent.path || '/' || id`.
- **Mechanism**: `CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE ON org_units DEFERRABLE INITIALLY DEFERRED` — deferred to commit because `move()` legitimately passes through intermediate states (path rewrite and `parent_id` update are separate statements; descendants are rewritten row-by-row).
- **Trigger's read of the parent row vs RLS**: add a narrow permissive policy `USING (pg_trigger_depth() > 0)` on `org_units` (and `memberships`, for D2/D3) so trigger bodies can read what they must. Contained: only schema-controlled trigger code executes at depth > 0. Rejected alternatives: `BYPASSRLS` trigger-function owner (heavier provisioning, needed anyway for D4 — but keep the trigger independent of it), row-local checks only (can't detect a stale prefix after a parent moved).
- **Race closure (locking)**: structural writes serialize on the **tree root** (first segment of the materialized path), lock-then-read. `createChild` locks the root of the parent's tree `FOR UPDATE`, *then* reads the parent path it derives from; `move` locks the old tree root and — for cross-tree moves, which `PATCH parentId` makes reachable — the destination tree root too, in id order (deadlock avoidance), then re-reads the unit's current path under the lock (never trusting a caller-supplied path, which can be stale by call time). Move-to-root needs only the old root's lock. Rationale: parent-row/subtree-root locking is insufficient — a child created under a *descendant* of a moving subtree can commit after the move's bulk-UPDATE snapshot is fixed, invisible to the rewrite and consistent in its own snapshot, i.e. silent corruption with no trigger firing. A shared per-tree lock point makes the loser's first read happen after the winner's commit. Org-structure ops are rare and admin-initiated; whole-tree serialization is cheap. The deferred trigger remains the backstop, not the primary defense.
- **Error surfacing**: trigger raises with `ERRCODE '23514'` (check_violation); service maps to 409 with a "concurrent reorganization, retry" message.

### D2. Last-owner protection: trigger + service guard

- `BEFORE UPDATE OR DELETE ON memberships` when `OLD.role = 'owner'`: if the unit is a **root** (`parent_id IS NULL`), still exists, and no *other* `owner` membership remains on it → raise. Non-root units don't need local owners (inheritance covers them). Unit-cascade deletes pass (unit row already gone → allow).
- **User deletion**: `memberships.user_id` cascades on user delete; the trigger therefore **blocks deleting a user who is the last owner of any root org**. Deliberate: the UX for account deletion must say "transfer ownership of or delete these organizations first". Rejected: silently orphaning or auto-promoting someone (surprising, wrong for a governance primitive).
- Service layer pre-checks for friendly 409s; the trigger is the invariant.

### D3. Ownership transfer & co-owners: owner-tier grant branch

- New third branch in `memberships_insert` / relaxed `memberships_update` WITH CHECK: a granter holding **`owner` on the unit's path** may grant/set any role **including `owner`**. The existing backstop stays for everyone else (admins still cannot mint owner — that was the actual threat; an ancestor *owner* already dominates the subtree, so letting them mint owner adds no new power).
- Transfer = grant `owner` to the other user (+ optional self-demote/leave; D2 prevents orphaning). Co-owners = just don't demote. **No special RPC endpoint** — this is the plain grant/role-change surface with RLS deciding (RESTful per `apps/api` conventions).
- DTO widens: grantable/settable roles = full SPEC §7.3 set **minus `service_account`**; `owner` permitted in the DTO but only succeeds for owner-tier callers (RLS 42501 → 403 otherwise).

### D4. Roster & admin membership ops: BYPASSRLS helper functions

- **Problem**: "caller is member/admin on the unit's path" inside `memberships` policies ⇒ recursion (constraint 1); FORCE blocks `SECURITY DEFINER`-as-owner (constraint 2); self-referencing policies also recurse.
- **Decision**: provision a dedicated `app_rls` role with `BYPASSRLS` (in `docker/postgres/initdb/`, next to the existing app-role script) owning one `SECURITY DEFINER STABLE` function: `llame_role_on_unit_path(unit_id uuid, roles org_role[]) → boolean` (reads `org_units.path`, checks the caller's memberships along it; caller = `current_setting('app.current_user_id', true)`; fails closed on NULL/empty).
- Policies then become expressible without recursion:
  - `memberships_select`: own rows **OR** `llame_role_on_unit_path(org_unit_id, ANY_ROLE)` → **any member on the path sees the unit's roster** (GitHub-org model; per-unit privacy is #45 policy territory).
  - `memberships_update` / `delete`: rewritten on the same function (replaces the hand-rolled `adminOnMembershipUnit()` SQL and the duplicated role literals).
  - Enables `DELETE`/`PATCH` of other members' rows (previously impossible: Postgres applies the SELECT policy to UPDATE/DELETE targets, and own-rows hid them).
- **Portability risk**: `CREATE ROLE … BYPASSRLS` needs superuser. Self-hosted (compose/initdb — our primary target) is fine. Managed PG without superuser: documented fallback is a service-context privileged connection used only by roster/admin methods after app-layer authz (weaker defense-in-depth, explicitly logged as such). Do not silently degrade — deployment doc states the requirement.

### D5. Org-unit lifecycle surface (RESTful, code-first OpenAPI)

| Endpoint | Semantics | Guard (RLS) |
| --- | --- | --- |
| `GET /api/v1/org-units` | visible units, path-ordered | member-on-path or creator |
| `POST /api/v1/org-units` | create root (+ bootstrap owner) | any authenticated |
| `POST /api/v1/org-units/:id/children` | create child | admin-tier on path |
| `GET /api/v1/org-units/:id` | fetch one | visibility |
| `PATCH /api/v1/org-units/:id` | `{name?}` rename; `{settings?}` node settings (stored opaque; #46 interprets); `{parentId?}` **move** (null promotes to root) | admin-tier on old **and** new path (RLS USING + WITH CHECK) |
| `DELETE /api/v1/org-units/:id` | delete (childless only — FK `RESTRICT`, leaf-first) | owner on path |
| `GET /api/v1/org-units/:id/memberships` | roster | member on path |
| `POST /api/v1/org-units/:id/memberships` | grant (all roles except `service_account`) | admin-tier; `owner` needs owner-tier (D3) |
| `PATCH /api/v1/org-units/:id/memberships/:userId` | change role | admin-tier; to-`owner` needs owner-tier |
| `DELETE /api/v1/org-units/:id/memberships/:userId` | revoke / leave (self) | self or admin-tier; D2 may 409 |
| `GET /api/v1/org-units/:id/memberships/me` | effective role (nearest-wins, `via`, `inherited`) | visibility |

Move-into-own-subtree stays a service-level 422 (existing repo check). Every endpoint: DTO + explicit response type + OpenAPI annotations (repo convention).

### D6. Web UI (`org-admin-ui`)

- Routes: an **Organizations** section in settings — list + create; per-org page with **unit tree** (indent by `path` depth; create child / rename / move / delete via row actions) and **members panel** per selected unit (roster with role badges + `inherited` marker, grant form, role select, revoke).
- Thin client discipline: TanStack Query over the new endpoints; no local authz logic — the UI renders what the API returns and maps errors: 403 → "you need admin/owner here", 409 (last-owner) → "transfer ownership first", 409 (duplicate) → "already a member", 409 (concurrent move) → "tree changed, refreshed".
- Destructive ops (delete unit, revoke member, grant/demote owner) get confirm dialogs naming the consequence. Empty states per DESIGN.md ("No organizations yet — create one to share projects and chats").
- Deliberately no drag-and-drop tree, no user autocomplete (non-goal), no billing/settings panes.

## Risks / Trade-offs

- **[BYPASSRLS provisioning fails on managed PG]** → documented requirement + named fallback (D4); primary deployment (self-hosted compose) unaffected.
- **[`pg_trigger_depth() > 0` policy widens reads inside any future trigger]** → acceptable: triggers are schema-owned code, reviewed like migrations; noted in schema comments.
- **[Deferred trigger errors surface at COMMIT]** → mapped SQLSTATE → 409 + retry guidance; locking makes the trigger a near-dead backstop.
- **[Owner-tier ancestors can now mint owner on descendants]** → deliberate scope change; they already dominate the subtree; admins remain blocked (original threat).
- **[Blocking user deletion for last owners]** → correct for governance, adds friction to account deletion; UX must enumerate the blocking orgs.
- **[Roster visible to all members]** → family/team-right default; enterprise privacy needs #45 policies; revisit there.
- **[Lock contention on hot subtrees]** → org-structure ops are rare, admin-initiated; acceptable.

## Migration Plan

1. One `drizzle-kit` migration for policy changes; hand-append (documented exception pattern, like 0004/0011/0018): `FORCE RLS` notes, the two trigger functions + constraint trigger, the `pg_trigger_depth` policies.
2. `docker/postgres/initdb/` gains the `app_rls` role + helper-function provisioning; `scripts/rls-test.sh` provisions the same for its throwaway DB.
3. Data backfill: none (invariants already hold for rows created by the current code path; migration asserts this with a `DO` block check rather than assuming).
4. Rollback: forward-only (repo convention); the triggers/policies are additive and can be dropped by a follow-up migration if needed.

## Open Questions

- None blocking. Two deferred decisions are named non-goals with owners: invitations (SPEC note, pre-hosted-deployment), roster privacy (#45).

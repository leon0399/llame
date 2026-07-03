# Org & membership admin HTTP surface (#44 consumer)

## Objective

llame's #1 differentiator — multi-user governance (nested org units, memberships,
roles) — is fully built at the service + FORCE-RLS layer but has ZERO HTTP surface;
an operator can't create an org, add a member, or manage roles except by
hand-editing rows. `IdentityService`'s own doc says it "ships with no reachable
surface until the admin API slice." This is that slice — the roadmap's stated
"Now" and the biggest well-integration gap. Fenced TIGHT to stay safe + one
iteration: NO new RLS, NO migration, NO SECURITY DEFINER (all tables/policies
already exist; the recursion-prone member ROSTER is a deliberate follow-up).

## Design

New `IdentityController` (`/api/v1/org-units`), all owner-scoped by `@CurrentUser`
+ the existing FORCE-RLS policies (defense-in-depth); DTOs + explicit response
types per convention.

- `POST /org-units` `{ name, type? }` → `createRootOrg` (creator becomes owner in
  one tx). 201 `OrgUnitResponse`.
- `POST /org-units/:id/children` `{ name, type? }` → `createChildOrg` (RLS:
  owner/admin on an ancestor). 201.
- `GET /org-units` → the caller's visible units (`org_units_select` RLS =
  member-on-path OR creator). New `OrgUnitsRepository.listVisible()` + a
  `listOrgUnits(userId)` service method.
- `POST /org-units/:id/memberships` `{ userId, role }` → `grantMembership`. **Role
  DTO enum = { admin, member } only** — `owner` is assigned solely at creation, so
  the API can't mint or escalate to owner (the safe sidestep of the owner-tier RLS
  gap). `grant` is INSERT-only, so re-granting an existing member conflicts → map
  the unique violation (23505) to **409** (role changes are a deferred update
  flow, not a silent demote). RLS `memberships_insert` already requires the
  granter be owner/admin on the target's path. 204.
- `DELETE /org-units/:id/memberships/:userId` → `revokeMembership`. RLS
  `memberships_delete` = admin-on-path OR self. **Owner-guard:** the repo delete
  gains `AND role <> 'owner'` — an admin (or the owner themselves) can't revoke an
  owner membership and orphan the unit. (We can't READ the target's role first —
  own-rows `memberships_select` hides it — so the guard lives in the DELETE
  predicate.) 204 (idempotent: 0 rows deleted still 204 — no existence oracle).

Wire `IdentityController` into `IdentityModule` + `app.module`.

## Testability

- Unit: DTO validation — the grant role enum rejects `owner`/`viewer`/etc.
- RLS integration (harness): create root org → creator is owner + it appears in
  their `GET /org-units`; an owner/admin grants a `member`; a **non-admin cannot
  grant** (RLS insert denies); revoke removes a member; **revoke does NOT remove an
  owner** (owner-guard); a **cross-tenant** admin of org A cannot grant into / list
  org B (RLS); re-grant to an existing member → 409.

## Non-goals (named)

- Member ROSTER (`GET /org-units/:id/memberships`) — reading OTHER members needs a
  `memberships_select` change that would recurse (`roleInPath` scans memberships);
  the SECURITY DEFINER `is_org_admin(...)` fix is a dedicated follow-up. Membership
  role UPDATE (demote/promote) — a separate guarded flow. Owner grant/transfer +
  last-owner recovery. Rename / subtree move / delete of org units (the repo has
  `move`/`rename` but they're subtree-path-rewriting — defer). Invitations / add-
  by-email (no user-existence oracle). Instance-admin bootstrap policy (#45).

## Revision history

- **v2 (2026-07-03):** Round-1 review verified all 5 security claims (owner-
  escalation closed by the DTO enum, cross-tenant isolation, 409, response egress)
  — no P0; fixed its P1 (`CreateOrgUnitDto.type` needed `@IsOptional()`, else
  omitting type 400s) + mapped a garbage `userId` FK violation (23503) → 404.
  **SCOPE CUT — revoke DEFERRED:** the integration harness proved that an admin
  removing ANOTHER member's row fails — Postgres applies the SELECT policy to a
  DELETE's target rows, and own-rows `memberships_select` hides other members'
  rows, so the DELETE matches nothing (self-leave works via the `user_id=self`
  arm, but that's not the valuable capability). Admin-revoke is therefore COUPLED
  to the member roster: both need the same recursion-safe SECURITY DEFINER member-
  visibility change. Shipped this iteration: create root/child org + list my orgs
  + grant (all tested + passing). Revoke + roster + role-update = the coherent
  member-visibility follow-up.
- **v1 (2026-07-03):** Initial.

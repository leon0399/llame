# Tasks: org-units

## 1. DB invariants & RLS groundwork (D1, D2, D4 provisioning)

- [x] 1.1 Provision `app_rls` BYPASSRLS role + `llame_role_on_unit_path(unit_id, roles[])` SECURITY DEFINER function in `docker/postgres/initdb/` and in `scripts/rls-test.sh`'s throwaway DB setup; document the deployment requirement (+ managed-PG fallback) in `apps/api/AGENTS.md`
- [x] 1.2 Migration: `pg_trigger_depth() > 0` permissive read policies on `org_units` and `memberships` (hand-appended SQL, documented exception pattern)
- [x] 1.3 Migration: deferred constraint trigger enforcing the path/parent invariant on `org_units` (raise `23514`); `DO`-block assertion that existing rows already satisfy it
- [x] 1.4 Migration: last-owner trigger on `memberships` (BEFORE UPDATE/DELETE, root units only, unit-cascade passes)
- [x] 1.5 Repository locking: `createChild` and `move` lock the TREE ROOT `FOR UPDATE` (lock-then-read; cross-tree moves lock both roots in id order) — the lock target design.md D1 originally specified (subtree-root/parent row) didn't close the race for a child created under a strict descendant of the moved subtree; updated per team-lead decision and design.md D1's revision; service maps `23514` → 409 with retry guidance
- [x] 1.6 RLS/unit tests: direct-SQL path corruption rejected; concurrent move+createChild serializes on the tree-root lock (two-session test); last owner cannot leave/demote/be-deleted; co-owner can leave; unit-delete cascade passes

## 2. Ownership & membership policies (D3, D4)

- [x] 2.1 Migration: owner-tier grant branch in `memberships_insert`/`memberships_update` WITH CHECK (owner-on-path may grant/set `owner`; admins still blocked)
- [x] 2.2 Migration: rewrite `memberships_select`/`update`/`delete` policies on `llame_role_on_unit_path` (roster = any member on path; admin ops on other members' rows now possible); drop the now-redundant `adminOnMembershipUnit` SQL
- [x] 2.3 RLS tests: admin still cannot mint owner (API + direct SQL); owner mints co-owner; roster visible to member, invisible cross-tenant; admin revokes/changes another member's row; fail-closed unscoped

## 3. Service & HTTP surface (D5)

- [x] 3.0 ~~Carry-over~~ F4 from phase-1 review, completed in phase 1 (not deferred): lock-then-verify loop in `findByIdInLockedTree` (re-lock if the tree root changed between read and lock); `move()` re-reads `newParent` under the held locks and derives `newPrefix`/the own-subtree guard from the re-read, never the caller-supplied row. Landed in the same commit as F1–F3.
- [ ] 3.1 Service methods: `getOrgUnit`, `renameOrgUnit`, `moveOrgUnit` (incl. to-root), `deleteOrgUnit`, `listMemberships`, `changeMembershipRole`, `revokeMembership`, `resolveRole` exposure — all inside `runAs`, SQLSTATE→HTTP mapping extended (last-owner 409, integrity 409)
- [ ] 3.2 Controller + DTOs: `GET /org-units/:id`, `PATCH /org-units/:id` (rename/move/settings), `DELETE /org-units/:id`, `GET/POST /:id/memberships` (grant roles widened to all but `service_account`), `PATCH/DELETE /:id/memberships/:userId`, `GET /:id/memberships/me`; OpenAPI annotations + regenerate `openapi.json`
- [ ] 3.3 Integration tests (supertest): every endpoint's happy path + 403/404/409 semantics per spec scenarios; move-into-own-subtree 422
- [ ] 3.4 Run `scripts/rls-test.sh` and full api test suite green

## 4. Web admin UI (D6)

- [ ] 4.1 API hooks (TanStack Query) for the new endpoints in `apps/web`
- [ ] 4.2 Organizations section: tree list per DESIGN.md, empty state, create root/child, rename, move (parent picker), delete with confirmation
- [ ] 4.3 Members panel: roster with role badges + inherited marker, grant form, role change, revoke/leave, "my role here"; domain-error copy (last-owner, duplicate, concurrent-move refetch)
- [ ] 4.4 E2E: create org → child → grant → change role → leave → last-owner blocked (worker-scoped auth fixture; destructive paths on `freshAccount`)

## 5. Docs & hygiene

- [ ] 5.1 Update SPEC.md §7 notes: invitation-less grant semantics named as a deliberate v0.3 decision; ownership-transfer model documented
- [ ] 5.2 Update #44 issue body to the implemented design (no materialized `inherited_from_id`); check off its acceptance criteria; close #140 as superseded by this change (link the D4 rationale — SECURITY DEFINER alone doesn't clear FORCE RLS)
- [ ] 5.3 CHANGELOG.md entry in the shipping PR; ROADMAP.md untouched (#45/#46 remain)
- [ ] 5.4 `apps/api/AGENTS.md` gotchas: new hand-finished migration documented alongside 0004/0011/0018

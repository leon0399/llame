# Proposal: org-units — production-grade nested org units, memberships & governance surface

## Why

The identity/org-units slice (#44, SPEC §6.1/§7.1–§7.3) exists on `stack/split-identity` and is well-engineered where it's finished — FORCE RLS with recursion-safe policies, id-based materialized paths, single-transaction owner bootstrap, 13 RLS integration tests. But it ships with deliberate deferrals whose rationales have expired or were mis-filed, leaving structural gaps that make it not yet production-grade:

1. **No DB-level path invariant** — `path = parent.path || '/' || id` is app-computed only; a concurrent `move` + `createChild` race silently corrupts the tree, and RLS cannot catch it. The deferral rationale ("no HTTP surface yet") is stale: the HTTP surface exists.
2. **Orgs can be orphaned** — the last owner can self-revoke or be deleted, leaving a permanently unadministrable org.
3. **Ownership is immutable by construction** — the owner-mint backstop has no controlled carve-out, so co-owners and ownership transfer are impossible; the bootstrap creator is owner forever.
4. **The admin surface is half a surface** — you can grant but never see who's a member (no roster), never revoke another member, never change a role, never move/rename/delete a unit over HTTP. Only `admin|member` of the seven SPEC roles are grantable.
5. **No user-facing UX** — `apps/web` has no way to see or manage orgs at all.

This change completes the feature: specs the model as it should be (capturing what exists, fixing what's broken, finishing what's missing), so #45 (RBAC/deny policies) and #46 (config resolver) build on trustworthy foundations.

## What Changes

- **DB integrity for the org tree**: deferred constraint trigger enforcing the path/parent invariant at commit; row-level locking (`FOR UPDATE` on parent / subtree root) serializing `createChild` vs `move`.
- **Last-owner protection**: DB trigger + service-layer guard — the last `owner` membership on a root unit cannot be revoked, demoted, or cascade-deleted.
- **Ownership transfer / co-owners**: controlled third branch in the membership policies — an `owner` *on the unit itself* (not an ancestor) may grant/set `owner`; combined with last-owner protection this enables transfer and co-owners without reopening the ancestor-escalation hole.
- **Member roster + full membership lifecycle**: recursion-safe member visibility (SECURITY DEFINER function or dedicated policy path), `GET` roster, `DELETE` revoke, `PATCH` role change; grantable roles extended to the full SPEC §7.3 set minus `owner` (owner only via the transfer path) and `service_account` (not interactive; deferred to connectors work).
- **Complete org-unit lifecycle over HTTP**: `GET /org-units/:id`, `PATCH` (rename), `POST /org-units/:id/move`, `DELETE` (owner-only, leaf-first), effective-role lookup for the caller.
- **Web admin UX** (`apps/web`): org list/switcher, unit tree with create/rename/move/delete, members panel with grant/revoke/role change, personal "my role here" affordance; error semantics (403 vs 404 vs 409) surfaced honestly per DESIGN.md.
- **Issue hygiene**: #44's body updated to the implemented design (no materialized `inherited_from_id`; read-time resolution).
- Explicitly **not** in this change: invitations/consent flow (#159), instance-admin bootstrap & registration policy incl. gating root-org creation (#158 — must land before #45), `service_account` re-modeling as a principal kind (#160, settled with #45), audit log of grants (belongs to #45's decision-logging).

## Capabilities

### New Capabilities

- `org-units`: the nested org-unit tree — creation (root/child), visibility, rename, move, delete; materialized-path invariants and their DB-level enforcement; concurrency guarantees.
- `org-memberships`: memberships and roles — grant/revoke/role change, roster visibility, effective-role resolution (nearest-wins, reporting-only), owner bootstrap, last-owner protection, ownership transfer, RLS isolation guarantees.
- `external-identities`: canonical (provider, external_subject) → user mapping — linking/unlinking, own-rows visibility (captures the already-implemented behavior as spec).
- `org-admin-ui`: web-app management surface for orgs, units, and members.

### Modified Capabilities

<!-- none — openspec/specs/ is empty; this is the first spec set -->

## Impact

- `apps/api/src/db/schema/identity.ts` — policy additions (owner-on-unit branch), no table shape changes expected.
- New hand-finished migration (constraint triggers + `FORCE RLS` note, same pattern as 0004/0011/0018).
- `apps/api/src/identity/*` — repository locking, service methods (move/rename/delete/revoke/role-change/transfer/roster), controller endpoints + DTOs, OpenAPI regeneration.
- `apps/api/scripts/rls-test.sh` — new negative tests join the suite.
- `apps/web` — new org-management routes/components (thin client over the new endpoints), TanStack Query wiring.
- GitHub: #44 body correction; closes #140 (roster + admin revoke — note its `SECURITY DEFINER is_org_admin` sketch is insufficient under FORCE RLS; D4's BYPASSRLS helper is the working shape); #45/#46 unblocked on a hardened base; #158/#159/#160 sequenced after.
- Security surface: memberships/roles are tenant-isolation critical — every new write path ships with a cross-tenant negative test (project security invariant).

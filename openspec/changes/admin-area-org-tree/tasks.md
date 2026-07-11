## 1. API: drop `'project'` from `org_unit_type` + read enrichment

- [ ] 1.1 Migration: recreate `org_unit_type` without `'project'` (new enum → `UPDATE … SET type = 'group' WHERE type = 'project'` → alter column → drop old type), in one transaction. Follow the repo migration convention (drizzle-kit generate; document any hand-appended SQL in the AGENTS.md exceptions list, both sites). Update the stale "projects become richer in v0.5" comment in `apps/api/src/db/schema/identity.ts`.
- [ ] 1.2 Drop `'project'` from `ORG_UNIT_TYPES`/`OrgUnitType` (api) and the web `OrgUnitType`; `CreateOrgUnitDto` rejects it by construction. Test: create with `type: 'project'` → 400.
- [ ] 1.3 Add `memberCount: number` + `directRole: OrgRole | null` to `OrgUnitResponse` (`apps/api/src/identity/dto/identity.dto.ts`) and the mapper.
- [ ] 1.4 Enrich the unit list query in `IdentityService` with one aggregate `COUNT(memberships) GROUP BY unit` + a left-join to the caller's own membership row — no per-unit round trips; visibility unchanged (existing `org_units_select` rules).
- [ ] 1.5 Tests: list returns count + caller's `directRole`; a unit invisible to the caller is absent (no count/role leaked); descendant `directRole` is null when the role is only on an ancestor; stray project-row conversion (migration test or RLS-suite fixture). Extend RLS integration coverage. Regenerate `apps/api/openapi.json` via build.

## 2. Web: Administration area shell + IA relocation

- [ ] 2.0 Extract the app shell (`SidebarProvider` + `AppSidebar` incl. user menu) out of `app/(chat)/layout.tsx` into a shared location, leaving the chat providers/header/second-rails in the `(chat)` layout; behavior of the chat surface unchanged (pin with existing tests where present).
- [ ] 2.1 New `app/(admin)/admin/` route group + layout composing the shared shell (no chat providers/header) with the design's section-nav second rail: Organizations built; Users & accounts / Model providers / Connectors / Policies / Audit log as visible "soon"-chip placeholders (disabled-not-hidden).
- [ ] 2.2 "Administration" entry: primary-rail nav item (desktop-only; disabled with tooltip on mobile, Projects pattern) + user-menu entry.
- [ ] 2.3 "Soon"-chip parity: the primary sidebar's existing disabled placeholders (Dashboard, Gallery, Calendar, Email, Brain) gain the same visible "soon" chip (replacing tooltip-only affordance; keep the tooltip).
- [ ] 2.4 Redirect `/settings/organizations` (and deep links) → `/admin/organizations`; delete the settings sub-page and remove the Organizations card from personal `/settings`.
- [ ] 2.5 Port `org-unit-dialogs` + `api-error-message` into the admin area (port, don't rewrite where they still fit). Park `members-panel` + `role-picker` unwired under the admin components dir with a pointer comment to the fast-follow change.

## 3. Web: org-unit tree redesign

- [ ] 3.1 Tree rows with connector guide lines (bar/blank/elbow/tee), per-node expand/collapse chevron, type icon per unit type (organization/group/team/department), name, member count, and the caller's direct role badge (owner distinct; full 7-role vocabulary incl. `service_account`); path ordering; collapse/expand-all; first-run empty state.
- [ ] 3.2 Inherited-role display: walk the client-side path to the nearest ancestor with a `directRole`; mark inherited distinctly from direct (no per-node server call).
- [ ] 3.3 Selected-unit footer: breadcrumb path + the caller's effective role (direct/inherited) + the design's **disabled** "Manage members" placeholder (fast-follow wires it).
- [ ] 3.4 Hover row actions: add-child, rename, move, delete — delete disabled on a non-leaf ("has children" computed over the full unit list).

## 4. Web: pre-emptive invariant UX + dialogs

- [ ] 4.1 Delete on a non-leaf → a "delete leaf-first" explanation dialog (no request sent); leaf delete → confirmation naming the unit + memberships removed.
- [ ] 4.2 Move picker excludes the unit and all descendants; offers "make root"; candidates shown with hierarchy visible.
- [ ] 4.3 Create-root and create-child dialogs (child dialog offers the 3-type segment: group/team/department); rename dialog. Server 403 handled honestly via `api-error-message`; domain-error copy (duplicate / concurrent-reorg) unchanged where it still has a surface.

## 5. Gating seam + design-system pass

- [ ] 5.1 Create-root affordance structured to bind an instance-level `root_org_creation` signal when it exists (#158); until then it is simply available (today's policy allows every user), no fabricated client admin check.
- [ ] 5.2 Design-system review (DESIGN.md §10): neutral-ink connector hairlines, token-only type icons/selection, no new hue, no colored active bar.

## 6. Verification + docs

- [ ] 6.1 `pnpm --filter api build`/`test`/`typecheck`/`lint`; `pnpm --filter web test`/`typecheck`/`lint`; `bash apps/api/scripts/rls-test.sh` (unique port) covering enrichment visibility + the enum migration.
- [ ] 6.2 Browser e2e (or component tests): tree renders with guides/counts/roles; leaf-first delete blocked; move picker excludes subtree; `/settings/organizations` redirects; Administration entry present (desktop) / disabled (mobile).
- [ ] 6.3 CHANGELOG entry incl. the **accepted temporary regression** (members management API-only until the fast-follow) and the enum drop. Note follow-ups: members-panel re-home (fast-follow, next); #158 gating; the five stub sections; project sharing / org-owned projects (projects capability). `openspec validate admin-area-org-tree` clean.

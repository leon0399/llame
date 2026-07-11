## Context

`#44` shipped the org-unit/membership data model, RLS, and HTTP surface (`identity.controller.ts`), plus a first web admin UI at `apps/web/app/(chat)/settings/organizations/` (`org-tree`, `members-panel`, `org-unit-dialogs`, `role-picker`, `api-error-message`). That UI is a settings sub-page with flat indentation. The [Admin.dc.html design](https://claude.ai/design/p/9b8618ce-8b93-4e02-81dd-4c5e9e166841?file=Admin.dc.html) moves administration to a dedicated area and makes the tree real.

Since the original draft of this proposal, **projects shipped as their own entity** (`projects` table, PR #174): user-owned, terminal, holding chats — not org_units. Project sharing (`project_memberships`) and org-owned projects are separate sequenced follow-ups of that capability and touch nothing here.

This proposal was handed off as a UI/IA-only brief (`proposals/org-admin-restructure.md`). It was **analyzed, not accepted blind** — the corrections below drive the design.

## Corrections to the source brief (verified against the codebase)

1. **Not UI-only.** The design surfaces a member count and the caller's role on every node — and the brief's own "membership at a glance" scenario mandates it — but `OrgUnitResponse` returns only `{id, parentId, name, type, path, settings, createdAt}`. Rendering it needs `memberCount` + `directRole` on the list response: a read enrichment over the existing `memberships` table (one added `COUNT`/`GROUP BY` and the caller's own membership row; inherited role derived client-side from the path). Additionally, this change carries **one real migration** — the `org_unit_type` recreate (D5).
2. **Gating is a seam, not wired — and no denial exists today.** The brief gates the admin area on "SPEC #158 (`root_org_creation`)". That mechanism **does not exist** (no spec, no code). Moreover, `org_units_insert` deliberately lets **any** authenticated user create a root unit (self-hosted bootstrap), so a "denial is surfaced honestly today" scenario is vacuous — there is nothing to deny. The seam is specified as: create-root is structured so the #158 signal gates it when it lands; until then it is simply available, and any *other* server 403 (child-create etc.) is handled honestly. Never a fabricated client-only admin check.
3. **Projects are OUT — and the vestigial enum value goes with them.** Projects are their own entity now (see Context). The earlier draft kept `'project'` in `org_unit_type` and filtered such rows out of the tree — rejected: `CreateOrgUnitDto` still accepted `'project'`, so a raw API call could mint a project-typed unit the tree then *hides*, making its parent look like a deletable leaf and breaking the pre-emptive leaf-first UX with an invisible child. Owner decision: **drop the value** (D5). The tree renders everything it lists; nothing is filtered.

## Goals / Non-Goals

**Goals:**

- A dedicated `/admin` area with its own shell/section-nav, org-tree as the only built section; entry via a dedicated bottom-of-rail group above the user profile (desktop-only; no user-menu entry).
- A real tree matching the design: guides, chevrons, type icons, counts, role badges, hover actions, selected-unit footer, and the create/child/rename/move/delete dialogs.
- Pre-emptive leaf-first delete and move-picker-excludes-subtree UX (mirroring server invariants, not reimplementing authz).
- The minimal read enrichment (`memberCount` + `directRole`) that the per-node design requires.
- Drop `'project'` from `org_unit_type` (migration; strays → `'group'`; DTO + web types).
- "Soon"-chip parity: admin-nav stubs and the primary sidebar's disabled placeholders share the same visible chip.

**Non-Goals:**

- The members panel (deferred to the fast-follow — D7): this change ships the footer's **disabled** "Manage members" placeholder only.
- Building the Users/Providers/Connectors/Policies/Audit sections (visible "soon" placeholders only).
- The `#158` instance-admin gating mechanism itself.
- Project sharing / org-owned projects (separate projects-capability follow-ups).
- Any new org endpoint.

## Decisions

### D1. `/admin` is its own route group composing a shared app shell (owner decision)

The admin area is **its own space**, not a `(chat)` sub-route: a new route group (`app/(admin)/admin/…`) with its own layout. The design still shows the primary rail (`AppShell active="admin"`), so the shell — `SidebarProvider` + `AppSidebar` (rail + user menu) — is **extracted out of the `(chat)` layout** into a shared location, and both groups compose it. The admin layout carries **none** of the chat-specific machinery (`ChatProvider`, `ActiveRunsProvider`, command palette, `ChatHeader`, second-rail chat/project sidebars); it renders the shared shell + the design's `adm-aside` section nav + main region. The primary rail gains an "Administration" entry rendered as its own group at the bottom of the rail, directly above the user-profile block (per AppShell.dc.html — not among the main nav items; desktop-only, disabled on mobile with a tooltip, per the disabled-not-hidden convention). The user/profile menu gets NO entry. `/settings/organizations` becomes a redirect to `/admin/organizations` (deep links preserved) and the settings sub-page is removed.

Flagged follow-up (owner: "arguably `/settings` as well") — relocating personal `/settings` into its own group atop the same shared shell is a natural continuation, **out of scope here**; the shell extraction this change performs is exactly the enabler it needs.

### D2. Tree affordances are presentation over the existing list data + the two new fields

The tree (guides/chevrons/type icons/counts/role badges/hover actions) is built from the unit list plus `memberCount`/`directRole`. Expand/collapse and collapse-all are client state. Inherited-role display walks the client-side path (nearest ancestor with a `directRole`), exactly as the design's `effectiveRole` does — no server call per node. The role badge maps the **full 7-role vocabulary** (incl. `service_account`, which the design mock omitted).

### D3. Read enrichment: `memberCount` + `directRole` on the unit list

`OrgUnitResponse` gains `memberCount: number` and `directRole: OrgRole | null`. The list query adds a `COUNT` of membership rows per unit and a left-join to the caller's own membership row. Visibility is unchanged — the same units the caller can already see under the **existing** `org_units_select` policy (role-on-path **or** the `created_by` bootstrap edge). Note the bootstrap edge: a creator without a membership row sees the unit but not its roster under `memberships_select`, so their `memberCount` may read 0 in that transient state — acceptable (the service grants the owner row in the same transaction; the state is unobservable through the product flow). Belongs to `org-memberships` (it is membership-derived read data) even though it rides the org-unit list response.

### D4. Pre-emptive invariants, not client authz

Two UX pre-checks mirror server invariants that are _structural facts the client already knows_, not authorization: "has children" (→ leaf-first delete explanation, delete disabled on non-leaf) and "is in my subtree" (→ excluded from move targets). Neither is an authz decision (those stay server-side, 403 handled honestly). With D5, "has children" is computed over the full, unfiltered unit list — nothing invisible can falsify it.

### D5. Drop `'project'` from `org_unit_type` (type-recreate migration)

Postgres cannot remove an enum value in place, so the migration recreates the type: create the new enum (`organization|group|team|department`), `UPDATE org_units SET type = 'group' WHERE type = 'project'` (stray-row conversion — realistically zero rows exist; the product UI never offered a type picker), alter the column to the new type, drop the old. `ORG_UNIT_TYPES`/`CreateOrgUnitDto` (api) and `OrgUnitType` (web) drop the value; the stale "projects become richer in v0.5" schema comment is updated. Follows the repo migration convention (drizzle-kit generate; hand-appended SQL documented in the exceptions list if drizzle-kit cannot express the recreate).

### D6. Design-system conformance

Connectors are neutral-ink hairlines (`color-mix(in oklab, var(--foreground) 20%, transparent)` per the design), type icons and selection use tokens, no new hue, no colored active bar — passes DESIGN.md §10.

### D7. Members panel deferred; temporary API-only window (accepted regression)

The selected-unit footer ships the design's disabled "Manage members" button. The old settings page — the panel's only host — is deleted, so grant/revoke/role-change has **no UI** until the sequenced fast-follow re-homes the existing panel into the admin area. Explicitly accepted by the owner; noted in the CHANGELOG entry. The `members-panel` + `role-picker` components are parked unwired under the admin area (with a pointer comment) so the fast-follow is a re-wire, not a rebuild. The org-admin-ui delta marks the Members panel requirement REMOVED; the fast-follow re-adds it.

## Risks / Trade-offs

- **[Enrichment N+1 if done naively]** → one aggregate query (`COUNT ... GROUP BY unit` + caller-membership left join), not per-unit round trips. The roster RLS already scopes membership-row visibility, so no extra auth surface.
- **[Gating seam misread as "gated now"]** → spec explicitly says the signal doesn't exist yet and forbids a fabricated client check; create-root is open to all by policy design until #158.
- **[Relocation breaks deep links]** → `/settings/organizations` redirect preserves them; covered by a scenario.
- **[Members management dark window]** → accepted (D7); bounded by sequencing the fast-follow immediately after; API remains fully functional and tested.
- **[Enum recreate under concurrent writes]** → the migration runs in a transaction; `ALTER TYPE`-recreate takes an exclusive lock on the column — table is small (org structure), lock window negligible.

## Migration Plan

1. API: `org_unit_type` recreate migration (D5) + DTO/web type updates; add `memberCount` + `directRole` to `OrgUnitResponse` and the list query; regenerate `openapi.json`; unit + RLS tests.
2. Web: extract the app shell from the `(chat)` layout; new `app/(admin)/admin/` route group + layout + section nav; Administration bottom-of-rail entry; `/settings/organizations` redirect; rebuild the tree to the design; port `org-unit-dialogs`/`api-error-message`; park `members-panel`/`role-picker` unwired.
3. Pre-emptive delete/move UX; empty state; selected-unit footer (breadcrumb + effective role + disabled "Manage members").
4. "Soon" chips: admin stubs + primary-sidebar placeholders.
5. Design-system review pass (§10).
6. Docs: CHANGELOG (incl. the accepted members-UI regression + fast-follow pointer); ROADMAP untouched (fast-follow gets its own change).

## Resolved Questions

1. **Projects:** their own entity, shipped (#174); out of this tree; `'project'` enum value dropped here (owner decisions).
2. **Route + label:** `/admin` + "Administration", Instance framing kept (owner decision — the area grows into instance admin; the pre-#158 tension is temporary).
3. **`directRole` placement:** on `OrgUnitResponse` — the design renders count+role together; one call.
4. **Entry point:** own group at the bottom of the rail, above the user profile, per AppShell.dc.html; no user-menu entry (owner correction of an earlier mis-framed option).
5. **Members panel:** deferred to fast-follow; footer button disabled (owner decision, regression accepted).

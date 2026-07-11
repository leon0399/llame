## Why

Instance administration currently lives inside personal settings (`/settings/organizations`) and renders the org-unit hierarchy as flat `padding-left` indentation. Two problems: **(1) actor/mental-model collision** — `/settings` is a person configuring themselves (appearance, account); administering organizations, members, and (soon) providers/policies is a different actor and a different surface. **(2) the tree isn't a tree** — no connectors, no expand/collapse, no node-type distinction, and the structural invariants the server already enforces (leaf-first deletion, no-move-into-own-subtree, nearest-wins inherited roles) are invisible to the user until a 4xx.

The [Admin.dc.html design](https://claude.ai/design/p/9b8618ce-8b93-4e02-81dd-4c5e9e166841?file=Admin.dc.html) resolves both: a dedicated Administration area with its own section nav, and a real tree (connector guides, per-node chevrons, type icons, member counts, role badges, hover actions, a selected-unit footer, and pre-emptive delete/move affordances).

## What Changes

- **Relocate** org administration out of personal `/settings` into a dedicated **Administration area** (`/admin`) with its own left-nav section list (Organizations built; Users & accounts, Model providers, Connectors, Policies, Audit log as visible "soon" placeholders per the design), reachable from **both** a primary-rail nav item (desktop-only, disabled on mobile with a tooltip, like Projects) and a user-menu entry. The old `/settings/organizations` route redirects (deep links preserved).
- **Redesign the org-unit tree** per the design: connector guide lines, per-node expand/collapse, type icon per unit type (`organization`/`group`/`team`/`department`), member count and the caller's **direct** role (distinct from inherited), path ordering, create-root, and the first-run empty state.
- **Drop the vestigial `'project'` value from `org_unit_type`** (owner decision, folded in here): projects shipped as their **own entity** (`projects` table, #174) — user-owned, terminal, holding chats — so the enum value is dead vocabulary that only creates traps (a raw API call could still mint a project-*typed org unit* the product has no concept for). Postgres cannot remove an enum value in place, so this is a type-recreate migration; any stray `project`-typed rows are converted to `'group'`; `CreateOrgUnitDto` and the web `OrgUnitType` drop the value. The tree is then governance-only **by construction** — no filter, nothing hidden.
- **Surface two structural invariants pre-emptively** (no client-side authz re-implementation; server 403 still handled honestly): delete on a non-leaf is _explained_, not attempted (leaf-first); the move picker _excludes_ the unit and its whole subtree and offers "make root".
- **Enrich the org-unit list response** with `memberCount` and the caller's `directRole` per unit — the minimum the design's per-node badges/counts require (the current `OrgUnitResponse` has neither). Inherited role is derived client-side from the path. `memberCount`/`directRole` need **no schema change** — a `COUNT` over the existing `memberships` table and the caller's own membership row.
- **Members panel is NOT rehomed in this change** (owner decision): the selected-unit footer ships the design's **disabled** "Manage members" placeholder, the old settings page (the panel's only current host) is deleted, and grant/revoke/role-change is temporarily **API-only**. A sequenced **fast-follow change** re-homes the existing panel into the admin area. This is an accepted, explicitly-noted temporary feature regression (see CHANGELOG task).
- **"Soon"-chip parity in the primary sidebar**: the existing disabled placeholder nav items (Dashboard, Gallery, Calendar, Email, Brain) gain a visible "soon" chip matching the admin section nav's, instead of tooltip-only.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `org-admin-ui`: relocation to a dedicated admin area (+ redirect + rail/user-menu entry + instance-gating seam), real tree affordances with per-node membership at a glance, and pre-emptive leaf-first / move-subtree UX. The **Members panel requirement is REMOVED** (temporarily — the fast-follow re-adds it in the admin area); domain-error-copy requirements are unchanged where they still have a surface (unit management).
- `org-memberships`: the org-unit **read** surface gains `memberCount` + the caller's `directRole` per unit on the list/tree response (read-only enrichment; no new membership semantics, no datastore change).
- `org-units`: the unit type vocabulary drops `'project'` (type-recreate migration; strays → `'group'`; DTO/web types updated). No other org-unit semantics change.

## Impact

- **Web**: `/admin` as its **own route group** (`app/(admin)/admin/…`) with its own layout — the app shell (`SidebarProvider` + `AppSidebar`) is extracted from the `(chat)` layout into a shared location so both groups compose it, and the admin layout carries none of the chat providers/header; admin section nav as its second rail; org-tree component rebuilt to the design; old `/settings/organizations` → redirect and the settings page removed; Administration rail item (desktop-only) + user-menu entry; "soon" chips in the primary sidebar. (Relocating personal `/settings` onto the same shared shell is a flagged follow-up, out of scope.) The existing `members-panel` + `role-picker` components are **parked unwired** under the admin area for the fast-follow; `org-unit-dialogs` and `api-error-message` are ported and stay live.
- **API**: `OrgUnitResponse` (and the list query in `IdentityService`) gains `memberCount` + `directRole`; `CreateOrgUnitDto` no longer accepts `'project'`. One migration: recreate `org_unit_type` without `'project'`, converting stray rows to `'group'`.
- **Design system**: tree connectors, type icons, and selection states use DESIGN.md tokens only (neutral-ink hairlines; no new hue, no colored active bar) — passes the §10 review gate.
- **Corrections to the source brief** (analyzed, not accepted blind): (a) _not_ UI-only — the per-node count/role the design mandates need the list-response enrichment above, and the enum drop is a real migration; (b) the instance-admin **gating is a seam, not wired** — the `#158` admin-bootstrap / `root_org_creation` mechanism does not exist yet, and today **every** authenticated user may create a root unit by policy design, so no pre-#158 denial exists to surface; (c) the "projects-as-org-units follow-up" is obsolete — projects shipped as their own entity (#174).
- **Temporary regression (accepted)**: members management has no UI between this change and the members-panel fast-follow; it remains fully available via the existing API.
- **Out of scope / follow-ups**: the members-panel re-home (fast-follow, sequenced next); building the Users/Providers/Connectors/Policies/Audit admin sections; the `#158` instance-admin gating mechanism itself; project **sharing** (`project_memberships`) and org-owned projects — separate, already-designed follow-ups of the projects capability.

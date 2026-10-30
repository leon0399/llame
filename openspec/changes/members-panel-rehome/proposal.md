## Why

Issue #180 tracks a temporary regression. The `admin-area-org-tree` change (#176)
deleted the settings page that hosted the members panel, so granting,
changing, and revoking org memberships, leaving a unit, and transferring the
last ownership have been API-only since 2026-07-11. Leo accepted that window as
a regression, to be ended by the next change (archived
[design D7](../archive/2026-07-12-admin-area-org-tree/design.md), the
[REMOVED "Members panel" block](../archive/2026-07-12-admin-area-org-tree/specs/org-admin-ui/spec.md),
and the 2026-07-11 `CHANGELOG.md` entry). The panel, its confirmation dialogs,
and the role picker are parked unwired under
`apps/web/app/(admin)/admin/components/parked/`. The selected-unit footer's
"Manage members" button is a disabled placeholder, and the org-units browser
e2e had its members flow removed. The promise is repeated in the three parked
files, `members-panel.test.tsx`, `org-tree.tsx`'s `ManageMembersButton` and its
disabled-button test, the Organizations `page.tsx` comment, and the
`e2e/web/org-units/org-units.spec.ts` header.

## What Changes

- The selected-unit footer's **Manage members** control is live. It opens and
  closes a members panel for the selected unit, rendered directly below the
  footer in the Organizations section. Selecting a unit never requests its
  roster. Moving the selection to another unit closes the panel, so a
  half-typed grant never carries over to a different unit.
- The panel lists the unit's direct members with a role control and a Revoke
  action per row (Leave on the caller's own row), and offers a grant form (user
  id and role). Granting or setting `owner`, revoking, and leaving each ask for
  confirmation that names the consequence. This is the parked panel, wired
  in rather than rebuilt.
- A failed roster load shows its classified error with a Retry control.
  Today's parked panel ignores the error and leaves the roster blank. Rows
  also wait for the caller's identity: the parked panel offers Revoke on the
  caller's own row while `GET /auth/v1/me` is pending or has failed.
- Role changes and revokes appear in the roster only after the server confirms
  them. Today's parked hooks update the roster optimistically, so a denied
  revoke briefly shows the member gone. Every membership write also refreshes
  the tree, so a node's member count, direct-role badge, and the footer's role
  follow the change.
- A denied ownership-affecting write (granting or setting `owner`, changing or
  revoking an owner) names `owner` as the role the API requires. Today every
  membership 403 says "admin or owner", which misleads an admin who tried to
  mint an owner.
- The panel does not repeat the caller's role. The footer already shows it
  (direct, or inherited from its source unit), so the panel's own role line and
  its separate `…/memberships/me` request are removed.
- The org-units browser e2e gets its members flow back, in its own delivery
  layer: grant to a second account, duplicate grant, role change, blocked
  last-owner leave, ownership transfer, then leave. The leaver created the
  organization, so it stays in their tree with an empty roster afterwards.
- The parked components move into `organizations/components/`. The parked
  directory and every "fast-follow"/"parked" pointer are removed.

## Assumptions (for confirmation on review)

- The panel sits in the page below the selected-unit footer, as #180's
  "selected-unit slot" wording asks, not in a modal or side sheet (design D1).
- Members are still identified by user id. The API has no user directory or
  lookup, and the roster response carries only `userId`, as the parked panel
  did before #176. Adding names or emails would be an API and tenancy change.
- The panel offers every control to every caller who can open it and lets the
  API decide, as the "Unit management actions" requirement already does for
  unit actions. The caller's displayed role cannot gate controls: it is
  nearest-wins reporting, while the datastore grants additively along the path
  (`org-memberships` "Nearest-wins effective-role resolution").
- Demoting an owner applies at once, without a confirmation, as in the parked
  panel; only granting or setting `owner`, revoking, and leaving confirm
  first. A failed demotion shows its error in the member's row. Treating a
  demotion as "ownership-affecting" under the "Unit management actions"
  confirmation rule would add one more confirmation and is Leo's call.
- A root's creator can grant themselves `owner` again at any time, even after
  transferring ownership and leaving, and then revoke the new owner
  (`memberships_insert` branch (a), migrations `0018`/`0019`; design
  Threats). This change adds no capability, but the panel makes that request
  a form away for a departed creator. Whether that right is intended is Leo's
  decision: if it is, `org-memberships` "Owner bootstrap" should say so; if
  not, an RLS fix needs its own issue before `panel` lands.
- The implementation layer starts after #1222 and #1223 (the #860 org-tree and
  members-panel story moves) merge, because they replace the jsdom tests this
  change extends with the stories it builds on (design D7).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `org-admin-ui`: re-adds members management as six requirements (the panel
  opening from the footer, the roster, granting, role change and departures,
  denial copy, and authority staying with the API), and modifies the
  "Organizations overview" footer scenario so Manage members is live instead
  of a disabled placeholder.

## Impact

- Web: `apps/web/app/(admin)/admin/organizations/components/` (`org-tree.tsx`,
  the moved `members-panel.tsx`, `member-confirm-dialogs.tsx`,
  `role-picker.tsx`, and their stories), `organizations/page.tsx`, and
  `apps/web/lib/services/org-units/` (`mutations.ts`, `errors.ts`,
  `queries.ts`, and their tests).
- E2E: `e2e/web/org-units/org-units.spec.ts`.
- API: none. Every endpoint, RLS policy, and last-owner trigger the panel uses
  already ships and is covered by the `org-memberships` and `org-units` specs.
- Docs: a dated `CHANGELOG.md` entry; the `org-admin-ui` Purpose sentence that
  calls the panel withdrawn is rewritten at finalize.
- Related: proposal #1255 (`org-tree-keyboard-navigation`) modifies the same
  footer scenario. Whichever change syncs specs second re-copies the canonical
  block with the other's edit (design D8).

## Non-Goals

- A user directory, user search, or display names and emails in the roster.
- Showing members inherited from ancestor units in a unit's roster.
- `service_account` grants or role changes (the API rejects them).
- Mobile support: the Administration area stays desktop-only.
- Any API, RLS, or migration change.
- Instance-level gating (#158).

## Acceptance

- Manage members on the selected-unit footer opens a members panel for that
  unit; the disabled placeholder is gone.
- From the panel a user can grant, change a role, revoke, leave, and transfer
  ownership, with confirmation for owner grants, revokes, and leaves.
- The last owner of a root organization cannot leave from the panel, and is
  told to transfer ownership first.
- An admin who tries to mint, demote, or revoke an owner is told only an owner
  can do that, and the roster does not change.
- After a membership change, the tree's member count and the footer's role
  reflect it without a reload.
- A failed roster load shows the error and a working Retry, not a blank list.
- The org-units browser e2e covers grant, duplicate grant, role change, the
  blocked last-owner leave, ownership transfer, and leave.
- No `parked/` directory or fast-follow pointer remains.

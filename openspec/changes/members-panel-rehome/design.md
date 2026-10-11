## Context

See `proposal.md` (Why). Current state, from the code at `9a958cee`:

- `OrgUnitsTree` (`apps/web/app/(admin)/admin/organizations/components/org-tree.tsx`)
  owns selection (`useOrgTreeNavigation`: `selectedId`, falling back to the
  first rendered row when the selected unit is gone), expand/collapse, the unit
  dialogs, and `OrgTreeSelectedFooter`. The footer derives the caller's
  nearest-wins role client-side from each unit's `directRole` and renders
  `ManageMembersButton`, a disabled `Button` inside a `title` span. Rows are
  `role="treeitem"` with `tabIndex={0}`.
- The parked `MembersPanel` (`components/parked/members-panel.tsx`) takes
  `orgUnitId` and `units`. It shows "Your role here" from
  `useMyEffectiveRoleQuery` (`GET …/memberships/me`), a grant form (user id,
  `RolePicker`, Grant, owner-grant confirmation), and the roster (a role
  control per row, Revoke or Leave with a confirmation that stays open on
  failure and shows `ApiErrorMessage`). It applies no local authorization.
- `apps/web/lib/services/org-units/mutations.ts`: `useGrantMembership`
  invalidates `memberships` and `myRole`. `useChangeMembershipRole` and
  `useRevokeMembership` rewrite the cached roster in `onMutate`, roll back on
  error, and invalidate `myRole` (plus `lists` for revoke). Grant and role
  change never invalidate `lists`, so the tree's `memberCount`, `directRole`
  badge, and footer role stay stale after them.
- `errors.ts` maps every 403 to "You need admin or owner access on this unit
  (or an ancestor) to do that." The API's 403 bodies carry no code. RLS
  `WITH CHECK` failures surface as SQLSTATE `42501`, which cannot tell an
  admin-tier failure from an owner-tier one. The controller's OpenAPI text for
  grant does say "owner-tier for role owner".
- `useMyEffectiveRoleQuery` and `orgUnitsQueryKeys.myRole` have no consumer
  outside the parked panel and their own tests.
- Open PRs on these files: #1222 moves `org-tree.test.tsx` into
  `org-tree.stories.tsx`; #1223 (on #1222) moves `members-panel.test.tsx` into
  `parked/members-panel.stories.tsx`, driving the real hooks through
  `stubFetch`. Proposal #1255 (`org-tree-keyboard-navigation`) makes the tree
  one roving Tab stop where focus moving to a row selects it (its D1), and
  modifies the same footer scenario.
- Installed: `@base-ui/react` 1.6.0 (`Collapsible`; `AlertDialog`'s
  `finalFocus`), `@tanstack/react-query` ^5.81.5, React ^19.2.7. oxlint
  `max-lines` is 500 non-blank, non-comment lines per file.

## Goals / Non-Goals

**Goals:**

- Re-wire the parked panel with the smallest changes that make it correct in
  its new home: bound to one selected unit, refreshing the tree, server-confirmed,
  and honest about which role a denial needs.
- Keep tree selection free of requests, so #1255's selection-follows-focus
  premise holds whichever change lands first.
- Restore the members-flow e2e the #176 header says was removed.

**Non-Goals:**

- Any API, RLS, or OpenAPI change; a user directory; inherited members in the
  roster; a new `@workspace/ui` primitive.

## Decisions

### D1. The panel is an in-page disclosure after the footer

`OrgUnitsTree` wraps the footer and the panel in the existing
`@workspace/ui` `Collapsible`. "Manage members" becomes its
`CollapsibleTrigger` (a `Button`, so it gets `aria-expanded` and
`aria-controls`), and the `CollapsibleContent` renders `MembersPanel` right
after the tree card's footer. DOM order is then rows → footer control →
panel, which gives the Tab order the spec asks for without `tabIndex` tricks.
The `title` span that explained the disabled state is deleted.

Alternatives: a modal `Dialog` or a `Sheet`. Rejected: #180 asks for the
selected-unit slot. A modal hides the tree, which is the context for
"inherited from", and it would stack the owner, revoke, and leave
`AlertDialog`s on top of another modal.

### D2. The panel belongs to one unit and closes when the selection moves

The tree keeps `membersOpenFor: string | null`, the id the panel was opened
for. The panel renders only while it equals the selected unit's id. Every
selection change sets `membersOpenFor` back to `null`, and so does the unit
leaving the list after a refetch. Returning to the unit, or arrowing over it
under #1255, therefore never reopens the panel or sends a roster request; only
"Manage members" does. Because `MembersPanel` mounts only when open,
`useMembershipsQuery` runs only then. Selecting units sends no membership
request, and closing the panel unmounts the grant form, which discards a
typed user id.

Alternatives: (a) The panel follows the selection. Rejected: under #1255
every arrow press would fetch a roster, and a typed user id plus role would
carry over to whatever unit the arrow lands on, which is a wrong-unit grant
waiting to happen. (b) The panel stays pinned to its unit while the selection
moves. Rejected: the footer and the panel would name different units.

### D3. Membership writes are server-confirmed and refresh the tree

`useChangeMembershipRole` and `useRevokeMembership` drop `onMutate`, their
rollback, and the two shared helpers (`cancelAndSnapshotMemberships`,
`rollbackMemberships`). All three membership hooks invalidate `memberships`
for the unit and `lists` on success. `changeRole` and `revoke` also
invalidate `memberships` on settle, as they do today. The role picker keeps
its `disabled={changeRole.isPending}`, and revoke and leave already wait in
their confirmations. Optimism bought nothing visible and cost honesty: a
denied revoke briefly showed the member gone. The revoke confirmation is
also rendered inside the row it removes, so an optimistic removal can unmount
the dialog meant to show the denial. The #1223 story
`LeaveBlockedAsLastOwner` passes today, so this is a structural hazard removed
rather than an observed failure [INFERENCE].

Two ordering rules keep the server-confirmed flow from flickering or
unmounting too early:

- After a confirmed role change, `useChangeMembershipRole` writes the PATCH
  response (`MembershipResponse`) into the cached roster with
  `setQueryData`, then invalidates. The picker shows the new role at once
  instead of the old one while the refetch is in flight.
- `useRevokeMembership` does not await its invalidations (`void`, as today).
  The confirmation's own `onSuccess` closes it first. The refetch that then
  drops the row would otherwise unmount the dialog before it closed.

Alternative: keep optimism and move the dialogs out of the rows. Rejected:
that is more code, and it still flashes authority the caller may lack.

### D4. Denial copy is picked from the write that was denied

The API cannot say which tier failed (Context), so the web picks the copy
from what it sent. A write is owner-tier when it grants or sets `owner`, or
when it targets a row whose current role is `owner`, which the panel reads
from the roster it rendered. The membership mutation inputs gain
`ownerTier: boolean`. `withOrgUnitsErrors` takes the forbidden message for
that write, and `classifyOrgUnitsError` keeps the existing admin-or-owner copy
as the default. This is copy selection after the server's 403, not local
authorization: no control is hidden or disabled because of it.

Accepted limitation: the target's role comes from the cached roster. If
another user made the target an owner after the roster loaded, an admin's
denied write shows the admin-or-owner copy instead of the owner-only copy.
The denied write's settle invalidation then refetches the roster, which
shows the target as owner, so the panel ends up reflecting the server.
Re-reading the roster before choosing the copy was rejected: it adds a
request to every denial to fix the wording of a rare race, and it changes no
outcome.

Alternative: an API error code for owner-tier denials. Rejected: the RLS
check fails with one SQLSTATE for both tiers, so the API would need its own
pre-check, which is an API and authorization change with no new safety.

### D5. The footer is the only display of the caller's role

The panel's "Your role here" line, `myRoleDescription`, the `viaUnit` lookup,
`useMyEffectiveRoleQuery`, `fetchMyEffectiveRole`, `orgUnitsQueryKeys.myRole`,
and every `myRole` invalidation are deleted, with their tests. So are the
imports in `queries.ts` that only they used (`getMyOrgUnitEffectiveRole`,
`getApiErrorStatus`, `classifyOrgUnitsError`, and the `EffectiveRoleResponse`
type), and the `EffectiveRoleResponse` alias in `types.ts`, which then has no
consumer. `classifyOrgUnitsError` stays exported from `errors.ts`, where
`withOrgUnitsErrors` uses it. The footer shows the same nearest-wins role,
direct or "inherited from" its source unit, and D3's `lists` invalidation
keeps it current. That leaves one source instead of two that could disagree
for a render. `GET …/memberships/me` stays in the API, since it is the API's
contract and is covered there.

Alternative: keep the panel's own role line. Rejected: it repeats the footer
right above it, and it costs a second request per opening.

### D6. Files move out of `parked/`

`git mv` `members-panel.tsx`, `member-confirm-dialogs.tsx`, `role-picker.tsx`,
and `members-panel.stories.tsx` (from #1223) into
`organizations/components/`, so review sees renames. The `parked/` directory
and every PARKED and fast-follow comment go, and so does the D7 note in
`organizations/page.tsx`; the `e2e` layer rewrites the e2e spec's D7 header. If
`org-tree.tsx` would pass the 500-line `max-lines` cap, `OrgTreeSelectedFooter`
and the disclosure move into `org-tree-selected-footer.tsx`.

### D7. Delivery follows #1222 and #1223 instead of stacking on them

The implementation layers are created from this proposal after both #1222
and PR #1223 merge to `master` and the proposal is rebased onto that `master`
with `$gh-stack`. Those PRs replace the jsdom tests this change must extend:
`org-tree.test.tsx` becomes `org-tree.stories.tsx`, and
`parked/members-panel.test.tsx` becomes `parked/members-panel.stories.tsx`,
which D6 moves. Stacking on them would put a feature
layer inside the #860 test-migration stack, tie this change's merge to
theirs, and force a replay of each of their review fixes. Following their
merge costs only waiting, and the layer then extends the stories they add
rather than jsdom tests they delete. If they are still open when this
proposal is approved, implementation waits on them as a native blocker.

### D8. Relationship to #1255 (org-tree keyboard navigation)

The two changes are independent, and either can land first.

- Spec: both modify "Organizations overview", the footer scenario. #1255
  changes "clicking a row moves the selection"; this change replaces the
  placeholder clause. Whichever change runs `$openspec-sync-specs` second
  re-copies the canonical block it finds, which includes the other's edit,
  before applying its own (finalize task 4.2).
- Behavior: #1255 D1 relies on selection having no side effect. D2 keeps
  that true for requests. The only effect of a selection change is closing an
  open panel, which is UI state.
- Focus: under #1255 the Tab sequence is the selected row, its four actions,
  then "Manage members", then the open panel; today it is every row and its
  actions, then the same. A confirmation closing returns focus to its trigger
  (`AlertDialog` default). After a revoke removes that trigger's row,
  `finalFocus` targets the panel's titled region (`tabIndex={-1}`). When the
  panel's unit leaves the tree after Leave, the tree focuses the newly
  selected row. #1255's "A removed focused row hands focus to the new
  selection" covers the row case, and whichever change lands second reuses
  the other's rescue rather than adding a second one.
- Code: both edit `org-tree.tsx`. The second implementation rebases onto
  the first.

### D9. A failed roster load is shown, with a retry

The parked panel never renders `membershipsQuery.error`, so a failed roster
load ends as a blank list with no explanation. The panel renders the
classified error through the existing `ApiErrorMessage` in place of the
roster, with a Retry button that calls the query's `refetch()`. The grant
form stays available, because a grant does not depend on the roster read.

### D10. Test plan

- `members-panel.stories.tsx` (moved from #1223), with the real hooks on
  `stubFetch`, an unrouted request failing the story, and exact request
  lists and bodies asserted:
  - an admin's owner grant answered 403 shows the owner-only copy and adds no
    row;
  - an admin's revoke of an owner answered 403 keeps the dialog open with the
    owner-only copy, and the row stays;
  - a non-admin revoke of a non-owner member answered 403 shows the
    admin-or-owner copy;
  - a revoke held pending keeps the row until the DELETE resolves, and the
    dialog closes before the row leaves;
  - a confirmed role change shows the PATCH response's role while the roster
    refetch is held;
  - a roster GET answered 500 shows the classified error and Retry, and
    Retry sends exactly one more roster GET;
  - write bodies are exactly `{ userId, role }` or empty;
  - a successful revoke moves focus to the panel;
  - the existing grant, duplicate, service-account, owner-confirmation, Leave,
    and last-owner stories stay. The role-line stories go with D5.
- `org-tree.stories.tsx` (from #1222):
  - Manage members opens and closes the panel and reports `aria-expanded`;
  - opening sends only that unit's roster GET;
  - selecting several units sends no membership request;
  - selecting another unit closes the panel and reopening shows an empty
    form;
  - opening on unit A, selecting B, then selecting A again sends no roster
    request after the first and leaves the panel closed;
  - a grant or own-role change refetches the unit list, and the footer role
    and member count update;
  - Leave by a non-creator, after which the refetched list omits the unit,
    closes the panel and focuses the newly selected row;
  - "A deeper low role does not hide management".
- `mutations.test.ts` and `errors.test.ts`: no optimistic writes, the
  role-change cache write from the PATCH response, `lists` invalidation on all
  three hooks, owner-tier copy selection.
- `e2e/web/org-units/org-units.spec.ts`, in its own `e2e` layer: the members
  flow restored against the real stack (second account via `registerAccount`;
  grant; member count; duplicate grant; Member to Admin; blocked last-owner
  leave; Make owner; Leave), and its D7 header rewritten. The leaver created
  the root, and `org_units_select` keeps a unit visible to its creator
  (migration `0018`), so after Leave the e2e expects the unit to stay in the
  tree with an empty roster and no role in the footer. "Leaving a unit that
  disappears from view" applies only to a non-creator, so it is proved by the
  `org-tree` story above. The admin-versus-owner denials stay in stories plus
  the API's existing RLS integration tests, because the e2e would need a
  second browser login for no new server coverage.
- Mutation proof before ready: at least two temporary user-visible mutations
  (the panel following the selection; optimistic revoke restored), each
  failing a named story, recorded verbatim in the PR body.

## Threats

- Identity comes from authentication only. The API resolves the acting user
  with `@CurrentUser()` from the session, and the panel's bodies carry only
  the target member and role (scenario "Writes carry no acting identity").
  "(you)" comes from the authenticated `GET /auth/v1/me`, never from input.
- Tenant isolation is enforced below the UI. Membership and org-unit tables
  use FORCE row-level security, and roster visibility needs a role on the
  path (`org-memberships`). The panel can only be opened for units the
  RLS-scoped list returned, and a hand-crafted request is held by the same
  RLS. This change adds no read or write surface.
- The UI must not imply authority it lacks. Writes appear only after the
  server confirms them (D3), and denials name the tier actually required
  (D4). Controls are not gated on the displayed role: that role is
  nearest-wins while authorization is additive, so gating would hide
  management from an authorized admin (scenario "A deeper low role does not
  hide management").
- Ownership transfer and departures are confirmed first, naming the
  consequence. Last-owner protection stays in the database trigger, and the
  panel only explains its 409.
- Unchanged API property: a grant answers 404 for an unknown user id, so an
  admin can test whether an id exists. User ids are opaque, and this change
  neither widens nor narrows that.

## Risks / Trade-offs

- [Arrowing the tree away closes an open panel] → Intended (D2): the panel
  belongs to one unit, and the footer control reopens it for the new one.
- [Grant by raw user id is unfriendly] → This is the shipped pre-#176
  behavior. A directory is a separate API and tenancy change (Non-Goals).
- [Spec overlap with #1255] → The second sync re-copies the canonical block
  (D8, finalize task 4.2).
- [Owner-tier copy chosen from a stale roster] → Accepted (D4): a rare race
  picks the admin-or-owner wording, and the settle refetch then shows the
  target's current role.
- [#1222 and #1223 still open at approval] → Implementation waits (D7). The
  proposal layer touches none of their files.
- [`org-tree.tsx` near `max-lines`] → Extract the footer (D6).

## Migration Plan

Web-only, with no data or API change. Deploying the `panel` layer makes
members management available in the UI again. Rolling back is reverting the
`panel` and `e2e` layers, which returns to the accepted API-only window and
loses no data.

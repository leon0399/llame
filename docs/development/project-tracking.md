# Project tracking

The [llame delivery Project](https://github.com/users/leon0399/projects/2) owns
live delivery status. Derive delivery transitions from the corresponding GitHub
PR's published draft, review, approval, merge, or closure state. Local commits,
local reviews, and unpublished branch activity do not change Project status or
advance its Next action. The agent doing the work updates the issue and relevant
PR items after each GitHub transition and verifies them before handoff.

| Status            | GitHub evidence                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog           | No published delivery PR, or a published PR explicitly marked deferred/experimental without approved scope.                                                                                                   |
| Design            | An open draft proposal PR, or a proposal PR with requested substantive changes.                                                                                                                               |
| Awaiting approval | An open, non-draft proposal PR awaiting approval of its published revision, with no outstanding change request.                                                                                               |
| Ready             | A merged proposal PR or an approved open non-draft proposal PR, with no outstanding change request and no published implementation PR. Native blockers remain in Next action and must clear before execution. |
| In progress       | An open draft implementation PR or a published implementation PR with outstanding GitHub change requests. Temporary blockers are named in Next action.                                                        |
| In review         | The implementation or other deliverable has an open non-draft PR without outstanding change requests, ready for review/merge. Proposal review uses Awaiting approval.                                         |
| Done              | The item's own delivery PR is merged. A closed, unmerged PR is recorded as cancelled or superseded in Next action; a merged proposal PR does not complete its feature issue.                                  |

Apply the explicit deferred/experimental Backlog exception before the active
phase rules. Draft state takes precedence over an earlier approval.
When an implementation PR merges without completing the issue's published
acceptance, mark that PR Done and keep the issue In progress until a later PR
transition, even if no implementation PR remains open.

`Priority` and `Order` select work independently of readiness. Keep `Workstream` and `Next action` current.
Name the missing decision, native blocker, or next concrete step, and link the evidence. Preserve intentional deferrals.
A parent issue reflects its remaining outcome, not the most advanced child or PR. Each PR tracks its own layer.
Derive the issue status from the published PRs covering its outcome. Creating or editing an unpublished layer does not change it.

Before implementation, carry forward approval of the actual revision and recheck native blockers. Do not request the same approval again.
Published substantive proposal revisions return to Design when their PR becomes draft or receives a GitHub change request.
Approval of the revised scope is required before implementation.
Reconcile legacy proposals by their approved contract, rather than reopening approval because a review record is absent.
Bug fixes and chores that skip OpenSpec follow their published PR state directly.

At each GitHub transition, fetch the PR state and current Project fields/items.
Update Status and Next action with the PR link and any changed native dependencies, then read them back.
Add missing issue/PR items with Status, Priority, Workstream, and Next action.
Do not change priority or native dependencies merely to make a status fit.
If Project access fails, report the unsynchronized transition in the handoff. Do not claim it was updated.
Keep live status in the Project rather than duplicating it in task files or issue bodies.
OpenSpec checkboxes continue to record completed tasks.

# Wayfinding on the issue tracker

A wayfinding map plans an effort too large for one agent session as a set of
decision tickets on this repository's GitHub issues. The `$wayfinder` skill
owns the method; this page owns how it maps onto GitHub here.

A map plans and decides. Delivery still follows
[CONTRIBUTING.md](../../CONTRIBUTING.md): an issue, an OpenSpec proposal, and
layered PRs. Once a map's decision feeds a proposal, the proposal is
authoritative.

## Wayfinding operations

| Operation         | How it is expressed here                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map               | One issue labelled `wayfinder:map`. Its body holds Destination, Notes, Decisions so far, Not yet specified, and Out of scope.                                                         |
| Ticket            | A sub-issue of the map: `gh issue create --parent <map>`.                                                                                                                             |
| Ticket type       | Exactly one of `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`. Maps and tickets carry no other labels and are not added to the delivery Project. |
| Blocking          | GitHub's native dependency: `gh issue edit <n> --add-blocked-by <m>`.                                                                                                                 |
| Claim             | Assign the ticket to the person driving the map before any work: `gh issue edit <n> --add-assignee @me`.                                                                              |
| Frontier          | The map's open, unassigned sub-issues with no open blocker. List them with `gh issue view <map> --json subIssues` and each candidate's `blockedBy`.                                   |
| Resolve           | Post the answer as a comment, close the ticket (`gh issue close <n> --reason completed`), and add one line to the map's Decisions so far.                                             |
| Out of scope      | Close the ticket as not planned and add one line to the map's Out of scope.                                                                                                           |
| Map documentation | Research studies, ADRs, and glossary changes go on the map's documentation branch and PR; see [Map documentation](#map-documentation).                                                |

Implementation issues a map or ticket informs are linked with GitHub's native
"relates to" relationship (the `addRelatesTo` GraphQL mutation; `gh` has no
flag for it), never as sub-issues: the map's children are its decisions only.
A body mention does not create the link.

## Map documentation

Each map has one documentation branch, `docs/<map-slug>`, with one draft PR
against `master`. Research studies (under `docs/research/<topic>/`), ADRs, and
glossary changes that a ticket produces are committed there, so a map's
written output is tracked and reviewed in one place.

The PR is merged when its contents are worth keeping on `master`: a batch of
ADRs and terms that a proposal will cite, or studies that outlive the map. It
can be merged more than once as the map advances, stay open, or close unmerged.

A ticket's resolution links a file at a commit
(`blob/<sha>/<path>`), never at a branch, so the link survives a merge, a
rebase, or deletion of the branch. GitHub keeps a PR's commits reachable after
the branch is gone.

## Maps and delivery issues

A map and a [tracker](../../CONTRIBUTING.md#hierarchy) are separate issues. The
map decides; the tracker, its features, and their cutovers deliver. A map may
span several trackers. The map's Destination names the feature issues it feeds,
and relates-to links connect the map to them and to their trackers.

| Step                           | How it is expressed here                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A ticket feeds a feature       | Its resolution names the feature. Link the ticket and the feature with relates-to.                                                                                                                     |
| The last feeding ticket closes | The same session writes or updates the feature's Spec brief, sets its Project Next action to "brief complete", and stops. Handoff stays an explicit action ([handoff](../../CONTRIBUTING.md#handoff)). |
| A decision fixes a cutover     | The brief may create the cutover sub-issue now. The spec writer confirms, renames, or merges cutovers in the proposal.                                                                                 |
| A ticket spins off other work  | Create a feature issue in Backlog, under a tracker if one fits, linked to the ticket with relates-to. The map body does not list it.                                                                   |
| The map closes                 | Every Destination feature has an approved proposal, a complete brief for work with no spec, or a recorded scope decision that removed it. Close any remaining ticket as out of scope first.            |

`$issue-handoff` holds the procedure for writing a brief and handing it off.

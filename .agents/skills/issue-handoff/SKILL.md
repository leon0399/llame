---
name: issue-handoff
description: Issue handoff in llame. Use to write an issue brief, hand an issue to a person or agent, start work from an `agent:*` trigger, or stop with `needs:human`.
---

# Issue handoff

[CONTRIBUTING.md, "Issues and handoff"](../../../CONTRIBUTING.md#issues-and-handoff) owns the policy: the hierarchy, what the body carries, trigger labels, pickup markers, and claims. [Wayfinding](../../../docs/development/wayfinding.md#maps-and-delivery-issues) owns the step from a map to a brief. Read both before any branch. This skill is the procedure.

Every branch serves one test, the **stranger test**: someone with no chat history can start the next step from the issue body and the links it gives.

## Write a brief

1. Classify the issue as a tracker, feature, or cutover, and decide whether it needs an OpenSpec change. A documented contract change needs one.
2. Fill the body from the matching template: `.github/ISSUE_TEMPLATE/feature.md` gives the Spec brief; `fix-or-chore.md` gives Acceptance.
3. Write each decision as a gist plus a link to the closed ticket or comment that holds it. The linked source stays the authority.
4. Create a cutover sub-issue only where a decision already fixes it. The spec writer settles the rest of the split.
5. Add one `type:*` and one `area:*` label, link the feeding tickets with relates-to, and set the Project Next action to "brief complete".

Done when the brief passes the stranger test and Open questions lists only what the spec writer must ask.

## Hand off

1. Check readiness against the handoff table in CONTRIBUTING.md.
2. A person hands off: assign someone, or add the `agent:*` trigger to the issue the table names.
3. An agent asked to hand off reports the readiness result, and the person adds the trigger.

Done when the issue has an assignee or a trigger, and its readiness check passed.

## Pick up

1. The automation that started you already removed the trigger.
2. Read the body, every link it gives, then the code and specs.
3. Resolve the work unit: a cutover belongs to its feature's OpenSpec change; work with no spec is its own unit.
4. Check the **claim**: a live branch, open PR, or `working:*` label with a live `llame:pickup` marker on the same unit belongs to someone else, so stop.
5. For `agent:implement` on a cutover, every earlier cutover in the change's graph is done or handed off; otherwise stop.
6. **Mark the pickup**: add the `working:*` label for your stage, assign the issue, and post the `llame:pickup` marker comment that CONTRIBUTING.md shows.
7. For `agent:spec`, grill on the open questions in your own session, write each settled decision onto the issue (body or one decision comment), then follow CONTRIBUTING.md "Proposal layer". Use issue comments for the grilling only when you have no session a person can reach.
8. For `agent:implement`, follow CONTRIBUTING.md "Implementation layers".
9. **Release** when the item waits only on a person (the release table in CONTRIBUTING.md): remove the `working:*` label and post the `llame:release` marker with outcome `handed-back` or `done`. Resuming later, for example on review feedback, starts again at step 6.

Done when the release marker is posted and the Project item matches the PRs.

## Stop

Add `needs:human` and one comment that names what is missing, the options you see, and the session to answer in. Remove your `working:*` label, post the `llame:release` marker with outcome `stopped`, then end the run. Typical causes: a brief that fails the stranger test, a spec that contradicts itself, a held claim, an earlier cutover not handed off, or a fix that changes a documented contract.

Done when the comment lets a person decide without asking you anything.

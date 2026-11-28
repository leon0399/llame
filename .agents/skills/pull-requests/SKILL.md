---
name: pull-requests
description: Pull request work in llame. Use to open or publish a PR or stack layer, write or rewrite its body, mark it ready, wait for CI and reviews, fetch or answer review-bot findings, or push and rebase a stack.
---

# Pull requests

[CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract) owns the PR contract,
[Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring), and merge
policy. This skill is the procedure. A stack layer is a PR too: its branch,
base, and push commands go through `$gh-stack`, and
[references/stacks.md](references/stacks.md) governs when and what to push, so
a fix does not re-run CI for the whole stack.

## Lifecycle

Every PR moves through these steps in order. Each step ends on its completion
criterion; a step is done only when that criterion holds on the current head.

1. **Open as draft.** Read [references/opening.md](references/opening.md).
   Done when the draft exists against the correct base and its Project item
   reads back as `In progress` (a proposal: `Design`).
2. **Write the body.** Read [references/drafting.md](references/drafting.md).
   Done when every template section is filled from the diff or deleted, and
   every ticked item was verified.
3. **Self-review and green CI.** Review the parent-relative diff against
   [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md), fix findings with new commits,
   and wait for CI with the watcher in
   [references/waiting.md](references/waiting.md). Done
   when the self-review found nothing left to fix and CI on the current head is
   terminal and green, or red only on checks that are also red on `master` and
   named in a PR comment.
4. **Mark ready.** `gh pr ready <N>`, then move the Project item to
   `In review` (a proposal: `Awaiting approval`).
5. **Monitor.** Run the watcher in [references/waiting.md](references/waiting.md)
   and answer each finding it prints with
   [references/review-bots.md](references/review-bots.md), as a skeptic. For a
   past or filtered view, use [references/fetching-reviews.md](references/fetching-reviews.md).
   Done when every exit condition in `waiting.md` holds.
6. **Hand off.** Report the head commit, CI state, and dispositions. The merge
   is Leo's decision.

A push during steps 3–5 restarts step 3 for that PR and every stack PR above
it.

## Fixed rules

- Merge only with Leo's explicit permission in this conversation.
- Keep draft state one-way: draft until step 3 is done, then ready. Review bots
  trigger on their own.
- Report a wait or a monitoring round only after it ran: name the command and
  its result. A wait ends on the watcher's output, never on a fixed sleep or
  timeout.

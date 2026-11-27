---
---

- Merge the `open-pull-request` and `fetch-pr-reviews` agent skills into one
  `pull-requests` skill. Its main file lists the PR lifecycle steps with their
  completion criteria. Reference files cover opening, writing the body,
  waiting for CI and the review floor, fetching reviews, answering review bots
  as a skeptic, and pushing stacks without re-running CI for every layer. The
  review script moved to
  `.agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs`, and a new
  `watch-pr.mjs` beside it prints each new review item, failed check, and head
  change in the same format, then exits once the PRs are settled.

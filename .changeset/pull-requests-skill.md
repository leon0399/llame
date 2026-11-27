---
---

- Merge the `open-pull-request` and `fetch-pr-reviews` agent skills into one
  `pull-requests` skill. Its main file lists the PR lifecycle steps with their
  completion criteria. Reference files cover opening, writing the body,
  waiting for CI and the review floor, fetching reviews, and answering review
  bots. The review script moved to
  `.agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs`.

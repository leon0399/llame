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
- Generalize `REVIEW_GUIDE.md` and move its module rules into the matching
  `AGENTS.md` files. CodeRabbit, Cubic, and Greptile now read the guide,
  `CODING_STANDARDS.md`, and the `AGENTS.md` on each file's path instead of
  restating rules in their own configuration; `.cubic/` is deleted.
- Shorten `CONTRIBUTING.md` to delivery policy. Issue handoff, Project
  tracking, and the feature delivery phases move to pages under
  `docs/development/`.
- Rewrite `README.md` as a short overview. Provider options, `store: false`,
  output limits, Anthropic defaults, and cache-write pricing move to a new
  [model request settings](../docs/product/operator/providers/model-settings.md)
  runbook, provider headers to
  [provider routing](../docs/product/operator/providers/routing.md#provider-headers),
  and the Postgres extension requirement to
  [scaling](../docs/product/operator/scaling.md#postgres-prerequisites).
- Root `AGENTS.md` states the prior-art rule and links the harness index
  instead of inlining it.

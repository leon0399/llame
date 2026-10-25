---
name: pr-review-fetcher
description: This skill should be used when fetching or monitoring review feedback on one or more llame pull requests — unresolved or resolved review threads, review verdicts, conversation comments, feedback since a time, from or excluding an author — during Ready-PR monitoring, before replying to and resolving threads, or when asked to "fetch reviews", "check review comments", "what did CodeRabbit/Codex/pullfrog say", or "list unresolved threads". Prints bot feedback stripped of markup, state blobs, and duplicate agent prompts to save tokens.
metadata:
  version: "1.0.0"
  scope: "llame-pr-review"
---

# Fetch pull request reviews

[`scripts/fetch-pr-reviews.mjs`](scripts/fetch-pr-reviews.mjs), next to this file, reads review threads, review verdicts, and
conversation comments through `gh api graphql`, filters them, and prints
compact text. It is read-only. Use it for step 4 of
[Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring) and for
any other review lookup instead of hand-written `gh` and GraphQL queries.

Bot comments are mostly markup: HTML comment markers and encoded state,
icons and badges, analysis transcripts, "Prompt for AI Agents" restatements,
committable-suggestion duplicates, and link bars. The script drops those and
keeps the finding, its suggested diff, and the conversation. Measured on #1418,
155,574 raw characters became about 20,000 printed. Code blocks and inline
code are never altered.

## Commands

Run from the repository root.

```bash
# Unresolved threads, verdicts, and comments of one PR (bare numbers use the current repo)
node .agents/skills/pr-review-fetcher/scripts/fetch-pr-reviews.mjs 1418

# Several PRs, only what changed in the last 20 minutes (one monitoring round)
node .agents/skills/pr-review-fetcher/scripts/fetch-pr-reviews.mjs 1409 1411 1412 --since 20m

# Only unresolved threads on current code, for the fix -> reply -> resolve loop
node .agents/skills/pr-review-fetcher/scripts/fetch-pr-reviews.mjs 1418 --kinds threads --outdated exclude

# Verdicts on the head commit only
node .agents/skills/pr-review-fetcher/scripts/fetch-pr-reviews.mjs 1418 --kinds reviews --current-head
```

|Option|Effect|
|---|---|
|`--threads unresolved\|resolved\|all`|Thread resolution (default `unresolved`)|
|`--outdated include\|exclude\|only`|Threads on code the head no longer has|
|`--kinds threads,reviews,comments`|Which collections to read; fewer kinds mean fewer API calls|
|`--since 90m\|6h\|2d\|<ISO date>`|Items created or last edited since then; a thread counts when any comment does|
|`--author`, `--exclude-author`|Comma-separated or repeated logins; `[bot]` suffixes are ignored|
|`--current-head`|Reviews submitted against the head commit|
|`--all-bots`|Keep deployment and coverage bots (Codecov, Vercel), dropped by default|
|`--raw`|Bodies as GitHub stores them, when cleaning seems to have hidden something|
|`--max-chars N`|Truncate each body|
|`--json`|Structured output; one object per PR, an array for several|
|`--stats`|Raw versus printed size on stderr|

A PR may be `123`, `#123`, `owner/repo#123`, or a pull request URL.

## Reading the output

```text
# leon0399/llame#1418 OPEN head 2a263184 — feat: project repository links
## threads 1/7
- PRRT_kwDOO_C_IM6v710b apps/web/.../project-repository-draft-row.tsx:76 [unresolved]
  @coderabbitai 2026-10-24 21:28Z
    **Minor** · **Functional Correctness** · **Quick win**
    ...
## reviews 2/17
- @pullfrog COMMENTED 2026-10-24 22:09Z on head
## comments 1/6
```

- `N/M` is selected over read, so `0/7` means nothing matches, not nothing exists.
- The `PRRT_…` id is the thread id the reply and resolve mutations take.
- `on head` marks a review of the current head commit; otherwise the
  reviewed commit is shown, and that review may be stale.
- `▸ <summary>` lines are the headings of kept `<details>` blocks, such as
  CodeRabbit's nitpick and outside-diff sections, whose findings have no thread.
- A `COMMENTED` review whose body cleans to nothing only wraps its inline
  comments and is omitted; its findings appear under threads.

## Reply and resolve

The script never writes. After a finding is verified and fixed, reply and
resolve in one call:

```bash
gh api graphql -f query='mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } }
  resolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
}' -f id=PRRT_... -f body='Fixed in <sha>: <what changed and how it was verified>.'
```

Findings in review bodies and conversation comments have no thread: answer
them with `gh pr comment <pr> --body ...`.

## Limits

- Thread comments are read 100 per thread; longer threads are truncated.
- Cleaning follows the markup of CodeRabbit, Codex, pullfrog, and Indent as
  observed in this repository. When a bot changes its format and noise slips
  through, extend `NOISE_DETAILS`, `NOISE_REGIONS`, or `BOILERPLATE_LINES` and
  add a case to [`scripts/fetch-pr-reviews.test.mjs`](scripts/fetch-pr-reviews.test.mjs).

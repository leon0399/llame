# Fetching review feedback

[`scripts/fetch-pr-reviews.mjs`](../scripts/fetch-pr-reviews.mjs) reads review
threads, review verdicts, and conversation comments through `gh api graphql`,
filters them, and prints compact text. It is read-only. Use it for every
review lookup in place of hand-written `gh` or GraphQL queries. The watcher
([waiting.md](waiting.md)) reuses its reading, cleaning, and output format and
prints only what changed; use this script for a full or filtered view.

Bot comments are mostly markup: HTML comment markers and encoded state, icons
and badges, analysis transcripts, "Prompt for AI Agents" restatements,
committable-suggestion duplicates, and link bars. The script drops those and
keeps the finding, its suggested diff, and the conversation. On #1418, 155,574
raw characters became about 20,000 printed. Code blocks and inline code are
never altered.

## Commands

Run from the repository root.

```bash
# Unresolved threads, verdicts, and comments of one PR
node .agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs 1418

# One monitoring round over several PRs: what changed in the last 5 minutes
node .agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs 1409 1411 1412 --since 5m

# Unresolved threads on current code, for the fix -> reply -> resolve loop
node .agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs 1418 --kinds threads --outdated exclude

# Verdicts on the head commit only
node .agents/skills/pull-requests/scripts/fetch-pr-reviews.mjs 1418 --kinds reviews --current-head
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

A PR is `123`, `#123`, `owner/repo#123`, or a pull request URL. For many PRs at
once, save the output to a file and take every thread id from it.

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

- `N/M` is selected over read, so `0/7` means nothing matches, not nothing
  exists.
- The `PRRT_…` id is the thread id the reply and resolve mutations take.
- `on head` marks a review of the current head commit; otherwise the reviewed
  commit is shown, and that review may be stale.
- `▸ <summary>` lines are the headings of kept `<details>` blocks, such as
  CodeRabbit's nitpick and outside-diff sections, whose findings have no
  thread.
- A `COMMENTED` review whose body cleans to nothing only wraps its inline
  comments and is omitted; its findings appear under threads.

## Limits

- Thread comments are read 100 per thread; longer threads are truncated.
- Cleaning follows the markup of the bots in
  [review-bots.md](review-bots.md#roster) as observed in this repository. When a
  bot changes its format and noise slips through, extend `NOISE_DETAILS`,
  `NOISE_REGIONS`, or `BOILERPLATE_LINES` and check the result against `--raw`.

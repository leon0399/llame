# Working with review bots

A bot finding is a claim, and usually a weak one. Read every finding as a
skeptic: assume it is wrong until the code, a spec, or a reproduction proves
it right. Bots review a diff without the repository's history, settled
decisions, or runtime; they misread control flow, invent API behaviour and
version facts, restate the PR body back as a defect, and push toward
defensive code the repository's
[coding standards](../../../../CODING_STANDARDS.md) reject. Agreement
between several bots is one claim repeated, not corroboration. Accept a
finding only on your own evidence; a bot's confidence label, severity, or
"verified" note counts for nothing.

Each finding gets a **disposition** (accepted and fixed, or rejected with
evidence) and a reply on the surface where it was raised.

## Roster

Expected reviewers are the bots that post on the PR, plus Cubic when it is
enabled. A bot that has not posted by `# settled:` and is not listed below is
unknown membership: ask Leo. Pass the expected logins to the watcher with
`--wait-for` ([waiting.md](waiting.md)).

|Bot|Login|Behaviour|
|---|---|---|
|pullfrog|`pullfrog`|Reviews each push; one summary review plus inline threads with a "Technical details" block. Re-reviews later pushes and confirms fixes. An environment failure is nonblocking.|
|Codex|`chatgpt-codex-connector`|Reviews when the PR is marked ready; inline threads labelled `[P1]`/`[P2]`. A quota failure is a skip.|
|Greptile|`greptile-apps`|A confidence-score summary comment plus `P1`/`P2` threads. It reads the body's Decisions to review and records those limits as intentional.|
|CodeRabbit|`coderabbitai`|Path filters in [`.coderabbit.yaml`](../../../../.coderabbit.yaml). Rate-limits after several pushes: a skip. Its `CHANGES_REQUESTED` stays after the fix until Leo dismisses it.|
|Cubic|`cubic-dev-ai`|Rules in [`cubic.yaml`](../../../../cubic.yaml), which links `REVIEW_GUIDE.md` and `CODING_STANDARDS.md`. May submit a real approval on a low-risk change and resolves its own threads once it judges them addressed; an approval is a signal, not a merge gate, and a thread it resolved still needs your disposition. Ultrareview runs only when triggered by hand. It has posted on none of the latest 60 PRs: when absent, record it as a skip.|
|Cursor Bugbot|`cursor`|Occasional inline findings; same rules as the others.|
|Indent|`indent`|Out of credits: a skip.|
|Codecov, Vercel|`codecov`, `vercel`|Status and deployment bots, not reviewers; their checks are CI.|

Record every skip in the handoff with its reason. Bot buttons that act on the
branch (pullfrog's "Fix all", CodeRabbit's Autofix checkbox) stay unused: the
author owns every commit.

## Disposition

For each finding:

1. **Restate** what it asserts, in one sentence of your own. If two readings
   are possible, say so in the reply.
2. **Verify** it against the code, specs, or a reproduction. Reproduce a
   claimed bug before fixing it. Check a claim about a version, an API, or a
   deprecation against the installed package or a primary source.
3. **Accept** only what the evidence proves: fix it minimally, with a test that
   fails before the fix when the finding is a bug. Several bots often report
   one defect: one fix answers all of their threads.
4. **Reject** the rest, with the evidence in the reply: the line that refutes
   it, the command that shows the behaviour, or the spec or decision that
   rules it out. A style preference with no failure mode is a rejection. A
   finding that needs Leo's product decision stays unresolved and is named in
   the handoff.

Expect most bot findings on a careful PR to be rejections. A round where every
finding was accepted is a reason to recheck the verifications, not a sign of a
thorough review.

## Reply and resolve

Commit and push first, then reply citing the pushed commit: a reply naming a
commit that never landed is a false claim. Check the push result before the
reply, never chain them blindly.

```bash
gh api graphql -f query='mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } }
  resolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
}' -f id=PRRT_... -f body='Fixed in <sha>: <what changed and how it was verified>.'
```

A rejection gets the same reply mutation without `resolveReviewThread`, unless
the evidence is conclusive. Take thread ids from the watcher or fetch output
([fetching-reviews.md](fetching-reviews.md)), never from memory. A finding in a
review body or conversation comment has no thread: answer it with
`gh pr comment <N> --body ...`. Bots re-review the new push and may open a few
new threads; the watcher prints them.

## Many PRs at once

Fetch every PR once into a file and work from it. OpenSpec proposal PRs are
independent documents: one subagent per PR, each in its own worktree.
Implementation PRs that share a working tree go one branch at a time; for a
stack, follow [stacks.md](stacks.md). After one more small pass over the
threads the re-reviews open, stop.

# Working with review bots

A bot finding is a claim. Each one gets a **disposition** (accepted and fixed,
or rejected with evidence) and a reply on the surface where it was raised.

## Roster

Expected reviewers are the bots that post on the PR. A bot that has not posted
by the end of the floor and is not listed below is unknown membership: ask Leo.

|Bot|Login|Behaviour|
|---|---|---|
|pullfrog|`pullfrog`|Reviews each push; one summary review plus inline threads with a "Technical details" block. Re-reviews later pushes and confirms fixes. An environment failure is nonblocking.|
|Codex|`chatgpt-codex-connector`|Reviews when the PR is marked ready; inline threads labelled `[P1]`/`[P2]`. A quota failure is a skip.|
|Greptile|`greptile-apps`|A confidence-score summary comment plus `P1`/`P2` threads. It reads the body's Decisions to review and records those limits as intentional.|
|CodeRabbit|`coderabbitai`|Path filters in [`.coderabbit.yaml`](../../../../.coderabbit.yaml). Rate-limits after several pushes: a skip. Its `CHANGES_REQUESTED` stays after the fix until Leo dismisses it.|
|Indent|`indent`|Out of credits: a skip.|
|Codecov, Vercel|`codecov`, `vercel`|Status and deployment bots, not reviewers; their checks are CI.|

Record every skip in the handoff with its reason. Bot buttons that act on the
branch (pullfrog's "Fix all", CodeRabbit's Autofix checkbox) stay unused: the
author owns every commit.

## Disposition

For each finding:

1. **Restate** what it asserts. If two readings are possible, say so in the
   reply.
2. **Verify** it against the code, specs, or a reproduction. A claim about a
   version, an API, or a deprecation is checked against the installed package
   or a primary source.
3. **Accept**: fix it minimally, with a test that fails before the fix when the
   finding is a bug. Several bots often report one defect: one fix answers all
   of their threads.
4. **Reject**: reply with the evidence. A finding that needs Leo's product
   decision stays unresolved and is named in the handoff.

Fix a defect in a lower stack layer on its own branch, then `gh stack rebase`
and `gh stack push`.

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

Take thread ids from the fetch output
([fetching-reviews.md](fetching-reviews.md)), never from memory. A finding in a
review body or conversation comment has no thread: answer it with
`gh pr comment <N> --body ...`. Fetch again after processing; bots re-review
the new push and may open a few new threads.

## Many PRs at once

Fetch every PR once into a file and work from it. OpenSpec proposal PRs are
independent documents: one subagent per PR, each in its own worktree.
Implementation PRs that share a working tree go one branch at a time. After one
more small pass over the threads the re-reviews open, stop.

# Waiting for CI and reviews

Two different waits, with different commands. Run each with `async: true` (or
in the background) and keep working; read the result when it arrives.

## Waiting for CI

```bash
gh pr checks <N> --repo leon0399/llame --watch --fail-fast=false
```

It exits once every check is terminal. Then list what is left:

```bash
gh pr checks <N> --repo leon0399/llame --json name,state \
  --jq 'map(select(.state != "SUCCESS" and .state != "SKIPPED"))'
```

An empty list is green. A watcher still running after the checks went terminal
is a stalled wait: read the state directly and move on.

If a new head has no CI or Lint run at all, check
`gh pr view <N> --json mergeable`: GitHub skips `pull_request` workflows for a
PR that conflicts with its base, and a stack layer conflicts when `master`
moved under files it touches. Rebase, then confirm
`gh api "repos/leon0399/llame/actions/runs?branch=<branch>"` lists a run for
the new head.

### A red check

1. Find the failing step and its error:

   ```bash
   gh api repos/leon0399/llame/actions/jobs/<job-id> --jq '.steps[] | select(.conclusion == "failure") | .name'
   gh run view --repo leon0399/llame --job <job-id> --log > /tmp/job-<job-id>.log
   ```

2. A failure the PR caused: fix it, push, and wait again.
3. A failure also red on `master`, or a known flake below: name it in a PR
   comment with the evidence, rerun the job (`gh run rerun --job <job-id>`),
   and continue.

Known flakes and master-red checks, as of late 2026; drop a line once it stops
recurring:

- `API DAST / Schemathesis` and ZAP fail on `master` (`POST /api/v1/media`).
- `Tests / machine-protocol`: `ERR_INTERNAL_ASSERTION` in
  `JSStreamSocket.doWrite` during `src/stdio-transport.test.ts`, after every
  test passed.
- The story `chat-message-row.stories.tsx` "Action Row Reveal", and
  `run-usage-accounting.integration.test.ts` "expected 999 to be 1000".
- Infrastructure: a Vercel rate limit, a Codecov upload timeout, a cancelled
  duplicate run.

`codecov/patch` is a coverage gate, not a flake: 85% of changed lines
([`.github/codecov.yml`](../../../../.github/codecov.yml)). A script whose
command entry point no test runs fails it; cover the command, for example in a
temporary repository.

## Monitoring after ready

Start the loop immediately after every non-draft push and record the head
commit and the push time. The floor is 15 minutes from the last head change.

```bash
timeout 960 npx -y pullfrog watch leon0399/llame --pr <N> > /tmp/pf-<N>.jsonl
```

`pullfrog watch` never exits on its own, so the `timeout` is what bounds it.
Each line is `{cursor, repo, pr, kind, createdAt, data}` with `kind` one of
`check`, `pr`, `comment`, `review`, `review_comment`, `review_thread`;
`--once` prints one batch and `--since <cursor>` resumes. Check events name
only the app, not the job, so confirm the end state with the direct reads
above and in [fetching-reviews.md](fetching-reviews.md).

While the floor runs, read new feedback at least every two minutes
(`fetch-pr-reviews.mjs <N> --since 5m`) and process each finding as it
arrives ([review-bots.md](review-bots.md)). Batch the accepted fixes into one
push: every push restarts CI and the floor for that PR and every stack PR
above it.

### Exit

Stop only when all of these hold:

- 15 minutes have passed since the last head change;
- CI on the current head is terminal and green, or red only on named
  master-red checks;
- every expected bot has finished on the current head, or is recorded as
  skipped ([review-bots.md](review-bots.md#roster));
- every finding has a disposition and a reply, and the only unresolved threads
  await Leo's decision.

Then update the Project item and read it back. Leo may end monitoring early
and merge; offer that when the floor or a master-red check is all that
remains.

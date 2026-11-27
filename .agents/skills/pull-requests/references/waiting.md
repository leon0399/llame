# Waiting for CI and reviews

One watcher covers both waits:
[`scripts/watch-pr.mjs`](../scripts/watch-pr.mjs). It polls every 60 s and
prints each change in the format of `fetch-pr-reviews.mjs`
([fetching-reviews.md](fetching-reviews.md)): new or edited threads, reviews,
and comments, each failed check, a head change, and a `terminal:` line when
every check has finished. It exits with `# settled:` once every PR it watches
is closed, or has terminal checks and the review floor elapsed since its head
was pushed. The floor is 15 minutes on a ready PR and 0 on a draft, so on a
draft the watcher is the CI wait.

```bash
# one PR, or every PR of a stack in one watcher
node .agents/skills/pull-requests/scripts/watch-pr.mjs 1955
node .agents/skills/pull-requests/scripts/watch-pr.mjs 1935 1936 1937
```

Seen items persist in a state file, so a rerun prints only what is new.
The first run prints the current head's open state: unresolved threads, reviews
of the head, comments since the push. `--reset` prints that again.

## Running it

Wake on its output; act on each block as it arrives.

- **A harness that wakes on output** (Claude Code's `Monitor`): run the
  watcher under it; every block it prints wakes you, and `# settled:` ends it.
- **A harness that wakes when a background command finishes** (omp `bash`
  with `async`): run it with `--once`. It exits after the first poll that
  prints a change, ending with `# waiting: …; run again to continue`; act,
  then start it again with the same arguments.

While it runs, keep working: fix the findings already printed, prepare the
next layer, update the body. A blocked wait is the watcher running with
nothing else to do.

## A red check

1. Find the failing step and its error:

   ```bash
   gh api repos/leon0399/llame/actions/jobs/<job-id> --jq '.steps[] | select(.conclusion == "failure") | .name'
   gh run view --repo leon0399/llame --job <job-id> --log > /tmp/job-<job-id>.log
   ```

   The watcher's `fail` line carries the job link; its last path segment is the
   job id.

2. A failure the PR caused: fix it, push, and keep watching.
3. A failure also red on `master`, or a known flake below: name it in a PR
   comment with the evidence, rerun the job (`gh run rerun --job <job-id>`),
   and keep watching.

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

A new head with no CI or Lint run at all is a conflicting PR: GitHub skips
`pull_request` workflows for it. See [stacks.md](stacks.md#conflicts-with-master).

## Monitoring after ready

Start the watcher right after every non-draft push. Process each finding as
it arrives ([review-bots.md](review-bots.md)), and batch the accepted fixes
into one push: every push restarts CI and the floor for that PR and every stack
PR above it.

### Exit

`# settled:` covers the floor and terminal CI. Stop only when, in addition:

- CI is green, or red only on named master-red checks;
- every expected bot has finished on the current head, or is recorded as
  skipped ([review-bots.md](review-bots.md#roster));
- every finding has a disposition and a reply, and the only unresolved threads
  await Leo's decision.

A bot still missing at `# settled:` extends the wait: run the watcher again.
Then update the Project item and read it back. Leo may end monitoring early and
merge; offer that when the floor or a master-red check is all that remains.

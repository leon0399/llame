Track [#1774](https://github.com/leon0399/llame/issues/1774) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- provider-failures-and-quota-wait/proposal
  <- provider-failures-and-quota-wait/failure-classes
  <- provider-failures-and-quota-wait/request-retries
  <- provider-failures-and-quota-wait/broken-streams
  <- provider-failures-and-quota-wait/quota-wait
  <- provider-failures-and-quota-wait/quota-wait-compaction
  <- provider-failures-and-quota-wait/quota-wait-web
  <- provider-failures-and-quota-wait/finalize
```

Every implementation layer is a safe intermediate merge boundary. The state after each layer:

- `failure-classes`: every failed provider request has a class, and a failed Run records it as
  `error.code`. Retries are unchanged, and a stalled stream still fails with `model_stream_idle`.
- `request-retries`: SDK retries are off, `model_stream_idle` is gone, and llame retries transient
  failures before the first released part. A failure after released parts fails the Run with its
  class.
- `broken-streams`: a transient failure after released parts and before a complete tool-call part
  is re-sent, and its parts are superseded.
- `quota-wait`: a long reset of a step request parks the Run in `awaiting_quota` and wakes it. The
  sidebar shows `background`, and Stop cancels the wait. Compaction summaries fail with their class
  as before, and the web shows no reset time or countdown yet.
- `quota-wait-compaction`: compaction summaries on the model of the Run also wait.
- `quota-wait-web`: the owner sees the wait, its countdown, and the reset time of a failed Run.

| Layer                   | Parent                  | Ownership                                                                                                                                                       | Authored estimate | Closes |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`              | `master`                | Proposal, design, deltas, and this task list.                                                                                                                   | ~2,000            | none   |
| `failure-classes`       | `proposal`              | `ProviderFailure`, the classifiers and reset signals, the code on a failed Run, and the hosted-search mapping.                                                  | ~1,900            | none   |
| `request-retries`       | `failure-classes`       | `maxRetries: 0`, request recovery in place of the idle watchdog, held parts, `wrapGenerate`, the first-token timeout, `model.retrying`, and the web retry line. | ~2,300            | none   |
| `broken-streams`        | `request-retries`       | The `model.superseded` anchor, the settlement gate, the step restart, the projection and reasoning rules, usage completeness, and the live web drop.            | ~1,900            | none   |
| `quota-wait`            | `broken-streams`        | The migrations, the `awaiting` union, entry, wake, re-wait, cap, budget, wakers, cancellation, the status enums, the sidebar, and Stop.                         | ~2,500            | none   |
| `quota-wait-compaction` | `quota-wait`            | The rethrow from `summarizeCheckpoint`, `resumeAt` for each compaction point, and the compaction Run wake path.                                                 | ~1,100            | none   |
| `quota-wait-web`        | `quota-wait-compaction` | `quotaWait`, `errorCode`, `errorResetsAt`, the box above the composer, and the failed-turn reset time.                                                          | ~1,300            | #1774  |
| `finalize`              | `quota-wait-web`        | Spec sync, task records, and archive movement only.                                                                                                             | ~2,000            | none   |

Estimates are low confidence. `request-retries` and `quota-wait` may exceed the ~2,000-line target
because each is one mergeable behavior. Regenerated OpenAPI, orval, live-protocol, and Drizzle
snapshot files count zero; report their churn in the PR. Re-measure each layer against its parent
before publication.

## 1. proposal

- [ ] 1.1 Validate: `pnpm exec openspec validate provider-failures-and-quota-wait --strict`,
      `pnpm exec markdownlint-cli2 "openspec/changes/provider-failures-and-quota-wait/**/*.md"`,
      `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with two independent reviewers each, verify each finding against
      code or primary sources, and commit each round separately. Record each round in the design
      revision history.
- [ ] 1.3 Self-review the published draft PR (SR), mark it ready, and run the GitHub review loop
      (GR) per [CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract).
- [ ] 1.4 Obtain Leo's approval of the published revision, including the deviation that the
      proposal lists.

## 2. failure-classes

- [ ] 2.1 Add `ProviderFailure` and the classifier modules (design D1, D2) with a fixture test per
      row of the D2 table. Verify "An unknown failure has a class", "No other class value exists" (the
      watchdog error is out of its scope until layer 3), "An overloaded Anthropic endpoint", "A body
      code wins over a synthetic status", "An OpenRouter budget block", "An OpenRouter lifetime budget",
      "Exhausted prepaid credits", and "A bare 429".
- [ ] 2.2 Add the reset signals per wire. Verify "An Anthropic spend limit has no reset time", "A
      bare Retry-After is a hint", "Both Codex windows are exhausted", "An unspent window does not give
      a reset time", "An exhausted Anthropic bucket", and "A weekly Go limit" in classifier tests.
- [ ] 2.3 Classify in each client before its sanitizer, and keep `code`, `resetsAt`, and `hintMs`
      through `sanitizeCodexError`, `sanitizeAnthropicError`, the Chat Completions bounds, and
      `redactModelFailure`. Verify "The Codex client classifies before it sanitizes" and the
      `provider-api-selection` scenario "Classification survives redaction" in client tests.
- [ ] 2.4 Record the class as `error.code` and in `run.failed` for every provider failure, and keep
      the `ModelContextExecutionError` codes. Verify "A Run fails on a removed model" in an API
      integration test.
- [ ] 2.5 Map the class to the engine classes in `model-hosted.ts`. Verify "A hosted-search model is
      out of quota".
- [ ] 2.6 Add "Failure class" to `docs/product/glossary.md`, add the classes to the provider
      runbooks under `docs/product/operator/providers/`, and add a dated `CHANGELOG.md` entry.
- [ ] 2.7 Focused checks: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the changed test
      files, `pnpm format:check`, `git diff --check`.
- [ ] 2.8 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 3. request-retries

- [ ] 3.1 Send `maxRetries: 0` on every chat-wire request, including the structured builders, and
      remove the `RetryError` unwrap paths. Verify "One request on a 503" and the modified
      `provider-api-selection` scenarios "An HTTP failure keeps its current message", "A redirect after
      a retried failure is still described as a redirect", and "A transport failure keeps its message".
- [ ] 3.2 Replace `stream-idle-watchdog.ts` with `request-recovery.ts` (design D3), remove
      `model_stream_idle`, and add `models[].firstTokenTimeoutSeconds` (design D10). Verify "Metadata
      alone does not end the window", "A per-model timeout", "A stream ends without a finish part", "A
      long tool call does not count", "An invalid first-token timeout", "The timeout stays private",
      and the `durable-runs` scenarios "A stalled model stream fails the run" and "A long tool call does
      not trip the stream watchdog".
- [ ] 3.3 Hold parts before the first content part. Verify "A redacted thinking start and then a
      stall".
- [ ] 3.4 Retry transient failures before the first released part with full jitter, honor stated
      waits up to 60 s, and fail long `rate_limited` hints. Verify "Ten overloaded answers fail the
      request", "A retry succeeds", "An authentication failure is not sent again", "A 20-second bucket
      reset", "A short Go usage limit", "An unclassified long hint", "An overload with a long hint", "A
      title request hits a usage limit", and the `anthropic-messages-provider` scenarios, with an
      injected clock and random source.
- [ ] 3.5 Add the `wrapGenerate` variant to the structured builders (design D3, D9). Verify a title
      request that gets HTTP 529 once and then succeeds.
- [ ] 3.6 Fail the Run with the class of the failure once a complete tool-call part streamed. Verify
      "The stream breaks after a tool call" and "An overload after a tool call".
- [ ] 3.7 Append `model.retrying` for the Run's own requests and show the retry line. Verify "A
      reload during a retry delay" in an API test and "An overloaded provider" in a story test.
- [ ] 3.8 Add "Request retry" to the glossary, update `docs/product/operator/scaling.md` and the
      provider runbooks, and add a dated `CHANGELOG.md` entry that names the removal of
      `model_stream_idle` as breaking.
- [ ] 3.9 Focused checks: `pnpm --filter api lint`, `pnpm --filter api typecheck`,
      `pnpm --filter web lint`, `pnpm --filter web typecheck`, the changed test files, the changed
      stories, `pnpm format:check`, `git diff --check`.
- [ ] 3.10 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 4. broken-streams

- [ ] 4.1 Spike: prove the step restart of design D4 against the scripted model client. Compare the
      step counters, the stored snapshot, and the in-Run item positions after a restart with a run that
      never broke. Stop and revise the design if they differ.
- [ ] 4.2 Add the `fromSequence` anchor, the `onFinish` settlement gate, and the restart. Verify "A
      stream breaks inside a thinking block", "A stream breaks mid-text", "Restarts share one retry
      budget", and the `durable-runs` scenario "A stall after content is retried".
- [ ] 4.3 Skip superseded parts in the finalizer and the rebuild. Verify the `durable-runs`
      scenarios "A superseded request leaves the reply" and "A superseded send keeps its reasoning in the
      log only", and the projection scenarios.
- [ ] 4.4 Mark usage incomplete after a superseded send. Verify the `run-usage-accounting` scenario
      "A superseded send makes usage incomplete".
- [ ] 4.5 Drop the parts of a superseded send in the live web client. Verify in a story test that
      the text of the broken send leaves the transcript.
- [ ] 4.6 Update `docs/product/operator/scaling.md` and add a dated `CHANGELOG.md` entry.
- [ ] 4.7 Focused checks as in 3.9.
- [ ] 4.8 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 5. quota-wait

- [ ] 5.1 Add the two migrations and the `awaiting` union (design D5). Verify with `pnpm --filter
  api db:check`, and with an integration test that an `awaiting_jobs` Run stored before the backfill
      carries `kind: 'jobs'` and still wakes.
- [ ] 5.2 Enter, wake, and re-wait for step requests (design D5, D6), with `runs.quotaWaitMaxSeconds`.
      Verify "A weekly limit frees the worker", "A short reset does not park the Run", "A worker crash
      after the entry", "A wake after a restart", "A monthly budget beyond the default cap", "A steer
      after the reset", "A reset that does not clear", "Two limits in one long Run", "The default cap",
      "A zero cap fails startup", and "A reload during a quota wait" in API integration tests.
- [ ] 5.3 Keep deliveries and notices pending (design D6). Verify "A steer during a quota wait", "A
      job settles during a quota wait", and that a plain send gets 409.
- [ ] 5.4 Wake on cancellation with one fenced winner. Verify "The owner stops a quota wait", "A
      cancellation and the deadline job arrive together", and the `run-steering` scenario "Stop during a
      quota wait with a pending steer" in API integration tests.
- [ ] 5.5 Exclude quota waits from the budget (design D7). Verify "A long wait under a budget", the
      `durable-runs` scenarios "A quota wait does not use the budget" and "A Run passes its budget while
      it waits", and the `run-steering` scenario "A long steered Run reaches its budget".
- [ ] 5.6 Continue from the stored steps after a quota wake. Verify the `tool-calling` scenario "A
      quota wake does not restart the segment".
- [ ] 5.7 Verify the `opencode-go-provider` scenarios "A quota rejection is reported without
      inventing state", "A usage limit without Retry-After fails", and "The runbook names the accepted
      upstream shapes", and the `subscription-access-openai-codex` scenarios "Subscription limit" and "A
      plan without the model", with stubbed upstreams. Add a pg-boss test that an 8-day delayed job
      keeps `keep_until` after its `start_after`.
- [ ] 5.8 Add `awaiting_quota` to the DTO enums and regenerate OpenAPI, the orval models, and both
      live-protocol files, with a clean second generation. Add it to the status reducer and both sidebar
      checks, and make the web Stop cancel a quota wait. Verify the `background-jobs` scenario "A Run
      that waits for a quota reset" and the Stop click in story tests.
- [ ] 5.9 Add "Quota wait" and `awaiting_quota` to the glossary, update `SPEC.md` §9.3, the Codex
      and OpenCode Go runbooks, and `docs/product/operator/scaling.md`, and add a dated `CHANGELOG.md`
      entry.
- [ ] 5.10 Focused checks as in 3.9, the OpenAPI lint, and the changed integration test files.
- [ ] 5.11 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 6. quota-wait-compaction

- [ ] 6.1 Rethrow a quota `ProviderFailure` from `summarizeCheckpoint`, add `resumeAt`, and add the
      wake path for a Run with no `messageId` (design D5, D6). Verify "A compaction Run waits", "A
      step-boundary compaction hits a usage limit", and "A step-boundary summary beyond the cap" in API
      integration tests.
- [ ] 6.2 Keep a model-switch compaction a side call. Verify that a usage limit on the earlier model
      fails with `context_incompatible` and no wait.
- [ ] 6.3 Update `docs/product/operator/scaling.md` and add a dated `CHANGELOG.md` entry.
- [ ] 6.4 Focused checks as in 2.7.
- [ ] 6.5 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 7. quota-wait-web

- [ ] 7.1 Add `quotaWait`, `errorCode`, and `errorResetsAt` to the Run DTOs, and regenerate OpenAPI,
      the orval models, and both live-protocol files. Verify "Another owner cannot read the wait" as a
      negative isolation test, and a second generation with a clean diff.
- [ ] 7.2 Add the box above the composer (design D8). Verify "A Codex weekly limit" in a story test
      with a fixed clock, including the change to "Sending again…" after the wake time.
- [ ] 7.3 Show the reset time on the failed turn and on the error row of a compaction Run. Verify "A
      reset beyond the cap" in a story test.
- [ ] 7.4 Update the owner docs for a waiting Chat and add a dated `CHANGELOG.md` entry. Put
      `Closes #1774` on this PR.
- [ ] 7.5 Focused checks as in 3.9, the OpenAPI lint, and the Storybook story tests.
- [ ] 7.6 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 8. finalize

Enter `provider-failures-and-quota-wait/finalize` with `$gh-stack` before `$openspec-sync-specs`
writes canonical specs. SR and GR of this layer follow archive movement.

- [ ] 8.1 Run `$openspec-sync-specs` and check each MODIFIED requirement against its canonical text.
- [ ] 8.2 Confirm that every task above is checked and `openspec status --change
  provider-failures-and-quota-wait --json` reports every artifact complete.
- [ ] 8.3 `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all
  --strict`.
- [ ] 8.4 Run `$openspec-archive-change`.

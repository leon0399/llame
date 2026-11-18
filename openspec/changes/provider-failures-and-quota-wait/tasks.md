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
  <- provider-failures-and-quota-wait/quota-wait-web
  <- provider-failures-and-quota-wait/finalize
```

Every implementation layer is a safe intermediate merge boundary. The state after each layer:

- `failure-classes`: every failed model request has a class, and a failed Run records it as
  `error.code`. Retries are unchanged.
- `request-retries`: SDK retries are off, and llame retries transient failures before the first
  forwarded part. A failure after forwarded parts fails the Run with its class.
- `broken-streams`: a `stream_broken` after forwarded parts and before a tool call is re-sent, and
  its parts are superseded.
- `quota-wait`: a long reset parks the Run in `awaiting_quota` and wakes it. The API exposes no
  `quotaWait` yet, and the web shows the Chat as active.
- `quota-wait-web`: the owner sees the wait, its countdown, and the reset time of a failed Run.

| Layer             | Parent            | Ownership                                                                                                                                                           | Authored estimate | Closes |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`        | `master`          | Proposal, design, deltas, and this task list.                                                                                                                       | ~1,500            | none   |
| `failure-classes` | `proposal`        | `ProviderFailure`, the wire classifiers and reset signals, the code on a failed Run, and the hosted-search mapping.                                                 | ~1,900            | none   |
| `request-retries` | `failure-classes` | `maxRetries: 0`, request recovery in place of the idle watchdog, the first-token timeout, retries before forwarded parts, `model.retrying`, and the web retry line. | ~2,200            | none   |
| `broken-streams`  | `request-retries` | The step restart, `model.superseded`, the projection rule, and the live web drop.                                                                                   | ~1,500            | none   |
| `quota-wait`      | `broken-streams`  | The status migration, the `awaiting` union, entry, wake, re-wait, cap, budget, wakers, cancellation, and the compaction Run wake.                                   | ~2,400            | none   |
| `quota-wait-web`  | `quota-wait`      | `quotaWait`, `errorCode`, `errorResetsAt`, the box above the composer, the failed-turn reset time, the sidebar, and Stop.                                           | ~1,600            | #1774  |
| `finalize`        | `quota-wait-web`  | Spec sync, task records, and archive movement only.                                                                                                                 | ~1,400            | none   |

Estimates are low confidence. `quota-wait` and `request-retries` may exceed the ~2,000-line target
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
      row of the D2 table. Verify "An unknown failure has a class", "No other class value exists",
      "An overloaded Anthropic endpoint", "An OpenRouter budget block", "Exhausted prepaid credits", and
      "A bare 429".
- [ ] 2.2 Add the reset signals per wire. Verify "An Anthropic spend limit has no reset time", "A
      bare Retry-After is a hint", "Both Codex windows are exhausted", "An unspent window does not give
      a reset time", "An exhausted Anthropic bucket", and "A weekly Go limit" in classifier tests.
- [ ] 2.3 Classify in each client before its sanitizer, and keep `code`, `resetsAt`, and `hintMs`
      through `sanitizeCodexError`, `sanitizeAnthropicError`, the Chat Completions bounds, and
      `redactModelFailure`. Verify "The Codex client classifies before it sanitizes" and
      `provider-api-selection` "Classification survives redaction" in client tests.
- [ ] 2.4 Record the class as `error.code` and in `run.failed` for every provider failure in
      `run-execution.service.ts` and the worker model errors. Verify "A Run fails on a removed model"
      in an API integration test.
- [ ] 2.5 Map the class to the engine classes in `model-hosted.ts`. Verify "A hosted-search model is
      out of quota".
- [ ] 2.6 Add "Failure class" to `docs/product/glossary.md`, add the classes to the provider
      runbooks under `docs/product/operator/providers/`, and add a dated `CHANGELOG.md` entry.
- [ ] 2.7 Focused checks: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the changed test
      files, `pnpm format:check`, `git diff --check`.
- [ ] 2.8 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 3. request-retries

- [ ] 3.1 Send `maxRetries: 0` on every chat-wire request and remove the `RetryError` unwrap paths.
      Verify "One request on a 503" and the modified `provider-api-selection` scenarios "An HTTP
      failure keeps its current message", "A redirect after a retried failure is still described as a
      redirect", and "A transport failure keeps its message".
- [ ] 3.2 Replace `stream-idle-watchdog.ts` with `request-recovery.ts` (design D3), remove
      `model_stream_idle`, and add `models[].firstTokenTimeoutSeconds` (design D10). Verify "Metadata
      alone does not end the window", "A per-model timeout", "A stream ends without a finish part", "A
      long tool call does not count", "An invalid first-token timeout", "The timeout stays private",
      and the `durable-runs` scenarios "A stalled model stream fails the run" and "A long tool call does
      not trip the stream watchdog".
- [ ] 3.3 Retry transient failures before the first forwarded part with full jitter, honor stated
      waits up to 60 s, and fail longer hints. Verify "Ten overloaded answers fail the request", "A
      retry succeeds", "An authentication failure is not sent again", "A 20-second bucket reset", "An
      unclassified long hint", "A title request hits a usage limit", and the `anthropic-messages-provider`
      scenarios with an injected clock and random source.
- [ ] 3.4 Fail the Run as `stream_broken` when a tool-call part of the request streamed. Verify "The
      stream breaks after a tool call".
- [ ] 3.5 Append `model.retrying` and show the retry line on the web. Verify "A reload during a retry
      delay" in an API test and "An overloaded provider" in a story test.
- [ ] 3.6 Add "Request retry" to the glossary, update `docs/product/operator/scaling.md` and the
      provider runbooks, and add a dated `CHANGELOG.md` entry that names the removal of
      `model_stream_idle` as breaking.
- [ ] 3.7 Focused checks: `pnpm --filter api lint`, `pnpm --filter api typecheck`,
      `pnpm --filter web lint`, `pnpm --filter web typecheck`, the changed test files, the changed
      stories, `pnpm format:check`, `git diff --check`.
- [ ] 3.8 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 4. broken-streams

- [ ] 4.1 Spike: prove the step restart of design D4 against the scripted model client. Compare the
      step counters and the in-Run items after a restart with a run that never broke. Stop and revise
      the design if they differ.
- [ ] 4.2 Append `model.superseded`, drop the collector parts, and restart the step. Verify "A
      stream breaks inside a thinking block", "A stream breaks mid-text", and the `durable-runs`
      scenario "A stall after content is retried".
- [ ] 4.3 Skip superseded parts in the finalizer and the rebuild. Verify the `durable-runs`
      scenario "A superseded request leaves the reply" and the existing projection scenarios.
- [ ] 4.4 Drop the parts of a superseded request in the live web client. Verify in a story test
      that the text of the broken request leaves the transcript.
- [ ] 4.5 Update `docs/product/operator/scaling.md` and add a dated `CHANGELOG.md` entry.
- [ ] 4.6 Focused checks as in 3.7.
- [ ] 4.7 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 5. quota-wait

- [ ] 5.1 Add the two migrations and the `awaiting` union (design D5). Verify with `pnpm --filter
  api db:check` and an integration test that an `awaiting_jobs` Run stored before the backfill
      still wakes.
- [ ] 5.2 Enter, wake, and re-wait (design D5, D6), with `runs.quotaWaitMaxSeconds`. Verify "A
      weekly limit frees the worker", "A short reset does not park the Run", "A worker crash after the
      entry", "A wake after a restart", "A monthly budget beyond the default cap", "A steer after the
      reset", "A reset that does not clear", "The default cap", "A zero cap fails startup", and "A
      reload during a quota wait" in API integration tests.
- [ ] 5.3 Keep deliveries and notices pending (design D6). Verify "A steer during a quota wait", "A
      job settles during a quota wait", and that a plain send gets 409.
- [ ] 5.4 Wake on cancellation. Verify "The owner stops a quota wait" at the API.
- [ ] 5.5 Exclude quota waits from the budget (design D7). Verify "A long wait under a budget", the
      `durable-runs` scenarios "A quota wait does not use the budget" and "A Run passes its budget while
      it waits", and the `run-steering` scenario "A long steered Run reaches its budget".
- [ ] 5.6 Cover in-Run compactions and compaction Runs. Verify "A compaction Run waits" and "A
      step-boundary compaction hits a usage limit".
- [ ] 5.7 Verify the `opencode-go-provider` scenarios "A quota rejection is reported without
      inventing state", "A usage limit without Retry-After fails", and "The runbook names the accepted
      upstream shapes", and the `subscription-access-openai-codex` scenarios "Subscription limit" and "A
      plan without the model", with stubbed upstreams. Add a pg-boss test that an 8-day delayed job
      keeps `keep_until` after its `start_after`.
- [ ] 5.8 Add "Quota wait" and `awaiting_quota` to the glossary, update `SPEC.md` §9.3, the Codex
      and OpenCode Go runbooks, and `docs/product/operator/scaling.md`, and add a dated `CHANGELOG.md`
      entry.
- [ ] 5.9 Focused checks as in 2.7, and the changed integration test files.
- [ ] 5.10 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 6. quota-wait-web

- [ ] 6.1 Add `quotaWait`, `errorCode`, and `errorResetsAt` to the Run DTOs, and regenerate OpenAPI,
      the orval models, and both live-protocol files. Verify "Another owner cannot read the wait" as a
      negative isolation test, and a second generation with a clean diff.
- [ ] 6.2 Add the box above the composer (design D8). Verify "A Codex weekly limit" in a story test
      with a fixed clock, including the change to "Resuming…" after the wake time.
- [ ] 6.3 Show the reset time on the failed turn. Verify "A reset beyond the cap" in a story test.
- [ ] 6.4 Show `background` in the sidebar and make Stop cancel. Verify the `background-jobs`
      scenario "A Run that waits for a quota reset" and the `run-steering` scenario "Stop during a
      quota wait with a pending steer" in story tests.
- [ ] 6.5 Update the owner docs for a waiting Chat and add a dated `CHANGELOG.md` entry. Put
      `Closes #1774` on this PR.
- [ ] 6.6 Focused checks as in 3.7, the OpenAPI lint, and the Storybook story tests.
- [ ] 6.7 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 7. finalize

Enter `provider-failures-and-quota-wait/finalize` with `$gh-stack` before `$openspec-sync-specs`
writes canonical specs. SR and GR of this layer follow archive movement.

- [ ] 7.1 Run `$openspec-sync-specs` and check each MODIFIED requirement against its canonical text.
- [ ] 7.2 Confirm that every task above is checked and `openspec status --change
  provider-failures-and-quota-wait --json` reports every artifact complete.
- [ ] 7.3 `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all
  --strict`.
- [ ] 7.4 Run `$openspec-archive-change`.

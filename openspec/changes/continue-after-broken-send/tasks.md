Track [#1828](https://github.com/leon0399/llame/issues/1828) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- continue-after-broken-send/proposal
  <- continue-after-broken-send/continue
  <- continue-after-broken-send/quota-wait
  <- continue-after-broken-send/finalize
```

Each implementation layer is a safe merge boundary. The state after each layer:

- `continue`: a Run step that fails after a started tool call stops the SDK, waits for its calls,
  cuts, stores the notice, and continues with the carried count, or fails with real results and
  the notice. A `quota_exhausted` failure after a started call with no reset, or a `quota_exhausted` or
  `rate_limited` failure whose reset or delay hint is more than 60 seconds away, fails the Run in
  this state; it gets the notice. Within 60 seconds, it is a request retry and continues.
- `quota-wait`: that failure parks the Run after the calls settle, and the woken Run sends the next
  step.

The proposal layer carries two ADRs as a named exception to the proposal-only file rule of
CONTRIBUTING.md, because Leo asked for them in this PR (2026-11-20).

| Layer        | Parent       | Ownership                                                                                                                                                                                                                                 | Authored estimate | Closes |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`   | `master`     | Proposal, design, deltas, this task list, and two ADRs under `docs/adr/`.                                                                                                                                                                 | ~1,100            | none   |
| `continue`   | `proposal`   | The failure seam, the stop at a failed step and its quota-recovery guard, the decision in `onFinish`, the cut, the notice producer, the next step with the carried count, the Stop, expiry, and interrupt writers, the `wait` rule, docs. | ~2,800            | none   |
| `quota-wait` | `continue`   | The park after a started call with the cut, the wake into the next step, docs, and changelog.                                                                                                                                             | ~1,000            | #1828  |
| `finalize`   | `quota-wait` | Spec sync, task records, and archive movement only.                                                                                                                                                                                       | ~700              | none   |

Estimates are low confidence; the round 2 feasibility review put `continue` at 2,600 to 3,200
lines. `continue` can exceed the ~2,000-line target: the seam, the stop, the decision, the cut,
and the notice are one behavior, and none of them is mergeable alone without a Run that cuts output
it does not explain. No generated OpenAPI, orval, live-protocol, or Drizzle file changes. Re-measure each layer
against its parent before publication.

## 1. proposal

- [x] 1.1 Validate: `pnpm exec openspec validate continue-after-broken-send --strict`,
      `pnpm lint:markdown` (it runs the ADR prose check), `pnpm exec oxfmt --check` on the change
      and the two ADRs, `node scripts/check-markdown-links.mjs`, and `git diff --check`.
- [x] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers per round, and
      commit each round separately. Record each round in design.md "Revision history".
- [x] 1.3 SR: self-review the draft PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md)
      before ready. GR: run [Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring) after
      ready, and obtain Leo's approval of the published revision.

## 2. continue

Enter `continue-after-broken-send/continue` with `$gh-stack` from the approved proposal. Run
focused test files only; CI owns the full suites.

- [x] 2.1 Spike first (design Risks): drive `runStreamChannel` and the Chat Completions client,
      each with `applyRequestRecovery` and a `MockLanguageModelV3` that streams a complete
      `tool-call` part and then fails, with a tool that resolves later. Record when `onError` and
      `onFinish` run and how many `doStream` calls occur today, also with a Stop and an interrupt
      during the wait. Stop the layer and return to review if the order differs from design Context.
- [x] 2.2 `request-recovery.ts` marks every class `toolCallStarted` after a complete tool-call part
      and attaches the prior send count (design D1). Verify in `request-recovery.test.ts` that such
      a send is not sent again, and that a restored recovery with a pending failure waits the delay
      of retry `sends`, reports `retry: sends`, and fails at `MAX_SENDS`.
- [x] 2.3 Add the `onSendFailed` seam, stop the SDK at a failed step with no quota recovery, and
      decide in `onFinish` (design D1, D2), on both client shapes of 2.1. Verify "One call still
      runs when the send breaks", "The owner stops the Run during the wait", "A rejected call does
      not cause a second send", "An overload after a tool call", "A wait call in a broken send", the
      `durable-runs` scenario "A wait call of a failed send does not suspend the Run", and the
      unchanged "A hosted search breaks after its search tool call". Re-verify the unchanged
      scenarios of "A Run that waits holds no worker".
- [x] 2.4 Capture the cut anchor at the last tool-call part (design D3). Verify "The text after the
      last tool call is not kept" and "Text between two kept calls stays", including a short
      buffered text prefix before the tool call, in
      `run-stream-bridge.test.ts` and in the `assistant-transcript` rebuild tests.
- [x] 2.5 Add the `provider-failure` producer, template, labels, and precedence (design D5). Verify
      "A broken stream has a label" and "The next request carries the notice" in
      `context-item-producers.test.ts`, the `context-injection` scenario "A provider-failure notice
      comes first in its step", and the unchanged scenarios of that MODIFIED requirement.
- [x] 2.6 Continue with the next step, the boundary delivery, and the carried count (design D4).
      Verify "The stream breaks after a tool call", "A provider breaks after each tool call", "A
      reload during the delay of the next step", "No retry is left for the next step", "A send
      without failure ends the count", "A steer at the boundary starts a new count", "A failure with
      no retry does not deliver a pending steer", "A worker stops before the next step starts", and
      "A worker stops during the delay of the next step".
- [x] 2.7 Store the cut and the notice in the terminal and interrupt writes (design D6). Verify "An
      authentication failure after a tool call", "Owner Continue keeps the notice", "An interrupt
      during the wait keeps the notice", and the `run-steering` scenario "An interrupt during the
      wait of a failed send", and re-verify "The cut reasoning part never replays". The `tool-calling` scenario
      "Failure settles in-flight calls" has no reachable seam for a call outside the failed send: the SDK starts a step
      only after every earlier call has an output, and instruction-origin reads finish inside their own call.
      Terminal writes still run the shipped `settleOpenToolsAndDrain`.
- [x] 2.8 Update [SPEC.md](../../../SPEC.md) (failure paragraph),
      [provider routing](../../../docs/product/operator/providers/routing.md) (failure after a tool
      call), and [Continue a turn](../../../docs/product/reference/continue-a-turn.md) (the kept
      notice). Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [x] 2.9 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused test files above,
      `pnpm format:check`, and `git diff --check`.
- [ ] 2.10 SR: self-review the parent-relative draft diff against
      [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md) before ready. GR: run Ready-PR monitoring after
      ready. This PR references #1828 and does not close it.

## 3. quota-wait

Enter `continue-after-broken-send/quota-wait` with `$gh-stack` from `continue`.

- [x] 3.1 Park after a started call with the cut, with the quota refusal kept on the shipped path
      (design D2, D6). Verify the `provider-failures` scenarios "A usage limit after a tool call"
      and "A second usage limit after a woken tool call", and the `quota-wait` scenarios "A limit
      after a tool call parks the Run after the call settles", "The kept parts of a failed send
      survive the wait", "A steer during a wait after a tool call", "A woken Run continues after a
      tool call", and "A checkpoint holds the settled tool part", in `quota-wait.test.ts` and `quota-wait.integration.test.ts`. Re-verify
      the unchanged scenarios of the four MODIFIED requirements.
- [x] 3.2 Update [scaling](../../../docs/product/operator/scaling.md) (quota wait after a started
      call) and the quota sentences of [provider routing](../../../docs/product/operator/providers/routing.md).
      Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [x] 3.3 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused test files above,
      `pnpm format:check`, and `git diff --check`.
- [ ] 3.4 SR: self-review the parent-relative draft diff before ready. GR: run Ready-PR monitoring
      after ready. This PR carries `Closes #1828`.

## 4. finalize

Enter `continue-after-broken-send/finalize` with `$gh-stack` before `$openspec-sync-specs` writes
canonical specs. SR and GR of this layer follow archive movement.

- [x] 4.1 Run `$openspec-sync-specs` and check each MODIFIED requirement against its canonical text.
- [ ] 4.2 Confirm that every task above is checked and `openspec status --change
      continue-after-broken-send --json` reports every artifact complete.
- [x] 4.3 `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all
      --strict`.

4.4 Post-readiness operation: run `$openspec-archive-change`. This operation is not a readiness
checkbox, because archive itself requires the preceding checklist to be complete. Record its native
result after execution.

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
  the notice. A `quota_exhausted` or `rate_limited` failure after a started call fails the Run in
  this state, as a class with no retry does; it gets the notice.
- `quota-wait`: that failure parks the Run after the calls settle, and the woken Run sends the next
  step.

The proposal layer carries two ADRs as a named exception to the proposal-only file rule of
CONTRIBUTING.md, because Leo asked for them in this PR (2026-11-20).

| Layer        | Parent       | Ownership                                                                                                                          | Authored estimate | Closes |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`   | `master`     | Proposal, design, deltas, this task list, and two ADRs under `docs/adr/`.                                                          | ~1,100            | none   |
| `continue`   | `proposal`   | The stop at a failed step, the decision before teardown, the cut, the notice producer, the next step with the carried count, docs. | ~2,000            | none   |
| `quota-wait` | `continue`   | The park after a started call with the cut, the quota-recovery guard, the wake into the next step, docs, and changelog.            | ~900              | #1828  |
| `finalize`   | `quota-wait` | Spec sync, task records, and archive movement only.                                                                                | ~700              | none   |

Estimates are low confidence; the feasibility review put the whole runtime at 2,200 to 3,000
lines. No generated OpenAPI, orval, live-protocol, or Drizzle file changes. Re-measure each layer
against its parent before publication.

## 1. proposal

- [ ] 1.1 Validate: `pnpm exec openspec validate continue-after-broken-send --strict`,
      `pnpm lint:markdown` (it runs the ADR prose check), `pnpm exec oxfmt --check` on the change
      and the two ADRs, `node scripts/check-markdown-links.mjs`, and `git diff --check`.
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers per round, and
      commit each round separately. Record each round in design.md "Revision history".
- [ ] 1.3 SR: self-review the draft PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md)
      before ready. GR: run [Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring) after
      ready, and obtain Leo's approval of the published revision.

## 2. continue

Enter `continue-after-broken-send/continue` with `$gh-stack` from the approved proposal. Run
focused test files only; CI owns the full suites.

- [ ] 2.1 Spike first (design Risks): drive `runStreamChannel` with `applyRequestRecovery` and a
      `MockLanguageModelV3` that streams a complete `tool-call` part and then fails, with a tool
      that resolves later. Record when `onError` runs and how many `doStream` calls occur today.
      Stop the layer and return to review if the order differs from design Context.
- [ ] 2.2 `request-recovery.ts` marks every class `toolCallStarted` after a complete tool-call part
      and attaches the prior send count (design D1). Verify in `request-recovery.test.ts` that such
      a send is not sent again, and that a restored recovery with a pending failure waits the delay
      of retry `sends`, reports `retry: sends`, and fails at `MAX_SENDS`.
- [ ] 2.3 Stop the SDK at a failed step and decide before teardown (design D1, D2), on the
      production client path of 2.1. Verify "One call still runs when the send breaks", "The owner
      stops the Run during the wait", "A rejected call does not cause a second send", "An overload
      after a tool call", and the unchanged "A hosted search breaks after its search tool call".
      Verify that a `wait` call of the failed send settles as "did not run" (A7).
- [ ] 2.4 Capture the cut anchor at the last tool-call part (design D3). Verify "The text after the
      last tool call is not kept" and "Text between two kept calls stays", in
      `run-stream-bridge.test.ts` and in the `assistant-transcript` rebuild tests.
- [ ] 2.5 Add the `provider-failure` producer, template, labels, and precedence (design D5). Verify
      "A broken stream has a label" and "The next request carries the notice" in
      `context-item-producers.test.ts`, the `context-injection` scenario "A provider-failure notice
      comes first in its step", and the unchanged scenarios of that MODIFIED requirement.
- [ ] 2.6 Continue with the next step, the boundary delivery, and the carried count (design D4).
      Verify "The stream breaks after a tool call", "A provider breaks after each tool call", "A
      reload during the delay of the next step", "No retry is left for the next step", "A send
      without failure ends the count", "A steer at the boundary starts a new count", and "A worker
      stops during the delay of the next step".
- [ ] 2.7 Store the cut and the notice in the terminal and interrupt writes (design D6). Verify "An
      authentication failure after a tool call", "Owner Continue keeps the notice", and "An
      interrupt during the wait keeps the notice". Verify that the `tool-calling` scenario "Failure
      settles in-flight calls" still holds for a call outside the failed send.
- [ ] 2.8 Update [SPEC.md](../../../SPEC.md) (failure paragraph),
      [provider routing](../../../docs/product/operator/providers/routing.md) (failure after a tool
      call), and [Continue a turn](../../../docs/product/reference/continue-a-turn.md) (the kept
      notice). Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 2.9 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused test files above,
      `pnpm format:check`, and `git diff --check`.
- [ ] 2.10 SR: self-review the parent-relative draft diff against
      [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md) before ready. GR: run Ready-PR monitoring after
      ready. This PR references #1828 and does not close it.

## 3. quota-wait

Enter `continue-after-broken-send/quota-wait` with `$gh-stack` from `continue`.

- [ ] 3.1 Park after a started call with the cut, and record no quota recovery at a failed step
      (design D1, D6). Verify the `provider-failures` scenarios "A usage limit after a tool call"
      and "A second usage limit after a woken tool call", and the `quota-wait` scenarios "A limit
      after a tool call parks the Run after the call settles", "The kept parts of a failed send
      survive the wait", "A woken Run continues after a tool call", and "A checkpoint holds the
      settled tool part", in `quota-wait.test.ts` and `quota-wait.integration.test.ts`. Re-verify
      the unchanged scenarios of the four MODIFIED requirements.
- [ ] 3.2 Update [scaling](../../../docs/product/operator/scaling.md) (quota wait after a started
      call) and the quota sentences of [provider routing](../../../docs/product/operator/providers/routing.md).
      Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 3.3 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused test files above,
      `pnpm format:check`, and `git diff --check`.
- [ ] 3.4 SR: self-review the parent-relative draft diff before ready. GR: run Ready-PR monitoring
      after ready. This PR carries `Closes #1828`.

## 4. finalize

Enter `continue-after-broken-send/finalize` with `$gh-stack` before `$openspec-sync-specs` writes
canonical specs. SR and GR of this layer follow archive movement.

- [ ] 4.1 Run `$openspec-sync-specs` and check each MODIFIED requirement against its canonical text.
- [ ] 4.2 Confirm that every task above is checked and `openspec status --change
      continue-after-broken-send --json` reports every artifact complete.
- [ ] 4.3 `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all
      --strict`.

4.4 Post-readiness operation: run `$openspec-archive-change`. This operation is not a readiness
checkbox, because archive itself requires the preceding checklist to be complete. Record its native
result after execution.

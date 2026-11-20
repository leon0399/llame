Track [#1828](https://github.com/leon0399/llame/issues/1828) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for the implementation
layer, after proposal approval only.

```text
master
  <- continue-after-broken-send/proposal
  <- continue-after-broken-send/runtime
  <- continue-after-broken-send/finalize
```

`runtime` is one safe merge boundary: after it, a Run step that fails after a started tool call
waits, keeps, and continues, waits for a quota reset, or fails with real results and the notice.
The parts of that behavior cannot merge apart. A cut without the notice would make the notice
requirement false in every outcome, and the notice without the cut would claim lost output that the
reply still holds.

| Layer      | Parent     | Ownership                                                                                                                           | Authored estimate | Closes |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal` | `master`   | Proposal, design, deltas, this task list, and two ADRs under `docs/adr/`.                                                           | ~900              | none   |
| `runtime`  | `proposal` | The continue path in request recovery and the Run executor, the quota-wait cut, the `provider-failure` notice, docs, and changelog. | ~1,700            | #1828  |
| `finalize` | `runtime`  | Spec sync, task records, and archive movement only.                                                                                 | ~600              | none   |

Estimates are low confidence. No generated OpenAPI, orval, live-protocol, or Drizzle file changes.
Re-measure each layer against its parent before publication.

## 1. proposal

- [ ] 1.1 Validate: `pnpm exec openspec validate continue-after-broken-send --strict`,
      `pnpm exec markdownlint-cli2 "openspec/changes/continue-after-broken-send/**/*.md"`,
      `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers per round, and
      commit each round separately. Record each round in design.md "Revision history".
- [ ] 1.3 SR: self-review the draft PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md)
      before ready. GR: run [Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring) after
      ready, and obtain Leo's approval of the published revision.

## 2. runtime

Enter `continue-after-broken-send/runtime` with `$gh-stack` from the approved proposal. Run focused
test files only; CI owns the full suites.

- [ ] 2.1 Spike first (design D2): in `run-execution.service.test.ts`, a fake model streams a
      complete `tool-call` part and then fails, and the tool resolves later. Prove that the
      execution wrapper is not aborted and that `done` resolves with the real result. Stop the
      layer and return to review if it fails.
- [ ] 2.2 `request-recovery.ts` marks every class `toolCallStarted` after a complete tool-call part,
      and `StreamRecovery` takes a pending failure with the carried count (design D1, D4). Verify in
      `request-recovery.test.ts`: no re-send of such a send, and the first send of a restored
      recovery waits the delay of retry `n + 1` and reports it to `onRetry`.
- [ ] 2.3 Wait for the open calls of the failed send (design D2). Verify the scenarios "One call
      still runs when the send breaks", "The owner stops the Run during the wait", and "A rejected
      call does not cause a second send", and the modified "An overload after a tool call".
- [ ] 2.4 Cut and supersede at the last settled tool part (design D3). Verify "The text after the
      last tool call is not kept", including the live bridge in `run-stream-bridge.test.ts` and the
      rebuild in `assistant-transcript` tests.
- [ ] 2.5 Continue with the next step and the carried count (design D4). Verify "The stream breaks
      after a tool call", "A provider breaks after each tool call", "A send without failure ends the
      count", "A reload during the delay of the next step", and "No retry is left for the next step".
- [ ] 2.6 Park and wake after a started call (design D6). Verify the `provider-failures` scenario "A
      usage limit after a tool call" and the `quota-wait` scenarios "A limit after a tool call parks
      the Run after the call settles", "The kept parts of a failed send survive the wait", "A woken
      Run continues after a tool call", and "A checkpoint holds the settled tool part", in
      `quota-wait.test.ts` and `quota-wait.integration.test.ts`. Re-verify the unchanged scenarios of
      those four requirements.
- [ ] 2.7 Add the `provider-failure` producer, template, labels, and precedence (design D5). Verify
      "A broken stream has a label" and "The next request carries the notice" in
      `context-item-producers.test.ts`, and the `context-injection` scenario "A provider-failure
      notice comes first in its step".
- [ ] 2.8 Fail a class with no retry after the wait (design D6). Verify "An authentication failure
      after a tool call" and "Owner Continue keeps the notice", and that the `tool-calling` scenario
      "Failure settles in-flight calls" still holds for a call outside the failed send.
- [ ] 2.9 Update [SPEC.md](../../../SPEC.md) (quota and failure paragraph),
      [scaling](../../../docs/product/operator/scaling.md) (quota wait after a started call),
      [provider routing](../../../docs/product/operator/providers/routing.md) (failure after a tool
      call), and [Continue a turn](../../../docs/product/reference/continue-a-turn.md) (the kept
      notice). Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 2.10 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused test files above,
      `pnpm format:check`, and `git diff --check`.
- [ ] 2.11 SR: self-review the parent-relative draft diff against
      [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md) before ready. GR: run Ready-PR monitoring after
      ready. This PR carries `Closes #1828`.

## 3. finalize

Enter `continue-after-broken-send/finalize` with `$gh-stack` before `$openspec-sync-specs` writes
canonical specs. SR and GR of this layer follow archive movement.

- [ ] 3.1 Run `$openspec-sync-specs` and check each MODIFIED requirement against its canonical text.
- [ ] 3.2 Confirm that every task above is checked and `openspec status --change
      continue-after-broken-send --json` reports every artifact complete.
- [ ] 3.3 `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all
      --strict`.

3.4 Post-readiness operation: run `$openspec-archive-change`. This operation is not a readiness
checkbox, because archive itself requires the preceding checklist to be complete. Record its native
result after execution.

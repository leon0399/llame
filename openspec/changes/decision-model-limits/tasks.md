# Tasks

Track [#1717](https://github.com/leon0399/llame/issues/1717) and the PRs of
this change through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation
waits for Leo's approval of the published proposal.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer.

```text
master
  <- decision-model-limits/proposal
  <- decision-model-limits/impl
  <- decision-model-limits/finalize
```

| Layer      | Parent     | Ownership                                                                                         | Authored estimate | Closes |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal` | `master`   | Proposal, design, five deltas, and this list.                                                     | ~950              | none   |
| `impl`     | `proposal` | Config fields, request packing, token estimate, card fit, provider concurrency, truncation, docs. | ~1,600            | #1717  |
| `finalize` | `impl`     | Spec sync, task records, archive.                                                                 | ~500              | none   |

## 1. proposal

- [x] 1.1 Create `decision-model-limits/proposal` from `master` with `$gh-stack` before any change file; write `proposal.md`, `design.md`, the `decision-models`, `instance-config`, `web-search`, `tool-result-rendering` and `grep-tool` deltas, and this list; verify `pnpm exec openspec validate decision-model-limits --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [x] 1.2 Run two independent adversarial reviews against code and canonical specs; verify each finding; commit each revision separately.
- [ ] 1.3 Publish the draft PR with `$gh-stack`; self-review (SR) the actual diff; mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. impl

- [ ] 2.1 Create `decision-model-limits/impl` from `proposal` with `$gh-stack`.
- [ ] 2.2 Accept and validate `decisionModels[].limits` and `system-one` `maxConcurrentRequests` in the schema, the JSON schema descriptions, the types and the loader; verify unit tests for each new scenario of `Decision model catalog configuration` and `Provider list configuration`, including whole-value interpolation, per-question above per-request, and indexed diagnostics that print no resolved value.
- [ ] 2.3 Implement the fixed estimate and greedy canonical packing under the 32-card request bound, the 256-card call bound and the entry's limits or defaults; verify unit tests for `Request estimates use a fixed formula`, `Cards fill each request in canonical order` (exact k and k+1 boundary), `Requests fit the limits of the model` (all three scenarios), `A batch is larger than the bound`, `A call has more cards than the call bound`, and `Some cards are not answered`; rewrite the existing 256- and 300-card cases in `decisions.service.test.ts` and `web-search/rerank.test.ts` to the new bounds. The bounds, slots and wall-time latency apply to the decision lane only: keep the 1,500-card rerank case (1,000 + 500, no call bound, no slots) green and unchanged.
- [ ] 2.4 Cut a card that alone exceeds a limit to its longest fitting code-point prefix after key replacement, and return `unavailable` with the new `state_too_large` reason and a 0-request log line when the card-free state does not fit; verify unit tests for both scenarios of `A card that alone exceeds the limit is cut to fit`, including a key that straddles the cut point.
- [ ] 2.5 Bound in-flight attempts per `system-one` provider id with a FIFO counting semaphore shared by every catalog entry and call; acquire per attempt, release on settle, abort a slot wait on the call's signal; measure the call's `latencyMs` as wall time; verify unit tests with a scripted fetch that counts concurrent attempts for `All requests of one call are in flight`, `Requests of one call share the provider bound`, every scenario of `Concurrent attempts to one provider are bounded`, and `The owner cancels while requests wait for a slot`.
- [ ] 2.6 Read `usage.truncated` and `usage.state_tokens_dropped` in the usage schema and fail closed on a report or a wrong type with `invalid_response`; verify unit tests for the three scenarios of `A truncation report makes its request unavailable` and the unchanged `Invalid usage cannot enter aggregates`.
- [ ] 2.7 Verify the `web-search` scenario `A larger aggregate uses parallel requests`, the `tool-result-rendering` scenario `A partial answer lists unjudged keys last`, and the `grep-tool` scenarios `A walk has more runs than the call bound` and `A partial answer ranks the judged runs` with tool-level tests; update the `grep-rerank.ts` comment that says every card is judged.
- [ ] 2.8 Add the cross-card injection case to `fixtures/ranking` and a reversed-order variant to `ranking:record`; record Jev answers with live keys and post the `ranking:eval` table on the PR. This is a live-model eval, not a CI test.
- [ ] 2.9 Update `docs/product/operator/decisions.md`: limits, defaults, the estimate, guidance for small members and fixed question reserves, the 32-card request and 256-card call bounds (replacing "256 cards … sent at once"), per-process and per-provider-id concurrency, and the truncation backstop, and that `maxQuestionsPerRequest` above 32 has no effect; update `docs/product/reference/tools/grep.md` and `docs/product/reference/tools/web-search.md` where they say every card is judged; update the config example and the dated `CHANGELOG.md` entry.
- [ ] 2.10 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 3. finalize

- [ ] 3.1 Create `decision-model-limits/finalize` from `impl` with `$gh-stack` before any sync write.
- [ ] 3.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 3.3 Confirm every task above is checked and that the impl PR's closing references list #1717.
- [ ] 3.4 Run `$openspec-archive-change`; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.

The finalize layer's self-review and GitHub review follow archive movement as
post-archive gates.

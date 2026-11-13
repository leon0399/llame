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
| `proposal` | `master`   | Proposal, design, two deltas, and this list.                                                      | ~750              | none   |
| `impl`     | `proposal` | Config fields, request packing, token estimate, card fit, provider concurrency, truncation, docs. | ~1,300            | #1717  |
| `finalize` | `impl`     | Spec sync, task records, archive.                                                                 | ~500              | none   |

## 1. proposal

- [x] 1.1 Create `decision-model-limits/proposal` from `master` with `$gh-stack` before any change file; write `proposal.md`, `design.md`, the `decision-models` and `instance-config` deltas, and this list; verify `pnpm exec openspec validate decision-model-limits --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two independent adversarial reviews against code and canonical specs; verify each finding; commit each revision separately.
- [ ] 1.3 Publish the draft PR with `$gh-stack`; self-review (SR) the actual diff; mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. impl

- [ ] 2.1 Create `decision-model-limits/impl` from `proposal` with `$gh-stack`.
- [ ] 2.2 Accept and validate `decisionModels[].limits` and `system-one` `maxConcurrentRequests` in the schema, the JSON schema descriptions, the types and the loader; verify unit tests for each new scenario of `Decision model catalog configuration` and `Provider list configuration`, including whole-value interpolation and the indexed diagnostics.
- [ ] 2.3 Pack requests greedily in canonical order under the 32-card cap and the entry's limits or defaults, with the `ceil(utf8Bytes / 3)` estimate over the serialized state and questions; verify unit tests for `Requests fit the limits of the model`, `Requests are bounded and sent together` (70 cards, three requests) and `A judge result reports probabilities or unavailability` (40 cards, 8 unanswered keys).
- [ ] 2.4 Cut a card that alone exceeds a limit after key replacement, and leave it unjudged when the state alone does not fit; verify unit tests for both scenarios of `A card that alone exceeds the limit is cut to fit`, including a key that straddles the cut point.
- [ ] 2.5 Bound in-flight requests per `system-one` provider with a counting semaphore shared by every catalogue entry and call; release on success, failure and abort; verify unit tests with a scripted fetch that counts concurrent calls for both scenarios of `Concurrent requests to one provider are bounded`, plus an abort while requests wait.
- [ ] 2.6 Make a response with `usage.truncated: true` or `usage.state_tokens_dropped > 0` unavailable; verify unit tests for both scenarios of `A truncation report makes its request unavailable`.
- [ ] 2.7 Add the cross-card injection case to `fixtures/ranking`, let `ranking:record` record it, and record Jev answers with live keys; post the `ranking:eval` table on the PR. This is a live-model eval, not a CI test.
- [ ] 2.8 Update `docs/product/operator/decisions.md` (limits, defaults, the estimate, per-process concurrency, the truncation backstop), the config example, and the dated `CHANGELOG.md` entry.
- [ ] 2.9 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 3. finalize

- [ ] 3.1 Create `decision-model-limits/finalize` from `impl` with `$gh-stack` before any sync write.
- [ ] 3.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 3.3 Confirm every task above is checked and that the impl PR's closing references list #1717.
- [ ] 3.4 Run `$openspec-archive-change`; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.

The finalize layer's self-review and GitHub review follow archive movement as
post-archive gates.

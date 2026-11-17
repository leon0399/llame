# Tasks

Track [#1717](https://github.com/leon0399/llame/issues/1717),
[#1745](https://github.com/leon0399/llame/issues/1745) and the PRs of this
change through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation
waits for Leo's approval of the published proposal.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer.

```text
master
  <- decision-model-limits/proposal
  <- decision-model-limits/decision-wires
  <- decision-model-limits/catalog-rename
  <- decision-model-limits/impl
  <- decision-model-limits/fixtures
  <- decision-model-limits/finalize
```

| Layer            | Parent           | Ownership                                                                                          | Authored estimate | Closes |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`       | `master`         | Proposal, design, seven deltas, and this list.                                                     | ~1,100            | none   |
| `decision-wires` | `proposal`       | The `openrouter-decisions` wire and endpoint selection by resolved wire, with route fixtures.      | ~250              | none   |
| `catalog-rename` | `decision-wires` | `model` to `providerModelId` in both rank catalogs, with every caller, fixture, and doc.           | ~350              | #1745  |
| `impl`           | `catalog-rename` | Config limits, request packing, token estimate, card fit, per-entry concurrency, truncation, docs. | ~1,650            | #1717  |
| `fixtures`       | `impl`           | Cross-card injection case and recorded live answers for `ranking:eval`.                            | ~960              | none   |
| `finalize`       | `fixtures`       | Spec sync, task records, archive.                                                                  | ~700              | none   |

## 1. proposal

- [x] 1.1 Create `decision-model-limits/proposal` from `master` with `$gh-stack` before any change file; write `proposal.md`, `design.md`, the `decision-models`, `instance-config`, `rerank-models`, `provider-api-selection`, `web-search`, `tool-result-rendering` and `grep-tool` deltas, and this list; verify `pnpm exec openspec validate decision-model-limits --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [x] 1.2 Run two independent adversarial reviews against code and canonical specs; verify each finding; commit each revision separately.
- [ ] 1.3 Publish the draft PR with `$gh-stack`; self-review (SR) the actual diff; mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. decision-wires

- [ ] 2.1 Create `decision-model-limits/decision-wires` from `proposal` with `$gh-stack`.
- [ ] 2.2 Add `openrouter-decisions` to the decision wires in `provider-routing.ts` and the schema `modelWire` enum; make `decisionEndpoint` select the path from the resolved wire; keep `openrouter`'s default; verify unit tests for every scenario of `The resolved decision wire selects the endpoint` and `Two decision models on one account use different routes`, and that `openai-codex` and `opencode-go` still reject both wires.
- [ ] 2.3 Commit the 2026-11-17 captured responses from both OpenRouter routes as client fixtures and replay them through the decision client; verify both parse to the same answers and usage.
- [ ] 2.4 Update `docs/product/operator/decisions.md`, `docs/product/operator/providers/routing.md`, the JSON schema descriptions, and the dated `CHANGELOG.md` entry.
- [ ] 2.5 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 3. catalog-rename

- [ ] 3.1 Create `decision-model-limits/catalog-rename` from `decision-wires` with `$gh-stack`.
- [ ] 3.2 Rename `model` to `providerModelId` in `decisionModels[]` and `rerankModels[]`: schema, types, loader, diagnostics, `decisions.service.ts`, `ranking/record.ts`, and every test and config fixture; keep a tool's `rerank.model`; verify unit tests for `Decision model catalog entries carry a provider model id`, `Decision model catalog fields accept interpolation`, `The rerank catalog names models by id`, and `A rerank call reports scores, usage, and cost`, including startup failure for the former field.
- [ ] 3.3 Update `docs/product/operator/decisions.md`, `apps/api/llame.config.jsonc.example`, and the dated `CHANGELOG.md` entry with a **Breaking** note.
- [ ] 3.4 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 4. impl

- [ ] 4.1 Create `decision-model-limits/impl` from `catalog-rename` with `$gh-stack`.
- [ ] 4.2 Accept and validate `decisionModels[].limits`, including `maxConcurrentRequests`, in the schema, the JSON schema descriptions, the types and the loader; verify unit tests for each new scenario of `Decision model catalog configuration`, including whole-value interpolation, per-question above per-request, and indexed diagnostics that print no resolved value.
- [ ] 4.3 Implement the fixed estimate and greedy canonical packing under the 32-card request bound, the 256-card call bound and the entry's limits or defaults; verify unit tests for `Request estimates use a fixed formula`, `Cards fill each request in canonical order` (exact k and k+1 boundary), `Requests fit the limits of the model` (all three scenarios), `A batch is larger than the bound`, `A call has more cards than the call bound`, and `Some cards are not answered`; rewrite the existing 256- and 300-card cases in `decisions.service.test.ts` and `web-search/rerank.test.ts` to the new bounds. The bounds, slots and wall-time latency apply to the decision lane only: keep the 1,500-card rerank case (1,000 + 500, no call bound, no slots) green and unchanged.
- [ ] 4.4 Cut a card that alone exceeds a limit to its longest fitting code-point prefix after key replacement, and return `unavailable` with the new `state_too_large` reason and a 0-request log line when the card-free state does not fit; verify unit tests for both scenarios of `A card that alone exceeds the limit is cut to fit`, including a key that straddles the cut point.
- [ ] 4.5 Bound in-flight attempts per catalog entry with a FIFO counting semaphore shared by every call to that entry, default 32; acquire per attempt, release on settle, abort a slot wait on the call's signal; measure the call's `latencyMs` as wall time; verify unit tests with a scripted fetch that counts concurrent attempts for `All requests of one call are in flight`, `Requests of one call share the entry bound`, every scenario of `Concurrent attempts to one catalog entry are bounded`, and `The owner cancels while requests wait for a slot`.
- [ ] 4.6 Read `usage.truncated` and `usage.state_tokens_dropped` in the usage schema and fail closed on a report or a wrong type with `invalid_response`; verify unit tests for the three scenarios of `A truncation report makes its request unavailable` and the unchanged `Invalid usage cannot enter aggregates`.
- [ ] 4.7 Verify the `web-search` scenario `A larger aggregate uses parallel requests`, the `tool-result-rendering` scenario `A partial answer lists unjudged keys last`, and the `grep-tool` scenarios `A walk has more runs than the call bound` and `A partial answer ranks the judged runs` with tool-level tests; update the `grep-rerank.ts` comment that says every card is judged.
- [ ] 4.8 Add a reversed-order variant to `ranking:record`; verify `record.test.ts`.
- [ ] 4.9 Update `docs/product/operator/decisions.md`: limits, defaults, the estimate, guidance for small members and fixed question reserves, the 32-card request and 256-card call bounds (replacing "256 cards … sent at once"), per-process and per-entry concurrency with the default of 32 and the link to #1746, the truncation backstop and that OpenRouter reports no truncation, and that `maxQuestionsPerRequest` above 32 has no effect; update `docs/product/reference/tools/grep.md` and `docs/product/reference/tools/web-search.md` where they say every card is judged; update the config example and the dated `CHANGELOG.md` entry.
- [ ] 4.10 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 5. fixtures

- [ ] 5.1 Create `decision-model-limits/fixtures` from `impl` with `$gh-stack`.
- [ ] 5.2 Add the cross-card injection case to `fixtures/ranking`; record Jev answers in canonical and reversed order, and Laya answers under declared limits with one request in flight, with live keys; post the `ranking:eval` table on the PR. This is a live-model eval, not a CI test.
- [ ] 5.3 Run the focused ranking tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish with `$gh-stack`; SR; mark ready; GR; update the Project.

## 6. finalize

- [ ] 6.1 Create `decision-model-limits/finalize` from `fixtures` with `$gh-stack` before any sync write.
- [ ] 6.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 6.3 Confirm every task above is checked, that the impl PR's closing references list #1717, and that the catalog-rename PR's list #1745.
- [ ] 6.4 Run `$openspec-archive-change`; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.

The finalize layer's self-review and GitHub review follow archive movement as
post-archive gates.

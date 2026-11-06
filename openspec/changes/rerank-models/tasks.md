# Tasks

Track [#1434](https://github.com/leon0399/llame/issues/1434) and the PRs of
this change through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation
waits for Leo's approval of the published proposal.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer.

```text
master
  <- rerank-models/proposal
  <- rerank-models/impl
  <- rerank-models/finalize
```

| Layer      | Parent     | Ownership                                                                                | Authored estimate | Closes |
| ---------- | ---------- | ---------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal` | `master`   | Proposal, design, deltas, and this list.                                                 | ~700              | none   |
| `impl`     | `proposal` | Provider type, catalog, rerank client, rank-seat routing, eval scripts, docs, CHANGELOG. | ~1,800            | #1434  |
| `finalize` | `impl`     | Spec sync, task records, archive.                                                        | ~700              | none   |

The `impl` layer starts from the experiment branch `experiment/rerank-models`
and conforms it to the approved deltas.

## 1. proposal

- [x] 1.1 Create `rerank-models/proposal` from `master`; write `proposal.md`, `design.md`, the four deltas, and this list; verify `pnpm exec openspec validate rerank-models --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two independent adversarial reviews against code and canonical specs; verify each finding; commit the revision separately.
- [ ] 1.3 Publish the draft PR with `$gh-stack`; self-review (SR); mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. impl

- [ ] 2.1 Create `rerank-models/impl` from `proposal` with `$gh-stack`; import the experiment files as one commit.
- [ ] 2.2 Rename the provider type to `cohere-rerank` in the schema, types, loader, factory guard, and tests; make `key` and `baseUrl` optional with the Cohere default URL and the keyless-needs-`baseUrl` rule; reject `accountId`; give the type an empty default header map and refuse `{session:id}`; verify unit tests for each scenario of `Provider list configuration`, the three header requirements, and `A cohere-rerank provider speaks the rerank wire`.
- [ ] 2.3 Resolve `rerankModels[]` with interpolation, one id namespace across both catalogs, indexed diagnostics, and server-only output; resolve both `rerank.model` references against both catalogs; verify unit tests (deltas: `The rerank catalog names models by id`, `Rank model ids are unique across both catalogs`, `Rerank models stay server-only`, both `rerank` configuration requirements, `A model entry cannot name a decision provider`).
- [ ] 2.4 Rerank client: one SDK attempt per try (`maxRetries: 0`) inside the decision client's attempt loop, backoff, and `retry-after` cap; one request per 1,000 cards, all sent together; key replacement before the card cut; the `meta` fill; a 1 MiB streamed body cap; no `Authorization` and no environment credential for a keyless entry; every-index validation and finite scores; the representative served model and its key check; usage counts and cost with the null rule. Verify unit tests with scripted fetch: an OpenRouter-shaped body without `meta`, a skipped, duplicate, or out-of-range index, 1,500 cards, a timeout then success, `retry-after: 30` waiting at most 5 seconds, an oversized stream, a keyless call with `COHERE_API_KEY` set, a keyless call whose operator header map sets `Authorization`, a served id that contains the key, a two-request usage sum with one missing count, and an abort during a retry wait (deltas: every `rerank-models` requirement, `Message usage aggregates every model request of its attempt`).
- [ ] 2.5 Route the rank seat by catalog kind so both tools rank with either backend; reuse the decision-lane failure merge, log line, and key protection; verify a tool-level test for each tool with a rerank model, a failed request, and the enclosing timeout.
- [ ] 2.6 `ranking:record` and `ranking:eval` accept rerank model ids; record `rr-fast` and `rr-pro` answers with live keys; post the `ranking:eval` table on the PR.
- [ ] 2.7 Update `docs/product/operator/decisions.md` (rank models: decision and rerank, the compatibility list, keyless self-hosting, cost), the config example, and the dated CHANGELOG entry.
- [ ] 2.8 Run api lint, typecheck, focused unit tests, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`; publish; SR with multi-agent local reviews; ready; GR; update the Project.

## 3. finalize

- [ ] 3.1 Create `rerank-models/finalize` from `impl` with `$gh-stack` before any sync write.
- [ ] 3.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `--all --strict`.
- [ ] 3.3 Confirm every task above is checked and `gh pr view` closing references list #1434 on the impl PR.
- [ ] 3.4 Run `$openspec-archive-change`; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.

## Workflow follow-up

- Close [#1436](https://github.com/leon0399/llame/issues/1436) as not planned with the rationale in the proposal when the impl layer merges.
- Follow-ups filed: [#1605](https://github.com/leon0399/llame/issues/1605), [#1606](https://github.com/leon0399/llame/issues/1606), [#1607](https://github.com/leon0399/llame/issues/1607), [vercel/ai#24699](https://github.com/vercel/ai/issues/24699).

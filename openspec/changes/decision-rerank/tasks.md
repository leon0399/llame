# Tasks

Track [#1521](https://github.com/leon0399/llame/issues/1521),
[#1433](https://github.com/leon0399/llame/issues/1433),
[#1435](https://github.com/leon0399/llame/issues/1435), and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Implementation waits for Leo's approval of the published proposal revision.
Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only. The experimental
branches `decisions/client`, `decisions/web-search-rerank`, and
`decisions/grep-rerank` (PRs #1584, #1588, #1590) are the source of the
`lane`, `web-search`, and `grep` layers: each is rebased onto its new parent,
its branch renamed on GitHub so the PR follows, and then changed to this
plan. The `config` layer is split out of `decisions/client` so that no layer
exceeds the budget.

```text
master
  <- decision-rerank/proposal
  <- decision-rerank/config
  <- decision-rerank/lane
  <- decision-rerank/engine
  <- decision-rerank/web-search
  <- decision-rerank/grep
  <- decision-rerank/ui
  <- decision-rerank/finalize
```

| Layer        | Parent       | Ownership                                                                                                                               | Authored estimate | Closes       |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------ |
| `proposal`   | `master`     | Proposal, design, deltas, and this task list.                                                                                           | ~1,700            | none         |
| `config`     | `proposal`   | `system-one` provider type, `decisionModels[]`, `webSearch.rerank` and `tools.grep.rerank` (`{ model }` only), schema, loader, example. | ~850              | none         |
| `lane`       | `config`     | The decision client, protocol, service, logger, module, `ToolContext.decisions`, operator doc.                                          | ~1,750            | none         |
| `engine`     | `lane`       | `apps/api/src/ranking/` shared engine, labeled fixtures, `ranking:eval` script, recorded answers.                                       | ~700              | none         |
| `web-search` | `engine`     | The rerank stage on every `results` outcome, the fits-limit guard, the failure note, within-engine dedupe, `display.rerank`, docs.      | ~1,000            | #1433, #1435 |
| `grep`       | `web-search` | `objective`, whole-run ranking after the walk, the fits-inline guard, the failure line, `display.rerank`, the prompt, docs.             | ~1,000            | #1521        |
| `ui`         | `grep`       | `display.rerank` badge and per-row scores in the grep and web search parts, stories.                                                    | ~500              | none         |
| `finalize`   | `ui`         | Spec synchronization, task records, archive movement.                                                                                   | ~1,300            | none         |

Estimates are authored lines against the immediate parent (tests, docs, and
specs included). Generated output: none; `pnpm-lock.yaml` is untouched.

## 1. proposal

- [x] 1.1 Create `decision-rerank/proposal` from `master` with `$gh-stack` before any artifact is written; verify `git branch --show-current`.
- [x] 1.2 Write `proposal.md`, `design.md`, the five deltas, and this list; verify `pnpm exec openspec validate decision-rerank --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [ ] 1.3 Commit the initial draft; run `$iterative-review-refinement` with two independent reviewers; verify each finding against code, specs, or issues; commit each round separately.
- [ ] 1.4 Publish the draft PR with `$gh-stack`, self-review the diff (SR), mark ready, run the GitHub review loop (GR) and [Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring); obtain Leo's approval of the published revision; update the Project.

## 2. config

- [ ] 2.1 Create `decision-rerank/config` from `proposal` with `$gh-stack`; import from `decisions/client` only `llame-config.ts`, `llame.config.schema.json`, `config-loader.ts`, `tool-rerank-config.ts`, `web-search-config.ts`, `decisions-config.test.ts`, `model-client-factory.ts`, `llame.config.jsonc.example`; verify `git diff --stat proposal` lists only those.
- [ ] 2.2 Delete `mode` from `webSearch.rerank` and `tools.grep.rerank` (schema, types, loader, example, test); verify a config with `mode` fails startup as an unknown key (instance-config delta: `Web search rerank configuration`, `Operator configuration can bound grep walks`).
- [ ] 2.3 Interpolate `decisionModels[].id`, `provider`, and `model` like other fields and fail a blank resolution naming the path; verify with unit tests (delta: `Decision model catalog fields accept interpolation`).
- [ ] 2.4 Verify every failure message of the deltas with a unit test each: unknown provider, wrong type, duplicate id, blank model, unknown `webSearch.rerank.model`, unknown `tools.grep.rerank.model`, a `models[]` entry naming a `system-one` provider; verify `GET /api/v1/models` lists no decision model (`available-models` test).
- [ ] 2.5 Run `pnpm --filter api lint`, `typecheck`, the focused unit files, `pnpm format:check`, `git diff --check`; publish the draft with `$gh-stack`; SR; ready; GR; update the Project.

## 3. lane

- [ ] 3.1 Create `decision-rerank/lane` from `config` with `$gh-stack`; rename `decisions/client` on GitHub to `decision-rerank/lane` so PR #1584 follows; import `apps/api/src/decisions/*`, `tools/types.ts`, `run-execution.service.ts`, `run-worker.module.ts`, `decisions.module.ts`, `docs/product/operator/decisions.md`, the CHANGELOG entry; retarget #1584 to `config`; verify `gh pr view 1584 --json baseRefName`.
- [ ] 3.2 Delete `rerankMode` and every `shadow` word from the lane; keep `judgeCandidates({ model, … })`; verify `grep -rn shadow apps/api/src/decisions` is empty.
- [ ] 3.3 Verify the `decision-models` delta with the existing unit tests, extended where a scenario is uncovered: 256 cards per request and parallel requests with only their own cards (no card text in two requests), 10 s attempt, 3 attempts on 408/429/5xx, `retry-after` up to 5 s, 1 MiB body, malformed answers, a failed request leaves only its cards unjudged, `unavailable` only when all fail, the log line fields, no secret in logs or errors (negative test with a known key value).
- [ ] 3.4 Rewrite `docs/product/operator/decisions.md`: no `mode`; the consent paragraph (naming a model is the declaration for everything the tool admits, `kb://` and `machine://` included); the ranking section; verify `pnpm lint:markdown`.
- [ ] 3.5 Run lint, typecheck, focused units, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 4. engine

- [ ] 4.1 Create `decision-rerank/engine` from `lane` with `$gh-stack`; add `apps/api/src/ranking/rank-cards.ts`: `{ judge, model, objective?, query, cards, rubric } → { status: 'ranked' | 'partial' | 'unavailable', order, scores }`; assert the order is a permutation; verify unit tests for sort, stable tie, unjudged after judged, `partial`, `unavailable`, and a thrown error on a non-permutation.
- [ ] 4.2 Add `apps/api/fixtures/ranking/*.json` (`{ tool, query, objective?, cards: [{ key, text, relevant }] }`): the two real-repo grep cases (retry backoff budget; permission reject regexes) and two web search cases, labeled by hand; add recorded decision answers for them; verify the engine tests load them.
- [ ] 4.3 Add `scripts/ranking-eval.mjs` and `pnpm --filter api ranking:eval`: for each fixture and each `decisionModels[]` entry of the local config, call the lane and print nDCG@5 and MRR for canonical order and each model; verify a run on Leo's keys prints the table and the proposal's claims hold (implementations first).
- [ ] 4.4 Run lint, typecheck, `pnpm exec knip`, focused units, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 5. web-search

- [ ] 5.1 Create `decision-rerank/web-search` from `engine` with `$gh-stack`; rename `decisions/web-search-rerank` on GitHub to `decision-rerank/web-search` so #1588 follows; rebase its commits; retarget #1588 to `engine`.
- [ ] 5.2 Replace the tool-local sort with the engine; delete `mode`; rank only when the fetched count exceeds `limit`; rank every `results` outcome whatever engine won; verify unit tests for the 20/10 and 5/10 scenarios and a `parallel` winner (web-search delta: `Results are ranked by the objective before the inline cut`, `Ranked results sort by score and keep engine order on a tie`).
- [ ] 5.3 Add the `rerank: unavailable` note on total failure and none on partial; verify unit tests and the rendered `[rerank: unavailable]` placement (tool-result-rendering delta: `A web search ranking failure renders one note`).
- [ ] 5.4 Deduplicate one engine's results by the aggregate grouping key in the output layer; verify the 13-results-one-repeat scenario (delta: `One engine's results are deduplicated by URL`).
- [ ] 5.5 Keep `display.rerank: { model, order, scores, latencyMs, costUsd }`; verify the stored part carries it and the live and replayed texts do not (delta: `The rank record is display data`).
- [ ] 5.6 Update `docs/product/reference/tools/web-search.md`, the CHANGELOG entry, and `apps/api/src/prompts/tools/web_search.md` if its ranking sentence changes; verify `pnpm lint:markdown`.
- [ ] 5.7 Run lint, typecheck, focused units, `pnpm format:check`, `git diff --check`; publish with `Closes #1433` and `Closes #1435`; SR; ready; GR; update the Project.

## 6. grep

- [ ] 6.1 Create `decision-rerank/grep` from `web-search` with `$gh-stack`; rename `decisions/grep-rerank` on GitHub to `decision-rerank/grep` so #1590 follows; rebase; retarget #1590 to `web-search`.
- [ ] 6.2 Replace the tool-local permutation with the engine; delete `mode`; rank only when the result does not fit the inline part and has at least three runs; verify unit tests for the fits-inline and small-walk scenarios (grep-tool delta: `Ranking runs only when the model cannot see the whole result`).
- [ ] 6.3 Verify the whole-run permutation keeps passages contiguous, one `## <path>` per run, unchanged counts, warnings, bounds, and stop, and that the inline part, artifact text, and findings share the order (delta: `A ranked order sorts the judged runs and changes nothing else`, `Passages follow scope order and walk order`).
- [ ] 6.4 Add the `ranking unavailable; walk order` line on total failure and none on partial; verify unit tests and the rendered position after `[warnings: …]` (tool-result-rendering delta: `A grep page groups consecutive passages under one file line`, `A grep ranking failure renders one framing line`).
- [ ] 6.5 Verify the negative scenario: a walk over host and `kb://` scopes builds cards only from runs the `read` group admitted (delta: `The rank makes one card for each file run`).
- [ ] 6.6 Update `apps/api/src/prompts/tools/grep.md` (`objective`, whole-file ordering, no mode), `docs/product/reference/tools/grep.md`, the CHANGELOG entry; verify `pnpm lint:markdown`.
- [ ] 6.7 Run lint, typecheck, focused units, `pnpm format:check`, `git diff --check`; publish with `Closes #1521`; SR; ready; GR; update the Project.

## 7. ui

- [ ] 7.1 Create `decision-rerank/ui` from `grep` with `$gh-stack`; add a `display.rerank` schema to `packages/ui/src/components/custom/grep.tsx` and `web-search.tsx`; show one badge (served model, latency, cost) and a score beside each judged row; verify stories for ranked, unavailable, and absent through Storybook MCP tests (tool-result-rendering delta: `The owner UI shows the rank record`).
- [ ] 7.2 Add `objective` to the grep part's input schema so the Parameters panel shows it; verify the story.
- [ ] 7.3 Run `pnpm --filter @workspace/ui lint`, `typecheck`, Storybook tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 8. finalize

- [ ] 8.1 After every implementation layer is published, verified, and checked, create `decision-rerank/finalize` from `ui` with `$gh-stack` before `$openspec-sync-specs` writes; verify `git branch --show-current`.
- [ ] 8.2 Run `$openspec-sync-specs`; check each MODIFIED requirement and the cross-capability wording (`ranking unavailable; walk order`, `rerank: unavailable`, `display.rerank`) for consistency; verify `pnpm exec openspec validate --specs --strict` and `--all --strict`.
- [ ] 8.3 Confirm every task above is checked and `openspec status --change decision-rerank --json` shows every artifact complete; verify the issue map (#1521, #1433, #1435 closed by their layers; #1518 and #1430 reworded).
- [ ] 8.4 Run `$openspec-archive-change`; verify the change moved under `openspec/changes/archive/` and `pnpm lint:markdown`, `pnpm format:check`, `git diff --check` pass.

## Workflow follow-up

- Publish the finalize PR as draft with `$gh-stack`; after archive movement, self-review the diff, mark ready, run Ready-PR monitoring.
- Merge only under [Merge](../../../CONTRIBUTING.md#merge) with Leo's explicit permission, through `$gh-stack`.
- Follow-ups filed: [#1592](https://github.com/leon0399/llame/issues/1592) side-call usage ledger (absorbs #1439); [#1593](https://github.com/leon0399/llame/issues/1593) AI SDK decision transport after the ai 7 upgrade.

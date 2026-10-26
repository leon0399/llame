Track [#1431](https://github.com/leon0399/llame/issues/1431),
[#1432](https://github.com/leon0399/llame/issues/1432),
[#1437](https://github.com/leon0399/llame/issues/1437), and
[#1438](https://github.com/leon0399/llame/issues/1438) under the epic
[#1430](https://github.com/leon0399/llame/issues/1430) through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer
is created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed
before it is marked ready, and monitored per `CONTRIBUTING.md`.

```text
(master) <- extend-web-search/proposal
         <- extend-web-search/limits-objective
         <- extend-web-search/deepseek-parallel
         <- extend-web-search/yandex
         <- extend-web-search/aggregate-answers
         <- extend-web-search/engine-selection
         <- extend-web-search/finalize
```

| Layer               | Parent              | Owns                                                                                                                                | Closes | Estimated authored lines                                    |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `proposal`          | `master`            | this ledger, the proposal, the design, two delta specs, and the objective spike research bundle                                     | none   | about 2,400; see the budget note                            |
| `limits-objective`  | `proposal`          | per-engine query limits, the `unsupported` class, the `objective` input and its mapping on existing engines, description text, docs | #1431  | about 1,400                                                 |
| `deepseek-parallel` | `limits-objective`  | the `deepseek`, `parallel`, and `parallel-mcp` types and engines, and their docs                                                    | none   | about 1,800                                                 |
| `yandex`            | `deepseek-parallel` | the `yandex` and `yandex-gen` types and engines, and their docs                                                                     | #1437  | about 1,700                                                 |
| `aggregate-answers` | `yandex`            | answer children in aggregates, `answers` output and bounds, the renderer and stories, docs                                          | #1438  | about 1,600                                                 |
| `engine-selection`  | `aggregate-answers` | the `engines` input, the execution-time id check, the generated catalog, the `description` field, docs                              | #1432  | about 1,200                                                 |
| `finalize`          | `engine-selection`  | spec synchronization, task records, and archive movement only                                                                       | none   | under 300 (archive movement measured with rename detection) |

Each engine-owning layer adds its own type's schema branch, loader shape, and validation, so no
layer accepts a type it cannot run. Each layer leaves the repository shippable and adds its own
operator documentation and dated `CHANGELOG.md` entry; nothing in `ROADMAP.md` tracks this work.
The epic #1430 stays open after `engine-selection`, because its rerank slices remain.

Budget note: the proposal layer exceeds about 2,000 authored lines because of two named
exceptions, recorded here for Leo's approval: the six MODIFIED blocks are copied whole and
rewritten in Simplified Technical English, and the layer also commits the objective spike
research bundle (two runners and three result files) that justifies D2 and D6. Re-estimate each
implementation layer at its boundary. If `deepseek-parallel` exceeds about 2,000 lines, move
`parallel-mcp` to its own layer above it. No layer has generated output.

## 0. `extend-web-search/proposal` — planning artifacts

- [ ] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited vendor sources; commit each round separately and record it in the PR body
- [ ] 0.2 Verify every MODIFIED block against its canonical requirement, keeping every canonical scenario heading, and keep each requirement's prose under 500 characters
- [ ] 0.3 Verify `pnpm exec openspec validate extend-web-search --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [ ] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [ ] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision, including the D5 deviation, before creating `extend-web-search/limits-objective`

## 1. `extend-web-search/limits-objective` — query limits and objective (design D2, D6)

- [ ] 1.1 Add `unsupported` to the failure classes and its fixed message; add a per-engine query limit (code points and words) checked before any request, with `brave` at 600 characters and 75 words; verify by chain unit tests with a fake limited engine and `brave` for the "An over-long query skips the engine" scenario of "Engines skip queries over their query limit" and the "Query limit failure" scenario of "Total failure is a fixed, non-disclosing error"
- [ ] 1.2 Give each engine type a vendor result maximum and send `min(limit, maximum)`, cutting results to `limit` where the vendor has no count parameter; verify by engine unit tests with a fake engine whose maximum is 10 for "Engines clamp the result count to their vendor maximum"
- [ ] 1.3 Skip `aggregate` children whose limit the query exceeds, noting each as `unsupported`, and fail with `unsupported` when every child is skipped; verify by aggregate unit tests with fake children whose limits are 128 and 200, mirroring the scenarios of "Aggregate engines run only the children that accept the query"
- [ ] 1.4 Add `objective` (1 to 2,000 units) to the input schema and `EngineRequest`; send it as `objective` from `exa` and `exa-mcp` with the query as fallback; add the `Goal:` line to the `model-hosted` message; note `objective not applied by <id>` on `brave`, `perplexity`, `searxng`, and `duckduckgo`; verify by engine and schema unit tests for the `exa`, `exa-mcp`, and note scenarios of "Engines receive the objective where their vendor accepts one", the "Objective becomes a goal line" scenario, and that no engine adds the objective to its query
- [ ] 1.5 Update `prompts/tools/web_search.md` to describe `objective` and the query limits briefly and to ask for a short keyword query and a concise objective; verify by the prompt-loader test that the packaged description renders
- [ ] 1.6 Document `objective`, query limits, and `unsupported` in `docs/product/operator/web-search.md` (including that the objective is outbound text) and `docs/product/reference/tools/web-search.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 1.7 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR carries `Closes #1431`
- [ ] 1.8 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 1.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `extend-web-search/deepseek-parallel` — DeepSeek and Parallel (design D7, D8)

- [ ] 2.1 Add the `deepseek`, `parallel` (with `mode`, default `fast`), and `parallel-mcp` schema branches and loader shapes; verify by loader tests for the scenarios of "New web search engine types have fixed shapes"
- [ ] 2.2 Implement the `deepseek` engine: request, `ori_question` cut to 128 code points, `after:` recency or its note, `summary` snippets, status classes, and the 128 limit; verify by fixture tests for every scenario of "DeepSeek engines call the DeepSeek search API", the DeepSeek objective scenario, and the "A small limit passes unchanged" scenario, including that a 401 body echoing the key never reaches output
- [ ] 2.3 Implement the `parallel` engine: request, `objective`, `mode`, `session_id` from the Chat id, source policy from `site:` operators, `after_date`, excerpt snippets, status classes, and the 200 limit; verify by fixture tests for every scenario of "Parallel engines call the Parallel search API" and the Parallel objective scenario
- [ ] 2.4 Implement the `parallel-mcp` engine on the existing `@ai-sdk/mcp` client: keyless `web_search` call, `objective ?? query`, `isError` as `upstream_error` without vendor text, and no model-facing declaration; verify by tests against a local Streamable HTTP MCP fixture for "Keyless Parallel engines call the hosted Parallel MCP tool"
- [ ] 2.5 Verify the scenarios of "Aggregate engines run only the children that accept the query" with real `deepseek` and `parallel` children against recorded fixtures
- [ ] 2.6 Document the three engines, their keys, prices, modes, retention and training terms, and session-id exposure in the runbook; add commented examples to `llame.config.jsonc.example`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 2.7 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR references #1437
- [ ] 2.8 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 2.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `extend-web-search/yandex` — Yandex web and generative search (design D9)

- [ ] 3.1 Add the `yandex` and `yandex-gen` schema branches with `searchType` and optional `folderId`; verify by loader tests for the scenarios of "Yandex web search engines have fixed shapes"
- [ ] 3.2 Implement the `yandex` engine: request with flat groups, base64 XML parsing with `linkedom`, in-body error classification, recency periods and notes, the 400-character and 40-word limit, and the objective note; verify by tests against recorded XML fixtures for every scenario of "Yandex engines call the Yandex web search API" and "Yandex engines classify errors from the response body", the "A word limit applies" scenario, including that error text never reaches output
- [ ] 3.3 Implement the `yandex-gen` engine: one user message with the query, recency phrase, and `Goal:` line, used sources as citations, and rejected or unsourced answers as `ungrounded`; verify by fixture tests for every scenario of "Generative Yandex engines answer with the sources they used"
- [ ] 3.4 Document both engines, keys, folder ids, prices, rate limits, Russian residency and the 152-FZ statement, and the result-order clause of the terms as an operator responsibility in the runbook; add commented examples to `llame.config.jsonc.example`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 3.5 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR carries `Closes #1437`
- [ ] 3.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 3.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `extend-web-search/aggregate-answers` — answer engines inside aggregates (design D10)

- [ ] 4.1 Admit `model-hosted` and `yandex-gen` as `aggregate` children in the loader and schema; update the tests that pinned the old rejection; verify by loader tests for every scenario of "Web search references are validated at startup"
- [ ] 4.2 Attach grounded answer children as `answers`, merge their citations as results, and count ungrounded children as failed; verify by aggregate unit tests with fake answer children for every scenario of "Aggregate engines attach the answers of answer children" and the "Aggregate output can carry answers" scenario
- [ ] 4.3 Bound attached answers and apply the trim order in `output.ts`; verify by output unit tests for every scenario of "Attached answers fit the result cap after results"
- [ ] 4.4 Render `answers` after the results in the web search renderer with engine id, Markdown answer, and citation links under the existing link safety; add stories for an aggregate with answers and for a stored part without `answers`; verify with Storybook MCP story tests and preview URLs, or the Storybook CLI fallback, for "The chat renders attached answers"
- [ ] 4.5 Document hosted aggregate children, their latency, and the output shape in the runbook and reference page; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 4.6 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the `packages/ui` and `apps/web` checks; exercise an aggregate with a hosted child in a browser live and after reload; this layer's PR carries `Closes #1438`
- [ ] 4.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 4.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `extend-web-search/engine-selection` — model-selected engines and catalog (design D3 to D5)

- [ ] 5.1 Add `engines` (1 to 20 unique ids) to the input schema; check each id before any engine runs and fail with the configured ids; run the listed engines instead of the chain; verify by chain and tool unit tests for the "Duplicate engine ids are refused", "Selected engines replace the chain", and "A selected engine does not fall back to the chain" scenarios and every scenario of "The model can select the engines for one call"
- [ ] 5.2 Add the optional literal `description` to every engine entry (1 to 200 characters, one line, no interpolation); verify by loader tests for every scenario of "Web search engine entries can carry a model-facing description" and the updated "Web search engine entries have fixed per-type shapes"
- [ ] 5.3 Generate the engine catalog once per worker and append it after the rendered `web_search` description, packaged or overridden, with tag-neutralized operator descriptions and no keys, base URLs, folder ids, or model ids; verify by unit tests for every scenario of "The web search description lists the configured engines" and an integration test that an attempt's declared description ends with the catalog
- [ ] 5.4 Update `prompts/tools/web_search.md` to describe `engines`; document selection, the catalog, and `description` in the runbook and reference page, including that every configured engine is selectable; update `SPEC.md` if it states that engine choice is operator-only; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 5.5 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites; this layer's PR carries `Closes #1432`
- [ ] 5.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 5.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `extend-web-search/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `engine-selection` top before `$openspec-sync-specs`
writes. Its self-review and GitHub review are post-archive gates, not tasks here.

- [ ] 6.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass for `web-search` and `instance-config`
- [ ] 6.2 Confirm `openspec status --change extend-web-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

## Workflow follow-up

- Publish the finalize PR as a draft with `$gh-stack`, self-review the archive diff, mark it
  ready, and complete the ready-PR monitoring loop.
- Merge the stack only through `$gh-stack` after Leo's explicit permission.

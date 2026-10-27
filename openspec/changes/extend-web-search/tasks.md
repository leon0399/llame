Track [#1431](https://github.com/leon0399/llame/issues/1431),
[#1432](https://github.com/leon0399/llame/issues/1432),
[#1437](https://github.com/leon0399/llame/issues/1437), and
[#1438](https://github.com/leon0399/llame/issues/1438), and
[#1440](https://github.com/leon0399/llame/issues/1440) under the epic
[#1430](https://github.com/leon0399/llame/issues/1430) through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer
is created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed
before it is marked ready, and monitored per `CONTRIBUTING.md`.

```text
(master) <- extend-web-search/proposal
         <- extend-web-search/limits-objective
         <- extend-web-search/result-filtering
         <- extend-web-search/deepseek-parallel
         <- extend-web-search/parallel-mcp
         <- extend-web-search/yandex
         <- extend-web-search/aggregate-answers
         <- extend-web-search/engine-selection
         <- extend-web-search/finalize
```

| Layer               | Parent              | Owns                                                                                                                                                                                                | Closes | Estimated authored lines                                    |
| ------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `proposal`          | `master`            | this ledger, the proposal, the design, six delta specs, and the objective spike research bundle                                                                                                     | none   | about 1,990 authored plus 210 generated (measured)          |
| `limits-objective`  | `proposal`          | per-engine query limits, the `unsupported` class, result-count clamps, the portable-operator description and hosted domain filters, the `objective` input and its mapping on existing engines, docs | #1431  | about 1,500                                                 |
| `result-filtering`  | `limits-objective`  | removal of `read`-rejected and `-site:`-excluded results and citations, answer-text link cleanup, the count note, docs                                                                              | #1440  | about 900                                                   |
| `deepseek-parallel` | `result-filtering`  | the `deepseek` and `parallel` types and engines, and their docs                                                                                                                                     | none   | measured 1,376 inserted, 132 removed                        |
| `parallel-mcp`      | `deepseek-parallel` | the shared hosted MCP session, the keyless `parallel-mcp` type and engine, and their docs                                                                                                           | none   | measured 1,040 inserted, 215 removed                        |
| `yandex`            | `parallel-mcp`      | the `yandex` type and engine, and its docs                                                                                                                                                          | #1437  | about 1,700                                                 |
| `aggregate-answers` | `yandex`            | answer children in aggregates, `answers` output and bounds, the renderer and stories, docs                                                                                                          | #1438  | about 1,600                                                 |
| `engine-selection`  | `aggregate-answers` | the `engines` input, the execution-time id check, the generated catalog, the `description` field, docs                                                                                              | #1432  | about 1,200                                                 |
| `finalize`          | `engine-selection`  | spec synchronization, task records, and archive movement only                                                                                                                                       | none   | under 300 (archive movement measured with rename detection) |

Each engine-owning layer adds its own type's schema branch, loader shape, and validation, so no
layer accepts a type it cannot run. Each layer leaves the repository shippable and adds its own
operator documentation and dated `CHANGELOG.md` entry; nothing in `ROADMAP.md` tracks this work.
The epic #1430 stays open after `engine-selection`, because its rerank slices remain.

Budget note (named exception for Leo's approval): the proposal layer measures about 2,200 inserted lines against `master`, of which 210 are generated experiment output (three JSONL result files in the objective spike bundle), so about 1,990 authored lines, at the budget. It carries eleven MODIFIED blocks across four capabilities, each rewritten whole in Simplified Technical
English, and the spike bundle that justifies D2 and D6; splitting the bundle into its own PR would
separate the evidence from the decisions it supports. Re-estimate each implementation layer at its
boundary. If `deepseek-parallel` exceeds about 2,000 lines, move `parallel-mcp` to its own layer above it. Implementation layers have no generated output.
The split is in effect (applied 2026-10-27): `deepseek-parallel` measured 1,376
inserted and 132 removed lines against `result-filtering`, and `parallel-mcp`
1,040 inserted and 215 removed against `deepseek-parallel`, each within the
budget at its own boundary.

## 0. `extend-web-search/proposal` — planning artifacts

- [x] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited vendor sources; commit each round separately and record it in the PR body. Recorded: two local rounds (spec consistency, feasibility) and two GitHub rounds, in the PR body
- [x] 0.2 Verify every MODIFIED block against its canonical requirement, keeping every canonical scenario heading, and keep each requirement's prose under 500 characters
- [x] 0.3 Verify `pnpm exec openspec validate extend-web-search --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [x] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [x] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision, including the D5 deviation, before creating `extend-web-search/limits-objective`. Approved by Leo on 2026-10-26 at revision `206e389d`

## 1. `extend-web-search/limits-objective` — query limits, clamps, operators, objective (design D2, D2a, D6, D11)

- [x] 1.1 Add `unsupported` to the failure classes and its fixed message; add a per-engine query limit (code points and words) checked before any request, with `brave` at 600 characters and 75 words; verify by chain unit tests with a fake limited engine and `brave` for the "An over-long query skips the engine" scenario of "Engines skip queries over their query limit" and the "Query limit failure" scenario of "Total failure is a fixed, non-disclosing error"
- [x] 1.2 Give each engine type a vendor result maximum and send `min(limit, maximum)`, cutting results to `limit` where the vendor has no count parameter; verify by engine unit tests with a fake engine whose maximum is 10 for "Engines clamp the result count to their vendor maximum"
- [x] 1.3 Skip `aggregate` children whose limit the query exceeds, noting each as `unsupported`, and fail with `unsupported` when every child is skipped; verify by aggregate unit tests with fake children whose limits are 128 and 200, owning the scenarios of "Aggregate engines run only the children that accept the query" and the MODIFIED "Aggregate engines fan out and merge by rank fusion" (including "Every skipped child fails as unsupported")
- [x] 1.4 Add `objective` (1 to 2,000 units) to the input schema and `EngineRequest`; send it as `objective` from `exa` and `exa-mcp` with the query as fallback; add the `Goal:` line to the `model-hosted` message; ignore it silently on `brave`, `perplexity`, `searxng`, and `duckduckgo`; verify by engine and schema unit tests for the `exa`, `exa-mcp`, and silent-ignore scenarios of "Engines receive the objective where their vendor accepts one", the "Objective becomes a goal line" scenario, and that no engine adds the objective to its query
- [x] 1.5 Update `prompts/tools/web_search.md` to describe `objective`, the query limits, and the portable operators (`site:`, `-site:`, quoted phrases, with one sentence that other operators can reach an engine as plain words) briefly and to ask for a short keyword query and a concise objective; verify by the prompt-loader test that the packaged description renders, and by a test for "The description names only the portable search operators"
- [x] 1.6 Send `site:` hosts as allowed and `-site:` hosts as blocked domains on the OpenAI, Codex, and Anthropic hosted wires, dropping the exclusions with a note only on `anthropic-messages` when both exist; verify by model-hosted request tests for every scenario of "Hosted engines map site operators to domain filters"
- [x] 1.7 Document `objective`, query limits, and `unsupported` in `docs/product/operator/web-search.md` (including that the objective is outbound text) and `docs/product/reference/tools/web-search.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 1.8 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR carries `Closes #1431`
- [x] 1.9 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [x] 1.10 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `extend-web-search/result-filtering` — permission and exclusion filtering (design D2b)

- [x] 2.1 Remove results and citations that a `read` reject clause matches (exporting the `read` web-locator decision and carrying it on `EngineRequest`), and those on `-site:` hosts and their subdomains, before the chain or an aggregate decides; count removals in one first note; keep entries on `no_allow`, a whole-tool reject, and in the effective `bypass` mode; strip removed URLs from answer text; verify by chain, aggregate, and tool unit tests for every scenario of "The call removes the results that the read permission group rejects", "The call removes the results of excluded hosts", "Removed entries can empty an engine outcome", "One note counts the removed entries", the `permission-modes` "Switching mode preserves the prompt prefix" scenario, the `native-file-tools` "A read reject removes a search result" scenario, and the `tool-call-permissions` "A read reject still refuses the read" scenario, plus an integration test that a `read` reject on a fixture host removes its result and the note does not name it
- [x] 2.2 Document the removal rules, the count note, and the whole-tool and `bypass` exceptions in the runbook's permission section and the reference page; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 2.3 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites; this layer's PR carries `Closes #1440`
- [x] 2.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 2.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `extend-web-search/deepseek-parallel` — DeepSeek and Parallel (design D7)

- [x] 3.1 Add the `deepseek` and `parallel` (with `mode`, default `fast`) schema branches and loader shapes; verify by loader tests for the scenarios of "New web search engine types have fixed shapes"
- [x] 3.2 Implement the `deepseek` engine: request, `ori_question` cut to 128 code points, `after:` recency or its note, `summary` snippets, status classes, and the 128 limit; verify by fixture tests for every scenario of "DeepSeek engines call the DeepSeek search API", the DeepSeek objective scenario, and the "A small limit passes unchanged" scenario, including that a 401 body echoing the key never reaches output
- [x] 3.3 Implement the `parallel` engine: request, `objective`, `mode`, `session_id` from the Chat id, source policy from `site:` operators, `after_date`, excerpt snippets, status classes, and the 200 limit; verify by fixture tests for every scenario of "Parallel engines call the Parallel search API" and the Parallel objective scenario
- [x] 3.4 Re-run the aggregate skip tests with real `deepseek` and `parallel` children against recorded fixtures as a regression check (layer 1 owns the scenarios)
- [x] 3.5 Document the two engines, their keys, prices, modes, retention and training terms, and the `session_id` exposure of `parallel`, in the runbook; add commented examples to `llame.config.jsonc.example`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 3.6 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR references #1437
- [x] 3.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 3.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `extend-web-search/parallel-mcp` — keyless Parallel MCP (design D8)

- [x] 4.1 Add the `parallel-mcp` schema branch and loader shape: a keyless engine whose type has no other field; verify by loader tests for the "Keyless Parallel MCP refuses a key" scenario of "New web search engine types have fixed shapes"
- [x] 4.2 Extract the shared hosted MCP session from `exa-mcp`: the handshake, the tool lookup, one cached session per configured engine, and the result envelope, so the model still receives no declaration of an MCP tool; verify by the `exa-mcp` unit tests
- [x] 4.3 Implement the `parallel-mcp` engine on the shared `@ai-sdk/mcp` client: keyless `web_search` call, `objective ?? query`, `isError` as `upstream_error` without vendor text, the 200 limit, the Chat id as `session_id`, no model-facing declaration, and results cut to `limit`; verify by tests against a local Streamable HTTP MCP fixture for "Keyless Parallel engines call the hosted Parallel MCP tool"
- [x] 4.4 Document the engine, the keyless endpoint, its prices and retention terms, and the session-id exposure in the runbook; add a commented example to `llame.config.jsonc.example`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 4.5 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR references #1437
- [x] 4.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 4.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `extend-web-search/yandex` — Yandex web search (design D9)

- [x] 5.1 Add the `yandex` schema branch with `searchType` and optional `folderId`; verify by loader tests for the scenarios of "Yandex web search engines have a fixed shape"
- [x] 5.2 Implement the `yandex` engine: request with flat groups, base64 XML parsing with `linkedom`, in-body error classification, recency periods and notes, the 400-character and 40-word limit; verify by tests against hand-built XML fixtures of the documented response format for every scenario of "Yandex engines call the Yandex web search API" and "Yandex engines classify errors from the response body", the "A word limit applies" scenario, including that error text never reaches output
- [x] 5.3 Document the engine, its keys, folder ids, prices, rate limits, Russian residency and the 152-FZ statement, and the result-order clause of the terms as an operator responsibility in the runbook; add commented examples to `llame.config.jsonc.example`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 5.4 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests; this layer's PR carries `Closes #1437`
- [x] 5.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 5.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `extend-web-search/aggregate-answers` — answer engines inside aggregates (design D10)

- [x] 6.1 Admit `model-hosted` as an `aggregate` child in the loader and schema; update the tests that pinned the old rejection; verify by loader tests for every scenario of "Web search references are validated at startup"
- [x] 6.2 Attach grounded answer children as `answers`, merge their citations as results, and count ungrounded children as failed; verify by aggregate unit tests with fake answer children for every scenario of "Aggregate engines attach the answers of answer children" and the "Aggregate output can carry answers" scenario
- [x] 6.3 Bound attached answers and apply the trim order in `output.ts`; verify by output unit tests for every scenario of "Attached answers fit the result cap after results", including the whole-answer drop
- [x] 6.4 Render `answers` after the results in the web search renderer with engine id, Markdown answer, and citation links under the existing link safety; add stories for an aggregate with answers and for a stored part without `answers`; verify with Storybook MCP story tests and preview URLs, or the Storybook CLI fallback, for "The chat renders attached answers"
- [x] 6.5 Document hosted aggregate children, their latency, and the output shape in the runbook and reference page; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 6.6 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the `packages/ui` and `apps/web` checks; exercise an aggregate with a hosted child in a browser live and after reload; this layer's PR carries `Closes #1438`
- [x] 6.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 6.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `extend-web-search/engine-selection` — model-selected engines and catalog (design D3 to D5)

- [x] 7.1 Add `engines` (1 to 20 unique ids) to the input schema; check each id before any engine runs and fail with the configured ids; run the listed engines instead of the chain; verify by chain and tool unit tests for the "Duplicate engine ids fail validation", "Selected engines replace the chain", and "A selected engine does not fall back to the chain" scenarios and every scenario of "The model can select the engines for one call"
- [x] 7.2 Add the optional literal `description` to every engine entry (1 to 200 characters, one line, no interpolation); verify by loader tests for every scenario of "Web search engine entries can carry a model-facing description" and the updated "Web search engine entries have fixed per-type shapes"
- [x] 7.3 Build the `webSearch.engines` template collection once per worker from the resolved configuration (fields `id`, `type`, `kind`, `position`, `recency`, `queryLimit`, `objective`, `description`; tag-neutralized, `engines` tags included; no keys, base URLs, folder ids, or model ids), admit it to both template kinds under the bounded-iteration rules, and render the engine list from `prompts/tools/web_search.md`; delete the code-appended catalog and its special empty-render check; verify by unit tests for every scenario of "The web search description lists the configured engines" and "Templates can iterate the configured web search engines"
- [x] 7.4 Update `prompts/tools/web_search.md` to describe `engines`; document selection, the catalog, and `description` in the runbook and reference page, including that every configured engine is selectable and that `engines` values match only all-field permission clauses; update `SPEC.md` if it states that engine choice is operator-only; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 7.5 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites; this layer's PR carries `Closes #1432`
- [x] 7.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 7.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 8. `extend-web-search/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `engine-selection` top before `$openspec-sync-specs`
writes. Its self-review and GitHub review are post-archive gates, not tasks here.

- [x] 8.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify that `web-search`, `instance-config`, `tool-prompt-templates`, `permission-modes`, `native-file-tools`, and `tool-call-permissions` gain no strict-validation issue compared with `master`
- [ ] 8.2 Confirm `openspec status --change extend-web-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

## Workflow follow-up

- Publish the finalize PR as a draft with `$gh-stack`, self-review the archive diff, mark it
  ready, and complete the ready-PR monitoring loop.
- Merge the stack only through `$gh-stack` after Leo's explicit permission.

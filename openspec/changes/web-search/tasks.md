Track [#1102](https://github.com/leon0399/llame/issues/1102) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer
is created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed
before it is marked ready, and monitored per `CONTRIBUTING.md`.

```text
(master) <- web-search/proposal
         <- web-search/core
         <- web-search/engines-api
         <- web-search/engines-keyless
         <- web-search/aggregate
         <- web-search/ui
         <- web-search/hosted
         <- web-search/finalize
```

| Layer             | Parent            | Owns                                                                                                                                                                   | Estimated authored lines                                                             |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `proposal`        | `master`          | this ledger, the proposal, the design, and the six delta specs; closes no issue                                                                                        | about 1,100                                                                          |
| `core`            | `proposal`        | the `webSearch` section with the `brave` type, the `web_search` tool, chain, URL canonicalization, output bounds, failure classes, deadlines, the `brave` engine, docs | about 2,000 (comparable: #1002, 2,484); see the budget note                          |
| `engines-api`     | `core`            | the `exa`, `perplexity`, and `searxng` types and engines and their docs                                                                                                | about 1,000                                                                          |
| `engines-keyless` | `engines-api`     | the `exa-mcp` type and engine over `@ai-sdk/mcp`, the `duckduckgo` type and engine, and their docs                                                                     | about 1,000                                                                          |
| `aggregate`       | `engines-keyless` | the `aggregate` type and engine, its rank fusion, and its docs                                                                                                         | about 600                                                                            |
| `ui`              | `aggregate`       | the dedicated web search renderer, its stories, and its dispatch in the chat                                                                                           | about 700                                                                            |
| `hosted`          | `ui`              | the `search` session lane, the `model-hosted` type and engine on the Responses, Codex, and Messages wires, and their docs; closes #1102                                | about 1,800 (comparable: #1009, 3,152 for one web-read adapter); see the budget note |
| `finalize`        | `hosted`          | spec synchronization, task records, and archive movement only                                                                                                          | under 300 (archive movement measured with rename detection)                          |

Each engine-owning layer adds its own type's schema branch, loader shape, reference validation,
and matching `instance-config` scenarios, so no layer accepts an engine type it cannot run. Every
layer leaves the repository shippable. After `core`, an operator can search through Brave with
results shown in the generic tool panel; each later layer adds engine types or the renderer on a
working tool. Each shipping layer adds its own operator documentation and dated `CHANGELOG.md`
entry; nothing in `ROADMAP.md` tracks this work.

Budget note: `core` and `hosted` sit at the review budget. Re-estimate each layer at its
boundary and before publication. If `core` exceeds about 2,000 authored lines, move URL
canonicalization and output bounds into their own layer below `core`'s engine work. If `hosted`
does, split it into `hosted-lane` (the `search` lane, its header tests, and the `model-hosted`
configuration branch) below `hosted` (the three request builders, the engine, and docs). Either
split, or a named exception, is decided before that layer is published. No layer has generated
output.

## 0. `web-search/proposal` — planning artifacts

- [x] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited upstream sources; commit each round separately and record it in the PR body. Recorded: two rounds (spec consistency, feasibility), applied in `a9a92e8d` and `ba689c8f`
- [x] 0.2 Verify every MODIFIED and RENAMED block against its canonical requirement with a sentence-level diff, keeping every canonical scenario heading verbatim
- [x] 0.3 Verify `pnpm exec openspec validate web-search --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [x] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [ ] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision before creating `web-search/core`

## 1. `web-search/core` — configuration, tool, chain, Brave (design D1–D4, D6, D9–D12, D14)

- [x] 1.1 Add `webSearch` to the raw and resolved config types, the published `llame.config.schema.json`, and the loader, with the `brave` entry shape only, `timeoutSeconds` default, id uniqueness, `chain` reference validation, and the `tools.allowed` dependency; document a commented example in `llame.config.jsonc.example`; verify by loader unit tests for the `instance-config` scenarios that involve only `brave` (minimal load, unknown key, duplicate id, missing key, unknown chain id, allowlist dependency both ways) and the interpolated-key non-disclosure scenario
- [x] 1.2 Register `web_search` (`read_only`, strict schema, no per-tool timeout) with its packaged description `prompts/tools/web_search.md` and `TOOL_PROMPT_IDS` entry; verify by registry and prompt-loader tests that the declaration matches the `web-search` schema and the `read` recommendation renders only when `read` is admitted
- [x] 1.3 Implement the chain executor, the closed output union, URL canonicalization (WHATWG parse, `stripFragment`, `canonicalHref`, no selector split, last-segment `%3A`, 2,048-character limit), field and output-size bounds, notes, failure classes, and the per-engine deadline under the call signal; verify by unit tests with fake engines for every scenario of "Output is a closed, normalized union", "Result URLs are canonical web locators", "Output fields are bounded within the result cap", "The serialized output fits the result cap", "The chain tries engines in order…", "Total failure is a fixed, non-disclosing error", and "The web search tool has one stable model-facing contract" (unknown argument, default limit), and "Engine and call deadlines bound every search", including that a returned `%3A` URL is accepted by `read`'s locator parser
- [x] 1.4 Implement the `brave` engine: request, `recency`/`limit` mapping, refused redirects, 5 MiB cap, status-to-class mapping, and response normalization; verify by unit tests against recorded fixtures that a 401 body echoing the key never reaches output
- [x] 1.5 Update the `tool-calling` tests that pin the code-owned inventory or assert no code-owned outbound requests, and add an integration test with the scripted model client and a local fixture HTTP server standing in for Brave proving: an allowlisted call returns results and persists the normalized part; a permission-rejected call makes no request to the fixture; Run cancellation and the call deadline each abort an in-flight request; a 401 body echoing the key appears in no tool part, Run event, or captured log; a redirect to another host is not followed; a public share of the chat omits the part; a call naming `web_search` when it is not allowlisted is refused with a recorded, non-fatal tool error and the run continues; and, under a `read` group with no `^https://` allow, a `read` of a returned result URL is still rejected as `no_allow` while `web_search` itself runs (the `native-file-tools` "Read path clauses do not govern web search" scenario)
- [x] 1.6 Write `docs/product/operator/web-search.md` (configuration, chain semantics, deadlines, the `web_search` permission group and query-exfiltration warning, Brave setup and terms, storage posture) and `docs/product/reference/tools/web-search.md`; link both from their indexes; update `SPEC.md` and `README.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 1.7 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [x] 1.8 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [x] 1.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `web-search/engines-api` — Exa, Perplexity, SearXNG (design D6)

- [x] 2.1 Add the `exa`, `perplexity`, and `searxng` schema branches and loader shapes, including `searxng`'s absolute `baseUrl`; verify by loader tests for the missing-key and relative-URL scenarios
- [x] 2.2 Implement the `exa` engine with `includeDomains`/`excludeDomains` from `site:`/`-site:` and `startPublishedDate` from `recency`; verify by fixture tests for mapping, normalization, and status classes
- [x] 2.3 Implement the `perplexity` engine on the Search API with `search_recency_filter`, `max_results`, and the single-mode, 20-domain `search_domain_filter` rule; verify by fixture tests for mapping (including mixed `site:`/`-site:`), normalization, and status classes
- [x] 2.4 Implement the `searxng` engine against its `baseUrl` with `time_range` (noting `week` sent as `month`); verify by fixture tests, including that an `http:` base URL is used as configured, redirects are refused, and a 403 is `upstream_error`
- [x] 2.5 Document the three engines, their credentials, their storage terms, and SearXNG's required `search.formats: [html, json]` in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 2.6 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [x] 2.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 2.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `web-search/engines-keyless` — Exa MCP, DuckDuckGo (design D6, D7)

- [x] 3.1 Add the `exa-mcp` and `duckduckgo` schema branches and loader shapes; verify by loader tests that `exa-mcp` loads with and without a key and `duckduckgo` rejects any extra field
- [x] 3.2 Implement the `exa-mcp` engine with one `@ai-sdk/mcp` `http` client per engine per process, `redirect: 'error'`, a byte-bounded fetch, the optional key header, `query`/`numResults`/`objective` arguments, reconnection after a transport error, and block-by-block parsing of `web_search_exa` output that skips blocks without a `URL:` line; build the fixture's `tools/list` from the deployed schema; verify by tests against a local Streamable HTTP MCP fixture that results normalize, text beginning with Exa's no-results message is empty, `isError` results map by their status to `auth` or `rate_limited`, a transport 429 maps to `rate_limited`, a dropped session reconnects on the next call, and no tool from the endpoint reaches the model catalog
- [x] 3.3 Implement the `duckduckgo` engine: form POST, `df` recency, `linkedom` parsing, redirect-URL unwrapping, and `anomaly-modal` detection as `challenge`; verify by tests against recorded result and challenge pages
- [x] 3.4 Document both engines, the keyless Exa limits, and DuckDuckGo's unsupported status and terms in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 3.5 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [x] 3.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 3.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `web-search/aggregate` — concurrent fan-out (design D5)

- [x] 4.1 Add the `aggregate` schema branch with distinct `engines` of result-engine types; verify by loader tests for the nested-aggregate and duplicate-child scenarios
- [x] 4.2 Implement the `aggregate` engine: concurrent children under their own deadlines and the call signal, waiting for every child, canonical grouping, RRF with k = 60, tie-breaking, longest snippet, and the results/empty/failure outcome rules; verify by unit tests with fake children for every scenario of "Aggregate engines fan out and merge by rank fusion"
- [x] 4.3 Document the aggregate, its cost multiplication, and its latency bound in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 4.4 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [x] 4.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 4.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `web-search/ui` — dedicated renderer (design D13)

- [x] 5.1 Add the web search renderer to `packages/ui` on the shared tool component: results list, answer rendered through a Markdown renderer passed as a prop, citations, engine and notes, running, cancelled, and error states, and `http(s)`-only result and citation links rendered as escaped Markdown links through that renderer so Streamdown's `linkSafety` applies; add stories for results, answer, empty, error, cancelled, and running; verify with Storybook MCP story tests and return preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [x] 5.2 Dispatch every tool part with `isToolUIPart(part) && getToolName(part) === "web_search"` to the renderer in `apps/web`, covering live `dynamic-tool` and stored `tool-web_search` parts; verify by component tests that a `javascript:` URL renders as text, a link click goes through link safety, a cancelled part renders without error text, and a live and a historical part render identically
- [x] 5.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 5.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, and the `packages/ui` checks; exercise a chat with a `web_search` result in a browser against the Brave fixture, live and after reload, and confirm the links reach the result URLs
- [x] 5.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 5.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `web-search/hosted` — model-hosted engines (design D8)

- [x] 6.1 Add the `search` Chat lane rendered as `search:<chatId>`, turning `renderSessionId` into an exhaustive switch so a future lane fails typecheck; verify by header tests the `provider-request-headers` and `provider-api-selection` "A hosted web search carries the search lane" scenarios on each of the three wires
- [x] 6.2 Add the `model-hosted` schema branch and the wire check on its referenced model; verify by loader tests for the unsupported-wire and inside-aggregate scenarios
- [x] 6.3 Add a bounded hosted-search request to the Responses, Codex, and Messages clients built from the referenced model entry on the `search` lane, with no reasoning effort (never the Run's), the packaged hosted-search instructions, only the query and recency phrase as input, `openai.tools.webSearch` or `anthropic.tools.webSearch_20250305({ maxUses: 5 })`, `site:` domain mapping, and cited URLs as citations (OpenAI `url_citation`, Anthropic `web_search_result_location`); verify by client tests with recorded provider streams that the request contains no chat history or system prompt, uncited retrieved results are not citations, and empty or uncited text yields `ungrounded`
- [x] 6.4 Implement the `model-hosted` engine on that request; verify by an integration test with the scripted model client that a Run on one model receives an `answer` from a hosted engine on another, and that the assistant message usage, measured context size, and completeness are unchanged by the sub-request
- [x] 6.5 Document the three wires, per-search prices, the Codex shared-subscription risk, citation display obligations, and the unrecorded cost in the runbook; update `SPEC.md`; add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #1102`; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 6.6 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [x] 6.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 6.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `web-search/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `hosted` top before `$openspec-sync-specs` writes. Its
self-review and GitHub review are post-archive gates, not tasks here.

- [ ] 7.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [ ] 7.2 Confirm `openspec status --change web-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

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

| Layer             | Parent            | Owns                                                                                                                                        | Estimated authored lines |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `core`            | `proposal`        | the `webSearch` configuration, the `web_search` tool, chain, result normalization, failure classes, deadlines, the `brave` engine, and docs | about 1,700              |
| `engines-api`     | `core`            | the `exa`, `perplexity`, and `searxng` engines and their docs                                                                               | about 900                |
| `engines-keyless` | `engines-api`     | the `exa-mcp` engine over the MCP SDK client, the `duckduckgo` engine, and their docs                                                       | about 900                |
| `aggregate`       | `engines-keyless` | the `aggregate` engine, its rank fusion, and its docs                                                                                       | about 500                |
| `ui`              | `aggregate`       | the dedicated `tool-web_search` renderer, its stories, and its wiring in the chat                                                           | about 700                |
| `hosted`          | `ui`              | `model-hosted` engines on the Responses, Codex, and Messages wires and their docs; closes #1102                                             | about 1,300              |
| `finalize`        | `hosted`          | spec synchronization, task records, and archive movement only                                                                               | under 100                |

Every layer leaves the repository shippable. After `core`, an operator can search through Brave
with results shown in the generic tool panel; each later layer adds engine types or the renderer
on a working tool. Each shipping layer adds its own operator documentation and dated
`CHANGELOG.md` entry; nothing in `ROADMAP.md` tracks this work.

## 1. `web-search/core` — configuration, tool, chain, Brave (design D1–D4, D6, D9–D12, D14)

- [ ] 1.1 Add `webSearch` to the raw and resolved config types, the published `llame.config.schema.json`, and the loader, with the per-type entry shapes, `timeoutSeconds` default, reference validation, and the `tools.allowed` dependency; document a commented example in `llame.config.jsonc.example`; verify by loader unit tests covering every `instance-config` delta scenario, including that error output never contains an interpolated key
- [ ] 1.2 Register `web_search` (`read_only`, strict schema, no per-tool timeout) with its packaged description `prompts/tools/web_search.md` and `TOOL_PROMPT_IDS` entry; verify by registry and prompt-loader tests that the declaration matches the `web-search` schema and the `read` recommendation renders only when `read` is admitted
- [ ] 1.3 Implement the chain executor, the closed output union, URL canonicalization and field bounds, notes, failure classes, and the per-engine deadline under the call signal; verify by unit tests with fake engines for every scenario of "The chain tries engines in order…", "Total failure is a fixed, non-disclosing error", "Result fields are canonical and bounded", and "Engine and call deadlines bound every search"
- [ ] 1.4 Implement the `brave` engine: request, `recency`/`limit` mapping, refused redirects, 5 MiB cap, status-to-class mapping, and response normalization; verify by unit tests against recorded fixtures that a 401 body echoing the key never reaches output
- [ ] 1.5 Update the `tool-calling` tests that pin the code-owned inventory or assert no code-owned outbound requests, and add an integration test with the scripted model client and a local fixture HTTP server standing in for Brave proving: an allowlisted call returns results and persists the normalized part; a permission-rejected call makes no request to the fixture; Run cancellation aborts an in-flight request
- [ ] 1.6 Write `docs/product/operator/web-search.md` (configuration, chain semantics, deadlines, the `web_search` permission group and query-exfiltration warning, Brave setup and terms, storage posture) and `docs/product/reference/tools/web_search.md`; link both from their indexes; update `SPEC.md` and `README.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 1.7 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 1.8 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 1.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `web-search/engines-api` — Exa, Perplexity, SearXNG (design D6)

- [ ] 2.1 Implement the `exa` engine with `includeDomains`/`excludeDomains` from `site:`/`-site:` and `startPublishedDate` from `recency`; verify by fixture tests for mapping, normalization, and status classes
- [ ] 2.2 Implement the `perplexity` engine on the Search API with `search_recency_filter`, `max_results`, and `search_domain_filter`; verify by fixture tests for mapping, normalization, and status classes
- [ ] 2.3 Implement the `searxng` engine against its `baseUrl` with `time_range` (noting `week` sent as `month`); verify by fixture tests, including that an `http:` base URL is used as configured and redirects are refused
- [ ] 2.4 Document the three engines, their credentials, and their storage terms in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 2.5 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [ ] 2.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 2.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `web-search/engines-keyless` — Exa MCP, DuckDuckGo (design D6, D7)

- [ ] 3.1 Implement the `exa-mcp` engine with one SDK `Client` over Streamable HTTP per engine per process, the optional key header, reconnection after a transport error, and parsing of `web_search_exa` output; verify by tests against a local Streamable HTTP MCP fixture that results normalize, a dropped session reconnects on the next call, a rate-limit error maps to `rate_limited`, and no tool from the endpoint reaches the model catalog
- [ ] 3.2 Implement the `duckduckgo` engine: form POST, `df` recency, `linkedom` parsing, redirect-URL unwrapping, and `anomaly-modal` detection as `challenge`; verify by tests against recorded result and challenge pages
- [ ] 3.3 Document both engines, the keyless Exa limits, and DuckDuckGo's unsupported status and terms in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 3.4 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [ ] 3.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 3.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `web-search/aggregate` — concurrent fan-out (design D5)

- [ ] 4.1 Implement the `aggregate` engine: concurrent children under their own deadlines and the call signal, waiting for every child, canonical grouping, RRF with k = 60, tie-breaking, longest snippet, and the results/empty/failure outcome rules; verify by unit tests with fake children for every scenario of "Aggregate engines fan out and merge by rank fusion" and that a cancelled call aborts every child
- [ ] 4.2 Document the aggregate, its cost multiplication, and its latency bound in the runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 4.3 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [ ] 4.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 4.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `web-search/ui` — dedicated renderer (design D13)

- [ ] 5.1 Add the web search renderer to `packages/ui` on the shared tool component: results list, answer with citations, engine and notes, running and error states, `http(s)`-only links with `rel="noopener noreferrer nofollow"`; add stories for results, answer, empty, error, and running; verify with Storybook MCP story tests and return preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [ ] 5.2 Dispatch `tool-web_search` parts to the renderer in `apps/web` for live and historical messages; verify by component tests that a `javascript:` URL renders as text and that a loaded historical part renders like a live one
- [ ] 5.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 5.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, and the `packages/ui` checks; exercise a chat with a `web_search` result in a browser against the Brave fixture and confirm the links open the result URLs
- [ ] 5.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 5.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `web-search/hosted` — model-hosted engines (design D8)

- [ ] 6.1 Add a bounded hosted-search request to the Responses, Codex, and Messages clients built from the referenced model entry, with the packaged hosted-search instructions, only the query and recency phrase as input, `openai.tools.webSearch` or `anthropic.tools.webSearch_20250305({ maxUses: 5 })`, `site:` domain mapping, and URL sources as citations; verify by client tests with recorded provider streams that the request contains no chat history or system prompt and that an answer without a URL source yields `ungrounded`
- [ ] 6.2 Implement the `model-hosted` engine on that request; verify by an integration test with the scripted model client that a Run on one model receives an `answer` from a hosted engine on another, and that the assistant message usage is unchanged by the sub-request
- [ ] 6.3 Document the three wires, per-search prices, the Codex shared-subscription risk, citation display obligations, and the unrecorded cost in the runbook; update `SPEC.md`; add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #1102`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 6.4 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 6.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 6.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `web-search/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `hosted` top before `$openspec-sync-specs` writes. Its
self-review and GitHub review are post-archive gates, not tasks here.

- [ ] 7.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [ ] 7.2 Confirm `openspec status --change web-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

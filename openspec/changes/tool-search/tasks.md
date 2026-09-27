Track [#338](https://github.com/leon0399/llame/issues/338) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
This revision supersedes the approved one and needs Leo's approval of its own revision before any
implementation layer starts; keep live status in the Project.

The proposal revision lands through [#978](https://github.com/leon0399/llame/pull/978). After it
merges, implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top.
Every layer is created and published with `$gh-stack`, implemented with `$openspec-apply-change`,
self-reviewed before it is marked ready, and monitored per `CONTRIBUTING.md`.

```text
(master) <- tool-search/loop
         <- tool-search/usage-rank
         <- tool-search/native
         <- tool-search/finalize
```

Every layer leaves the repository shippable. After `loop` merges, a model whose MCP catalog
exceeds its budget declares its code-owned tools and loads every MCP tool through `tool_search`
under the `harness` strategy; within budget nothing changes. After `usage-rank` merges, the
owner's most-used MCP tools are declared instead. After `native` merges, operators may move
supporting `anthropic-messages` and `openai-responses` models to cache-preserving loading;
`native` closes #338. `finalize` owns only spec sync and archive. Each layer adds its own
operator documentation and dated `CHANGELOG.md` entry.

## 1. `tool-search/loop` — budget, partition, `tool_search`, harness delivery (design D1, D2, D3 without rank, D6, D7, D8, D9 harness, D10, D11, D13 without rank)

- [ ] 1.1 Add optional `models[].toolSearchThresholdTokens` (positive integer) to `llame-config.ts`, the loader, and the published JSON Schema; resolve the budget as `override ?? floor(resolveCompactionThreshold(model) / 10)` by calling the resolver in `compaction.ts`; verify by unit tests that absent, positive, and the rejected zero, negative, fractional, and string values behave per the `instance-config` delta, that a 1000000-token window with a 200000 compaction threshold resolves 20000, and that failures name the model id and key
- [ ] 1.2 Register `tool_search` as a code-owned `read_only` tool in `tools/registry.ts`, admitted only through its exact `tools.allowed` entry, and gate deferral on its admission; add the whole-tool `tool_search` group to `llame.config.json.example` per the `tool-call-permissions` delta; verify by unit tests that an unadmitted `tool_search` leaves an over-budget catalog fully declared, that a call without a `tool_search` group is rejected as `permission_denied`, and that a tool it loads is still rejected when its own group is absent
- [ ] 1.3 Add a pure `resolveToolTiers({ admitted, budget })` beside `composeTurnToolCatalog` returning `declared`, `discoverable`, and descending-id `cut` ids, with code-owned tools always declared and uncounted, the MCP estimate from the compaction estimator over canonical declaration JSON, and the strategy-neutral inventory estimate; verify by unit tests that a within-budget catalog returns every admitted tool declared, that over budget every MCP tool is discoverable, that the cut runs only when the inventory alone exceeds the budget, and that code-owned tools are never discoverable or cut
- [ ] 1.4 Add `declaration_budget_exceeded` to the closed unavailable reasons with its reminder label and record cut tools unavailable in the attempt manifest; verify that the availability comparison renders a cut as an unavailable transition and that a tier change alone produces no reminder
- [ ] 1.5 Synthesize `tool_search` at attempt preparation when `discoverable` is non-empty (input per the `tool-calling` delta with the `select` enumeration beside the bounded `mcp__` string form, description under 1024 characters, `read_only`) and implement its executor with D7's ranking and the `{ status, loaded, notFound }` result; verify by unit tests for exact select, id-only and description-only queries, the id tie-break, `limit` and `select` above 20 refused as `invalid_input`, and non-discoverable ids reported under `notFound`
- [ ] 1.6 Derive the loaded set at request assembly from the `tool_search` observations in the projected model context plus the Run's earlier steps; compose `prepareStep` as cap → `[]`, otherwise `declared ∪ loaded ∪ { tool_search }`; gate every discoverable tool's execute wrapper on the loaded set with the `not_available` outcome; verify by unit tests with the scripted model client that a loaded tool is callable on the next step, an unloaded one is refused before its executor, and the SDK's refusal text names `tool_search`
- [ ] 1.7 Partition in-Run Workspace additions in `attempt-tool-additions.ts` per the `tool-calling` delta (running estimate, declared additions while within budget, mid-Run engagement that keeps earlier declarations and inserts `tool_search`, discoverable additions kept out of the active set, unavailable additions dropped from search candidates), and list discoverable additions in the `enter_workspace` result per the `workspace-entry` delta; verify by unit tests for an addition within budget, one that engages deferral, `select` of an id added after `tool_search` was declared, and exit withdrawing a discoverable addition, and by the Workspace MCP integration suite with a fake server over budget
- [ ] 1.8 Integration test with the scripted model client and a fake MCP server over budget: a search, a call to the loaded tool, a call to an unloaded tool, a second Run calling the loaded tool without searching, a compaction that absorbs the search and turns the next call into a refusal, and a replay budget that drops the search pair; verify each outcome and that every tool part persists and replays
- [ ] 1.9 Negative tests: cut, unavailable, and unadmitted ids never appear under `loaded`; a queue retry after a failed attempt that loaded a tool and recorded no MCP dispatch refuses that tool until it searches again; a tool loaded in an earlier Run and no longer admitted is not declared or callable
- [ ] 1.10 Document the budget, its usable-context basis, the override, and `tool_search` in `docs/mcp-tools.md`, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 1.11 Verify `pnpm --filter api lint`, `typecheck`, and focused tests for the touched modules, and that a within-budget fixture produces provider requests whose tools are byte-identical to `master`
- [ ] 1.12 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 1.13 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `tool-search/usage-rank` — frozen owner usage rank (design D3, D4, D5)

- [ ] 2.1 Add nullable `mcp_tool_rank_baseline` (JSONB id array) and `mcp_tool_rank_rebaked_from` (uuid, no foreign key, like `skill_catalog_rebaked_from`) to `chats` with one generated Drizzle migration; extend `fork-copy.ts` to copy the rank and remap the marker; verify `pnpm db:generate` reports no further changes and the fork unit test copies and remaps both
- [ ] 2.2 Implement the owner-scoped rank query per the `context-injection` delta (success outcome only, counted by id across operator and Workspace sources, 90-day horizon, 2,000-message cap, per-message `0.5^(age / 14 days)` weight, ordering, 256-id cap) under the owner's `runAs` during attempt preparation; verify by integration tests for each counting rule and a negative isolation test that owner B's uses never enter owner A's rank, and record the query's latency on a seeded 2,000-message history in the PR body
- [ ] 2.3 Resolve or reuse the rank during attempt preparation by compaction identity and persist it only from the completing attempt's fenced terminal transaction, mirroring the skill-catalog freeze in `run-execution.service.ts`; resolve nothing when the attempt admits no MCP tool; verify by integration tests that a second turn reuses the rank after the owner used a new tool in another chat, that the first turn after compaction resolves a new one, and that a failed attempt's rank is never persisted
- [ ] 2.4 Thread the rank into `resolveToolTiers` as the strict-prefix declared tier, skip ranked ids the attempt did not admit, order the cut lowest-ranked first, declare ranked in-Run additions in rank order while they fit, and use rank as the `tool_search` query tie-break; verify by unit tests for the strict prefix, the skipped id, the cut order, ranked additions, and the tie-break
- [ ] 2.5 Integration test: an owner with prior successful calls to two MCP tools opens a chat over budget; both are declared on step one and the rest are discoverable, and an owner with no history gets no declared MCP tool
- [ ] 2.6 Update `docs/mcp-tools.md` with the rank's signal, window, freezing, and privacy boundary, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 2.7 Verify `pnpm --filter api lint`, `typecheck`, focused unit tests, and the touched integration suites
- [ ] 2.8 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 2.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `tool-search/native` — cache-preserving delivery on Anthropic and OpenAI (design D8, D9)

Tasks 3.0 and 3.1 are spikes whose outcomes gate the rest of the layer; record each in design D9.

- [ ] 3.0 **Spike (Anthropic):** against the real Messages API on a model the tool-search table lists, send deferred MCP declarations with a non-deferred llame `tool_search` whose result carries `tool_reference` blocks, then a second Run that replays that result and calls the loaded tool; record that both requests carry identical `tools`, that the second Run reports cache-read tokens covering the first Run's prefix, which beta headers the adapter sent, and whether inserting one more deferred tool into `tools` between two requests keeps the cache read (design D13)
- [ ] 3.1 **Spike (OpenAI):** against the real Responses API on a `gpt-5.4`-or-later model, run a client-executed `tool_search` over deferred functions, then a second Run that replays the stored result as `tool_search_call` plus client `tool_search_output` with current declarations and calls the loaded tool; record acceptance, identical `tools`, and cached input tokens
- [ ] 3.2 Add optional `models[].toolSearch` (`harness` | `native`, default `harness`) to `llame-config.ts`, the loader, and the JSON Schema, failing startup for `native` on `openai-completions`, `opencode-go`, and `openai-codex` and for unknown values; verify by unit tests per the `instance-config` delta
- [ ] 3.3 In `anthropic-model-client.ts`, under `native`: send every admitted tool with `deferLoading` on discoverable ones, including discoverable in-Run additions, and project `tool_search` results (live and replayed) as a text line plus `tool_reference` content for loaded ids the attempt admits; verify by unit tests on the raw request body that deferral marks exactly the discoverable ids, that no llame block carries `cache_control`, and that a reference to a tool no longer admitted is omitted
- [ ] 3.4 In `openai-model-client.ts`, under `native`: send discoverable functions with `deferLoading`, including discoverable in-Run additions, bind `openai.tools.toolSearch({ execution: 'client', parameters })` without the enum, adapt the SDK's `{ arguments, call_id }` input to the shared executor, and project `tool_search` results (live and replayed) as `{ call_id, arguments }` input and `{ tools }` JSON output from current declarations; verify by unit tests on the raw request body
- [ ] 3.5 Integration tests per wire with the scripted provider: a load in one Run and a call in the next send identical `tools`; a model switch from `native` to `harness` and back replays the same stored observation in each wire's form
- [ ] 3.6 Live smoke by hand on both wires, recorded in the PR body: a search, a loaded call, a second Run calling the loaded tool without searching, and the cache-read tokens of each request
- [ ] 3.7 Document `toolSearch`, the supported wires and models, and the cache effect in `docs/mcp-tools.md` and `README.md`, update `SPEC.md` §13, and add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #338`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 3.8 Verify `pnpm --filter api lint`, `typecheck`, focused unit tests, and the touched integration suites, and that every `harness` fixture request is byte-identical to layer 2's
- [ ] 3.9 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 3.10 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `tool-search/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the `native` top before `$openspec-sync-specs` writes. Its
self-review and GitHub review are post-archive gates, not tasks here.

- [ ] 4.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [ ] 4.2 Confirm `openspec status --change tool-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

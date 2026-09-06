Implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top. The
bottom layer is this change itself — proposal, specs, design, and this task list — so the design is
reviewed and merged before any code builds on it. Every layer is published with
`gh stack submit --auto`, implemented with `$openspec-apply-change`, and monitored per
`CONTRIBUTING.md`; the finalize layer closes #338.

```text
(master) <- tool-search/proposal
         <- tool-search/budget
         <- tool-search/loop
         <- tool-search/finalize
```

Every layer leaves the repository shippable: after `budget` merges, Runs bind tiers and receipts
show them, but nothing is deferred yet because no `tool_search` executor exists and every tool is
still declared; after `loop` merges, deferral engages only for catalogs beyond the budget. Each
layer's final task is its exit criterion.

## 1. `tool-search/budget` — threshold, tiers, snapshot, receipt (design D2, D3, D4, D8)

Owns the config key, the tier computation, the snapshot field, and the receipt projection. No
model-facing behavior changes in this layer: the tier is computed and recorded, and every bound
tool is still declared, so the no-op guarantee can be asserted before deferral exists.

- [ ] 1.1 Add optional `models[].toolSearchThresholdTokens` (non-negative integer) to `llame-config.ts`, the config loader, and the published JSON Schema; resolve the per-model budget as `override ?? floor(contextWindowTokens / 10)` next to the compaction threshold resolver; verify by unit tests that absent, positive, zero, negative, fractional, and string values behave per the `instance-config` delta and that failures name the model id and the key
- [ ] 1.2 Reserve `tool_search` in `tools/registry.ts` (registration throws) and in `tools.allowed` validation (boot fails naming `tools.allowed`); verify by unit tests mirroring the existing `mcp__` reservation tests
- [ ] 1.3 Add `estimateDeclarationTokens(declarations)` reusing the compaction estimator over the canonical JSON of the admitted declarations, and `resolveToolTiers({ admitted, budget, promotedIds })` returning the sorted `discoverableToolIds` (empty when within budget; every MCP id minus promoted when over; code-owned never); verify by unit tests that the partition is independent of candidate order, that a promoted id that is no longer bound is dropped, and that a catalog exactly at the budget is not deferred
- [ ] 1.4 Add the nullable sorted `discoverable_tool_ids` field to the effective-context snapshot schema and a nullable `loaded_tool_ids` field to the Run row with one generated Drizzle migration; extend `resolveEffectiveContext` to accept the budget and promoted ids, bind the list, and include it in the content hash only when non-empty; verify by unit test that a within-budget turn produces byte-identical `toolHash`, `contentHash`, and `availabilityHash` to the pre-change fixtures, and that an over-budget turn changes only `contentHash` in this layer
- [ ] 1.5 Extend the receipt DTO and `apps/web` receipt view so every bound declaration carries `tier: "declared" | "discoverable"`; verify by the receipt integration test that a within-budget Run shows every tool as declared with no extra fields, and by a story or component test that the discoverable marker renders
- [ ] 1.6 Wire the budget into Run acceptance with `promotedIds` fixed to empty for this layer; verify by integration test that a fake MCP catalog large enough to exceed a tiny `toolSearchThresholdTokens` binds a non-empty `discoverable_tool_ids` while the worker still declares every tool
- [ ] 1.7 **Exit:** verify `pnpm --filter api typecheck`, `lint`, `test`, and `test:integration` pass, `pnpm --filter web typecheck` and `lint` pass, `pnpm db:generate` reports no schema changes after the migration, and the context-receipt integration suite is green

## 2. `tool-search/loop` — `tool_search`, per-step declaration, promotion (design D1, D5, D6, D7, D9)

The model-facing layer. Reviewed alone because it changes what the provider receives.

- [ ] 2.1 Synthesize the `tool_search` declaration at accept when `discoverableToolIds` is non-empty: input `{ select?: string[] (items enum = discoverable ids), query?: string, limit?: integer 1..20 default 5 }`, description under 1024 characters, classification `read_only`; bind it into `toolDeclarations` and the manifest as `available` with its declaration hash; verify by unit test that the enum equals the sorted discoverable list and that a within-budget turn binds no such declaration
- [ ] 2.2 Implement the `tool_search` executor over the Run's bound declarations: exact `select` resolution, case-insensitive token match over id (`_`/`-` split) and neutralized description with the D7 ranking and stable tie-break, result `{ status: 'success', tools: [...], notFound: [...], notLoaded: [...] }` sized by the executor so whole declarations that would exceed the result cap are dropped into `notLoaded` and the recorded result is never truncated; verify by unit tests for exact select, a query that matches ids only, a query that matches descriptions only, a `limit` above 20 clamped, an unbound id reported under `notFound`, and an oversized declaration reported under `notLoaded` with the result below the cap
- [ ] 2.3 Extend `ModelStreamInput` with the declared set and the `tool_search` id, and compose `prepareStep` in `openai-model-client.ts` as cap → `[]`, otherwise `declared ∪ loaded(steps) ∪ { tool_search }` where `loaded` is derived from the delivered `tools` of prior `tool_search` results, and write the loaded ids onto the Run row as each `tool_search` call completes; verify by unit tests with the scripted model client that a loaded tool is declared on the following step, that the cap still wins on the capping step, and that a `tool_search`-only step counts toward the cap
- [ ] 2.4 Verify by unit test with the scripted model client that a call to an unloaded discoverable tool is recorded as the existing `not_available` refusal and that the tool error the model receives names `tool_search` among the declared tools
- [ ] 2.5 Add cross-Run promotion at accept from `previousSnapshot`'s declared tier and `previousRun.loaded_tool_ids`, skipped when the turn starts a new disclosure epoch, and pass the union as `promotedIds`; verify by integration test that the next Run declares a previously loaded tool on step one and records it outside `discoverable_tool_ids`, and that a Run after a new compaction checkpoint reverts to the default partition
- [ ] 2.6 Add one sentence to the Tools section of `apps/api/src/prompts/chat-default.md` about loading discoverable tools with `tool_search`, and verify `chat-default.test.ts` and the prompt snapshot tests pass
- [ ] 2.7 Integration test with the scripted model client and a fake MCP server: catalog over budget, model calls `tool_search` with `select`, then the loaded tool, then a still-unloaded tool; verify the loaded call executes, the unloaded call is refused, all three tool parts persist and replay, and the receipt shows the tiers
- [ ] 2.8 Negative tests: a tool refused by admission, a tool matching no allowlist rule, and a tool unavailable for a closed reason are absent from the enum and every result; a queue retry of a Run that loaded tools re-derives the same loaded set and never declares an unbound id; a Run that fails after a `tool_search` completes still has `loaded_tool_ids` recorded
- [ ] 2.9 **Exit:** verify `pnpm --filter api typecheck`, `lint`, `test`, and `test:integration` pass and that a run with the default fixture catalog produces provider requests byte-identical to `master` for the tools array

## 3. `tool-search/finalize` — docs, sync, archive

- [ ] 3.1 Document the budget, the per-model override, and the `tool_search` behavior in `docs/mcp-tools.md` and `README.md`, add the dated `CHANGELOG.md` entry, update `SPEC.md` §13; verify `pnpm lint:markdown` and `pnpm format:check` pass
- [ ] 3.2 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `--all --strict`; verify both pass
- [ ] 3.3 Confirm `openspec status --change tool-search --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean; this layer closes #338

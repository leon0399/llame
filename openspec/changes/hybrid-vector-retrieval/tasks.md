Implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top. The
bottom layer is this change itself — proposal, specs, design, and this task list — so the design is
reviewed and merged before any code builds on it. Every layer is published with
`gh stack submit --auto`, implemented with `$openspec-apply-change`, and monitored per
`CONTRIBUTING.md`; the finalize layer closes #197.

```text
(master) <- hybrid-vector-retrieval/proposal
         <- hybrid-vector-retrieval/defaults
         <- hybrid-vector-retrieval/query-embed
         <- hybrid-vector-retrieval/vector-leg
         <- hybrid-vector-retrieval/tool-shaping
         <- hybrid-vector-retrieval/eval
         <- hybrid-vector-retrieval/finalize
```

Every layer leaves the repository shippable: a merged prefix of the stack is a working system whose
search behaves exactly as today until the vector-leg layer lands, and degrades to today's behavior
whenever no model is selected. Each layer's final task is its exit criterion.

## 1. `hybrid-vector-retrieval/defaults` — tool defaults drive-by (design D9)

Owns only the two default values, their spec text, and the example config. Separate so the
retrieval review is not diluted.

- [x] 1.1 Change `BUILT_IN_DEFAULTS.tools` in `apps/api/src/instance-config/llame-config.ts` to `maxStepsPerRun: 20` and `callTimeoutSeconds: 120`, update the published JSON Schema defaults if they are declared there, and verify `pnpm --filter api test -- config-loader` passes with the new values asserted
- [x] 1.2 Update `apps/api/llame.config.json.example` and every doc line stating the old defaults (`rg -n "callTimeoutSeconds|maxStepsPerRun" README.md docs apps/api/AGENTS.md`), and verify `pnpm lint:markdown` passes
- [x] 1.3 **Exit:** verify `pnpm --filter api typecheck`, `pnpm --filter api lint`, and `pnpm --filter api test` pass, and that a config file omitting the `tools` timeout/steps keys resolves to 120 / 20

## 2. `hybrid-vector-retrieval/query-embed` — embed the query, degrade silently (design D2–D4)

No SQL change. After this layer a configured instance embeds every query and throws the vector away;
an unconfigured instance is untouched. Reviewed alone because it is the provider-facing and
timeout-facing code.

- [x] 2.1 Add a `ChatSearchQueryEmbedder` provider (one per process, built from `search.chats.embeddingModelId` + `embeddingModels[]` + `providers[]` via the existing `createOpenAIEmbeddingBackend`/`resolveEmbeddingBackendConfig`, `undefined` when no model is selected) available to both the HTTP search endpoint and the runs worker that executes `search_conversations`, gated only by the corpus model selection and never by the `search-embed` worker-profile group; verify by unit test that no backend and no provider client is constructed when the corpus has no model, and that a process whose profile omits `search-embed` still constructs it when a model is selected
- [x] 2.2 Implement `embedQueryForSearch(surface, query)` returning `{ vector } | { fallback: reason }` with the fixed budgets `tool: 10_000 ms`, `web: 1_500 ms`, the Run abort signal honored on the tool surface, the dimension check against the declared model, and a log line carrying reason, surface, and model key only, and verify by unit test each of `no_model`, `provider_error`, `timeout`, `empty`, `dimension_mismatch` produces a fallback and never throws
- [x] 2.3 Verify by unit test that the embedder receives the trimmed raw query — original case, no NFKC/whitespace collapse — while the lexical legs still receive `normalizeForSearch(query)`
- [x] 2.4 Extend `ChatsRepository.searchByOwner` with an optional `queryVector` parameter that is currently ignored by the builder, call `embedQueryForSearch` **before** `tenantDb.runAs` in both `ChatsService.searchChats` and `tools/search-conversations.ts`, and verify by integration test that the provider fake is invoked before the transaction opens and that a fake that hangs past the budget still lets the search return lexical results
- [x] 2.5 Verify a resolved embedding credential and the query text appear in no fallback log line, alongside the existing provider redaction tests
- [x] 2.6 **Exit:** verify `pnpm --filter api test`, `test:integration`, `lint`, and `typecheck` pass and that `RUN_SEARCH_EVAL=1` reproduces `BASELINE.md` byte-identically — this layer must move nothing

## 3. `hybrid-vector-retrieval/vector-leg` — the third leg, in the shared kernel (design D1, D7)

The tenancy-sensitive layer. All tests here plant vectors directly through a fake backend or SQL;
no provider is contacted.

- [ ] 3.1 Add the optional `vector` block to `HybridSearchConfig` in `apps/api/src/search/core/fusion.ts` (query vector bound as a typed `vector` literal, active model key, column names, weight, candidate cap) and the `vec_c` CTE with the owner scope predicates (`scope.document` and `scope.parent`), `embedding_model_key = <active>`, `embedded_content_hash = content_hash`, and `embed_input_version = EMBED_INPUT_VERSION` in the same `WHERE` as the `<=>` operator; verify by unit test that the emitted SQL without the block is byte-identical to today's and that the builder still throws without a scope predicate
- [ ] 3.2 Union the vector term into `doc_fused` and wire `chats-repository.ts` to pass the block when `queryVector` is present, using the starting constants (weight 1, cap 100, `k = 60`) with a comment naming them as hypotheses pending layer 5; verify `fusion.test.ts` covers the three-leg `rrfScore`
- [ ] 3.3 Integration test: plant a nearest-neighbor vector on a document that shares no token with the query and verify the chat is returned only when the vector leg is on, and is absent with `queryVector` undefined
- [ ] 3.4 Integration test: plant vectors under a superseded model key, under a stale `embedded_content_hash`, and under a stale `embed_input_version`, and verify none contributes while the same documents stay reachable lexically
- [ ] 3.5 Integration test: plant a wrong-dimension vector under a superseded key in the same owner's corpus and verify the search neither errors nor ranks it
- [ ] 3.6 Extend the RLS negatives: user B's query vector nearest to user A's document (private and `visibility = 'public'`), and the empty-identity case; verify they fail when the owner policy is removed and pass with it
- [ ] 3.7 Verify no web or model response field carries cosine distance, per-leg rank, or fused score, and that `HybridSearchResult` retains internal per-leg ranks only where the eval and logs read them
- [ ] 3.8 **Exit:** verify `test:integration` passes with the lexical floors intact and `RUN_SEARCH_EVAL=1` without a provider reproduces `BASELINE.md` byte-identically

## 4. `hybrid-vector-retrieval/tool-shaping` — the vector-only model result (design D5)

- [ ] 4.1 In `tools/search-conversations.ts`, when `matchCanonicalSearchPreview` returns `null` for a successfully hydrated winning document, build a `kind: "content"` result anchored to the document's first message (`messageSeq = first_seq`, `offset` = line containing `first_message_text_offset`, `limit` to that message's end or to the document's exclusive end offset when single-message) with an excerpt cropped at the window start under the existing 500-code-point cap; verify by unit test for a single-message and a multi-message document that the shape is identical to a lexical content result minus a highlighted term
- [ ] 4.2 Verify by integration test that a vector-only winner's coordinates are accepted directly by `conversation_read`, and that a winner whose hydration fails is still omitted
- [ ] 4.3 Verify the result carries no score, match span, generated quote, or `matchedBy`, and that the `SEARCH_CONVERSATIONS_CANONICAL_NOTICE` framing is unchanged
- [ ] 4.4 **Exit:** verify `pnpm --filter api build` regenerates `openapi.json` with no diff (the tool schema is unchanged) and `test:integration` passes

## 5. `hybrid-vector-retrieval/eval` — evidence, constants, and latency (design D6–D8)

The only layer that contacts a provider, and only under `RUN_SEARCH_EVAL=1` against a real
`llame.config.json`. Leo authorized running it against his key (a few cents).

- [ ] 5.1 Add six fixture rows to `apps/api/src/search/chat/eval/dataset.ts` in recorded categories: `cross-en-ru`, `cross-ru-en`, `cross-es-en`, `transliteration`, `hard-negative` (a semantically adjacent decoy chat plus the true target), and `long-chat` (one chat with many correlated chunks vs. a short exact target); verify `test:integration` still passes with the existing floors untouched
- [ ] 5.2 Extend `core/eval.ts` and the harness to report nDCG@10, per-leg contribution, and chat diversity alongside Recall@10, MRR, and zero-result rate, and to run the hybrid configuration only when a provider is configured; verify the lexical-only run in CI is unchanged
- [ ] 5.3 Add the constant grid (vector weight ∈ {0.5, 1, 1.5}; grouping ∈ {top-3 weighted, max-only, capped diminishing}) as an opt-in harness mode, run it once with the real provider, and record every cell per category in `BASELINE.md`
- [ ] 5.4 Fix the chosen constants in `chats-repository.ts` (and `fusion.ts` grouping if it changed), removing the "hypothesis" comment, and verify the floors hold and the chosen semantic rows meet the numbers recorded in 5.3
- [ ] 5.5 Add an opt-in latency harness that seeds a synthetic owner with 20k and 100k chunks of deterministic vectors and records exact-scan p50/p95 with and without the vector leg, plus the query-embed fallback rate, in `BASELINE.md`; decide and record whether the vector leg stays in the single statement or moves to its own statement with its own timeout (design Risks), and if it moves, file the change against layer 3 before this layer's exit
- [ ] 5.6 Record in `BASELINE.md` that the role-label A/B was not run and why (design D8), and that an ANN follow-up is filed only if 5.5 breaches a stated budget
- [ ] 5.7 **Exit:** verify AC1 and AC2 of #197 against the recorded opt-in numbers — paraphrase and cross-language improve over the lexical baseline in the recorded run (this is Leo's acceptance of the change, not a CI assertion; the spec records semantic categories, it does not assert them); exact-title, exact-content, substring, code, and typo stay at 1.00 in CI — and that `pnpm lint:markdown` passes on `BASELINE.md`

## 6. `hybrid-vector-retrieval/finalize` — docs, changelog, spec sync, archive

Documentation and spec promotion only; never application fixes.

- [ ] 6.1 Update `SPEC.md` (search section no longer says vector retrieval does not ship), `apps/api/CLAUDE.md` ("embeddings are produced but not read until #197"), `docs/conversation-recall.md` (query embedding, budgets, fallback, and what an operator sees in logs), and `README.md`; verify `pnpm lint:markdown` passes
- [ ] 6.2 Add the dated `CHANGELOG.md` entry covering the vector leg, the vector-only tool result, and the tool default changes, and remove the completed `ROADMAP.md` item if one exists
- [ ] 6.3 Run `$openspec-sync-specs` and verify the promoted `chat-search`, `search-embeddings`, `tool-calling`, and `instance-config` specs read as whole contracts with no delta headers left
- [ ] 6.4 Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify all pass
- [ ] 6.5 **Exit:** confirm every task above is `- [x]`, run `$openspec-archive-change`, and verify `openspec list` shows no active change. This layer's PR carries `Closes #197`

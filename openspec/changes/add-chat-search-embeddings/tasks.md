## 1. Honest baseline before anything changes

- [ ] 1.1 Extend `apps/api/src/search/chat/eval/dataset.ts` with genuinely inflected Russian and Spanish queries (case-marked and conjugated forms that do **not** reuse the fixture's surface word forms) in the recorded — not floored — categories, and verify `pnpm --filter api test:integration` still passes with the existing floors untouched
- [ ] 1.2 Add an oversized-message fixture (one message several times the 3000-character budget) with a query targeting its tail, and verify it is currently retrievable lexically — the corpus has no oversized fixture today
- [ ] 1.3 Run `RUN_SEARCH_EVAL=1` and rewrite `apps/api/src/search/chat/eval/BASELINE.md` with the true pre-embedding numbers, verifying the new rows are recorded and the "Reading it" note states what they measure

## 2. Database image floor

- [ ] 2.1 Move `compose.yaml` to a digest-pinned `pgvector/pgvector:pg17`, keeping the refresh-command comment convention, and verify `pnpm db:reset && pnpm db:migrate && pnpm db:provision-rls` completes on the new image
- [ ] 2.2 Move the Testcontainers image in `apps/api/vitest.integration.global-setup.mts` and the Playwright default in `playwright.config.ts` (`E2E_DB_PG_IMAGE`) to the same digest-pinned image, and verify `pnpm --filter api test:integration` passes unchanged
- [ ] 2.3 Verify no image reference was missed — `rg postgres:17-alpine` returns only historical docs and archived change records — and that CI's database-backed jobs pass on a pushed branch
- [ ] 2.4 Document pgvector as a self-host deployment requirement in `README.md` and `apps/api/AGENTS.md`, and verify `pnpm lint:markdown` passes

## 3. Chunker: guarantee every document fits (#517)

- [ ] 3.1 Bump `CHUNKER_VERSION` to 3 in `apps/api/src/search/chat/conversation-chunker.ts`: split a single message exceeding `CHUNK_MAX_CHARS` into budget-sized parts at a text boundary, and verify by unit test that no emitted chunk exceeds the budget and that the message is covered in full
- [ ] 3.2 Prefix each continuation part with a bounded, word-boundary-truncated, elision-marked excerpt of the preceding user message — none for a split user message or a chat opening with one — and verify by unit test including the long-question and no-preceding-message cases
- [ ] 3.3 Verify chunking is byte-identical to version 2 for every input whose messages fit the budget, and confirm `RUN_SEARCH_EVAL=1` reproduces task 1.3's metrics exactly
- [ ] 3.4 Verify the version bump drives a full rebuild through the existing discovery sweep with no mixed-version projection in any chat

## 4. Schema and isolation

- [ ] 4.1 Add the `vector` extension and the model-binding ledger table (no tenant column, no RLS) via `drizzle-kit`, and verify migration succeeds as the non-superuser owner role on a fresh database
- [ ] 4.2 Add the five nullable embedding columns to `search_chat_documents` — `embedding` (dimensionless vector), `embedding_model_key`, `embedded_content_hash`, `embed_input_version`, `embedding_fail_reason` — and verify the generated migration matches the schema and that the existing owner policy covers them with no new policy
- [ ] 4.3 Extend the projection RLS negatives to read the embedding columns as another user's identity and as the empty identity, including for a `visibility = 'public'` chat, and verify they fail when the policy is removed
- [ ] 4.4 Verify pgvector's storage class for the `vector` type with `\d+`; if vectors are stored inline rather than TOASTed out-of-line, record the row-width impact on lexical scans before proceeding
- [ ] 4.5 Add the identifiers-only `SECURITY DEFINER` coverage-discovery function using `IS DISTINCT FROM` throughout, extend `pnpm db:provision-rls` to assign its BYPASSRLS ownership, and verify a fully-indexed never-embedded chat is returned — the null-comparison trap that would silently exclude it
- [ ] 4.6 Extend the boot self-check to verify the coverage function's ownership via catalog metadata only, and verify a mis-provisioned instance emits a loud error-level log, does not crash, and does not present as fully covered
- [ ] 4.7 Verify deleting a chat leaves no embedding behind, by integration test

## 5. Configuration surface

- [ ] 5.1 Add the optional `embeddingModels[]` array and the per-corpus intended-model setting to the config schema, referencing `providers[].id`, and verify the published JSON Schema rejects a dangling provider reference, a duplicate id, a non-positive `dimensions`, and a non-positive `batchSize` at boot naming the offending entry
- [ ] 5.2 Implement the binding ledger check — the first **persisted vector** for a key records its binding, not its declaration; a declared key whose binding differs is rejected at load naming the key and changed field — and verify with a unit test for both the first-use and redefinition paths
- [ ] 5.3 Verify the off-by-default contract: a stock install with an unedited config boots clean, creates no queue, issues no provider request, and leaves search identical; and no environment variable or database/user setting can enable the layer — asserted by test
- [ ] 5.4 Verify a resolved embedding-provider credential appears in no log, error, diagnostic, or recorded failure reason, asserted by test alongside the existing provider redaction tests

## 6. Provider boundary

- [ ] 6.1 Add the corpus-agnostic `EmbeddingBackend` interface (`embedQuery`, `embedDocuments`) and injection token to `apps/api/src/search/core/`, and verify `SearchModule`'s import list is unchanged — it must remain a leaf importing only `QueueModule`
- [ ] 6.2 Implement the OpenAI-compatible adapter building its client directly from `@ai-sdk/openai` against an existing `providers[]` connection, applying asymmetric document/query prefixes when configured, and verify with unit tests against a stubbed endpoint including the keyless-provider case
- [ ] 6.3 Validate every returned vector for declared dimensions and finite values before it leaves the adapter, and verify a wrong-length and a non-finite vector are both rejected with nothing persisted
- [ ] 6.4 Correlate results to requests by explicit `(model_key, document_id, content_hash)` key, and verify a reordered and a partial provider response are matched correctly with unmatched results discarded
- [ ] 6.5 Classify terminal versus transient failures — terminal only on 4xx excluding 408 and 429 — and verify a 500 and a 429 retry while a 400 records a failure

## 7. Worker group and pipeline

- [ ] 7.1 Add `search-embed` to `WORKER_GROUPS`, to the built-in `all` profile, and to the published config schema; update `docs/scaling.md` from three fixed groups to four, and verify `worker-profile.service.test.ts`, `config-loader.test.ts`, and `worker.module.integration.test.ts` pass with the new group
- [ ] 7.2 Define `SEARCH_EMBED_QUEUE` in `apps/api/src/search/reindex-queues.ts` with `policy: 'stately'`, per-chat `singletonKey`, `retryLimit: 5`, and `retryBackoff: true`; confirm which fields pg-boss v12 treats as immutable after `createQueue` and verify the queue-contract test covers its parse function
- [ ] 7.3 Gate the embed consumer on `concurrencyFor('search-embed')`, and log at boot when embeddings are configured but this process consumes no `search-embed` — verified by test for both states
- [ ] 7.4 Enqueue embed work post-commit from **every** projection-changing path — the inline Tier-1 finalize rebuild, the reindex worker, and fork — and verify by integration test that an ordinary turn produces an embed job without any sweep or reindex job having run
- [ ] 7.5 Enqueue from the sweep for chats the coverage predicate reports as lagging, and verify a burst of writes to one chat collapses to one pending embed job
- [ ] 7.6 Implement the embed worker: re-query outstanding documents a batch at a time under `runAs(owner)`, close the transaction, embed a batch of the model's `batchSize`, and persist it with a conditional `UPDATE … WHERE id = ? AND content_hash = ? AND embed_input_version = ?` under READ COMMITTED — verified end to end by integration test
- [ ] 7.7 Bound a job to a fixed number of batches and re-enqueue when work remains, and verify a chat with far more documents than one job's bound is fully embedded across several coalesced jobs without any job approaching pg-boss's expiry
- [ ] 7.8 Verify no transaction spans a provider call, and that a rebuild running concurrently with an in-flight embed produces a silent no-op rather than an error or a stale vector
- [ ] 7.9 Verify the guards by test: edit a message between request and persist; delete the chat between request and persist; bump the input version and confirm the corpus is re-embedded with no content change — nothing is written for superseded content in any case
- [ ] 7.10 Verify the rebuild's `ON CONFLICT DO UPDATE` nulls all five embedding columns whenever `content_hash` changes — the one path that could silently serve a stale vector
- [ ] 7.11 Verify a failing or unreachable backend leaves lexical indexing, search, and turn completion unaffected, with affected documents still outstanding
- [ ] 7.12 Verify the embed worker writes only embedding columns — never `chats.updated_at` or `search_chat_state` — so the lexical predicate cannot re-flag the chat and create a rebuild/embed feedback loop

## 8. Operator commands and observability

- [ ] 8.1 Add `backfill` as a **producer**: enumerate uncovered chats through the coverage function and enqueue, issuing no provider request itself; verify a second run against a covered corpus enqueues nothing and writes no row
- [ ] 8.2 Verify bulk work is never automatic: declaring a model, changing a corpus's model, or bumping the input version issues no provider request and creates no corpus-wide job, while a completed turn on a configured corpus still embeds automatically
- [ ] 8.3 Add `prune` for vectors of an undeclared model, and verify undeclaring a model warns at startup, leaves its vectors unread and undeleted, and that only `prune` removes them
- [ ] 8.4 Add `retry-failed`, clearing recorded failures so the next pass re-attempts them, and verify a terminally failed document is otherwise never re-enqueued at unchanged content
- [ ] 8.5 Expose per-chat coverage as distinct **embedded / failed / outstanding** counts, separate from the lexical `indexed_at`, and verify an operator can distinguish lag from permanent failure during a partial backfill

## 9. Proof of no observable change

- [ ] 9.1 Run the full relevance eval on a fully embedded corpus and verify `BASELINE.md` metrics are byte-identical to task 1.3's recorded numbers
- [ ] 9.2 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api lint`, and `pnpm --filter api build`, and verify all pass
- [ ] 9.3 Run `E2E_DB_PORT=15433 pnpm test:e2e -- e2e/web` against the new image and verify chat and search specs behave as before (CI is the arbiter for pass/fail on this box)

## 10. Documentation

- [ ] 10.1 Add the dated `CHANGELOG.md` entry covering the embedding layer, the chunker bump, and the BREAKING database-image requirement, and verify `pnpm lint:markdown` passes
- [ ] 10.2 Document the operator surface — declaring a model, selecting it per corpus, the three commands, reading coverage, and what changing or removing a model does — in `apps/api/AGENTS.md`, and verify the config example in `llame.config.json.example` loads
- [ ] 10.3 Record the migration exception for any hand-edited migration step in the `apps/api/AGENTS.md` ledger, and verify `migration-journal` checks pass
- [ ] 10.4 Run `openspec validate add-chat-search-embeddings --strict` and confirm the change is ready to archive

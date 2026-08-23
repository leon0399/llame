Implementation is a single `gh stack` rooted on `master`, one PR per layer, bottom to top. The
bottom layer is this change itself — proposal, specs, design, and this task list — so the design is
reviewed and merged before any code builds on it:

```text
(master) <- search-embeddings/proposal
         <- search-embeddings/eval-baseline
         <- search-embeddings/chunker-fit
         <- search-embeddings/pgvector-image
         <- search-embeddings/schema
         <- search-embeddings/config-and-backend
         <- search-embeddings/pipeline
         <- search-embeddings/operations
         <- search-embeddings/verify-and-document
         <- search-embeddings/archive
```

Every layer leaves the repository in a shippable state: a merged prefix of the stack is always a
working system with search behaving exactly as it does today. Each layer's final task is its exit
criterion — the next layer builds on it only once that is green.

## 1. `search-embeddings/eval-baseline` — record the truth before changing anything

Tests and fixtures only; no production code. Establishes what "no observable change" is measured
against, so every later claim is falsifiable. Must merge first: recorded after the chunker bump,
the baseline would be circular.

- [ ] 1.1 Extend `apps/api/src/search/chat/eval/dataset.ts` with genuinely inflected Russian and Spanish queries (case-marked and conjugated forms that do **not** reuse the fixture's surface word forms) in the recorded — not floored — categories, and verify `pnpm --filter api test:integration` still passes with the existing floors untouched
- [ ] 1.2 Add an oversized-message fixture (one message several times the 3000-character budget) with a query targeting its tail, in a **recorded (non-floored)** category, and verify it is currently retrievable lexically — the corpus has no oversized fixture today. Its recorded row is expected to move in layer 2; every pre-existing fixture's row is not.
- [ ] 1.3 **Exit:** run `RUN_SEARCH_EVAL=1`, rewrite `apps/api/src/search/chat/eval/BASELINE.md` with the true pre-change numbers, and verify the new rows are recorded with a "Reading it" note stating what they measure

## 2. `search-embeddings/chunker-fit` — guarantee every document fits (#517)

Closes #517. Independently valuable: it repairs snippets and trigram scoring for oversized
documents today, with no embedding code involved. Ships its own `CHANGELOG.md` entry because it
changes user-visible behavior on its own.

- [ ] 2.1 Bump `CHUNKER_VERSION` to 3 in `apps/api/src/search/chat/conversation-chunker.ts`: split a single message exceeding `CHUNK_MAX_CHARS` into budget-sized parts at a text boundary, and verify by unit test that no emitted chunk exceeds the budget and that the message is covered in full
- [ ] 2.2 Prefix each continuation part with a bounded, word-boundary-truncated, elision-marked excerpt of the preceding user message — none for a split user message or a chat opening with one — and verify by unit test including the long-question and no-preceding-message cases
- [ ] 2.3 Verify the version bump drives a full rebuild through the existing discovery sweep with no mixed-version projection in any chat
- [ ] 2.4 Add the `CHANGELOG.md` entry for the chunking fix and verify `pnpm lint:markdown` passes
- [ ] 2.5 **Exit:** verify chunking is byte-identical to version 2 for every input whose messages fit the budget, and that `RUN_SEARCH_EVAL=1` reproduces task 1.3's metrics exactly for every category except the oversized fixture's — whose movement is this layer's intended effect and is re-recorded in `BASELINE.md` with a note naming the cause

## 3. `search-embeddings/pgvector-image` — raise the database floor

Deployment-only, and the one **BREAKING** layer. Separated so it can merge and soak on its own, and
so the infrastructure diff is reviewed by whoever cares about deployment rather than buried under a
schema change.

- [ ] 3.1 Move `compose.yaml` to a digest-pinned `pgvector/pgvector:pg17`, keeping the refresh-command comment convention, and verify `pnpm db:reset && pnpm db:migrate && pnpm db:provision-rls` completes on the new image
- [ ] 3.2 Move the Testcontainers image in `apps/api/vitest.integration.global-setup.mts` and the Playwright default in `playwright.config.ts` (`E2E_DB_PG_IMAGE`) to the same digest-pinned image, and verify `pnpm --filter api test:integration` passes unchanged
- [ ] 3.3 Document pgvector as a self-host deployment requirement in `README.md` and `apps/api/AGENTS.md`, and verify `pnpm lint:markdown` passes
- [ ] 3.4 **Exit:** verify no image reference was missed — `rg postgres:17-alpine` returns only historical docs and archived change records — and that CI's database-backed jobs pass on the pushed branch

## 4. `search-embeddings/schema` — columns, discovery, and provisioning

Schema and datastore only. Nothing writes an embedding yet, so this layer changes no behavior; it
exists so the isolation and discovery guarantees are reviewed on their own, without an adapter or a
worker in the diff.

- [ ] 4.1 Add the `vector` extension and the model-binding ledger table (no tenant column, no RLS) via `drizzle-kit`, and verify migration succeeds as the non-superuser owner role on a fresh database
- [ ] 4.2 Add the five nullable embedding columns to `search_chat_documents` — `embedding` (dimensionless vector), `embedding_model_key`, `embedded_content_hash`, `embed_input_version`, `embedding_fail_reason` — and verify the generated migration matches the schema and that the existing owner policy covers them with no new policy
- [ ] 4.3 Verify pgvector's storage class for the `vector` type with `\d+`; if vectors are stored inline rather than TOASTed out-of-line, record the row-width impact on lexical scans and raise it before proceeding
- [ ] 4.4 Extend the projection RLS negatives to read the embedding columns as another user's identity and as the empty identity, including for a `visibility = 'public'` chat, and verify they fail when the policy is removed
- [ ] 4.5 Add the identifiers-only `SECURITY DEFINER` coverage-discovery function using `IS DISTINCT FROM` throughout, and extend `pnpm db:provision-rls` to assign its BYPASSRLS ownership
- [ ] 4.6 Verify a fully-indexed never-embedded chat is returned by the discovery function — the null-comparison trap that would otherwise silently exclude it — and that the function returns identifiers and counts only, never content
- [ ] 4.7 Extend the boot self-check to verify the coverage function's ownership via catalog metadata only, and verify a mis-provisioned instance emits a loud error-level log, does not crash, and does not present as fully covered
- [ ] 4.8 Record the migration exception for any hand-edited migration step in the `apps/api/AGENTS.md` ledger, and verify `migration-journal` checks pass
- [ ] 4.9 **Exit:** verify deleting a chat leaves no embedding behind, and that `pnpm --filter api test:integration` passes with the columns present and unused

## 5. `search-embeddings/config-and-backend` — declare a model, reach a provider

Config surface and the provider adapter. Still inert: an operator can declare a model and nothing
consumes it until the next layer. Reviewed together because the catalog's fields and the adapter's
inputs are one contract.

- [ ] 5.1 Add the optional `embeddingModels[]` array and the per-corpus intended-model setting to the config schema, referencing `providers[].id`, and verify the published JSON Schema rejects a dangling provider reference, a duplicate id, a non-positive `dimensions`, and a non-positive `batchSize` at boot naming the offending entry
- [ ] 5.2 Implement the binding ledger check — the first **persisted vector** for a key records its binding, not its declaration; a declared key whose binding differs is rejected at load naming the key and changed field — and verify with a unit test for both the first-use and redefinition paths
- [ ] 5.3 Add the corpus-agnostic `EmbeddingBackend` interface (`embedQuery`, `embedDocuments`) and injection token to `apps/api/src/search/core/`, and verify `SearchModule`'s import list is unchanged — it must remain a leaf importing only `QueueModule`
- [ ] 5.4 Implement the OpenAI-compatible adapter building its client directly from `@ai-sdk/openai` against an existing `providers[]` connection, applying asymmetric document/query prefixes when configured, and verify with unit tests against a stubbed endpoint including the keyless-provider case
- [ ] 5.5 Validate every returned vector for declared dimensions and finite values before it leaves the adapter, and verify a wrong-length and a non-finite vector are both rejected with nothing persisted
- [ ] 5.6 Correlate results to requests by explicit `(model_key, document_id, content_hash)` key, and verify a reordered and a partial provider response are matched correctly with unmatched results discarded
- [ ] 5.7 Classify terminal versus transient failures — terminal only on 4xx excluding 408 and 429 — and verify a 500 and a 429 retry while a 400 records a failure
- [ ] 5.8 Verify a resolved embedding-provider credential appears in no log, error, diagnostic, or recorded failure reason, asserted alongside the existing provider redaction tests
- [ ] 5.9 **Exit:** verify the off-by-default contract — a stock install with an unedited config boots clean, creates no queue, issues no provider request, and leaves search identical; and no environment variable or database/user setting can enable the layer

## 6. `search-embeddings/pipeline` — embedding actually happens

The largest layer and the one where the concurrency invariants live. Three of its tasks assert
silent-failure paths that a naive suite passes; they are not optional.

- [ ] 6.1 Add `search-embed` to `WORKER_GROUPS`, to the built-in `all` profile, and to the published config schema; update `docs/scaling.md` from three fixed groups to four, and verify `worker-profile.service.test.ts`, `config-loader.test.ts`, and `worker.module.integration.test.ts` pass with the new group
- [ ] 6.2 Define `SEARCH_EMBED_QUEUE` in `apps/api/src/search/reindex-queues.ts` with `policy: 'stately'`, per-chat `singletonKey`, `retryLimit: 5`, and `retryBackoff: true`; confirm which fields pg-boss v12 treats as immutable after `createQueue` and verify the queue-contract test covers its parse function
- [ ] 6.3 Gate the embed consumer on `concurrencyFor('search-embed')`, and log at boot when embeddings are configured but this process consumes no `search-embed` — verified by test for both states
- [ ] 6.4 Enqueue embed work post-commit from **every** projection-changing path — the inline Tier-1 finalize rebuild, the reindex worker, and fork — and verify by integration test that an ordinary turn produces an embed job without any sweep or reindex job having run
- [ ] 6.5 Enqueue from the sweep for chats the coverage predicate reports as lagging, and verify a burst of writes to one chat collapses to one pending embed job
- [ ] 6.6 Implement the embed worker: re-query outstanding documents a batch at a time under `runAs(owner)`, close the transaction, embed a batch of the model's `batchSize`, and persist it with a conditional `UPDATE … WHERE id = ? AND content_hash = ? AND embed_input_version = ?` under READ COMMITTED — verified end to end by integration test
- [ ] 6.7 Bound a job to a fixed number of batches and re-enqueue when work remains, and verify a chat with far more documents than one job's bound is fully embedded across several coalesced jobs without any job approaching pg-boss's expiry
- [ ] 6.8 Verify no transaction spans a provider call, and that a rebuild running concurrently with an in-flight embed produces a silent no-op rather than an error or a stale vector
- [ ] 6.9 Verify the guards by test: edit a message between request and persist; delete the chat between request and persist; bump the input version and confirm the corpus is re-embedded with no content change — nothing is written for superseded content in any case
- [ ] 6.10 **(trap)** Verify the rebuild's `ON CONFLICT DO UPDATE` nulls all five embedding columns whenever `content_hash` changes — the one path that could silently serve a stale vector
- [ ] 6.11 **(trap)** Verify the embed worker writes only embedding columns — never `chats.updated_at` or `search_chat_state` — so the lexical predicate cannot re-flag the chat and create a rebuild/embed feedback loop
- [ ] 6.12 **Exit:** verify a failing or unreachable backend leaves lexical indexing, search, and turn completion unaffected, with affected documents still outstanding

## 7. `search-embeddings/operations` — the operator surface

Three commands and the coverage readout. Separated because its audience is whoever runs the
instance, not whoever reviews the worker.

- [ ] 7.1 Add `backfill` as a **producer**: enumerate uncovered chats through the coverage function and enqueue, issuing no provider request itself; verify a second run against a covered corpus enqueues nothing and writes no row
- [ ] 7.2 Verify bulk work is never automatic: declaring a model, changing a corpus's model, or bumping the input version issues no provider request and creates no corpus-wide job, while a completed turn on a configured corpus still embeds automatically
- [ ] 7.3 Add `prune` for vectors of an undeclared model, and verify undeclaring a model warns at startup, leaves its vectors unread and undeleted, and that only `prune` removes them
- [ ] 7.4 Add `retry-failed`, clearing recorded failures so the next pass re-attempts them, and verify a terminally failed document is otherwise never re-enqueued at unchanged content
- [ ] 7.5 **Exit:** expose per-chat coverage as distinct **embedded / failed / outstanding** counts, separate from the lexical `indexed_at`, and verify an operator can distinguish lag from permanent failure during a partial backfill

## 8. `search-embeddings/verify-and-document` — prove nothing moved, then say what shipped

The top layer. Its whole job is evidence: the change claims to be invisible to users, and this is
where that is demonstrated rather than asserted.

- [ ] 8.1 Run the full relevance eval on a fully embedded corpus and verify `BASELINE.md` metrics are byte-identical to the numbers recorded at the end of layer 2 — embeddings must move nothing, and layer 2's chunking fix is the only sanctioned movement in the stack
- [ ] 8.2 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api lint`, and `pnpm --filter api build`, and verify all pass
- [ ] 8.3 Run `E2E_DB_PORT=15433 pnpm test:e2e -- e2e/web` against the new image and verify chat and search specs behave as before (CI is the arbiter for pass/fail on this box)
- [ ] 8.4 Add the dated `CHANGELOG.md` entry for the embedding layer and the BREAKING database-image requirement, and verify `pnpm lint:markdown` passes
- [ ] 8.5 Document the operator surface — declaring a model, selecting it per corpus, the three commands, reading coverage, and what changing or removing a model does — in `apps/api/AGENTS.md`, and verify the config example in `llame.config.json.example` loads
- [ ] 8.6 **Exit:** run `openspec validate add-chat-search-embeddings --strict` and confirm the change is ready to archive

## 9. `search-embeddings/archive` — fold the change into the shipped specs

Documentation only, and deliberately its own PR: it is the one layer whose diff is a spec
promotion rather than an implementation, and it must not land until every layer below it has.

- [ ] 9.1 Run `/opsx:sync` to merge the delta specs into `openspec/specs/` — `search-embeddings` created, `search-projection` and `instance-config` updated — and verify the resulting specs carry no delta headers (`ADDED`/`MODIFIED`/`REMOVED` sections are resolved, not copied)
- [ ] 9.2 Verify the promoted `search-projection` and `instance-config` specs read as whole capability contracts rather than a base plus a patch, with the superseded requirement text replaced rather than appended
- [ ] 9.3 Run `/opsx:archive` to move the change into `openspec/changes/archive/`, and verify the archived record keeps proposal, design, specs, and the completed task list intact as implementation provenance
- [ ] 9.4 **Exit:** verify `openspec list` shows no active change, `openspec validate --strict` passes over the promoted specs, and `pnpm lint:markdown` and `pnpm format:check` are clean

## Context

See `proposal.md` — Why. Requirements are in `specs/`.

What already exists and constrains this design:

- `search_chat_documents` is the chunk projection: `id` (uuid PK), `owner_user_id` (text, denormalized), `chat_id`, `chunk_ordinal`, `chunker_version`, `content`, `normalized_content`, **`content_hash`** (sha256 over chunker version + presentation content + normalized content + message range), and a STORED `fts` column. Its header comment already reserves `content_hash` to "(phase 2) guard stale embeddings" — this design consumes exactly that. Rows are upserted on the unique `(chat_id, chunk_ordinal, chunker_version)`.
- RLS is `ENABLE` + `FORCE` with a single `FOR ALL` owner policy over `current_setting('app.current_user_id', true)` and **no public-read policy**; the empty identity matches nothing. All writes happen under `tenantDb.runAs(owner)`.
- Reindex is producer/consumer over pg-boss: `SEARCH_REINDEX_QUEUE` (`policy: 'stately'`, `singletonKey = chatId`) drained by `search-reindex.worker.ts`, with `SEARCH_SWEEP_QUEUE` as the cross-tenant discovery producer using a `SECURITY DEFINER` function owned by the BYPASSRLS `app_rls` role that returns identifiers only. **The happy path is not a queue job at all**: turn finalize rebuilds inline, synchronously, after the user-facing write commits.
- The rebuild runs under **REPEATABLE READ** with retry on serialization failure, and advances `search_chat_state.indexed_at` monotonically (`GREATEST`).
- `SearchModule` is deliberately a **leaf** — it imports only `QueueModule` — so `ChatsModule` and `RunWorkerModule` can both import it for write hooks with no cycle.
- Placement is already generalized: `WORKER_GROUPS = ['runs', 'search-reindex', 'sessions-cleanup']`, and both `main.ts` and `worker.ts` resolve the same `LLAME_WORKER_PROFILE` through `WorkerProfileService`. There is no co-location toggle.
- `InstanceConfigModule` is `@Global` and exports `InstanceConfigService` and `WorkerProfileService`. `providers[]` entries are `{ id, type, key?, baseUrl? }` with `{env:…}`/`{path:…}` interpolation and empty-resolution-means-keyless; `models[]` reference `providers[].id`. Resolved credentials are redacted everywhere.
- `QueueOptions` exposes `retryLimit`, `retryDelay`, `retryBackoff`, and `deadLetter` (default `true`). Neither the reindex nor the runs queue sets any of them.
- The Postgres image is digest-pinned in three places: `compose.yaml`, `apps/api/vitest.integration.global-setup.mts`, and `playwright.config.ts` (`E2E_DB_PG_IMAGE`).

## Goals / Non-Goals

**Goals:**

- Land vector storage, the provider boundary, and a backfilled corpus with **zero observable change** to search.
- Inherit the projection's tenant isolation exactly, rather than restating it.
- Make every embedding traceable to the exact content it describes, so stale and deleted content can never resurface.
- Make the whole layer optional: an instance with no embedding configuration must be indistinguishable from today.
- Degrade rather than gate. A partially embedded corpus is a corpus with a partially contributing retrieval leg, not a corpus with retrieval switched off.

**Non-Goals (design-level, beyond the proposal's scope boundary):**

- No vector index. Nothing queries vectors in this change — see D4.
- No two embedding models resident at once. One model serves the corpus at a time — see D2.
- No admin UI or HTTP surface for the catalog, coverage, or the operator commands.
- No corpus other than chat chunks, though the backend and queue contracts are placed to be reused.
- No cost accounting or rate limiting beyond bounded batch size, concurrency, and retry backoff.

## Decisions

### D1. The model catalog is config-as-code, with a database ledger only for binding integrity

**Decision.** Embedding models are declared in `llame.config.json` as `embeddingModels[]`, referencing an existing `providers[].id`. The database stores a small ledger row per internal key recording the binding actually used to produce vectors (provider id, provider-side model, revision, dimensions, distance metric, prefixes, batch size). A declared key whose binding differs from its ledger row is rejected at load, naming the key and the field that changed.

**Why over the database-table registry sketched on #196.** `instance-config`'s purpose statement is explicit: operator/system settings are config-as-code, and "tenant-owned settings are out of scope: they are database rows under RLS, never file entries." An embedding model is operator configuration by that rule, and the repo already moved the executable model catalog the same way in `providers-and-models-as-code`. A DB registry would need its own migration, its own admin surface to be editable, and would fork the operator-settings story for one feature.

**Ledger shape.** One row per internal key, written on the **first persisted vector** for that key — not on declaration — so a declared-but-never-used key can be corrected freely. The ledger is instance-global operator state with no tenant column and therefore carries **no RLS**: FORCE RLS on a policy-less, owner-less table would make it unreadable by the non-BYPASSRLS request role.

**Why keep any DB row at all.** Vectors are meaningless without knowing what produced them. If the catalog were purely config, an operator could point an existing key at a different provider model and silently mix two embedding spaces in one column — a failure that is undetectable at query time and corrupts ranking rather than erroring. The ledger makes that a boot-time rejection.

**Alternatives considered.** (a) DB registry table as #196 sketched — rejected above. (b) Pure config with no ledger — rejected: silent embedding-space mixing. (c) Fold the binding fingerprint into every document row — rejected: duplicates one fact per chunk and still needs a lookup to detect a change.

### D2. Embeddings are nullable columns on `search_chat_documents`, not a separate table

**Decision.** Extend the projection table:

```text
search_chat_documents
  + embedding             vector    (dimensionless, nullable)
  + embedding_model_key   text      (nullable)
  + embedded_content_hash text      (nullable)
  + embed_input_version   integer   (nullable)
  + embedding_fail_reason text      (nullable)
```

One document, one row, at most one vector. A model change re-embeds in place rather than coexisting.

**Why this reverses an earlier draft.** An earlier version used a `search_chat_embeddings` table keyed `(document_id, model_key)`. Its **only** load-bearing justification was supporting two models resident at once for a parallel-backfill migration — a requirement introduced by the design, not by #196 and not by any user. Everything else it was credited with (writer partition, row width) was secondary. Weighed against "the simplest implementation that fully meets current requirements", one speculative capability did not justify what it cost.

**What the column form removes.** The second table and its migration; a second RLS policy, `FORCE` hand-append, and separate cross-tenant negatives, since a column inherits the document row's existing policy automatically; the foreign key, its cascade, and the whole cross-table lock-order and deadlock analysis; deletion propagation as a distinct requirement, because the row _is_ the document; the anti-join coverage predicate, which collapses to a single-table `WHERE`; and the per-corpus-embedding-table requirement.

**What it adds, unexpectedly in its favor.** The rebuild invalidates embeddings for free: when a rebuild rewrites a document's content it nulls the embedding columns in the same statement, so there is no stale-vector window and no separate invalidation path.

**What it gives up.** A model swap becomes re-embed-in-place rather than backfill-in-parallel-then-flip. While re-embedding, the vector leg contributes only for documents already carrying the new key — search degrades toward lexical, which is the shipped state today and the off-by-default state anyway. For a personal or household instance this is a non-event; for a large organization it is a planned window of weaker semantic recall.

**Why still dimensionless.** Even with one model resident, `vector(N)` would bake a specific model's dimensionality into the schema, making every model change a migration. Dimensions are validated in application code against the catalog before insert. The cost is that a vector index must be a partial index over a cast expression — deferred with D4.

**Verify during implementation.** pgvector's storage class for the `vector` type. If vectors are stored inline rather than TOASTed out-of-line, every lexical scan reads a wider tuple. Expected out-of-line; confirm with `\d+` once the extension is present.

### D3. Isolation is inherited, not restated

**Decision.** The embedding columns live on a table that already has `ENABLE` + `FORCE` RLS, one `FOR ALL` owner policy, and no public-read policy. Nothing new is provisioned. The embed worker writes under `runAs(owner)` like every other projection writer.

**Why this still needs a test rather than an assumption.** A vector is a lossy but real encoding of content, so a cross-tenant read of an embedding is a cross-tenant read of content. "It's just numbers" must never become an implicit isolation exemption. The existing projection RLS negatives are extended to assert the embedding columns are unreadable as another user's identity and as the empty identity, including for a `visibility = 'public'` chat.

### D4. No vector index in this change

**Decision.** Ship the columns with no HNSW or IVFFlat index; add one in the retrieval change if measurement justifies it.

**Why.** Nothing reads vectors here, so an index buys nothing and costs build time, write amplification on every embed, and a maintenance surface. It is also the wrong moment to choose one: HNSW parameters should be tuned against real query latency on the real corpus, which only exists after this ships and backfills.

**What the retrieval change inherits.** The index will be **partial** — over `embedding IS NOT NULL AND embedding_model_key = $current` — both because the column is dimensionless and needs a cast, and because most rows may have no vector. A partial index is only used when the query predicate matches the index predicate, so the query must carry both conditions explicitly (D6).

### D5. Embedding rides its own queue, not the reindex job

**Decision.** A new `SEARCH_EMBED_QUEUE` with `policy: 'stately'` and `singletonKey = chatId`, enqueued after commit by **every** path that changes a chat's projection — the inline Tier-1 finalize rebuild, the asynchronous reindex worker, and fork — plus the sweep for chats the coverage predicate reports as lagging.

**Why not fold it into the reindex job.** Three present-tense reasons, none speculative. First, **the happy path is not a queue job**: turn finalize rebuilds inline, so an ordinary turn would have to start enqueueing a reindex job purely to reach an embedding step, and that job would redo a rebuild that already ran — the same number of queue sends plus a redundant rebuild every turn. Second, **retry policies genuinely differ**: a rebuild is local, fast, and should fail loudly on a bug, while an embed needs bounded retries with exponential backoff to ride out a provider outage; one queue means one policy, so a provider outage would back off lexical rebuilds for an unrelated reason. Third, **concurrency profiles genuinely differ** — the same DB-bound versus network-bound split that earns the separate worker group in D14.

**Why the inline finalize path must enqueue.** The reindex worker only runs on the Tier-1 fallback, on fork, and on sweep-discovered chats. Enqueueing only from the worker would mean an ordinary turn on a configured instance produces no embedding work until a sweep noticed it. A queue send is not inline indexing, so this adds nothing to the projection's synchronous path; `stately` plus `singletonKey` absorbs the extra sends.

**Why per-chat granularity.** It matches the existing coalescing, so a burst of writes to one chat collapses to one pending embed job exactly as it collapses to one pending rebuild. Per-document jobs would multiply queue rows by chunk count for no gain, since the provider call is batched per chat anyway.

**Retry policy.** `retryLimit: 5`, `retryBackoff: true`, `deadLetter` at its default. Five attempts with exponential backoff absorb a provider outage of roughly half an hour without dead-lettering. Confirm which of these pg-boss v12 treats as immutable after `createQueue`, as it does the admission `policy`.

**Batch size.** A per-model config field defaulting to 32 documents per request — about 24k tokens at our chunk budget, comfortable for hosted endpoints and small enough not to time out a local model. It belongs in the catalog because the right value is a property of the model and endpoint. It matters little for throughput: most chats hold a handful of chunks, so per-chat jobs rarely fill a batch and backfill is round-trip bound. **Concurrency is the throughput knob, not batch size.**

**Jobs are bounded, and page rather than load.** The worker re-queries outstanding documents a batch at a time under READ COMMITTED — no snapshot, so a concurrent rebuild is picked up naturally and the conditional update handles anything that changed mid-flight. A job processes a fixed number of batches and re-enqueues itself if work remains, rather than draining a large chat in one run: an unbounded job holds a worker slot indefinitely and risks pg-boss's job expiry killing it mid-run, losing the batches it had not yet persisted. `stately` plus `singletonKey` makes the self-re-enqueue safe — at most one pending and one running per chat regardless.

**Persist per batch, not per job.** The hash guard makes a chat's embed job idempotent and self-limiting, but only if completed batches are persisted as they finish. Persisting at the end means a failure at batch 8 of 10 re-embeds batches 1 through 7 on retry, paying twice for work already done.

### D6. No coverage gate — search fuses whatever legs exist, filtered per row by model key

**Decision.** There is no activation gate and no notion of a corpus being "complete enough to serve". Retrieval fuses the legs that exist: full-text always, trigram always, and vectors for the documents that have them. The query filters per row:

```sql
WHERE embedding IS NOT NULL
  AND embedding_model_key = $current_model
```

Configuration names the **intended** model per corpus; coverage is a progress readout, not control state.

**Why the gate was removed.** An earlier draft refused to serve a model until its coverage was complete. That gate was written for the two-table world, where a second model could be backfilled in parallel and then flipped to — "activation" was that flip. Once storage collapsed to a column (D2) there is one model at a time and **no flip left to gate**; the gate outlived its subject. It also interacted badly with terminal failures (D16): if complete meant every document has a vector, one permanently unembeddable document would hold an entire corpus on lexical-only forever, and the alternative to serving a 99.9%-covered corpus is not better retrieval, it is no semantic retrieval at all.

**Why the per-row model-key filter is not negotiable.** Without it, changing the model silently mixes two embedding spaces in one ranking — distances computed across incompatible geometries, producing scores that look valid and mean nothing. With it, a model change degrades correctly on its own: old-key vectors stop contributing the moment the config changes, get re-embedded in the background, and rejoin as they land. No downtime, no flip, no gate.

**Why per corpus.** Knowledge/RAG and curated memory will embed later corpora at their own pace. A single instance-wide model selection would drag a later corpus along with the chat corpus's choice.

**Bulk work is never automatic.** Two kinds of lag exist and must not share a mechanism. _Incremental_ lag — new or edited content under the corpus's intended model — is bounded by write volume and is maintained automatically by the sweep. _Bulk_ lag — a newly declared model, a model change, or an input-version bump — is unbounded and proportional to corpus size, and is advanced **only** by the explicit `backfill` command. A one-line config edit must never start corpus-scale provider spend or hours of saturation on a self-hosted backend. This is also what makes a model transition operator-chosen rather than accidental, which is the honest version of what the gate was clumsily reaching for.

**The three model-change cases.** Redefining an in-use key in place is **rejected at boot** (D1): it silently mixes embedding spaces under one name. Changing a corpus's intended model to a different declared key is **allowed and inert**: nothing regenerates automatically, old-key vectors simply stop matching the query filter, and `backfill` re-embeds when the operator asks. Removing a declared model that still has vectors is **allowed and warned**: those vectors stop matching the filter and are never read, are never auto-deleted — leftover derived data must not block boot or vanish because of a config edit — and are cleared by the explicit `prune` command.

### D7. Content hash plus input version is the sole validity rule, enforced by a conditional update

**Decision.** Each document records the `embedded_content_hash` and `embed_input_version` its vector was produced from. Persistence is a conditional `UPDATE … WHERE id = ? AND content_hash = ? AND embed_input_version = ?`, so a document rewritten or deleted while the provider was working matches nothing and the write is a silent no-op. Results are correlated to requests by an explicit `(model_key, document_id, content_hash)` key — never by response position.

**Why this and nothing else.** It collapses three hazards — a message edited mid-flight, a chat deleted mid-flight, and a chunker-version bump invalidating every chunk — into one comparison, and it doubles as the concurrency resolution in D15. The alternative (timestamps or a generation counter) reintroduces the microsecond-truncation class of bug that already bit the projection's `indexed_at`.

**Why the guard is at persist time.** The window that matters spans a network call. Checking only before the call leaves it entirely open; a conditional update closes it inside the same statement.

**Why positional correlation is banned.** Providers may reorder, omit, or partially fail a batch. Position-based correlation then writes one document's vector onto another's row — a corruption with no error and no symptom until ranking silently degrades.

**The upsert trap.** The rebuild upserts on `(chat_id, chunk_ordinal, chunker_version)`. An `ON CONFLICT DO UPDATE` that does not mention the embedding columns will **preserve a stale vector across a content change** — the single way this design can silently serve a wrong embedding, and invisible unless tested for. The `DO UPDATE SET` must null all five embedding columns whenever `content_hash` changes, with a test asserting exactly that.

### D8. One synchronous OpenAI-compatible adapter; no batch API

**Decision.** Ship `EmbeddingBackend` with `embedQuery` and `embedDocuments`, and exactly one adapter speaking the OpenAI-compatible `/embeddings` endpoint. That single adapter covers hosted OpenAI, Ollama, and every OpenAI-compatible gateway, reusing the existing `providers[]` connection.

**Why no batch adapter now.** The asynchronous batch API halves cost at the price of a submit/poll state machine, durable batch records, and a second class of partial-failure handling. Backfilling a personal-scale corpus does not need it, and the interface reserves the shape so adding it later is additive.

**Why `embedQuery` ships despite nothing calling it.** It is the half the retrieval change consumes, and the asymmetric-prefix contract is only meaningful if both sides exist. Unit tests exercise it.

### D9. The pgvector image swap is one deliberate deployment change

**Decision.** Move all three pinned image references to a digest-pinned `pgvector/pgvector:pg17`, document pgvector as a self-host requirement in `README.md` and `apps/api/AGENTS.md`, and do it first so every subsequent task runs against the real target.

**`vector` is not a trusted extension — installing it is provisioning, not migration.** Implementing the schema layer established this empirically against pgvector 0.8.6: its control file carries no `trusted = true`, so PostgreSQL demands superuser and the non-superuser `app` role that owns the schema and runs every migration cannot create it. `pg_trgm` was trusted, which is why phase 1 created it in a migration and needed no image change. The extension is therefore installed once by the superuser on a fresh database, in the same class as the roles migrations only reference, while the migration still declares the dependency idempotently — `CREATE EXTENSION IF NOT EXISTS` checks existence before the permission check, so the declaration is a harmless no-op for the migrating role. An existing database that predates this fails its next migration with a clear permission error, which is the honest outcome and is documented as an upgrade step.

**Why not make it optional.** A conditional extension means two schema shapes, two migration paths, and a permanently forked test matrix — for a self-hosted product whose operator already runs a Postgres container and can change one image tag. Optionality here is a maintenance liability. The _feature_ stays optional (no configured model means lexical only), which is the optionality that matters to a user.

**Why the upstream image over a custom build.** It tracks the same Postgres major already pinned; a custom image is a build to maintain for no gain.

### D10. Embedding lag needs its own discovery predicate and its own provisioning check

**Decision.** Add a second identifiers-only `SECURITY DEFINER` function owned by the BYPASSRLS `app_rls` role, whose predicate is embedding coverage:

```sql
-- needs embedding
  embedding_model_key      IS DISTINCT FROM $model
  OR embedded_content_hash IS DISTINCT FROM content_hash
  OR embed_input_version   IS DISTINCT FROM $version
  OR (embedding IS NULL AND embedding_fail_reason IS NULL)
```

Extend `db:provision-rls` to assign its ownership, and extend the boot self-check to verify it, with the same loud-error-non-fatal behavior.

**Why a second function rather than reusing the lexical one.** `llame_search_stale_chats` compares `chats.updated_at` against `search_chat_state.indexed_at`. A corpus fully indexed and never embedded is not stale by that predicate, so it returns **zero rows** — the sweep would never see embedding lag. Widening the existing function would couple two independently evolving predicates and change a shipped contract that phase-1 tests pin.

**Why the provisioning check is not optional.** This is the exact failure that already bit phase 1: an unprovisioned `SECURITY DEFINER` function under FORCE RLS returns zero rows _without error_, indistinguishable from "everything is covered". A coverage predicate has the same shape and needs the same fail-loud treatment on day one.

**The `IS DISTINCT FROM` requirement is load-bearing, not stylistic.** Written with plain `=`, an unattempted row has `embedding_model_key = $model` evaluating to **NULL** rather than false, so a negated conjunction yields NULL and the row is silently excluded — never-embedded documents would never be discovered. That is the same silent-zero-rows class as the two failures above, and it is the most likely way this predicate ships broken.

**Scope.** The predicate enumerates lag only for the corpus's intended model, and the sweep advances only incremental lag (D6). Bulk coverage is the `backfill` command's job, so the sweep can never turn a config edit into corpus-wide provider spend.

### D11. Embed the document's `content` verbatim, role labels included

**Decision.** The backend receives `search_chat_documents.content` exactly as stored — role-labelled, original-cased, punctuation and accents intact. No strip step, no derivation. An `embed_input_version` integer is still recorded on every embedded row.

**Why not `normalized_content`.** That column exists for `word_similarity` and `to_tsvector('simple', …)`: NFKC-folded, whitespace-collapsed, lowercased, role-free. Lowercasing removes signal a transformer encoder uses, and the normalization was built to help a matcher with no semantics at all.

**Why the role labels stay — reversing an earlier decision.** An earlier draft stripped them, reasoning from the projection's rule that role labels must never affect lexical ranking. That rationale does not transfer: the lexical hazard is _literal token collision_, and embeddings have no token-level matching. The affirmative case is that our chunks are multi-turn — without speaker attribution, a chunk where the user proposes something and the assistant rejects it is indistinguishable from one where it was endorsed. Prior art agrees: `obra/episodic-memory` embeds `` `User: ${u}\n\nAssistant: ${a}` `` verbatim.

**Confidence: moderate, and deliberately measurable.** There is no strong published evidence specific to role labels in embedding inputs. What is known is mechanical: constant prefixes demonstrably move embeddings (the entire E5/BGE `query:`/`passage:` mechanism works that way), and a constant token in every document adds a shared component that compresses score dynamic range under mean pooling — but the query lacks the labels too, so the effect is roughly uniform and depresses absolute scores more than it distorts ranking. Settle it with the eval harness in the retrieval change.

**Why `embed_input_version` survives despite the derivation being the identity.** Two named consumers, not speculation: the labels-versus-stripped A/B in the retrieval change, and #518's model-generated chunk context. Both change embedding input without changing any content hash, and this column is what makes either an enumerable re-embed instead of a silent divergence.

### D12. Cosine distance, vectors stored exactly as returned

**Decision.** Cosine is the default and only distance metric in this change. Vectors are persisted exactly as the provider returns them, with no normalization in the adapter. The metric stays a per-key catalog and ledger field.

**Why.** Cosine is what every embedding model in scope is trained and evaluated under, and it is magnitude-invariant, so it is correct whether or not a provider returns unit vectors. Normalizing in the adapter would be a silent lossy rewrite of provider output that the ledger could not detect, making stored vectors disagree with the same model's output elsewhere.

### D13. `CHUNKER_VERSION = 3` — oversized messages split, continuation parts carry a bounded anchor

**Decision** (tracked as #517). Bump the chunker so a single message exceeding `CHUNK_MAX_CHARS` is split into budget-sized parts at a text boundary, and every part after the first is prefixed with a bounded anchor: the preceding user message truncated to roughly 400 characters at a word boundary with an explicit elision marker. A message that fits produces byte-identical output to version 2. The anchor lives in `content`, not in an embed-time derivation.

**The defect.** `chunkByCharBudget` always takes at least one item — _"Always take at least one new item; then keep taking while under budget"_ — so a message larger than the budget is emitted whole. The code is aware of it: the overlap logic deliberately refuses to carry "a truly oversized item" forward. Harmless for `tsvector` and trigram; fatal for embeddings, where one 40KB document is a request the provider rejects or silently truncates. At ~750 tokens of budget, a pasted file or a long answer clears it routinely.

**Why fix it in the chunker.** `CHUNK_MAX_CHARS`'s own comment says the value was chosen to be _"inside phase-2 embedding budgets"_ — every document fitting was already the intent, and the always-take-one path is a hole in it. Fixing it here makes the invariant structural: one document is always at most one vector. It also repairs the lexical side, where an oversized document yields useless snippets and skews trigram scoring today.

**The bound is ~2x the budget, not 1x — measured, not assumed.** Implementing this layer showed that "one document fits the budget" is false even after the split. `chunkByCharBudget` seeds each group with the previous group's overlap block _before_ the "always take at least one new item" rule applies, so a chunk can hold one carried block plus one full-budget block: two 2997-character blocks pack into a 5996-character chunk on unmodified behavior. This is pre-existing and deliberate — the overlap is what gives a chunk its surrounding context. The resolution is to state the real bound and size the embedding layer against it, not to change a shipped packer for a property only the unshipped embedding layer needs: doing that would move the lexical eval baseline to buy nothing, since ~6000 characters is roughly 1500 tokens and sits comfortably inside every candidate model's limit (bge-m3 8192, text-embedding-3 8191). The bound is asserted by test rather than assumed.

**Why now.** A version bump costs one full projection rebuild, which the discovery sweep exists to perform. Doing it before any vector exists costs exactly that rebuild; doing it after embeddings ship costs a rebuild **and** a full re-embed.

**Why not turn-based (question/answer) chunking instead.** The corpus is already alternating: the chunker keeps only `user`/`assistant` **text** parts — tool calls, tool results, and reasoning are excluded at the corpus boundary — and a run writes one assistant message. "Question → long exploration → answer" never reaches the index as many messages; it arrives as one user message and one assistant message. The problem is a single oversized message, not multi-turn structure. Strict pairing would also produce many small noisy vectors in the common short-exchange case.

**Why anchor the continuation parts.** A fragment from the middle of a long answer is exactly the fragment that is uninterpretable alone, for a retriever and for a human reading a snippet. Prepending the question it answers is the cheap deterministic form of contextual retrieval (#518 generalizes it with a model). Bounding the anchor makes the long-question case impossible by construction.

**Blast radius.** Verified: the eval fixtures top out at 184 characters, so no eval query's chunking changes and the recorded baseline is unaffected. That the corpus contains no oversized fixture at all is itself a coverage gap, closed by a new fixture.

### D14. A fourth worker group, `search-embed`, and backfill as a producer

**Decision.** Add `search-embed` to `WORKER_GROUPS`, include it in the built-in `all` profile, and gate the embed consumer on `concurrencyFor('search-embed')`. `backfill` is a **producer**: it enumerates uncovered chats through D10's function and enqueues; the embed workers drain.

**Why a group rather than riding `search-reindex`.** `search-reindex` is DB- and CPU-bound, local, milliseconds, and latency-sensitive — it is the Tier-1 fallback, so a chat is not searchable until it runs. Embedding is network-bound, seconds per batch, and explicitly latency-tolerant. One concurrency number cannot serve both: tuned low for rebuilds it serializes backfill on provider round trips; tuned high for embedding it oversubscribes DB connections for rebuilds. Separately, **embed concurrency is the cost knob** — it maps directly to provider spend rate and self-hosted saturation — and riding the existing group would make it a source constant instead of an operator dial.

**The cost, stated.** `docs/scaling.md` is explicit that every group must be covered by some deployed profile across the fleet, and that this is "operator responsibility, not enforced by code". A fourth group is a fourth way to silently run zero consumers. Mitigations: it is in the built-in `all` profile, so default and co-located dev consume it automatically and only split-profile operators can trip it; the api process logs at boot when embeddings are configured but it consumes no `search-embed`; and coverage reporting gives an operator who runs `backfill` an immediate signal if nothing progresses.

**Why backfill produces rather than embeds.** A command that embedded inline would duplicate the worker, bypass the operator's concurrency dial, and require a provider credential in a process that otherwise needs none. As a producer it is resumable, observable through the same coverage readout, and indifferent to where workers run. `prune` and `retry-failed` are different — bounded statements with no provider involvement — so they act directly.

### D15. Concurrency: one row, two writers, three rules

**Decision.** The rebuild and the embed both write the same document row. Correctness rests on three rules rather than on locking discipline:

1. **No transaction spans a provider call.** Read documents, close the transaction, embed over the network, then persist in a short transaction. The embed's update takes a row-level exclusive lock on the very row a rebuild wants, so holding it across a network call would block rebuilds directly.
2. **Persistence is the conditional update from D7.** If a rebuild landed first, the hash no longer matches, the update touches nothing, and the next pass picks up the new content.
3. **Persist under READ COMMITTED.** A single conditional update is already atomic; copying the rebuild's REPEATABLE READ would invite `40001` serialization failures against concurrent rebuilds and buy nothing.

**Why both interleavings are correct.** Rebuild-then-embed: the guard fails, the embed no-ops, the next pass re-embeds against the new hash. Embed-then-rebuild: the rebuild nulls the embedding columns (D7's upsert rule), and the next pass re-embeds. No deadlock is possible because there is one table and no foreign key — the cross-table lock-order analysis the separate-table design required does not exist here.

**No feedback loop.** The embed writes only embedding columns. It must not touch `chats.updated_at` or `search_chat_state`, or the lexical discovery predicate could re-flag the chat, triggering a rebuild, which enqueues an embed, forever. Deriving coverage rather than storing a watermark (D10) makes that structural rather than a rule to remember.

**`SearchModule` stays a leaf.** The embed worker needs config, which `InstanceConfigModule` already provides globally, and a provider client, which the adapter builds directly from `@ai-sdk/openai` exactly as `openai-model-client.ts` does. It imports **no** new module — in particular not `ModelsModule`, which would drag an HTTP controller into the worker graph and risk a cycle back through `ChatsModule` or `RunWorkerModule`.

### D16. Terminal failures are tombstoned in place, and the state is derived from the columns

**Decision.** A document whose embedding fails terminally records `embedding_fail_reason` with its attempt metadata and a NULL vector. Classification is deliberately thin: tombstone only on a terminal HTTP class (4xx excluding 408 and 429); everything else throws and retries under D5's policy. Three states are derived, never stored:

| State             | `embedding` | attempt metadata | `embedding_fail_reason` |
| ----------------- | ----------- | ---------------- | ----------------------- |
| Never attempted   | NULL        | NULL             | NULL                    |
| Embedded          | set         | set              | NULL                    |
| Terminally failed | NULL        | set              | set                     |

**Why tombstone at all.** Without one, a permanently unembeddable document loops forever: retries exhaust, the job dead-letters, and the coverage predicate still reports the chat as lagging, so the sweep re-enqueues it — the retry cap defeated by the discovery mechanism behind it, paying for every other document in that chat on each cycle. That is unbounded spend producing no error anyone reads, the same shape as the two silent failures this design already guards against.

**Why the settled test is a disjunction.** D10's predicate treats a row as settled when the attempt metadata matches _and_ either a vector or a reason is present. Neither column is solely load-bearing, so a half-written row falls through to "needs embedding" and is retried — noisy rather than silent, the failure direction this repo wants. This requires one discipline rule: **attempt metadata is written only at persist time, in the same statement as the vector or the reason.**

**Why the tombstone is scoped, not permanent.** It carries the model key, content hash, and input version, so editing the message, bumping the input version, or changing the model all produce a fresh attempt automatically. The one case that would otherwise stick — unchanged content whose failure was misclassified, or a provider-side bug since fixed — is covered by the `retry-failed` command, which clears the attempt metadata of failed rows so the next sweep re-attempts them.

**Why not an explicit state enum.** It would store what the other columns already determine, and a second representation can disagree with the first — the same argument used against a coverage watermark in D10. Derive the state.

**Interaction with retrieval.** A NULL vector is uniform to the query: it fails `embedding IS NOT NULL` whether it is unattempted or tombstoned, so no special case reaches the retrieval path. Failed documents remain fully lexically searchable, which is exactly today's behavior for every document.

## Risks / Trade-offs

- **Self-hosters cannot upgrade without changing their database image** → Called out as BREAKING in the proposal, documented in `README.md` and `apps/api/AGENTS.md` in the same PR, and stated in the CHANGELOG entry. Migration fails loudly on a non-pgvector database rather than starting half-provisioned.
- **A model swap re-embeds in place, with weaker semantic recall until it completes** → The accepted cost of D2. Bounded by the operator running `backfill` when they choose, and retrieval degrades toward lexical rather than failing.
- **The upsert can preserve a stale vector across a content change** → D7 makes nulling the embedding columns in `ON CONFLICT DO UPDATE` an explicit rule with its own test; this is the one silent-wrong-answer path in the design.
- **A `=` instead of `IS DISTINCT FROM` in the coverage predicate silently hides every never-embedded document** → D10 records the NULL-comparison trap and the test asserts a never-embedded chat is discovered.
- **A silently unprovisioned coverage function looks exactly like full coverage** → D10 mandates the boot self-check and the loud error; this is the phase-1 failure repeating.
- **A fourth worker group is a fourth way to run zero consumers** → D14's three mitigations: the built-in `all` profile, the boot log, and coverage progress.
- **Embedding an existing corpus is real provider spend** → Backfill is operator-invoked, idempotent by hash, and free on a self-hosted backend; coverage is observable so an operator can stop and resume.
- **A chat can be semantically invisible without anyone noticing** → Coverage reports `embedded / failed / missing` as three separate counts rather than folding failures into "covered", so the information is legible; it is not pushed at anyone.
- **The chunker bump rebuilds the whole projection** → The mechanism the projection spec already defines for a version change, verified not to move the eval baseline, and cheaper now than after vectors exist.
- **Vectors are content** → D3 asserts the public-chat and cross-tenant cases explicitly, so "it's just numbers" never becomes an implicit isolation exemption.

## Migration Plan

1. Record the honest pre-change baseline: extend the eval dataset with inflected Russian and Spanish queries and an oversized-message fixture, then rewrite `BASELINE.md`.
2. Swap the three pinned Postgres images to digest-pinned pgvector; confirm the existing suites pass unchanged before adding anything.
3. Land the chunker bump (#517) and let the sweep rebuild the projection. Confirm the eval baseline is unmoved.
4. Ship the migration (extension, ledger, embedding columns, coverage-discovery function), extend `db:provision-rls` and the boot self-check, and extend the RLS negatives.
5. Ship the config surface and the backend adapter. An instance with no `embeddingModels` is unchanged and no queue is created.
6. Ship the `search-embed` group, queue, worker, and the enqueue hooks. New turns begin embedding on instances that configured a model.
7. Run `backfill` for the existing corpus, observing the three coverage counts.
8. Re-run the relevance eval and confirm `BASELINE.md` is unchanged — this change must not move a single metric.

**Rollback.** Steps 5 through 7 roll back by removing `embeddingModels` from config: the queue stops producing, existing vectors become inert, and search is unaffected. Step 4 rolls back by a migration dropping the columns. Steps 2 and 3 are forward-only in practice — reverting the image would break any instance that already ran the migration, and reverting the chunker would mean another full rebuild.

## Open Questions

- **Whether role labels help or hurt the vector.** D11 embeds them verbatim on moderate confidence and mechanical reasoning, not published evidence. The retrieval change settles it with an A/B over the eval dataset; an `embed_input_version` bump is the whole cost of reversing it.
- **Which model to document as the default.** A bge-m3-class multilingual model is the intended recommendation for the self-hosted path, but the specific choice should be made against the extended eval dataset — including the inflected Russian and Spanish queries added in step 1 — rather than asserted here. Nothing in this design depends on the answer.

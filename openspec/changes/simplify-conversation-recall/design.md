## Context

See [proposal.md](proposal.md) for motivation. The current stack exposes the existing `messages.seq` database-wide identity as `messageSeq`, threads it through history cursors, Run queue payloads, compaction `upto_seq`, search hydration, conversation reads, and message links, and preserves a legacy model-result branch behind `search.chats.canonicalModelExcerpts`.

Every query compares message sequence only inside one Chat. Cross-Chat ordering is neither specified nor used. The global values are an allocation side effect. Individual messages have no product deletion/reordering operation; retry updates an existing assistant row, while a fork copies rows into a new Chat. Current Run single-flight limits ordinary same-Chat insert contention to the finishing assistant and a succeeding user turn, but those paths deliberately hold different locks and MUST NOT acquire the Chat row in a new order.

This proposal is layered above the still-unmerged #609 stack. It therefore declares an alpha single-revision hard cutover: retained conversation rows and compaction meaning are migrated, but mixed old/new writers and continued callability of experimental pre-cutover tool coordinates are out of scope. Persisted tool observations still replay verbatim.

## Goals / Non-Goals

**Goals:**

- Use the existing `messages.seq` column as the one ordering key and public Chat-local locator across owner and shared history.
- Preserve committed message order and compaction meaning across deterministic backfill.
- Allocate local sequence without a second ordinal, counter table, per-Chat database sequence, or Chat-row lock.
- Make allowlisted model search canonical without an activation flag or fallback result union.
- Fail before Run admission when an enabled conversation-search process cannot satisfy canonical hydration.

**Non-Goals:**

- Supporting mixed API/worker revisions or old global and new local locator namespaces concurrently.
- Rewriting historical tool-call/result JSON to make pre-cutover coordinates reusable.
- Adding individual-message deletion, reordering, branching, or edit semantics owned by #611.
- Changing web search presentation, vector retrieval, or the public search input.
- Adding a performance target or allocator configuration.

## Decisions

### D1. Change the existing sequence instead of adding a public ordinal

Drop the database-wide generated-identity behavior from `messages.seq`. Keep the column, positive safe-integer application boundary, `(chat_id, seq)` unique index, and every existing within-Chat comparison. Add a datastore check that committed sequence values are positive.

The migration assigns `row_number() over (partition by chat_id order by old_seq)` so each retained Chat becomes `1..N` without changing relative order. Because all downstream relationships already pair a sequence with Chat identity, changing the allocator fixes the public locator and existing cursor/compaction arithmetic at the same boundary.

Alternatives rejected:

- A second `message_index` duplicates ordering state and creates permanent drift risk.
- Computing `row_number()` at read time makes locators dependent on the current row set and turns lookup/pagination into repeated ordinal scans.
- Keeping the global identity but formatting it differently does not produce an intuitive Chat-local locator.

### D2. Allocate `MAX(seq) + 1` under the existing unique constraint

Centralize ordinary message insertion in one repository helper that calculates `COALESCE(MAX(seq), 0) + 1` for the target Chat and inserts that explicit value. The `(chat_id, seq)` unique index is the serialization boundary: if another committed/concurrent insert wins the same value, retry only the named same-Chat sequence conflict inside a savepoint so the caller's transaction remains usable. The implementation SHALL inventory normal finalization, expiry-loss salvage, standalone salvage, and succeeding user acceptance before choosing one fixed internal retry budget, cover exhaustion, and fail rather than loop or silently use a non-local value. The budget is code-owned, not operator configuration or public contract.

Message-ID and one-reply-per-user conflicts retain their current meanings. Collision handling MUST distinguish the sequence constraint from `messages.id` and `messages.in_reply_to`; it MUST NOT convert a duplicate request/reply into a sequence retry.

Fork insertion already owns a new, uncontended Chat. It supplies explicit `1..N` values in copied order to the existing chunked bulk insert. Assistant retries update the existing row and never allocate.

Alternatives rejected:

- A counter column on `chats` would make the assistant finalizer update/lock the Chat row after locking the Run row, recreating the lock-order cycle the current finalizer deliberately avoids.
- A counter table adds lifecycle and lock-order state solely to avoid an indexed maximum query on one Chat.
- Advisory locks introduce another lock class and the same cross-path ordering problem.
- Dynamic per-Chat PostgreSQL sequence objects are operationally unbounded and awkward to cascade.

### D3. Rewrite persisted boundaries in one quiesced migration

The generated migration cannot express this data transition safely by itself, so the API migration exception ledger records a reviewed hand-authored transition and its regeneration checks.

After Run admission is quiesced and accepted/queued Runs are drained, the migration:

1. Preflights `messages.parts` and `run_events.payload` and aborts if any experimental canonical search/read observation carries the unmerged global locator interpretation.
2. Records `(message_id, chat_id, old_seq, new_seq)` in a transaction-local mapping ordered by old sequence.
3. Verifies every `compactions.upto_seq` resolves to an exact mapped message in the same Chat.
4. Temporarily sets both FORCE-RLS tables to `NO FORCE ROW LEVEL SECURITY`; migrations run as their owning role without `app.current_user_id`, so omitting either window can silently update no rows.
5. Drops the identity property and temporarily removes the `(chat_id, seq)` unique index while rewriting to avoid transient old/new value collisions.
6. Rewrites compaction boundaries through the mapping and rewrites message sequence values.
7. Recreates the unique index, adds the positive constraint, and verifies under the open window that per Chat `MIN(seq) = 1`, `MAX(seq) = COUNT(*)`, `COUNT(DISTINCT seq) = COUNT(*)`, message order is unchanged, and every compaction still ends at the same message UUID.
8. Restores `FORCE ROW LEVEL SECURITY` on both tables and asserts `relforcerowsecurity` is true for each before the migration commits.

Queue payloads are the only durable execution state that carries a live message sequence outside canonical rows; draining removes mixed interpretation. Runs themselves retain message UUID FKs. Search documents retain message UUID boundaries rather than public sequence. Browser pagination cursors are restart-scoped and refresh after deployment.

Supported deployments cannot contain pre-cutover canonical search/read observations because #609 is still unmerged. The preflight turns that premise into a checked invariant. An experimental local database that contains them must remove the whole test Chat or reset before migration; supporting both coordinate namespaces without a discriminator is ambiguous when an old global value equals a new local value, so no fallback alias table or historical JSON rewrite is added.

### D4. Treat append-only order as the sequence stability premise

There is no individual-message deletion/reordering product surface. Keep that as a normative application invariant: a committed Chat's rows remain `1..N` for its lifetime; whole-Chat deletion cascades all rows; retry updates retain sequence; forks allocate a fresh namespace.

Do not add a delete trigger. It would complicate legitimate parent-Chat cascade behavior and defend against privileged manual database mutation rather than a reachable product path. Repository/API tests prove there is no individual delete operation and that all owned product deletion remains Chat-scoped. #611 must preserve this locator premise or explicitly supersede it when defining edits/branches.

### D5. Remove activation state and the legacy model branch

Delete `canonicalModelExcerpts` from raw/resolved config types, defaults, JSON schema, examples, tests, Run tool context, worker harness overrides, and search execution. Strict configuration therefore rejects the removed property rather than accepting a no-op.

Canonical coverage becomes an admission invariant at the two process boundaries that can create mixed behavior: an HTTP API that can accept a Run containing the exact allowlisted `search_conversations` declaration, and a worker profile with non-null `runs` concurrency that can execute it. A search-reindex/search-embed/session-cleanup-only worker that neither accepts nor consumes Runs skips the gate even though its module graph imports search services. When required, admission checks the provisioned coverage function plus complete current-version Chat/document locators and throws before Run acceptance or consumer registration on any failure.

`search_conversations` always executes canonical hydration and returns the strict content/metadata union. It never calls a legacy success adapter. `conversation_read` remains independently exact-allowlisted; canonical search is still useful as bounded discovery when the reader is unavailable, and the tool description continues to say to read exact lines when available.

Alternatives rejected:

- Defaulting the old flag to true retains a meaningless rollback mode and permits partial configuration to recur.
- Automatically allowlisting `conversation_read` changes operator permission semantics unrelated to result shaping.
- Falling back when coverage is stale silently recreates the invalid locator behavior found during acceptance testing.

### D6. Keep the follow-up as one stack with separate implementation concerns

The delivery sequence is:

```text
conversation-reads/finalize
  <- conversation-recall-simplification/proposal
  <- conversation-recall-simplification/sequence
  <- conversation-recall-simplification/search
  <- conversation-recall-simplification/acceptance
  <- conversation-recall-simplification/finalize
```

The sequence layer owns schema/data/repository and every directly affected cursor/compaction test. The search layer owns config removal, startup admission, canonical-only execution, and focused declaration tests. Acceptance owns cross-layer queued-Run/product proof and operator documentation. Finalization only syncs/archives OpenSpec and closes #630.

## Risks / Trade-offs

- [Sequence rewrite invalidates experimental global locators] -> Treat this as an explicit pre-merge alpha hard cutover; preserve historical result bytes but do not add an ambiguous dual-namespace reader.
- [Concurrent inserts select the same next value] -> Let the unique index serialize the conflict, retry only its named sequence violation in a savepoint, cover every current finalization/salvage/user writer, and fail after the fixed internal budget is exhausted.
- [A migration rewrites compaction meaning incorrectly or silently no-ops under FORCE RLS] -> Materialize an exact UUID-based mapping, reject an unmapped boundary before mutation, open/restore explicit NO FORCE windows for both tables, and verify every boundary plus restored FORCE state.
- [Old binaries cannot safely write after identity removal] -> Quiesce/drain before migration, deploy matching API/workers as one revision, and require data snapshot restoration or a forward fix for rollback; do not run mixed writers.
- [Privileged manual deletion creates a gap] -> Keep the product contract append-only and verification loud; do not add trigger complexity for out-of-band operator mutation.
- [Boot coverage makes a Run-capable process unavailable] -> Fail before accepting/consuming Runs with aggregate counts and no tenant/content identifiers; operators reindex/repair coverage or remove the tool from the allowlist, while non-Run worker profiles skip the gate.

## Migration Plan

1. Back up the database and confirm the current #609 projection coverage report is complete.
2. Quiesce new Run admission across API instances and drain accepted/queued Runs on every worker revision.
3. Stop old writers, verify the experimental-locator preflight and both NO FORCE/FORCE transitions, apply the reviewed sequence rewrite, and run its order/density/compaction verification queries.
4. Remove `canonicalModelExcerpts` from every instance config and deploy matching API/worker binaries with canonical-only search behavior.
5. Start processes; enabled conversation search must pass the boot coverage invariant before Run consumers register.
6. Run focused search/read/link acceptance against retained Chats, then resume Run admission.
7. Rollback before the data rewrite uses the prior binaries/config. Rollback after the rewrite restores the pre-cutover database snapshot with prior binaries or rolls forward with a corrected migration; mixed locator writers are prohibited.

## Revision History

- **v2 (2026-08-28):** Added shared-history sequence coverage, fail-closed experimental-locator preflight, explicit FORCE-RLS migration windows, process-role-aware search admission, and implementation-owned collision retry sizing after adversarial review.
- **v1 (2026-08-28):** Initial proposal design for canonical-only model search and immutable Chat-local message sequencing.

## Delivery Stack

Use `$gh-stack` before every branch transition and keep this exact linear order:

```text
conversation-reads/finalize
  <- conversation-recall-simplification/proposal
  <- conversation-recall-simplification/sequence
  <- conversation-recall-simplification/search
  <- conversation-recall-simplification/acceptance
  <- conversation-recall-simplification/finalize
```

Each implementation layer uses `$openspec-apply-change` only for its assigned tasks. A lower-layer correction is committed on its owner branch, then replayed upward with `gh stack rebase --upstack`. The final layer uses `$openspec-sync-specs` and `$openspec-archive-change`; no implementation branch is created before this proposal receives explicit approval.

## 1. `conversation-recall-simplification/proposal` — OpenSpec Contract

**Base:** `conversation-reads/finalize`

**Ownership:** `openspec/changes/simplify-conversation-recall/**` only. This layer references #630 but does not close it.

- [x] 1.1 Commit the complete proposal, design, `chat-search`/`conversation-reads`/`tool-calling` delta specs, and exact delivery stack; verify `pnpm exec openspec validate simplify-conversation-recall --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass without application-code changes.

## 2. `conversation-recall-simplification/sequence` — Chat-Local Message Order

**Base:** `conversation-recall-simplification/proposal`

**Ownership:** Message/compaction schema and migration; migration exception ledger; message insertion/allocation; forks; owner/shared sequence-backed history, Run, read, search-hydration, and target behavior; focused unit/integration tests. Implement with `$openspec-apply-change` and `$gh-stack`.

- [x] 2.1 First add database-backed failing tests proving two Chats independently allocate `1..N`, ordinary same-Chat concurrent inserts commit distinct dense values, rolled-back/colliding attempts consume no value, retry updates retain sequence, forks restart at 1, `(chat_id, seq)` remains unique, and cross-tenant insert/read attempts fail under FORCE RLS; verify the focused integration files fail for the current global identity semantics.
- [x] 2.2 Change the Drizzle schema from generated identity to explicit positive `bigint`, generate the baseline migration, add only the reviewed hand-authored preflight/mapping/rewrite required for identity removal and compaction translation, and record it in the API migration exception ledger; open `messages`/`run_events`/`compactions` for global observation preflight, restore `run_events` immediately, bracket the `messages`/`compactions` rewrite with `NO FORCE ROW LEVEL SECURITY`/restored `FORCE ROW LEVEL SECURITY`, remove/recreate both sequence-boundary unique indexes around the remap, then verify `pnpm --filter api db:check`, migration snapshots, and `relforcerowsecurity` assertions for all three tables.
- [x] 2.3 Inventory ordinary finalization, expiry-loss salvage, standalone salvage, and succeeding user acceptance; resolve live/stale active-Run admission after the Chat lock but before user-message allocation; then implement one shared `MAX(seq) + 1` insert path with a fixed code-owned named-sequence-conflict savepoint retry budget. Preserve independent ID/`in_reply_to` conflicts and make fork bulk inserts supply explicit `1..N`; verify unit/integration tests cover every writer, 409/stale-unwedge ordering, send/finalizer deadlock prevention, collision recovery/exhaustion, ordinary user/assistant writes, and large chunked forks.
- [x] 2.4 Execute the actual migration against seeded legacy schemas and verify preflight aborts before mutation when `messages.parts`, `compactions.replacement_history`, or `run_events.payload` contains an experimental canonical search/read observation under global coordinates; otherwise verify every message UUID/prior within-Chat order is preserved, colliding old/new compaction boundaries map to the same terminal message UUIDs, `MIN(seq)=1`, `MAX(seq)=COUNT(*)`, unique dense values hold for every non-empty Chat, and `messages`/`run_events`/`compactions` all have FORCE RLS restored.
- [x] 2.5 Update owner and public shared history pagination/DTOs, the durable Run queue parser, Run/compaction fixtures, canonical search hydration, `conversation_read` neighbors, target links, and acceptance helpers to assert Chat-local positive-safe rather than database-global values; verify zero/negative/fractional/non-finite/unsafe queued sequences fail before history access, the shared path retains public-only RLS/text egress, no public response/tool result/prompt/URL newly exposes a prior global identity, and no individual-message delete/reorder product method is introduced.
- [x] 2.6 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api typecheck`, `pnpm --filter api lint`, `pnpm lint:ast-grep`, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check` before publishing this layer.

## 3. `conversation-recall-simplification/search` — Canonical-Only Model Search

**Base:** `conversation-recall-simplification/sequence`

**Ownership:** Instance config/schema/defaults/tests; canonical-search startup admission; search tool runtime context/result shaping; worker harness/declaration fixtures. Web search presentation remains unchanged. Implement with `$openspec-apply-change` and `$gh-stack`.

- [x] 3.1 First add failing config/search/boot tests proving absent `canonicalModelExcerpts` needs no opt-in, the removed key is rejected, allowlisted `search_conversations` returns only the canonical union, incomplete/mis-provisioned coverage fails startup, and a process without the search tool skips the coverage query.
- [x] 3.2 Remove `canonicalModelExcerpts` from raw/resolved config, built-in defaults, JSON schema, loaders, examples, worker harness overrides, Run tool context, and snapshots; verify strict unknown-property behavior and secret-safe boot errors remain unchanged.
- [x] 3.3 Remove the legacy model success adapter and activation boolean; make `search_conversations` execute canonical hydration unconditionally after the shared candidate query while preserving the web `id/title/snippet/updatedAt` adapter byte-for-byte; verify title-only metadata, stale winner omission, untrusted framing, and result replay.
- [x] 3.4 Gate canonical coverage at HTTP Run admission when `search_conversations` is exactly allowlisted and before every runs-enabled worker profile registers its consumer regardless of that worker's current allowlist; skip only profiles that neither accept Runs nor consume the `runs` queue, fail with aggregate non-tenant counts, and verify API, co-located, dedicated-runs-with/without-local-tool, and non-Run worker configurations cannot accept or execute mixed canonical/legacy Runs.
- [x] 3.5 Run `pnpm --filter api test`, focused `pnpm --filter api test:integration`, `pnpm --filter api typecheck`, `pnpm --filter api lint`, `pnpm lint:ast-grep`, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check` before publishing this layer.

## 4. `conversation-recall-simplification/acceptance` — Cross-Layer Proof and Operations

**Base:** `conversation-recall-simplification/search`

**Ownership:** Queued-Run/product E2E, operator/configuration/rollout documentation, prompt/declaration snapshots, and CHANGELOG. Runtime fixes belong in their lower owner layer. Implement with `$openspec-apply-change` and `$gh-stack`.

- [x] 4.1 Add queued-Run and product E2E proving two Chats expose small independent sequences, search coordinates feed `conversation_read`, numbered reads/continuation survive reload, `/chat/<id>#msg-<local-seq>` targets the same message, a fork restarts at 1, and both search/read/target paths remain closed across tenants.
- [x] 4.2 Add deployment acceptance for quiesce/drain, fail-closed experimental-observation preflight, deterministic retained-history/compaction rewrite with FORCE RLS restoration, process-role-aware canonical-search admission, and stale-key rejection; verify no old global-coordinate alias or historical JSON rewrite is introduced.
- [x] 4.3 Update `docs/conversation-recall.md`, API operational guidance, example config, and packaged prompt/tool declaration snapshots to remove the flag/legacy route and document Chat-local sequence, append-only message order, backup, cutover, and rollback-by-snapshot/forward-fix boundaries; verify `pnpm lint:markdown` and declaration tests.
- [x] 4.4 Update the dated `CHANGELOG.md` entry for #630 without adding this unplanned correction to `ROADMAP.md` or claiming vector retrieval, edits/branching, individual deletion, or mixed-revision compatibility; verify related links to #194, #609, and #611.
- [x] 4.5 Run affected API/web tests, `pnpm lint:root`, focused `pnpm test:e2e -- e2e/web/chat/model-context-transparency.spec.ts`, affected workspace typechecks/lints/builds sequentially, `pnpm openapi:lint:ci`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record environmental blockers separately from repository failures.

## 5. `conversation-recall-simplification/finalize` — Canonical Spec Sync and Archive

**Base:** `conversation-recall-simplification/acceptance`

**Ownership:** Canonical OpenSpec synchronization and archival only; no runtime, migration, UI, config, or product-behavior repair. This layer closes #630. Implement with `$openspec-sync-specs`, `$openspec-archive-change`, and `$gh-stack`.

- [x] 5.1 Sync the verified `chat-search`, `conversation-reads`, and `tool-calling` deltas into canonical specs and verify the canonical diff removes sparse/global/legacy-fallback requirements without changing unrelated search/read/tool behavior.
- [x] 5.2 Confirm `openspec status --change simplify-conversation-recall --json` is complete and every task is checked, then archive the change while preserving completed task history; stop rather than using an incomplete-artifact confirmation path.
- [x] 5.3 Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; confirm the PR diff contains only canonical spec synchronization/archive movement and its body includes `Closes #630`.

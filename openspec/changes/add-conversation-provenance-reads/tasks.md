## Stack Plan

Create the implementation stack before runtime work and keep it linear, bottom to top:

```text
master
  <- conversation-reads/proposal
  <- conversation-reads/projection
  <- conversation-reads/search
  <- conversation-reads/reader
  <- conversation-reads/links
  <- conversation-reads/acceptance
  <- conversation-reads/finalize
```

Each branch owns only its section below. Commit and verify one layer before `gh stack add` creates the next; later-layer changes MUST NOT be folded into a lower branch. After editing a lower layer, run `gh stack rebase --upstack` and return to the top before pushing. Submit with `gh stack submit --auto`, never `gh pr create --base master` for an upper layer.

## 1. `conversation-reads/proposal` — OpenSpec Contract

**Base:** `master`

**Ownership:** `openspec/changes/add-conversation-provenance-reads/**` only.

- [ ] 1.1 Commit the refined proposal, design, delta specs, follow-up links, and stacked implementation plan as one planning-only layer; verify strict OpenSpec validation, Markdown lint, format check, and `git diff --check` without application-code changes.

## 2. `conversation-reads/projection` — Stable Sequence and Source-Addressable Projection

**Base:** `conversation-reads/proposal`

**Ownership:** Visible-message renderer and eligibility predicate; message-sequence invariant; search schema/migration; conversation chunker; projection writer; reindex/backfill/coverage operations and focused tests.

- [ ] 2.1 Add one shared `visibleMessageText` renderer and immutable-evidence eligibility predicate; first write focused tests for exact `\n\n` joining, retained whitespace, multiple/interleaved text parts, excluded non-text parts, user/completed assistant eligibility, and retryable assistant exclusion.
- [ ] 2.2 Add and migrate the unique `(chat_id, seq)` invariant without changing existing sequence values; verify duplicates cannot be introduced, normal inserts remain generated/sparse, sequence is unchanged by assistant retry updates, and public safe-integer validation rejects unsafe values.
- [ ] 2.3 Extend the Drizzle search-document schema with nullable first-message start and last-message exclusive-end UTF-16 offsets; generate the migration, record any required exception, and verify migration snapshots plus database migration/schema checks.
- [ ] 2.4 Make the chunker emit contiguous internal endpoint offsets, keep role labels/anchors outside them, include locator semantics in the internal hash, and bump the chunker version; verify fitting, oversized, multi-message, overlap, Unicode-surrogate, and deterministic no-op cases.
- [ ] 2.5 Persist current locators while preserving embedding invalidation and excluding retryable assistant rows; verify unchanged reindex is a no-op, changed locator/hash state clears stale embeddings, and retryable bytes never enter live documents.
- [ ] 2.6 Extend backfill/coverage reporting for current-version locator completeness; verify a giant multi-part fixture converges with no null current-version locators and RLS denies projection access in both cross-tenant directions.
- [ ] 2.7 Run projection unit/integration tests, migration checks, API typecheck/lint, and sequential API build before creating the search branch.

## 3. `conversation-reads/search` — One Canonical Excerpt per Chat

**Base:** `conversation-reads/projection`

**Ownership:** Shared ranked candidate result; explicit canonical-model-shaping activation config; bounded canonical locator hydration; model-facing lexical/trigram result shaping; unchanged web adapter; focused tests. No vector querying or result shaping.

- [ ] 3.1 Refactor the shared ranked result to retain internal best-document identity while keeping web `id/title/snippet/updatedAt` output and ordering compatible; verify existing web/API search tests remain green.
- [ ] 3.2 Hydrate the winning current-version document through owner-scoped UUID endpoints, recompute visible text, and map source messages to public `messageSeq`; verify partial boundary messages, complete intermediates, multiple text parts, overlap, synthetic anchors, CRLF/LF, oversized messages, and Unicode offsets.
- [ ] 3.3 Add off-by-default `search.chats.canonicalModelExcerpts`; keep legacy model preview shaping while false, require current locator coverage before enablement, and verify legacy/offsetless rows never enter canonical hydration during preparation or rollback.
- [ ] 3.4 Run an explicitly separate deterministic line-preview selector over hydrated canonical lines: qualify either line-local FTS or current trigram/substring matches, form match-plus-one-line windows, merge touching windows per message, and choose the earliest `(messageSeq, offset)` passage; verify NFKC, whitespace collapse, case-only, exact, typo, repeated-match, ranking-vs-preview independence, and cross-line/cross-message-only omission fixtures.
- [ ] 3.5 Return one excerpt per Chat with role/timestamp, flat `{ chatId, messageSeq, offset, limit }`, one top-level untrusted-history notice, at most 500 Unicode code points visibly cropped around a match, and no hash/part/version/line-prefix fields; verify its complete coordinates are accepted directly by `conversation_read` fixtures and framing persists through replay.
- [ ] 3.6 Keep title-only winners metadata-only and omit unauthorized, mutable, deleted, old-version, cross-message-only, or otherwise unhydratable winners rather than substituting projection content; verify model results may safely contain fewer Chats than the unchanged web preview.
- [ ] 3.7 Preserve the current `search_conversations` `{ query, limit }` input and add no vector-only public shape; verify declaration snapshots and model results expose no vector scores, arbitrary source choice, or future #198 fields.
- [ ] 3.8 Run search/resolver/config unit and integration tests, API typecheck/lint, and sequential API build before creating the reader branch.

## 4. `conversation-reads/reader` — Knowledge-Style Message Read Tool

**Base:** `conversation-reads/search`

**Ownership:** Owner-scoped sequence repository reads; strict input/result schema; logical-line extraction/prefixing; bounds/continuation; tool declaration/registry; durable execution compatibility and focused tests.

- [ ] 4.1 Implement owner-scoped lookup by `(chatId, messageSeq)` plus nearest eligible previous/next sequences in one database snapshot; verify sparse gaps, first/last message, deleted rows, retryable assistant exclusion, empty identity, public/shared paths, and both directions of cross-owner denial.
- [ ] 4.2 Define strict `conversation_read` input `{ chatId, messageSeq, offset?, limit? }` with positive safe sequence, zero-based safe offset, and limit 1–2,000; verify malformed UUIDs, unknown properties, negative/fractional/unsafe coordinates, zero/oversized limits, and missing sources fail through their correct validation/resolution path.
- [ ] 4.3 Implement exact visible-message logical-line scanning, one-based `<line>: <text>` rendering, and the closed untrusted-history notice with LF/CRLF/lone-CR/terminal-delimiter semantics; verify blank/empty messages, `\n\n` part boundaries, stored whitespace, direct search coordinates, persisted framing, and generated prefixes that never enter source/hash inputs.
- [ ] 4.4 Preflight the complete structured result under 2,000-line and 15,000-code-unit bounds; return `nextOffset` and Knowledge-compatible `cutReason`, never generic truncation, and return `conversation_limit_exceeded` when the first selected line cannot fit.
- [ ] 4.5 Register `conversation_read` as exact-allowlisted/read-only with timeout/cancellation, persistence, settlement, replay, compaction, neutralization, and generic rendering; verify disabled, advertised, snapshotted, executable, timeout/cancelled, invalid-range, not-found, continuation, payload-clearing, and output-limit paths.
- [ ] 4.6 Verify source deletion never rewrites another Chat's persisted observation while destination-Chat deletion cascades it away.
- [ ] 4.7 Run reader/tool/Run unit and integration tests, API typecheck/lint, and sequential API build before creating the links branch.

## 5. `conversation-reads/links` — Owner Message Targets

**Base:** `conversation-reads/reader`

**Ownership:** Owner-scoped target-ended history loading by sequence; `/chat/<chatId>#msg-<messageSeq>` anchors; focused API/web tests. Tool-call output continues through the generic renderer.

- [ ] 5.1 Extend the existing owner messages query with strict `targetSeq`, mutually exclusive with `beforeSeq`; verify the exact owned target first, then return the normal fixed-size chronological window ending at that sequence, while missing/deleted/public/shared/other-owner targets reveal no foreign existence.
- [ ] 5.2 Give hash-targeted history a distinct target-mode query/cache identity, use `targetSeq`, anchor rendered messages as `msg-<messageSeq>`, and scroll deterministically; verify older pagination and compaction projection start from the targeted window, clearing the hash reinitializes the ordinary newest-window cache, and unseen newer messages are not silently merged or misordered.
- [ ] 5.3 Verify sparse/global sequences are treated as opaque values rather than dense indexes, current/reloaded history uses the same anchor, forked Chats produce independent sequence links, and no copy-link or custom tool-result UI is introduced.
- [ ] 5.4 Run affected API/web tests, typechecks/lints, and sequential builds before creating the acceptance branch.

## 6. `conversation-reads/acceptance` — Product Proof, Rollout, and Documentation

**Base:** `conversation-reads/links`

**Ownership:** Cross-layer E2E, prompts/tool descriptions, config/operator docs, rollout/rollback docs, ROADMAP, and CHANGELOG. Runtime feature code belongs below.

- [ ] 6.1 Add queued-Run and product E2E for lexical search to canonical excerpt to `conversation_read`, continuation/reload, pasted owner message links, giant multi-part messages, retryable/deleted sources, cancellation, and cross-tenant denial; verify persisted call/result pairs reconstruct after reload without vector, outline, activity, or custom tool UI behavior.
- [ ] 6.2 Update packaged prompt/tool descriptions to distinguish bounded discovery excerpts from exact numbered reads and frame recalled conversation text as untrusted historical data; verify declaration snapshots expose no implementation-only UUID, hash, version, or projection fields.
- [ ] 6.3 Update example allowlists and operator/tool documentation for explicit `conversation_read` enablement, sequence/line selectors, bounds, continuation, links, and closed errors; verify configuration tests and Markdown lint.
- [ ] 6.4 Document message-sequence uniqueness, nullable locator preparation, `search.chats.canonicalModelExcerpts`, per-Chat live-version replacement, coverage-gated activation, quiesce/drain declaration cutover, and reverse rollback routing; verify cross-links to #197, #198, #609, #611, #615, #616, #617, and #618 remain accurate.
- [ ] 6.5 Update `ROADMAP.md` and the dated `CHANGELOG.md` entry without claiming vector recall, activity, outlines, branching, or performance work shipped.
- [ ] 6.6 Run affected API/web/UI tests, root E2E, typechecks, lints, AST/Markdown/format checks, and affected workspace builds sequentially; record environment failures without converting partial output into a passing claim.

## 7. `conversation-reads/finalize` — Canonical Spec Sync and Archive

**Base:** `conversation-reads/acceptance`

**Ownership:** Canonical OpenSpec synchronization and archival only; no runtime, migration, UI, or product-behavior changes.

- [ ] 7.1 Sync the verified `conversation-reads`, `chat-search`, `search-projection`, and `tool-calling` deltas into canonical specs; verify the canonical diff matches shipped behavior and introduces no unrelated edits.
- [ ] 7.2 Archive `add-conversation-provenance-reads` after every implementation task is complete; verify strict OpenSpec validation passes for canonical specs and the archived change.
- [ ] 7.3 Confirm the finalization layer contains only spec/archive movement and no runtime diff, then run Markdown/format checks and `git diff --check` before submitting the top PR.

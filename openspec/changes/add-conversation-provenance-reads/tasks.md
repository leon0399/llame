## Stack Plan

Create the stack before implementation and keep it linear, bottom to top:

```text
master
  <- conversation-reads/proposal
  <- conversation-reads/projection
  <- conversation-reads/resolver
  <- conversation-reads/reader
  <- conversation-reads/activity
  <- conversation-reads/replay
  <- conversation-reads/ui
  <- conversation-reads/acceptance
  <- conversation-reads/finalize
```

Each branch owns only its section below. Commit and verify one layer before `gh stack add` creates the next; later-layer changes MUST NOT be folded into a lower branch. After editing a lower layer, run `gh stack rebase --upstack` and return to the top before pushing. Submit with `gh stack submit --auto`, never `gh pr create --base master` for an upper layer.

## 1. `conversation-reads/proposal` — OpenSpec Contract

**Base:** `master`

**Ownership:** `openspec/changes/add-conversation-provenance-reads/**` only.

- [ ] 1.1 Commit the proposal, design, delta specs, and stacked implementation plan as one planning-only layer; verify `openspec validate add-conversation-provenance-reads --strict`, Markdown lint, format check, and `git diff --check` without application-code changes.

## 2. `conversation-reads/projection` — Source-Addressable Search Projection

**Base:** `conversation-reads/proposal`

**Ownership:** V1 visible-message renderer and eligibility predicate; search schema/migration; conversation chunker; projection writer; reindex/backfill/coverage operations and their focused tests.

- [ ] 2.1 Add one shared `visibleMessageTextV1` renderer and immutable-evidence eligibility predicate; verify focused unit tests cover exact `\n\n` joining, retained whitespace, multiple/interleaved text parts, excluded non-text parts, user/completed assistant eligibility, and retryable assistant exclusion.
- [ ] 2.2 Extend the Drizzle search-document schema with nullable first-message start and last-message exclusive-end UTF-16 offsets, generate the migration, record any required migration exception, and verify migration snapshots plus database migration/schema checks.
- [ ] 2.3 Make the chunker emit contiguous canonical endpoint offsets, keep role labels/anchors outside them, include locator/version inputs in the internal hash, and bump the chunker version; verify fitting, oversized, multi-message, overlap, Unicode-surrogate, and deterministic no-op cases.
- [ ] 2.4 Persist locator offsets while preserving embedding invalidation and excluding retryable assistant rows; verify integration tests prove retryable bytes are absent, completed bytes become searchable, unchanged reindex is a no-op, and changed locator/hash state clears stale embeddings.
- [ ] 2.5 Extend backfill and coverage reporting for current-version locator completeness; verify a giant multi-part fixture converges with no null current-version locators and RLS denies projection access in both cross-tenant directions.
- [ ] 2.6 Run the projection layer's API unit/integration tests, typecheck, lint, migration check, and sequential API build before creating the resolver branch.

## 3. `conversation-reads/resolver` — Canonical Search Result Hydration

**Base:** `conversation-reads/projection`

**Ownership:** V1 source-reference types/validation; bounded canonical projection hydration; shared ranked candidate result; model-facing content-result shaping; existing web search adapter and focused tests.

- [ ] 3.1 Define strict V1 conversation-source reference schemas without owner/hash/part/projection fields; verify unsupported versions, unknown properties, malformed UUIDs, reversed ranges, and unsafe line bounds fail before data access.
- [ ] 3.2 Hydrate one winning document from its two projection offsets and only its first-through-last current eligible messages; verify partial boundary messages, complete intermediates, multiple text parts, overlap, synthetic anchors, CRLF/LF, and Unicode offsets reconstruct exact source.
- [ ] 3.3 Refactor the shared ranked-search result to retain internal best-document identity and retrieval-basis diagnostics while keeping the web `id/title/snippet/updatedAt` DTO and ordering compatible; verify existing web/API search tests remain green.
- [ ] 3.4 Resolve FTS/trigram matches with equivalent bounded PostgreSQL line predicates, merge adjacent windows only within each message, keep cross-message passages separately attributed, and fall back to exact `retrieval_context` for cross-line matches; verify exact, typo, same-message multi-match, cross-message, cross-line, and synthetic-label fixtures.
- [ ] 3.5 Add basis-neutral vector-only and title-only shaping without enabling vector querying; verify a synthetic vector winner returns original-language `retrieval_context`, a title-only winner returns metadata only, and neither exposes raw scores or evidence confidence.
- [ ] 3.6 Skip unauthorized, mutable, deleted, old-version, or otherwise unhydratable winning documents instead of using projection bytes; verify integration tests return fewer safe results and never leak a stale snippet.
- [ ] 3.7 Run resolver/search unit and integration tests, API typecheck/lint, and sequential API build before creating the reader branch.

## 4. `conversation-reads/reader` — Bounded Canonical Read Tool

**Base:** `conversation-reads/resolver`

**Ownership:** Owner-scoped message-range repository reads; direct/source selector schema; logical-line slicing; bounds/continuation; oversized-message outline; tool declaration/registry; focused tests.

- [ ] 4.1 Implement owner-scoped boundary ordering and bounded surrounding-message reads in one database snapshot; verify direct lookup, multi-message ranges, missing/deleted IDs, retryable assistant exclusion, empty identity, public/shared paths, and both directions of cross-owner denial.
- [ ] 4.2 Implement exact logical-line scanning with LF/CRLF/lone-CR/terminal-delimiter semantics and directly reusable selectors; verify blank/empty messages, explicit ranges, range errors, original delimiters, and the absence of line-number prefixes.
- [ ] 4.3 Enforce source-first selection with the 20-message, 2,000-line, 15,000-code-unit, and five-message-per-side bounds; verify selected evidence survives before context, continuation is deterministic, generic truncation never clips source, and one non-fitting line returns `conversation_limit_exceeded`.
- [ ] 4.4 Add the on-demand ATX/backtick-or-tilde-fence outline for oversized direct whole-message reads; verify heading text/depth/line coordinates, fenced false headings, no-outline plain Markdown, and no outline on fitting/search reads.
- [ ] 4.5 Register `read_conversation_range` as exact-allowlisted and read-only with cancellation and safe observations; verify disabled, advertised, snapshotted, executable, timeout/cancelled, invalid-range, unsupported-version, not-found, continuation, and output-limit paths.
- [ ] 4.6 Run reader repository/tool unit and integration tests, API typecheck/lint, and sequential API build before creating the activity branch.

## 5. `conversation-reads/activity` — Safe Historical Tool Activity

**Base:** `conversation-reads/reader`

**Ownership:** Ordered text/tool activity projector; narrow conversation/Knowledge attribution extractors; reader activity option and focused security/bound tests.

- [ ] 5.1 Project visible text line regions and settled tool names/outcomes in stored order, admitting only declared conversation and Knowledge attribution; verify reasoning, raw arguments/results, provider metadata, call IDs, prompts, credentials, arbitrary MCP payloads, and causal claims remain absent.
- [ ] 5.2 Integrate optional activity into read preflight as an all-or-error addition; verify text/tool order remains correct and a non-fitting activity request returns `conversation_limit_exceeded` rather than a partial or generically truncated sequence.
- [ ] 5.3 Run activity/reader unit and integration tests, API typecheck/lint, and sequential API build before creating the replay branch.

## 6. `conversation-reads/replay` — Durable Settlement and Replay

**Base:** `conversation-reads/activity`

**Ownership:** Run/tool observation persistence, payload-cleared outcome projection, compaction/replay compatibility, queued-Run acceptance tests, and no UI styling.

- [ ] 6.1 Preserve complete and continuing conversation-read results through Run events, assistant settlement, browser history responses, ordinary replay, and compaction; verify full payloads remain verbatim and payload-cleared `complete: false` observations retain `incomplete` rather than success.
- [ ] 6.2 Add queued-Run integration coverage for model search followed by canonical expansion, giant-message continuation, cross-language vector fixture, deleted source, retryable assistant exclusion, activity metadata, cancellation, and cross-tenant denial; verify persisted call/result pairs reconstruct after reload.
- [ ] 6.3 Run affected Run/chat unit and integration suites, API typecheck/lint, and sequential API build before creating the UI branch.

## 7. `conversation-reads/ui` — Structured Conversation Evidence UI

**Base:** `conversation-reads/replay`

**Ownership:** Shared UI renderer/components/stories and web mapping for conversation references, message/line links, outlines, continuation, and activity; generic structured fallback remains intact.

- [ ] 7.1 Add structured rendering for conversation source references, exact slices, heading outlines, continuation state, and historical tool activity while retaining the generic JSON fallback; verify component stories cover complete/incomplete/error, giant-message, multi-message, and activity variants.
- [ ] 7.2 Wire browser history reconstruction and message links to the renderer without changing public-share text-only egress; verify affected web/UI tests and public-share negative fixtures.
- [ ] 7.3 Run affected Storybook story tests through the Storybook workflow, record preview URLs, then run UI/web typechecks, lints, tests, and sequential builds before creating the acceptance branch.

## 8. `conversation-reads/acceptance` — Product Proof, Rollout, and Documentation

**Base:** `conversation-reads/ui`

**Ownership:** Product E2E, performance evidence, packaged prompts/tool descriptions, config/operator docs, rollout/rollback docs, ROADMAP, and CHANGELOG. Runtime feature code belongs below.

- [ ] 8.1 Add bounded product E2E for search-to-read, reload, direct giant-message navigation, message-bounded source-reference fixtures compatible with future #198 timeline mode, and another-owner denial; verify the production-build Playwright harness passes without implementing timeline discovery or exposing reasoning/raw tool payloads.
- [ ] 8.2 Update packaged prompt/tool descriptions to distinguish canonical quotes, vector retrieval context, metadata-only title hits, historical activity, and untrusted prior content; verify prompt/declaration snapshots expose no implementation-only fields.
- [ ] 8.3 Update example allowlists and operator/tool documentation for explicit enablement, V1 references, bounds, continuations, and closed errors; verify configuration tests and Markdown lint.
- [ ] 8.4 Document nullable schema preparation, locator writers, reindex/coverage, quiesce/drain declaration cutover, and reverse rollback in API/scaling guidance; verify cross-links to #197, #198, #609, and #611.
- [ ] 8.5 Record before/after lexical model-search p50/p95 on representative small and giant chats; verify hydration stays inside the accepted interactive budget and add no optimization unless measurements fail it.
- [ ] 8.6 Update `ROADMAP.md` and the dated `CHANGELOG.md` entry without claiming hybrid/vector or retry/edit semantics shipped; verify both remain forward/shipped-only respectively.
- [ ] 8.7 Run affected API/web/UI tests, root E2E, typechecks, lints, AST/Markdown/format checks, and affected workspace builds sequentially; record environment failures without converting partial output into a passing claim.

## 9. `conversation-reads/finalize` — Canonical Spec Sync and Archive

**Base:** `conversation-reads/acceptance`

**Ownership:** Canonical OpenSpec synchronization and archival only; no runtime, migration, UI, or product-behavior changes.

- [ ] 9.1 Sync the verified `conversation-reads`, `chat-search`, `search-projection`, and `tool-calling` deltas into canonical specs; verify the canonical diff matches shipped behavior and introduces no unrelated spec edits.
- [ ] 9.2 Archive `add-conversation-provenance-reads` after every implementation task is complete; verify strict OpenSpec validation passes for canonical specs and the archived change.
- [ ] 9.3 Confirm the finalization layer contains only spec/archive movement and no runtime diff, then run Markdown/format checks and `git diff --check` before submitting the top PR.

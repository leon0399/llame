# Cross-review: PRODUCT/ROADMAP lens (independent reviewer, 2026-07-05)

## 0. Load-bearing gap first
**Memory has zero footprint in ROADMAP.md today** — no v0.x slot mentions §20 or "memory" at all. The research assumes a "planned memory layer"; in reality it's an orphaned spec section. Repo is at v0.2 (durable runs, in flight); v0.3 (users/RBAC) is next; projects don't exist until v0.5; hybrid search (pgvector+FTS) infra lands in v0.6. R3's "scope inherited from conversation container" is unbuildable before v0.3, and RLS negative tests need ≥2 real users, which don't exist before v0.3 either. Any phase plan must be pinned to these dependencies, not treated as greenfield.

## 1. Phase plan

**Phase 0 — Schema + RLS foundation (S, lands with/after v0.3).** `memory_facts` table per R1's column list, scoped via existing `scope_kind` enum (SPEC §6.2 already has `user|project|group`) — reuse the Config Resolver's inheritance pattern (§6.3), don't invent a parallel one. RLS SELECT via membership joins, FORCE, fail closed. **No UI, no writes yet.** Acceptance: migration + `scripts/rls-test.sh` case proving cross-user SELECT denied; no app surface reachable — satisfies "don't ship a reachable surface that can't be secured" (AGENTS.md).

**Phase 1 — Explicit-only Brain MVP (M, after v0.3, can precede v0.5).** User writes/edits/forgets their own memories manually through Brain UI; user scope only; zero auto-extraction, zero consolidation job. This is the safest possible slice — no promotion logic exists yet, so R3's hard rule 1 (never auto-promote private→shared) is trivially satisfied by having no shared scope at all yet. Ships visible value: "the assistant remembers what I tell it to." Acceptance: CRUD + visibility controls (§20.2); negative test — user A cannot see/edit user B's memory_facts even same org.

**Phase 2 — Project/group scope + explicit promotion + async consolidation (L, needs v0.5 projects + #107 queue).** Add project/group scope_kind writes; "promote to project memory" affordance (R3); `memory.consolidate` pg-boss job (R2) proposing candidate facts from recent runs per §20.3 risk thresholds, auto-accept low-risk/queue-for-review otherwise. Acceptance: negative test — memory born in a private chat is *never* auto-surfaced to a project even after consolidation runs; membership revocation immediately hides previously-shared memory (read-time enforcement, not write-time tag).

**Phase 3 — Retrieval integration + decay signals (M/L, needs v0.6 hybrid search).** Wire memory_facts + episodic FTS into the run's retrieval pipeline (§20.4) with data-framing wrapper (R4); add signal columns (access_count, confirmations, contradictions) per R5 — no scoring formula yet, just capture; wikilink typed links to Knowledge Space notes (R6), "move memory to wiki" promotion. Acceptance: recalled memory system-note-wrapped in transcript inspection; decay columns populate without any deletion path existing.

Everything past Phase 3 (support_weight formula, graph, RL) is explicitly R7 — do not schedule.

## 2. Brain MVP (v1 scope)
v1: a settings-adjacent page listing memories grouped by scope (mine / this project), each with title/body/source_kind badge, edit-in-place, forget (soft-delete → archived, not destructive per R5), and a "used in this response" chip surfaced in chat (§20.2's "show memory used"). Promote-to-project is a single explicit button with a confirmation step, never automatic. **Defer to v2**: search across memories, decay/staleness indicators, markdown vault export (R6), contradiction review queue — these all need Phase 2/3 data that doesn't exist yet. Unimplemented controls in v1 (e.g. "expire after duration" from §20.2) should render disabled, per the repo's own disabled-placeholder convention — not hidden.

## 3. SPEC.md edits
- **§20.3, fix mis-citation (confirmed defect):** current text says memory "is **scanned on write**... the safeguard Hermes Agent applies to every memory entry ([S26])." Verified false — Hermes' defense is `sanitize_context()`/`StreamingContextScrubber` at **recall time**, fail-closed on unterminated spans; `sync_turn` persists verbatim. Rewrite: keep write-time scanning as llame's own independent defense-in-depth, but add a recall-time data-framing requirement and correct the Hermes attribution.
- **§20.1/§20.2, add schema:** no columns exist today — insert R1's `memory_facts` shape (bi-temporal `valid_at`/`invalid_at`/`superseded_by`, immutable provenance, signal columns) under a new §20.1a "Storage model."
- **§20.2, add explicit rule:** "Scope is inherited from the conversation container (chat/project/group) at write time; widening scope requires an explicit user action and is never inferred by a classifier reading private content." This is currently absent and is the single highest-leverage sentence in the whole research output.
- **New §20.5 "Non-goals":** no graph DB, no RL memory policies, no spatial/metaphor UI, no vendor benchmark as a selection input, no silent private→shared promotion — verbatim R7, written down so it survives the next hype cycle.
- **ROADMAP.md:** add a v0.6/v0.7-adjacent milestone line for Phase 0–1 memory work; it's currently invisible to planning entirely.

## 4. Defer/kill list
- **pgvector for memory_facts** — table is small by design (R1); FTS suffices, defer embeddings until proven insufficient.
- **Decay/support_weight scoring formula** — store signals, never implement the ranking function until Phase 3 data exists to falsify it against.
- **Graph database / entity extraction (Mem0/Zep-style)** — bi-temporal columns + typed links cover the validated value at zero new infra.
- **RL-learned memory policies** — zero production adoption anywhere; watch-only.
- **Contradiction-resolution automation** — universally unsolved per the research; surface conflicts to the user, don't auto-resolve.
- **Cross-channel identity-based memory merging** — out of scope until channels (v0.9) exist; don't design for it now.

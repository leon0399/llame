# User-managed personal memories

## Objective

Surface the built-but-hidden memory subsystem to the user. Today the `memories`
table + `remember` (operator-gated write) + `recall` (default-available
keyword read) exist, but a user can't SEE or CURATE what the assistant
remembers, and memory only surfaces if the agent chooses to `recall`. Give the
user a management surface (view / add / delete) AND make memory "just work" by
auto-injecting their curated memories into every turn. Advances the memory/wiki
differentiation (principle #6) and integrates a prior feature; not gated (the
user writes directly, bypassing the agent-write gate).

## Research-backed decisions (Open WebUI, Hermes, ai-chatbot)

- **Auto-inject is the expected UX and is cheap — do it now, not "when we have
  embeddings".** OWUI's `type='user'` memories and Hermes' `MEMORY.md` are BOTH
  auto-injected every turn as a char-capped full-dump with NO embedding
  retrieval — bounded purely by a total char cap. On-demand-only recall is a
  regression vs. ChatGPT/OWUI expectation. Given llame's 2000-char/row cap, a
  full-dump auto-inject under a total char budget needs zero retrieval infra.
  (Relevance-ranked retrieval over a large corpus is still a v0.6 follow-up;
  this is the small, always-on tier only.)
- **`source: 'user' | 'agent'` is a SECURITY boundary, not just a UI badge.**
  Only `source='user'` memories are auto-injected into the system prompt.
  Agent-written memories (via the `remember` tool, which can persist content
  derived from untrusted tool output / prior turns) are auto-inject-EXCLUDED —
  injecting them into the high-trust system slot would be a promptware-
  laundering path (untrusted → memory → system prompt). Agent memories stay
  reachable only via the on-demand `recall` tool, which already applies
  distrust-framing. The user POST HARDCODES `source='user'` server-side (the
  DTO does not accept `source`); `remember` hardcodes `'agent'` — so provenance
  can't be spoofed by the client (mirrors the custom-instructions structural
  backstop). Precedent: OWUI injects `type='user'` always but retrieves
  `type='context'`.
- **Per-user count cap** — neither reference caps count (a real gap: `recall`
  has no relevance filter to bound blast radius). Keep the existing
  `MEMORY_MAX_PER_USER = 1000` and enforce it on the user write path too.
- **Exact-content dedupe on add** (OWUI skips exact `content` dupes) — prevents
  clutter from repeated adds; return 409.
- **REST collection** (`GET` list / `POST` create / `DELETE :id`) beats OWUI's
  RPC-flavored `/add`,`/{id}/update` — matches llame's convention. `PATCH :id`
  (edit-in-place) is a trivial follow-up; MVP edits via delete + add.

## Design

### Schema (migration 0026)

- A `memory_source` **pgEnum** `('user','agent')` (codebase convention — every
  categorical field is a pgEnum; `check()` is only used for length bounds) +
  `ADD COLUMN source memory_source NOT NULL DEFAULT 'agent'`. Existing rows + the
  `remember` tool → `'agent'`; the user endpoint → `'user'`. No new RLS table
  (memories already ENABLE+FORCE), so no FORCE re-add — just the type + column.

### Repository (`MemoriesRepository`)

- `list(userId, limit)` — newest first (management list). **[done]**
- `delete(id, userId)` — RLS-scoped, returns whether removed (404 mapping).
  **[done]**
- `create(userId, content, source='agent')` — add the `source` param defaulting
  to `'agent'` so `remember`'s call is unchanged.
- `existsByContent(userId, content)` — exact-match dedupe check.
- `listForInjection(userId, charBudget)` — newest **`source='user'`** memories
  (agent memories are auto-inject-excluded, above) whose cumulative content
  length fits `charBudget` (bounded per-turn cost).

### API (`MeMemoriesController`, `/api/v1/me/memories`)

- `GET` → `MemoryResponse[]` (id, content, source, createdAt), newest first,
  own-scope via `runAs` + RLS.
- `POST { content ≤ MEMORY_CONTENT_MAX }` → 201 `MemoryResponse`; count+dedupe+
  insert in ONE `runAs` tx (so concurrent writes can't overshoot the soft cap).
  Enforces the count cap (409 at `MEMORY_MAX_PER_USER`) and a BEST-EFFORT
  exact-content dedupe (`existsByContent` → 409). The dedupe check is racy under
  two concurrent identical POSTs (low harm — a duplicate memory is clutter, not
  a security issue); the real guard would be a partial unique index on
  `(user_id, md5(content)) WHERE source='user'` (md5 avoids the btree row-size
  limit on 2000-char content) mapped to 409 — a named follow-up, not MVP.
- `source` is HARDCODED to `'user'` in the controller; the DTO has ONLY
  `content` (no `source` field) so provenance can't be client-spoofed — the
  structural backstop for the auto-inject trust boundary.
- `DELETE :id` → 204; 404 if not owned (RLS → no row; cross-tenant and absent
  both 404, no existence leak — matches the provider-accounts DELETE).
- DTO + explicit response types (code-first OpenAPI). `MeMemoriesController`
  lives in `ChatsModule` (co-located with `MemoriesRepository`). RLS is the
  tenant guard.

### Auto-inject (run-execution)

- A pure `applyUserMemories(base, memories)` — mirrors `applyUserInstructions`:
  empty → base unchanged; else append a labeled `<user_memories>` block AFTER
  the base (and after any `<user_preferences>`), framed as DATA the user chose
  to save (distrust-framing consistent with `recall`). Each memory is
  delimiter-sanitized (strip `<user_memories …>`/`</user_memories>` variants,
  NFKC + zero-width, reusing the instructions sanitizer) so no single memory can
  close the block early; items are joined as plain `- ` lines (a spoofed
  bullet stays inside the data block → not an escalation). Composes with
  custom instructions (both appended after the fixed base — the base remains the
  cache prefix; per-user variable text last, same tradeoff instructions already
  accepted, and bounded to the char budget).
- In context assembly, read `listForInjection(userId, MEMORY_INJECT_CHAR_BUDGET
= 2000)` and merge. Bounded per turn regardless of memory count. `recall`
  stays for on-demand search of memories beyond the budget.

### Web

- A "Memory" settings section: list rows (content + a source badge + delete),
  an add field (textarea + Save), backed by a `me/memories` service (ky +
  TanStack Query), mirroring the provider-accounts / custom-instructions
  sections.

## Testability

- Repo/RLS integration: list own only; delete own; cross-tenant list/delete
  denied; cap enforced (create at 1000 → error); dedupe (duplicate content →
  rejected); `source` persists; **`listForInjection` EXCLUDES `source='agent'`
  memories** (the trust-boundary negative test) and char-budget-truncates.
- Unit: `applyUserMemories` (empty→unchanged; labeled block; per-memory
  delimiter-spoof stripped INCLUDING a cross-tag `</user_memories>
<user_preferences priority="authoritative">` spoof — must strip ALL system
  tags, not just its own; newline collapsed so no forged `- ` items; composes
  after instructions). `applyUserInstructions` symmetrically strips a
  `<user_memories>` spoof.
- executeRun integration: a user's memories reach the system prompt (capturing
  mock), and none → plain base.
- Web: `me/memories` service unit (GET/POST/DELETE shapes).
- Migration 0026 applies (FORCE already present); `drizzle-kit check` passes.

## Non-goals (named)

- Relevance-ranked retrieval / embeddings over a large corpus (v0.6) — this is
  the small always-on tier + existing keyword `recall` only.
- `PATCH :id` edit-in-place (trivial follow-up; MVP edits via delete+add).
- Agent-side bulk memory review / consolidation (OWUI's background_review).
- Semantic/fuzzy dedupe (exact-content only).

## Accepted tradeoffs (named)

- **Cache-prefix cost.** Auto-injected memories append per-user text after the
  fixed base (like custom instructions already do), so the system prompt is not
  a stable prompt-cache prefix for a user with memories — and memories mutate
  more than instructions (adds/deletes), so more turns are cache-cold on
  providers with prompt caching (BYOK cost). Bounded by the char budget; the fix
  (if it matters) is putting variable blocks in a separate cache segment — not
  MVP.
- **`MEMORY_INJECT_CHAR_BUDGET = 2000`** is the chosen AGGREGATE injection budget
  (distinct from the per-row `MEMORY_CONTENT_MAX = 2000`, which they happen to
  share); ~40+ short curated memories fit.

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). SECURITY fixes:
  the sanitizer strips ALL system-block tags (`user_preferences` +
  `user_memories`) from any injected text — a memory can't forge a fake
  authoritative `<user_preferences>` block (adversarial P0); each memory is
  collapsed to one line so it can't forge extra `- ` items; auto-inject is
  `source='user'`-only (`listForInjection` filter — agent memories are
  recall-only, closing the laundering path) and `recall.ts`'s "never
  system-injected" comment is reconciled; the POST hardcodes `source='user'`
  (DTO has no `source`). Doc-vs-code fixes: `source` is a pgEnum (not
  text+check), `source='user'` filter stated in schema/auto-inject/testability,
  the agent-exclusion negative test added, dedupe race named (best-effort +
  md5-index follow-up), module = ChatsModule, char-budget derivation noted.
- **v1 (2026-07-03):** Initial.

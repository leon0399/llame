# obra/episodic-memory — deep-dive notes (2026-07-12)

Source: https://github.com/obra/episodic-memory (Jesse Vincent, TypeScript, MIT). Reviewed at v1.4.2 (2026-05-21) from a shallow clone; ~123 commits / 9 releases, single author with an issue-driven contributor community (~15 credited handles). Single-user, local-first memory for **Claude Code / Codex CLI transcripts**: SQLite (`better-sqlite3`) + `sqlite-vec`, local ONNX embeddings (`Xenova/bge-small-en-v1.5`, 384-dim, q8), surfaced to the agent as an MCP server (`search` + `read` tools) plus a dispatch skill. No server, no tenancy, no network beyond the summarizer LLM call.

**Positioning check:** this is the closest shipped analogue to #194's phase 4 — "the agent recalls its own past conversations" as a product feature, running in anger on real transcripts. Its retrieval machinery is far weaker than our plan (no FTS, no trigram, no rank fusion), so it informs the _memory semantics_, not the retrieval design. Verdict up front: **it independently validates the verbatim-as-index premise, contributes three small borrowable patterns, and is an anti-example on recall-time injection safety.**

## 1. Storage & indexing model

- Schema (`src/db.ts:107-209`, `docs/SCHEMA.md`): `exchanges` = one row per **single user-turn + assistant reply** (not a multi-message chunk), `tool_calls` as cascade-deleted children, `vec_exchanges` virtual table holding one `FLOAT[384]` per exchange.
- **What gets embedded is verbatim transcript text** (`user_message` + `assistant_message` + tool names, `src/embeddings.ts:75-88`). Summaries are **never embedded, never searched** — they live in a sidecar `<name>-summary.txt` and appear only as display decoration on hits (`src/search.ts:214-223`, shown only if <300 chars, `:287-290`).
- Indexing is push-based per session (`sync` wired to Claude Code `SessionStart`/end hooks, `hooks/hooks.json`), incremental via a **high-water mark** — `MAX(line_end)` per append-only JSONL archive file (`src/indexer.ts:275-393`) — no job queue, no dirty table.
- Asymmetric embedding: the BGE query prefix ("Represent this sentence for searching relevant passages: ") is prepended to **queries only** (`src/embeddings.ts:56-73`); their changelog credits the prefix-correct model swap with a measurable R@1 gain on the author's own 17k-exchange corpus.

## 2. Summarization — not our compaction

Suspected overlap with llame's compaction (#57): **not confirmed — different mechanism, different problem.** Compaction keeps a live context window bounded mid-run and stores structured first-class rows; this is a **post-hoc, whole-conversation, one-shot display digest** per finished transcript:

- ≤15 exchanges → single LLM call; when a `sessionId` exists it **resumes the actual session** via the Claude Agent SDK (`resume`, `persistSession: false`) so the summarizer sees original context instead of re-read text — clever, but harness-specific plumbing a stateless server pipeline can't use.
- \>15 exchanges → hierarchical: chunks of 8 summarized independently, then a synthesis pass (`src/summarizer.ts:430-594`). Haiku by default, Sonnet fallback on thinking-budget errors.
- Output is schema-less free text (2–4 sentences in a `<summary>` tag) — no fields, no facts, no per-topic structure. Much shallower than our compaction rows.

Two genuinely reusable resilience details around it:

- **Trivial-conversation short-circuit** (`src/summarizer.ts:464-475`): skip the LLM call entirely below a length/content threshold — cheap noise filter for any batch LLM pipeline.
- **Error-sentinel pattern** (`src/summary-sentinel.ts`, changelog #96): a failed summarization writes a structured sentinel with a retry-after cooldown, so a transient LLM/network error neither retry-loops the queue head nor silently marks work done. pg-boss `retryLimit` + dead-letter covers most of this for us; the cooldown-then-retry nuance is worth carrying into #196's batch embedding worker.

## 3. Retrieval

- Hybrid = `sqlite-vec` KNN (cosine via L2 on unit-normalized vectors, `src/search.ts:149-178`) **union** SQL `LIKE '%q%'` substring (`:180-207`). Not FTS5, not trigram. `mode: 'both'` dedups by exchange id and **appends unranked text hits after vector hits — no fusion, no RRF, no BM25**.
- Multi-concept queries (`searchMultipleConcepts`, `src/search.ts:319-379`): N independent vector searches at `limit*5`, keep conversations present in **all** result sets, rank by mean similarity. An over-fetch-then-intersect conjunction hack — partly a workaround for single-turn embedding granularity (one exchange vector can't hold a topic), and it silently drops matches whose rank for one concept falls outside the over-fetch window.
- **Temporal handling is hard filters only** (`after`/`before` ISO bounds, `src/search.ts:121-131`) plus exact-match `project`/`session_id`/`git_branch` filters (added by user demand, their #63). There is **no recency signal in ranking anywhere** — dates are binary include/exclude.
- sqlite-vec quirk worth knowing doesn't transfer: KNN executes before `WHERE`, forcing a `k = limit*3` over-fetch when metadata filters are active (`:155`). pgvector composes with `WHERE` normally — one more reason our exact-scan-under-RLS plan is simpler than it would be on this stack.

## 4. Agent surface & injection safety

- MCP tools `search`/`read` + a `search-conversations` subagent dispatched by a skill whose trigger is deliberately broad ("before saying 'I don't know'"). Notable product lesson from their changelog: an explicit slash command **lost** to description-tuned automatic skill dispatch (3/5 vs 0/5 trigger rate) and was removed in 1.4.0 — tool/skill _description quality_ did the work. Relevant to #198's "prompting surface" item: invest in the tool description, not a bigger system prompt.
- The subagent is told to synthesize and **not** paste raw excerpts — accidental containment (anti-context-bloat, not a security control).
- **No recall-time injection framing exists** — grepped for any "recalled content is data" wrapper: none. `search`/`read` output is raw markdown straight into the agent context. The only related mechanism is an _index-time opt-out_ marker string (`<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</...>`, `src/sync.ts:7-11,156-159`) — itself content-triggered and thus injectable. **Do not read this repo as evidence that recall framing is unnecessary; it never addressed the threat model.** Hermes Agent's recall-time `sanitize_context()` remains the reference for #198.

## 5. Borrow / reject for #194

**Borrow:**

- Verbatim-as-index, summary-as-decoration — a shipped tool independently converging on the cross-report's load-bearing premise (verbatim > extraction). Strongest external validation we have.
- Error-sentinel + cooldown for failed async LLM work → #196 batch worker discipline.
- Query-prefix hygiene as a named risk: losing the asymmetric prefix is a quiet, measurable-recall integration bug → #196/#197 acceptance detail (our registry's `document_prefix`/`query_prefix` design is validated).
- Provenance equality filters (project/branch/session) as first-class tool params → precedent for #198's filter surface (implemented properly, composed into `WHERE`).
- Skill/tool **description tuning over explicit invocation** for recall dispatch → #198 prompting-surface guidance.

**Reject:**

- Single-turn-pair embedding granularity — the multi-concept intersect hack is the workaround it forces; our contextual multi-message chunks avoid the disease instead of treating the symptom.
- `LIKE` substring + unranked union — strictly weaker than FTS `simple` + `word_similarity` + RRF; nothing to take.
- Recency as hard filter only — confirms our recency-as-_ranking-only_ choice is an improvement over shipped practice, not imitation.
- SQLite/`sqlite-vec`, filesystem-local single-user everything — no tenancy, no RLS, no concurrency model beyond a local file-lock fix (their #97). Zero transfer to a multi-tenant server.
- Session-resume summarization — Claude-Agent-SDK-coupled; inapplicable to a provider-neutral backend.

## 6. Maturity signal

Honest, detailed changelog (387 lines) documenting real incidents with root causes (hook re-entrancy process explosion #87/#88, SQLITE_BUSY races #97, a shipped-then-fixed similarity formula #55); 35 test files including env-gated live-harness e2e driven in tmux. Solid for a solo project — but every benchmark and design validation is **one author's own transcript corpus on one machine**. Treat its retrieval-quality numbers as "works for one user's data", not as evidence at multi-tenant scale or under RLS-scoped queries.

## Why

`search_conversations` answers one question: "which of my chats mention these words?" It cannot answer "what did I discuss yesterday?" or "find the Postgres decision, I think it was in July": there is no way to bound a search by time, and no way to list activity in a period without a keyword. The hybrid candidate pipeline (#197) and the canonical source contract (#609) are shipped, so the remaining gap is the tool's input contract and one query-less discovery path. This change makes `search_conversations` the single citation-safe episodic discovery tool for both content and bounded timeline queries, followed by the existing `conversation_read` for exact text. Issue #198; it subsumes the closed duplicate #327 (`recent_chats`).

## What Changes

- **BREAKING (pre-launch): `search_conversations` input is replaced.** The tool takes one strict object with a `mode` discriminator: `content` (keyword search, optional time range with a `required` or `preferred` constraint) or `timeline` (time range, no query). Unknown properties, blank queries, reversed or empty ranges, malformed instants, and mode/field mismatches are rejected before any scan. The prior `{ query, limit }` shape stops existing; there is no alias.
- **Time ranges are absolute, half-open `[after, before)`, and may be one-sided.** A missing bound is simply no clause; the result echoes the range actually applied. The tool parses no natural-language dates. Timeline mode requires at least one bound; content mode with no range keeps today's global relevance order with no recency decay.
- **`required` ranges filter, `preferred` ranges nudge.** A required range removes candidates whose canonical message timestamps fall outside it before ranking, and passage selection inside a winning chunk considers only in-range messages, so a returned quote always carries an in-range timestamp. A preferred range adds one small fixed rank-fusion term to in-range candidates: it excludes nothing and admits nothing, lets an in-range match overtake out-of-range matches ranked moderately above it, and cannot push an exact out-of-range match out of the results. The constant is a recorded hypothesis for #600 to tune.
- **Timeline mode returns activity pointers, never excerpts.** One region per qualifying chat: `chatId`, title, first and last eligible message instants inside the range, the eligible message count inside it, and the first and last eligible `messageSeq` inside it as plain `conversation_read` coordinates. No snippets, scores, or generated text; ordered by last activity descending; `truncated` reported explicitly.
- **Result envelope gains `appliedRange` and `truncated`.** Rows gain nothing. Per-leg ranks, scores, and matched-by diagnostics stay internal to the eval harness, as today; no log line is added.
- **Temporal interpretation moves into the packaged default prompt**, next to the existing recall guidance, anchored on the already-rendered `context.systemTime` / `context.systemTimezone`: exact phrases use timeline or `required`; uncertain recollections use `preferred`; "recently" with no finite period is materialized into a finite range or clarified with the owner.
- **Not changed:** `conversation_read` (name, input, one-message reads), the web command palette contract, the projection schema, the vector-only first-message anchor from #197 D5, the recency digest, tool allowlisting. No `recent_chats` tool, no operator search syntax, no reranker, no owner-level episodic toggle (#326 is decoupled and no longer blocks #198).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-search`: the ranking-and-shaping requirement replaces the frozen `{ query, limit }` model input with the strict two-mode contract, adds the required-filter and preferred-boost semantics, the envelope fields, and the timeline activity-region result; the tenant-isolation requirement extends its negatives to timeline discovery; the eval requirement gains dated fixtures for range filtering, range preference, and timeline coverage under the same CI-only floors discipline.

## Impact

- **Code:** `apps/api/src/search/core/fusion.ts` gains an optional range-preference term; `chats-repository.ts` composes the required-range predicate into the existing document and parent scope predicates and gains one owner-scoped timeline query over `messages` carrying the reader's identity guard; the message-eligibility SQL fragment is extracted from `messages-repository.ts` and shared; `tools/search-conversations.ts` owns the new schema, its in-tool strict re-parse (Zod cross-field rules do not survive the JSON Schema conversion), mode dispatch, envelope, and in-range passage selection; `apps/api/src/prompts/chat-default.md` gains the temporal guidance paragraph; scripted-model tests that emit `{ query, limit }` move to the new shape.
- **Schema:** none. No migration. The timeline query uses the existing `messages_chat_created_idx` and owner RLS.
- **Runtime cutover:** the tool-calling spec's declaration-cutover requirement applies: quiesce Run acceptance, drain Runs bound to the prior declaration, deploy matching API and worker, resume. Fail-closed drift is the backstop, not the plan. Persisted observations authored under `{ query, limit }` replay as recorded.
- **Web:** `searchByOwner` grows optional parameters; the palette passes none and is byte-identical.
- **Docs:** `docs/conversation-recall.md` contract section, `SPEC.md` §20 search sentence, `apps/api/AGENTS.md` tool note, `CHANGELOG.md`, and the `ROADMAP.md` deferred-backlog line for #198.
- **Issue #198 criteria handled elsewhere or deliberately changed:** cross-language recall returns the original-language source through `conversation_read` and no generated rendering exists to label (inherited from #609; translation is out of scope); a source edited, deleted, or de-authorized after discovery fails on read with `conversation_source_not_found` (inherited from #609); `limit` is rejected above the mode's maximum rather than server-clamped so the model learns the bound; one-sided ranges are accepted (design D9); citation-support, invocation, abstention, latency, and cost measurement belong to #600.
- **Issues:** #198 is closed by the finalize layer. #331 (single-chat narrowing) and #454 (owner timezone) remain separate and unblocked.

## Context

See proposal.md for motivation. Current state that shapes the approach:

- `search_conversations` (`apps/api/src/tools/search-conversations.ts`) accepts `{ query, limit }`, embeds the query before `tenantDb.runAs`, calls `ChatsRepository.searchByOwner`, then reauthorizes and hydrates each winning document and runs the canonical-line matcher (#609). A vector-only winner is anchored to its document's first message (#197 D5).
- `searchByOwner` builds one SQL statement through `search/core/fusion.ts`. Every candidate leg is filtered by an injected `scope.document` predicate and the title leg and final ranking by `scope.parent`; today both are the owner predicate. Fusion is RRF (`k = 60`), grouped per chat, ordered `score DESC, updated_at DESC, id`, then `LIMIT`. The statement runs under `statement_timeout = 3000`.
- Projection documents carry `first_message_at` and `last_message_at`. Canonical `messages` carry `created_at`, an immutable chat-local `seq`, and the evidence-eligibility predicate that `messages-repository.ts` already mirrors in SQL (user rows; assistant rows whose `usage.status` is absent or `completed`).
- `conversation_read` reads one message by `{ chatId, messageSeq, offset, limit }` and returns `previousMessageSeq` / `nextMessageSeq` for eligible neighbors. The conversation-reads spec forbids concatenating messages into one source string and forbids new opaque locators.
- The packaged default prompt (`apps/api/src/prompts/chat-default.md`) already renders `context.systemTime` and `context.systemTimezone` and carries one recall paragraph.
- A Zod tool schema is converted once at admission (`asSchema().jsonSchema`) into the JSON Schema that is snapshotted, sent to the provider, and compiled by ajv for argument validation at execution. Zod refinements do not survive that conversion, so cross-field rules a tool needs at runtime must be re-parsed inside the tool, as `conversation_read` already does. The OpenAI client always sends `strict: false`.

Decisions D1–D13 were settled with Leo on 2026-09-05 before this proposal was written; D14 and the `w_pref` magnitude in D5 came out of the first review round.

## Goals / Non-Goals

**Goals:**

- One tool, two strict modes, validated before any scan, with the smallest change to the shared SQL kernel.
- Required ranges are exact against canonical message timestamps; preferred ranges cannot hide a strong out-of-range match.
- Timeline results are pointers into canonical history that `conversation_read` accepts directly, with no excerpt selection.
- The web palette and the projection schema are untouched.

**Non-Goals:**

- Owner-level episodic toggle (#326), single-chat narrowing (#331), owner timezone (#454), natural-language date parsing, operator search syntax, a `recent_chats` tool, global recency decay, rerankers, multi-message range reads, query fan-out, translation, model-visible diagnostics.

## Decisions

### D1. #326 is decoupled; the tool ships under the operator allowlist alone

Both modes are gated exactly as today: exact `tools.allowed` entry, `read_only`, immutable Run snapshot. The "#326 disabled state" acceptance criterion moves to #326, whose own body settles the default and the `shareRecentChats` migration. The GitHub dependency was removed on 2026-09-05. Alternative: ship #326 as layer 1 of this stack. Rejected: settings, bind-time gating, a migration, and web UI are a different reviewer and a different risk than a retrieval contract; welding them dilutes both reviews.

### D2. Timeline returns `firstSeq` / `lastSeq`; the model walks `conversation_read`

Each timeline region carries `firstSeq` and `lastSeq`, defined as `MIN(seq)` and `MAX(seq)` over the eligible messages inside the range (a user message and its reply can share one `created_at`, so the sequence, not the instant, is the boundary). The model reads a message and follows `nextMessageSeq` until `lastSeq`; the reader knows nothing about the range, so the prompt states that a message beyond `lastSeq` is outside the period. Zero reader changes, and the conversation-reads spec's per-message attribution and line space stay intact. Alternatives: extend `conversation_read` to a `messageSeq..toSeq` range returning per-message blocks (a conversation-reads spec change, deferred until the step cost is shown to matter); a new `read_conversation_range` tool (a second tool for the same read authority). Known cost: a long day is many reads under `tools.maxStepsPerRun`; the prompt tells the model a listing may stop at metadata.

### D3. Shipped names and plain coordinates

`conversation_read` keeps its name and input. Timeline regions and content rows carry `chatId` + `messageSeq` (+ `offset`/`limit` for content), never a minted `sourceRef`. The issue's `read_conversation_range` and `sourceRef` predate #609 and are superseded by its spec, which forbids new opaque locators.

### D4. `required` filters at two points

1. **Candidate legs:** the range predicate on the document is `first_message_at < before AND last_message_at >= after` (each half omitted when its bound is absent), composed into `scope.document`, which every document leg already applies. The parent predicate gains `EXISTS (eligible message in the chat with created_at in range)`, composed into `scope.parent`, which the kernel applies twice: in the title leg and again in the final `ranked` CTE, so the EXISTS gates every returned chat, not only title-only winners. A title-only winner is therefore returned as `kind: "metadata"` only when the chat had eligible activity in the range. No fusion change; the legs already accept an arbitrary scope predicate. Every `messages` predicate reuses the SQL eligibility mirror from `messages-repository.ts`, extracted into one shared fragment, together with its identity guard (see D14).
2. **Passage selection:** a chunk that overlaps the range may contain the matching line in a message outside it. The hydrated document carries per-message timestamps, so the canonical-line matcher considers only messages inside the range before selecting the earliest passage; a lexical winner whose only in-range occurrence is later in the chunk is therefore still returned. A vector-only winner has no matching line and keeps #197 D5's first-message anchor; when that anchor is outside the range the row is omitted even if a later message in the chunk was inside it. That is a known limitation inherited from D5 and is preferable to returning a dated row that contradicts the filter.

Alternative considered: filter only in SQL, or re-check the already-selected passage after hydration. Rejected: a chunk-level overlap is not a message-level guarantee, and re-checking after selection silently drops a chat whose in-range match was simply not the earliest passage.

### D5. `preferred` is one additive RRF-style term

In `doc_fused`, a document whose span overlaps the preferred range (the same predicate as D4's document filter) gains one additive term `w_pref / (k + 1)` with `k = 60`. The term excludes nothing: it can only reorder documents that already matched a leg, so a preferred range never admits a chat the query did not reach. It is bounded by construction, but the bound is a design choice, not a free property: with the shipped leg weights (fts 1, trgm 0.35, title 1, vector 1) the whole fts leg spans `1/61 - 1/160 ≈ 0.0101`, so `w_pref = 1` (`≈ 0.0164`) would rank every in-range fts hit above every out-of-range lexical winner, which is the "in-range first" tier this decision rejects. The recorded hypothesis is `w_pref = 0.25` (`≈ 0.0041`), which lets an in-range document overtake an out-of-range one roughly twenty fts positions above it and no more. That is the whole guarantee: if more than `limit` in-range documents sit inside that window, an exact out-of-range match is displaced from the page. No preservation rule pins it, because a pin would be a second ranking channel to explain and tune; the model recovers by widening `limit` or dropping the range, and the prompt says so. Because the term enters `doc_fused`, it also participates in the per-chat top-3 rollup (chat-level effect up to `(w1 + w2 + w3) · w_pref / (k + 1)`) and can change which document within a chat becomes `best_doc_id`, so a preferred range may move the hydrated passage to an in-range document of the same chat; that is intended. The range predicate needs the document's timestamps, so `doc_fused` joins back to the document table only when the block is present; the emitted SQL without it stays byte-identical. Alternatives: a lexicographic "in-range first" sort key (rejected: a weak in-range hit beats an exact out-of-range one); no `preferred` at all (leaves the model choosing between a hard filter and no filter). `w_pref` is a hypothesis recorded with its fixture effect; tuning belongs to #600.

### D6. Envelope carries `appliedRange` and `truncated`; content and metadata rows carry nothing new

`appliedRange` echoes exactly the bounds passed (a missing bound is absent, not filled with "now"), plus the constraint in content mode. `truncated` means candidate overflow before shaping: the repository fetches `limit + 1` candidates, the extra one is discarded before hydration, and `truncated: true` states that at least one further ranked candidate existed. Timeline rows are the new closed `kind: "timeline"` branch defined in the spec and appear only in timeline mode. Hydration may still drop content rows, so `truncated: true` can accompany fewer than `limit` rows; the flag answers "was the candidate list cut", not "were exactly `limit` rows shown". Per-leg ranks, fused scores, and matched-by legs stay where they are today: retained on the internal result for the eval harness and never serialized to the model. No log line is added. Rationale: a field the model sees is a field it rationalizes about; #197 D5 already excluded `matchedBy` and the spec forbids score exposure.

### D7. Limits

Content: `limit` 1–10, default 5 (unchanged). Timeline: 1–50, default 20. Both fetch `limit + 1` to compute `truncated`. The advertised JSON Schema can only carry one `maximum` (50); the `limit` description states the per-mode range, and a content `limit` above 10 is rejected by the in-tool parse rather than clamped. The issue asked for server clamping; rejection is chosen so the model learns the bound instead of silently receiving fewer rows.

### D8. Minimal eval

Three fixture categories join the existing dataset: `range-required` (an exact match outside the range must not return; the same match inside must), `range-preferred` (an exact out-of-range match still returns in the top K; an in-range near-tie moves ahead of an out-of-range near-tie), and `timeline` (a dated corpus where the returned region set equals the chats with eligible activity in the range and counts match). All run in CI against the lexical configuration with no provider. Invocation and abstention are model behavior and are covered by a scripted-model integration test, not the eval dataset. The full episodic eval belongs to its own epic.

### D9. One-sided ranges are allowed; a missing bound is a missing clause

The issue rejects one-sided ranges. That conflated scan cost (bounded by owner scope, `messages_chat_created_idx`, the 3 s statement timeout, and `limit + 1`) with the `recent_chats` concern (queryless, unbounded), which `limit` + `truncated` already bounds. "Before the Batumi move" is a legitimate single-bound query, and forcing the model to invent a second bound produces worse queries. Content mode accepts zero, one, or two bounds; timeline mode requires at least one. Reversed or empty two-sided ranges reject. Nothing is filled with `now`.

### D10. Structured input only; no operator syntax

The model gets typed fields, not `after:`/`before:` tokens. `websearch_to_tsquery` already treats `"quoted phrases"` as phrase matches on the FTS leg (the trigram and vector legs ignore quotes), which the tool description mentions in one sentence. A palette operator syntax for humans compiles to the same repository parameters and is a separate web issue.

### D11. Flat strict object with `mode`, not a union

Two live probes against OpenAI chat completions with the production client rejected both a root `anyOf` (`schema must be a JSON Schema of 'type: "object"'`) and a root `type: object` with `oneOf` branches (`must not have 'oneOf'/'anyOf'/'allOf'/'enum'/'const'/'not' at the top level`). The schema is therefore:

```ts
z.object({
  mode: z.enum(["content", "timeline"]),
  query: z.string().min(1).max(200).optional(),
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  constraint: z.enum(["required", "preferred"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})
  .strict()
  .superRefine(/* mode rules, ordering, per-mode limit cap */);
```

Validation runs in two layers. The snapshotted JSON Schema (compiled by ajv at execution, advertised to the provider) enforces shape: known fields only, types, enum values, `limit` 1–50. The cross-field rules live in `superRefine` and do not survive the JSON Schema conversion, so the tool re-parses its input with the full Zod schema at the top of `execute`, exactly as `conversation_read` does, and returns the `invalid_input` observation on failure. Those rules are: `content` requires a non-blank `query`, requires `constraint` when any bound is present and forbids `constraint` when none is; `timeline` forbids `query` and `constraint` and requires at least one bound; `after < before` when both present; `limit <= 10` in content mode. Both layers reject before any retrieval statement; the spec's "never reach retrieval" scenario covers both. The `mode` description carries the two-shape contract and the tool description carries two few-shot calls. Alternative: nested `{ content?: {...}, timeline?: {...} }` with exactly-one. Rejected: exactly-one over optional objects is a shape models get wrong more often than an enum, and it cannot be expressed at the root either.

### D12. Stack

Every layer is a `$gh-stack` layer implemented with `$openspec-apply-change`.

```text
(master) <- episodic-timeline-search/proposal
         <- episodic-timeline-search/sql        range filter, preferred term, timeline query, integration tests
         <- episodic-timeline-search/tool       schema, modes, envelope, prompt guidance, scripted-model test
         <- episodic-timeline-search/eval       fixtures, docs, changelog, roadmap
         <- episodic-timeline-search/finalize   spec sync, task records, archive
```

After the `sql` layer merges, nothing user-visible changes: the new parameters are optional and unused. After `tool`, the contract is live.

### D13. Temporal guidance lives in the packaged prompt

`chat-default.md` gains one paragraph after the existing recall paragraph, anchored on the temporal anchor already rendered there. The tool description stays short because it is bound into every receipt and resent every step. Until #454 ships, relative phrases resolve against the instance timezone; that is an accuracy limitation, not a blocker.

### D14. `messages` predicates carry the reader's identity guard

`messages` has a permissive `messages_public_read` policy for the empty identity over public chats. The existing reader defends against it twice: it throws on an empty owner id and adds `current_setting('app.current_user_id', true) = <owner>` inside the statement. Both new `messages` predicates (the D4 `EXISTS` and the timeline query) carry the same two guards, so an empty-identity call with a real owner id as the parameter returns no region and no metadata row even when that owner has a public chat. The projection tables need no such guard: their owner policy already requires a non-empty identity.

## Risks / Trade-offs

- [The timeline query is a new owner-scoped scan over `messages` grouped by chat] → owner predicate plus RLS inside the statement, `messages_chat_created_idx`, `limit + 1`, and the same `SET LOCAL statement_timeout = 3000`; a timeout is a structured `search_failed` observation like today.
- [A required range drops a vector-only winner whose first-message anchor is outside the range while a later in-range message carried the match] → recorded as a known limitation; the fix is #197 D5's anchor rule, not this change.
- [`w_pref` is untuned] → recorded as a hypothesis with its fixture effect; tuning is #600's work. The fixture asserts retrievability (out-of-range exact match stays in the top 10) and one near-tie reorder; it cannot prove the constant is right.
- [Changing a code-owned conversation declaration] → the tool-calling requirement "Conversation read uses the existing immutable read-only tool loop" mandates quiesce, drain, deploy matching declarations, resume; the Migration Plan follows it. The fail-closed drift rule is the backstop, not the plan.
- [Model calls timeline for "recently" with no bound] → schema rejects with a bounded invalid-argument observation; prompt guidance names the materialize-or-ask rule.
- [Provider handling of the `format: date-time` keyword varies] → the keyword is advisory to the provider; the instant grammar is enforced by ajv (`format` via ajv-formats) and by the in-tool Zod parse, and a malformed instant is a bounded invalid-argument observation.

## Migration Plan

No data migration. Per the tool-calling declaration-cutover requirement: stop accepting new Runs, drain Runs bound to the prior `search_conversations` declaration, deploy API and worker with the matching declaration and executor, resume. Rollback is the same sequence with the prior binaries. Persisted `tool-search_conversations` parts authored under `{ query, limit }` replay as recorded: the context builder forwards `part.input` without re-validating historical tool inputs, and result neutralization touches results only.

## Open Questions

None that change the specs, approach, or tasks.

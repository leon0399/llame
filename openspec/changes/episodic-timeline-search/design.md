## Context

See proposal.md for motivation. Current state that shapes the approach:

- `search_conversations` (`apps/api/src/tools/search-conversations.ts`) accepts `{ query, limit }`, embeds the query before `tenantDb.runAs`, calls `ChatsRepository.searchByOwner`, then reauthorizes and hydrates each winning document and runs the canonical-line matcher (#609). A vector-only winner is anchored to its document's first message (#197 D5).
- `searchByOwner` builds one SQL statement through `search/core/fusion.ts`. Every candidate leg is filtered by an injected `scope.document` predicate and the title leg and final ranking by `scope.parent`; today both are the owner predicate. Fusion is RRF (`k = 60`), grouped per chat, ordered `score DESC, updated_at DESC, id`, then `LIMIT`. The statement runs under `statement_timeout = 3000`.
- Projection documents carry `first_message_at` and `last_message_at`. Canonical `messages` carry `created_at`, an immutable chat-local `seq`, and the evidence-eligibility predicate that `messages-repository.ts` already mirrors in SQL (user rows; assistant rows whose `usage.status` is absent or `completed`).
- `conversation_read` reads one message by `{ chatId, messageSeq, offset, limit }` and returns `previousMessageSeq` / `nextMessageSeq` for eligible neighbors. The conversation-reads spec forbids concatenating messages into one source string and forbids new opaque locators.
- The packaged default prompt (`apps/api/src/prompts/chat-default.md`) already renders `context.systemTime` and `context.systemTimezone` and carries one recall paragraph.
- Tool input schemas travel Zod → AI SDK `asSchema().jsonSchema` → ajv → provider. The OpenAI client always sends `strict: false`.

Decisions D1–D13 were settled with Leo on 2026-09-05 before this proposal was written.

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

Each timeline region carries the first and last eligible `messageSeq` inside the range. The model reads a message and follows `nextMessageSeq`. Zero reader changes, and the conversation-reads spec's per-message attribution and line space stay intact. Alternatives: extend `conversation_read` to a `messageSeq..toSeq` range returning per-message blocks (a conversation-reads spec change, deferred until the step cost is shown to matter); a new `read_conversation_range` tool (a second tool for the same read authority). Known cost: a long day is many reads under `tools.maxStepsPerRun`; the prompt tells the model a listing may stop at metadata.

### D3. Shipped names and plain coordinates

`conversation_read` keeps its name and input. Timeline regions and content rows carry `chatId` + `messageSeq` (+ `offset`/`limit` for content), never a minted `sourceRef`. The issue's `read_conversation_range` and `sourceRef` predate #609 and are superseded by its spec, which forbids new opaque locators.

### D4. `required` filters at two points

1. **Candidate legs:** the range predicate on the document is `first_message_at < before AND last_message_at >= after` (each half omitted when its bound is absent), composed into `scope.document`. The parent predicate gains `EXISTS (eligible message in chat with created_at in range)`, composed into `scope.parent`, so a title-only winner is returned as `kind: "metadata"` only when the chat actually had eligible activity in the range. No fusion change; the legs already accept an arbitrary scope predicate.
2. **After hydration:** a chunk that overlaps the range may resolve to a passage in a message outside it. The resolved message's `created_at` is checked against the range; a miss omits the row exactly like a failed hydration. This also drops a vector-only winner whose first-message anchor falls outside the range even when a later message in the same chunk was inside it. That is a known limitation inherited from #197 D5 and is preferable to returning a dated row that contradicts the filter.

Alternative considered: filter only in SQL. Rejected: a chunk-level overlap is not a message-level guarantee, and the row carries the message timestamp the model will reason from.

### D5. `preferred` is one additive RRF-style term

In `doc_fused`, a document inside the preferred range gains `1 / (k + 1)` (`k = 60`), the contribution it would earn by ranking first in one extra leg. The term is bounded by construction, so a clear winner outside the range keeps its place while a near-tie inside the range moves up. Alternatives: a lexicographic "in-range first" sort key (makes a weak in-range hit beat an exact out-of-range one; violates the issue's retrievability clause); no `preferred` at all (leaves the model choosing between a hard filter and no filter). The constant is a hypothesis; the eval layer records its effect on the new fixtures but does not tune it in this change.

### D6. Envelope carries `appliedRange` and `truncated`; rows carry nothing new

`appliedRange` echoes exactly the bounds passed (a missing bound is absent, not filled with "now"), plus the constraint in content mode. `truncated` is set when the repository returned `limit + 1` rows. Per-leg ranks, fused scores, `matchedBy`, and leg names go to the existing `search_conversations` log line, never to the model. Rationale: a field the model sees is a field it rationalizes about; #197 D5 already excluded `matchedBy` and the spec forbids score exposure.

### D7. Limits

Content: `limit` 1–10, default 5 (unchanged). Timeline: 1–50, default 20. Both fetch `limit + 1` to compute `truncated`.

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

`superRefine` enforces: `content` requires a non-blank `query` and requires `constraint` when any bound is present; `timeline` forbids `query` and `constraint` and requires at least one bound; `after < before` when both present; `limit <= 10` in content mode. The `mode` description carries the two-shape contract and the tool description carries two few-shot calls. Alternative: nested `{ content?: {...}, timeline?: {...} }` with exactly-one. Rejected: exactly-one over optional objects is a shape models get wrong more often than an enum, and it cannot be expressed at the root either.

### D12. Stack

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

## Risks / Trade-offs

- [The timeline query is a new owner-scoped scan over `messages` grouped by chat] → owner predicate plus RLS inside the statement, `messages_chat_created_idx`, `limit + 1`, and the same `SET LOCAL statement_timeout = 3000`; a timeout is a structured `search_failed` observation like today.
- [Post-hydration range check can drop a vector-only winner whose match was in-range but whose anchor was not] → recorded as a known limitation; the fix is #197 D5's anchor rule, not this change.
- [The `preferred` constant is untuned] → recorded as a hypothesis with its fixture effect; tuning is eval-epic work.
- [Declaration change fails in-flight Runs bound to the old snapshot] → pre-launch, deploy quiesced; the tool-calling spec's fail-closed drift rule is the intended behavior.
- [Model calls timeline for "recently" with no bound] → schema rejects with a bounded invalid-argument observation; prompt guidance names the materialize-or-ask rule.
- [Provider handling of the `format: date-time` keyword varies] → the keyword is advisory to the provider; the instant grammar is enforced by Zod at execution and by ajv at admission, and a malformed instant is a bounded invalid-argument observation.

## Migration Plan

No data migration. Deploy API and worker together with no Runs in flight (pre-launch). Rollback is a redeploy of the prior binaries; no persisted shape depends on the new input because tool inputs are recorded as authored and replayed without re-validation.

## Open Questions

None that change the specs, approach, or tasks.

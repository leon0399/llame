## Context

See [proposal.md](proposal.md) for motivation. The current model-facing `search_conversations` result is the web search shape: one chat-level result with a `ts_headline` snippet rendered from `search_chat_documents.content`. That projection content deliberately contains role labels and may contain a synthetic preceding-user anchor; its hash also covers normalized text, chunker version, and message range. None is canonical quotation material.

Canonical message content remains `messages.parts`. Parts have stored array order but no stable part IDs, and ordinary assistant messages may contain several visible text parts interleaved with reasoning and tool parts. A real local conversation contains a 31,011-character assistant text part with 981 logical lines and 69 headings, so loading every selected message wholesale cannot stay beneath the 16,000-code-unit common tool-result cap.

Messages already have stable UUID identity and monotonic `seq` order. User messages and completed/legacy assistant messages are application-immutable. The current failed/cancelled/expired retry path is the exception: it may replace an assistant row's parts under the same ID. Issue #611 owns the unified retry/edit/branching redesign; this change must not present those retryable rows as immutable evidence in the meantime.

This design deliberately corrects two older issue-body premises. First, it keeps `#609` scoped to provenance hydration and bounded reads rather than absorbing `#198`'s final discovery union and timeline input shape. Second, it rejects model-facing part IDs and source hashes: direct links and search follow-ups need stable message identity plus canonical bounded reads, not another token-heavy locator layer that still depends on mutable-history semantics.

## Goals / Non-Goals

**Goals:**

- Derive exact, message-attributed conversation evidence from current canonical parts.
- Make direct message links and search hits readable without exposing part indexes.
- Keep giant Markdown-shaped messages navigable under existing tool budgets.
- Preserve one ranking path for web and model surfaces while giving them different output projections.
- Provide one source-reference and bounded-read contract that current content search and #198's later content/timeline discovery shapes can share.
- Add only the minimum derived locator state needed to avoid re-chunking whole winning chats.
- Preserve current RLS, immutable Run declaration, settlement, replay, and coordinated deployment boundaries.

**Non-Goals:**

- Retry, regeneration, user-message edit, fork, or message-DAG semantics (#611).
- Timeline discovery, temporal ranking, or the final strict search union (#198).
- Vector candidate generation or RRF tuning (#197); this design only defines how any winning document resolves.
- Full Markdown parsing, persisted message outlines, generated summaries, semantic span selection, translation, reranking, or answer-support scoring.
- Raw reasoning replay, unrestricted historical tool-result replay, or a claim that tool execution caused a later answer.

## Decisions

### D1. Recompute one versioned visible-message view; persist no duplicate message text

`visibleMessageTextV1(parts)` filters exact `type: "text"` parts, keeps stored order, and joins their stored strings with exactly `\n\n`. It performs no trim or normalization. One message produces one independent line-number space; messages are never concatenated into a transcript string.

This function is shared by the chat-search chunker and canonical reader. The read path recomputes it for only the bounded messages it returns. `search_chat_documents` keeps its existing chunk `content` and normalized lexical content but gains no whole-message visible-text column.

The public source reference carries `version: 1`. The projection's existing `chunker_version` invalidates rows when visible-text semantics change. A future source-reference version may keep the tiny V1 serializer for historical locators; if it does not, it must reject V1 explicitly rather than reinterpret lines. A dedicated `visible_text_version` database column was rejected: every stored locator is already authored by a particular chunker version, and no independent concurrent view versions exist.

Storing visible text beside `messages.parts` was rejected because it creates a second canonical-looking copy, write-order drift, migration work, and deletion/retention duplication for text that is cheap to derive.

### D2. Use immutable message identity instead of a model-facing hash or part identity

Source references use chat/message identity plus visible-text lines. They contain no `partId`, `partIndex`, projection ID, or source hash. A direct user link needs only `chatId` and `messageId`; the server returns every eligible visible text part through the joined view.

Hash-free locators depend on immutable evidence eligibility. The shared eligibility predicate includes user messages and assistant messages for which the existing completion classifier says content is immutable. Retryable assistant rows are excluded from projection authoring and conversation reads until #611 removes the in-place mutation path. Deletion becomes `conversation_source_not_found`; owner RLS and explicit owner predicates make foreign, absent, and deleted identities indistinguishable.

This is a conscious issue-body change, not an omission. Adding SHA-256 to every result was rejected because it duplicates UUID token cost while detecting no permitted mutation. Adding a message revision column was rejected because #611, not this read capability, owns revision semantics. The existing projection `content_hash` remains internal and load-bearing for no-op rebuilds and embedding invalidation.

### D3. Use structured versioned source references with complete discriminated boundaries

The V1 reference is an ordinary object, not a signed/opaque capability:

```ts
type ConversationSourceRefV1 = {
  version: 1;
  chatId: string;
  range:
    | { kind: "messages"; startMessageId: string; endMessageId: string }
    | {
        kind: "lines";
        start: { messageId: string; line: number };
        end: { messageId: string; lineExclusive: number };
      }
    | {
        kind: "text";
        start: { messageId: string; offset: number };
        end: { messageId: string; offsetExclusive: number };
      };
};
```

`messages` addresses complete boundary messages; `lines` is the normal model-facing navigation form; `text` exists only for server-issued chunk boundaries that fall inside a logical line. Every form contains complete start/end fields, and direct selectors similarly require both `startLine` and `lineCount` or neither. Multi-message line/text ranges apply the start coordinate to the first message, the exclusive end coordinate to the last, and include complete intermediate messages. Every read re-resolves message `seq` ordering and authority; client ordering is never trusted.

Signing/encryption was rejected because authorization is always current and server-side. A stateful hit table was rejected because it creates cleanup, retention, replay, and accidental-capability semantics. Flat `firstMessageId`/`lastMessageId` fields were rejected for the public object because nested start/end points make half-open boundary meaning explicit without adding part coordinates.

### D4. Add only two boundary offsets to each derived search document

The chunker already records first/last message IDs and timestamps. Each chunk additionally records:

```text
first_message_text_offset
last_message_text_offset_exclusive
```

Both are UTF-16 code-unit offsets into the corresponding V1 visible-message string, matching TypeScript string slicing. The chunk's canonical source is the first message from its start offset, every complete eligible message between the boundaries, and the last message through its exclusive end offset. A single-message chunk uses both offsets in that one view.

Chunk groups are contiguous in eligible source order even when they overlap the previous group. Synthetic role labels and continuation anchors exist only in presentation `content` and have no source interval. The internal content hash adds visible-text version and both boundary offsets to its input, so a coordinate change cannot survive a hash no-op.

A JSON source-map array was rejected because the public contract no longer addresses parts and a contiguous interval needs only endpoints. Persisted line numbers were rejected because line boundaries derive cheaply from the bounded canonical text and character-boundary splitting may start or end within a line. Re-chunking the entire winning chat at query time was retained only as a possible migration fallback; the referenced 813 KB chat makes it the wrong steady-state hot path.

### D5. Keep ranking shared; split preview shaping from canonical hydration

The shared candidate query returns the existing chat data plus internal best-document identity and retrieval-basis ranks. The web service maps it to the unchanged `id/title/snippet/updatedAt` DTO. The model tool passes content winners through a canonical resolver:

1. Load the winning current-version projection locator under owner scope.
2. Load only its first-through-last messages under the same owner.
3. Recompute V1 visible text and slice the exact document source interval.
4. For each lexical/trigram basis, apply `normalizeForSearch` (NFKC, whitespace collapse, lowercasing) to each bounded canonical logical line, rerun the equivalent PostgreSQL predicate against that normalized value, and retain the original raw source line for output.
5. Expand each matched line by one adjacent source line on either side, group by message, and transitively merge touching windows only within that message.
6. If no individual line independently matches—such as a cross-line FTS match—return the exact chunk-aligned interval as `retrieval_context` rather than manufacture a quote.

Matches in different messages become separate ordered passages with independent attribution and source references. The resolver never concatenates them into one quote.

A future vector-only winner follows steps 1–3 and returns bounded original-language `retrieval_context`; a vector has no line-selection semantics. A title-only winner is metadata-only. A document that cannot hydrate is skipped and never falls back to projection bytes.

When a chunk begins or ends inside a logical line, its vector/cross-line retrieval context carries the exact server-issued `text` range. The public passage MAY also report containing line metadata for navigation, but the text offsets—not line expansion—round-trip the exact chunk bytes and remain bounded even when the containing line is larger than the read-result cap.

The strict discriminated union for content versus timeline discovery remains `#198` work. This design only constrains what happens after some search surface chooses a winning content document or emits a message-bounded timeline pointer.

Duplicating the ranking query for the model was rejected because web and model relevance would drift. Returning the web snippet to the model was rejected because labels, anchors, normalization, and `ts_headline` fragment selection are not source provenance.

### D6. Make reads line-addressable, source-first, and preflighted

`read_conversation_range` accepts a strict union of a server-issued `sourceRef` or a direct `chatId`/`messageId` selector with optional line range. Either form may request up to five eligible surrounding messages in each direction. The repository resolves source boundaries by `seq` in one owner-scoped database snapshot.

Direct selectors accept only a complete line pair (`startLine` plus `lineCount`) or a whole message. Server-issued refs may carry message, line, or text-offset ranges. Line slices are preferred for navigation and surrounding context; a text-offset source returns its exact bounded substring before any whole-line context, so a mid-line chunk remains readable without exposing text offsets as a user-authored selector.

The reader selects the requested source before optional context. It trims the farthest requested context first if the 20-message, 2,000-line, or 15,000-code-unit result bound would otherwise displace source evidence. It returns messages chronologically, reports `complete: false` for omitted requested source/context, and supplies direct next/previous selectors. Direct selectors intentionally allow a model to continue within the owner's history; continuation is not authorization.

Line parsing reuses the Knowledge contract: LF terminates a line, CRLF is one delimiter, lone CR is content, and a terminal delimiter creates no phantom line. Returned `text` retains original delimiters and receives no `N:` line prefix. That preserves Markdown, keeps quotation bytes exact relative to V1, and avoids one numeric prefix per line. A single line that cannot fit returns `conversation_limit_exceeded`; character-range continuation is deferred until a real case requires it.

Letting generic tool truncation shrink a source string was rejected because it can turn a partial quote or activity list into an apparently complete observation. The reader measures the exact JSON projection before returning success.

### D7. Derive a small on-demand outline only for oversized direct-message reads

When a direct whole-message read cannot fit, an on-demand V1 outline scanner returns bounded ATX headings (`#` through `######`) outside backtick/tilde fenced code. Entries carry depth, zero-based source line, and exact heading text. The result also returns the initial exact slice and continuation. No headings yields an empty outline; malformed Markdown cannot block plain line reads.

The scanner is deliberately not a general Markdown AST. Setext headings, semantic sections, generated summaries, and stored tables of contents are excluded. #541/#544 may later provide a shared full Markdown parser, but this change must not depend on an indexed Knowledge roadmap. Returning outlines on every search hit was rejected because the referenced real message has 69 headings and most reads do not need them.

### D8. Project safe tool activity separately from conversation evidence

`includeActivity` walks the returned assistant message's stored parts and emits an ordered sequence of visible text line regions and settled tool entries. Text regions reference the V1 line space; each tool entry's `toolId` is the canonical callable ID from the immutable Run declaration (`search_conversations`, `knowledge_read`, or `mcp__server__tool`), never the per-invocation call ID. Entries otherwise contain only the closed outcome and narrow code-owned source attribution extractors for conversation references and Knowledge identity/path/range fields.

Reasoning parts produce no text or pseudo-explanation. Raw tool arguments, unrestricted result bodies, provider metadata, prompts, secrets, call IDs, and arbitrary MCP attribution are excluded. The response labels activity as historical execution metadata, not evidence or causation. Activity plus text must fully preflight; if it cannot fit, the caller receives `conversation_limit_exceeded` and can retry with a narrower source or without activity.

Raw historical replay was rejected because stored results may be stale, payload-cleared, sensitive, or much larger than the read. Tool-name-only unordered counts were rejected because they cannot answer whether a search occurred before or after an assistant text region.

### D9. Reuse durable tool persistence while preserving authored observations

The new tool uses the existing code-owned declaration registry, exact allowlist, immutable Run snapshot, execution rebinding, cancellation, settlement, neutralization, and generic structured UI. Full results persist in Run events and assistant tool-result parts exactly as authored. Replay never rereads messages or reparses outlines.

A successful page with `complete: false` retains `incomplete` when any replay projection clears its payload, matching Knowledge's honesty rule. Complete pages remain success. A specialized UI may render chat/message links, line ranges, outlines, and activity, but generic structured rendering remains the compatibility floor.

Historical read text follows the destination Chat, not the later source. If the source message is deleted or access is lost, new calls return `conversation_source_not_found`, while an already persisted owner-visible observation remains verbatim like any other historical tool result. There is no cross-Chat redaction link. Deleting the destination Chat cascades through its messages and `runs.chat_id` to Runs and append-only Run events; `runs.message_id ON DELETE SET NULL` only preserves a Run when an individual triggering message is removed while its Chat remains.

### D10. Stage the projection and declaration cutovers with explicit version gates

The derived projection migration adds nullable offset columns first so existing binaries remain compatible. New chunker writers populate them under one named bumped `SOURCE_LOCATOR_CHUNKER_VERSION`. The per-chat invariant remains: one Chat's live rows carry one chunker version, while different Chats may temporarily be on legacy or bumped versions during backfill.

Routing is phase-specific:

1. **Preparation/backfill:** existing web and legacy model shaping may rank either live version because both retain presentation `content`; canonical hydration remains disabled. The writer atomically replaces one Chat's legacy rows with bumped rows, never mixes both in that Chat.
2. **Canonical cutover/steady state:** coverage must show every eligible Chat on `SOURCE_LOCATOR_CHUNKER_VERSION`. Model-facing canonical candidate CTEs require that exact version and non-null start/end offsets; rows failing either predicate cannot hydrate. Web preview may use those same current rows without reading offsets.
3. **Rollback:** disable the canonical model declaration/shaping first while compatible binaries still run. Legacy derived-preview shaping may read either presentation-compatible live version during rollback, but canonical hydration stays gated off. Older writers then reindex each Chat back to their declared legacy version; only after that convergence may the nullable locator columns be ignored. Current-version rows are never interpreted with legacy locator semantics.

This intentionally does not require current-version rows to disappear from legacy preview shaping before rollback completes: their presentation columns are compatible and excluding them would create search gaps. The hard gate is that legacy/offsetless rows never enter canonical hydration and locator offsets are interpreted only under the named current version.

The new/changed code-owned tool declarations remain a coordinated API/worker boundary. Quiesce new Run acceptance, drain Runs bound to the prior declarations, deploy matching API and worker binaries after projection coverage, then resume. Configuration must explicitly allowlist `read_conversation_range`; adding the binary does not silently enable it.

## Risks / Trade-offs

- [Retryable assistant messages disappear from episodic evidence until #611] → Keep them visible in ordinary owner chat history; exclude only the citation/search projection whose identity premise they violate.
- [Canonical line hydration adds post-ranking work] → Persist two compact source endpoints and hydrate only bounded winning documents; record search p50/p95 before and after.
- [A query matches only across line boundaries] → Return honest exact retrieval context instead of inventing a matching line.
- [A chunk boundary falls inside one huge logical line] → Carry a server-issued complete UTF-16 text-offset range; keep direct/model-authored navigation line-based.
- [V1 `\n\n` separators are application-authored structure] → Define V1 as the canonical visible transcript rendering and never claim it is a contiguous raw-part substring.
- [The lightweight outline scanner differs from full CommonMark] → Specify the intentionally recognized ATX/fence subset and keep outlines navigation-only.
- [Tool activity is mistaken for causal explanation] → Label it historical execution metadata and omit any support/causation field.
- [Mixed projection versions leave some candidates temporarily unhydratable] → Backfill before cutover and skip rather than substitute old projection content.
- [Historical source references outlive V1 support] → Keep the small V1 serializer or reject the version explicitly; never reinterpret coordinates.

## Migration Plan

1. Generate a migration adding nullable first-start/last-end visible-text offset columns to `search_chat_documents`; retain existing columns and internal hashes.
2. Land V1 visible-text rendering, immutable-evidence filtering, locator-aware chunking, and the chunker-version bump in API/worker-compatible code while the old model result shape remains active.
3. Reindex/backfill all chats, verify current-version locator coverage, RLS, embedding invalidation, and representative oversized-message locators.
4. Land the canonical resolver and bounded reader behind exact operator allowlisting; verify lexical, vector-fixture, title-only, cross-owner, deletion, continuation, outline, activity, persistence, replay, and browser paths.
5. Before changing accepted Run declarations/results, quiesce new Run admission and drain every Run bound to the previous tool set. Deploy matching API and worker binaries, enable the new model-facing search/read declarations, then resume.
6. Update ROADMAP/CHANGELOG and operator/tool documentation in the same shipping change.
7. Rollback quiesces and drains Runs bound to the new declarations, restores older API/worker binaries and model-facing search shaping, and leaves nullable derived columns in place. No canonical message migration or historical observation rewrite is required.

## Revision History

- **v4 (2026-08-26):** Added exact mid-line source ranges, preserved the current search input, clarified normalization/ranking/deletion/activity/bounds contracts, and defined migration/rollback version gates from PR review.
- **v3 (2026-08-26):** Clarified surrounding-context slice shaping and removed timeline-implementation ambiguity from the stacked acceptance layer after convergence review.
- **v2 (2026-08-26):** Narrowed the change against #198, recorded the deliberate rejection of older hash/part-ID premises, preserved canonical delta scenarios, and made cross-message search matches separate attributed passages.
- **v1 (2026-08-26):** Initial proposal design.

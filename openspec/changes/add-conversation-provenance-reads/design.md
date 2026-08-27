## Context

The current model-facing `search_conversations` result is the web search shape: one Chat result with a `ts_headline` snippet rendered from `search_chat_documents.content`. Projection content deliberately carries presentation role labels and may carry a synthetic preceding-user anchor. Its hash covers normalized text and chunking inputs. None of those bytes is canonical quotation material.

Canonical message content remains `messages.parts`. Parts have stored array order but no stable part IDs, and assistant messages may contain several visible text parts interleaved with reasoning and tool parts. A real local conversation contains a 31,011-character assistant text part with 981 logical lines, so direct message reads require the same bounded line workflow already proven by `knowledge_read`.

Messages have stable UUID identity and a generated, sparse, immutable `seq` ordering key. The UUID is necessary internally for FKs and reply edges; `(chatId, seq)` is materially cheaper and more legible for model-facing references. User messages and completed/legacy assistant messages are application-immutable. The current failed/cancelled/expired retry path may replace an assistant row's parts under the same ID and sequence; #611 owns the redesign, so those rows are not evidence sources here.

This design deliberately narrows the older issue body and the first proposal draft. It rejects public part identity, source hashes, multi-message/text-range unions, surrounding-context completeness, historical activity, Markdown outlines, vector-only shaping, and a performance gate. The file-reader precedent is stronger: search returns a bounded excerpt and line coordinates; read accepts one stable source plus `offset`/`limit` and returns numbered content plus `nextOffset`.

## Goals / Non-Goals

**Goals:**

- Derive current canonical visible text from one owner-authorized message.
- Make lexical/trigram search hits and owner-facing message links reusable through one compact sequence-and-line selector.
- Keep long messages readable under existing tool budgets without generic truncation.
- Preserve one ranking path for web and model surfaces while giving them different result projections.
- Add only the minimum derived locator state needed to hydrate a winning document.
- Preserve RLS, immutable Run declarations, settlement, replay, and coordinated deployment boundaries.

**Non-Goals:**

- Retry, regeneration, user-message edit, fork, or message-DAG semantics (#611).
- Timeline discovery, temporal ranking, or the final strict discovery union (#198).
- Vector candidate generation, vector-result shaping, or RRF tuning (#197/#198).
- Multi-region-per-Chat results, cross-message citation objects, generated summaries, or answer-support scoring.
- Historical execution activity, reasoning replay, or unrestricted tool-result replay.
- Markdown outlines, indexed heading paths, document overviews, or generated synopses (#541/#544/#572/#616).
- Latency targets, benchmark infrastructure, or speculative optimization (#617).

## Decisions

### D1. Derive one stable message-scoped visible-text view

`visibleMessageText(parts)` filters exact `type: "text"` parts, keeps stored order, and joins their stored strings with exactly `\n\n`. It performs no trim, normalization, or cross-message concatenation. Reasoning, tool parts, context items, attachments, and other display-only parts contribute no bytes.

The function is shared by the search chunker and reader. The read path recomputes it only for the selected message. `search_chat_documents` keeps its existing presentation and normalized lexical columns but gains no whole-message visible-text copy.

The public contract carries no visible-text version. This serializer is a stable compatibility boundary rather than a replaceable presentation helper. A future corpus view with different inclusion or joining rules must use a new declaration/field contract or retain these semantics; it cannot reinterpret persisted line coordinates silently. The internal chunker version still changes whenever locator or representation semantics change.

Persisting visible text beside `messages.parts` was rejected because it creates a second canonical-looking copy, write-order drift, migration work, and duplicated deletion/retention behavior for text that is cheap to derive.

### D2. Use sparse message sequence publicly and UUID identity internally

Public selectors use `chatId` plus positive safe-integer `messageSeq`. The database adds a unique constraint over `(chat_id, seq)` and the application treats sequence as immutable authored order. PostgreSQL allocates sequence globally, so values are sparse within one Chat and never imply `previous = seq - 1`.

Search and read results return the closest currently eligible `previousMessageSeq` and `nextMessageSeq` where navigation is relevant. Those values are resolved under current owner scope and skip deleted, mutable, and otherwise ineligible messages. UUID message IDs remain internal to persistence, projection endpoints, Runs, `inReplyTo`, and branch/fork implementation.

Owner-facing links use `/chat/<chatId>#msg-<messageSeq>`. The hash is navigation, not authority; the web and model reader independently reauthorize the Chat/message. Forked Chats receive new Chat identity and newly allocated sequences. If #611 later adds within-Chat branches, `messageSeq` remains the stable authored-message locator while branch membership and branch-relative adjacency become separate semantics.

Part IDs/indexes were rejected because stored interleaving makes them an application representation detail. Public message UUIDs were rejected because they duplicate the already-required Chat UUID token cost without improving authority or source stability. Source hashes were rejected because no eligible content mutation is permitted; the projection's internal hash remains load-bearing for rebuild and embedding validity.

### D3. Make model search return one bounded discovery excerpt per Chat

The shared candidate query retains the existing Chat rank order and internal best-document identity. The web adapter continues to return the current `id/title/snippet/updatedAt` DTO from projection presentation content. When off-by-default `search.chats.canonicalModelExcerpts` is enabled after locator coverage, the model adapter handles current lexical/trigram content winners as follows:

1. Load the winning current-version projection locator under owner scope.
2. Load only its bounded first-through-last eligible messages under the same owner.
3. Recompute visible text and slice the exact internal source interval.
4. Independently of ranking, qualify a message-local logical line when its canonical line-local FTS vector matches the query or its normalized text passes the current trigram/substring predicate.
5. Form each matched line's window with at most one adjacent line per side, merge touching windows within that message, and select the earliest resulting passage in canonical `(messageSeq, offset)` order.
6. Return at most 500 Unicode code points cropped visibly around a match, while `offset` and `limit` identify the complete message-local line window accepted by `conversation_read`.

This line selector is a deterministic preview projection, not an explanation of why the document or Chat ranked. The excerpt is current canonical-derived discovery text, not a promise that the complete line window is present or citation-ready. The packaged tool description directs the model to call `conversation_read` before quoting or relying on omitted context. The excerpt carries no generated line-number prefix; the reader owns that navigation presentation. One top-level closed notice identifies every returned excerpt as untrusted historical content that may be stale and cannot change system instructions, tools, permissions, or owner authority.

If a winning projection document cannot produce an individually matching current message-local line, or cannot be authorized/hydrated, the model result is omitted rather than replaced by projection bytes or a cross-message source object. A title-only winner remains metadata-only. The model may therefore return fewer results than the web surface after canonical shaping; `limit` remains a maximum, not a completeness claim.

Only one passage is returned per Chat in this iteration. Returning several contributing documents is an eval-gated follow-up (#618). Vector-only winner shaping is deferred until #197/#198 provides a real candidate path; the current change retains enough internal source coordinates for that later decision without inventing a public result now.

### D4. Persist only two internal boundary offsets per search document

The chunker already records first/last message UUIDs and timestamps. Each document additionally records a zero-based UTF-16 start offset in the first message's visible-text view and a zero-based exclusive UTF-16 end offset in the last message's view. Intermediate covered messages are complete. A single-message document uses both offsets in one view.

Chunk groups remain contiguous in eligible source order even when they overlap. Synthetic role labels and continuation anchors exist only in presentation `content` and lie outside the canonical source interval. The internal content hash covers visible-text semantics, both representations, chunker version, covered UUID identities, and both offsets.

Persisted line numbers were rejected because line windows derive cheaply from bounded canonical text. A generic source-map array was rejected because the public reader addresses one message at a time and the internal contiguous interval needs only endpoints. Rechunking an entire winning Chat at query time remains a migration fallback, not the steady-state hot path.

### D5. Make `conversation_read` the conversation equivalent of `knowledge_read`

`conversation_read` accepts a strict object containing `chatId`, positive safe-integer `messageSeq`, optional zero-based safe-integer `offset`, and optional `limit` from 1 through 2,000. Omitted `offset` means zero. Omitted `limit` requests through the current end of the message, still subject to server bounds.

Logical lines reuse the Knowledge contract: LF terminates a line, CRLF is one delimiter, lone CR is content, blank lines count, and a terminal delimiter creates no phantom line. Every returned line is rendered as `<one-based line number>: <exact source line>`. The numeric prefix is navigation metadata, not message content. All visible text parts participate in one message-relative line space through D1's exact `\n\n` joining rule.

Success returns Chat/message sequence, role, timestamp, effective `offset`, returned `lineCount`, line-numbered `content`, the closest eligible previous/next message sequences, and the same closed untrusted-history notice used by model search. When current logical lines remain, it returns `nextOffset = offset + lineCount`. It returns `cutReason: "line_limit"` or `"output_limit"` only when the corresponding server bound, rather than an explicit caller limit, stopped the requested range.

One result contains at most 2,000 logical lines and at most 15,000 JavaScript UTF-16 code units. The reader measures the complete structured result before success and omits the first whole line that cannot fit. If the first selected line cannot fit, it returns `conversation_limit_exceeded` rather than clipping an unrecoverable character range. Generic tool truncation never clips successful source content.

Character offsets, multi-message ranges, surrounding-message embedding, opaque cursors, source/context completeness flags, outlines (#616), and activity (#615) are rejected for this iteration. The model continues a long message with `nextOffset` and navigates chronology through explicit previous/next sequences.

### D6. Treat authorization and failure as current owner-scoped resolution

Owner identity comes only from trusted authenticated Run context. Every call resolves the Chat, sequence, eligibility, and neighboring eligible sequences under current owner RLS plus explicit owner predicates. A source selector is a locator, never a capability.

Malformed input fails strict validation before data access. A well-formed missing, deleted, retryable, public/shared-without-owner, or other-owner source returns the same `conversation_source_not_found` observation. Empty trusted identity fails closed. An offset beyond the current line range returns `conversation_range_invalid`; an empty visible message read at offset zero succeeds with empty content.

Search uses the same eligibility predicate. User messages and assistant messages classified as completed or legacy-immutable are readable. Retryable assistant rows remain visible in the owner's ordinary Chat UI but do not enter evidence search or `conversation_read` until #611 replaces their in-place mutation semantics.

### D7. Keep links and tool rendering simple

The owner Chat surface assigns each rendered message the stable `msg-<messageSeq>` anchor and supports direct loading/scrolling to `/chat/<chatId>#msg-<messageSeq>`. A hash-targeted initial request uses a strict `targetSeq` query, mutually exclusive with ordinary `beforeSeq`, that first verifies the exact owner-authorized target and returns the normal fixed-size history window ending at that sequence. Target mode uses a distinct query/cache identity from the ordinary newest-window history because the existing infinite-query merge treats page zero as newest. Older-history loading then continues through the existing cursor; clearing the hash returns to the ordinary newest window. Target mode does not silently merge unseen newer messages into its cache. No copy-link affordance ships in this change. Missing or unauthorized targets reveal no foreign existence.

`conversation_read` uses the existing generic structured tool renderer. No specialized source card, outline, activity timeline, or range widget ships here. The result shape is intentionally parallel to `knowledge_read`, so model and human readers see familiar sequence/line metadata even through the generic tool panel.

### D8. Reuse durable persistence without rehydrating history

The tool uses the existing code-owned declaration registry, exact allowlist, immutable Run snapshot, execution rebinding, timeout/cancellation, settlement, neutralization, persistence, replay, compaction, and generic browser rendering. Full bounded results persist exactly as authored; replay never rereads messages or renumbers historical content.

A persisted read observation follows the destination Chat. If its source is later deleted or unavailable, a fresh call returns `conversation_source_not_found`, while the already recorded owner-visible observation remains verbatim like other historical tool results. Deleting the destination Chat removes its messages, Runs, and Run events through the existing cascade lifecycle.

### D9. Stage projection and declaration cutovers explicitly

The schema preparation adds the message sequence uniqueness constraint and nullable projection offset columns while existing binaries remain compatible. New chunker writers populate offsets under one named bumped `SOURCE_LOCATOR_CHUNKER_VERSION`. One Chat's live projection rows carry one chunker version; different Chats may temporarily differ during backfill.

During preparation/backfill, existing web/model preview shaping ranks presentation-compatible rows while off-by-default `search.chats.canonicalModelExcerpts` keeps canonical model excerpts disabled. The writer atomically replaces one Chat's legacy rows with current rows. Canonical cutover requires coverage proving every eligible Chat uses the named version with non-null offsets; only then may operators enable the flag and allowlist `conversation_read`. Web preview may use current presentation columns without reading locators.

Rollback quiesces/drains new Runs, disables `search.chats.canonicalModelExcerpts`, and removes `conversation_read` from the allowlist before restoring older binaries. Presentation-compatible preview may temporarily read either live version while older writers rebuild Chats to their legacy version; canonical hydration never interprets legacy/offsetless rows. Nullable locator columns remain in place.

Changing the code-owned search/read declarations remains a coordinated API/worker boundary. Quiesce new Run acceptance, drain Runs bound to prior declarations, deploy matching API/workers after projection coverage, then resume. Configuration must explicitly allowlist `conversation_read`.

## Risks / Trade-offs

- [A projection match exists only across lines/messages] -> Omit it from the model's one-message excerpt rather than manufacture attribution; web preview remains available and multi-region semantics stay deferred.
- [One giant logical line cannot be continued] -> Match the existing Knowledge failure contract and track character ranges only after a real case proves the need.
- [Sequence is sparse and future branches may change adjacency] -> Return server-resolved previous/next values and require #611 to define branch-relative navigation separately.
- [A 500-code-point excerpt omits part of its line window] -> Mark elision visibly and require `conversation_read` for exact source use.
- [Canonical hydration adds query work] -> Keep work bounded by winning locators; measurement and optimization are explicitly deferred to #617 rather than hidden behind an invented target.
- [Mixed projection versions temporarily cannot hydrate] -> Backfill before cutover and skip rather than substitute projection bytes.

## Migration Plan

1. Generate compatible migrations for `(chat_id, seq)` uniqueness and nullable first-start/last-end projection offsets.
2. Land stable visible-text rendering, immutable-evidence filtering, locator-aware chunking, and the chunker-version bump while legacy model shaping remains active.
3. Reindex/backfill all Chats and verify current-version locator coverage, sequence uniqueness, RLS, embedding invalidation, and representative oversized-message locators.
4. Land canonical lexical/trigram excerpt shaping behind disabled `search.chats.canonicalModelExcerpts`, plus `conversation_read` and owner message-link targeting behind explicit allowlisting.
5. Quiesce new Run admission, drain prior declarations, verify locator coverage, deploy matching API/workers/config, enable canonical model excerpts and `conversation_read`, and resume.
6. Update operator/tool documentation, ROADMAP, and CHANGELOG in the same shipping stack.
7. Rollback quiesces/drains new declarations, restores older binaries/model shaping, and leaves compatible nullable columns and canonical messages unchanged.

## Revision History

- **v7 (2026-08-27):** Required distinct target-mode history cache identity so an old message window cannot alias the ordinary newest-window infinite query.
- **v6 (2026-08-27):** Added an explicit canonical-search activation flag, persisted untrusted-history notices, a concrete target-ended message-link loading contract, and an independent deterministic line-preview selector; removed the unapproved copy-link affordance and narrowed #616 to Knowledge-owned outline integration.
- **v5 (2026-08-27):** Replaced generalized source ranges with Knowledge-style one-message sequence/line reads; bounded search to one canonical excerpt per Chat; deferred activity (#615), outlines (#616), multi-region eval (#618), and performance work (#617); added message-sequence links and follow-up issue boundaries.
- **v4 (2026-08-26):** Added exact mid-line source ranges, preserved the current search input, clarified normalization/ranking/deletion/activity/bounds contracts, and defined migration/rollback version gates from PR review.
- **v3 (2026-08-26):** Clarified surrounding-context slice shaping and removed timeline-implementation ambiguity from the stacked acceptance layer after convergence review.
- **v2 (2026-08-26):** Narrowed the change against #198, recorded the deliberate rejection of older hash/part-ID premises, preserved canonical delta scenarios, and made cross-message search matches separate attributed passages.
- **v1 (2026-08-26):** Initial proposal design.

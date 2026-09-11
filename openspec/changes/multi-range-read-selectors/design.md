## Context

`path.ts` owns the shared selector grammar; `stream-read.ts` reads one open file
in bounded chunks. `source-lines.ts` and API serialization enforce the result
cap. #705 extends the deferred multi-range part of the native-file design.

## Goals / Non-Goals

One bounded observation can contain disjoint file passages. No new tool,
filesystem snapshot, overview implementation (#572), or directory multi-range
listing is included.

## Decisions

- D1: Reuse the existing range forms. Normalize by sorting, merging overlaps
  and adjacency, then expanding each merged interval by one context line on
  each side (clipped to file bounds), and re-merging expanded intervals that
  overlap or sit adjacent. Raw multi-range members stay `N-M` and verbatim.
  Keep a comma-request flag after normalization so a merged request still
  reports plural fields.
- D2: Use plural range fields only for comma requests. A bounding interval
  would falsely claim the gaps were shown; changing every single-read result
  would create unnecessary migration work. Cap input at 64 members to bound
  metadata and normalization work.
- D3: Stream once through one open descriptor and buffer at most one
  budget-sized candidate range. Commit complete ranges until one cannot fit;
  split only an oversized first range, and skip individually oversized lines
  and continue past them instead of ending the read. Apply final serialized
  envelope bounds before returning, including escaped content and all range
  metadata.
- D4: Keep `nextOffset` as a source coordinate over the expanded selection.
  Document trimming `requestedRanges` at `nextOffset + 1` and re-running
  sort, merge, and expansion on the trimmed request, rather than introducing
  a continuation token. Exact mode and its duplicated-range retry are gone;
  context lines may reappear across retries, as they already do in
  single-range continuations. Raw retries are unchanged.

## Risks / Trade-offs

A far-away range still requires scanning intervening bytes. Reuse cancellation
and existing bounded decoding; opening once does not provide a snapshot against
concurrent in-place writes. Whole-range truncation can leave output capacity
unused but makes subsequent requests predictable.

Keep Knowledge locator splitting and owner isolation intact, including
`invalid_path` for malformed locator suffixes before range validation. Coordinate with
the permission projection in #763: Knowledge selectors are excluded from resource
identity; direct host permissions match the submitted path text, including
selectors. This feature grants no new authority. The pending skills proposal
uses the same reader and must retain this grammar when integrated.

## Migration Plan

Ship parser, reader, descriptions, and consumers together. No database migration
or dependency is needed. Finalize by syncing the owning spec and archiving the
change. Rollback restores the old selector grammar; stored observations replay
as recorded.

## Revision history

- v3 (2026-09-11): Assigned issue closure to the implementation layer that enables the feature, per Leo's review; clarified the contribution rule.
- v2 (2026-09-11): Preserved Knowledge locator error precedence, corrected the exact continuation example, and covered the aggregate line ceiling after independent review.
- v1 (2026-09-11): Initial proposal for #705.
- v4 (2026-09-11): Per Leo's post-approval revision, expanded each merged range by one context line and re-merged touching expansions, replacing exact mode and the duplicated-range retry with trim-and-re-expand continuation.

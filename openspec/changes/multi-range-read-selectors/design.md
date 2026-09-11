## Context

`path.ts` owns the shared selector grammar; `stream-read.ts` reads one open file
in bounded chunks. `source-lines.ts` and API serialization enforce the result
cap. #705 extends the deferred multi-range part of the native-file design.

## Goals / Non-Goals

One bounded observation can contain disjoint file passages. No new tool,
filesystem snapshot, overview implementation (#572), or directory multi-range
listing is included.

## Decisions

- D1: Reuse the existing range forms and merge adjacent intervals. Preserve a
  comma-request flag after normalization so a merged request stays exact.
  Keep raw members as `N-M`, matching the existing raw grammar.
- D2: Use plural range fields only for comma requests. A bounding interval
  would falsely claim the gaps were shown; changing every single-read result
  would create unnecessary migration work. Cap input at 64 members to bound
  metadata and normalization work.
- D3: Stream once through one open descriptor and buffer at most one
  budget-sized candidate range. Commit complete ranges until one cannot fit;
  split only an oversized first range. Apply final serialized envelope bounds
  before returning, including escaped content and all range metadata.
- D4: Keep `nextOffset` as a source coordinate. Document trimming the plural
  request rather than introducing a continuation token. For an exact retry
  with only one range left, duplicate that range in comma syntax (for example,
  `:20-30,20-30`); normalization preserves exact mode. Raw retries are already exact.

## Risks / Trade-offs

A far-away range still requires scanning intervening bytes. Reuse cancellation
and existing bounded decoding; opening once does not provide a snapshot against
concurrent in-place writes. Whole-range truncation can leave output capacity
unused but makes subsequent requests predictable.

Keep Knowledge locator splitting and owner isolation intact. Coordinate with
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

- v1 (2026-09-11): Initial proposal for #705.

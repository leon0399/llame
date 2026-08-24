## Why

The shipped Knowledge tools expose only the first literal match per file and reject notes that cannot fit in one bounded whole-file result. An assistant needs passage-shaped search results and resumable ranged reads to navigate long live Markdown notes without pretending that a response-time file hash makes those notes revision-stable.

## What Changes

- Make `knowledge_read` accept optional zero-based `offset` and `limit` line coordinates, with `limit` bounded to 1-2,000, while retaining the existing explicit Knowledge Space ID and relative path authority boundary.
- Let an omitted range request through EOF, returning at most 2,000 model-visible numbered lines and the largest whole-line prefix that fits the output budget, plus `nextOffset` and a server-cut reason when more requested content was omitted.
- Change literal `knowledge_search` from one result per file to deterministic bounded passages, transitively merge overlapping or touching context windows, and return passage coordinates that can be passed directly to `knowledge_read`.
- Add opaque live-search continuation so matches beyond the result cap remain reachable without claiming a filesystem snapshot.
- **BREAKING**: replace model-facing Knowledge `contentHash`, matching-line duplication, and snippet fields with current passage/range attribution. This change adds no replacement revision token; #544 owns any internal source hash required by the later derived index.
- Preserve current-call authorization, configured-root containment, text-only Markdown admission, global traversal/output budgets, partial multi-space warnings, persistence, replay, and untrusted-content framing.
- Defer Markdown heading paths and indexing to #544, deterministic document overviews to #572, generated synopses to #574, and OKF/OpenWiki behavior to #573.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge-tools`: Replace whole-file-only reads and first-match-per-file search results with live line ranges, passage results, and continuation; remove model-facing content hashes.
- `knowledge-spaces`: Narrow safe retrieval attribution to logical space identity, response-time name, relative path, and current range/passage coordinates while retaining internal content identity for future projections.
- `tool-calling`: Preserve the revised Knowledge result shapes through execution, persistence, replay, compaction, and generic UI rendering without treating hashes as required model-visible attribution.

## Impact

- `apps/api/src/knowledge`: tool schemas, filesystem streaming/range extraction, literal passage collection, continuation validation, result shaping, and focused tests.
- Run/tool persistence and replay: newly executed results use the revised shape; historical stored results remain immutable and readable without rewriting old Chat history.
- Generic structured tool UI and product E2E fixtures must accept both historical and new persisted observations while presenting current space/path/range attribution.
- No database schema, Knowledge content table, search index, embedding provider, Markdown parser, Git requirement, or browser management surface is added.

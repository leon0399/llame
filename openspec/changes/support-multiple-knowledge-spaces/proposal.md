## Why

The shipped Knowledge capability gives each owner exactly one filesystem-backed space. That collapses distinct vaults into one identity and cannot preserve same-named resources for future personal-node portability. Issue #542 makes multiple stable Knowledge Spaces available through a small owner-scoped API and the existing live read tools, without inventing Chat bindings, Run snapshots, indexing, or file-management UX.

## What Changes

- Replace the one-space-per-owner row with an uncapped owner inventory of stable opaque IDs and non-unique display names.
- Replace bodyless `PUT /api/v1/me/knowledge-space` with breaking REST collection operations: create, cursor-paginated list, retrieve, and rename under `/api/v1/knowledge-spaces`; deletion remains out of scope.
- Create each trusted stable-ID child before committing its authority row. A failed database commit may leave an empty unauthoritative orphan; error recovery never deletes filesystem entries.
- Keep Knowledge tool availability separate from resource availability. When configuration and allowlisting permit the tools, they remain callable even when the owner has no spaces.
- Resolve the owner's current accessible spaces at every tool call. No Chat binding or Run-level Knowledge membership is persisted; later calls immediately observe additions and reject removed access.
- Let `knowledge_search` optionally target one current space or search all current spaces under one shared operation budget. Scoped failures produce an honest bounded incomplete result; global limits still fail the whole call.
- Require `knowledge_read` to name one current Knowledge Space ID explicitly.
- Persist exact response-time space ID, name, relative path, and hash attribution. A minimal compacted `incomplete` marker preserves degraded search honesty without adding a third generic tool-result status.
- Ship API, storage, and tools only. Do not add web management, user file population, lifecycle removal, indexing, embeddings, synchronization, shared ownership, or arbitrary filesystem paths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge-spaces`: Changes owner cardinality, labels, provisioning order, REST operations, pagination, migration, and runtime resolution.
- `knowledge-tools`: Changes tool eligibility, live multi-space authorization, inputs, search fan-out, incomplete results, and attribution.
- `tool-calling`: Preserves a bounded `incomplete` outcome through compaction for successful results that explicitly declare incomplete work.

## Impact

- **Database:** remove the one-owner uniqueness constraint; add display name and deterministic creation ordering while retaining RLS/FORCE-RLS and stable IDs.
- **API:** remove the singleton endpoint; add owner-derived REST collection/item operations and a Knowledge-local opaque cursor.
- **Filesystem:** retain `knowledge.root/<stable-id>`; creation becomes directory-first and may leave harmless unauthoritative empty orphans after database failure.
- **Tools:** resolve current owner rows per call; optional search selector, mandatory read selector, aggregate budgets, bounded warnings, and response-time names.
- **Replay:** preserve an `incomplete` compacted outcome without changing the global `success | error` execution union.
- **Verification:** migration, pagination, duplicate names, concurrent owners, cross-tenant denial, live additions/revocations, partial all-space search, explicit reads, and persisted attribution.

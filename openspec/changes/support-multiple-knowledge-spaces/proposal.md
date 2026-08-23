## Why

The shipped Knowledge capability gives each owner exactly one filesystem-backed space, so unrelated vaults cannot remain separately named, selected, or carried safely into future personal-node synchronization. Issue #542 makes multiple owner-scoped spaces part of the current usable personal-knowledge set, while preserving deterministic Runs and the existing fail-closed filesystem boundary.

## What Changes

- Replace the one-space-per-owner database and provisioning contract with a bounded owner inventory of stable, opaque Knowledge Space identities and non-unique display names.
- Add authenticated list, create, and rename operations while retaining the singular create-or-get operation as a compatibility path for the migrated default space.
- Add a minimal authenticated web surface to list, create, and rename Knowledge Spaces and to edit the current Chat's selected set; file browsing, upload, and editing remain outside this change.
- Let an owner replace a Chat's explicit Knowledge Space set, including an intentionally empty set; initialize an unconfigured Chat once from the owner's then-current spaces rather than resolving dynamic “all spaces” on every turn.
- Snapshot the Chat's resolved space IDs, names, and binding revision into each accepted Run. Later attachments apply only to later Runs; detachment or loss of ownership revokes subsequent tool access even for an already accepted Run.
- Extend Knowledge tools with trusted Run-bound multi-space resolution: search may target one bound space or the complete Run-bound set under global operation limits, while read uses a space selector whenever paths could be ambiguous.
- Persist and disclose the bounded Run binding without exposing owner IDs, configured roots, host paths, or alternate filesystem selectors.
- Preserve existing single-space identities and files during migration. Do not add indexing, embeddings, import/synchronization, shared ownership, arbitrary filesystem paths, or Knowledge Space content deletion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge-spaces`: Changes owner cardinality, display metadata, management APIs, Chat bindings, accepted-Run snapshots, migration, and revocation behavior.
- `knowledge-tools`: Changes trusted binding resolution and tool inputs/results from one implicit space to a bounded Run-authorized set.

## Impact

- **Database:** `knowledge_spaces` cardinality and metadata; new tenant-enforced Chat and Run binding state; generated migration and RLS/FORCE-RLS coverage.
- **API and web:** additive Knowledge Space collection operations and Chat binding fields; updated OpenAPI/generated client; owner inventory management and per-Chat selection UI.
- **Run acceptance and receipts:** atomically resolved Knowledge bindings, immutable per-Run upper bounds, model-visible binding disclosure, and worker revalidation.
- **Tools:** multi-binding runtime context, aggregate search budgets, space-qualified reads/results, availability and revocation outcomes.
- **Operations:** every API/worker still mounts the same configured stable-ID children; names and bindings never become host directory selectors.
- **Product verification:** migration, concurrent ownership, duplicate names, Chat isolation, retry/handoff determinism, live revocation, cross-tenant denial, and browser acceptance.

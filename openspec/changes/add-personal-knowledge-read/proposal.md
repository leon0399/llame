## Why

llame cannot yet read the owner's canonical Markdown knowledge, so the existing hosted Run loop cannot use durable user-maintained context outside Chat history. This change establishes the smallest secure Git resource boundary needed by the immediate file-native intelligence sequence and by the later recoverable-write and Profile Space capabilities.

## What Changes

- Add one explicitly provisioned, owner-scoped personal Knowledge Space backed by accepted Markdown files and Git history rather than PostgreSQL content or an index.
- Separate the globally stable portable Knowledge Space identifier from its installation-local owner row and repository binding, so host paths, credentials, caches, checkout details, and hosted account identity never become portable resource identity.
- Add trusted operator source configuration and provisioning that bind an owner to an opaque source key and accepted Git ref without exposing a host-path registration surface to browsers, API callers, or models.
- Add bounded `knowledge_search` and `knowledge_read` tools that resolve ownership from trusted Run context and read one exact accepted commit through committed Git objects, never through the working tree.
- Bind owner-specific Knowledge tool availability when each Run is accepted, so an unlinked or logically unresolvable source is disclosed before the turn rather than advertised as callable.
- Persist retrieval provenance containing the Knowledge Space reference, accepted commit OID, and repository-relative path while excluding local repository details.
- Define fail-closed behavior for cross-tenant selection, traversal, symlinks, malformed repositories, oversized work, unavailable worker bindings, and concurrent empty-repository bootstrap.
- Keep the capability usable in the current hosted queue/worker topology without a personal Node, Workspace, Sandbox, generic filesystem access, remote Git transport, or knowledge-content/index database migration.

## Capabilities

### New Capabilities

- `knowledge-spaces`: Owner-scoped logical Knowledge Spaces, trusted local source bindings, accepted Git revision semantics, bootstrap, portability boundaries, and tenant isolation.
- `knowledge-tools`: Bounded read-only search and read tools over an owner's accepted Markdown snapshot, including citations, provenance, limits, and failures.

### Modified Capabilities

- `instance-config`: Add strict operator-owned repository source bindings while keeping per-owner linkage in tenant-scoped PostgreSQL state.
- `tool-calling`: Expand the code-owned read-only tool inventory beyond conversation search while retaining immutable declarations, allowlist gating, trusted Run identity, persistence, and replay behavior.

## Impact

- `apps/api`: instance configuration, database schema and RLS, operator provisioning entrypoint, Git repository adapter, tool registry, Run worker integration, and focused unit/integration tests.
- `apps/web` and root E2E: existing tool-part rendering plus an end-to-end browser Chat proving note discovery and repository-relative citation.
- Runtime/deployment: every turn-authoring API process must declare the full logical Knowledge source-key set; every process consuming the `runs` queue must additionally have Git and resolve the full set to accessible repository mounts, although absolute paths may differ by process.
- Documentation: `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, configuration examples, and operator guidance change when the capability ships.
- Follow-ups: #212 adds recoverable writes through a separate proposal; local Nodes and Personal Realm synchronization reuse the logical resource and Git evidence boundary without inheriting hosted paths or PostgreSQL ownership rows.

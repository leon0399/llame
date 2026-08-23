## Why

llame cannot yet read an owner's live Markdown knowledge, so the hosted Run loop cannot use durable user-maintained context outside Chat history. This change establishes the smallest secure filesystem capability for personal Knowledge: any authenticated owner can self-service one isolated space beneath an operator-controlled root, and the agent can search and read its current Markdown files.

Git is intentionally removed from this iteration. Requiring commits before reads adds revision, bootstrap, and recovery machinery without improving the MVP's primary behavior: seeing the notes that are on disk now. Issue #212 owns the later Git-backed write and recovery layer.

## What Changes

- Add an optional operator-configured Knowledge root that contains server-managed personal Knowledge Space directories and is never exposed to browsers, models, or tool arguments.
- Let any authenticated owner idempotently create or resolve one personal Knowledge Space. Trusted code generates its globally stable opaque identity and allocates its directory beneath the configured root; the caller supplies no path, owner, source, or identifier.
- Keep owner/resource linkage in PostgreSQL with forced RLS while keeping canonical Markdown content and search data in files; bounded tool-result observations continue through the existing Run and Chat persistence paths.
- Add bounded `knowledge_search` and `knowledge_read` tools that resolve authority from trusted Run context and read the live filesystem, including files changed or created without a Git commit.
- Persist safe response-time attribution containing the Knowledge Space identifier, Knowledge-relative path, and SHA-256 hash of the exact bytes read, while excluding the configured root and other host details.
- Define fail-closed behavior for missing configuration, cross-tenant selection, traversal, symlinks, unsupported files, invalid text, oversized work, and unavailable worker mounts.
- Keep the capability usable in the current hosted queue/worker topology without Git, a personal Node, Workspace, Sandbox, generic filesystem access, or a Knowledge content/index database migration.

## Capabilities

### New Capabilities

- `knowledge-spaces`: Self-service owner-scoped Knowledge Space identity, server-managed local directory binding, portability boundaries, recovery, and tenant isolation.
- `knowledge-tools`: Bounded read-only search and read tools over the owner's live Markdown files, including response-time attribution, limits, and failures.

### Modified Capabilities

- `instance-config`: Add one strict operator-owned Knowledge root while keeping per-owner linkage in tenant-scoped PostgreSQL state.
- `tool-calling`: Expand the code-owned read-only tool inventory beyond conversation search while retaining immutable declarations, allowlist gating, trusted Run identity, persistence, and replay behavior.

## Impact

- `apps/api`: instance configuration, database schema and RLS, authenticated self-service provisioning, bounded filesystem resolution, tool registry, Run worker integration, and focused unit/integration tests.
- `apps/web` and root E2E: existing tool-part rendering plus a browser Chat proving live note discovery and Knowledge-relative citation.
- Runtime/deployment: every turn-authoring API declares the Knowledge root setting without probing it; every process serving provisioning and every `runs` consumer needs the corresponding root mounted, with write access required only for provisioning.
- Documentation: `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, configuration examples, and operator guidance change when the capability ships.
- Follow-ups: #212 introduces Git initialization and recoverable agent-authored commits; local Nodes and Personal Realm synchronization preserve the stable logical resource identity without inheriting hosted paths or PostgreSQL ownership rows.

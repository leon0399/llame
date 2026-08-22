## Context

See [proposal.md](proposal.md) for motivation. The current hosted runtime executes every Run through pg-boss, and a `runs` consumer may be co-located with the API or run as a dedicated worker. Code-owned tools receive trusted `userId` and `chatId` values from the accepted Run, are filtered through the operator's read-only allowlist, and persist their structured calls and results.

The repository currently has no Knowledge Space, owner-to-directory linkage, or bounded Knowledge filesystem capability. `llame.config.json` is operator-owned and cannot hold tenant-owned settings; PostgreSQL with FORCE RLS owns those settings. The immediate cut must work in this topology while preserving a stable Knowledge Space identity that can later be bound on a personal Node without making hosted paths or ownership rows portable.

Issue #213 is now a parent outcome with two implementation sub-issues: #519 owns self-service owner-scoped provisioning and #520 owns bounded live Markdown reads. Git history, commit acceptance, and recoverable mutation are explicitly deferred to #212.

## Goals / Non-Goals

**Goals:**

- Establish one stable logical Knowledge Space per authenticated owner.
- Bind it to a server-allocated directory beneath one operator-configured root without accepting a caller-selected path.
- Make cross-tenant directory selection structurally impossible from model, browser, or tool input.
- Read the current Markdown files on disk, including changes made without a Git commit.
- Give search and read deterministic bounds, safe response-time attribution, and honest failures.
- Keep the logical space boundary reusable by a future single-owner local Node whose binding store and ownership model differ from the hosted implementation.
- Fit the current undifferentiated `runs` worker queue without introducing execution placement.

**Non-Goals:**

- Git initialization, refs, commits, accepted revisions, worktrees, remotes, credentials, or synchronization; #212 owns the first Git-backed mutation behavior.
- Importing or claiming a pre-existing directory, user-selected paths, multiple spaces per owner, deletion, or a browser management UI.
- Generic filesystem, shell, Workspace, Sandbox, Personal Realm, Node Protocol, or global authority identity.
- Indexes, embeddings, ranking infrastructure, background ingestion, file watching, or automatic prompt injection.
- Knowledge writes, shared Knowledge Spaces, project routing, or Profile Space behavior.

## Decisions

### D1. One proposal owns two independently reviewable implementation issues

The security contract spans configuration, owner/resource linkage, filesystem containment, trusted Run identity, and tool behavior, so one OpenSpec change describes the complete read capability. GitHub issue #519 owns provisioning and #520 owns live reads; the implementation stack mirrors that separation.

Creating a third Git foundation inside this proposal was rejected. Live reads do not need Git, and retaining it would add repository discovery, bootstrap races, revision semantics, runtime dependencies, and tests with no MVP read benefit. #212 introduces the minimum Git machinery when recoverable writes need it.

### D2. Process configuration owns one Knowledge root; PostgreSQL owns owners

`llame.config.json` gains one optional `knowledge.root` absolute path. The built-in default is absent, which disables provisioning and Knowledge tools. The configuration loader applies existing interpolation and closed-schema validation but does not probe the filesystem. The root remains private operator state and never appears in public configuration, model context, tool input, persisted results, or owner-facing errors.

PostgreSQL stores one tenant-owned `knowledge_spaces` row containing:

- a trusted globally stable opaque `knowledge_space_id`; and
- `owner_user_id`, unique so one owner has at most one space.

The table uses ENABLED and FORCED RLS keyed by `owner_user_id`, plus explicit owner filters in repository queries. It stores no Markdown content, content hash, derived index, host path, credential, cache, or checkout state.

The hosted local binding derives one direct child directory from the trusted space ID beneath the configured root. This is an installation-local resolver convention, not portable resource identity. A future personal Node preserves the same ID but may use its own binding store and local path.

Alternatives rejected:

- Storing owner-to-path mappings in `llame.config.json` mixes tenant state with deployment configuration.
- Storing an absolute path in PostgreSQL leaks installation-local state into the logical resource.
- Letting an owner submit even a relative directory permits claiming or probing another directory beneath the shared root.
- Deriving directory names from hosted `userId` couples portable resource layout to one authority's account identity.

### D3. Self-service provisioning accepts no resource selector

Expose idempotent `PUT /api/v1/me/knowledge-space` for the current authenticated owner. It accepts no selector fields and returns a projection containing only the stable Knowledge Space ID. Trusted code inserts or resolves the owner's row and ensures the direct child directory `<root>/<knowledge_space_id>` exists. The endpoint follows the existing `@CurrentUser()` owner boundary, closed request validation, Swagger response declarations, and generated OpenAPI/client workflow.

The database row is the durable identity and recovery anchor. Provisioning validates the root before inserting, commits or resolves the unique owner row, then ensures its derived child exists. A unique owner constraint makes concurrent creation converge on one ID. Directory creation is idempotent: a retry accepts an existing real directory at the exact derived child but rejects a symlink or non-directory. If filesystem creation fails after the row is committed, the row remains and a later retry repairs the same directory instead of minting a second identity.

Provisioning canonicalizes the configured root, requires it to be an accessible directory, derives the child only from the trusted opaque ID, and proves the resolved child remains directly beneath the canonical root. It never scans for candidate vaults, claims a pre-existing named directory, falls back to Home or the process working directory, or initializes Git.

### D4. The live filesystem is the read authority

Search and read observe files as they exist at each tool call. A modified or newly created Markdown file is eligible immediately; no commit, accepted ref, clean-worktree check, or snapshot creation occurs. Git metadata, if an operator happens to place it in the directory, has no authority in this change.

There is intentionally no operation-wide revision. Search hashes the exact bytes used for each returned match, and read hashes the exact bytes it returns. Files may change between calls or while a search advances through different files. Results therefore provide response-time attribution, not permanent replayability. This trade-off is explicit and appropriate for the MVP; later Git history or transfer snapshots may add stronger evidence without changing the tool names.

### D5. A narrow filesystem adapter enforces containment

The filesystem adapter accepts only a trusted resolved Knowledge Space binding plus a validated Knowledge-relative path. No generic filesystem or command runner is exposed.

For traversal and reads it:

1. resolves the configured root and exact stable-ID child;
2. proves the child is a real directory directly beneath the root;
3. rejects absolute paths, empty/dot/dot-dot components, backslashes, control characters, and excessive path depth or size;
4. walks directory entries without following symbolic links;
5. admits only bounded regular Markdown files; and
6. reads bytes only after containment and entry-type checks, then validates UTF-8 and computes SHA-256 over the exact bytes used.

Every symbolic-link entry or component is refused even when its target remains inside the Knowledge Space. This keeps the rule simple and prevents a link from redirecting a later access outside the root. Host paths and raw filesystem errors remain operator-only diagnostics.

The threat boundary excludes a malicious local operator racing filesystem entries after validation; that actor already controls the configured root and process deployment. Browser, model, and cross-tenant callers remain unable to supply the root or stable-ID child.

### D6. Search is a deterministic bounded scan, not an index

`knowledge_search` performs a case-insensitive literal search over safe UTF-8 `.md` files in the live space. It returns at most one result per file, ordered by Knowledge-relative path, with the first matching line and a bounded surrounding snippet. It is intentionally not relevance ranking.

Initial fixed bounds are:

- query: 1-200 Unicode code points;
- requested results: 1-10, default 5;
- filesystem entries: at most 20,000;
- admitted Markdown files: at most 5,000;
- individual Markdown file inspected by search: at most 1 MiB;
- aggregate Markdown content inspected: at most 32 MiB;
- Knowledge-relative path: at most 1,024 UTF-8 bytes and 32 components; and
- result snippet: at most 500 Unicode code points.

`knowledge_read` considers one safe UTF-8 Markdown file up to 64 KiB, but succeeds only when the complete structured result serializes to at most 15,000 UTF-16 code units. Search applies the same 15,000-unit result preflight. This stays below the tool loop's existing 16,000-unit truncation cap. Both operations obey the existing timeout and abort signal. Crossing a corpus, file, path, or output bound returns `knowledge_limit_exceeded`; it does not return partial content or search results that could be mistaken for complete.

These limits are conservative implementation defaults, not a ranking or indexing commitment. They may be tuned from measurements without changing the live-filesystem authority or tenant boundary.

### D7. API declarations and root mounts are separate deployment checks

Every turn-authoring API process must declare `knowledge.root` when the capability is enabled so accept-time availability does not depend on which API accepts the Run. Configuration loading validates only the path shape and does not probe the filesystem.

Every process serving the self-service create-or-get operation must resolve the root and have permission to create the stable-ID child. Every process consuming the `runs` group must resolve the same logical set of stable-ID children beneath its configured root and have read access. Absolute root paths may differ between processes, but deployments must make the same Knowledge directories available to every eligible consumer; subset mounting is unsupported until execution placement exists.

Runtime resolution fails closed with `knowledge_space_unavailable` and never falls back to Home, the process working directory, a user-derived path, another owner's child, or remote storage. Adding owner-affinity queues or Node placement would solve a later distributed-execution problem and is outside this change.

### D8. Tool results are the durable response-time receipt

Both tools are code-owned `read_only` tools and use the existing exact allowlist, immutable declaration snapshot, timeout, settlement, persistence, replay, compaction, and UI rendering paths. Their arguments contain no owner, Knowledge Space ID, root, or alternate resource selector.

The shipped code-owned catalog currently treats every registered tool as available and its static executors receive no filesystem service. This change therefore adds two explicit integration seams rather than hiding owner logic inside registration:

- at Run acceptance, an owner-aware code-owned candidate resolver runs inside the existing RLS transaction and supplies available or unavailable Knowledge candidates before the immutable effective-context snapshot is composed; and
- at worker execution, the trusted tool context or an equivalent DI-bound executor seam supplies the Knowledge resolver and process-local root configuration while `ToolContext.userId` remains the only owner authority.

The static registry continues to own declarations and classifications. Neither seam may make the registry tenant-mutable or put private binding data into the immutable declaration.

When a Run is accepted, the API resolves the owner row under RLS. If no row exists, both otherwise-eligible Knowledge tool IDs are unavailable with `knowledge_space_not_configured`. If `knowledge.root` is absent on the authoring API, they are unavailable with `knowledge_space_unavailable`. The request path does not probe the filesystem; execution revalidates the worker-local directory and returns the same closed unavailable reason if it cannot be safely resolved.

Successful search matches and reads include the logical space ID, Knowledge-relative path, and SHA-256 content hash; search matches add line/snippet evidence. Each tool preflights its complete structured success result below the existing generic live-result truncation boundary, so persistence and browser reconstruction retain the exact recorded attribution. Later model replay remains subject to the existing pair and turn/ledger budgets and may clear or omit payload detail only under their existing honest-degradation rules.

Tool descriptions frame file content as untrusted and potentially stale, instruct the model to cite a used note's Knowledge-relative path, and direct materially volatile claims to appropriate external tools. The existing generic structured-result rendering visibly includes that path; this change does not add a dedicated citation component or post-process provider text to manufacture citations.

The closed availability vocabulary gains `knowledge_space_not_configured` and `knowledge_space_unavailable`, with recovery reasons `knowledge_space_configured` and `knowledge_space_restored`. Host paths, raw filesystem errors, and other-owner existence remain absent from model- and user-visible messages.

## Risks / Trade-offs

- [Live files can change between search and read] -> Hash the exact bytes used by each result and document response-time rather than revision-stable attribution.
- [Every Run worker needs the shared Knowledge root] -> Treat full mounting as an explicit deployment invariant and defer owner-aware placement rather than silently route or fall back.
- [A linear scan becomes expensive for a large space] -> Enforce fixed file/byte/time limits and fail honestly; add a rebuildable index only after measurements justify it.
- [Database and directory creation cannot be one transaction] -> Make the row the durable identity, make directory creation idempotent, and let retries repair partial provisioning without minting a second space.
- [A symlink or traversal escapes the configured root] -> Derive the child from a trusted opaque ID, reject caller-selected paths and every symlink component, canonicalize containment, and add adversarial tests.
- [An API declares a root that its worker cannot access] -> Avoid accept-time probes, revalidate at execution, return a closed unavailable result, and diagnose the private path only in operator logs.
- [Future node synchronization needs stronger evidence] -> Preserve the globally stable space ID now; let a later Git/transfer proposal add snapshots without redefining resource identity.

## Migration Plan

1. Deploy the metadata migration, root configuration schema, self-service create-or-get operation, filesystem adapter, and code-owned tools with both tool IDs absent from `tools.allowed`.
2. Configure `knowledge.root` on every turn-authoring API. Mount the corresponding directory with write access on processes serving provisioning and read access on every `runs` consumer.
3. Let each authenticated owner create or resolve their space, then place bounded Markdown files in the allocated directory through trusted local administration until #212 supplies agent writes.
4. Enable `knowledge_search` and `knowledge_read` in `tools.allowed`, restart relevant processes, and run the two-owner and browser acceptance tests.
5. Ship the corresponding `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, and operator documentation updates in the final implementation PR.

Rollback first removes both tool IDs from configuration and prevents new Runs from binding their declarations. Drain accepted Runs whose immutable snapshots contain either tool before deploying code that removes their executors. The metadata row and allocated directory may remain safely while unexposed; rollback does not delete user files.

## Revision History

- **v7 (2026-08-23):** Aligned VISION, ROADMAP, and research provenance with the live-filesystem decision; made the self-service HTTP/OpenAPI contract and the API-side owner-aware/worker-side DI tool seams explicit.
- **v6 (2026-08-23):** Replaced operator source mappings and committed Git snapshots with self-service stable-ID directories under one configured root, live filesystem reads, and response-time path/content-hash attribution; moved all Git behavior to #212.
- **v5 (2026-08-22):** Made the Knowledge Space ID globally stable and portable while keeping hosted ownership and repository bindings authority-local.
- **v4 (2026-08-22):** Closed Knowledge availability/recovery vocabulary and split API declarations from worker mounts.
- **v3 (2026-08-22):** Reconciled owner-specific accept-time availability, replay budgets, revision failures, and browser citation guarantees.
- **v2 (2026-08-22):** Aligned Knowledge success sizes with the shipped tool-result cap and closed duplicate-source aliases.
- **v1 (2026-08-22):** Initial Git-backed proposal after VISION, issue #213, current runtime, and draft-stack exploration.

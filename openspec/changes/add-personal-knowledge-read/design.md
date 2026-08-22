## Context

See [proposal.md](proposal.md) for motivation. The current hosted runtime executes every Run through pg-boss, and a `runs` consumer may be co-located with the API or run as a dedicated worker. Code-owned tools receive trusted `userId` and `chatId` values from the accepted Run, are filtered through the operator's read-only allowlist, and persist their structured calls and results.

The repository currently has no Knowledge Space, no Git runtime dependency, no owner-to-repository linkage, and no worker routing by owner or filesystem capability. `llame.config.json` is operator-owned and explicitly cannot hold tenant-owned settings; PostgreSQL with FORCE RLS owns those settings. The immediate product cut must work in this topology while preserving the later boundary in which Git history is portable but host paths, credentials, caches, and worker placement are not.

## Goals / Non-Goals

**Goals:**

- Establish one stable logical Knowledge Space per owner and one private installation-local binding to a trusted repository source.
- Make cross-tenant repository selection structurally impossible from model input.
- Read one exact committed Git snapshot without observing the working tree.
- Give search and read operations deterministic bounds, provenance, and honest failures.
- Keep the logical repository port reusable by a future single-owner local Node whose binding store and ownership model differ from the hosted implementation.
- Fit the current undifferentiated `runs` worker queue without introducing execution placement.

**Non-Goals:**

- Remote Git fetch, clone, credentials, provider adapters, or automatic refresh.
- Knowledge writes, branches, worktrees, candidate revisions, compare-and-swap publication, or crash recovery for mutations; #212 owns those decisions.
- Generic filesystem, shell, Workspace, Sandbox, Personal Realm, Node Protocol, synchronization, or global authority identity.
- Indexes, embeddings, ranking infrastructure, background ingestion, file watching, or automatic prompt injection.
- Shared Knowledge Spaces, multiple spaces per owner, project routing, or a browser management UI.

## Decisions

### D1. One proposal owns the complete read boundary

This change creates two focused capabilities: `knowledge-spaces` owns identity, binding, accepted-state, bootstrap, and isolation; `knowledge-tools` owns the model-facing search/read behavior. The same proposal also updates `instance-config` and `tool-calling` because configuration, trusted execution, and persistence are part of the security boundary.

Splitting source linkage and tools into separate proposals would make each artifact describe a partial security story and create incompatible intermediate assumptions. Reviewability comes from the implementation stack described in `tasks.md`, not from weakening the specification boundary. Knowledge writes remain separate because durable mutation and acceptance have materially different recovery semantics.

### D2. PostgreSQL owns the logical owner linkage; process config owns host paths

Add one tenant-owned `knowledge_spaces` row with:

- a server-generated globally stable opaque `knowledge_space_id`, preserved unchanged when the resource is later replicated to a personal Node;
- `owner_user_id`, unique so an owner has at most one space;
- an opaque `source_key`, unique so one configured source cannot be linked to two owners in this personal-only slice; and
- one canonical full accepted branch ref such as `refs/heads/main`.

An accepted ref must begin with `refs/heads/` and pass `git check-ref-format` as a complete ref. Short names, `HEAD`, tags, revision expressions, peel expressions, and reflog selectors are rejected before any repository mutation or read.

The table uses ENABLED and FORCED RLS keyed by `owner_user_id`, plus explicit owner filters in repository queries. It stores no note content, derived index, host path, credential, cache location, or checkout state.

`llame.config.json` gains an operator-owned `knowledge.sources` map from opaque source key to an absolute local repository root. Different processes may map the same source key to different absolute paths, which permits container-specific mounts without changing the logical linkage. Per-owner linkage remains in PostgreSQL, preserving the existing instance-config rule that tenant state is not file configuration.

An operator-only provisioning command links an owner ID, configured source key, and accepted ref. It is idempotent for an exact existing linkage and refuses replacement or cross-owner reuse. There is no HTTP endpoint that accepts a source key, ref, or host path.

Before linkage, provisioning resolves the configured roots and refuses an ambiguous configuration in which two source keys identify the same canonical repository root. This closes the alias that a source-key uniqueness constraint alone cannot see.

Alternatives rejected:

- Storing owner-to-path mappings in `llame.config.json` mixes tenant state with operator configuration and makes account lifecycle deployment configuration.
- Storing an absolute path in the portable Knowledge Space shape leaks one installation's binding into future Nodes.
- Letting an authenticated owner submit a server path makes the browser an authority over host filesystem selection.
- Deriving paths from `userId` hides a host-path contract behind identity and prevents explicit registration.

### D3. The portable boundary is a stable resource ID plus accepted Git evidence

The Knowledge Space ID is generated once as a globally stable opaque resource identifier. The hosted row and `owner_user_id` association remain authority-local, but the resource ID itself is preserved unchanged when a future standalone personal Node imports or replicates the same Knowledge Space. Model-visible and persisted retrieval provenance contains:

```text
knowledge_space_id
accepted_commit_oid
repository_relative_path
```

It contains no hosted owner ID, `source_key`, host path, remote, credential, cache path, checkout ID, or worker identity. A future multi-authority reference may wrap this unchanged ID with governing-authority identity, but SHALL NOT replace or migrate the Knowledge Space ID. This change does not define that authority identity, Personal Realm enrollment, or synchronization protocol.

The repository reader is defined behind a logical interface that accepts a trusted resolved binding and returns accepted Git evidence. A future local Node may implement ownership as its implicit single owner, retain the same Knowledge Space ID, and bind it to its own local repository. Reuse is at this semantic interface and portable identifier, not through shared PostgreSQL rows, configuration files, or execution code.

### D4. Read Git objects through a narrow native-Git adapter

Use the native `git` executable through `execFile` with fixed command templates and argument arrays. No shell command string and no generic command runner is exposed. A `runs` consumer with configured knowledge sources must have Git available; the worker performs a loud startup diagnostic, while a source that becomes unavailable later returns a structured tool error.

For each operation the adapter:

1. canonicalizes the configured root and proves it is the exact top level of a non-bare Git worktree;
2. resolves the trusted accepted ref once to a commit OID;
3. enumerates that commit's tree with modes and blob OIDs;
4. admits only bounded regular Markdown blobs with safe repository-relative paths; and
5. reads admitted content by blob OID, not by a revision/path expression and never from the working tree.

This permits `git rev-parse`, `git ls-tree`, and `git cat-file` behind dedicated operations. Tool arguments never reach Git as a ref, repository, option, or object expression. The read path is matched against the already enumerated tree and the resulting blob OID is the only object selector used for content.

Native Git is preferred over a new JavaScript Git implementation because it is the canonical object/ref engine and #212 will require mature atomic-ref behavior. The cost is an explicit runtime dependency and process boundary. Reading the checkout directly was rejected because it leaks uncommitted state and turns symlink containment into the primary security mechanism. Reusing the draft stack's `GitWorktreeManager` was rejected because it creates mutable per-Run branches and imports Personal Node, Workspace, and SQLite assumptions.

### D5. One operation observes one accepted commit

The accepted ref is trusted linkage metadata and is never a tool argument. Search or read resolves it to a commit OID exactly once, then performs every tree and blob operation against that OID. A concurrent ref advance affects the next call, not the in-flight observation. Dirty, untracked, ignored, or subsequently changed working-tree files are invisible.

The initial capability follows the configured accepted branch; it does not pin the repository forever. Every returned match or document carries the OID actually observed, allowing persisted tool results and later Profile Space context to state the exact revision used.

### D6. Bootstrap happens during trusted provisioning, never in a model tool

Provisioning accepts either:

- an existing exact repository root whose accepted ref resolves to a commit; or
- a truly empty directory or initialized repository with no commit and no non-Git working-tree entries.

For the empty case, provisioning creates one system-authored empty initial commit and advances the configured accepted ref before publishing the owner linkage. A database advisory lock on the source key, a uniqueness constraint on the source linkage, and a compare-and-swap ref creation make concurrent provisioning converge on one accepted history. If Git initialization succeeds but database publication fails, retry observes the valid repository and completes the idempotent linkage.

A non-empty non-repository, a nested directory inside a repository, a bare repository, an unborn repository with uncommitted files, or an existing repository whose accepted ref is missing fails without creating or moving a ref. Run workers never bootstrap or mutate a repository while executing `knowledge_search` or `knowledge_read`.

Lazy first-tool bootstrap was rejected because a read-only model capability should not require repository write permission and because retries across workers would turn a read failure into distributed mutation recovery.

### D7. Search is a deterministic bounded scan, not an index

`knowledge_search` performs a case-insensitive literal search over safe UTF-8 Markdown content from the resolved commit. It returns at most one result per file, ordered by repository-relative path, with the first matching line and a bounded surrounding snippet. It is intentionally not relevance ranking.

Initial fixed bounds are:

- query: 1-200 Unicode code points;
- requested results: 1-10, default 5;
- tree entries: at most 20,000;
- admitted Markdown blobs: at most 5,000;
- individual Markdown blob inspected by search: at most 1 MiB;
- aggregate Markdown content inspected: at most 32 MiB;
- repository-relative path: at most 1,024 UTF-8 bytes and 32 components; and
- result snippet: at most 500 Unicode code points.

`knowledge_read` considers one admitted UTF-8 Markdown blob up to 64 KiB, but succeeds only when the complete structured result serializes to at most 15,000 UTF-16 code units. Search applies the same 15,000-unit result preflight. This leaves headroom below the tool loop's existing 16,000-unit truncation cap, so Knowledge tools return a closed `knowledge_limit_exceeded` error instead of allowing a successful read or search to be truncated into incomplete evidence. Both operations also obey the existing tool timeout and abort signal. Crossing a corpus, file, path, or output bound returns `knowledge_limit_exceeded`; it does not return partial content or search results that could be mistaken for complete.

These conservative fixed limits avoid another operator tuning surface before measurements exist. An index may later replace the scan without changing accepted-snapshot or provenance semantics.

### D8. Git tree admission is the path-security boundary

`knowledge_read` accepts one repository-relative Markdown path only. It rejects absolute paths, empty/dot/dot-dot components, backslashes, NUL/control characters, overlong paths, and non-Markdown suffixes. The exact path must name a regular blob in the enumerated accepted tree.

Symlink entries, submodules, trees, and other Git modes are never followed. Because content is read by admitted blob OID, a symlink in either the committed tree or checkout cannot redirect access, and the working tree cannot substitute a different file. Search applies the same admission rules to every candidate.

### D9. API declarations and worker mounts are separate deployment invariants

Every turn-authoring API process, including an HTTP-only `web` worker profile, must declare the same complete logical source-key set so accept-time availability does not depend on which API accepts the Run. A non-consuming API does not need Git or accessible repository mounts, and configuration loading does not probe those paths.

The current `runs` queue can dispatch any owner's Run to any process consuming that group. Therefore every such consumer must additionally have Git and resolve every declared source key to an accessible repository mount; the same key may map to a process-specific absolute path, but subset mounting is unsupported. Startup diagnostics identify missing Git or unresolved sources to the operator without exposing their paths to users or models. Runtime resolution still fails closed with `knowledge_source_unavailable` and never falls back to Home, the process working directory, or a user-derived path.

Adding repository-affinity queues or Node placement would solve a later distributed-execution problem and is explicitly outside this change.

### D10. Tool results are the durable retrieval receipt

Both tools are code-owned `read_only` tools and use the existing exact allowlist, immutable declaration snapshot, timeout, settlement, persistence, replay, compaction, and UI rendering paths. Their arguments contain no owner, Knowledge Space ID, source key, accepted ref, repository root, or credential. The executor resolves the sole owner linkage using trusted `ToolContext.userId`.

When a Run is accepted, the API resolves the owner linkage under RLS and binds owner-specific availability into the immutable tool manifest. If no linkage exists, both otherwise-eligible Knowledge tool IDs are unavailable with `knowledge_space_not_configured`. If a linkage exists but the authoring API process does not declare its logical source key, they are unavailable with `knowledge_source_unavailable`. The request path does not probe the repository filesystem: a declared logical binding is sufficient for acceptance, while execution still revalidates the worker-local binding and fails closed if it disappeared. Every turn-authoring API process must therefore declare the same logical source-key set; only `runs` workers require accessible mounts.

Successful search responses and reads include the logical space ID and accepted commit OID; each search match and every read also include a repository-relative path, while search matches add line/snippet evidence. Each tool preflights its complete structured success result below the existing generic live-result truncation boundary, so the persisted tool part and reloaded browser retain complete evidence without a second database or context-receipt mechanism. Later model replay remains subject to the existing 8,000-unit pair and 32,000-unit turn/ledger budgets: payload detail, including Knowledge provenance, may be cleared or the complete pair omitted while its outcome and omission state remain honest. Tool descriptions frame repository content as untrusted and potentially stale, instruct the model to cite a used note's repository-relative path, and direct materially volatile claims to appropriate external tools. The structured tool-result UI visibly presents that path; arbitrary provider text is not post-processed to manufacture citations.

Errors use closed reason codes and static user/model-safe messages. Host paths, source keys, Git stderr, and raw exceptions remain operator-only diagnostics.

The shared closed availability vocabulary gains `knowledge_space_not_configured` and `knowledge_source_unavailable`, with stable model-safe labels. Their unavailable-to-available recovery mappings are `knowledge_space_configured` and `knowledge_source_restored`, respectively. Manifest parsing, transition derivation, and reminder rendering must recognize the additions as one coordinated contract change.

## Risks / Trade-offs

- [Split API/worker configuration drifts] -> Require the full logical key set on every turn-authoring API, require accessible mounts only on `runs` consumers, and cover the HTTP-only `web` profile plus dedicated-worker topology.
- [Every Run worker needs every configured repository mount] -> Document this as a separate execution invariant, allow process-specific paths behind source keys, and refuse missing bindings instead of silently routing or falling back.
- [A linear scan becomes too expensive for a large vault] -> Enforce fixed file/byte/time limits and fail honestly; introduce a rebuildable index only after real corpus measurements justify it.
- [Native Git is absent or version-skewed] -> Make Git explicit in development/deployment packaging and perform a worker startup diagnostic before enabling configured sources.
- [An operator links the wrong owner or source] -> Require an explicit provisioning command, exact owner ID, idempotent confirmation output without paths, and unique owner/source constraints; no browser relinking surface ships.
- [The accepted ref moves during a call] -> Resolve once and address all subsequent reads by commit/blob OID.
- [Repository disappearance causes inconsistent split-worker behavior] -> Bind logical availability at Run acceptance, treat subset mounts as unsupported configuration, diagnose each `runs` worker, and return a closed unavailable result rather than disclose or substitute another source.
- [Future multi-authority references need collision-free authority context] -> Preserve the globally stable Knowledge Space ID unchanged and let the later protocol wrap it with governing-authority identity rather than migrate persisted receipts.
- [Bootstrap writes to a source in a nominally read-only capability] -> Restrict the one-time empty-history mutation to trusted provisioning before linkage; model tools remain object-read-only.

## Migration Plan

1. Deploy the metadata migration, source configuration schema, provisioning command, repository adapter, and code-owned tools with both tool IDs absent from `tools.allowed`.
2. Configure the same complete logical source-key set on every turn-authoring API. On every process consuming the `runs` group, additionally install Git, provide accessible mounts for the full set, and verify Git/source diagnostics.
3. Provision the owner linkage and accepted ref. Provisioning completes any empty-repository bootstrap before the row becomes visible.
4. Enable `knowledge_search` and `knowledge_read` in `tools.allowed`, restart the relevant processes, and run the two-owner and browser acceptance tests.
5. Ship the corresponding `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, and operator documentation updates in the final implementation PR.

Rollback first removes both tool IDs from configuration and prevents new Runs from binding their declarations. Drain accepted Runs whose immutable snapshots contain either tool before deploying code that removes their executors. The metadata table and unexposed linkage may remain safely during rollback; provisioning never changes an existing non-empty accepted history.

## Revision History

- **v5 (2026-08-22):** Made the Knowledge Space ID globally stable and portable now, while keeping hosted ownership and repository bindings authority-local and deferring only the future authority-qualified wrapper.
- **v4 (2026-08-22):** Closed the Knowledge availability/recovery vocabulary and separated turn-authoring API key declarations from `runs`-consumer Git/mount requirements for split deployments.
- **v3 (2026-08-22):** Reconciled owner-specific accept-time availability, existing replay-budget degradation, exhaustive instance configuration, canonical branch-ref grammar, closed revision failures, and browser citation guarantees.
- **v2 (2026-08-22):** Aligned Knowledge success sizes with the shipped 16,000-unit tool-result cap and closed duplicate-source-key aliases to one canonical repository root.
- **v1 (2026-08-22):** Initial proposal design after VISION, issue #213, current runtime, and draft-stack exploration.

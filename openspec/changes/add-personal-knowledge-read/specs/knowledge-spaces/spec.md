## Purpose

Defines owner-scoped Git-backed personal Knowledge Spaces, their trusted local repository linkage, accepted committed state, provenance boundary, bootstrap behavior, and tenant isolation.

## ADDED Requirements

### Requirement: Each owner has at most one explicitly provisioned personal Knowledge Space

The system SHALL represent a personal Knowledge Space with a globally stable opaque identifier generated once by trusted code and suitable for preservation unchanged across future personal-Node replication. An owner SHALL have at most one linked personal Knowledge Space, and one configured source SHALL NOT be linked to more than one owner under this capability. Source keys that resolve to the same canonical repository root SHALL be treated as an ambiguous alias and refused rather than used to bypass source uniqueness.

The owner-to-space and space-to-source linkage metadata SHALL be stored in tenant-owned PostgreSQL state with row-level security ENABLED and FORCED against the current authenticated user identity. Application queries SHALL retain explicit owner filters as defense-in-depth. The table MAY contain the logical identifier, owner identifier, private source key, and accepted ref, but SHALL contain no Markdown content, content-derived search index, host path, credential, cache, or checkout state.

No model input, tool argument, browser request, or ordinary owner API SHALL create or replace this linkage. Provisioning SHALL be an explicit trusted operator action and SHALL be idempotent only when the requested owner, source, and accepted ref exactly match the existing linkage.

#### Scenario: Two owners receive distinct spaces

- **WHEN** two owners are provisioned against two repositories containing identical Markdown text
- **THEN** each owner receives a distinct stable Knowledge Space identifier
- **AND** each owner can resolve only their own linkage under datastore enforcement

#### Scenario: Owner or source replacement is refused

- **WHEN** provisioning attempts to replace an owner's existing source or link an already-linked source to another owner
- **THEN** the operation fails without changing either linkage

#### Scenario: Aliased source roots are refused

- **WHEN** two configured source keys resolve to the same canonical repository root
- **THEN** provisioning refuses the ambiguous source configuration
- **AND** it publishes no owner linkage

#### Scenario: Missing identity fails closed

- **WHEN** Knowledge Space metadata is queried without a current authenticated tenant identity
- **THEN** no row is visible or mutable

### Requirement: Portable resource identity is separate from authority-local ownership and binding

The Knowledge Space identifier SHALL be globally stable and SHALL NOT encode or derive from a hosted user ID, display name, source key, host path, remote URL, provider locator, Git revision, or current installation. The hosted ownership row and owner association are authority-local, but a future personal Node replicating the same Knowledge Space SHALL retain the identifier unchanged rather than mint a replacement or require receipt migration.

Repository source keys and their resolved host paths SHALL remain private installation-local binding data. Retrieval evidence exposed outside the binding layer SHALL identify only the logical Knowledge Space, accepted commit OID, and repository-relative path. It MUST NOT expose source keys, host paths, credentials, remotes, caches, checkout identifiers, or worker identities.

The logical repository interface SHALL permit another trusted runtime to retain the same Knowledge Space identifier and bind it to a different local source without requiring the hosted PostgreSQL ownership row or host path to become portable state. A later multi-authority resource reference MAY qualify the unchanged identifier with governing-authority identity, but SHALL NOT replace it.

#### Scenario: Different process paths preserve the logical space

- **WHEN** two conforming Run workers resolve the same private source key to different local mount paths
- **THEN** retrievals expose the same Knowledge Space identifier and Git evidence
- **AND** neither local mount path appears in tool results or persisted observations

#### Scenario: A path cannot become resource identity

- **WHEN** an operator moves a repository and updates only its private source binding
- **THEN** the logical Knowledge Space identifier remains unchanged

#### Scenario: A personal Node retains the resource identity

- **WHEN** a future personal Node imports or replicates the same Knowledge Space
- **THEN** it retains the existing Knowledge Space identifier unchanged
- **AND** its local ownership representation and repository path remain node-local binding data

### Requirement: Reads observe one exact accepted committed snapshot

Each Knowledge Space SHALL carry one trusted canonical accepted branch ref. The ref SHALL begin with `refs/heads/` and pass native Git complete-ref validation equivalent to `git check-ref-format`; `HEAD`, short names, tags, revision expressions, peel expressions, and reflog selectors SHALL be rejected. At the start of every repository operation, the system SHALL resolve that ref exactly once to a commit OID and SHALL address all tree and blob reads for that operation through that commit. A concurrent ref advance MAY affect a later operation but MUST NOT change the snapshot observed by the in-flight operation.

Uncommitted, untracked, ignored, or subsequently changed working-tree content SHALL NOT be visible. An accepted ref that is missing, unborn outside the permitted bootstrap case, not a commit, or otherwise ambiguous SHALL fail with `knowledge_revision_unavailable` without falling back to another ref, `HEAD`, or working-tree content.

#### Scenario: Dirty working tree is invisible

- **WHEN** a committed note differs from the current working-tree file
- **THEN** retrieval returns the blob from the accepted commit
- **AND** no uncommitted bytes appear in the result

#### Scenario: Accepted ref advances during a read

- **WHEN** the accepted ref moves after an operation resolves its commit OID
- **THEN** every result from that operation retains the original OID and content
- **AND** the next operation may observe the new OID

#### Scenario: Missing accepted ref does not fall back

- **WHEN** a non-empty repository's configured accepted ref does not resolve to a commit
- **THEN** the Knowledge Space is unavailable with `knowledge_revision_unavailable`
- **AND** no alternate branch or working-tree content is read

#### Scenario: Non-branch ref forms are rejected

- **WHEN** provisioning receives `HEAD`, a short branch name, a tag ref, a revision expression, a peel expression, or a reflog selector
- **THEN** accepted-ref validation rejects it before any repository or linkage mutation

### Requirement: Trusted provisioning safely handles existing and empty repositories

Provisioning SHALL accept an exact non-bare Git worktree root whose accepted ref already resolves to a commit. It SHALL also accept a truly empty directory or initialized repository with no commit and no non-Git working-tree entries by creating one system-authored empty initial commit and the accepted ref before publishing the owner linkage.

Concurrent provisioning of the same configured source SHALL converge on one accepted bootstrap history and one owner linkage. A retry after repository initialization but before linkage publication SHALL complete idempotently rather than create a second accepted root.

A non-empty non-repository, a nested directory inside another repository, a bare repository, an unborn repository containing uncommitted files, or an existing non-empty repository with a missing accepted ref SHALL fail without creating or moving an accepted ref. Model tool execution SHALL never perform bootstrap or another repository mutation.

#### Scenario: Empty configured source is bootstrapped once

- **WHEN** an operator provisions a truly empty configured source
- **THEN** one empty initial commit becomes the accepted history before the owner linkage is visible
- **AND** subsequent retrieval reports that commit OID and an empty result set

#### Scenario: Concurrent bootstrap converges

- **WHEN** two provisioning attempts race for the same empty configured source
- **THEN** exactly one accepted initial history and one matching linkage result
- **AND** neither attempt creates a conflicting accepted root

#### Scenario: Ambiguous non-repository is untouched

- **WHEN** the configured root contains files but is not an exact Git repository root
- **THEN** provisioning fails
- **AND** it creates no repository, commit, ref, or owner linkage

### Requirement: Every Run worker resolves only its configured bounded source

Every process consuming the `runs` worker group SHALL be provisioned to resolve every private source key that its queue may execute, although the absolute mount path MAY differ by process. Subset source mounting without an execution-routing capability is not supported.

If Git or the resolved source becomes unavailable at execution time, the repository capability SHALL return a closed `knowledge_source_unavailable` result. It MUST NOT fall back to the process working directory, a Home directory, a path derived from user identity, another configured source, a remote clone, or generic filesystem discovery. User- and model-visible errors SHALL omit source keys, host paths, Git stderr, and raw exceptions.

#### Scenario: Worker lacks the linked source

- **WHEN** a Run is executed on a worker that cannot resolve the owner's private source binding
- **THEN** the Knowledge operation returns `knowledge_source_unavailable`
- **AND** no other local or remote location is searched

#### Scenario: Source disappears after startup

- **WHEN** a previously valid repository mount is unavailable during a tool call
- **THEN** the call fails with the same closed reason
- **AND** ordinary Chat data and another owner's Knowledge Space remain undisclosed

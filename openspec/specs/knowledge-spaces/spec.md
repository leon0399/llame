# knowledge-spaces

## Purpose

Defines self-service owner-scoped personal Knowledge Spaces, stable identity, trusted server-managed local directory binding, recovery behavior, portability boundaries, and tenant isolation.

## Requirements

### Requirement: Each owner can self-service at most one personal Knowledge Space

The system SHALL expose idempotent `PUT /api/v1/me/knowledge-space` for the current authenticated owner. The request SHALL contain no owner ID, Knowledge Space ID, source key, directory name, relative path, absolute path, or alternate resource locator. Its success response SHALL expose only the stable logical Knowledge Space identifier and SHALL NOT expose the hosted owner row or local binding.

Trusted code SHALL generate one globally stable opaque Knowledge Space identifier. An owner SHALL have at most one personal Knowledge Space, and repeated or concurrent create-or-get calls SHALL converge on the same identifier.

The owner-to-space metadata SHALL be stored in tenant-owned PostgreSQL state with row-level security ENABLED and FORCED against the current authenticated user identity. Application queries SHALL retain explicit owner filters as defense-in-depth. The table MAY contain the logical identifier and owner identifier but SHALL contain no Markdown content, content hash, derived index, host path, credential, cache, or checkout state.

#### Scenario: Two owners receive distinct spaces

- **WHEN** two authenticated owners create their personal Knowledge Spaces
- **THEN** each receives a distinct stable Knowledge Space identifier
- **AND** each owner can resolve only their own row under datastore enforcement

#### Scenario: Repeated creation is idempotent

- **WHEN** one owner repeats or concurrently races the create-or-get operation
- **THEN** every successful response identifies the same Knowledge Space
- **AND** no second owner row or directory identity is allocated

#### Scenario: Caller cannot select identity or location

- **WHEN** a caller attempts to add an owner, resource identifier, directory name, source key, or path-shaped field to provisioning
- **THEN** closed request validation rejects it
- **AND** trusted code remains the only identity and location authority

#### Scenario: Unauthenticated provisioning is refused

- **WHEN** a request without a valid session calls the create-or-get endpoint
- **THEN** it receives the API's standard unauthorized response
- **AND** no Knowledge Space row or directory is created

#### Scenario: Missing identity fails closed

- **WHEN** Knowledge Space metadata is queried without a current authenticated tenant identity
- **THEN** no row is visible or mutable

### Requirement: Provisioning allocates one safe child beneath the configured root

For the hosted binding, trusted code SHALL derive one direct child directory from the stable Knowledge Space identifier beneath the operator-configured Knowledge root. It SHALL canonicalize the root, require it to be an accessible directory, and prove the child resolves directly beneath that root. It SHALL NOT scan for candidate directories, claim a caller-named directory, or fall back to Home, the process working directory, a user-ID-derived location, another owner's child, or remote storage.

Directory creation SHALL be idempotent. A retry MAY accept an existing real directory at the exact trusted child path but SHALL reject a symbolic link or non-directory. A database row created before a filesystem failure SHALL remain the recovery anchor so a later retry repairs the same binding without minting a second Knowledge Space. Only an owner row visible under RLS grants authority to a child directory; an unlinked directory alone grants none.

Provisioning SHALL NOT initialize Git, create commits, or require a repository. A safe empty directory is valid. Importing or claiming a pre-existing caller-selected directory is outside this capability.

#### Scenario: Empty space is created without Git

- **WHEN** an owner creates a space under a valid writable Knowledge root
- **THEN** the exact stable-ID child exists as a real directory
- **AND** no Git repository, commit, ref, or note is created

#### Scenario: Partial filesystem failure is retryable

- **WHEN** the owner row exists but its directory could not be created
- **THEN** provisioning returns a closed unavailable result without replacing the row
- **AND** a later retry targets the same stable-ID child

#### Scenario: Existing symlink child is refused

- **WHEN** the derived stable-ID child exists as a symbolic link or non-directory
- **THEN** provisioning fails closed
- **AND** it does not follow, replace, or expose the entry

#### Scenario: Missing or unusable root is closed

- **WHEN** the Knowledge root is absent, missing, not a directory, or unusable by the provisioning process
- **THEN** provisioning returns `knowledge_space_unavailable`
- **AND** it does not create a child elsewhere

### Requirement: Portable resource identity is separate from local ownership and binding

The Knowledge Space identifier SHALL be globally stable and SHALL NOT encode or derive from a hosted user ID, display name, configured root, child path, provider locator, Git revision, or current installation. The hosted ownership row and owner association are authority-local, but a future personal Node replicating the same Knowledge Space SHALL retain the identifier unchanged rather than mint a replacement or require receipt migration.

The configured root and resolved child SHALL remain private installation-local binding data. Retrieval attribution exposed outside the binding layer SHALL identify only the logical Knowledge Space, Knowledge-relative path, and exact content hash. It MUST NOT expose hosted owner IDs, root or child paths, credentials, caches, worker identities, or raw filesystem diagnostics.

A future trusted runtime MAY bind the same Knowledge Space identifier to a different local directory without requiring the hosted PostgreSQL ownership row or path convention to become portable state. A later multi-authority reference MAY qualify the unchanged identifier with governing-authority identity but SHALL NOT replace it.

#### Scenario: Different process roots preserve the logical space

- **WHEN** two conforming Run workers expose the same stable-ID child beneath different process-local roots
- **THEN** retrievals expose the same Knowledge Space identifier and safe file attribution
- **AND** neither local root appears in tool results or persisted observations

#### Scenario: Moving a local binding preserves identity

- **WHEN** an operator relocates the root while preserving the stable-ID child and updates private configuration
- **THEN** the logical Knowledge Space identifier remains unchanged

#### Scenario: A personal Node retains resource identity

- **WHEN** a future personal Node imports or synchronizes the same Knowledge Space
- **THEN** it retains the existing Knowledge Space identifier unchanged
- **AND** its local ownership representation and directory binding remain node-local

### Requirement: Run workers resolve only the trusted owner binding

Every process consuming the `runs` worker group SHALL be able to resolve every owner directory its queue may execute beneath its configured root. Subset mounting without an execution-routing capability is not supported.

Resolution SHALL start from the trusted Run owner identity, query that owner's row under RLS, and derive only the exact stable-ID child. If the root or child becomes unavailable or invalid at execution time, the capability SHALL return `knowledge_space_unavailable`. It MUST NOT fall back to another local or remote location. User- and model-visible errors SHALL omit root paths, child paths, raw filesystem exceptions, and other-owner existence signals.

#### Scenario: Worker lacks the owner's directory

- **WHEN** a Run executes on a worker that cannot safely resolve the trusted owner's stable-ID child
- **THEN** the Knowledge operation returns `knowledge_space_unavailable`
- **AND** no other directory is searched

#### Scenario: Another owner's identifier cannot redirect resolution

- **WHEN** model or caller input contains another owner's guessed or observed Knowledge Space identifier
- **THEN** resolution still begins and ends with the accepted Run owner's RLS-protected row
- **AND** no data or existence signal from the other owner is returned

## MODIFIED Requirements

### Requirement: Each owner can self-service a bounded inventory of personal Knowledge Spaces

The system SHALL expose an authenticated owner-scoped Knowledge Space inventory. An owner SHALL have at most 32 Knowledge Spaces. Every space SHALL have a trusted-code-generated globally stable opaque identifier and an owner-editable display name. Display names SHALL be trimmed, contain 1 through 100 Unicode code points, reject control, format, line-separator, and paragraph-separator characters, and MAY be identical within or across owners. A display name SHALL be model-visible untrusted metadata and SHALL NOT be an identity, authorization key, or filesystem selector.

The API SHALL expose `GET /api/v1/me/knowledge-spaces`, `POST /api/v1/me/knowledge-spaces`, `PATCH /api/v1/me/knowledge-spaces/:knowledgeSpaceId`, and bodyless `PUT /api/v1/me/knowledge-spaces/:knowledgeSpaceId` operations to list, create, rename, and idempotently ensure an owned space's local binding. Creation SHALL accept only a display name. Rename SHALL accept only a display name. The ensure operation SHALL NOT create a caller-selected identity and SHALL return the same closed not-found response for an absent or other-owner identifier.

The existing bodyless `PUT /api/v1/me/knowledge-space` operation SHALL remain an idempotent compatibility path. It SHALL return and ensure the owner's oldest space, or create a space named `Personal` when none exists. Existing owners SHALL retain their pre-migration identifier as that space. Concurrent creation SHALL serialize on trusted owner state so the inventory cap cannot be exceeded.

Owner-to-space metadata SHALL be stored in tenant-owned PostgreSQL state with row-level security ENABLED and FORCED against the current authenticated user identity. Application queries SHALL retain explicit owner filters as defense-in-depth. The table MAY contain logical identifiers, owner identifiers, display metadata, and lifecycle timestamps but SHALL contain no Markdown content, content hash, derived index, host path, credential, cache, or checkout state.

#### Scenario: One owner creates two same-named spaces

- **WHEN** an authenticated owner creates two spaces with the same valid display name
- **THEN** the owner receives two distinct stable Knowledge Space identifiers
- **AND** both inventory entries retain the same display name

#### Scenario: Inventory cap is serialized

- **WHEN** concurrent creation requests would take one owner above 32 spaces
- **THEN** no more than 32 owner rows are committed
- **AND** every excess request returns the same bounded-capacity outcome

#### Scenario: Compatibility provisioning preserves identity

- **WHEN** an owner migrated from the single-space capability calls `PUT /api/v1/me/knowledge-space`
- **THEN** the response identifies the pre-migration Knowledge Space
- **AND** no replacement identity is allocated

#### Scenario: Caller cannot select creation identity or location

- **WHEN** a caller attempts to add an owner, resource identifier, directory name, source key, or path-shaped field to creation
- **THEN** closed request validation rejects it
- **AND** trusted code remains the only identity and location authority

#### Scenario: Other-owner ensure reveals nothing

- **WHEN** an authenticated caller attempts to ensure another owner's guessed Knowledge Space identifier
- **THEN** the request returns the same closed not-found response as an absent identifier
- **AND** no Knowledge Space row or directory is disclosed or mutated

#### Scenario: Missing identity fails closed

- **WHEN** Knowledge Space metadata is queried without a current authenticated tenant identity
- **THEN** no row is visible or mutable

#### Scenario: Two owners receive distinct spaces

- **WHEN** two authenticated owners create personal Knowledge Spaces
- **THEN** each receives a distinct stable Knowledge Space identifier
- **AND** each owner can resolve only their own rows under datastore enforcement

#### Scenario: Repeated creation is idempotent

- **WHEN** one owner repeats or concurrently races the singular compatibility create-or-get operation
- **THEN** every successful response identifies the same oldest Knowledge Space
- **AND** no replacement compatibility identity is allocated

#### Scenario: Caller cannot select identity or location

- **WHEN** a caller attempts to select an identity or location during creation
- **THEN** closed request validation rejects it
- **AND** trusted code remains the only identity and location authority

#### Scenario: Unauthenticated provisioning is refused

- **WHEN** a request without a valid session calls any inventory or provisioning endpoint
- **THEN** it receives the API's standard unauthorized response
- **AND** no Knowledge Space row or directory is created or changed

### Requirement: Provisioning allocates one safe child per space beneath the configured root

For each hosted binding, trusted code SHALL derive one direct child directory from the stable Knowledge Space identifier beneath the operator-configured Knowledge root. It SHALL canonicalize the root, require it to be an accessible directory, and prove the child resolves directly beneath that root. It SHALL NOT derive a child from a display name or owner identifier, scan for candidate directories, claim a caller-named directory, or fall back to Home, the process working directory, another owner's child, or remote storage.

Directory creation SHALL be idempotent. A retry MAY accept an existing real directory at the exact trusted child path but SHALL reject a symbolic link or non-directory. A database row created before a filesystem failure SHALL remain the recovery anchor so an authenticated ensure or compatibility retry repairs that same binding without minting another Knowledge Space. Only an owner row visible under RLS grants authority to a child directory; an unlinked directory alone grants none.

Provisioning SHALL NOT initialize Git, create commits, or require a repository. A safe empty directory is valid. Importing or claiming a pre-existing caller-selected directory is outside this capability.

#### Scenario: Two spaces receive independent children

- **WHEN** one owner creates two spaces under a valid writable Knowledge root
- **THEN** each stable identifier has its own direct real-directory child
- **AND** neither display name influences either child path

#### Scenario: Partial filesystem failure is repairable

- **WHEN** an owner row exists but its directory could not be created
- **THEN** provisioning returns a closed unavailable result without replacing the row
- **AND** an authenticated ensure retry targets the same stable-ID child

#### Scenario: Partial filesystem failure is retryable

- **WHEN** an owner row exists but its directory could not be created
- **THEN** provisioning returns a closed unavailable result without replacing the row
- **AND** a later authenticated ensure retries the same stable-ID child

#### Scenario: Existing symlink child is refused

- **WHEN** the derived stable-ID child exists as a symbolic link or non-directory
- **THEN** provisioning fails closed
- **AND** it does not follow, replace, or expose the entry

#### Scenario: Missing or unusable root is closed

- **WHEN** the Knowledge root is absent, missing, not a directory, or unusable by the provisioning process
- **THEN** provisioning returns `knowledge_space_unavailable`
- **AND** it does not create a child elsewhere

#### Scenario: Empty space is created without Git

- **WHEN** an owner creates a space under a valid writable Knowledge root
- **THEN** the exact stable-ID child exists as a real directory
- **AND** no Git repository, commit, ref, or note is created

### Requirement: Portable resource identity is separate from local ownership and binding

Each Knowledge Space identifier SHALL be globally stable and SHALL NOT encode or derive from a hosted user ID, display name, configured root, child path, provider locator, Git revision, or current installation. Hosted ownership rows, Chat bindings, and owner associations are authority-local, but a future personal Node replicating the same Knowledge Space SHALL retain its identifier unchanged rather than mint a replacement or require receipt migration. Distinct spaces SHALL remain distinct when names collide.

The configured root and resolved children SHALL remain private installation-local binding data. Retrieval attribution exposed outside the binding layer SHALL identify only the logical Knowledge Space, acceptance-time display name where applicable, Knowledge-relative path, and exact content hash. It MUST NOT expose hosted owner IDs, root or child paths, credentials, caches, worker identities, or raw filesystem diagnostics.

A future trusted runtime MAY bind the same Knowledge Space identifiers to different local directories without requiring hosted PostgreSQL ownership rows or path conventions to become portable state. A later multi-authority reference MAY qualify an unchanged identifier with governing-authority identity but SHALL NOT replace it. Import, synchronization, collision resolution across authorities, and shared ownership remain outside this capability.

#### Scenario: Different process roots preserve the logical space

- **WHEN** two conforming Run workers expose the same stable-ID children beneath different process-local roots
- **THEN** retrievals expose the same Knowledge Space identifiers and safe file attribution
- **AND** neither local root appears in tool results or persisted observations

#### Scenario: Moving a local binding preserves identity

- **WHEN** an operator relocates the root while preserving every stable-ID child and updates private configuration
- **THEN** every logical Knowledge Space identifier remains unchanged

#### Scenario: A personal Node retains resource identity

- **WHEN** a future personal Node imports or synchronizes multiple Knowledge Spaces
- **THEN** it retains each existing Knowledge Space identifier unchanged
- **AND** same-name spaces remain distinct while ownership and directory bindings remain node-local

### Requirement: Run workers resolve only the trusted bounded binding

Every process consuming the `runs` worker group SHALL be able to resolve every Knowledge Space directory its queue may execute beneath its configured root. Subset mounting without an execution-routing capability is not supported.

Resolution SHALL start from the trusted Run owner and Run identifiers, load that Run's immutable selected identifiers under tenant enforcement, and intersect them with the Chat's current binding and currently owned active Knowledge Space rows. It SHALL derive only the exact stable-ID children in that intersection. Model arguments MAY narrow the resolved set but SHALL NOT widen it. If a required root or child becomes unavailable or invalid at execution time, the operation SHALL fail closed without partial results and SHALL NOT fall back to another local or remote location. User- and model-visible errors SHALL omit root paths, child paths, raw filesystem exceptions, and other-owner existence signals.

#### Scenario: Worker lacks the owner's directory

- **WHEN** a multi-space operation reaches a selected space whose stable-ID child cannot be safely resolved
- **THEN** the entire operation returns `knowledge_space_unavailable`
- **AND** no partial result or alternate directory is returned

#### Scenario: Another owner's identifier cannot redirect resolution

- **WHEN** model or caller input contains another owner's guessed or observed Knowledge Space identifier
- **THEN** resolution remains inside the accepted Run's current authorized intersection
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Retry uses the same upper bound

- **WHEN** a Knowledge tool call is retried on another compatible worker
- **THEN** it begins from the same persisted Run identifiers and ordinals
- **AND** it reapplies current authorization before filesystem access

## ADDED Requirements

### Requirement: Chat bindings are explicit owner-authorized sets

An owner SHALL be able to atomically replace a Chat's ordered Knowledge Space set with zero through 32 unique identifiers through the authenticated Chat API and web UI. The API SHALL derive owner identity from the session, verify every submitted identifier under the same tenant transaction, and either replace the whole set or change nothing. Missing and other-owner identifiers SHALL produce the same closed response. An empty set SHALL be a persisted explicit opt-out, not a request to resolve all spaces dynamically.

A Chat SHALL distinguish an uninitialized binding from an initialized empty set and SHALL maintain a monotonically increasing binding revision. At the first accepted Run for an uninitialized Chat, the system SHALL atomically initialize the Chat to all of the owner's then-current spaces in deterministic creation order when at least one exists. If none exists, the Chat MAY remain uninitialized so a later first space can become its initial default. Once initialized, creating another Knowledge Space SHALL NOT silently attach it. A forked Chat SHALL copy its source Chat's current ordered set into an independent binding revision.

Chat reads SHALL expose only the selected Knowledge Space identifiers and display names, never owner IDs or local bindings. The web surface SHALL let the current owner list, create, and rename spaces and edit the current Chat's set. It SHALL NOT browse, upload, edit, delete, import, or synchronize Knowledge files.

#### Scenario: Existing Chat gets a deterministic initial set

- **WHEN** an uninitialized Chat owned by a user with multiple spaces accepts its first Run
- **THEN** the Chat is initialized once to all then-current owner spaces in creation order
- **AND** later space creation does not alter that set

#### Scenario: Owner explicitly disables Knowledge for a Chat

- **WHEN** the owner replaces a Chat's binding with an empty set
- **THEN** later Runs from that Chat remain explicitly unbound
- **AND** creating a new owner space does not re-enable Knowledge for the Chat

#### Scenario: Cross-tenant binding is rejected atomically

- **WHEN** a replacement set contains an absent or other-owner identifier
- **THEN** the request returns the same closed response for either case
- **AND** the prior Chat binding and revision remain unchanged

#### Scenario: Fork copies without future coupling

- **WHEN** a Chat with a non-empty binding is forked
- **THEN** the new Chat begins with the same ordered identifiers
- **AND** subsequent edits to either Chat do not mutate the other

### Requirement: Accepted Runs retain a bounded binding upper limit

Every accepted Run SHALL persist the Chat's resolved Knowledge binding atomically with the user message, model-context snapshot, Run, and `run.created` event. The snapshot SHALL contain the Chat binding revision and, for every selected space, its stable identifier, acceptance-time display name, and deterministic ordinal. It SHALL contain no owner ID in user-visible receipts, configured root, child path, credential, or alternate filesystem selector.

The accepted Run snapshot SHALL be immutable and SHALL define an upper limit rather than irrevocable access. A space attached to the Chat after acceptance SHALL not become visible to that Run. A space detached from the Chat or no longer owned or active before a tool executes SHALL be revoked for that and every subsequent execution attempt. Queue retry and worker handoff SHALL resolve from the same persisted Run snapshot and current authorization state, not from the owner's current inventory as a replacement default.

The bounded Run context and owner-visible receipt SHALL disclose the acceptance-time identifiers and display names as untrusted metadata so the model and owner can distinguish same-named spaces. Renaming a space after acceptance SHALL NOT rewrite an existing Run receipt.

#### Scenario: Later attachment does not widen an accepted Run

- **WHEN** a space is attached to a Chat after a Run was accepted
- **THEN** that Run cannot search or read the newly attached space
- **AND** a later accepted Run may include it

#### Scenario: Detachment revokes pending execution

- **WHEN** a selected space is detached after Run acceptance but before a Knowledge tool executes
- **THEN** execution fails closed for that space
- **AND** retry or worker handoff cannot restore the revoked access from the immutable snapshot alone

#### Scenario: Same-name spaces remain distinguishable

- **WHEN** two selected spaces share a display name
- **THEN** the Run receipt retains both distinct stable identifiers and ordinals
- **AND** neither space is merged or substituted based on its name

#### Scenario: Acceptance is atomic

- **WHEN** binding snapshot persistence fails during accepted-turn authoring
- **THEN** the user message, context snapshot, Run, and `run.created` event do not partially commit

## RENAMED Requirements

- FROM: `### Requirement: Each owner can self-service at most one personal Knowledge Space`
- TO: `### Requirement: Each owner can self-service a bounded inventory of personal Knowledge Spaces`
- FROM: `### Requirement: Provisioning allocates one safe child beneath the configured root`
- TO: `### Requirement: Provisioning allocates one safe child per space beneath the configured root`
- FROM: `### Requirement: Run workers resolve only the trusted owner binding`
- TO: `### Requirement: Run workers resolve only the trusted bounded binding`

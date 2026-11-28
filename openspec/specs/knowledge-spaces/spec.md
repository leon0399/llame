# knowledge-spaces

## Purpose

Defines self-service owner-scoped personal Knowledge Spaces, stable identity, trusted server-managed local directory binding, recovery behavior, portability boundaries, and tenant isolation.

## Requirements

### Requirement: An owner can manage multiple personal Knowledge Spaces

The system MUST expose owner-scoped Knowledge Space resources at `/api/v1/knowledge-spaces`. The owner identity MUST come only from the authenticated request. `POST /api/v1/knowledge-spaces` MUST accept only `{ "name": string }`. A successful create MUST return `201 Created` and a `Location` header. The create MUST allocate a new globally stable opaque identifier. `GET /api/v1/knowledge-spaces` MUST return a cursor-paginated owner inventory. `GET /api/v1/knowledge-spaces/:id` MUST return one owned resource, archived or active. `PATCH /api/v1/knowledge-spaces/:id` MUST accept a name, an archive flag, or both. An empty patch MUST leave the Space unchanged. A name that is not a string MUST return `400`. The capability MUST expose no `PUT` or `DELETE` operation.

Each representation MUST contain exactly `id`, `name`, `createdAt`, `updatedAt`, and `archivedAt`. The representation MUST NOT expose an owner identifier, root, child path, source locator, or content. `archivedAt` MUST be `null` while the Space is active. A name MUST be trimmed. A name MUST contain 1 through 100 Unicode code points. A name MUST NOT contain a control, format, line-separator, or paragraph-separator character. A name can duplicate another owned Space name. Stable identifiers MUST drive authorization, local binding, tool selection, and attribution. This iteration MUST NOT impose a per-owner Knowledge Space count cap.

The inventory MUST live in tenant-owned PostgreSQL. Row-level security MUST be enabled and forced for the current authenticated owner. Application queries MUST keep explicit owner predicates. A missing identifier and another owner's identifier MUST return the same `404` response.

A list request MUST accept an integer `limit` from 1 through 100. An omitted `limit` MUST default to 50. A list request can accept an optional opaque `after` cursor. The list MUST order rows by `(createdAt, id)`. The list MUST return `{ "items": [...], "nextCursor": string | null }`. The cursor MUST be validated base64url-encoded `createdAt` and `id` values. A malformed cursor or an out-of-range limit MUST return `400`. This iteration MUST NOT add a reusable pagination framework, signed cursors, total counts, or offset pagination.

An omitted archive filter MUST exclude archived Spaces. `archived=only` MUST return only archived Spaces. `archived=with` MUST return active and archived Spaces. An unknown archive filter MUST return `400`.

#### Scenario: One owner creates same-named spaces

- **WHEN** one authenticated owner creates two Knowledge Spaces with the same valid name
- **THEN** the system creates two distinct stable identifiers and two filesystem children
- **AND** each resource stays addressable by its own identifier

#### Scenario: Inventory has no artificial total cap

- **WHEN** an owner creates another valid Knowledge Space after many existing Spaces
- **THEN** the system does not refuse that create only for an owner count
- **AND** each list response stays inside its page bound

#### Scenario: Cursor ordering is deterministic

- **WHEN** owned Spaces share one `createdAt` and the client follows `nextCursor`
- **THEN** `(createdAt, id)` orders those Spaces with a stable tie-break
- **AND** the client reads the full inventory without offset pagination

#### Scenario: Malformed cursor fails closed

- **WHEN** an `after` cursor is not valid base64url or does not decode to `createdAt` and `id`
- **THEN** the API returns `400`
- **AND** the API does not use offset pagination or a partial cursor

#### Scenario: Caller cannot select owner or location

- **WHEN** a create or rename body adds an owner, identifier, path, or other extra field
- **THEN** request validation rejects the body
- **AND** only trusted code sets identity and location

#### Scenario: Another owner's item is indistinguishable from missing

- **WHEN** an authenticated caller reads, renames, or archives another owner's identifier
- **THEN** the API returns the same `404` as for an absent identifier
- **AND** the response discloses no existence or metadata

#### Scenario: Missing identity fails closed

- **WHEN** a query has no current authenticated tenant identity
- **THEN** no Knowledge Space row is visible or mutable

### Requirement: Archive keeps the Knowledge Space directory

An owner MUST be able to archive and unarchive an owned Knowledge Space. Archive MUST set `archivedAt` to the current time. Unarchive MUST set `archivedAt` to `null`. Archive and unarchive MUST NOT create, change, or delete a file under the Knowledge root. A rename of an archived Space MUST return `409` unless that request also unarchives it.

#### Scenario: Archive leaves the directory in place

- **WHEN** an owner archives a Knowledge Space that has a file in its child directory
- **THEN** `archivedAt` is set and that file stays in the stable-ID child
- **AND** the default list omits that Space

#### Scenario: Unarchive restores the working list

- **WHEN** an owner unarchives an archived Knowledge Space
- **THEN** `archivedAt` is `null`
- **AND** the default list includes that Space

#### Scenario: Rename of an archived Space is refused

- **WHEN** an owner renames an archived Knowledge Space
- **THEN** the API returns `409`
- **AND** the name and the child directory stay unchanged

### Requirement: Archived Spaces are not current Knowledge access

An archived Space MUST NOT count as a current Knowledge Space. Unscoped `knowledge_search` MUST skip every archived Space. An explicit `kb://` target for an archived Space MUST return `knowledge_space_not_found`. That result MUST match the result for an absent identifier.

#### Scenario: Search skips an archived Space

- **WHEN** an owner archives a Space and then runs unscoped `knowledge_search`
- **THEN** the search does not read that Space
- **AND** a direct `kb://` target for it returns `knowledge_space_not_found`

### Requirement: Provisioning allocates one safe child beneath the configured root

For each hosted resource, trusted code SHALL generate the stable Knowledge Space identifier and derive one direct child directory from it beneath the operator-configured Knowledge root. It SHALL canonicalize the root, require it to be an accessible directory, and prove the child resolves directly beneath that root. It SHALL NOT scan for candidate directories, claim a caller-named directory, or fall back to Home, the process working directory, a user-ID-derived location, another owner's child, or remote storage.

Provisioning SHALL create and validate the exact stable-ID child before inserting its owner row in a PostgreSQL transaction. A committed authority row SHALL therefore begin with a usable real directory. If directory creation fails, no authority row SHALL commit. If database insertion or commit fails after directory creation, the empty unauthoritative child MAY remain; recovery SHALL NOT delete or repurpose it. A later `POST` is a new non-idempotent creation attempt and MAY allocate a distinct resource.

Root resolution, child creation, or child validation failure SHALL return the existing safe `503 knowledge_space_unavailable` API response and SHALL expose no filesystem path or raw diagnostic. Database insertion or commit failure SHALL use the API's existing safe internal-error response, expose no database or filesystem diagnostic, and leave any created child unauthoritative. Successful item and list operations SHALL use their declared `2xx` responses; malformed input SHALL return `400`, missing or other-owner items SHALL return the same `404`, and missing authentication SHALL return `401`.

Only an owner row visible under RLS grants authority to a child directory; an unlinked directory alone grants none. Provisioning SHALL NOT initialize Git, create commits, or require a repository. A safe empty directory is valid. Importing or claiming a pre-existing caller-selected directory is outside this capability.

#### Scenario: Empty space is created without Git

- **WHEN** an owner creates a space under a valid writable Knowledge root
- **THEN** the exact stable-ID child exists as a real directory before the authority row commits
- **AND** no Git repository, commit, ref, or note is created

#### Scenario: Partial filesystem failure is retryable

- **WHEN** creating or validating the generated child fails before the owner row is inserted
- **THEN** provisioning returns a closed unavailable result and commits no authority row
- **AND** a later `POST` may make a new creation attempt without deleting the failed entry

#### Scenario: Database failure leaves no authority

- **WHEN** database insertion or commit fails after the stable-ID child was created
- **THEN** no owner row grants access to that child
- **AND** recovery does not delete the child or treat it as an existing resource

#### Scenario: Existing symlink child is refused

- **WHEN** the derived stable-ID child exists as a symbolic link or non-directory
- **THEN** provisioning fails closed
- **AND** it does not follow, replace, or expose the entry

#### Scenario: Missing or unusable root is closed

- **WHEN** the Knowledge root is absent, missing, not a directory, or unusable by the provisioning process
- **THEN** provisioning returns `knowledge_space_unavailable`
- **AND** it does not create a child elsewhere

### Requirement: Portable resource identity is separate from local ownership and binding

Each Knowledge Space identifier SHALL be globally stable and SHALL NOT encode or derive from a hosted user ID, display name, configured root, child path, provider locator, Git revision, or current installation. Hosted ownership rows and owner associations are authority-local, but a future personal Node replicating a Knowledge Space SHALL retain its identifier unchanged rather than mint a replacement or require receipt migration.

Configured roots and resolved children SHALL remain private installation-local binding data. Newly authored retrieval attribution exposed outside the binding layer SHALL identify only the logical Knowledge Space, its response-time display name, Knowledge-relative path, and safe operation-specific navigation fields such as live line coordinates and excerpts. It MUST NOT expose hosted owner IDs, root or child paths, credentials, caches, worker identities, raw filesystem diagnostics, or imply that current live-file coordinates are revision-stable. Historical persisted observations MAY retain the exact content hashes recorded by the earlier contract and SHALL remain immutable.

A future trusted runtime MAY bind the same Knowledge Space identifier to a different local directory without requiring the hosted PostgreSQL ownership row or path convention to become portable state. A later multi-authority reference MAY qualify the unchanged identifier with governing-authority identity but SHALL NOT replace it.

#### Scenario: Different process roots preserve the logical space

- **WHEN** two conforming Run workers expose the same stable-ID child beneath different process-local roots
- **THEN** retrievals expose the same Knowledge Space identifier and safe operation-specific file attribution
- **AND** neither local root appears in tool results or persisted observations

#### Scenario: Moving a local binding preserves identity

- **WHEN** an operator relocates the root while preserving the stable-ID child and updates private configuration
- **THEN** the logical Knowledge Space identifier remains unchanged

#### Scenario: A personal Node retains resource identity

- **WHEN** a future personal Node imports or synchronizes the same Knowledge Space
- **THEN** it retains the existing Knowledge Space identifier unchanged
- **AND** its local ownership representation and directory binding remain node-local

#### Scenario: Live coordinates do not become portable identity

- **WHEN** a new Knowledge result records a path and live line range without a content hash
- **THEN** the range remains response-time navigation metadata rather than part of the Knowledge Space identity
- **AND** moving or rebinding the space does not require rewriting its stable identifier

### Requirement: Run workers resolve only the trusted owner binding

Every process consuming the `runs` worker group SHALL be able to resolve every current owner resource its queue may execute beneath its configured root. Subset mounting without an execution-routing capability is not supported.

Resolution SHALL start from the trusted Run owner identity. At each tool invocation, datastore access SHALL run under that owner with RLS and an explicit owner predicate. Explicit selectors SHALL resolve only an owned row; an omitted search selector SHALL enumerate the owner's current rows. Before opening each targeted stable-ID child, execution SHALL confirm that the row is still currently accessible. Access removed before that check SHALL be rejected; access removed after that check need not cancel the already-open operation, and the next target or tool call SHALL observe the new state.

If the root or child becomes unavailable or invalid at execution time, the capability SHALL return the applicable closed Knowledge result and MUST NOT fall back to another local or remote location. User- and model-visible errors SHALL omit root paths, child paths, raw filesystem exceptions, and other-owner existence signals.

#### Scenario: Worker lacks the owner's directory

- **WHEN** a Run executes on a worker that cannot safely resolve one currently selected stable-ID child
- **THEN** the Knowledge operation records `knowledge_space_unavailable` for that target
- **AND** no other directory is substituted

#### Scenario: Another owner's identifier cannot redirect resolution

- **WHEN** model or caller input contains another owner's guessed or observed Knowledge Space identifier
- **THEN** owner-scoped resolution returns the same closed not-found result as for an absent identifier
- **AND** no data or existence signal from the other owner is returned

#### Scenario: A later call observes a new space

- **WHEN** an owner gains a Knowledge Space after a Run started
- **THEN** a later unscoped search in that Run may include the new current resource

#### Scenario: A later call rejects removed access

- **WHEN** an owner loses access after an earlier successful tool call
- **THEN** the next tool call or not-yet-opened target rejects that resource under the current owner check

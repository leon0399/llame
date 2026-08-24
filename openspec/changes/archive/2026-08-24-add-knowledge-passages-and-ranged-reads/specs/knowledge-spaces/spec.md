## MODIFIED Requirements

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

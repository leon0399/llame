## ADDED Requirements

### Requirement: Knowledge tools derive filesystem authority from trusted worker and Run context

The system SHALL register `knowledge_search` as a code-owned `read_only` tool; Knowledge file reads, edits, and writes are the `kb://` locator of the native file tools. Its executor SHALL receive the trusted Run owner identity and resolve current owner resources under tenant enforcement at each tool invocation. Model arguments MAY contain a Knowledge Space identifier only where the tool contract permits selection; they SHALL contain no owner ID, configured root, child directory, source key, host path, or alternate resource locator.

Changing a tool path, query, guessed identifier, or persisted argument SHALL NOT widen current owner access. A guessed, absent, removed, or other-owner explicit identifier SHALL return the same closed `knowledge_space_not_found` result even when the owner has no current spaces. An unscoped search by an owner with no current spaces SHALL receive `knowledge_space_not_configured`. Neither result SHALL reveal whether another owner, row, or directory exists.

At worker attempt preparation, `knowledge_search` eligibility SHALL depend on its trusted code-owned declaration, `read_only` classification, exact operator allowlist entry, and process configuration—not on owner inventory. With a configured `knowledge.root`, an otherwise-eligible `knowledge_search` SHALL remain advertised when the owner currently has zero spaces; a later call SHALL signal `knowledge_space_not_configured` to the model. When `knowledge.root` is absent from the executing worker process, the existing closed `knowledge_space_unavailable` runtime availability state SHALL apply without probing the filesystem during API acceptance. The same configured root SHALL make the native `read`, `edit`, and `write` tools eligible for `kb://` locators as defined by `native-file-tools`.

At worker execution, the static tool executor SHALL receive the Knowledge filesystem resolver and process-local configuration only through trusted dependency injection or trusted tool context. It SHALL resolve current authority through the Run owner inside a tenant transaction and SHALL never accept owner identity, roots, or local binding data from model arguments or the availability comparison record.

#### Scenario: Model cannot select another owner's space

- **WHEN** a model supplies an identifier derived from another owner's resource
- **THEN** current owner-scoped resolution returns `knowledge_space_not_found`
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Owner has no space at attempt preparation

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no Knowledge Space row
- **THEN** the tool remains callable when its declaration, allowlist entry, and root configuration permit it
- **AND** invoking it returns `knowledge_space_not_configured`

#### Scenario: Executing worker has no Knowledge root

- **WHEN** the turn-authoring API process has no configured Knowledge root
- **THEN** the immutable availability manifest marks each otherwise-eligible Knowledge tool unavailable with `knowledge_space_unavailable`
- **AND** no filesystem probe or private path enters the request path

#### Scenario: A new resource is visible within an existing Run

- **WHEN** the owner gains a Knowledge Space after the attempt was prepared
- **THEN** a later Knowledge tool invocation resolves the new current inventory
- **AND** no Run or Chat binding must be updated

#### Scenario: Revoked access fails on the next check

- **WHEN** the owner loses access after one successful Knowledge call
- **THEN** the next call or not-yet-opened search target rejects the resource
- **AND** previously persisted results remain historical observations

## REMOVED Requirements

### Requirement: Knowledge tools derive filesystem authority only from trusted Run context

**Reason**: Replaced by `Knowledge tools derive filesystem authority from trusted worker and Run context`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.

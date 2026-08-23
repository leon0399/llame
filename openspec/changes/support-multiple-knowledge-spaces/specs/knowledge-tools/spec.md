## MODIFIED Requirements

### Requirement: Knowledge tools derive filesystem authority only from trusted Run context

The system SHALL register `knowledge_search` and `knowledge_read` as code-owned `read_only` tools. Their executors SHALL receive the trusted Run owner and Run identifiers, resolve that Run's bounded Knowledge Space set under tenant enforcement, and revalidate its intersection with the Chat's current binding and current owner inventory. Model arguments MAY select one identifier already in that intersection but SHALL contain no owner ID, configured root, child directory, source key, host path, or alternate resource locator.

Changing a tool path, query, guessed resource identifier, or persisted argument SHALL NOT widen the accepted Run set. A guessed, absent, detached, inactive, or other-owner identifier SHALL return the same closed `knowledge_space_not_found` result. An owner with no provisioned space SHALL receive `knowledge_space_not_configured`; an initialized Chat or accepted Run with no selected spaces SHALL receive `knowledge_space_not_bound`. Neither result SHALL reveal whether another owner or directory exists.

At Run acceptance, an owner-aware code-owned candidate resolver SHALL execute inside the accepted-turn tenant transaction. It SHALL initialize an uninitialized Chat when applicable, persist the resolved set into the Run snapshot, and bind each otherwise-eligible Knowledge tool as unavailable with `knowledge_space_not_configured` when the owner inventory is empty, `knowledge_space_not_bound` when the initialized selected set is empty, or `knowledge_space_unavailable` when `knowledge.root` is absent from that authoring API process. A configured root SHALL be sufficient at acceptance; the request path SHALL NOT probe the filesystem.

At worker execution, the static tool executor SHALL receive the Knowledge filesystem resolver and process-local configuration only through trusted dependency injection or trusted tool context, never through model arguments or persisted declarations. Execution SHALL revalidate every targeted worker-local stable-ID child and return `knowledge_space_unavailable` if any targeted binding cannot be safely read.

#### Scenario: Model cannot widen the accepted set

- **WHEN** a model supplies an identifier absent from the Run's current authorized intersection
- **THEN** resolution returns `knowledge_space_not_found`
- **AND** no data or existence signal outside the intersection is returned

#### Scenario: Chat has an explicit empty set

- **WHEN** an otherwise-eligible Knowledge tool is considered for an accepted Run whose Chat explicitly selected no spaces
- **THEN** the immutable availability manifest marks it unavailable with `knowledge_space_not_bound`
- **AND** it is not advertised as callable

#### Scenario: Owner has no inventory at acceptance

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no Knowledge Space
- **THEN** the immutable availability manifest marks it unavailable with `knowledge_space_not_configured`
- **AND** it is not advertised as callable

#### Scenario: Authoring API has no Knowledge root

- **WHEN** a non-empty bounded set exists but the turn-authoring API process has no configured Knowledge root
- **THEN** the immutable availability manifest marks each otherwise-eligible Knowledge tool unavailable with `knowledge_space_unavailable`
- **AND** no filesystem probe or private path enters the request path

#### Scenario: Model cannot select another owner's space

- **WHEN** a model supplies path- or identifier-shaped values derived from another owner's resource
- **THEN** resolution still remains inside the accepted Run's current authorized intersection
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Owner has no space at acceptance

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no Knowledge Space row
- **THEN** the immutable availability manifest marks it unavailable with `knowledge_space_not_configured`
- **AND** it is not advertised as callable

### Requirement: Knowledge search scans one or all bound spaces deterministically within global bounds

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points, an integer result limit from 1 through 10 defaulting to 5, and an optional Knowledge Space identifier. When the identifier is present, search SHALL target only that currently authorized member of the Run snapshot. When absent, search SHALL target the Run's complete current authorized intersection in persisted ordinal order. It SHALL NOT substitute the owner's current inventory or a dynamically widened Chat set.

Search SHALL perform a case-insensitive literal scan over safe UTF-8 Markdown files as they are read from the live targeted spaces, return at most one result per file, and include the first matching line with a surrounding snippet of at most 500 Unicode code points. Within each space, files SHALL be ordered by Knowledge-relative path; cross-space traversal and results SHALL be ordered by persisted space ordinal and then path. A Markdown path is one whose final component ends with `.md`, compared ASCII case-insensitively.

One tool call SHALL share the existing global bounds across all targeted spaces: at most 20,000 filesystem entries, 5,000 admitted Markdown files, 1 MiB per file, 32 MiB of aggregate Markdown content, paths of 1,024 UTF-8 bytes and 32 components, the requested result limit, and a complete structured result of at most 15,000 JavaScript UTF-16 code units. It SHALL also obey the common tool timeout and abort signal. Space boundaries SHALL NOT reset any operation limit.

Every returned match SHALL carry the Knowledge Space identifier, its acceptance-time display name, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact file bytes used for that match. An empty successful result SHALL identify every searched space by identifier and acceptance-time name. If authorization changes, traversal, corpus, file, path, timeout, output work, or any targeted binding prevents a complete search, the operation SHALL return the applicable closed error and SHALL NOT return partial results. An admitted Markdown file that is not valid UTF-8 SHALL return `knowledge_content_invalid` rather than be silently omitted. Search SHALL use no index or PostgreSQL content projection.

There is no operation-wide content revision or snapshot. A file changed after it was inspected does not rewrite the recorded result, while another file inspected later may reflect its newer bytes.

#### Scenario: Omitted selector searches the bounded set

- **WHEN** a Run has two currently authorized spaces and search omits the selector
- **THEN** both spaces are traversed in persisted ordinal order under one operation budget
- **AND** each match identifies its stable space and acceptance-time name

#### Scenario: Selector narrows to one bound space

- **WHEN** search supplies the identifier of one currently authorized Run-bound space
- **THEN** only that stable-ID child is traversed
- **AND** the operation does not inspect another selected space

#### Scenario: Newly attached space is excluded

- **WHEN** a space is attached to the Chat after Run acceptance
- **THEN** an omitted search selector does not traverse that space
- **AND** selecting its identifier returns the closed not-found result

#### Scenario: Aggregate bound is exceeded across spaces

- **WHEN** completing a multi-space search would exceed a shared entry, file-count, individual-file, aggregate-byte, path, or output bound
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** it returns no partial matches

#### Scenario: Search finds a live note

- **WHEN** one targeted Knowledge Space contains a bounded UTF-8 Markdown file with the literal query
- **THEN** search returns that file's space identity, acceptance-time name, relative path, first matching line, bounded snippet, and exact-byte hash

#### Scenario: Newly changed file is immediately visible

- **WHEN** a Markdown file is created or modified without a Git commit
- **THEN** a later search observes its current bytes
- **AND** the result hash identifies those bytes

#### Scenario: Corpus bound is exceeded

- **WHEN** completing a search would exceed any global traversal, content, path, timeout, result, or output bound
- **THEN** the tool returns the applicable closed limit or cancellation outcome
- **AND** it returns no partial matches

### Requirement: Knowledge read returns one safe live Markdown file from one bound space

`knowledge_read` SHALL accept exactly one Knowledge-relative Markdown path whose final component ends with `.md`, compared ASCII case-insensitively, and an optional Knowledge Space identifier. When the identifier is present, it SHALL target only that currently authorized member of the Run snapshot. For compatibility, omission SHALL target the sole currently authorized member only when exactly one exists; when multiple exist it SHALL return `knowledge_space_selection_required`, and when none exists it SHALL return the applicable closed availability outcome.

The tool SHALL read the complete current bytes from one safely resolved regular file when its size is at most 64 KiB, validate UTF-8, and return the complete text only when the structured success value serializes to at most 15,000 JavaScript UTF-16 code units. The path SHALL be matched case-sensitively against live directory entries. The tool SHALL reject absolute paths, empty components, `.` or `..` components, backslashes, NUL or control characters, paths above 1,024 UTF-8 bytes or 32 components, and non-Markdown suffixes. It SHALL reject every symbolic-link component or entry and SHALL NOT follow a link even when its target remains inside the Knowledge Space.

Every success SHALL include the Knowledge Space identifier, its acceptance-time display name, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact bytes returned. Invalid or non-admitted paths and inaccessible selectors SHALL return a closed `knowledge_path_invalid`, `knowledge_not_found`, `knowledge_space_not_found`, `knowledge_content_invalid`, or `knowledge_limit_exceeded` result without revealing the configured root or whether a rejected host path or other-owner resource exists.

#### Scenario: Explicit selector reads one same-named space

- **WHEN** two Run-bound spaces have the same display name and read supplies one stable identifier
- **THEN** only that space's exact stable-ID child is resolved
- **AND** the result includes the selected identifier and acceptance-time name

#### Scenario: Ambiguous compatibility read fails closed

- **WHEN** a read omits the selector while multiple spaces remain currently authorized
- **THEN** the tool returns `knowledge_space_selection_required`
- **AND** no candidate file is probed

#### Scenario: Single-space compatibility read succeeds

- **WHEN** a read omits the selector while exactly one space remains currently authorized
- **THEN** that space is selected without changing the Run snapshot
- **AND** the result contains its identifier, acceptance-time name, path, hash, and complete content

#### Scenario: Traversal and absolute paths fail

- **WHEN** a requested path is absolute or contains a dot, dot-dot, empty, backslash, or control-character component
- **THEN** the tool returns `knowledge_path_invalid`
- **AND** no host path outside a trusted stable-ID child is read

#### Scenario: Symbolic link is not followed

- **WHEN** any path component or Markdown-named entry is a symbolic link
- **THEN** read refuses it
- **AND** target content is not returned

#### Scenario: Read returns current Markdown

- **WHEN** the selected Knowledge Space contains an admitted live Markdown path
- **THEN** the tool returns its complete current content, acceptance-time space identity and name, exact relative path, and exact-byte hash

#### Scenario: Oversized note or result fails whole read

- **WHEN** the Markdown file exceeds 64 KiB or its complete structured result would exceed 15,000 UTF-16 code units
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** no prefix is returned as if it were complete

### Requirement: Retrieval persists safe response-time attribution

Every successful search match and read result SHALL include the logical Knowledge Space identifier, acceptance-time display name, exact Knowledge-relative path, and SHA-256 content hash. Search SHALL additionally identify the matching line and snippet, and an empty search SHALL identify the complete searched set. These fields describe the exact bytes and bounded Run identity used by that result; they SHALL NOT claim that a path, display name, binding, or content remains unchanged or permanently replayable.

The fields SHALL remain complete in the persisted tool-result part, live event stream, and browser reconstruction because Knowledge success results preflight below the live-result cap. Later model replay MAY clear payload detail or omit the complete call/result pair under the tool-calling capability's existing pair and turn/ledger budgets; it SHALL retain the structured outcome or bounded omission state honestly rather than present an incomplete payload as complete.

The persisted observation SHALL include the bounded snippet or returned Markdown in the existing PostgreSQL-backed Run-event and assistant-message-part stores and SHALL follow their existing Run and Chat retention and deletion lifecycle. This execution history SHALL NOT become a canonical Knowledge content projection, index, source store, or alternate read authority. The system SHALL add no separate Knowledge-content persistence; every later retrieval SHALL read the live files again.

Attribution SHALL exclude configured roots, resolved child paths, hosted owner IDs, credentials, worker identity, and raw filesystem diagnostics. The structured tool-result UI SHALL visibly present the acceptance-time display name, stable identifier, and Knowledge-relative path so same-name spaces remain distinguishable. The packaged tool description SHALL instruct the model to cite the space and path of a note it uses; the system SHALL NOT post-process arbitrary provider text to fabricate a citation.

#### Scenario: Browser reload retains multi-space attribution

- **WHEN** a Chat uses successful results from two Knowledge Spaces and the browser reloads
- **THEN** each reconstructed result retains the space identifier, acceptance-time name, path, and content hash recorded at execution

#### Scenario: Later rename does not alter history

- **WHEN** a space or file changes after a successful tool result was persisted
- **THEN** the persisted result retains its original space name, path, hash, snippet or content
- **AND** a later Run or tool call may expose the newer metadata or bytes

#### Scenario: Browser Chat exposes an unambiguous citation

- **WHEN** a browser Chat finds and uses a live note from one of multiple spaces
- **THEN** the structured tool result visibly cites the space identity and Knowledge-relative path
- **AND** the tool description directs the model to cite both in its answer
- **AND** it exposes no configured root or resolved host path

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a successful Knowledge result and the browser reloads
- **THEN** the reconstructed result retains the same space identifier, acceptance-time name, path, and content hash recorded at execution

#### Scenario: Later file change does not alter history

- **WHEN** a file changes after a successful tool result was persisted
- **THEN** the persisted result retains its original space identity, name, path, hash, snippet or content
- **AND** a later tool call may return different metadata, hash, or bytes

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note from one of multiple spaces
- **THEN** the structured result visibly cites the space identity and Knowledge-relative path
- **AND** the tool description directs the model to cite both in its answer
- **AND** it exposes no configured root or resolved host path

## RENAMED Requirements

- FROM: `### Requirement: Knowledge search scans live Markdown deterministically within bounds`
- TO: `### Requirement: Knowledge search scans one or all bound spaces deterministically within global bounds`
- FROM: `### Requirement: Knowledge read returns one safe live Markdown file`
- TO: `### Requirement: Knowledge read returns one safe live Markdown file from one bound space`

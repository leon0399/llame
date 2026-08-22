## Purpose

Defines bounded read-only tools that let the model search and read the current owner's live Markdown Knowledge Space with safe response-time path and content-hash attribution.

## ADDED Requirements

### Requirement: Knowledge tools derive filesystem authority only from trusted Run context

The system SHALL register `knowledge_search` and `knowledge_read` as code-owned `read_only` tools. Their executors SHALL resolve the sole Knowledge Space through the trusted Run owner's identity and tenant-scoped linkage; model arguments SHALL contain no owner ID, Knowledge Space ID, configured root, child directory, source key, host path, or alternate resource locator.

Changing a tool path, query, guessed resource identifier, or persisted argument SHALL NOT change which owner's linkage is resolved. An owner with no provisioned space SHALL receive only the closed `knowledge_space_not_configured` availability state, or the same closed result if stale accepted execution reaches the executor, without learning whether another owner or directory exists.

At Run acceptance, an owner-aware code-owned candidate resolver SHALL execute inside the existing tenant transaction, resolve the owner row under RLS, and bind each otherwise-eligible Knowledge tool as unavailable with `knowledge_space_not_configured` when no row exists, or `knowledge_space_unavailable` when `knowledge.root` is absent from that authoring API process. A configured root SHALL be sufficient at acceptance; the request path SHALL NOT probe the filesystem.

At worker execution, the static tool executor SHALL receive the Knowledge filesystem resolver and process-local configuration only through trusted dependency injection or trusted tool context, never through model arguments or persisted declarations. Execution SHALL revalidate the worker-local root and stable-ID child and return `knowledge_space_unavailable` if either cannot be safely read.

#### Scenario: Model cannot select another owner's space

- **WHEN** a model supplies path- or identifier-shaped values derived from another owner's resource
- **THEN** resolution still uses only the accepted Run owner's linkage
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Owner has no space at acceptance

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no Knowledge Space row
- **THEN** the immutable availability manifest marks it unavailable with `knowledge_space_not_configured`
- **AND** it is not advertised as callable

#### Scenario: Authoring API has no Knowledge root

- **WHEN** an owner row exists but the turn-authoring API process has no configured Knowledge root
- **THEN** the immutable availability manifest marks each otherwise-eligible Knowledge tool unavailable with `knowledge_space_unavailable`
- **AND** no filesystem probe or private path enters the request path

### Requirement: Knowledge search scans live Markdown deterministically within bounds

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points and an integer result limit from 1 through 10, defaulting to 5. It SHALL perform a case-insensitive literal search over safe UTF-8 Markdown files as they are read from the live Knowledge Space, return at most one result per file ordered by Knowledge-relative path, and include the first matching line with a surrounding snippet of at most 500 Unicode code points. A Markdown path is one whose final component ends with `.md`, compared ASCII case-insensitively.

One search SHALL enumerate at most 20,000 filesystem entries, admit at most 5,000 Markdown files, read no individual file larger than 1 MiB, inspect at most 32 MiB of aggregate Markdown content, and admit no path exceeding 1,024 UTF-8 bytes or 32 components. Its complete structured success result SHALL serialize to at most 15,000 JavaScript UTF-16 code units, below the tool loop's existing 16,000-unit truncation cap. It SHALL also obey the common tool timeout and abort signal.

Every returned match SHALL carry the Knowledge Space identifier, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact file bytes used for that match. An empty successful result SHALL still identify the Knowledge Space. If traversal, corpus, file, path, timeout, or output work exceeds a bound, the operation SHALL return `knowledge_limit_exceeded` or the existing timeout/cancellation outcome and SHALL NOT return partial search results that could be mistaken for complete. An admitted Markdown file that is not valid UTF-8 SHALL return `knowledge_content_invalid` rather than be silently omitted. Search SHALL use no index or PostgreSQL content projection.

There is no operation-wide revision or snapshot. A file changed after it was inspected does not rewrite the recorded result, while another file inspected later may reflect its newer bytes.

#### Scenario: Search finds a live note

- **WHEN** the owner's current Knowledge Space contains a bounded UTF-8 Markdown file with the literal query
- **THEN** search returns that file's Knowledge-relative path, first matching line, bounded snippet, Knowledge Space identifier, and hash of the bytes searched

#### Scenario: Newly changed file is immediately visible

- **WHEN** a Markdown file is created or modified without a Git commit
- **THEN** a later search observes its current bytes
- **AND** the result hash identifies those bytes

#### Scenario: Corpus bound is exceeded

- **WHEN** completing a search would exceed an entry, file-count, individual-file, aggregate-byte, path, or output bound
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** it returns no partial matches

### Requirement: Knowledge read returns one safe live Markdown file

`knowledge_read` SHALL accept exactly one Knowledge-relative Markdown path whose final component ends with `.md`, compared ASCII case-insensitively. It SHALL read the complete current bytes from one safely resolved regular file when its size is at most 64 KiB, validate UTF-8, and return the complete text only when the structured success value serializes to at most 15,000 JavaScript UTF-16 code units.

The path SHALL be matched case-sensitively against live directory entries. The tool SHALL reject absolute paths, empty components, `.` or `..` components, backslashes, NUL or control characters, paths above 1,024 UTF-8 bytes or 32 components, and non-Markdown suffixes. It SHALL reject every symbolic-link component or entry and SHALL NOT follow a link even when its target remains inside the Knowledge Space.

Every success SHALL include the Knowledge Space identifier, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact bytes returned. Invalid or non-admitted paths SHALL return a closed `knowledge_path_invalid`, `knowledge_not_found`, `knowledge_content_invalid`, or `knowledge_limit_exceeded` result without revealing the configured root or whether a rejected host path exists.

#### Scenario: Read returns current Markdown

- **WHEN** the owner requests an admitted Markdown path present in their live Knowledge Space
- **THEN** the tool returns its complete current content, Knowledge Space identifier, exact Knowledge-relative path, and hash of the returned bytes

#### Scenario: Traversal and absolute paths fail

- **WHEN** a requested path is absolute or contains a dot, dot-dot, empty, backslash, or control-character component
- **THEN** the tool returns `knowledge_path_invalid`
- **AND** no host path outside the trusted stable-ID child is read

#### Scenario: Symbolic link is not followed

- **WHEN** any path component or Markdown-named entry is a symbolic link
- **THEN** read refuses it
- **AND** target content is not returned

#### Scenario: Oversized note or result fails whole read

- **WHEN** the Markdown file exceeds 64 KiB or its complete structured result would exceed 15,000 UTF-16 code units
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** no prefix is returned as if it were complete

### Requirement: Retrieval persists safe response-time attribution

Every successful search match and read result SHALL include the logical Knowledge Space identifier, exact Knowledge-relative path, and SHA-256 content hash. Search SHALL additionally identify the matching line and snippet. These fields describe the exact bytes used by that result; they SHALL NOT claim that the same path remains unchanged or permanently replayable.

The fields SHALL remain complete in the persisted tool-result part, live event stream, and browser reconstruction because Knowledge success results preflight below the live-result cap. Later model replay MAY clear payload detail or omit the complete call/result pair under the tool-calling capability's existing pair and turn/ledger budgets; it SHALL retain the structured outcome or bounded omission state honestly rather than present an incomplete payload as complete.

Attribution SHALL exclude configured roots, resolved child paths, hosted owner IDs, credentials, worker identity, and raw filesystem diagnostics. The structured tool-result UI SHALL visibly present the Knowledge-relative path as a citation without exposing local binding details. The packaged tool description SHALL instruct the model to cite the path of a note it uses; the system SHALL NOT post-process arbitrary provider text to fabricate a citation.

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a successful Knowledge result and the browser reloads
- **THEN** the reconstructed result retains the same Knowledge Space identifier, path, and content hash recorded at execution

#### Scenario: Later file change does not alter history

- **WHEN** a file changes after a successful tool result was persisted
- **THEN** the persisted result retains its original path, hash, snippet or content
- **AND** a later tool call may return a different hash and bytes for the same path

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note to answer
- **THEN** the structured tool result visibly cites that note's Knowledge-relative path
- **AND** the tool description directs the model to cite the same path in its answer
- **AND** it exposes no configured root or resolved host path

### Requirement: Knowledge content is untrusted and potentially stale

Knowledge tool declarations and model-visible results SHALL identify filesystem content as owner-maintained, untrusted context that may be stale. The tools SHALL NOT grant instructions inside notes authority over the system prompt, tool permissions, owner linkage, configured root, or execution environment. The model-facing contract SHALL direct materially volatile claims to appropriate external verification when those tools are available.

#### Scenario: Note attempts to widen authority

- **WHEN** a note instructs the model to select another directory, enable a tool, reveal a host path, or override system policy
- **THEN** no tool availability, linkage, or execution scope changes

#### Scenario: Note contains a volatile claim

- **WHEN** a retrieved note contains a claim whose current truth materially affects the answer
- **THEN** the model-facing contract identifies the note as potentially stale and directs external verification rather than treating filesystem presence as proof

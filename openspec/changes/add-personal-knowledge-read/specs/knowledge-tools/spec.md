## Purpose

Defines bounded read-only tools that let the model search and read the current owner's accepted Markdown Knowledge Space with durable revision and path provenance.

## ADDED Requirements

### Requirement: Knowledge tools derive repository authority only from trusted Run context

The system SHALL register `knowledge_search` and `knowledge_read` as code-owned `read_only` tools. Their executors SHALL resolve the sole Knowledge Space through the trusted Run owner's identity and tenant-scoped linkage; model arguments SHALL contain no owner ID, Knowledge Space ID, source key, accepted ref, host path, remote, credential, or alternate repository locator.

Changing a tool path, query, guessed resource identifier, or persisted argument SHALL NOT change which owner's linkage is resolved. An owner with no provisioned space SHALL receive only the closed `knowledge_space_not_configured` availability state, or the same closed result if a stale accepted execution reaches the executor, without learning whether another owner or source exists.

At Run acceptance, the API SHALL resolve the owner linkage under RLS and bind each otherwise-eligible Knowledge tool as unavailable with `knowledge_space_not_configured` when no linkage exists, or `knowledge_source_unavailable` when the linked logical source key is absent from that authoring API process's configuration. A declared source key SHALL be sufficient at acceptance; the request path SHALL NOT probe the repository filesystem. Execution SHALL revalidate the worker-local binding and return `knowledge_source_unavailable` if it cannot be resolved or read.

Every turn-authoring API process SHALL declare the same complete logical source-key set, including an HTTP-only process that consumes no `runs` jobs. Only processes that consume the `runs` group SHALL require Git and accessible repository mounts for that full set.

#### Scenario: Model cannot select another owner's repository

- **WHEN** a model supplies path- or identifier-shaped values derived from another owner's resource
- **THEN** resolution still uses only the accepted Run owner's linkage
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Owner has no linked space at acceptance

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no provisioned Knowledge Space
- **THEN** the immutable availability manifest marks it unavailable with `knowledge_space_not_configured`
- **AND** it is not advertised as callable

#### Scenario: Authoring API lacks the linked logical source

- **WHEN** an owner linkage exists but the turn-authoring API process does not declare its source key
- **THEN** the immutable availability manifest marks each otherwise-eligible Knowledge tool unavailable with `knowledge_source_unavailable`
- **AND** no filesystem probe or private source detail enters the request path

### Requirement: Knowledge search is literal, deterministic, and bounded

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points and an integer result limit from 1 through 10, defaulting to 5. It SHALL perform a case-insensitive literal search over safe UTF-8 Markdown contents in one accepted commit, return at most one result per file ordered by repository-relative path, and include the first matching line with a surrounding snippet of at most 500 Unicode code points. A Markdown path is one whose final component ends with `.md`, compared ASCII case-insensitively.

One search SHALL enumerate at most 20,000 total tree entries, admit at most 5,000 Markdown blobs, read no individual blob larger than 1 MiB, inspect at most 32 MiB of aggregate Markdown content, and admit no path exceeding 1,024 UTF-8 bytes or 32 components. Its complete structured success result SHALL serialize to at most 15,000 JavaScript UTF-16 code units, below the tool loop's existing 16,000-unit truncation cap. It SHALL also obey the common tool timeout and abort signal.

Every successful search response, including an empty result set, SHALL carry the Knowledge Space identifier and accepted commit OID. If the tree, corpus, file, path, timeout, or output work exceeds a bound, the operation SHALL return `knowledge_limit_exceeded` or the existing timeout/cancellation outcome and SHALL NOT return partial search results that could be mistaken for complete results. Encountering an admitted Markdown blob that is not valid UTF-8 SHALL return `knowledge_content_invalid` rather than silently omit it. Search SHALL use no index or PostgreSQL content projection.

#### Scenario: Search finds a committed note

- **WHEN** the accepted commit contains a bounded UTF-8 Markdown file with the literal query
- **THEN** search returns that file's repository-relative path, first matching line, bounded snippet, Knowledge Space identifier, and accepted commit OID

#### Scenario: Matching working-tree-only note is absent

- **WHEN** a query matches only an uncommitted or untracked Markdown file
- **THEN** search returns no match for that file

#### Scenario: Corpus bound is exceeded

- **WHEN** completing a search would exceed a tree, file-count, individual-file, aggregate-byte, path, or output bound
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** it returns no partial matches

### Requirement: Knowledge read returns one admitted Markdown blob

`knowledge_read` SHALL accept exactly one repository-relative Markdown path whose final component ends with `.md`, compared ASCII case-insensitively, and consider the complete UTF-8 blob from the operation's accepted commit when its size is at most 64 KiB. It SHALL return that complete content only when the resulting structured success value serializes to at most 15,000 JavaScript UTF-16 code units, below the tool loop's existing 16,000-unit truncation cap. The path SHALL be matched exactly and case-sensitively against the already enumerated Git tree.

The tool SHALL reject absolute paths, empty components, `.` or `..` components, backslashes, NUL or control characters, paths above 1,024 UTF-8 bytes or 32 components, and non-Markdown suffixes. It SHALL admit only regular Git blobs. Symlinks, submodules, trees, and other modes MUST NOT be followed or read, including when a checkout symlink resolves inside the configured repository.

Invalid or non-admitted paths SHALL return a closed `knowledge_path_invalid`, `knowledge_not_found`, `knowledge_content_invalid`, or `knowledge_limit_exceeded` result without revealing the repository root or whether a rejected path exists on the host filesystem.

#### Scenario: Read returns committed Markdown

- **WHEN** the owner requests an admitted Markdown path present in the accepted commit
- **THEN** the tool returns its complete content, Knowledge Space identifier, accepted commit OID, and exact repository-relative path

#### Scenario: Traversal and absolute paths fail

- **WHEN** a requested path is absolute or contains a dot, dot-dot, empty, backslash, or control-character component
- **THEN** the tool returns `knowledge_path_invalid`
- **AND** no host filesystem lookup is attempted

#### Scenario: Committed symlink is not followed

- **WHEN** the accepted tree contains a Markdown-named symlink targeting a file inside or outside the repository
- **THEN** read refuses the entry
- **AND** target content is not returned

#### Scenario: Oversized note or result fails whole read

- **WHEN** the accepted Markdown blob exceeds 64 KiB or its complete structured result would exceed 15,000 UTF-16 code units
- **THEN** the tool returns `knowledge_limit_exceeded`
- **AND** no prefix of the note is returned as if it were complete

### Requirement: Every successful retrieval carries durable safe provenance

Every successful search match and read result SHALL include the logical Knowledge Space identifier, the exact accepted commit OID observed by that operation, and the repository-relative path. Search SHALL additionally identify the matching line and snippet. These fields SHALL remain complete in the persisted tool-result part, live event stream, and browser reconstruction because Knowledge success results preflight below the live-result cap. Later model replay MAY clear payload detail or omit the complete call/result pair under the tool-calling capability's existing 8,000-unit pair and 32,000-unit turn/ledger budgets; it SHALL retain the structured outcome or bounded omission state honestly rather than present an incomplete payload as complete.

The provenance SHALL exclude source keys, host paths, Git remotes, credentials, cache or checkout paths, worker identity, and raw Git diagnostics. The structured tool-result UI SHALL visibly present the repository-relative path as a citation without exposing local binding details. The packaged tool description SHALL instruct the model to cite the path of a note it uses; the system SHALL NOT post-process arbitrary provider text to fabricate a citation.

#### Scenario: Browser reload retains evidence

- **WHEN** a Chat uses a successful Knowledge result and the browser reloads
- **THEN** the reconstructed tool result retains the same Knowledge Space identifier, commit OID, and repository-relative path

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a committed note to answer
- **THEN** the structured tool result visibly cites that note's repository-relative path
- **AND** the tool description directs the model to cite the same path in its answer
- **AND** it exposes no source key or host path

#### Scenario: Later replay clears oversized provenance payload

- **WHEN** a persisted Knowledge observation exceeds the existing later-replay pair or ledger budget
- **THEN** replay may clear its payload or omit the complete matched pair according to the generic precedence rules
- **AND** it does not expose a truncated provenance value as complete

### Requirement: Knowledge content is untrusted and potentially stale

Knowledge tool declarations and model-visible results SHALL identify repository content as owner-maintained, untrusted context that may be stale. The tools SHALL NOT grant instructions inside notes authority over the system prompt, tool permissions, owner linkage, accepted ref, or execution environment. The model-facing contract SHALL direct materially volatile claims to appropriate external verification when those tools are available.

#### Scenario: Note attempts to widen authority

- **WHEN** a note instructs the model to select another repository, enable a tool, reveal a host path, or override system policy
- **THEN** no tool availability, linkage, or execution scope changes

#### Scenario: Note contains a volatile claim

- **WHEN** a retrieved note contains a claim whose current truth materially affects the answer
- **THEN** the model-facing contract identifies the note as potentially stale and directs external verification rather than treating file age as proof

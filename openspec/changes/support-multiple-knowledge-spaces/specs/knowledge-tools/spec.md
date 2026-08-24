## MODIFIED Requirements

### Requirement: Knowledge tools derive filesystem authority only from trusted Run context

The system SHALL register `knowledge_search` and `knowledge_read` as code-owned `read_only` tools. Their executors SHALL receive the trusted Run owner identity and resolve current owner resources under tenant enforcement at each tool invocation. Model arguments MAY contain a Knowledge Space identifier only where the tool contract permits selection; they SHALL contain no owner ID, configured root, child directory, source key, host path, or alternate resource locator.

Changing a tool path, query, guessed identifier, or persisted argument SHALL NOT widen current owner access. A guessed, absent, removed, or other-owner explicit identifier SHALL return the same closed `knowledge_space_not_found` result even when the owner has no current spaces. An unscoped search by an owner with no current spaces SHALL receive `knowledge_space_not_configured`. Neither result SHALL reveal whether another owner, row, or directory exists.

At Run acceptance, Knowledge tool eligibility SHALL depend on the immutable code-owned declaration, `read_only` classification, exact operator allowlist entry, and process configuration—not on owner inventory. With a configured `knowledge.root`, an otherwise-eligible Knowledge tool SHALL remain advertised when the owner currently has zero spaces; a later call SHALL signal `knowledge_space_not_configured` to the model. When `knowledge.root` is absent from the authoring API process, the existing closed `knowledge_space_unavailable` manifest state SHALL apply without probing the filesystem on the request path.

At worker execution, the static tool executor SHALL receive the Knowledge filesystem resolver and process-local configuration only through trusted dependency injection or trusted tool context. It SHALL resolve current authority through the Run owner inside a tenant transaction and SHALL never accept owner identity, roots, or local binding data from model arguments or persisted declarations.

#### Scenario: Model cannot select another owner's space

- **WHEN** a model supplies an identifier derived from another owner's resource
- **THEN** current owner-scoped resolution returns `knowledge_space_not_found`
- **AND** no data or existence signal from the other owner is returned

#### Scenario: Owner has no space at acceptance

- **WHEN** an otherwise-eligible Knowledge tool is considered for a Run whose owner has no Knowledge Space row
- **THEN** the tool remains callable when its declaration, allowlist entry, and root configuration permit it
- **AND** invoking it returns `knowledge_space_not_configured`

#### Scenario: Authoring API has no Knowledge root

- **WHEN** the turn-authoring API process has no configured Knowledge root
- **THEN** the immutable availability manifest marks each otherwise-eligible Knowledge tool unavailable with `knowledge_space_unavailable`
- **AND** no filesystem probe or private path enters the request path

#### Scenario: A new resource is visible within an existing Run

- **WHEN** the owner gains a Knowledge Space after the Run was accepted
- **THEN** a later Knowledge tool invocation resolves the new current inventory
- **AND** no Run or Chat binding must be updated

#### Scenario: Revoked access fails on the next check

- **WHEN** the owner loses access after one successful Knowledge call
- **THEN** the next call or not-yet-opened search target rejects the resource
- **AND** previously persisted results remain historical observations

### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points, an integer result limit from 1 through 10 defaulting to 5, and an optional `knowledgeSpaceId`. When the identifier is present, search SHALL target only that currently owner-accessible space. When absent, search SHALL iterate the owner's complete current inventory in `(createdAt, id)` keyset pages without materializing the uncapped inventory in memory. Inventory paging SHALL obey the same operation timeout and cancellation signal; it SHALL impose no separate total-space count cap. Before opening each targeted child, search SHALL recheck current access under the trusted Run owner. If a row from an unscoped inventory page is no longer accessible at that check, search SHALL omit it as no longer current without adding a warning or incrementing `warningCount`; if no currently accessible target remains, the call SHALL return `knowledge_space_not_configured`. Within a space, files SHALL be ordered by Knowledge-relative path.

Search SHALL perform a case-insensitive literal scan over safe UTF-8 Markdown files as they are read from the live targeted spaces, return at most one result per file, and include the first matching line with a surrounding snippet of at most 500 Unicode code points. A Markdown path is one whose final component ends with `.md`, compared ASCII case-insensitively. Search SHALL use no grep subprocess, index, or PostgreSQL content projection.

One tool call SHALL share the existing global bounds across every target: at most 20,000 filesystem entries, 5,000 admitted Markdown files, 1 MiB per file, 32 MiB of aggregate Markdown content, paths of 1,024 UTF-8 bytes and 32 components, and a structured result of at most 15,000 JavaScript UTF-16 code units. It SHALL also obey the common tool timeout and abort signal. Space boundaries SHALL NOT reset any operation limit. The requested result limit is a successful response cap, not a safety-bound failure: search SHALL return the first matching files in deterministic space and path order up to that limit and SHALL continue inventory traversal as needed to surface later space failures.

Every returned match SHALL carry the response-time Knowledge Space identifier and display name, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact file bytes searched. The call SHALL resolve each name once for that invocation. Later rename or file changes SHALL NOT rewrite the persisted result.

When an unscoped search successfully inspects at least one space but another target has a space-scoped unavailable binding, unsafe path or symbolic-link condition, or invalid Markdown content, it SHALL continue with remaining spaces and return `status: "success"`, usable `results`, `complete: false`, a bounded top-level `warnings` array with at most one warning object per failed space, and `warningCount` for the total failed spaces. Each warning SHALL carry exactly one of `knowledge_space_unavailable`, `knowledge_path_invalid`, or `knowledge_content_invalid` as its type, plus the response-time space ID and name and a safe message; it SHALL NOT be attached to a valid result. `warningCount` MAY exceed `warnings.length` when the structured output budget requires omitting warning detail. A complete success SHALL return `complete: true`, `warnings: []`, and `warningCount: 0`.

If an explicit target fails, every target in an unscoped search fails, the owner has no current spaces, or a global entry, file-count, byte, path, timeout, cancellation, or output bound prevents completion, the tool SHALL return the applicable top-level closed error and SHALL NOT return partial matches as complete. A currently owned target whose root or stable-ID child cannot be resolved safely SHALL return `knowledge_space_unavailable`; an absent, removed, or other-owner explicit target SHALL return `knowledge_space_not_found`. A global safety or output bound SHALL return `knowledge_limit_exceeded`; zero inventory for an unscoped search SHALL return `knowledge_space_not_configured`. If every non-revoked target in an unscoped search fails with different space-scoped errors, the first failed target in deterministic inventory order SHALL determine the top-level error type and safe message. This top-level error SHALL contain only the existing `status: "error"`, `type`, and safe `message` shape; it SHALL omit `results`, `complete`, `warnings`, and `warningCount`.

There is no operation-wide content revision or snapshot. A file changed after it was inspected does not rewrite the recorded result, while another file inspected later may reflect newer bytes.

#### Scenario: Search finds a live note

- **WHEN** one targeted Knowledge Space contains a bounded UTF-8 Markdown file with the literal query
- **THEN** search returns that file's response-time space identity and name, relative path, first matching line, bounded snippet, and exact-byte hash

#### Scenario: Newly changed file is immediately visible

- **WHEN** a Markdown file is created or modified without a Git commit
- **THEN** a later search observes its current bytes
- **AND** the result hash identifies those bytes

#### Scenario: Corpus bound is exceeded

- **WHEN** completing a search would exceed any global traversal, content, path, timeout, or output bound
- **THEN** the tool returns the applicable closed limit or cancellation outcome
- **AND** it returns no partial matches

#### Scenario: Omitted selector searches current inventory

- **WHEN** an owner has two currently accessible spaces and search omits `knowledgeSpaceId`
- **THEN** both are traversed in `(createdAt, id)` order under one shared operation budget
- **AND** each match identifies its source space by stable ID and response-time name

#### Scenario: Requested result limit caps a successful response

- **WHEN** deterministic search finds more matching files than the requested result limit
- **THEN** the tool returns the first matches up to the requested limit as a successful result
- **AND** the requested cap alone does not produce `knowledge_limit_exceeded` or make the result incomplete

#### Scenario: Explicit selector narrows and reauthorizes

- **WHEN** search supplies one currently owner-accessible `knowledgeSpaceId`
- **THEN** search rechecks that resource and traverses only its stable-ID child
- **AND** no other space is inspected

#### Scenario: Revoked unscoped target is no longer current

- **WHEN** an unscoped inventory page contains a space whose access is removed before its pre-open check
- **THEN** search omits that target without adding a warning or incrementing `warningCount`
- **AND** an explicit request for that same identifier still returns `knowledge_space_not_found`

#### Scenario: One failed space produces incomplete success

- **WHEN** an unscoped search successfully inspects one space and another has a space-scoped safe failure
- **THEN** the tool returns the usable matches with `complete: false`
- **AND** bounded call-level warnings identify the failed space without exposing host details

#### Scenario: All failed spaces produce a top-level error

- **WHEN** every target in an unscoped search fails before producing a complete per-space search
- **THEN** the first non-revoked target in deterministic inventory order determines the top-level closed error
- **AND** the error omits `results`, `complete`, `warnings`, and `warningCount`
- **AND** it does not present accumulated matches as complete

### Requirement: Knowledge read returns one explicitly selected safe live Markdown file

`knowledge_read` SHALL require exactly one `knowledgeSpaceId` and one Knowledge-relative Markdown path whose final component ends with `.md`, compared ASCII case-insensitively. It SHALL resolve the identifier through the trusted Run owner's current access immediately before opening the child. Omitted, guessed, absent, removed, and other-owner identifiers SHALL fail closed without probing candidate directories; omission SHALL NOT infer a sole current space.

The tool SHALL read the complete current bytes from one safely resolved regular file when its size is at most 64 KiB, validate UTF-8, and return the complete text only when the structured success value serializes to at most 15,000 JavaScript UTF-16 code units. The path SHALL be matched case-sensitively against live directory entries. The tool SHALL reject absolute paths, empty components, `.` or `..` components, backslashes, NUL or control characters, paths above 1,024 UTF-8 bytes or 32 components, and non-Markdown suffixes. It SHALL reject every symbolic-link component or entry and SHALL NOT follow a link even when its target remains inside the Knowledge Space.

Every success SHALL include the response-time Knowledge Space identifier and display name, exact Knowledge-relative path, and lowercase SHA-256 hash of the exact bytes returned. Invalid or non-admitted paths and inaccessible selectors SHALL return a closed `knowledge_path_invalid`, `knowledge_not_found`, `knowledge_space_not_found`, `knowledge_space_unavailable`, `knowledge_content_invalid`, or `knowledge_limit_exceeded` result without revealing the configured root or whether a rejected host path or other-owner resource exists.

#### Scenario: Read returns current Markdown

- **WHEN** the selected current Knowledge Space contains an admitted live Markdown path
- **THEN** the tool returns its complete current content, response-time space identity and name, exact relative path, and exact-byte hash

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

#### Scenario: Read always requires an explicit space

- **WHEN** a read omits `knowledgeSpaceId` even though the owner has exactly one current space
- **THEN** closed input validation rejects the call
- **AND** no Knowledge child is probed

#### Scenario: Same-named spaces remain unambiguous

- **WHEN** two current spaces share a display name and read supplies one stable identifier
- **THEN** only the selected stable-ID child is resolved
- **AND** the result includes that identifier and its response-time name

### Requirement: Retrieval persists safe response-time attribution

Every successful search match and read result SHALL include the logical Knowledge Space identifier, response-time display name, exact Knowledge-relative path, and SHA-256 content hash. Search SHALL additionally identify the matching line and snippet. These fields describe the exact bytes and name resolved for that call; they SHALL NOT claim that a path, display name, authorization binding, or content remains unchanged or permanently replayable.

The fields SHALL remain complete in the persisted tool-result part, live event stream, and browser reconstruction because Knowledge success results preflight below the live-result cap. Later model replay MAY clear payload detail or omit the complete call/result pair under the tool-calling capability's existing pair and turn/ledger budgets. A successful search that explicitly records `complete: false` SHALL retain an `incomplete` outcome in every later payload-cleared model projection, including ordinary bounded next-turn replay and compacted-ledger replay, instead of being projected as complete success after detail is cleared.

The persisted observation SHALL include the bounded snippet or returned Markdown in the existing PostgreSQL-backed Run-event and assistant-message-part stores and SHALL follow their existing Run and Chat retention and deletion lifecycle. This execution history SHALL NOT become a canonical Knowledge content projection, index, source store, or alternate read authority. The system SHALL add no separate Knowledge-content persistence; every later retrieval SHALL read the live files again.

Attribution SHALL exclude configured roots, resolved child paths, hosted owner IDs, credentials, worker identity, and raw filesystem diagnostics. The structured tool-result UI SHALL visibly present the response-time display name, stable identifier, and Knowledge-relative path so duplicate names remain distinguishable. The packaged tool description SHALL instruct the model to cite the space and path of a note it uses; the system SHALL NOT post-process arbitrary provider text to fabricate a citation.

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a successful Knowledge result and the browser reloads
- **THEN** the reconstructed result retains the same space identifier, response-time name, path, and content hash recorded at execution

#### Scenario: Later file change does not alter history

- **WHEN** a space name or file changes after a successful tool result was persisted
- **THEN** the persisted result retains its original space name, path, hash, snippet or content
- **AND** a later tool call may return different metadata, hash, or bytes

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note from one of multiple spaces
- **THEN** the structured result visibly cites the response-time space identity and Knowledge-relative path
- **AND** the tool description directs the model to cite both in its answer
- **AND** it exposes no configured root or resolved host path

#### Scenario: Payload-cleared replay preserves incomplete search honesty

- **WHEN** a successful search with `complete: false` is reduced to any payload-cleared model observation
- **THEN** replay identifies its outcome as `incomplete`, not `success`
- **AND** the degraded call cannot become indistinguishable from a complete search

## RENAMED Requirements

- FROM: `### Requirement: Knowledge search scans live Markdown deterministically within bounds`
- TO: `### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds`
- FROM: `### Requirement: Knowledge read returns one safe live Markdown file`
- TO: `### Requirement: Knowledge read returns one explicitly selected safe live Markdown file`

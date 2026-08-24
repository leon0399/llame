## MODIFIED Requirements

### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points, an integer result limit from 1 through 10 defaulting to 5, an optional `knowledgeSpaceId`, and an optional opaque continuation cursor. When the identifier is present, search SHALL target only that currently owner-accessible space. When absent, search SHALL iterate the owner's complete current inventory in `(createdAt, id)` keyset pages without materializing the uncapped inventory in memory. Inventory paging SHALL obey the same operation timeout and cancellation signal; it SHALL impose no separate total-space count cap. Before opening each targeted child, search SHALL recheck current access under the trusted Run owner. If a row from an unscoped inventory page is no longer accessible at that check, search SHALL omit it as no longer current without adding a warning or incrementing `warningCount`; if no currently accessible target remains, the call SHALL return `knowledge_space_not_configured`. Within a space, files SHALL be ordered by Knowledge-relative path.

Search SHALL perform a case-insensitive literal scan over safe UTF-8 Markdown files as they are read from the live targeted spaces. LF SHALL terminate one logical line, CRLF SHALL be one line delimiter, a lone CR SHALL remain source text, and a terminal delimiter SHALL NOT create a phantom line. Every literal occurrence SHALL contribute a candidate passage consisting of its logical line plus at most one preceding and one following logical line. Occurrences on the same line SHALL share one candidate, and candidate passages within one file SHALL be sorted and transitively unioned when they overlap or touch before result limiting. A merged interval longer than 2,000 logical lines SHALL then be partitioned into adjacent deterministic passages of at most 2,000 lines; every emitted passage SHALL contain a literal match and the passages together SHALL cover the complete merged interval. Search SHALL return passages in deterministic space `(createdAt, id)`, relative-path, and zero-based passage-offset order. It SHALL use no grep subprocess, regular expression, Markdown parser, index, or PostgreSQL content projection.

Every returned passage SHALL carry the response-time Knowledge Space identifier and display name, exact Knowledge-relative path, zero-based `offset`, source-line `limit` from 1 through 2,000, and an `excerpt` of at most 500 Unicode code points. `offset` and `limit` SHALL identify the complete emitted source-line window and be directly valid `knowledge_read` arguments for that file. If the window exceeds the excerpt cap, search SHALL crop visibly around a literal match without changing the source-line coordinates. Search SHALL NOT duplicate a separate matching-line string, expose a match mode while only literal search exists, or expose a content hash or revision token.

The optional cursor SHALL be canonical opaque Knowledge-local keyset state bound to the query, optional explicit selector, and last returned passage ordering tuple. A cursor used with different request bindings or malformed state SHALL fail closed as invalid input. An unchanged accessible corpus SHALL produce deterministic non-overlapping pages. The cursor SHALL NOT claim a filesystem snapshot: current access is resolved again on continuation; removed resources disappear, and concurrent file or inventory changes MAY cause newly ordered passages to appear or passages ordered before the cursor to be skipped. Search SHALL return `nextCursor` only when another passage currently exists after the last returned result, including from an incomplete successful page.

For an unscoped continuation, completeness SHALL be evaluated for that invocation. Spaces ordered strictly before the cursor's space key SHALL NOT be reopened because they cannot contribute a later passage. The anchor space and every later space SHALL be reauthorized and inspected. A failed space before the last returned passage SHALL therefore not be retried by a continuation anchored after it. A failed space after the last returned passage SHALL be re-evaluated while it remains after the anchor. When that invocation also successfully inspects at least one eligible space, the failure SHALL produce another bounded warning and SHALL NOT suppress `nextCursor` when a later usable passage exists; an incomplete page with no later passage SHALL omit `nextCursor`. When every eligible anchor-or-later target fails, the all-failed top-level error SHALL take precedence and SHALL omit warnings and continuation state. Skipped pre-anchor spaces SHALL NOT count as targets for that decision.

One tool call SHALL share the existing global bounds across every target: at most 20,000 filesystem entries, 5,000 admitted Markdown files, 1 MiB per file, 32 MiB of aggregate Markdown content, paths of 1,024 UTF-8 bytes and 32 components, and a structured result of at most 15,000 JavaScript UTF-16 code units. It SHALL also obey the common tool timeout and abort signal. Space boundaries and cursor continuation SHALL NOT reset any bound within one invocation. The requested result limit is a successful response cap, not a safety-bound failure: search SHALL return the first passages after the optional cursor up to that limit and SHALL continue inventory traversal as needed to determine continuation and surface later space failures.

When an unscoped search successfully inspects at least one space but another target has a space-scoped unavailable binding, unsafe path or symbolic-link condition, or invalid Markdown content, it SHALL continue with remaining spaces and return `status: "success"`, usable `results`, `complete: false`, a bounded top-level `warnings` array with at most one warning object per failed space, and `warningCount` for the total failed spaces. Each warning SHALL carry exactly one of `knowledge_space_unavailable`, `knowledge_path_invalid`, or `knowledge_content_invalid` as its type, plus the response-time space ID and name and a safe message; it SHALL NOT be attached to a valid result. `warningCount` MAY exceed `warnings.length` when the structured output budget requires omitting warning detail. A complete success SHALL return `complete: true`, `warnings: []`, and `warningCount: 0`.

If an explicit target fails, every target eligible for an unscoped invocation fails, the owner has no current spaces, the cursor is invalid, or a global entry, file-count, byte, path, timeout, cancellation, or output bound prevents completion, the tool SHALL return the applicable top-level closed error and SHALL NOT return partial passages as complete. Every current space is eligible on an initial unscoped call; only the anchor space and later spaces are eligible on an unscoped continuation. A currently owned target whose root or stable-ID child cannot be resolved safely SHALL return `knowledge_space_unavailable`; an absent, removed, or other-owner explicit target SHALL return `knowledge_space_not_found`. A global safety or output bound SHALL return `knowledge_limit_exceeded`; zero inventory for an unscoped search SHALL return `knowledge_space_not_configured`. If every non-revoked eligible target in an unscoped invocation fails with different space-scoped errors, the first failed eligible target in deterministic inventory order SHALL determine the top-level error type and safe message. This top-level error SHALL contain only the existing `status: "error"`, `type`, and safe `message` shape; it SHALL omit `results`, `complete`, `warnings`, `warningCount`, and `nextCursor`.

There is no operation-wide content revision or snapshot. A file changed after it was inspected does not rewrite the recorded result, while another file inspected later may reflect newer bytes.

#### Scenario: Search finds a live note

- **WHEN** one targeted Knowledge Space contains two non-overlapping literal matches in one bounded UTF-8 Markdown file
- **THEN** search returns two passage candidates unless merging makes their context windows one passage
- **AND** each result carries reusable zero-based line coordinates and a bounded excerpt without a content hash

#### Scenario: Overlapping match windows merge

- **WHEN** multiple literal occurrences produce a chain of touching or overlapping context windows in one file
- **THEN** search returns one merged passage for that source range
- **AND** merging is the transitive interval union rather than an order-dependent split
- **AND** the requested result limit counts the merged passage once

#### Scenario: A transitive match chain remains readable

- **WHEN** touching or overlapping match windows transitively union into more than 2,000 logical lines
- **THEN** search partitions the complete merged interval into adjacent passages whose limits are each at most 2,000 and which each contain a literal match
- **AND** every matching line remains covered in deterministic offset order by coordinates accepted by `knowledge_read`

#### Scenario: Search passage expands through read

- **WHEN** an assistant passes a search result's space ID, path, offset, and limit to `knowledge_read`
- **THEN** read addresses the complete current logical-line window represented by those coordinates
- **AND** neither call requires a model-facing file hash

#### Scenario: Cursor continues an unchanged corpus

- **WHEN** deterministic search has more passages than the requested result limit and the caller continues with `nextCursor` using the same query and selector
- **THEN** the next page begins after the last prior passage without duplicating it
- **AND** pagination eventually makes every bounded passage reachable

#### Scenario: Cursor remains live across changes

- **WHEN** current access or file content changes between search pages
- **THEN** continuation reauthorizes current resources and searches current bytes after the stored ordering tuple
- **AND** it does not claim snapshot completeness across calls

#### Scenario: Newly changed file is immediately visible

- **WHEN** a Markdown file is created or modified without a Git commit
- **THEN** a later search observes its current bytes
- **AND** no accepted revision or clean-worktree state is required

#### Scenario: Corpus bound is exceeded

- **WHEN** completing a search would exceed any global traversal, content, path, timeout, or output bound
- **THEN** the tool returns the applicable closed limit or cancellation outcome
- **AND** it returns no partial passages as complete

#### Scenario: Omitted selector searches current inventory

- **WHEN** an owner has two currently accessible spaces and search omits `knowledgeSpaceId`
- **THEN** both are traversed in `(createdAt, id)` order under one shared operation budget
- **AND** each passage identifies its source space by stable ID and response-time name

#### Scenario: Requested result limit caps a successful response

- **WHEN** deterministic search finds more passages than the requested result limit
- **THEN** the tool returns the first passages up to the requested limit as a successful result
- **AND** it returns `nextCursor` when another current passage exists

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
- **THEN** the tool returns the usable passages with `complete: false`
- **AND** bounded call-level warnings identify the failed space without exposing host details

#### Scenario: A failed space before the cursor anchor is not retried

- **WHEN** an unscoped page warns for a failed space ordered before its last returned passage and exposes a cursor for a later passage
- **THEN** continuation begins after that passage and does not reopen the earlier failed space
- **AND** completeness and warnings describe only the continuation invocation

#### Scenario: A failed space after the cursor anchor is re-evaluated

- **WHEN** an unscoped continuation successfully inspects one eligible space and has a failed space ordered after its anchor
- **THEN** continuation reauthorizes and retries that space while it remains after the anchor
- **AND** the failure does not suppress a cursor for any later usable passage, while a final incomplete page with no later passage omits `nextCursor`

#### Scenario: Every eligible continuation target fails

- **WHEN** every non-revoked anchor-or-later target in an unscoped continuation fails
- **THEN** the first failed eligible target in deterministic order determines the top-level closed error
- **AND** skipped pre-anchor spaces do not participate and the error omits results, warnings, and continuation state

#### Scenario: All failed spaces produce a top-level error

- **WHEN** every target in an unscoped search fails before producing a complete per-space search
- **THEN** the first non-revoked target in deterministic inventory order determines the top-level closed error
- **AND** the error omits results and continuation state and does not present accumulated passages as complete

### Requirement: Knowledge read returns one explicitly selected safe live Markdown range

`knowledge_read` SHALL require exactly one `knowledgeSpaceId` and one Knowledge-relative Markdown path whose final component ends with `.md`, compared ASCII case-insensitively. It SHALL accept an optional zero-based safe-integer `offset` defaulting to zero and an optional safe-integer `limit` from 1 through 2,000. `offset` SHALL mean the number of logical source lines skipped; `limit`, when present, SHALL mean the maximum logical-line count requested. It SHALL resolve the identifier through the trusted Run owner's current access immediately before opening the child. Omitted, guessed, absent, removed, and other-owner identifiers SHALL fail closed without probing candidate directories; omission SHALL NOT infer a sole current space.

The tool SHALL safely open one regular file of at most 1 MiB and validate the complete admitted file as UTF-8 while scanning it in bounded chunks. LF SHALL terminate one logical line, CRLF SHALL be one line delimiter, and a lone CR SHALL remain source text. An empty file SHALL have zero logical lines, a terminal delimiter SHALL NOT create a phantom line, and blank lines SHALL count. The tool SHALL NOT buffer the complete file merely to return a bounded range.

When `offset` and `limit` are both omitted, the requested range SHALL extend through the current end of file. When only `offset` is present, the requested range SHALL extend from that logical line through the current end of file. When only `limit` is present, the range SHALL begin at offset zero. One success SHALL return no more than 2,000 logical lines even when the requested range extends farther.

Every success SHALL return the response-time Knowledge Space identifier and display name, exact Knowledge-relative path, effective zero-based `offset`, returned `lineCount`, model-visible `content`, and the existing untrusted-content notice. `content` SHALL render each returned logical line as `<one-based source line number>: <source text>` while preserving that source line's LF or CRLF delimiter and preserving an unterminated final line. When current logical lines remain after the returned slice, success SHALL include `nextOffset = offset + lineCount`; otherwise it SHALL omit `nextOffset`.

The tool SHALL keep the complete structured success at or below 15,000 JavaScript UTF-16 code units. It SHALL return at most the first 2,000 requested lines, but the output bound MAY stop it earlier. If the line bound is the first server bound reached, the result SHALL include `nextOffset` and `cutReason: "line_limit"`. If the output bound is reached first, the tool SHALL omit the first whole line that cannot fit, return the preceding non-empty whole-line prefix plus `nextOffset` pointing to the omitted line, and include `cutReason: "output_limit"`. `cutReason` SHALL be absent when an explicit caller `limit` completes normally, even if `nextOffset` shows that the file itself continues. The Knowledge result SHALL NOT declare the generic `truncated` or `truncationNotice` fields. If one selected logical line alone cannot fit, the tool SHALL return `knowledge_limit_exceeded` rather than clip a line without a line-offset continuation coordinate.

An offset beyond the current logical-line range SHALL return `knowledge_range_invalid`; an empty file read at offset zero SHALL return empty content successfully. Negative offsets, limits outside 1 through 2,000, non-integers, and unsafe integers SHALL fail closed input validation before filesystem access. The path SHALL be matched case-sensitively against live directory entries. The tool SHALL reject absolute paths, empty components, `.` or `..` components, backslashes, NUL or control characters, paths above 1,024 UTF-8 bytes or 32 components, and non-Markdown suffixes. It SHALL reject every symbolic-link component or entry and SHALL NOT follow a link even when its target remains inside the Knowledge Space.

Read results SHALL expose no content hash, expected hash, revision, host path, or alternate locator. Invalid or non-admitted paths and inaccessible selectors SHALL return a closed `knowledge_path_invalid`, `knowledge_not_found`, `knowledge_range_invalid`, `knowledge_space_not_found`, `knowledge_space_unavailable`, `knowledge_content_invalid`, or `knowledge_limit_exceeded` result without revealing the configured root or whether a rejected host path or other-owner resource exists.

#### Scenario: Omitted range reads a fitting current note

- **WHEN** the selected current Knowledge Space contains an admitted Markdown file whose complete result fits the output bound and read omits offset and limit
- **THEN** the tool returns its complete current line-numbered content with offset zero and the actual line count
- **AND** it omits `nextOffset`, `cutReason`, and content hashes

#### Scenario: Omitted range continues a long note

- **WHEN** the complete admitted Markdown file reaches the line or output bound before EOF
- **THEN** read returns the largest allowed whole-line prefix with `nextOffset` and the applicable `cutReason`
- **AND** a later read using that offset can continue without presenting the prefix as the complete note

#### Scenario: Explicit range reads selected logical lines

- **WHEN** read supplies a valid offset and limit within the selected current note
- **THEN** it returns at most that many logical lines beginning at the offset
- **AND** it includes `nextOffset` exactly when current lines remain while omitting `cutReason` when the requested range completed normally

#### Scenario: Range output bound preserves continuation

- **WHEN** an explicitly requested line range exceeds the structured output bound but its first selected line fits
- **THEN** read omits the first non-fitting line and returns the largest fitting whole-line prefix, `nextOffset` pointing to that line, and `cutReason: "output_limit"`
- **AND** it does not return `knowledge_limit_exceeded` merely because the request asked for more lines

#### Scenario: Offset beyond current file fails visibly

- **WHEN** the requested offset is beyond the selected file's current logical-line range
- **THEN** read returns `knowledge_range_invalid`
- **AND** it does not represent the mistake as an empty note

#### Scenario: One oversized line cannot be ranged

- **WHEN** the first selected logical line cannot fit within a successful structured result
- **THEN** read returns `knowledge_limit_exceeded`
- **AND** it does not clip the line without a valid continuation coordinate

#### Scenario: Traversal and absolute paths fail

- **WHEN** a requested path is absolute or contains a dot, dot-dot, empty, backslash, or control-character component
- **THEN** the tool returns `knowledge_path_invalid`
- **AND** no host path outside the trusted stable-ID child is read

#### Scenario: Symbolic link is not followed

- **WHEN** any path component or Markdown-named entry is a symbolic link
- **THEN** read refuses it
- **AND** target content is not returned

#### Scenario: Read always requires an explicit space

- **WHEN** a read omits `knowledgeSpaceId` even though the owner has exactly one current space
- **THEN** closed input validation rejects the call
- **AND** no Knowledge child is probed

#### Scenario: Same-named spaces remain unambiguous

- **WHEN** two current spaces share a display name and read supplies one stable identifier
- **THEN** only the selected stable-ID child is resolved
- **AND** the result includes that identifier and its response-time name

### Requirement: Retrieval persists safe response-time attribution

Every newly successful search passage and read result SHALL include the logical Knowledge Space identifier, response-time display name, exact Knowledge-relative path, and zero-based line coordinates. Search SHALL additionally include its bounded excerpt; read SHALL include returned Markdown and optional continuation. These fields describe what that live call observed and SHALL NOT claim that a path, display name, authorization binding, coordinates, or content remains unchanged or permanently replayable. New results SHALL expose no content hash, expected hash, revision, configured root, or resolved host path.

The fields SHALL remain complete in the persisted tool-result part, live event stream, and browser reconstruction because Knowledge success results preflight below the live-result cap. Later model replay MAY clear payload detail or omit the complete call/result pair under the tool-calling capability's existing pair and turn/ledger budgets. A successful search that explicitly records `complete: false` SHALL retain an `incomplete` outcome in every later payload-cleared model projection, including ordinary bounded next-turn replay and compacted-ledger replay, instead of being projected as complete success after detail is cleared.

Historical persisted Knowledge observations SHALL remain immutable. Results authored before this change MAY retain their original `contentHash`, matching-line, and snippet fields; replay and browser reconstruction SHALL preserve those fields as recorded and SHALL NOT synthesize new range fields or remove historical attribution. Calls authored before this change remain executable because the new read range and search cursor arguments are optional.

The persisted observation SHALL include the bounded excerpt or returned Markdown in the existing PostgreSQL-backed Run-event and assistant-message-part stores and SHALL follow their existing Run and Chat retention and deletion lifecycle. This execution history SHALL NOT become a canonical Knowledge content projection, index, source store, or alternate read authority. The system SHALL add no separate Knowledge-content persistence; every later retrieval SHALL read the live files again.

Attribution SHALL exclude configured roots, resolved child paths, hosted owner IDs, credentials, worker identity, and raw filesystem diagnostics. The structured tool-result UI SHALL visibly present the response-time display name, stable identifier, Knowledge-relative path, and available range coordinates so duplicate names remain distinguishable. The packaged tool description SHALL instruct the model to cite the space and path of a note it uses; the system SHALL NOT post-process arbitrary provider text to fabricate a citation.

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a newly successful Knowledge passage or ranged read and the browser reloads
- **THEN** the reconstructed result retains the same space identifier, response-time name, path, coordinates, and recorded excerpt or content
- **AND** it does not require a content hash

#### Scenario: Historical hash-bearing result remains historical

- **WHEN** a Chat reloads a Knowledge result persisted before this change
- **THEN** its original hash, matching line, snippet, or complete content remains as recorded
- **AND** replay does not rewrite it into the new result shape

#### Scenario: Later file change does not alter history

- **WHEN** a space name or file changes after a successful tool result was persisted
- **THEN** the persisted result retains its original response-time name, path, coordinates, excerpt, or content
- **AND** a later tool call may return different metadata, coordinates, or bytes

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note from one of multiple spaces
- **THEN** the structured result visibly cites the response-time space identity and Knowledge-relative path
- **AND** the tool description directs the model to cite both in its answer without exposing configured or resolved host paths

#### Scenario: Payload-cleared replay preserves incomplete search honesty

- **WHEN** a successful search with `complete: false` is reduced to any payload-cleared model observation
- **THEN** replay identifies its outcome as `incomplete`, not `success`
- **AND** the degraded call cannot become indistinguishable from a complete search

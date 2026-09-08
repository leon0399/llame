## MODIFIED Requirements

### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds

`knowledge_search` SHALL accept a non-empty literal query of at most 200 Unicode code points, an integer result limit from 1 through 10 defaulting to 5, an optional `knowledgeSpaceId`, and an optional opaque continuation cursor. When the identifier is present, search SHALL target only that currently owner-accessible space. When absent, search SHALL iterate the owner's complete current inventory in `(createdAt, id)` keyset pages without materializing the uncapped inventory in memory. Inventory paging SHALL obey the same operation timeout and cancellation signal; it SHALL impose no separate total-space count cap. Before opening each targeted child, search SHALL recheck current access under the trusted Run owner. If a row from an unscoped inventory page is no longer accessible at that check, search SHALL omit it as no longer current without adding a warning or incrementing `warningCount`; if no currently accessible target remains, the call SHALL return `knowledge_space_not_configured`. Within a space, files SHALL be ordered by Knowledge-relative path.

Search SHALL perform a case-insensitive literal scan over safe UTF-8 Markdown files as they are read from the live targeted spaces. A file whose Knowledge-relative path contains `:`, `?`, `#`, or `%` SHALL be searched like any other; its emitted locator SHALL percent-encode exactly those characters in the affected segments and leave every other character literal, so the locator is directly a valid `read` argument. LF SHALL terminate one logical line, CRLF SHALL be one line delimiter, a lone CR SHALL remain source text, and a terminal delimiter SHALL NOT create a phantom line. Every literal occurrence SHALL contribute a candidate passage consisting of its logical line plus at most one preceding and one following logical line. Occurrences on the same line SHALL share one candidate, and candidate passages within one file SHALL be sorted and transitively unioned when they overlap or touch before result limiting. A merged interval longer than 2,000 logical lines SHALL then be partitioned into adjacent deterministic passages of at most 2,000 lines; every emitted passage SHALL contain a literal match and the passages together SHALL cover the complete merged interval. Search SHALL return passages in deterministic space `(createdAt, id)`, relative-path, and passage start-line order. It SHALL use no grep subprocess, regular expression, Markdown parser, index, or PostgreSQL content projection.

Every returned passage SHALL carry the response-time Knowledge Space identifier and display name, exact Knowledge-relative path, a `locator` of the form `kb://<space-id>/<path>:<start>-<end>` whose one-based inclusive line range is the complete emitted source-line window and which is directly a valid `read` argument, and an `excerpt` of at most 500 Unicode code points. A passage SHALL span at most 2,000 logical lines. Search SHALL NOT emit zero-based coordinates. If the window exceeds the excerpt cap, search SHALL crop visibly around a literal match without changing the locator's range. Search SHALL NOT duplicate a separate matching-line string, expose a match mode while only literal search exists, or expose a content hash or revision token.

The optional cursor SHALL be canonical opaque Knowledge-local keyset state bound to the query, optional explicit selector, and last returned passage ordering tuple. A cursor used with different request bindings or malformed state SHALL fail closed as invalid input. An unchanged accessible corpus SHALL produce deterministic non-overlapping pages. The cursor SHALL NOT claim a filesystem snapshot: current access is resolved again on continuation; removed resources disappear, and concurrent file or inventory changes MAY cause newly ordered passages to appear or passages ordered before the cursor to be skipped. Search SHALL return `nextCursor` only when another passage currently exists after the last returned result, including from an incomplete successful page.

For an unscoped continuation, completeness SHALL be evaluated for that invocation. Spaces ordered strictly before the cursor's space key SHALL NOT be reopened because they cannot contribute a later passage. The anchor space and every later space SHALL be reauthorized and inspected. A failed space before the last returned passage SHALL therefore not be retried by a continuation anchored after it. A failed space after the last returned passage SHALL be re-evaluated while it remains after the anchor. When that invocation also successfully inspects at least one eligible space, the failure SHALL produce another bounded warning and SHALL NOT suppress `nextCursor` when a later usable passage exists; an incomplete page with no later passage SHALL omit `nextCursor`. When every eligible anchor-or-later target fails, the all-failed top-level error SHALL take precedence and SHALL omit warnings and continuation state. Skipped pre-anchor spaces SHALL NOT count as targets for that decision.

One tool call SHALL share the existing global bounds across every target: at most 20,000 filesystem entries, 5,000 admitted Markdown files, 1 MiB per file, 32 MiB of aggregate Markdown content, paths of 1,024 UTF-8 bytes and 32 components, and a structured result of at most 15,000 JavaScript UTF-16 code units. It SHALL also obey the common tool timeout and abort signal. Space boundaries and cursor continuation SHALL NOT reset any bound within one invocation. The requested result limit is a successful response cap, not a safety-bound failure: search SHALL return the first passages after the optional cursor up to that limit and SHALL continue inventory traversal as needed to determine continuation and surface later space failures.

When an unscoped search successfully inspects at least one space but another target has a space-scoped unavailable binding, unsafe path or symbolic-link condition, or invalid Markdown content, it SHALL continue with remaining spaces and return `status: "success"`, usable `results`, `complete: false`, a bounded top-level `warnings` array with at most one warning object per failed space, and `warningCount` for the total failed spaces. Each warning SHALL carry exactly one of `knowledge_space_unavailable`, `knowledge_path_invalid`, or `knowledge_content_invalid` as its type, plus the response-time space ID and name and a safe message; it SHALL NOT be attached to a valid result. `warningCount` MAY exceed `warnings.length` when the structured output budget requires omitting warning detail. A complete success SHALL return `complete: true`, `warnings: []`, and `warningCount: 0`.

If an explicit target fails, every target eligible for an unscoped invocation fails, the owner has no current spaces, the cursor is invalid, or a global entry, file-count, byte, path, timeout, cancellation, or output bound prevents completion, the tool SHALL return the applicable top-level closed error and SHALL NOT return partial passages as complete. Every current space is eligible on an initial unscoped call; only the anchor space and later spaces are eligible on an unscoped continuation. A currently owned target whose root or stable-ID child cannot be resolved safely SHALL return `knowledge_space_unavailable`; an absent, removed, or other-owner explicit target SHALL return `knowledge_space_not_found`. A global safety or output bound SHALL return `knowledge_limit_exceeded`; zero inventory for an unscoped search SHALL return `knowledge_space_not_configured`. If every non-revoked eligible target in an unscoped invocation fails with different space-scoped errors, the first failed eligible target in deterministic inventory order SHALL determine the top-level error type and safe message. This top-level error SHALL contain only the existing `status: "error"`, `type`, and safe `message` shape; it SHALL omit `results`, `complete`, `warnings`, `warningCount`, and `nextCursor`.

There is no operation-wide content revision or snapshot. A file changed after it was inspected does not rewrite the recorded result, while another file inspected later may reflect newer bytes.

#### Scenario: A path with no locator is not searched

- **WHEN** a Space contains a Markdown file whose relative path contains `:`, such as `notes/2026-09-08 14:30 standup.md`
- **THEN** search returns its passages with the locator `kb://<id>/notes/2026-09-08 14%3A30 standup.md:<start>-<end>`
- **AND** passing that locator unchanged to `read` opens the passage; no emitted locator is one `read` refuses

#### Scenario: Search finds a live note

- **WHEN** one targeted Knowledge Space contains two non-overlapping literal matches in one bounded UTF-8 Markdown file
- **THEN** search returns two passage candidates unless merging makes their context windows one passage
- **AND** each result carries a reusable `kb://` locator and a bounded excerpt without a content hash

#### Scenario: Overlapping match windows merge

- **WHEN** multiple literal occurrences produce a chain of touching or overlapping context windows in one file
- **THEN** search returns one merged passage for that source range
- **AND** merging is the transitive interval union rather than an order-dependent split
- **AND** the requested result limit counts the merged passage once

#### Scenario: A transitive match chain remains readable

- **WHEN** touching or overlapping match windows transitively union into more than 2,000 logical lines
- **THEN** search partitions the complete merged interval into adjacent passages whose limits are each at most 2,000 and which each contain a literal match
- **AND** every matching line remains covered in deterministic order by locators accepted by `read`

#### Scenario: Search passage expands through read

- **WHEN** an assistant passes a search result's `locator` unchanged to `read`
- **THEN** read addresses the complete current logical-line window the passage covered, plus native context lines
- **AND** neither call requires a model-facing file hash or a second coordinate system

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

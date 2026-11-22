## MODIFIED Requirements

### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds

`knowledge_search` MUST accept a non-empty literal query of at most 200
Unicode code points. It MUST accept an integer result limit from 1 through 10,
with 5 as the default. It MUST accept an optional `knowledgeSpaceId` and an
optional opaque continuation cursor. When the identifier is present, search
MUST target only that currently owner-accessible space. When the identifier is
absent, search MUST iterate the owner's complete current inventory in
`(createdAt, id)` keyset pages. The iteration MUST NOT materialize the
uncapped inventory in memory.

Inventory paging MUST obey the operation timeout and the cancellation signal.
It MUST NOT impose a separate total-space count cap. Before it opens each
targeted child, search MUST recheck current access under the trusted Run
owner. When a row from an unscoped page is no longer accessible at that check,
search MUST omit it. The omission MUST NOT add a warning and MUST NOT
increment `warningCount`. When no currently accessible target remains, the
call MUST return `knowledge_space_not_configured`. Within a space, files MUST
be ordered by Knowledge-relative path.

Search MUST enumerate a Space with the walk policy. The corpus is the safe
UTF-8 Markdown files that this enumeration reaches. Search MUST perform a
case-insensitive literal scan over each such file, as the file is read live
from the Space. A file whose Knowledge-relative path contains `:`, `?`, `#`,
or `%` MUST be searched like any other. Its emitted locator MUST percent-encode
exactly those characters in the affected segments. Every other character MUST
stay literal, so the locator is directly a valid `read` argument. LF MUST end
one logical line. CRLF MUST be one line delimiter. A lone CR MUST stay source
text. A terminal delimiter MUST NOT create a phantom line. Every literal
occurrence MUST add one candidate passage. A candidate is the matching logical
line, with at most one line before and one line after it. Occurrences on one
line MUST share one candidate. Candidates within one file MUST be sorted.
Search MUST union transitively the candidates that overlap or touch, before
result limiting. A merged interval longer than 2,000 logical lines MUST be
partitioned into adjacent deterministic passages of at most 2,000 lines. Every
emitted passage MUST contain a literal match. The passages together MUST cover
the complete merged interval. Search MUST return passages in deterministic
space `(createdAt, id)`, relative-path, and passage start-line order. It MUST
use no grep subprocess, regular expression, Markdown parser, index, or
PostgreSQL content projection.

Every returned passage MUST carry the response-time Knowledge Space
identifier and display name. It MUST carry the exact Knowledge-relative path.
It MUST carry a `locator` of the form `kb://<space-id>/<path>:<start>-<end>`.
That range is one-based and inclusive, and covers the complete emitted
source-line window. The locator MUST be directly a valid `read` argument. The
passage MUST carry an `excerpt` of at most 500 Unicode code points. A passage
MUST span at most 2,000 logical lines. Search MUST NOT emit zero-based
coordinates. When the window exceeds the excerpt cap, search MUST crop visibly
around a literal match, without changing the range. Search MUST NOT duplicate a
separate matching-line string. It MUST NOT expose a match mode, a content
hash, or a revision token.

The optional cursor MUST be canonical opaque Knowledge-local keyset state. It
MUST bind to the query, the optional explicit selector, and the last returned
passage ordering tuple. A cursor with different request bindings, or malformed
state, MUST fail closed as invalid input. An unchanged accessible corpus MUST
produce deterministic non-overlapping pages. The cursor MUST NOT claim a
filesystem snapshot. Current access is resolved again on continuation. Removed
resources disappear. Concurrent file or inventory changes can add newly ordered
passages or skip passages ordered before the cursor. Search MUST return
`nextCursor` only when another passage currently exists after the last
returned result. This includes an incomplete successful page.

For an unscoped continuation, completeness MUST be evaluated for that
invocation alone. Spaces ordered strictly before the cursor's space key MUST
NOT be reopened. They cannot contribute a later passage. The anchor space and
every later space MUST be reauthorized and inspected. A failed space before the
last returned passage MUST NOT be retried by a continuation anchored after it.
A failed space after the last returned passage MUST be re-evaluated while it
remains after the anchor. When that invocation also successfully inspects at
least one eligible space, the failure MUST produce one bounded warning. The
failure MUST NOT suppress `nextCursor` when a later usable passage exists. An
incomplete page with no later passage MUST omit `nextCursor`. Skipped
pre-anchor spaces MUST NOT count as targets for that decision.

One tool call MUST share the existing global bounds across every target. These
are at most 20,000 filesystem entries, 5,000 admitted Markdown files, 1 MiB
per file, and 32 MiB of aggregate Markdown content. Paths MUST stay within
1,024 UTF-8 bytes and 32 components. The structured result MUST stay within
15,000 JavaScript UTF-16 code units. The call MUST obey the common tool
timeout and abort signal. Space boundaries and cursor continuation MUST NOT
reset any bound within one invocation. The walk policy MUST bound each
ignore-file read, and such a read MUST NOT consume the Markdown file or byte
bounds. The requested result limit is a successful response cap, not a
safety-bound failure. Search MUST return the first passages after the optional
cursor, up to that limit. It MUST continue inventory traversal as needed, to
determine continuation and surface later space failures.

When an unscoped search successfully inspects at least one space and another
target fails, search MUST continue with the remaining spaces. The call MUST
return `status: "success"`, usable `results`, and `complete: false`. It MUST
return a bounded top-level `warnings` array with at most one warning object
per failed space. It MUST return `warningCount` for the total failed spaces.
Each warning MUST carry exactly one type: `knowledge_space_unavailable`,
`knowledge_path_invalid`, or `knowledge_content_invalid`. Each warning MUST
carry the response-time space ID and name, and a safe message. A warning MUST
NOT attach to a valid result. `warningCount` can exceed `warnings.length` when
the structured output budget omits warning detail. A symbolic link that
enumeration reaches MUST be skipped. The skip MUST NOT fail the space and MUST
NOT add a warning. A complete success MUST return `complete: true`,
`warnings: []`, and `warningCount: 0`.

The tool MUST return the applicable top-level closed error and no partial
passages as complete, in these cases. An explicit target fails. Every target
eligible for an unscoped invocation fails. The owner has no current spaces.
The cursor is invalid. A global entry, file-count, byte, path, timeout,
cancellation, or output bound prevents completion. Every current space is
eligible on an initial unscoped call. Only the anchor space and later spaces
are eligible on an unscoped continuation. A currently owned target whose root
or stable-ID child cannot be resolved safely MUST return
`knowledge_space_unavailable`. An absent, removed, or other-owner explicit
target MUST return `knowledge_space_not_found`. A global safety or output
bound MUST return `knowledge_limit_exceeded`. Zero inventory for an unscoped
search MUST return `knowledge_space_not_configured`. When every non-revoked
eligible target fails with different space-scoped errors, the first failed
eligible target in deterministic inventory order MUST determine the top-level
error type and safe message. This error MUST hold only the existing `status`,
`type`, and safe `message` shape. It MUST omit `results`, `complete`,
`warnings`, `warningCount`, and `nextCursor`.

There is no operation-wide content revision or snapshot. A file changed after
it was inspected does not rewrite the recorded result. Another file inspected
later can reflect newer bytes.

#### Scenario: A path with no locator is not searched

- **WHEN** a Space contains an entry whose relative path fails path validation, such as a name containing a backslash or a control character
- **THEN** no passage and no locator is emitted for it, because no `kb://` spelling of it is valid
- **AND** the Space reports its existing `knowledge_path_invalid` condition rather than a locator `read` would refuse

#### Scenario: A colon path is searched with an encoded locator

- **WHEN** a Space contains a Markdown file whose relative path contains `:`, such as `notes/2026-09-08 14:30 standup.md`
- **THEN** search returns its passages with the locator `kb://<id>/notes/2026-09-08 14%3A30 standup.md:<start>-<end>`
- **AND** passing that locator unchanged to `read` opens the passage

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

#### Scenario: The walk policy skips infrastructure directories

- **WHEN** a Space holds a colocated jj repository, so `.jj` and `.git` exist beside the content trees
- **THEN** search completes over the content trees with `complete: true`
- **AND** no passage names any file below `.jj` or `.git`

#### Scenario: A nested repository below a Space is not searched

- **WHEN** a Space holds `notes/repo/.git` and Markdown files below `notes/repo`
- **THEN** no passage names a file below `notes/repo/.git`
- **AND** search still returns passages from the Markdown files outside it

#### Scenario: An ignore file excludes a vendored tree from search

- **WHEN** a Space root holds `.ignore` naming `.agents/`, and `.agents/skills/*/SKILL.md` holds a literal match
- **THEN** search returns no passage from below `.agents`
- **AND** the call stays a complete success with no warning

#### Scenario: A symbolic link entry is skipped without a warning

- **WHEN** a Space holds `.claude/skills/<name>` links and Markdown records beside them
- **THEN** search returns the records' passages with `complete: true` and `warningCount: 0`
- **AND** no link fails the Space and no link produces a warning

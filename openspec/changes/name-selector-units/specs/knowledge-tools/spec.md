## MODIFIED Requirements

### Requirement: Knowledge search scans one or all current spaces deterministically within global bounds

`knowledge_search` MUST accept these arguments:

- a literal query that is not empty, with at most 200 Unicode code points,
- an integer result limit from 1 through 10, with the default 5,
- an optional `knowledgeSpaceId`,
- an optional opaque continuation cursor.

When the identifier is present, search MUST target only that space, which the owner can currently
access. When the identifier is absent, search MUST iterate the complete current inventory of the
owner in `(createdAt, id)` keyset pages. It MUST NOT hold the uncapped inventory in memory.
Inventory pages MUST obey the same operation timeout and cancellation signal, and MUST have no
separate cap on the total count of spaces.

Before search opens each targeted child, it MUST check current access again under the trusted Run
owner. A row from an unscoped inventory page can lose access before that check. Search MUST then
omit it as no longer current, and MUST NOT add a warning or increase `warningCount`. When no
accessible target remains, the call MUST return `knowledge_space_not_configured`. Within a space,
search MUST order files by Knowledge-relative path.

Search MUST do a case-insensitive literal scan of safe UTF-8 Markdown files, as it reads them from
the live targeted spaces. A file whose Knowledge-relative path contains `:`, `?`, `#`, or `%` MUST
be searched like any other file. Its emitted locator MUST percent-encode exactly those characters
in the affected segments and keep every other character literal. Thus the locator is directly a
valid `read` argument.

LF MUST end one logical line, and CRLF MUST be one line delimiter. A lone CR MUST stay source text.
A final delimiter MUST NOT create a phantom line. Each literal occurrence MUST add a candidate
passage: its logical line, plus at most one logical line before it and one after it. Occurrences
on the same line MUST share one candidate.

Within one file, search MUST sort the candidate passages. Before it applies the result limit, it
MUST unite them transitively when they overlap or touch. Search MUST then divide a united interval
longer than 2,000 logical lines into adjacent deterministic passages of at most 2,000 lines. Each
emitted passage MUST contain a literal match, and together the passages MUST cover the complete
united interval.

Search MUST return passages in a deterministic order: space `(createdAt, id)`, then relative path,
then the start line of the passage. It MUST use no grep subprocess, regular expression, Markdown
parser, index, or PostgreSQL content projection.

Each returned passage MUST carry these fields:

- the response-time Knowledge Space identifier and display name,
- the exact Knowledge-relative path,
- a `locator` of the form `kb://<space-id>/<path>:L<start>-<end>`,
- an `excerpt` of at most 500 Unicode code points.

The `locator` range MUST be one-based and inclusive, in the canonical selector spelling. It MUST be
the complete emitted window of source lines. The `locator` MUST be directly a valid `read`
argument. A passage MUST span at most 2,000 logical lines. Search MUST NOT emit zero-based
coordinates. When the window is longer than the excerpt cap, search MUST crop it visibly around a
literal match. The crop MUST NOT change the range of the locator. Search MUST NOT duplicate a separate
string of the match line. It MUST NOT expose a match mode while only literal search exists, and
MUST NOT expose a content hash or revision token.

The optional cursor MUST be canonical, opaque, Knowledge-local keyset state. It MUST bind the
query, the optional explicit selector, and the ordering tuple of the last returned passage. A
cursor with different request bindings or malformed state MUST fail closed as invalid input. An
unchanged accessible corpus MUST give deterministic pages that do not overlap.

The cursor MUST NOT claim a filesystem snapshot. Search resolves current access again on each
continuation, and removed resources disappear. Concurrent changes to files or to the inventory can
add newly ordered passages, or can skip passages ordered before the cursor. Search MUST return
`nextCursor` only when another passage currently exists after the last returned result. This also
applies to an incomplete successful page.

For an unscoped continuation, search MUST evaluate completeness for that invocation. It MUST NOT
open again a space ordered strictly before the space key of the cursor, because that space cannot
add a later passage. It MUST authorize and inspect again the anchor space and every later space.
Thus a continuation anchored after a failed space MUST NOT retry it. Search MUST evaluate again a
failed space after the last returned passage while that space stays after the anchor.

When that invocation also inspects at least one eligible space with success, the failure MUST add
another bounded warning. It MUST NOT suppress `nextCursor` when a later usable passage exists. An
incomplete page with no later passage MUST omit `nextCursor`. When every eligible target at or
after the anchor fails, the top-level error for that case MUST take precedence. That error MUST
omit warnings and continuation state. Spaces before the anchor that search skips MUST NOT count as
targets for that decision.

One tool call MUST share the existing global bounds across every target:

- at most 20,000 filesystem entries and 5,000 admitted Markdown files,
- at most 1 MiB for each file and 32 MiB of Markdown content in total,
- paths of at most 1,024 UTF-8 bytes and 32 components,
- a structured result of at most 15,000 JavaScript UTF-16 code units.

The call MUST also obey the common tool timeout and abort signal. Space boundaries and cursor
continuation MUST NOT reset a bound within one invocation. The requested result limit caps a
successful response, and is not a safety-bound failure. Search MUST return the first passages
after the optional cursor, up to that limit. It MUST continue the inventory traversal as necessary
to decide continuation and to report later space failures.

An unscoped search can inspect at least one space with success while another target fails. The
failure can be an unavailable binding of that space, an unsafe path or symbolic-link condition, or
invalid Markdown content. Search MUST then continue with the other spaces and return these
fields:

- `status: "success"` and the usable `results`,
- `complete: false`,
- a bounded top-level `warnings` array with at most one warning object for each failed space,
- `warningCount`, the total count of failed spaces.

Each warning MUST carry exactly one type: `knowledge_space_unavailable`, `knowledge_path_invalid`,
or `knowledge_content_invalid`. It MUST also carry the response-time space ID and name and a safe
message. A warning MUST NOT be attached to a valid result. `warningCount` can be more than
`warnings.length` when the structured output budget omits warning detail. A complete success MUST
return `complete: true`, `warnings: []`, and `warningCount: 0`.

In these cases the tool MUST return the applicable top-level closed error:

- an explicit target fails,
- every eligible target of an unscoped invocation fails,
- the owner has no current spaces,
- the cursor is not valid,
- a global entry, file-count, byte, path, timeout, cancellation, or output bound stops completion.

It MUST NOT then return partial passages as complete. On an initial unscoped call, every current
space is eligible. On an unscoped continuation, only the anchor space and later spaces are
eligible.

A target that the owner currently owns, but whose root or stable-ID child search cannot resolve
safely, MUST return `knowledge_space_unavailable`. An absent, removed, or other-owner explicit
target MUST return `knowledge_space_not_found`. A global safety or output bound MUST return
`knowledge_limit_exceeded`. An unscoped search with no inventory MUST return
`knowledge_space_not_configured`.

Every eligible target of an unscoped invocation that is not revoked can fail with different
space-scoped errors. The first failed eligible target in deterministic inventory order MUST then
give the top-level error type and safe message. This error MUST contain only the existing
`status: "error"`, `type`, and safe `message` shape. It MUST omit `results`, `complete`,
`warnings`, `warningCount`, and `nextCursor`.

There is no content revision or snapshot for the operation. A change to a file after search
inspects it does not change the recorded result. Another file that search inspects later can show
newer bytes.

#### Scenario: A path with no locator is not searched

- **WHEN** a Space contains an entry whose relative path fails path validation, such as a name with a backslash or a control character
- **THEN** search emits no passage and no locator for it, because no `kb://` spelling of it is valid
- **AND** the Space reports its existing `knowledge_path_invalid` condition, not a locator that `read` refuses

#### Scenario: A colon path is searched with an encoded locator

- **WHEN** a Space contains a Markdown file whose relative path contains `:`, such as `notes/2026-09-08 14:30 standup.md`
- **THEN** search returns its passages with the locator `kb://<id>/notes/2026-09-08 14%3A30 standup.md:L<start>-<end>`
- **AND** a `read` of that locator, unchanged, opens the passage

#### Scenario: Search finds a live note

- **WHEN** one targeted Knowledge Space contains two literal matches that do not overlap, in one bounded UTF-8 Markdown file
- **THEN** search returns two candidate passages, unless a merge makes their context windows one passage
- **AND** each result carries a reusable `kb://` locator and a bounded excerpt without a content hash

#### Scenario: Overlapping match windows merge

- **WHEN** a set of literal occurrences gives a chain of context windows that touch or overlap in one file
- **THEN** search returns one merged passage for that source range
- **AND** the merge is the transitive interval union, not a split that depends on order
- **AND** the requested result limit counts the merged passage once

#### Scenario: A transitive match chain remains readable

- **WHEN** match windows that touch or overlap unite transitively into more than 2,000 logical lines
- **THEN** search divides the complete merged interval into adjacent passages of at most 2,000 lines, each with a literal match
- **AND** locators that `read` accepts cover every match line in deterministic order

#### Scenario: Search passage expands through read

- **WHEN** an assistant passes the `locator` of a search result unchanged to `read`
- **THEN** read addresses the complete current window of logical lines that the passage covered, plus native context lines
- **AND** neither call needs a file hash for the model or a second coordinate system

#### Scenario: Cursor continues an unchanged corpus

- **WHEN** deterministic search has more passages than the requested result limit, and the caller continues with `nextCursor` and the same query and selector
- **THEN** the next page starts after the last prior passage and does not repeat it
- **AND** pagination at last makes every bounded passage reachable

#### Scenario: Cursor remains live across changes

- **WHEN** current access or file content changes between search pages
- **THEN** continuation authorizes current resources again and searches current bytes after the stored ordering tuple
- **AND** it does not claim snapshot completeness across calls

#### Scenario: Newly changed file is immediately visible

- **WHEN** a Markdown file is created or changed without a Git commit
- **THEN** a later search sees its current bytes
- **AND** no accepted revision or clean worktree state is necessary

#### Scenario: Corpus bound is exceeded

- **WHEN** a search can complete only past a global traversal, content, path, timeout, or output bound
- **THEN** the tool returns the applicable closed limit or cancellation outcome
- **AND** it returns no partial passages as complete

#### Scenario: Omitted selector searches current inventory

- **WHEN** an owner has two spaces with current access and search omits `knowledgeSpaceId`
- **THEN** search traverses both in `(createdAt, id)` order under one shared operation budget
- **AND** each passage identifies its source space by stable ID and response-time name

#### Scenario: Requested result limit caps a successful response

- **WHEN** deterministic search finds more passages than the requested result limit
- **THEN** the tool returns the first passages up to the requested limit as a successful result
- **AND** it returns `nextCursor` when another current passage exists

#### Scenario: Explicit selector narrows and reauthorizes

- **WHEN** search supplies one `knowledgeSpaceId` that the owner can currently access
- **THEN** search checks that resource again and traverses only its stable-ID child
- **AND** search inspects no other space

#### Scenario: Revoked unscoped target is no longer current

- **WHEN** an unscoped inventory page contains a space whose access is removed before its check before open
- **THEN** search omits that target, adds no warning, and does not increase `warningCount`
- **AND** an explicit request for that same identifier still returns `knowledge_space_not_found`

#### Scenario: One failed space produces incomplete success

- **WHEN** an unscoped search inspects one space with success and another space has a safe space-scoped failure
- **THEN** the tool returns the usable passages with `complete: false`
- **AND** bounded call-level warnings identify the failed space and expose no host details

#### Scenario: A failed space before the cursor anchor is not retried

- **WHEN** an unscoped page warns for a failed space ordered before its last returned passage, and gives a cursor for a later passage
- **THEN** continuation starts after that passage and does not open the earlier failed space again
- **AND** completeness and warnings describe only the continuation invocation

#### Scenario: A failed space after the cursor anchor is re-evaluated

- **WHEN** an unscoped continuation inspects one eligible space with success and has a failed space ordered after its anchor
- **THEN** continuation authorizes and tries that space again while it stays after the anchor
- **AND** the failure does not suppress a cursor for a later usable passage
- **AND** a final incomplete page with no later passage omits `nextCursor`

#### Scenario: Every eligible continuation target fails

- **WHEN** every target that is not revoked, at or after the anchor of an unscoped continuation, fails
- **THEN** the first failed eligible target in deterministic order gives the top-level closed error
- **AND** skipped spaces before the anchor do not count, and the error omits results, warnings, and continuation state

#### Scenario: All failed spaces produce a top-level error

- **WHEN** every target of an unscoped search fails before it gives a complete search of its space
- **THEN** the first target that is not revoked, in deterministic inventory order, gives the top-level closed error
- **AND** the error omits results and continuation state, and does not show the collected passages as complete

# knowledge-tools

## Purpose

Defines bounded read-only tools that let the model search and read the current owner's live Markdown Knowledge Space with safe response-time path, line-range, and excerpt attribution.

## Requirements

### Requirement: Knowledge tools derive filesystem authority from trusted worker and Run context

The system SHALL register `knowledge_search` as a code-owned `read_only` tool; Knowledge file reads, edits, and writes are the `kb://` locator of the native file tools. Its executor SHALL receive the trusted Run owner identity and resolve current owner resources under tenant enforcement at each tool invocation. Model arguments MAY contain a Knowledge Space identifier only where the tool contract permits selection; they SHALL contain no owner ID, configured root, child directory, source key, host path, or alternate resource locator.

Changing a tool path, query, guessed identifier, or persisted argument SHALL NOT widen current owner access. A guessed, absent, removed, or other-owner explicit identifier SHALL return the same closed `knowledge_space_not_found` result even when the owner has no current spaces. An unscoped search by an owner with no current spaces SHALL receive `knowledge_space_not_configured`. Neither result SHALL reveal whether another owner, row, or directory exists.

At worker attempt preparation, `knowledge_search` eligibility SHALL depend on its trusted code-owned declaration, `read_only` classification, exact operator allowlist entry, and process configuration—not on owner inventory. With a configured `knowledge.root`, an otherwise-eligible `knowledge_search` SHALL remain advertised when the owner currently has zero spaces; a later call SHALL signal `knowledge_space_not_configured` to the model. When `knowledge.root` is absent from the executing worker process, the existing closed `knowledge_space_unavailable` runtime availability state SHALL apply without filesystem probes during attempt admission. API acceptance SHALL neither resolve Knowledge availability nor probe the filesystem. The same configured root SHALL make the native `read`, `edit`, and `write` tools eligible for `kb://` locators as defined by `native-file-tools`, and the native `grep` tool eligible for `kb://` scopes as defined by `grep-tool`.

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

- **WHEN** the executing worker process has no configured Knowledge root
- **THEN** the attempt's runtime availability marks each otherwise-eligible Knowledge tool unavailable with `knowledge_space_unavailable`
- **AND** admission performs no filesystem probe, and no private host path is disclosed in model-facing or owner-visible output

#### Scenario: A new resource is visible within an existing Run

- **WHEN** the owner gains a Knowledge Space after the attempt was prepared
- **THEN** a later Knowledge tool invocation resolves the new current inventory
- **AND** no Run or Chat binding must be updated

#### Scenario: Revoked access fails on the next check

- **WHEN** the owner loses access after one successful Knowledge call
- **THEN** the next call or not-yet-opened search target rejects the resource
- **AND** previously persisted results remain historical observations

#### Scenario: Knowledge root makes grep eligible

- **WHEN** `knowledge.root` is configured and `tools.allowed` names `grep`
- **THEN** `grep` is advertised and a `kb://` scope resolves under the owner's identity

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

### Requirement: Retrieval persists safe response-time attribution

Each new successful search passage MUST include five fields. These are the
logical Knowledge Space identifier, the display name at response time, and the
exact Knowledge-relative path. The other two are the `kb://` locator with its
one-based line range, and a bounded excerpt. `kb://`
read, list, edit, and write results follow the result contract of the native file
tools and carry the same Space identifier and display name. These fields describe
what that live call observed. They MUST NOT claim that a path, a display name, an
authorization binding, coordinates, or content stays the same or replays forever. New results MUST
expose no content hash, expected hash, revision, configured root, or resolved host
path.

The fields MUST stay complete in the persisted tool-result part, in the live event
stream, and in browser reconstruction. Knowledge success results preflight below
the live-result cap, so nothing cuts them. Later model replay MUST carry the result as the live
loop sent it, under `turn-replay`. A successful search that records
`complete: false` keeps that field in each later replay.

Historical persisted Knowledge observations MUST stay immutable. A result written
before this change can keep its original `contentHash`, matching-line, and snippet
fields. Replay and browser reconstruction MUST keep those fields as recorded. They
MUST NOT add new range fields or remove historical attribution. Historical
`knowledge_read` observations MUST render as recorded. The tool no longer exists,
and a Run whose snapshot names it fails closed before the provider request.

The persisted observation MUST include the bounded excerpt or the returned
Markdown in the PostgreSQL stores of Run events and assistant message parts. It
MUST follow the Run and Chat retention and deletion lifecycle of those stores.
This execution history MUST NOT become a canonical Knowledge content projection,
an index, a source store, or another read authority. The system MUST add no
separate Knowledge-content persistence, and each later retrieval MUST read the
live files again.

Attribution MUST exclude configured roots, resolved child paths, hosted owner ids,
credentials, worker identity, and raw filesystem diagnostics. The structured
tool-result UI MUST show the display name at response time, the stable
identifier, the Knowledge-relative path, and the locator. Thus two spaces with
the same name stay different. `kb://` results render through the renderer of the
`read` tool, which shows the same fields from the native envelope. The packaged
tool description MUST tell the model to cite the space and the path of a note that
it uses. The system MUST NOT change arbitrary provider text to make a citation.

#### Scenario: Browser reload retains attribution

- **WHEN** a Chat uses a new successful Knowledge passage and the browser reloads
- **THEN** the rebuilt result keeps the same space identifier, response-time name, path, locator, and recorded excerpt
- **AND** it requires no content hash

#### Scenario: Historical hash-bearing result remains historical

- **WHEN** a Chat reloads a Knowledge result persisted before this change
- **THEN** its original hash, matching line, snippet, or complete content stays as recorded
- **AND** replay does not rewrite it into the new result shape

#### Scenario: Later file change does not alter history

- **WHEN** a space name or a file changes after the system persisted a successful tool result
- **THEN** the persisted result keeps its original response-time name, path, locator, and excerpt
- **AND** a later tool call can return different metadata, ranges, or bytes

#### Scenario: Browser Chat exposes the note citation

- **WHEN** a browser Chat finds and uses a live note from one of several spaces
- **THEN** the structured result visibly cites the response-time space identity and the Knowledge-relative path
- **AND** the tool description tells the model to cite both in its answer, with no configured or resolved host path

#### Scenario: Payload-cleared replay preserves incomplete search honesty

- **WHEN** a successful search with `complete: false` replays on a later turn
- **THEN** the replay carries `complete: false` as the live loop sent it
- **AND** no replay clears the payload, so the call cannot look like a complete search

### Requirement: Knowledge content is untrusted and potentially stale

The `knowledge_search` declaration, the native `read` declaration's `kb://` guidance, and every model-visible Knowledge result MUST carry the closed notice. The notice identifies filesystem content, `kb://` reads and listings included, as owner-maintained, untrusted context that can be stale. The runtime MUST NOT rewrite or neutralize `kb://` content, with one exception: the reserved-name rule of `tool-result-rendering` escapes a tag that names a reserved delimiter. The framing is carried by the notice and the declarations so that returned bytes remain usable as exact `edit` targets. A `kb://` read whose file is an image MUST return the image result with the closed notice and no file content. An image result is not an `edit` target, because it carries no text to copy as `oldText`. It carries no `media://` locator because the image is not stored. The tools MUST NOT grant instructions inside notes authority over the system prompt, tool permissions, owner linkage, configured root, or execution environment. The model-facing contract MUST direct materially volatile claims to appropriate external verification when those tools are available.

#### Scenario: Note attempts to widen authority

- **WHEN** a note instructs the model to select another directory, enable a tool, reveal a host path, or override system policy
- **THEN** no tool availability, linkage, or execution scope changes

#### Scenario: Knowledge read carries the notice verbatim

- **WHEN** the model reads a note through `kb://`
- **THEN** the result includes the closed untrusted-content notice
- **AND** the note's text is not neutralized: the selected source bytes are returned unchanged apart from the generated line-number prefixes, which `:raw` omits, and apart from a tag naming a reserved delimiter, which the reserved-name rule escapes

#### Scenario: Note contains a volatile claim

- **WHEN** a retrieved note contains a claim whose current truth materially affects the answer
- **THEN** the model-facing contract identifies the note as potentially stale and directs external verification rather than treating filesystem presence as proof

#### Scenario: A Knowledge image carries the notice and no edit text

- **WHEN** the model reads `kb://<id>/diagrams/flow.png`, whose bytes are a PNG image
- **THEN** the result includes the closed untrusted-content notice, and carries no file content and no `media://` locator
- **AND** no media object is created for the image, and the stored Knowledge file is unchanged

### Requirement: A kb:// PDF read returns the PDF result with the Knowledge notice

A `kb://` read whose file is a PDF SHALL return the PDF result with the closed untrusted-content notice and no file content. A PDF result is not an `edit` target, because it carries no text to copy as `oldText`, and it carries no `media://` locator because the PDF is not stored.

#### Scenario: A Knowledge PDF carries the notice and no edit text

- **WHEN** the model reads `kb://<id>/papers/paper.pdf`, whose bytes are a PDF
- **THEN** the result includes the closed untrusted-content notice, and carries no file content and no `media://` locator
- **AND** no media object is created for the PDF, and the stored Knowledge file is unchanged

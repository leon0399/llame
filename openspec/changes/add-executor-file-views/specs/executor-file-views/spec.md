## Purpose

Provides one authorized, disposable Knowledge editing view that native and
managed executors can share while keeping source identity, ownership, and draft
state under trusted harness control.

## ADDED Requirements

### Requirement: A FileView binds one trusted Run and Knowledge Space

The system SHALL admit a FileView only from trusted Run identity and a current
owner-authorized Knowledge Space binding. The private binding SHALL retain an
opaque view ID, Run identity, stable Knowledge Space ID, Knowledge-relative
source identity, trusted source root, private view root, base manifest hashes and
bytes, and observed read coverage. None of those private fields, including
hashes, host paths, or roots, SHALL be accepted from or returned to the model.

At most one writable Knowledge Space/view SHALL be active for a Run. A private
scratch area MAY be attached when the selected executor requires it, but scratch
content SHALL remain separate from the Knowledge source set and SHALL not grant
another source binding.

The FileView lifetime SHALL remain independent of any executor process,
SandboxInstance, or branch/session placement. The one-writable-view-per-Run
restriction is a staged mutation-scope rule; it SHALL not make the view ID an
executor ID or require the view to be recreated when an executor is replaced or
reused.

#### Scenario: Trusted admission creates one writable view

- **WHEN** a Run with an authenticated owner selects one currently accessible
  Knowledge Space and the executor policy admits a writable view
- **THEN** the harness creates one opaque view binding containing that Run and
  stable Space identity
- **AND** no caller-supplied owner, root, or host path participates in authority

#### Scenario: Missing or revoked authority fails admission

- **WHEN** a view is requested without trusted Run identity, without a current
  owner binding, or after the owner has lost access to the Space
- **THEN** admission returns a closed `file_view_not_admitted` or
  `file_view_not_found` error
- **AND** it does not probe a guessed directory or select another Space

#### Scenario: A Run cannot bind two writable Spaces

- **WHEN** a Run with an active writable view attempts to admit another writable
  Knowledge Space
- **THEN** the new admission is refused with a closed view-state error
- **AND** the first view and its drafts remain unchanged

#### Scenario: Scratch does not become Knowledge authority

- **WHEN** an executor writes a private scratch file beside the active view
- **THEN** the scratch file is unavailable through the Knowledge source mapping
- **AND** it cannot select, replace, or publish a Space file

#### Scenario: Executor replacement does not recreate the view

- **WHEN** an already admitted view is detached from one executor instance and a
  later authorized executor attaches to the same Run
- **THEN** the view ID, base, draft bytes, and private revision remain the same
- **AND** the adapter performs a fresh authorization check before attachment

### Requirement: Source identity and execution paths remain separate

The portable source identity SHALL remain the existing stable Knowledge Space ID
plus a Knowledge-relative path. A model-facing FileView path SHALL be a logical
path rooted under `/knowledge/<space-id>/` with a normalized relative suffix,
for example `/knowledge/<space-id>/notes.md`. The logical path SHALL map to the
private execution view root, and the mapping SHALL never expose or persist a
host path as source identity.

The path suffix SHALL identify one regular UTF-8 Markdown file. It SHALL reject
absolute host paths, empty, `.` or `..` components, backslashes, NUL or control
characters, symbolic-link components or entries, paths over 1,024 UTF-8 bytes or
32 components, and a final component without a case-insensitive `.md` suffix.
The view SHALL exclude `.git`, credentials, runtime configuration, and files
outside the admitted source set.

#### Scenario: Logical path maps to the selected Space

- **WHEN** the model reads `/knowledge/<space-id>/notes.md` in an admitted view
- **THEN** the adapter opens only the `notes.md` path beneath that view's private
  root
- **AND** attribution retains the stable Space ID and relative path without a
  host path

#### Scenario: Traversal or host path is rejected

- **WHEN** a file operation supplies a host absolute path, traversal component,
  backslash, empty component, or control character
- **THEN** it returns `file_view_path_invalid`
- **AND** no path outside the admitted view is opened

#### Scenario: Symlink and excluded metadata are unavailable

- **WHEN** a requested component or entry is a symbolic link, `.git` metadata,
  credentials, or runtime configuration
- **THEN** the operation returns a closed path or not-found error
- **AND** it does not follow, copy, or expose the target

#### Scenario: Origin namespace is not invented

- **WHEN** a view binding is serialized for an adapter or later recovery
- **THEN** it contains the stable Space ID and relative paths needed by this
  capability
- **AND** it does not derive or persist an origin namespace or claim a
  cross-authority portable locator; the future #547 seam can add a stable origin
  namespace distinct from the current governing-authority binding

### Requirement: Writable views are bounded snapshots distinct from live reads

Opening a writable view SHALL capture a bounded snapshot of the admitted Space
or declared source set, including eligible uncommitted Markdown bytes, and SHALL
retain its base bytes and hashes privately. The view SHALL be labelled as a
snapshot: reads after a draft mutation SHALL see the view's current draft bytes,
while existing `knowledge_search` and `knowledge_read` calls SHALL continue to
read the current live Space. A live read SHALL never be silently redirected to
the view, and a view read SHALL never be silently redirected to live content.

The adapter SHALL expose one materialized private view directory as the draft
byte truth shared by FileView operations and configured executor tools. A
copy-on-write or overlay mechanism MAY back that directory, but an independent
in-memory draft store SHALL not become authoritative. Before a FileView `read`,
`edit`, or later publication handoff, the trusted adapter SHALL freeze other
writers, refresh the directory against the previous manifest, validate changed
paths and bytes, advance the private view revision, and invalidate coverage for
changed files. An invalid or unauthorized external change SHALL fail closed.

The view SHALL enforce bounded source admission, including at most 1 MiB per
file, safe paths, valid UTF-8, and the existing bounded Markdown source set. A
source change detected before admission SHALL produce `file_view_stale` rather
than opening a different base. A source change after admission SHALL not rewrite
the captured snapshot.

All writes and edits in C1 SHALL change only the disposable view. They SHALL not
write the live Space, create a Git commit, or create a publication receipt.

#### Scenario: View stays at its admitted base

- **WHEN** live Knowledge bytes change after a writable view is admitted
- **THEN** a view read returns the admitted bytes and later drafts
- **AND** a fresh `knowledge_read` returns the current live bytes

#### Scenario: Stale source cannot be silently rebased

- **WHEN** the source no longer matches the base validated for a requested view
  before admission completes
- **THEN** admission returns `file_view_stale`
- **AND** it does not open another revision or silently use live bytes

#### Scenario: Draft mutation has no canonical side effect

- **WHEN** `write` or `edit` succeeds in an admitted view
- **THEN** subsequent operations bound to that view observe the draft bytes
- **AND** the live Space and Git state remain unchanged until a later capability
  explicitly performs publication

#### Scenario: Executor changes are refreshed into the same view

- **WHEN** a configured executor changes a file in the materialized view and a
  later FileView read is admitted
- **THEN** the read sees that same changed byte sequence
- **AND** the harness advances the view revision and invalidates prior coverage
  for the changed file

#### Scenario: Invalid external change blocks the next operation

- **WHEN** refresh observes an unauthorized path, symbolic link, invalid UTF-8,
  or exceeded file bound in the materialized view
- **THEN** the next FileView operation returns a closed content, path, or limit
  error
- **AND** it does not expose or publish the invalid bytes

### Requirement: FileView read returns bounded numbered ranges and records coverage

The `read` operation SHALL accept only `{ path, offset?, limit? }`. `offset` SHALL
be a zero-based safe integer defaulting to zero; `limit`, when present, SHALL be
an integer from 1 through 2,000. It SHALL use the existing logical-line rules:
LF terminates a line, CRLF is one delimiter, lone CR remains source text, a
terminal delimiter creates no phantom line, and blank lines count. The selected
file SHALL be validated as complete UTF-8 while it is read.

A successful result SHALL contain the stable Space ID, Knowledge-relative path,
effective offset, returned line count, line-numbered content, and the existing
untrusted-content notice. It SHALL preserve each source line's delimiter and an
unterminated final line. `nextOffset` SHALL be returned exactly when current view
lines remain. The structured result SHALL fit the existing 15,000 JavaScript
UTF-16 code-unit cap; it SHALL return whole lines only, report `cutReason:
"line_limit"` or `"output_limit"` when a bound cuts the range, and SHALL return
`file_view_limit_exceeded` when the first selected line cannot fit. When an
explicit `limit` completes normally, `cutReason` SHALL be omitted even when
later current-view lines remain.

Each successful read SHALL record the exact returned byte/line range and the
current private view revision as harness coverage. A digest alone SHALL not count
as model-observed coverage. Read results SHALL expose no hash, revision token,
view root, or host path.

#### Scenario: A fitting view read returns source coordinates

- **WHEN** an admitted view contains a fitting Markdown file and `read` omits
  offset and limit
- **THEN** the result returns complete current-view content with offset zero and
  exact line count
- **AND** it omits continuation and cut-reason fields when the file ends

#### Scenario: Long content continues on whole lines

- **WHEN** a requested range reaches the line or output bound before the current
  view file ends
- **THEN** the result returns a whole-line prefix, the applicable cut reason,
  and `nextOffset` for the first omitted line
- **AND** the harness records coverage only for bytes actually returned

#### Scenario: Invalid range and oversized line fail closed

- **WHEN** `offset` is beyond the current view line range, `limit` is invalid, or
  the first selected line cannot fit the result cap
- **THEN** the operation returns `file_view_range_invalid` or
  `file_view_limit_exceeded`
- **AND** it does not return a clipped line or treat an invalid offset as EOF

#### Scenario: A complete read is coverage, not merely a hash

- **WHEN** the model reads every page of a file at one view revision
- **THEN** the harness can prove full-file byte coverage including the end marker
- **AND** it may authorize a later replacement at that same revision

### Requirement: Write requires complete coverage and produces a draft

The `write` operation SHALL accept only `{ path, content }`. `content` SHALL be
valid UTF-8 Markdown within the per-file byte bound. Replacing an existing file
SHALL require harness-recorded coverage of the complete current view file,
including EOF, at the current view revision. Creating a missing file SHALL
require an explicit harness observation of absence for that exact path at the
current base/revision; a caller assertion of absence SHALL not qualify.

The operation SHALL reject stale or incomplete coverage before changing the view.
On success it SHALL replace or create only the private draft and return a bounded
draft result with the logical path and draft state. It SHALL not return hashes or
private roots. A failed write SHALL leave the prior view bytes and coverage
unchanged.

#### Scenario: Partial read cannot authorize replacement

- **WHEN** the model has read only part of an existing file and calls `write`
- **THEN** the operation returns `file_view_coverage_required`
- **AND** it does not replace any draft or live bytes

#### Scenario: Full observed coverage authorizes replacement

- **WHEN** the harness has observed every byte of an existing file at the current
  view revision and `content` passes validation
- **THEN** `write` replaces that file in the disposable view
- **AND** a later view read returns the new draft while the live Space is intact

#### Scenario: Creation requires observed absence

- **WHEN** an admitted view read has recorded that an exact Markdown path is
  absent and `write` supplies valid content for it
- **THEN** the file is created in the disposable view
- **AND** a caller-supplied claim that the path was absent is never sufficient

#### Scenario: Stale coverage is refused

- **WHEN** a prior draft mutation or base change makes complete coverage belong to
  an older view revision
- **THEN** `write` returns `file_view_stale` or
  `file_view_coverage_required`
- **AND** the older observation cannot overwrite newer draft bytes

### Requirement: Edit requires uniquely matched observed coverage and produces a draft

The `edit` operation SHALL accept only `{ path, oldText, newText }`. It SHALL
perform one literal, exact replacement: `oldText` MUST be non-empty and occur
exactly once in the current view file, and the harness MUST have observed the
complete matched byte range at the current view revision. Full-file coverage is
not required when that target-range condition is met. Regular expressions,
fuzzy matching, and guessed hashes SHALL not qualify.

The operation SHALL return `file_view_match_not_found` when no match exists,
`file_view_match_ambiguous` when more than one match exists, and
`file_view_coverage_required` or `file_view_stale` when the unique match is not
covered at the current revision. It SHALL validate the resulting UTF-8 Markdown
and file-size bound before changing the view. A successful edit changes only the
private draft and returns a bounded draft result without hashes or host paths.

#### Scenario: A covered unique target edits without full-file coverage

- **WHEN** a read covers the unique `oldText` range and `edit` supplies a valid
  `newText` for the current view revision
- **THEN** exactly that occurrence is replaced in the disposable view
- **AND** unrelated unseen bytes are not rewritten

#### Scenario: Unobserved text cannot authorize an edit

- **WHEN** `oldText` happens to match but the model has not observed the complete
  matching range at the retained revision
- **THEN** `edit` returns `file_view_coverage_required`
- **AND** the draft remains unchanged

#### Scenario: Missing or repeated text fails without mutation

- **WHEN** `oldText` occurs zero times or more than once in the current view file
- **THEN** `edit` returns `file_view_match_not_found` or
  `file_view_match_ambiguous`
- **AND** it does not choose an occurrence or partially apply `newText`

#### Scenario: Edit cannot use stale observations

- **WHEN** the target was observed before another draft mutation changed that
  file's view revision
- **THEN** `edit` returns `file_view_stale` or
  `file_view_coverage_required`
- **AND** it cannot replace bytes from the older revision

### Requirement: Every new admission is reauthorized and every adapter sees one view

Each new FileView tool admission and each binding of a tool to a view SHALL
reauthorize the trusted Run owner, current Space access, stable Space ID, view
state, and selected executor policy. Model arguments SHALL not choose or expand
any of those values. Revocation or unavailable binding SHALL return a closed
error before filesystem access.

Native and managed-Sandbox adapters SHALL receive the same logical view root,
snapshot/draft revision, admitted source set, and path mapping. If an adapter
cannot give its configured tools that exact view, it SHALL refuse admission with
`file_view_executor_unavailable`; it SHALL not fall back to a live server copy,
another executor, or an unbounded host directory.

#### Scenario: Revocation blocks a later tool admission

- **WHEN** Space access is revoked after a view was opened and a new file-view
  tool is admitted for that Run
- **THEN** reauthorization rejects the admission
- **AND** no source or draft path is probed

#### Scenario: Configured tools share the mounted draft

- **WHEN** an admitted native or managed-Sandbox executor reads a file after a
  FileView `write` or `edit`
- **THEN** the configured tool observes the same logical path and draft bytes
- **AND** a separate stale copy is not used

#### Scenario: Missing mount fails closed

- **WHEN** the selected executor cannot mount the admitted view with the required
  logical root and restrictions
- **THEN** admission returns `file_view_executor_unavailable`
- **AND** it does not execute against a host path or silently use another backend

### Requirement: FileView failures and policy exposure are closed

Every failure SHALL use the structured `{ status: "error", type, message }`
shape with a finite server-authored type and safe message. The vocabulary SHALL
cover at least `file_view_not_admitted`, `file_view_not_found`,
`file_view_path_invalid`, `file_view_range_invalid`,
`file_view_content_invalid`, `file_view_limit_exceeded`, `file_view_stale`,
`file_view_coverage_required`, `file_view_match_not_found`,
`file_view_match_ambiguous`, `file_view_policy_denied`, and
`file_view_executor_unavailable`. Errors SHALL omit roots, host paths, owner
identifiers, hashes, credentials, raw filesystem exceptions, and other-owner
existence signals. Failed operations SHALL be atomic with respect to the view;
there SHALL be no silent native/live fallback.

C1 SHALL not add hosted persistent draft-write tools to the model's public tool
inventory or advertise them through `tools.allowed`; that exposure requires C2's
recovery gate. A personal adapter SHALL preserve #659's approval for each file
write/edit operation. The existing `knowledge_search` and `knowledge_read`
tools SHALL remain live tools with their current declarations and semantics.

#### Scenario: Hosted C1 Run does not advertise draft writes

- **WHEN** a hosted Run is accepted while only the C1 FileView contract is
  installed
- **THEN** its public tool inventory is unchanged and no persistent draft-write
  operation is advertised
- **AND** a direct unadmitted write request returns a closed policy error

#### Scenario: Personal approval remains per file operation

- **WHEN** a personal adapter receives two draft writes for two files
- **THEN** it applies the existing #659 per-file approval policy to each write
- **AND** adopting the shared contract does not widen one approval into a Run-wide
  grant

#### Scenario: Existing live Knowledge reads stay live

- **WHEN** a Run has an active writable FileView and calls `knowledge_read` or
  `knowledge_search`
- **THEN** those tools resolve current live Knowledge content under their existing
  owner-scoped contracts
- **AND** they do not silently alias to the FileView snapshot

#### Scenario: Closed errors contain no private diagnostics

- **WHEN** a view operation encounters an unavailable root, invalid file, or
  executor failure
- **THEN** the model receives only the closed structured error
- **AND** no raw path, stack, credential, or filesystem detail is returned

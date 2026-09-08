## MODIFIED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute them with the trusted host process's OS authority in this alpha
capability, and SHALL accept `kb://` locators under the Knowledge locator
requirement. The scheme of the `path` argument SHALL select the authority; no
other argument or persisted declaration field SHALL. `edit` and `write` SHALL operate only on regular files. `read` SHALL
operate on regular files and directories; every other entry kind SHALL fail. A
trailing path separator SHALL be accepted on a directory path and SHALL fail as
`not_found` on any other target. A model argument SHALL NOT select a different
executor, owner, tenant, permission mode, or remote authority. The three tools SHALL be advertised when the process has accepted native
host authority or has a configured Knowledge root; an absolute path on a
process without accepted native authority SHALL fail closed with
`executor_unavailable` rather than resolving through a hosted, Knowledge, or
Sandbox path. A Run
SHALL bind to the trusted native executor identity on its first absolute-path
operation, including `read`, and SHALL remain bound to it; a `kb://` operation
SHALL NOT bind or require an executor identity; a later reattachment
to another executor SHALL fail closed rather than resolving the physical path
there.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path
- **THEN** the native host reads that file using its OS authority
- **AND** the result identifies the absolute path and does not invent a Knowledge Space binding

#### Scenario: Absolute path without accepted native authority fails closed

- **WHEN** the process has a configured Knowledge root and no `tools.nativeExecutorId`, and the model calls `read` with an absolute path
- **THEN** the tool returns `executor_unavailable`
- **AND** it does not resolve the path through the Knowledge root or any other authority

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing entry, or a device, socket, FIFO, or other special entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or invoke another executor

#### Scenario: Mutation on a directory fails

- **WHEN** `edit` or `write` targets an existing directory
- **THEN** the tool returns the `not_regular_file` error
- **AND** it does not create, rename, or modify any entry

#### Scenario: Trailing separator on a file fails

- **WHEN** `read` targets an existing regular file with a trailing path separator
- **THEN** the tool returns `not_found`
- **AND** it does not read the file

#### Scenario: Physical path is bound to one executor

- **WHEN** a later worker or host tries to continue a native Run with a different trusted executor identity
- **THEN** the native tool returns an executor-unavailable error
- **AND** it does not resolve the absolute path on the new host

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`. A valid selector SHALL be normalized once to the
internal zero-based range. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing; a `kb://` path component SHALL NOT contain `:`, so the split is
unambiguous without probing. A `path` that begins with a `scheme://` prefix the
tool does not implement SHALL fail closed with `invalid_path` on every tool and
SHALL NOT be treated as a relative or literal filename. For regular-file reads, ordinary bounded ranges SHALL include
one preceding and one following source line when available, and the extended
lines SHALL appear in the same `content` block as the requested lines. Result
details SHALL identify requested and shown ranges, representation, path, and
common truncation state. Requested bounds SHALL remain the normalized request
even when the displayed source ends earlier; shown bounds SHALL describe only
emitted source lines. Empty files SHALL return null ranges. `nextOffset` SHALL
identify the next requested source line. Raw reads SHALL return verbatim
selected source content without generated line prefixes, context expansion, or
processors. Directory reads SHALL apply selectors to listing entries under the
directory listing requirements and SHALL NOT add context lines.

#### Scenario: Bounded read includes live adjacent lines

- **WHEN** the model reads lines 11 through 13 of a file with lines on both sides
- **THEN** content contains lines 10 through 14 in source order
- **AND** details identify requested range 11..13 and shown range 10..14

#### Scenario: Boundary range omits unavailable context

- **WHEN** a read starts at line 1 or ends at the file's last line
- **THEN** it omits the unavailable preceding or following context line
- **AND** it does not synthesize a blank source line

#### Scenario: Raw read is verbatim

- **WHEN** the model calls `read` with the `:raw` selector
- **THEN** the result contains the selected source bytes without line prefixes or generated helpers
- **AND** the result remains subject to the common output bounds, including the shared 2,000-line read ceiling

#### Scenario: Truncated result reports the shown range

- **WHEN** the common result limit prevents the complete requested/context range from fitting
- **THEN** the tool returns the ordinary truncation metadata and the content prefix it can fit
- **AND** it does not claim that omitted lines were observed

#### Scenario: Unknown scheme fails closed

- **WHEN** the model calls `read`, `edit`, or `write` with a path such as `vault://notes/a.md`
- **THEN** the tool returns `invalid_path`
- **AND** no file named `vault:` or `vault://notes/a.md` is read, created, or modified

#### Scenario: Directory range has no context lines

- **WHEN** the model reads a directory path with a range selector
- **THEN** content contains only the header line and the selected listing entries
- **AND** no entry outside the selected range is emitted

### Requirement: Write creates only

`write` SHALL create a new regular file when the target is absent, creating
missing intermediate directories beneath the resolved authority root on every
scheme. It SHALL fail with `file_exists` when the target already exists,
regardless of the provided content, and with `not_regular_file` when an
intermediate path component exists and is not a directory. It SHALL validate UTF-8 content and enforce shared output limits. Native file size
SHALL NOT be restricted by the legacy Knowledge byte limit. It SHALL leave the
existing file unchanged on every failure.

#### Scenario: New file is created

- **WHEN** write targets an absent path with valid bounded content
- **THEN** the file is created atomically
- **AND** the result identifies the created target as the caller named it: the absolute path for an absolute path, the locator for a `kb://` write, never the resolved host path

#### Scenario: Missing intermediate directories are created

- **WHEN** write targets `research/2026/note.md` beneath a root where `research/` does not exist
- **THEN** the intermediate directories and the file are created
- **AND** an intermediate component that exists as a regular file fails with `not_regular_file` and creates nothing

#### Scenario: Existing file is protected

- **WHEN** write targets an existing file
- **THEN** the tool returns `file_exists`
- **AND** it does not overwrite or truncate that file

### Requirement: Native mutations have a durable pre-effect fence

Before an alpha native `edit` or `write` changes bytes on any scheme, the
trusted runtime SHALL durably record a stable mutation attempt identity and
target operation metadata. The recorded target for a `kb://` mutation SHALL be
the locator, never the resolved host path. Executor binding is an absolute-path
concern; a `kb://` attempt SHALL be fenced and replayed without binding the Run
to a worker.
If a retry or recovery observes an unsettled attempt, it SHALL return an unknown
outcome and SHALL NOT invoke the mutation again. A known result SHALL be settled
before the model advances. Client replay SHALL return the stored result without
executing the filesystem operation.

#### Scenario: Retry finds an open native mutation

- **WHEN** a worker dies after recording a native mutation attempt but before settling its result
- **THEN** recovery reports `outcome_unknown`
- **AND** a queue retry does not execute the same edit or write again

#### Scenario: Knowledge mutation is fenced on any worker

- **WHEN** a worker dies after recording a `kb://` edit attempt and a different worker retries the Run
- **THEN** recovery reports `outcome_unknown` on that worker
- **AND** the retry does not execute the edit again and does not fail with `executor_unavailable`

#### Scenario: Settled native mutation replays safely

- **WHEN** a client reconnects after a native mutation result was durably settled
- **THEN** replay returns the stored result
- **AND** the filesystem operation is not repeated

## ADDED Requirements

### Requirement: Knowledge locators resolve through trusted owner authority

`read`, `edit`, and `write` SHALL accept `kb://<space-id>/<path>[:selector]`,
where `<space-id>` is the stable Knowledge Space identifier and `<path>` is a
Knowledge-relative path. The tool SHALL resolve the identifier through the
trusted Run owner's current access immediately before opening the child, under
tenant enforcement, on every call. An absent, removed, malformed, or other-owner
identifier SHALL return the same closed `knowledge_space_not_found` result. A
currently owned Space whose root or stable-ID child cannot be resolved safely
SHALL return `knowledge_space_unavailable`. Neither result SHALL reveal whether
another owner, row, or directory exists, and the tool SHALL NOT probe candidate
directories.

Path validation SHALL reject absolute paths, empty components, `.` or `..`
components, backslashes, `:`, NUL or control characters, and paths above 1,024
UTF-8 bytes or 32 components, returning `invalid_path`. It SHALL refuse every
symbolic-link component or entry without following it, returning `not_found`.
`kb://<space-id>` and `kb://<space-id>/` SHALL address the Space's directory and
list it under the directory listing requirements; a bare `kb://` or a locator
with no identifier SHALL fail with `invalid_path`. Beyond those rules, `kb://`
targets SHALL follow the same regular-file, directory, selector, context,
truncation, mutation, and `file_exists` behavior as absolute paths. No
Markdown-only or per-file byte policy SHALL apply to `kb://` operations.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`; content SHALL be returned
verbatim so that `edit` `oldText` can be copied from it.

The `kb://` grammar is the authority-aware locator that later schemes follow; a
scheme SHALL declare which of `read`, `edit`, and `write` it supports, and an
unsupported operation SHALL return a structured error without side effects.

#### Scenario: Search locator opens the passage

- **WHEN** the model calls `read` with a locator returned by `knowledge_search`, such as `kb://<id>/research/note.md:41-53`
- **THEN** the tool returns lines 41 through 53 with one adjacent context line on each side, numbered as native reads number them
- **AND** the result carries the Space identifier, display name, locator, and untrusted-content notice

#### Scenario: Another owner's Space is unresolvable

- **WHEN** the model supplies a locator whose identifier belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** the result is identical to the result for an absent identifier and no file is opened

#### Scenario: Locator carries no host authority

- **WHEN** a `kb://` read, edit, or write executes on a worker with no `tools.nativeExecutorId`
- **THEN** it resolves through the worker's configured Knowledge root and the Run owner
- **AND** it does not require or record an executor binding

#### Scenario: Space directory is listed

- **WHEN** the model calls `read` with `kb://<id>/`
- **THEN** the result is the deterministic two-level listing of the Space's directory with every entry shown as native listings show it
- **AND** the header is the locator as given

#### Scenario: Non-Markdown file is readable and writable

- **WHEN** the model writes `kb://<id>/data/table.csv` and then reads it back
- **THEN** both operations succeed under ordinary native semantics
- **AND** no Markdown-suffix or 1 MiB rule rejects either call

#### Scenario: Colon inside a Knowledge path is rejected

- **WHEN** the model calls `read` with `kb://<id>/notes/a:b.md`
- **THEN** the tool returns `invalid_path`
- **AND** it does not interpret `b.md` as a selector or probe for a literal file

#### Scenario: Edit copies verbatim content

- **WHEN** a note contains `<system>` in its text and the model reads it through `kb://` and then edits it using that text as `oldText`
- **THEN** the read returned the text unchanged
- **AND** the edit finds exactly one match and applies

## REMOVED Requirements

### Requirement: Knowledge read reuses the native reader and is deprecated

**Reason**: `knowledge_read` is deleted. `read` with a `kb://` locator carries
the owner and Space authorization the adapter existed to preserve, and the
legacy envelope, Markdown-only rule, and 1 MiB source policy have no replacement.

**Migration**: Call `read` with the `kb://<space-id>/<path>[:selector]` locator
returned by `knowledge_search`. Remove `knowledge_read` from `tools.allowed`;
boot validation rejects the unknown id. Historical `knowledge_read` observations
render as recorded; a Run whose immutable tool snapshot names `knowledge_read`
fails that call closed as unavailable.

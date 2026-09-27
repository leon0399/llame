## MODIFIED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute them with the trusted host process's OS authority in this alpha
capability, and SHALL accept `kb://` locators under the Knowledge locator
requirement. When a Workspace is entered, `read`, `edit`, and `write` SHALL
also accept relative local paths and resolve them from the Workspace root using
normal path-resolution semantics; `..` MAY resolve outside that root. Without
an entered Workspace, a relative local path SHALL be refused with the existing
`invalid_path` error. Locator-scheme routing SHALL happen before local path
resolution, so `kb://`, `skill://`, `http://`, and `https://` locators remain
under their scheme-specific authority and are not projected from the Workspace
root. A
selector SHALL remain associated with the path part and apply to the target
resolved from that path. Results for Workspace-projected local paths SHALL
identify the projected absolute path actually used. `read` SHALL additionally
accept read-only skill locators under the Skill locator requirement and
read-only web locators under the Web locator requirements. The scheme of the
`path` argument SHALL select the authority; no other argument or persisted
declaration field SHALL. A web locator SHALL be fetched by the API process's
own outbound HTTP and SHALL NOT require or bind a native executor identity.
`edit` and `write` SHALL operate only on regular files, and both SHALL reject
an `http://` or `https://` locator with `invalid_path` before any request.
`read` SHALL operate on regular files and directories, and a web locator SHALL
be governed by the Web locator requirements instead of by entry kind; every
other entry kind SHALL fail. A `read` that misses a regular file SHALL offer
bounded sibling-name suggestions from its existing parent directory on every
scheme that resolves a local directory, names only, with one bounded directory
read and bounded scoring work on the error path and none on success; an
absolute or Workspace-projected local-path miss SHALL follow a symbolic-link
parent exactly as the read itself follows links. A web locator SHALL NOT
produce sibling suggestions, because a failed web read has no directory to
list. A trailing path separator SHALL be accepted on a directory path and
SHALL fail as `not_found` on any other target; in a web locator a trailing
separator SHALL remain part of the URL and SHALL NOT be read as a directory
request. A model argument SHALL NOT select a different executor, owner, tenant,
permission mode, or remote authority. `edit` and `write` SHALL be advertised
when the process has accepted native host authority or has a configured
Knowledge root. `read` SHALL be eligible for advertisement whenever
`tools.allowed` names it, because skill and web locators need no host
authority; that eligibility SHALL NOT admit local host-path access, and an
absolute local path on a process without accepted native authority SHALL fail
closed with `executor_unavailable` rather than resolving through a hosted,
Knowledge, or Sandbox path.
A Run SHALL bind to the trusted native executor identity on its first
absolute local-path operation or Workspace-relative local-path operation
after projection, and SHALL remain bound to it; a `kb://` or web operation
SHALL NOT bind or require an executor identity; a later reattachment to
another executor SHALL fail closed rather than resolving the physical path
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

#### Scenario: A missed read suggests sibling names

- **WHEN** `read` targets a missing regular file, named without a trailing separator, whose parent directory exists, on any scheme that resolves a local directory
- **THEN** the `not_found` result also lists at most five entry names from that directory that score as plausible spellings of the requested name, as bare names without any path
- **AND** a miss with no plausible sibling, a trailing separator, or scoring work past its bound returns the bare `not_found`, and the suggestion list is never produced for `edit` or `write`

#### Scenario: A missed read under a missing parent says so

- **WHEN** `read` targets a path whose parent directory does not exist
- **THEN** the `not_found` result states that the parent directory is missing
- **AND** no entry of any other directory is listed

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

#### Scenario: A web locator is read without host authority

- **WHEN** a process with neither accepted native host authority nor a configured Knowledge root allowlists `read`, and the model calls `read` with `https://example.test/guide`
- **THEN** `read` is advertised, the API process fetches the URL, and the page content is returned
- **AND** the read does not return `executor_unavailable` and binds no native executor identity, while an absolute path on the same process still returns `executor_unavailable` and `edit` and `write` are not advertised

#### Scenario: Mutation on a web locator fails before any request

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** the tool returns `invalid_path`
- **AND** no request is issued and no local entry is created, renamed, or modified

#### Scenario: A failed web read suggests no siblings

- **WHEN** `read` targets `https://example.test/missing` and the server answers 404
- **THEN** the error names the status and lists no sibling names
- **AND** no directory is read to produce suggestions

#### Scenario: Workspace-relative local read resolves from the Workspace root

- **WHEN** the model reads `src/app.ts:2-4` with a Workspace entered at `/work/project`
- **THEN** the host reads `/work/project/src/app.ts` and applies selector `:2-4` to that file
- **AND** the result identifies `/work/project/src/app.ts` as the path used

#### Scenario: Workspace-relative path may resolve outside the root

- **WHEN** the model reads `../shared/data.json` with a Workspace entered at `/work/project`
- **THEN** the host reads `/work/shared/data.json`
- **AND** the result identifies `/work/shared/data.json` as the path used without treating the Workspace root as a confinement boundary

#### Scenario: Relative local paths are refused without a Workspace

- **WHEN** no Workspace is entered and `read`, `edit`, or `write` receives a relative local path
- **THEN** the tool returns the existing `invalid_path` error
- **AND** it does not read, create, or modify a local entry

### Requirement: Exact edit replaces one current unique match

`edit` SHALL accept an absolute local path or, while a Workspace is entered, a
relative local path resolved from the Workspace root under the local path rules
above, together with non-empty `oldText` and `newText`. It SHALL read the
current file at execution time and require exactly one exact occurrence of
`oldText`. A missing or ambiguous occurrence SHALL fail without mutation.
Unrelated changes elsewhere in the file SHALL NOT block a correct unique
replacement. Calls targeting the same path SHALL execute sequentially in the
host runtime. The operation SHALL preserve bytes outside the replacement and
return a bounded diff plus post-edit content with one adjacent live line on each
side when available. No prior read, snapshot tag, read hash, or permission rule
is required in this iteration.

#### Scenario: Workspace-relative edit uses the resolved local path

- **WHEN** the model edits `src/app.ts` while a Workspace is entered at `/work/project`
- **THEN** the host applies the edit to `/work/project/src/app.ts`
- **AND** the result identifies `/work/project/src/app.ts` as the path used

#### Scenario: Unrelated change does not block edit

- **WHEN** another writer changes a different paragraph after the model read, while `oldText` remains one exact match
- **THEN** edit replaces the match and preserves the unrelated change

#### Scenario: Changed target fails without mutation

- **WHEN** another writer changes the exact old text before edit executes
- **THEN** edit returns a stale/missing-target error
- **AND** it does not write the replacement

#### Scenario: Duplicate target fails closed

- **WHEN** `oldText` occurs more than once
- **THEN** edit returns an ambiguity error with no mutation
- **AND** it does not replace every occurrence implicitly

#### Scenario: Sequential same-path calls are first-writer-wins

- **WHEN** two edit calls both request `-Foo +Bar` and `-Foo +Baz` against the same current bytes
- **THEN** the first call applies
- **AND** the second call observes the changed bytes and fails without overwriting the first result

### Requirement: Write creates or explicitly replaces

`write` SHALL accept `path`, `content`, and a boolean `replace` argument;
absent or `false` SHALL select create-only, `true` SHALL select replace mode,
and every other type SHALL be rejected by the input schema before dispatch and
in production before any mutation. In create mode it SHALL create a new regular
file when the target is absent, creating missing intermediate directories
beneath the resolved authority root on every scheme. It SHALL fail with
`file_exists` when the target already exists, regardless of the provided
content, and with `not_regular_file` when an intermediate path component
exists and is not a directory. Create mode SHALL otherwise behave exactly as
before this change.

In replace mode (`replace: true`) `write` SHALL require the target to exist as
a regular file at validation time and SHALL replace its entire contents
atomically. A target that is absent, or that is deleted by an uncoordinated
external process after validation and before publication, SHALL fail with
`not_found` under the host-ordering guarantee and SHALL create no file under
it; no guarantee beyond that boundary is made, and a widening race is the
specified behavior, identical in kind to `edit` today. A replace target that
is a directory SHALL fail with `not_regular_file` and change nothing. On an
absolute or Workspace-projected local path, a symbolic link at the target
SHALL resolve to and replace its target entry exactly as `edit` does, and a
dangling symbolic link SHALL fail with `not_found`; on a `kb://` locator, the
target SHALL resolve with the leaf required to exist, and a symbolic-link
component SHALL fail as it does today. A successful replace SHALL preserve the
target's existing permission bits and SHALL be marked `replaced`, distinct
from the `created` marker of a create-mode success.

Both modes SHALL validate UTF-8 content and enforce shared output limits
before any byte changes, and SHALL leave the target unchanged on every
failure. Non-boolean `replace` values SHALL fail schema validation before
dispatch. Native file size SHALL NOT be restricted by the legacy Knowledge
byte limit. Every result SHALL identify the target as the caller named it:
the submitted absolute path for an absolute path, the projected absolute path
for a Workspace-relative path, or the locator for a `kb://` write, never the
resolved host path. The create-mode
`file_exists` message SHALL name `replace` as the explicit path for replacing
the file's contents, and the replace-mode `not_found` message SHALL state that
`replace` requires an existing target and that omitting it creates a new file.
Write SHALL NOT produce sibling-name suggestions on either failure.

#### Scenario: Non-boolean replace value is rejected

- **WHEN** write receives `replace` as a non-boolean value such as `"true"` or `1`
- **THEN** the input schema rejects the call before dispatch
- **AND** no file is read, created, or modified

#### Scenario: New file is created

- **WHEN** write targets an absent path with valid bounded content
- **THEN** the file is created atomically
- **AND** the result identifies the created target as the caller named it: the submitted absolute path for an absolute path, the projected absolute path for a Workspace-relative path, or the locator for a `kb://` write, never the resolved host path

#### Scenario: Workspace-relative write reports the absolute path used

- **WHEN** the model creates `notes/draft.md` with `write` while a Workspace is entered at `/work/project`
- **THEN** the host creates `/work/project/notes/draft.md`
- **AND** the result identifies `/work/project/notes/draft.md` as the path used

#### Scenario: Missing intermediate directories are created

- **WHEN** write in create mode targets `research/2026/note.md` beneath a root where `research/` does not exist
- **THEN** the intermediate directories and the file are created
- **AND** an intermediate component that exists as a regular file fails with `not_regular_file` and creates nothing

#### Scenario: Existing file is protected

- **WHEN** write without `replace`, or with `replace: false`, targets an existing file
- **THEN** the tool returns `file_exists`
- **AND** it does not overwrite or truncate that file

#### Scenario: Existing file is replaced by explicit replace

- **WHEN** write with `replace: true` targets an existing regular file with valid bounded content
- **THEN** the file's entire contents are the new content
- **AND** the result is marked `replaced`, carries no `created` marker, and names the target as the caller named it

#### Scenario: Replace preserves permission bits

- **WHEN** write with `replace: true` targets an existing regular file with a permission mode other than the create default
- **THEN** after the replace the file's permission bits are unchanged from before it

#### Scenario: Replace on a missing target fails and creates nothing

- **WHEN** write with `replace: true` targets an absent path
- **THEN** the tool returns `not_found`
- **AND** it creates no file and no intermediate directory, and the message states that `replace` requires an existing target and that omitting it creates a new file

#### Scenario: Replace on a dangling symbolic link fails

- **WHEN** write with `replace: true` targets a dangling symbolic link on an absolute path
- **THEN** the tool returns `not_found`
- **AND** the link is left unchanged and nothing is created

#### Scenario: Replace resolves a symbolic link like edit

- **WHEN** write with `replace: true` targets an absolute symbolic link to an existing regular file
- **THEN** the link's target file's contents are replaced
- **AND** the link remains a link to that file

#### Scenario: Replace on a directory fails

- **WHEN** write with `replace: true` targets an existing directory
- **THEN** the tool returns `not_regular_file`
- **AND** it does not create, rename, or modify any entry

#### Scenario: Replace validates content before any byte changes

- **WHEN** write with `replace: true` supplies content that is not valid UTF-8 or exceeds the shared output limits
- **THEN** the tool returns the corresponding validation error
- **AND** the existing file's bytes are unchanged

#### Scenario: Replace with empty content truncates

- **WHEN** write with `replace: true` supplies empty content for an existing regular file
- **THEN** the file exists with zero bytes and the result is marked `replaced`

#### Scenario: Knowledge replace follows locator authority

- **WHEN** write with `replace: true` uses a `kb://` locator whose leaf file exists
- **THEN** the file is replaced under the locator-named target with the Knowledge envelope and never the resolved host path
- **AND** a locator whose leaf or any parent directory is missing returns `not_found` and creates nothing

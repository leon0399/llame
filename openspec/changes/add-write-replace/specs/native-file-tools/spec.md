## RENAMED Requirements

- FROM: `### Requirement: Write creates only`
- TO: `### Requirement: Write creates or explicitly replaces`

## MODIFIED Requirements

### Requirement: Write creates or explicitly replaces

`write` SHALL accept `path`, `content`, and a boolean `replace` argument; absent
or `false` SHALL mean create-only. In create mode it SHALL create a new regular
file when the target is absent, creating missing intermediate directories
beneath the resolved authority root on every scheme. It SHALL fail with
`file_exists` when the target already exists, regardless of the provided
content, and with `not_regular_file` when an intermediate path component
exists and is not a directory. Create mode SHALL otherwise behave exactly as
before this change.

In replace mode (`replace: true`) `write` SHALL require the target to exist as
a regular file and SHALL replace its entire contents atomically. A missing
target SHALL fail with `not_found` and SHALL create no file and no intermediate
directory. A replace target that is a directory SHALL fail with
`not_regular_file` and change nothing. On an absolute path, a symbolic link at
the target SHALL resolve to and replace its target entry exactly as `edit`
does, and a dangling symbolic link SHALL fail with `not_found`; on a `kb://`
locator, the target SHALL resolve with the leaf required to exist, and a
symbolic-link component SHALL fail as it does today. A successful replace
SHALL preserve the target's existing permission bits and SHALL be marked
`replaced`, distinct from the `created` marker of a create-mode success.

Both modes SHALL validate UTF-8 content and enforce shared output limits
before any byte changes, and SHALL leave the target unchanged on every
failure. Native file size SHALL NOT be restricted by the legacy Knowledge byte
limit. Every result SHALL identify the target as the caller named it: the
absolute path for an absolute path, the locator for a `kb://` write, never the
resolved host path. The create-mode `file_exists` message SHALL name `replace`
as the explicit path for replacing the file's contents, and the replace-mode
`not_found` message SHALL state that `replace` requires an existing target and
that omitting it creates a new file. Write SHALL NOT produce sibling-name
suggestions on either failure.

#### Scenario: New file is created

- **WHEN** write targets an absent path with valid bounded content
- **THEN** the file is created atomically
- **AND** the result identifies the created target as the caller named it: the absolute path for an absolute path, the locator for a `kb://` write, never the resolved host path

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

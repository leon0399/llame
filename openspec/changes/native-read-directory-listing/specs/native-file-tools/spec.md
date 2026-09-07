## MODIFIED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute with the trusted host process's OS authority in this alpha
capability. `edit` and `write` SHALL operate only on regular files. `read` SHALL
operate on regular files and directories; every other entry kind SHALL fail. A
model argument SHALL NOT select a different executor, owner, tenant, permission
mode, or remote authority. A host that cannot intentionally accept native
authority SHALL leave these tools unavailable rather than silently substituting
a hosted or Sandbox path. A Run SHALL bind to the trusted native executor
identity on its first native operation, including `read`, and SHALL remain
bound to it; a later reattachment to another executor SHALL fail closed rather
than resolving the physical path there.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path
- **THEN** the native host reads that file using its OS authority
- **AND** the result identifies the absolute path and does not invent a Knowledge Space binding

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing entry, or a device, socket, FIFO, or other special entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or invoke another executor

#### Scenario: Mutation on a directory fails

- **WHEN** `edit` or `write` targets an existing directory
- **THEN** the tool returns the `not_regular_file` error
- **AND** it does not create, rename, or modify any entry

#### Scenario: Physical path is bound to one executor

- **WHEN** a later worker or host tries to continue a native Run with a different trusted executor identity
- **THEN** the native tool returns an executor-unavailable error
- **AND** it does not resolve the absolute path on the new host

## ADDED Requirements

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory, it SHALL return a listing of that
directory and its immediate child directories' entries, two levels deep. The
first content line SHALL be the absolute directory path. Each entry SHALL be
rendered on its own line, indented two spaces per level below the root, as
`- name/` for a directory, `- name` for a regular file, and `- name@` for a
symbolic link of any target kind. Symbolic links SHALL NOT be descended. Entries
below the second level SHALL be counted but never rendered. A directory with no
entries SHALL render `(empty directory)` as its only content line. Within one
directory, entries SHALL be ordered with directories first and then by name
under the host's collation. Entries SHALL be shown verbatim: hidden entries,
ignore files, and entry metadata SHALL NOT alter the listing in this iteration.
The listing SHALL be a pure function of entry names, kinds, counts, and the
host's collation, so two reads of an unchanged directory produce identical
content. Result details SHALL identify the absolute path and the directory
kind, and listing lines SHALL carry no generated line-number prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the absolute path, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@` without listing anything beneath it

#### Scenario: Empty directory

- **WHEN** the model reads a directory with no entries
- **THEN** content is the absolute path followed by `(empty directory)`

#### Scenario: Listing is deterministic

- **WHEN** the model reads the same unchanged directory twice
- **THEN** both results have byte-identical content and details

### Requirement: Directory listing bounds favor the requested level

The requested directory's own entries SHALL NOT be capped by a per-level limit.
Each child directory SHALL render at most 20 entries in order, followed by one
`… N more` line stating the number of omitted entries when any were omitted.
When the rendered listing exceeds the common native result cap, the tool SHALL
first remove second-level lines, last-first, and append one line stating how
many lines were elided; the requested level's lines SHALL be preserved by that
step. Only when the requested level alone still exceeds the cap SHALL the tool
apply the ordinary truncation metadata, including `nextOffset`, over the
requested level's listing lines. Range selectors on a directory path SHALL
select listing lines of the requested level, one-based, without context
expansion. The `:raw` selector on a directory SHALL fail with a selector error.

#### Scenario: Large child directory is summarized

- **WHEN** a child directory holds more than 20 entries
- **THEN** the listing shows its first 20 entries in order followed by `… N more` with the exact omitted count

#### Scenario: Oversized listing keeps the requested level

- **WHEN** the rendered two-level listing exceeds the common result cap but the requested level fits
- **THEN** second-level lines are removed last-first until the listing fits
- **AND** one line reports the elided line count
- **AND** every requested-level entry remains present

#### Scenario: Oversized requested level pages by selector

- **WHEN** the requested directory's own entries alone exceed the common result cap
- **THEN** the result carries the ordinary truncation details with `nextOffset`
- **AND** a range selector such as `:201-400` on the same directory returns the next listing lines without context expansion

#### Scenario: Raw selector on a directory is rejected

- **WHEN** the model reads a directory path with the `:raw` selector
- **THEN** the tool returns a selector error and no listing

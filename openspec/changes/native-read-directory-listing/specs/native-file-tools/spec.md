## MODIFIED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute with the trusted host process's OS authority in this alpha
capability. `edit` and `write` SHALL operate only on regular files. `read` SHALL
operate on regular files and directories; every other entry kind SHALL fail. A
trailing path separator SHALL be accepted on a directory path and SHALL fail as
`not_found` on any other target. A model argument SHALL NOT select a different
executor, owner, tenant, permission mode, or remote authority. A host that
cannot intentionally accept native authority SHALL leave these tools
unavailable rather than silently substituting a hosted or Sandbox path. A Run
SHALL bind to the trusted native executor identity on its first native
operation, including `read`, and SHALL remain bound to it; a later reattachment
to another executor SHALL fail closed rather than resolving the physical path
there.

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
internal zero-based range. Existing literal paths SHALL take precedence over
selector parsing. For regular-file reads, ordinary bounded ranges SHALL include
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

#### Scenario: Directory range has no context lines

- **WHEN** the model reads a directory path with a range selector
- **THEN** content contains only the header line and the selected listing entries
- **AND** no entry outside the selected range is emitted

## ADDED Requirements

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory without a range selector, it SHALL
return a listing of that directory and its immediate child directories'
entries, two levels deep. The first content line SHALL be the header: the
directory path as given by the caller. The header SHALL NOT count as a listing
entry. Each entry SHALL be rendered on its own line, indented two spaces per
level below the requested directory, as `- name/` for a directory, `- name` for
a regular file, and `- name@` for a symbolic link of any target kind. Symbolic
links found as entries SHALL NOT be descended. A symbolic link given as the
target path SHALL resolve to its target directory as file reads resolve today.
Entries below the second level SHALL be counted but never rendered. A directory
with no entries SHALL render `(empty directory)` as its only line after the
header. Within one directory, entries SHALL be ordered with directories first
and then by name under the host's collation. Entries SHALL be shown verbatim:
hidden entries, ignore files, and entry metadata SHALL NOT alter the listing in
this iteration. The listing SHALL be a pure function of entry names, kinds,
counts, and the host's collation, so two reads of an unchanged directory
produce identical content. Result details SHALL identify the path and the
directory kind, and listing lines SHALL carry no generated line-number
prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the header, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@` without listing anything beneath it

#### Scenario: Symbolic link target is listed

- **WHEN** the model reads a path that is a symbolic link to a directory
- **THEN** the result lists the target directory's entries
- **AND** the header is the path as given

#### Scenario: Empty directory

- **WHEN** the model reads a directory with no entries
- **THEN** content is the header followed by `(empty directory)`

#### Scenario: Listing is deterministic

- **WHEN** the model reads the same unchanged directory twice
- **THEN** both results have byte-identical content and details

### Requirement: Directory listing bounds favor the requested level

The requested directory's own entries SHALL NOT be capped by a per-level limit.
Each child directory SHALL render at most 20 entries in order, followed by one
`… N more` line stating the number of omitted entries when any were omitted.
When the rendered two-level listing exceeds the common native result cap, the
tool SHALL replace whole child blocks, last-first, where a child block is every
line rendered beneath one child directory including its `… N more` line, with
one indented `… N entries` line stating that child's total entry count; the
requested level's own lines SHALL be preserved by that step. An empty child
directory SHALL render as its `- name/` line alone, so a bare child line means
empty and an `… N entries` line means elided. Only when the requested
level's own lines still exceed the cap SHALL the tool apply the ordinary
truncation metadata, including `nextOffset`, over the requested level's entries.
A range selector on a directory path SHALL switch the read to a flat listing of
the requested level: the header, then the selected entries by one-based entry
index, with no child entries and no context expansion, regardless of whether
the two-level listing would have fit. `nextOffset` SHALL identify the next
entry index of the requested level. The `:raw` selector on a directory SHALL
fail with a selector error.

#### Scenario: Large child directory is summarized

- **WHEN** a child directory holds more than 20 entries
- **THEN** the listing shows its first 20 entries in order followed by `… N more` with the exact omitted count

#### Scenario: Oversized listing keeps the requested level

- **WHEN** the rendered two-level listing exceeds the common result cap but the requested level fits
- **THEN** whole child blocks are replaced last-first by `… N entries` lines until the listing fits
- **AND** every requested-level entry remains present with no partially rendered child block
- **AND** an empty child directory still renders as a bare `- name/` line

#### Scenario: Oversized requested level pages by selector

- **WHEN** the requested directory's own entries alone exceed the common result cap
- **THEN** the result carries the ordinary truncation details with `nextOffset`
- **AND** a range selector such as `:201-400` on the same directory returns the header and entries 201 through 400 of the requested level only

#### Scenario: Range selector on a small directory is flat

- **WHEN** the model reads a directory whose two-level listing fits the cap, with the selector `:1-5`
- **THEN** content is the header followed by the first five requested-level entries
- **AND** no child directory entries appear

#### Scenario: Raw selector on a directory is rejected

- **WHEN** the model reads a directory path with the `:raw` selector
- **THEN** the tool returns a selector error and no listing

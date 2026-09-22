# native-file-tools

## Purpose

Provides one bounded native file interface for local coding and file-backed
Knowledge work, with exact edits, create-or-replace writes, selector-based
reads, and future source/type extensions behind one result shape.

## Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute them with the trusted host process's OS authority in this alpha
capability, and SHALL accept `kb://` locators under the Knowledge locator
requirement. `read` SHALL additionally accept read-only skill locators under
the Skill locator requirement and read-only web locators under the Web locator
requirements. The scheme of the `path` argument SHALL select the authority; no
other argument or persisted declaration field SHALL. A web locator SHALL be
fetched by the API process's own outbound HTTP and SHALL NOT require or bind a
native executor identity. `edit` and `write` SHALL operate only on regular
files, and both SHALL reject an `http://` or `https://` locator with
`invalid_path` before any request. `read` SHALL operate on regular files and
directories, and a web locator SHALL be governed by the Web locator
requirements instead of by entry kind; every other entry kind SHALL fail. A
`read` that misses a regular file SHALL offer bounded sibling-name
suggestions from its existing parent directory on every scheme that resolves a
local directory, names only,
with one bounded directory read and bounded scoring work on the error path
and none on success; an absolute-path miss SHALL follow a symbolic-link
parent exactly as the read itself follows links. A web locator SHALL NOT
produce sibling suggestions, because a failed web read has no directory to
list. A trailing path separator SHALL be accepted on a directory path and
SHALL fail as `not_found` on any other target; in a web locator a trailing
separator SHALL remain part of the URL and SHALL NOT be read as a directory
request. A model argument SHALL NOT select a different
executor, owner, tenant, permission mode, or remote authority. `edit` and
`write` SHALL be advertised when the process has accepted native host
authority or has a configured Knowledge root. `read` SHALL be eligible for
advertisement whenever `tools.allowed` names it, because skill and web
locators need no host authority; that eligibility SHALL NOT admit
absolute-path host access, and an absolute path on a
process without accepted native authority SHALL fail closed with
`executor_unavailable` rather than resolving through a hosted, Knowledge, or
Sandbox path. A Run
SHALL bind to the trusted native executor identity on its first absolute-path
operation, including `read`, and SHALL remain bound to it; a `kb://` or web
operation SHALL NOT bind or require an executor identity; a later reattachment
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

### Requirement: Skill locators provide live read-only package access

`read` SHALL accept `skill://<name>[:selector]` for a package's `SKILL.md`, `skill://<name>/<path>[:selector]` for supporting files, `skill://<name>/` for its directory, and `skill://` for the current bounded catalog. The catalog form SHALL support pagination through native directory range selectors. Skill names SHALL follow the Agent Skills name grammar. Resource segments SHALL follow the Knowledge locator's once-only decoding, selector separation, size/depth, and traversal validation rules. Native directory/read/range/raw/truncation behavior SHALL apply except for the explicit catalog representation. `edit` and `write` SHALL reject skill locators as unsupported operations without effects.

The resolver SHALL re-evaluate the current winning package on each call through the catalog port. It SHALL take the current turn's explicit selection set as a parameter: a manual-only package's body or resource read SHALL return a bounded structured refusal naming explicit selection unless that set contains the package, and the catalog listing SHALL omit manual-only packages not in that set. The Run supplies the set derived from its triggering user message to every skill read it performs, model-initiated reads included; a caller with no turn context supplies an empty set. Symbolic links beneath a source or inside a package follow ordinary operating-system semantics as `agent-skills` specifies; the resolver SHALL NOT resolve, verify, or contain them for access. Missing/invalid packages, unsupported operations, and invalid resource paths SHALL return bounded structured errors. The resolver SHALL NOT read special files.

Results SHALL carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`, both as discovered beneath the configured source rather than resolved real paths. These paths and an instruction to resolve package-relative references/script paths into absolute paths using `skillDirectory` SHALL be present in model-facing output as well as owner metadata. That instruction SHALL distinguish task-relative inputs and explicit `cwd` from package-relative paths; the tool SHALL NOT rewrite commands. The result bound SHALL reserve space for this envelope before truncating resource content; if the envelope cannot fit, the read SHALL fail with a bounded error. This publication exception SHALL apply only to operator skill paths, not Knowledge paths. Ordinary permission admission SHALL match a pure canonical projection of the submitted skill locator before any resource open: decode resource segments once, validate and re-encode through the shared locator grammar, and omit read selectors. It SHALL never substitute a physical path. Existing configured/default read rules SHALL apply to that projection, including credential-path rejects; no skill-specific permission bypass or duplicate deny list SHALL be introduced.

#### Scenario: Skill resource exposes the execution base

- **WHEN** the model reads `skill://pdf/scripts/extract.py`
- **THEN** the result includes the current script content and model-visible file and package paths as discovered beneath the configured source, plus the real package directory
- **AND** no script executes during the read

#### Scenario: Skill root and directory differ

- **WHEN** the model reads `skill://pdf` and then `skill://pdf/`
- **THEN** the first reads `SKILL.md` and the second lists the package directory

#### Scenario: Raw root read returns the instructions verbatim

- **WHEN** the model reads `skill://pdf:raw`
- **THEN** the result carries the current `SKILL.md` bytes without line-number prefixes
- **AND** the skill result envelope with `skillDirectory` and `resolvedPath` is still present

#### Scenario: Manual-only package is not selected this turn

- **WHEN** a read targets `skill://review` and `review` is manual-only and absent from the turn's selection set
- **THEN** the read returns a bounded refusal naming explicit selection without opening the file
- **AND** `skill://` does not list `review`

#### Scenario: Special-file resource link fails

- **WHEN** a resource symlink resolves to a special file rather than a regular file or directory
- **THEN** the read fails `not_regular_file` without opening the target, because the followed target's kind is checked before any open

#### Scenario: Mutation is unsupported

- **WHEN** an edit or write targets `skill://pdf/SKILL.md`
- **THEN** it returns an unsupported-operation error without a mutation attempt or filesystem effect

### Requirement: Skill permission matching uses canonical resource identity

The same file permission rules SHALL inspect literal and encoded spellings of one skill resource as the same canonical locator before the resource is opened. Operator replacement policies SHALL retain their existing override semantics.

#### Scenario: Default credential rejects cover skill resources

- **WHEN** the built-in read policy is active and a call targets `skill://pdf/.env`, `skill://pdf/%2eenv:raw`, or `skill://pdf/.ssh/id_ed25519`
- **THEN** permission admission denies the read before any resource open
- **AND** an ordinary `skill://pdf/references/guide.md` is not rejected by those credential-path clauses

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`, plus comma-separated selectors under the
multi-range requirement below. A valid selector SHALL be normalized once to
internal zero-based ranges. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing; a `kb://` path component SHALL NOT contain `:`, so the split is
unambiguous without probing. A `path` that begins with a `scheme://` prefix the
SHALL NOT be treated as a relative or literal filename. For regular-file reads, ordinary single bounded ranges SHALL include
one preceding and one following source line when available, and the extended
lines SHALL appear in the same `content` block as the requested lines. For single-range reads, result
details SHALL identify requested and shown ranges, representation, path, and
common truncation state. Requested bounds SHALL remain the normalized request
even when the displayed source ends earlier; shown bounds SHALL describe only
emitted source lines. Empty files SHALL return null ranges. `nextOffset` SHALL
identify the next requested source line. Raw reads SHALL return verbatim
selected source content without generated line prefixes, context expansion, or
processors. Directory reads SHALL apply single-range selectors to listing entries under the
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

### Requirement: Reads through symbolic links report the real path

When a file `read` on an absolute host path opens a file whose canonical absolute path differs from the normalized path as given, because the path or any component of it is a symbolic link, the result SHALL carry that canonical path as `realPath`. A directory listing SHALL NOT carry `realPath`; its header is the path as given and its link entries carry their own targets. The header and line numbering SHALL remain those of the path as given; `realPath` SHALL count against the result bound like every other result field and SHALL be present before the result is measured, SHALL be absent when the two paths are equal, and SHALL be omitted with the read otherwise unaffected when the canonical path cannot be resolved. `kb://` and `skill://` reads SHALL NOT carry `realPath`. A `skill://` result SHALL instead carry the real package directory as `realSkillDirectory` in its envelope when it differs from `skillDirectory`, reserved before content exactly as the other envelope fields are; when the real directory cannot be resolved the field is omitted and the read is otherwise unaffected.

#### Scenario: File read through a linked directory

- **WHEN** the model reads `/home/u/.agents/skills/octocat/SKILL.md` and `octocat` is a symbolic link to `/home/u/dotfiles/skills/octocat`
- **THEN** content and header are exactly those of the path as given
- **AND** the result carries `realPath: /home/u/dotfiles/skills/octocat/SKILL.md`, counted within the result bound

#### Scenario: Ordinary read carries no real path

- **WHEN** the model reads a file whose normalized path contains no symbolic link, including one written with `..` segments
- **THEN** the result carries no `realPath`

#### Scenario: Skill result names both directories

- **WHEN** the model reads `skill://octocat` and the package is a symbolic link beneath its configured source
- **THEN** `skillDirectory` is the link path beneath the source
- **AND** the envelope also carries `realSkillDirectory` with the real package directory

### Requirement: Multi-range reads return context-bounded intervals

A regular-file `read` SHALL accept two or more comma-separated `N-M` or `N+K`
ranges, or `raw:` followed by two or more comma-separated `N-M` ranges.
Every bound SHALL satisfy the existing positive safe-integer rules. Invalid
bounds and more than 64 input ranges SHALL fail with `invalid_selector`. Empty
members, whitespace, or malformed members SHALL fail the whole request under
existing error precedence: `invalid_selector` for parsed host selectors and
`invalid_path` for malformed `kb://` locator suffixes.
The tool SHALL sort ranges by start, merge overlapping or adjacent ranges,
expand each merged interval by one preceding and one following source line
when available, clip the expansion to the file bounds, and merge expanded
intervals that overlap or sit adjacent. Raw multi-range requests SHALL NOT
expand context. A comma-separated request SHALL report plural range fields
even if normalization and expansion leave one interval.
Absolute literal-path precedence and scheme-specific authorization SHALL apply
before reading as for existing selectors. Directory comma selectors SHALL fail
with `invalid_selector`; ordinary directory selectors SHALL remain unchanged.

Multi-range results SHALL replace singular `requestedRange` and `shownRange`
with `requestedRanges` and `shownRanges`, arrays of one-based inclusive
`{startLine, endLine}` intervals. `requestedRanges` SHALL retain the merged
pre-expansion request; `shownRanges` SHALL describe only emitted lines,
including expansion. Content SHALL concatenate selected source lines in source
order, using existing numbered rendering or verbatim raw rendering, without gap
markers. `representation`, `path`, and `truncated` SHALL retain their existing
meanings. On reaching EOF, shown ends SHALL clip to available source and later
ranges SHALL emit nothing; EOF alone SHALL NOT indicate truncation. A nonempty
file whose first requested start exceeds EOF SHALL fail with
`invalid_selector`. An empty file starting at line 1 SHALL return empty content
and empty arrays; other starts SHALL fail.

The existing serialized-result cap, including metadata and the authority's
envelope, and shared 2,000-line ceiling SHALL apply once to the entire result.
If the required metadata cannot fit, the call SHALL fail with `invalid_selector`.
The tool SHALL return a prefix of expanded ranges, favoring whole ranges:
after emitting one complete range, a subsequent range that cannot fit SHALL be
omitted in full and end the read. If the first range cannot fit, the tool SHALL
emit the complete source lines from its prefix that fit. An individually
oversized line SHALL be omitted and skipped without ending the read: the tool reports truncation and continues past it.
A truncated result's zero-based `nextOffset`, when present, SHALL identify the
first remaining selected line, skipping gaps and an individually oversized
line that cannot fit on retry. It SHALL be absent when no selected line remains.
A caller SHALL resume by trimming `requestedRanges` at `nextOffset + 1` and
re-running sort, merge, and expansion on the trimmed request, rather than
reading a continuous interval through gaps. Context lines MAY reappear across
retries, as in single-range continuations. Single-range result fields and
continuation SHALL remain unchanged.

#### Scenario: Touching expansions merge into one block

- **WHEN** a file read requests `:4-5,7-8`
- **THEN** the expansions 3..6 and 6..9 merge and content contains lines 3 through 9 exactly once
- **AND** requested ranges remain 4..5 and 7..8

#### Scenario: Unsorted overlapping ranges become one context-bounded block

- **WHEN** a file read requests `:20-30,5-10,10+10`
- **THEN** it merges the request to 5..30 and emits lines 4 through 31 exactly once, subject to file bounds
- **AND** requested ranges contain the interval 5..30 and shown ranges contain 4..31 when they fit

#### Scenario: Disjoint windows stay separate and raw reads stay verbatim

- **WHEN** a file read requests `:5-10,20-30` or `:raw:5-10,20-30`
- **THEN** the numbered read emits 4..11 and 19..31 as two shown ranges
- **AND** raw content has only lines 5..10 and 20..30 verbatim with no generated prefixes, context, or gap markers

#### Scenario: Later range waits for continuation

- **WHEN** `:5-10,20-30` fits the first expanded range but not all of the second
- **THEN** it emits only lines 4..11, reports truncation and `nextOffset: 18`
- **AND** a retry that trims `requestedRanges` at 19 reads `:20-30` with fresh expansion

#### Scenario: First range exceeds the line ceiling

- **WHEN** `:1-2500,4000-4010` targets a sufficiently long file with short lines
- **THEN** it emits lines 1..2000, reports truncation and `nextOffset: 2000`
- **AND** the remaining request is `:2001-2500,4000-4010`

#### Scenario: The line ceiling is shared across ranges

- **WHEN** `:1-1499,3000-4500` targets a sufficiently long file with short lines
- **THEN** it emits only lines 1..1500 because the second whole expanded range exceeds the remaining 500-line budget
- **AND** it reports truncation and `nextOffset: 2998`; a retry reads `:3000-4500`

#### Scenario: EOF limits shown ranges only

- **WHEN** a 25-line file is read with `:5-10,20-30,40-50` and output fits
- **THEN** requested ranges remain 5..10, 20..30, 40..50 and shown ranges are 4..11 and 19..25
- **AND** the result is not truncated and has no continuation

#### Scenario: First start past EOF fails despite context

- **WHEN** a 5-line file is read with `:6-7,20-25`
- **THEN** the tool returns `invalid_selector`
- **AND** no context line is emitted

#### Scenario: Expansion clips at the first line

- **WHEN** a file read requests `:1-2,5-6`
- **THEN** the expansions 1..3 and 4..7 merge and content contains lines 1 through 7 exactly once
- **AND** no line before line 1 is synthesized

#### Scenario: Invalid member rejects the request

- **WHEN** a nonliteral host read selector is `:5-10,,20-30`, `:5-10,0-2`, or contains 65 ranges
- **THEN** the tool returns `invalid_selector` without returning any selected content
- **AND** a malformed `kb://` suffix such as `:5-10,,20-30` retains `invalid_path`; valid comma grammar with invalid numeric bounds retains `invalid_selector`

#### Scenario: Literal filename wins

- **WHEN** `/tmp/report:5-10,20-30` exists as a regular file and is read
- **THEN** it is read as the literal filename without applying ranges

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory without a range selector, it SHALL
return a listing of that directory and its immediate child directories'
entries, two levels deep. The first content line SHALL be the header: the
directory path as given by the caller. The header SHALL NOT count as a listing
entry. Each entry SHALL be rendered on its own line, indented two spaces per
level below the requested directory, as `- name/` for a directory, `- name` for
a regular file, `- name@/ -> <target>` for a symbolic link whose target is a directory,
`- name@ -> <target>` for a symbolic link whose target is a regular file,
`- name@? -> <link text>` for a symbolic link that is dangling or resolves to
a special entry, and `- name?` for any other entry kind such as a FIFO, socket,
or device. `<target>` SHALL be the canonical absolute path the link resolves
to, so that a model without shell access learns where a link leads; a
dangling link SHALL show its raw link text because it cannot resolve, and a
link whose link text cannot be read either SHALL render as the bare
`- name@`. A
`kb://` listing SHALL render every symbolic link as the bare `- name@` with no
target kind and no target, because a Knowledge result exposes no resolved host
path. Rendering a link SHALL read its metadata and target path only, SHALL do
so only for the entries the listing assembles (the requested level or the
requested slice of it, and the capped head of each child directory), and
SHALL NOT open it. Symbolic links
found as entries SHALL NOT be descended whatever their target kind, and
special entries SHALL NOT be opened or followed. A link whose target is a
directory SHALL order among non-directory entries by name, as a link does
today. A symbolic link given as the
target path SHALL resolve to its target directory as file reads resolve today.
Entries below the second level SHALL be counted but never rendered. A directory
with no entries SHALL render `(empty directory)` as its only line after the
header. Within one directory, entries SHALL be ordered with directories first
and then by name under the runtime's default `localeCompare`. Entries SHALL be shown verbatim:
hidden entries, ignore files, and entry metadata other than a link's target
kind and target SHALL NOT alter the listing in this iteration. The listing
SHALL be a pure function of entry names, kinds, counts, link target kinds and
targets, and that comparator, so two reads of a directory whose entries and
link targets are unchanged on one host produce identical content. The comparator resolves against the runtime's
default locale, so ordering is stable per host rather than defined across
hosts. Result details SHALL identify the path and the
directory kind, and listing lines SHALL carry no generated line-number
prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the header, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@`, its target kind, and its canonical target without listing anything beneath it

#### Scenario: Special entry is marked and never opened

- **WHEN** the model reads a directory containing a FIFO
- **THEN** the FIFO appears as `- name?` in order among the files
- **AND** the read completes without opening it

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

#### Scenario: Linked package directory shows where it leads

- **WHEN** the model reads a directory containing `octocat`, a symbolic link to a directory elsewhere on the host, and `herdr`, a symbolic link whose target no longer exists
- **THEN** the listing renders `- octocat@/ -> <canonical target directory>` and `- herdr@? -> <raw link text>`
- **AND** neither link is descended or opened

#### Scenario: Knowledge listing shows a link without its target

- **WHEN** the model lists a `kb://` directory containing a symbolic link
- **THEN** the link renders as `- name@` with no target kind and no target
- **AND** the read of that link still fails `not_found`

#### Scenario: Link rendering is deterministic and unaffected by siblings

- **WHEN** an entry is added beside a symbolic link and the directory is read again
- **THEN** the link's line is byte-identical to the previous read
- **AND** the entry order rule is unchanged

### Requirement: Directory listing bounds favor the requested level

Each directory read for a listing, requested or child, SHALL retain at most
10,000 entry names for ordering while continuing to count entries beyond that
budget. A requested directory over the budget SHALL fail closed with a
`directory_too_large` error that states the count and no listing. A child
directory over the budget SHALL render only its `- name/` line followed by an
indented `… N entries` line with the exact count. Within that budget, the
requested directory's own entries SHALL NOT be capped by a per-level limit.
Each child directory SHALL render at most 20 entries in order, followed by one
`… N more` line stating the number of omitted entries when any were omitted.
When the rendered two-level listing exceeds the common native result cap, the
tool SHALL replace whole child blocks, last-first, where a child block is every
line rendered beneath one child directory including its `… N more` line, with
one indented `… N entries` line stating that child's total entry count; the
requested level's own lines SHALL be preserved by that step. An empty child
directory SHALL render as its `- name/` line alone, so a bare child line means
empty and an `… N entries` line means elided. The `… N entries` markers count toward the size of the requested level for
the next step but SHALL NOT occupy entry index positions. Only when the
requested level's entries and their markers still exceed the cap SHALL the tool
apply the ordinary truncation metadata over the requested-level entries in
order, each marker travelling with the entry it hangs from; `nextOffset` SHALL
identify the next requested-level entry index that was not emitted.
A range selector on a directory path SHALL switch the read to a flat listing of
the requested level: the header, then the selected entries by one-based entry
index, with no child entries and no context expansion, regardless of whether
the two-level listing would have fit. `nextOffset` SHALL identify the next
entry index of the requested level. The `:raw` selector on a directory SHALL
fail with a selector error.

#### Scenario: Requested directory over the traversal budget fails closed

- **WHEN** the model reads a directory holding more than 10,000 entries
- **THEN** the tool returns `directory_too_large` with the entry count
- **AND** it emits no listing

#### Scenario: Child directory over the traversal budget is elided

- **WHEN** a child directory holds more than 10,000 entries
- **THEN** the listing shows that child's `- name/` line followed by `… N entries` with the exact count
- **AND** no entry of that child is rendered

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

### Requirement: Exact edit replaces one current unique match

`edit` SHALL accept an absolute path, non-empty `oldText`, and `newText`. It
SHALL read the current file at execution time and require exactly one exact
occurrence of `oldText`. A missing or ambiguous occurrence SHALL fail without
mutation. Unrelated changes elsewhere in the file SHALL NOT block a correct
unique replacement. Calls targeting the same path SHALL execute sequentially in
the host runtime. The operation SHALL preserve bytes outside the replacement and
return a bounded diff plus post-edit content with one adjacent live line on each
side when available. No prior read, snapshot tag, read hash, or permission rule
is required in this iteration.

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
absolute path, a symbolic link at
the target SHALL resolve to and replace its target entry exactly as `edit`
does, and a dangling symbolic link SHALL fail with `not_found`; on a `kb://`
locator, the target SHALL resolve with the leaf required to exist, and a
symbolic-link component SHALL fail as it does today. A successful replace
SHALL preserve the target's existing permission bits and SHALL be marked
`replaced`, distinct from the `created` marker of a create-mode success.

Both modes SHALL validate UTF-8 content and enforce shared output limits
before any byte changes, and SHALL leave the target unchanged on every
failure. Non-boolean `replace` values SHALL fail schema validation before
dispatch. Native file size SHALL NOT be restricted by the legacy Knowledge
byte limit. Every result SHALL identify the target as the caller named it: the
absolute path for an absolute path, the locator for a `kb://` write, never the
resolved host path. The create-mode `file_exists` message SHALL name `replace`
as the explicit path for replacing the file's contents, and the replace-mode
`not_found` message SHALL state that `replace` requires an existing target and
that omitting it creates a new file. Write SHALL NOT produce sibling-name
suggestions on either failure.

#### Scenario: Non-boolean replace value is rejected

- **WHEN** write receives `replace` as a non-boolean value such as `"true"` or `1`
- **THEN** the input schema rejects the call before dispatch
- **AND** no file is read, created, or modified

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
Space directories. Sibling-name suggestions on a missed `kb://` read SHALL be
drawn only from a parent directory that has already been proven inside the
resolved Space, SHALL never be produced when the Space itself is absent,
removed, or another owner's, and SHALL carry names only; the parent SHALL be
checked without following links immediately before it is opened for names,
and a symbolic-link parent SHALL yield the bare `not_found`.

The locator SHALL be split on `/` and on the first `:` after the Space
identifier before any decoding, and each path segment SHALL then be
percent-decoded exactly once; the Space identifier and the selector SHALL NOT
be decoded. A segment that fails to decode, or that decodes to a string
containing `/`, SHALL return `invalid_path`, and that check SHALL run on the
individual segment before segments are rejoined. Where a path has a literal
spelling that is valid under this grammar, that spelling and its encoded
spelling SHALL resolve to the same file; a segment containing `:` or a
literal `%` has no valid literal spelling and SHALL be addressed as `%3A` or
`%25`, and `/` SHALL never be encoded. Path
validation SHALL apply to the decoded segments and SHALL reject absolute
paths, empty components, `.` or `..` components, backslashes, NUL or control
characters, and paths above 1,024 UTF-8 bytes or 32 components, returning
`invalid_path`. A `kb://` locator emitted by the system SHALL encode a segment
only when it contains `:`, `?`, `#`, or `%`, and SHALL leave every other
character, spaces included, literal. It SHALL refuse every
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
verbatim so that `edit` `oldText` can be copied from it once the generated
line-number prefixes are removed, or read with `:raw` to omit them.

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
- **THEN** the tool returns `invalid_path`, because a literal `:` after the identifier starts the selector and `b.md` is not one
- **AND** it does not probe for a literal file; the file is addressed as `kb://<id>/notes/a%3Ab.md`

#### Scenario: Encoded and literal spellings resolve alike

- **WHEN** the model calls `read` with `kb://<id>/01_Areas/Pet%20Projects/MOC.md` and then with `kb://<id>/01_Areas/Pet Projects/MOC.md`
- **THEN** both calls open the same file
- **AND** neither result reveals which spelling the filesystem holds

#### Scenario: Encoded separator cannot cross a boundary

- **WHEN** the model calls `read` with `kb://<id>/notes%2Fsecret.md`
- **THEN** the tool returns `invalid_path`
- **AND** `notes/secret.md` is not opened or probed, even though that literal path would be valid

#### Scenario: Malformed encoding fails closed

- **WHEN** the model calls `read` with `kb://<id>/reports/100%.md`
- **THEN** the tool returns `invalid_path`
- **AND** the description tells the model to write `%25` for a literal percent sign

#### Scenario: Edit copies verbatim content

- **WHEN** a note contains `<system>` in its text and the model reads it through `kb://` and then edits it using that text as `oldText`
- **THEN** the read returned the text unchanged
- **AND** the edit finds exactly one match and applies

### Requirement: Web locators are fetched by the native read tool

The native `read` tool SHALL accept an absolute `http://` or `https://`
locator as its `path` and SHALL fetch it with the API process's own outbound
HTTP. No other web scheme SHALL be admitted, and `edit` and `write` SHALL
reject a web locator with `invalid_path` before any request. A submitted web
locator, after any fragment is cut and its selector is split off, SHALL be
normalized to its WHATWG URL serialization and requested as that text: an
uppercase scheme or host, a percent-encoded or Unicode host, an explicit
default port, a host's root dot, an empty path, and unencoded path or query
characters SHALL each be normalized rather than refused, because none of them
addresses a different resource and refusing them cost a call that taught the
model nothing it could carry to the next locator. A fragment SHALL be cut
before anything else reads the locator, because the request drops it anyway.
What no normalization can repair SHALL still fail before any request: a text
that is not a URL, a scheme outside `http` and `https`, a suffix outside the
selector grammar, and userinfo, which SHALL fail with `invalid_path` so the
tool never sends credentials the model embedded in a URL, and whose message
SHALL NOT echo them.

Because the text requested is no longer always the text submitted, the
permission decision SHALL be taken over both: any reject clause matching
either the submitted locator or its normalized form SHALL refuse the call, so
a spelling cannot be arranged to miss a reject, while the allow SHALL be
decided on the normalized form, because an allow names the resource the call
will reach and the two texts are one resource. A redirect hop is a different
resource and SHALL keep being admitted in its own right. Availability and
restriction for the web SHALL come only from the `read` permission group's
`path` clauses: a prefix allow admits the web, and a prefix or domain reject
removes a host. No web tool id, `tools.allowed` entry, configuration block, or
advertisement condition SHALL be added; a process that does not advertise
`read` SHALL NOT reach a URL through it. Each call SHALL fetch afresh: no
response or render SHALL be cached, and a later selector read of the same
locator SHALL issue a new request. The tool SHALL NOT consult `robots.txt` or
any publisher signal such as `content-signal`, and a fetch SHALL NOT be
represented as permission from the publisher. The scheme split and trailing
selector rules that protect a `scheme://` prefix SHALL apply unchanged: the
scheme's own colon is never read as a selector, and the shipped
trailing-selector split (the last colon after the last slash) governs the
rest. A selector SHALL be split only from a locator that has a path and
carries no `?` and no `#`, so a colon inside a query is part of the URL
(`https://example.test/search?at=2026:10` is fetched as written) and the only
colon of a pathless locator opens its port: `https://example.test:88` is port
88, `https://example.test/:88` is line 88 of the site root, and
`https://example.test:88/:88` is line 88 served from port 88.
A literal colon in the last path segment of a query-free locator SHALL be
written as `%3A` (`https://w.example/wiki/Special%3ASearch`), because a
trailing colon is always read as a selector split and the shipped grammar
admits `raw`, `raw:N`, `raw:N-M`, `N`, `N-M`, `N+K`, and comma lists of
those: `Search` is outside it, so `https://w.example/wiki/Special:Search`
fails as `invalid_selector`, while `https://w.example/docs/2024:10` selects
line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of
`https://w.example/docs/2024`.
Each refusal that remains SHALL name the spelling that would work rather than
the rule that was broken: a selector written straight after the authority
(`https://example.test:1-5`, which is not a URL at all because `1-5` is not a
port) SHALL be answered with the authority's own serialization carrying that
selector (`https://example.test/:1-5`); a port that is not a number
(`https://example.test:abc/`) SHALL be answered by naming that rule and the
same locator without a port, rather than by the generic message, since the
locator is absolute and only its port is broken; a suffix that meant a line the
grammar cannot serve (`:12+`) SHALL be answered with the line forms first and
the literal colon's encoding second; and a selector the render could not
serve — past its end, or with no line in it — SHALL be answered with the
number of lines the page rendered, which the model cannot know before reading
it.

#### Scenario: A web locator is fetched by the API process

- **WHEN** the model calls `read` with `https://example.test/guide`
- **THEN** the API process issues the request and returns the page content
- **AND** no native executor identity is required, bound, or reported

#### Scenario: A rejected cleartext scheme never reaches the network

- **WHEN** the `read` group rejects `path` matching `^http://` and the model reads `http://example.test/guide`
- **THEN** the call is rejected before any request is issued
- **AND** an admitted `https://` locator is unaffected by that reject

#### Scenario: A web locator is never mutated

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** it returns `invalid_path`
- **AND** no request is issued

#### Scenario: A noncanonical spelling is normalized, not refused

- **WHEN** the model reads `https://g%72okipedia.com/page`, `HTTPS://Example.test/guide`, `https://example.test:443/guide`, or `https://example.test./guide`
- **THEN** the read requests the normalized locator (`https://grokipedia.com/page`, `https://example.test/guide`) without a refusal first
- **AND** a reject clause written against the canonical spelling still refuses every one of those variants, because the decision is taken over the submitted text and the normalized text alike
- **AND** a reject clause written against the submitted spelling, such as one naming `%72`, also refuses

#### Scenario: A pathless host reads its port, a path reads its line

- **WHEN** the model reads `https://example.test:88`, which has no path for a selector to trail
- **THEN** the read requests `https://example.test:88/` on port 88, and the permission decision matched that same text
- **AND** `https://example.test/:88` requests the site root and returns line 88 of its render
- **AND** `https://example.test:88/:88` requests the root on port 88 and returns line 88 of it

#### Scenario: Userinfo in a locator fails closed

- **WHEN** the model reads `https://user:secret@example.test/guide`
- **THEN** the read returns `invalid_path` before any request
- **AND** no credential from the locator is sent to the host

#### Scenario: A colon in the last path segment is a selector unless encoded

- **WHEN** the model reads `https://w.example/wiki/Special:Search`
- **THEN** the read fails with `invalid_selector` and issues no request, because the split-off suffix is present but outside the grammar
- **AND** `https://w.example/wiki/Special%3ASearch` is fetched as written, while `https://w.example/docs/2024:10` selects line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of `https://w.example/docs/2024`

#### Scenario: A refused locator names the spelling that works

- **WHEN** the model reads `https://example.test:1-5`, which no URL parser accepts because `1-5` is not a port
- **THEN** the read returns `invalid_path` naming `https://example.test/:1-5`, and resubmitting that reads lines 1 through 5 of the page
- **AND** reading `https://example.test/guide:12+` returns `invalid_selector` naming the `:N`, `:N-M`, and `:N+K` forms before the `%3A` spelling
- **AND** a suffix outside the grammar with no line number in it, such as `https://w.example/wiki/Special:Search`, still names only the encoded spelling

#### Scenario: A selector the page cannot serve reports the page's length

- **WHEN** the model reads `https://example.test/guide:100-200` and the render is 3 lines long
- **THEN** the read returns `invalid_selector` reporting that the page rendered 3 lines
- **AND** the message does not repeat the error type as its text

#### Scenario: A local-only allow does not admit the web

- **WHEN** the `read` group's only allow clause is a `path` regex for `^/`
- **THEN** an `https://` locator matches no allow and is rejected as `no_allow` before any request

#### Scenario: Publisher signals are not permission

- **WHEN** a page's `robots.txt` disallows the path or its response carries `content-signal: ai-train=no`
- **THEN** an admitted read still fetches the locator and returns its content
- **AND** the read does not report or enforce the signal

### Requirement: Web fetch bounds fail fast and are never retried

Every web request SHALL carry `User-Agent: llame/<version>`, where the version
is the boot-time value instance configuration resolves for the running
process. The tool SHALL NOT rotate, randomize, or omit that value and SHALL
NOT claim another product's client identity. A request whose response
headers do not arrive within 10 seconds SHALL fail the call with
`headers_timeout`. A call that has not completed within 30 seconds, counted
across every request it issues, SHALL fail with `call_timeout`. The response
body SHALL be streamed against a 5 MiB cap and aborted past it with
`body_too_large`, and a declared length above the cap SHALL fail before the
body is read. `Accept-Encoding` SHALL be left to the runtime. A web call
SHALL NOT retry: a transport failure, a timeout, and an error status SHALL
each be reported to the model as an error observation with no second
attempt. A non-2xx status other than a redirect status (301, 302, 303, 307,
308, which the redirect requirement governs whether or not a `Location` is
present) on the first request, or on a
redirect hop, SHALL fail the call with `http_status` naming the status; a 429
SHALL additionally carry the `Retry-After` value when the response supplies
one. A status error SHALL NOT return the response body and SHALL NOT report
response headers other than that `Retry-After` delay. A redirect answer to a
probe request SHALL be followed under the shared redirect rules before any
terminal status is judged. A probe request (an
alternate, a suffix candidate, or an `llms.txt` candidate) whose terminal
response answers a non-2xx status, or a refused content type, or which fails
on a bound of its own (a headers timeout, an oversized body, a transport
failure, or a redirect it cannot follow), SHALL disqualify only that
candidate, and the pipeline SHALL continue; a probe that exhausts the call's
deadline or its redirect budget SHALL fail the call, while a refusal inside
a probe's own redirect chain disqualifies only that candidate, as a refused
probe locator does. A
call SHALL issue at most one alternate request, one suffix-probe request,
and four `llms.txt` requests, and SHALL follow at most 20 redirects in total
across all of its requests.

#### Scenario: Every request identifies llame

- **WHEN** any web request of an admitted read is inspected
- **THEN** its `User-Agent` is `llame/<version>` with the boot-time version
- **AND** the value does not vary between the call's requests

#### Scenario: A redirect is followed, not failed, and a bare redirect fails closed

- **WHEN** the first response is 302 with a `Location` header and policy admits the target
- **THEN** the hop is followed and the call does not fail with `http_status`
- **AND** a 302 without a parsable `Location` fails the call with `invalid_redirect`

#### Scenario: Slow headers fail at the header bound

- **WHEN** a server accepts the connection and sends no response headers within 10 seconds
- **THEN** the call fails with `headers_timeout`
- **AND** the body is not read

#### Scenario: A call over the total bound fails

- **WHEN** each response arrives inside the header bound but the call passes 30 seconds while following hops or probing alternates
- **THEN** the call fails with `call_timeout`
- **AND** no further request is issued for that call

#### Scenario: An oversized body is aborted

- **WHEN** a response declares or streams more than 5 MiB
- **THEN** the call fails with `body_too_large`
- **AND** the read stops streaming instead of buffering the remainder

#### Scenario: Rate limiting is reported, not retried

- **WHEN** a server answers 429 with `Retry-After: 120`
- **THEN** the call fails with `http_status` naming 429 and the retry delay
- **AND** no retry is attempted

#### Scenario: An error status is not content

- **WHEN** a server answers 404 or 500
- **THEN** the call fails with `http_status` naming the status
- **AND** the response body is not returned as content

### Requirement: Web reads accept text bodies only

A web read SHALL accept only text bodies: `text/*` media types,
`application/json`, `application/xml`, and any type whose subtype carries a
`+json` or `+xml` suffix. `text/markdown` SHALL be handled as Markdown. Every
other content type SHALL fail with `unsupported_content_type` naming the
received type, and its body SHALL NOT be returned as content. Only a
declared HTML type — `text/html` or `application/xhtml+xml` — SHALL be
rendered. A `text/plain` body SHALL be returned as served whatever it
contains, because a conversion guesses at structure and guessing on a body
the publisher declared as plain text costs more than it returns: a Markdown
file that opens with a block of inline HTML was extracted as an article and
lost every line after it. Any other accepted text body SHALL be returned as
the content unchanged. Text SHALL be decoded with the
charset from the `Content-Type`
parameter when present, else with a `<meta charset>` declaration found in the
first 2 KiB of the body, else as UTF-8.

#### Scenario: A JSON body is returned as text

- **WHEN** a locator serves `application/json`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** a first response that is `text/plain` is returned unchanged with `method` `negotiated`

#### Scenario: A binary body is refused with its type named

- **WHEN** a locator serves `application/pdf` or `image/png`
- **THEN** the read fails with `unsupported_content_type` naming that type
- **AND** no conversion or extraction is attempted

#### Scenario: Only a declared HTML type is rendered

- **WHEN** a response declares `text/plain` and its body is an HTML document
- **THEN** the body is returned as served with `method` `negotiated`, not extracted
- **AND** a `text/plain` README that opens with a block of inline HTML, such as `<div align="center">`, keeps every line

#### Scenario: A declared charset is honored

- **WHEN** a response declares `charset=iso-8859-1` and its body contains bytes outside ASCII
- **THEN** the returned text is decoded with that charset
- **AND** a response that declares no charset and carries no `<meta charset>` in its first 2 KiB is decoded as UTF-8

### Requirement: Web HTML reads prefer publisher Markdown

The first request for a page SHALL send `Accept: text/markdown,
text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`, so a publisher that serves
Markdown or plain text for agents is used without a second request or a
local conversion. A first response that is `text/markdown` or
`text/plain` SHALL be returned as the content with `method`
`negotiated`, ungated and unconverted: the publisher's agent-facing body is
taken as it is. Otherwise, for an HTML body, the tool SHALL try, in order,
a Markdown alternate announced by the response's `Link` header or by a `<link
rel="alternate" type="text/markdown">` element in the page head, resolved to
an absolute URL, fetched, and reported as `method` `alternate`; then the
publisher's Markdown suffix probe, mapping `/a/b.html` to `/a/b.html.md`,
`/a/b` to `/a/b.md`, and `/a/b/` to `/a/b/index.md`, reported as `method`
`md-suffix`. The first candidate that passes the quality gate SHALL win and
end the search. The quality gate SHALL judge an alternate, a suffix candidate,
and the local render alike: more than 100 non-whitespace characters, not
HTML-shaped for a Markdown candidate, and not low quality, where a candidate
is low quality when it is under 1,024 characters and contains a JavaScript
or captcha gate phrase, or when more than 70 percent of its non-blank lines
are shorter than 40 characters and fewer than 40 of them reach that length,
since a render that carries 40 substantial lines is a document whatever its
shape and the fallback it would be sent to is the same page's raw HTML.
Every derived locator, meaning an alternate,
a suffix candidate, an `llms.txt` candidate, or a redirect hop, SHALL be
evaluated against the `read` permission group before its request through
the same evaluator and the same projection the call used, as if the model
had submitted it; a rejected probe locator, or a rejected hop inside a
probe's own redirect chain, SHALL disqualify that candidate without failing
the call and its decision SHALL be recorded like a hop decision, so a hostile
page cannot make a read of itself fail by announcing a refused alternate. A probe request SHALL send the same `Accept` header and
SHALL count against the call's total time, body, request, and redirect
bounds; a failure of its own disqualifies the
candidate without failing the call, while a spent call bound fails it. A candidate that fails the gate SHALL
NOT become the content, and a fetched candidate SHALL NOT be searched for
further alternates
or suffixes.

#### Scenario: Negotiated Markdown wins without a second request

- **WHEN** the first request's response is `text/markdown`
- **THEN** the content is that body and `method` is `negotiated`
- **AND** the call issues no further request for that page

#### Scenario: A Link header alternate is fetched

- **WHEN** an HTML response carries `Link: <https://example.test/guide.md>; rel="alternate"; type="text/markdown"`
- **THEN** that URL is requested and its body is returned with `method` `alternate`

#### Scenario: A head alternate link resolves against the page

- **WHEN** a page's head declares `<link rel="alternate" type="text/markdown" href="/guide.md">`
- **THEN** `/guide.md` is resolved against the page's URL, fetched, and reported as `method` `alternate`

#### Scenario: The suffix probe finds a publisher file

- **WHEN** an HTML page at `https://example.test/a/b` announces no alternate and `https://example.test/a/b.md` returns Markdown that passes the gate
- **THEN** the content is that file and `method` is `md-suffix`

#### Scenario: A candidate that fails the gate does not win

- **WHEN** an alternate or suffix URL answers 404, serves `application/pdf`, returns an HTML error page, or returns a body of 40 characters
- **THEN** that candidate is not returned as the content and the call does not fail
- **AND** the next adapter in order decides the content

#### Scenario: A low-quality candidate is rejected

- **WHEN** a page's only Markdown candidate is 900 characters dominated by short navigation lines, or a short page whose text is a JavaScript gate notice
- **THEN** the candidate fails the gate
- **AND** the pipeline continues past it

#### Scenario: A refused alternate is skipped, not fetched

- **WHEN** the `read` group's only allow is `^https://docs\.example\.com/` and a page on that host announces `Link: <https://evil.example/x.md>; rel="alternate"; type="text/markdown"`
- **THEN** the alternate locator is rejected before any request, no request reaches `evil.example`, and the decision is recorded like a hop decision
- **AND** the pipeline continues with the suffix probe and the local render, and the call does not fail

#### Scenario: Probes carry the negotiated accept header

- **WHEN** any alternate or suffix probe request is inspected
- **THEN** it sends the same `Accept` value as the first request
- **AND** it counts against the call's total time and body bound

### Requirement: Web HTML reads fall back to a local render, llms.txt, and the raw body

Only when no publisher Markdown candidate wins SHALL the tool render locally:
Readability main-content extraction over the response body, converted to
Markdown with GFM tables and reported as `method` `readability`. When
Readability finds no article, the whole body SHALL be converted instead and
reported with the same method. The render SHALL open with the page's title as
a heading unless its own first line already is that title, because Readability
treats the title as the article's heading and strips it, leaving a page that
never names itself. Only when that render fails the quality gate
SHALL the tool probe `llms.txt`, requesting at most four candidates from the
deepest path segment up to the site root (the three deepest scopes and the
root) until one is accepted, reported as `method` `llms-txt`. An `llms.txt`
candidate SHALL be accepted on the length and not-HTML-shaped conditions
only, because an index file is short link lines by construction. When no
attempt is accepted, the tool SHALL return the response body with `method`
`raw` and a note explaining that the page could not be converted. A
JavaScript or captcha challenge SHALL fail the gate, be returned with
`method` `raw`, and carry a note naming the detected challenge. A text body
outside the negotiation set (JSON, XML, and other `text/*` types) SHALL be
returned unchanged with `method` `text`. `:raw` SHALL skip every probe and
conversion and return, untouched and with `method` `raw`, the body of the
final response after any followed redirects, with `finalUrl` naming that
response; a `:raw` read of a refused content type SHALL still fail under the
content-type rule.

#### Scenario: A page without publisher Markdown is rendered

- **WHEN** an HTML page offers no negotiated body, no alternate, and no passing suffix candidate
- **THEN** Readability's main content is returned as Markdown with GFM tables and `method` `readability`

#### Scenario: A render names the page it came from

- **WHEN** Readability strips the page title as the article's own heading, as it does for `https://example.com/`
- **THEN** the render opens with that title as a heading
- **AND** a render whose first line already is the title is not given a second one

#### Scenario: A Readability miss converts the whole body

- **WHEN** Readability finds no article on a page that still has content
- **THEN** the whole body is converted to Markdown and reported with `method` `readability`

#### Scenario: A passing render stops the search before llms.txt

- **WHEN** the local render passes the quality gate
- **THEN** no `llms.txt` candidate is requested

#### Scenario: llms.txt is probed from the deepest segment upward

- **WHEN** the local render fails the gate and `https://example.test/a/b/llms.txt` does not exist while `https://example.test/llms.txt` does
- **THEN** the walk requests the deeper candidate first and returns the root one with `method` `llms-txt`

#### Scenario: The raw body is the last resort, with a note

- **WHEN** every Markdown and render attempt fails the gate
- **THEN** the response body is returned with `method` `raw`
- **AND** `notes` explains that the page could not be converted and the content is not presented as converted text

#### Scenario: A challenge page is reported, not converted

- **WHEN** a response body is a JavaScript or captcha gate under 1,024 characters
- **THEN** it is returned with `method` `raw` and `notes` naming the detected challenge

#### Scenario: Raw mode fetches once

- **WHEN** the model reads `https://example.test/guide:raw`
- **THEN** the body of the final response is returned untouched with `method` `raw`, `finalUrl` names that response, and no Readability or Turndown step runs
- **AND** no alternate, suffix, or `llms.txt` request is issued

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and headers as the first, sending no cookie, `Authorization`, or other
credential on any request. The hop locator SHALL be the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so a relative `Location` becomes absolute and the
serialization is what policy sees: lowercase host, an internationalized host
as punycode, default port dropped, empty path as `/`, path and query
percent-encoded. A fragment SHALL be dropped from the resolved locator
before admission and before the request, so the text policy matches is
exactly the URL the next request uses. A redirect status without a parsable
`Location`, or a resolved locator that carries userinfo or a scheme other
than `http` or `https`, SHALL fail the call with `invalid_redirect` before
any request and SHALL NOT name the target. Before a hop's request is sent, the `read`
permission group SHALL be evaluated against that locator as if the model had
submitted it, through the same evaluator and the same projection the call
used. A rejected hop SHALL end the call with a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the
response that produced the content as `finalUrl` and SHALL NOT enumerate the
hop chain: when a publisher-Markdown probe won, that is the probe's own
final URL, including any redirect it followed, rather than the page's.
The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. This change SHALL NOT
resolve a hostname to check its address before connecting: a `path` clause is
a rule over text, so a host it admits is admitted at every address that host
resolves to.

#### Scenario: A cross-host hop is followed when policy admits it

- **WHEN** `https://a.example/start` answers 302 to `https://b.example/guide` and the `read` group admits both URLs
- **THEN** the second request is issued and `finalUrl` is the b.example URL
- **AND** the result reports no hop chain

#### Scenario: A hop naming a rejected host ends the call without reading its body

- **WHEN** a redirect target is refused by a `read` reject
- **THEN** the call returns `permission_denied` with the fixed hop message and `rejectedUrl` carrying the resolved target's origin and path without query or fragment, bounded to 2,048 characters with control characters removed
- **AND** no request is sent to the refused target, so its body is never read, converted, or returned

#### Scenario: The hop limit bounds a redirect loop

- **WHEN** a server redirects more than 20 times within one call
- **THEN** the call fails with `too_many_redirects`
- **AND** no further request is issued

#### Scenario: A redirect to a credentialed or non-web target fails closed

- **WHEN** a hop's `Location` resolves to `https://user:secret@b.example/x` or to `file:///etc/passwd`
- **THEN** the call fails with `invalid_redirect` before any request to that target
- **AND** the error does not repeat the target

#### Scenario: A relative Location is resolved and normalized before policy

- **WHEN** `https://a.example/docs/start` answers 302 with `Location: ../Guide` and the `read` group allows `^https://a\.example/`
- **THEN** policy evaluates `https://a.example/Guide` and the request targets that URL
- **AND** `finalUrl` reports `https://a.example/Guide`

#### Scenario: A hop to a private address is admitted by its text

- **WHEN** a redirect targets `http://127.0.0.1:8080/admin` and the `read` group admits that URL's text
- **THEN** the request is issued because the tool performs no address check
- **AND** the outcome is the same for a hostname whose address resolves into a private range

#### Scenario: The description explains where the content came from

- **WHEN** the packaged `read` description is rendered for a catalog that includes `read`
- **THEN** it states that redirects are followed and that the result reports the final URL

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, or `raw`, and
SHALL name the adapter that produced the returned content. The result SHALL
NOT carry a `url` field, a `contentType` field, a `markdownTokens` field, a
text header before the content, or a metadata frontmatter block. Line
selectors SHALL apply to the rendered text exactly as to a local file, with
the existing context, range, `nextOffset`, and truncation rules, and the
rendered text SHALL be measured against the existing native read result bound,
which SHALL reserve space for `path`, `finalUrl`, `method`, and `notes` before
truncating content. A web read SHALL NOT carry `realPath`. A selector read of
a locator read earlier SHALL refetch and rerender, and the tool SHALL NOT
promise that two reads of the same URL return the same text.

#### Scenario: The result is the native object plus the web fields

- **WHEN** a web read succeeds
- **THEN** the result carries `content`, the range metadata, `path` as the locator with its selector stripped (as a local read reports it), `finalUrl`, and `method`, with `notes` only when non-empty
- **AND** it carries no `url`, `contentType`, `markdownTokens`, leading text header, or frontmatter block

#### Scenario: Selectors address the rendered text

- **WHEN** the model reads `https://example.test/guide:10-20`
- **THEN** lines 10 through 20 of the rendered text are returned with the ordinary context lines and range metadata
- **AND** the request targets `https://example.test/guide` rather than a URL ending in the selector

#### Scenario: A long render truncates under the native bound

- **WHEN** the rendered text exceeds the native read result bound
- **THEN** the result reports `truncated` and `nextOffset` for the rendered text
- **AND** `path`, `finalUrl`, `method`, and any `notes` remain present

#### Scenario: A repeated read refetches

- **WHEN** the model reads the same locator twice, the second time with a different selector
- **THEN** two requests are issued and the second result reports the content the server returned then
- **AND** no cached render or stored snapshot is reused

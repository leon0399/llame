# Spec Delta

## MODIFIED Requirements

### Requirement: Skill locators provide live read-only package access

`read` SHALL accept `skill://<name>[:selector]` for a package's `SKILL.md`, `skill://<name>/<path>[:selector]` for supporting files, `skill://<name>/` for its directory, and `skill://` for the current bounded catalog. The catalog form SHALL support pagination through native directory range selectors, whose single range accepts the same members as any other read, `N-` and `-K` included, resolved against the catalog's entry count. Skill names SHALL follow the Agent Skills name grammar. Resource segments SHALL follow the Knowledge locator's once-only decoding, selector separation, size/depth, and traversal validation rules. Native directory/read/range/raw/truncation behavior SHALL apply except for the explicit catalog representation. `edit` and `write` SHALL reject skill locators as unsupported operations without effects.

The resolver SHALL re-evaluate the current winning package on each call through the catalog port. It SHALL take the current turn's explicit selection set as a parameter: a manual-only package's body or resource read SHALL return a bounded structured refusal naming explicit selection unless that set contains the package, and the catalog listing SHALL omit manual-only packages not in that set. The Run supplies the set derived from its triggering user message to every skill read it performs, model-initiated reads included; a caller with no turn context supplies an empty set. Symbolic links beneath a source or inside a package follow ordinary operating-system semantics as `agent-skills` specifies; the resolver SHALL NOT resolve, verify, or contain them for access. Missing/invalid packages, unsupported operations, and invalid resource paths SHALL return bounded structured errors. The resolver SHALL NOT read special files.

When a Workspace is entered, the resolver SHALL include live skill sources discovered beneath `<root>/.llame/skills`, `<root>/.agents/skills`, and `<root>/.claude/skills`. A missing, unreadable, non-directory, or over-limit Workspace skill directory SHALL contribute nothing and SHALL NOT make the operator catalog or discovery unavailable; Workspace sources SHALL NOT count toward the operator 32-source bound.

Results SHALL carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`, both as discovered beneath the configured source rather than resolved real paths. A successful skill result SHALL carry an absolute real package directory in the field named `realSkillDirectory` when that directory differs from `skillDirectory`. The field SHALL be reserved before resource content exactly as the other envelope fields are; when the real directory cannot be resolved, the field SHALL be omitted and the read SHALL otherwise be unaffected. These discovered paths and, when present, `realSkillDirectory` SHALL be included in model-facing output and owner metadata. This rule applies to operator and Workspace skill sources. The `realSkillDirectory` field is disclosure-only: reads SHALL continue to open the discovered `resolvedPath`, package-relative references and script paths SHALL continue to resolve from the discovered `skillDirectory`, and the real directory SHALL neither replace those paths nor authorize access. The path instruction SHALL distinguish task-relative inputs and explicit `cwd` from package-relative paths; the tool SHALL NOT rewrite commands. The result bound SHALL reserve space for this envelope before truncating resource content; if the envelope cannot fit, the read SHALL fail with a bounded error. For Workspace sources, publication of `skillDirectory` and `resolvedPath` SHALL use the absolute paths discovered beneath `<root>/.llame/skills`, `<root>/.agents/skills`, or `<root>/.claude/skills`, rather than resolved real paths. Ordinary permission admission SHALL match a pure canonical projection of the submitted skill locator before any resource open: decode resource segments once, validate and re-encode through the shared locator grammar, and omit read selectors. It SHALL never substitute a physical path. Existing configured/default read rules SHALL apply to that projection, including credential-path rejects; no skill-specific permission bypass or duplicate deny list SHALL be introduced.

#### Scenario: Skill resource exposes the execution base

- **WHEN** the model reads `skill://pdf/scripts/extract.py` and the real package directory differs from the discovered `skillDirectory`
- **THEN** the result includes the current script content and model-visible discovered file and package paths, plus `realSkillDirectory` naming the real package directory
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

#### Scenario: Workspace skill source publishes discovered paths

- **WHEN** the model reads `skill://pdf/scripts/extract.py` from a package discovered under `/work/project/.llame/skills/pdf` with a Workspace entered at `/work/project`, and the real package directory differs from the discovered `skillDirectory`
- **THEN** the result includes the script content, model-visible discovered `resolvedPath` and `skillDirectory`, and `realSkillDirectory` naming the real package directory
- **AND** no script executes during the read

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive range members `N`, `N-M`,
`N+K`, `N-`, and `-K`, wherever a member is accepted: a bare single member
such as `:N-M`, a comma-separated list under the multi-range requirement
below, a `raw:` list, and the one optional source range after
`outline` below, together with
`:raw`. The five members are one set: a `raw:` list accepts every member a
bare list accepts, `N+K` included. `N-` is the single line `N` through the
source's last line and `-K` is
its last `K` lines. A `:<list>:raw` selector and the same list after `raw:`
SHALL be one read on every source: the shape gate every source validates
against admits both spellings, the applier reads them as the same `raw:`
list, and the canonical spelling is
the `raw:` one. A host or web split that finds a trailing `:raw` takes the
colon segment before it as the list only when that segment has the member-list
shape; any other segment stays on the path, so `notes:draft:raw` remains the
raw read of `notes:draft`, while `2024:10:raw` becomes line 10 of `2024` raw
and a literal file named `2024:10` is read raw only as `2024:10:raw:1-N`. It SHALL also accept the `outline`
representation member with at most one optional source range, `:outline`,
`:outline:N`, `:outline:N-M`, `:outline:N+K`, `:outline:N-`, or `:outline:-K`,
under the representation requirements below; a comma-separated list after
`outline` is outside the grammar and SHALL fail with `invalid_selector`. A
valid selector SHALL be normalized once to
internal zero-based ranges. A trailing suffix that splits off a locator which
itself parses and lies outside the grammar SHALL fail with `invalid_selector`
on every source, with one message that names the working forms — `:N`,
`:N-M`, `:N+K`, `:N-`, `:-K`, comma lists of them, `:raw`, `:raw:<list>`,
and `:outline` with one member — and, on a source that has an encoded
spelling for a literal colon (a `kb://` or `skill://` resource path, and
web), the `%3A` spelling of the
same locator after the forms; a malformed locator
part remains `invalid_path`. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing, and after that literal probe an `:outline` form SHALL be
recognized after the `:raw` form and before the last-colon numeric fallback; a
`kb://` path component SHALL NOT contain `:`, so the split is
unambiguous without probing, and its selector SHALL be validated as a numeric
form or as one of the `raw` and `outline` members, as SHALL a `skill://`
selector. A web locator SHALL recognize the `:outline` form before its
last-colon fallback while preserving its path, query, fragment, and port
rules. A `path` that begins with a `scheme://` prefix the
SHALL NOT be treated as a relative or literal filename. For regular-file reads, ordinary single bounded ranges SHALL include
one preceding and one following source line (context lines) when available, and the extended
lines SHALL appear in the same `content` block as the requested lines.

Members are resolved against the source's count before any of the shipped rules
run, and those rules then apply to the resolved absolute ranges: `N-` resolves
to `N..count` and `-K` to `max(1, count-K+1)..count`. That count is the line
count of a regular file on host, `file://`, `kb://`, or `skill://`, obtained
by counting the file's lines before the ordinary read whenever a selector
carries an `N-` or `-K` member, after the source is admitted and found to be a
regular file; the rendered line count of a web document; the
requested-level entry count of a directory listing; or the entry count of the
skill catalog. `requestedRange` and `requestedRanges` SHALL report the resolved
absolute lines, which are the coordinates this read observed rather than a
snapshot of the source. A `-K` with `K` greater than the count SHALL resolve to
`1..count` and `-0` SHALL fail with `invalid_selector`. An `N-` whose `N` lies
past the last line resolves to an empty member and then follows the shipped
past-the-end rules of its source: on a regular file or web render it fails
with `invalid_selector` when it is the first requested start of the sorted
members and is otherwise dropped before merging and context expansion, so it
emits nothing, adds no context line, and appears in neither
`requestedRanges` nor `shownRanges`; on a listing or the catalog it returns the
empty page those sources return today. An empty regular file or web render returns
the empty result for `-K` and `1-`, and any other `N-` on it fails as a start
past the last line does; an empty listing or catalog keeps its empty page for
every member.

For an ordinary ranged read of a `text/markdown` source, `content` SHALL also prepend the direct ancestor heading lines for the passage's first requested line, as specified by the ranged Markdown ancestor requirement.
For single-range reads, result
details SHALL identify requested and shown ranges, representation, path, and
common truncation state. For an `outline` result, `content` SHALL consist of
verbatim source lines carrying the ordinary line-number prefixes, chosen by the
Markdown outline requirements rather than by contiguity, with no context
lines; requested bounds are the outline's source scope and shown bounds are
the first and last emitted source lines. Requested bounds SHALL remain the normalized request
even when the displayed source ends earlier; shown bounds SHALL describe only
emitted source lines. Empty files SHALL return null ranges. `nextOffset` SHALL
identify the next requested source line; for a truncated outline it SHALL
identify the source line of the first omitted entry. Raw reads SHALL return verbatim
selected source content without generated line prefixes, context expansion, or
processors. `:outline:raw` and `:raw:outline` are not representation members:
host and web keep their raw interpretation of `:outline:raw` as a path or URL
ending in `:outline`, because their split recognizes the trailing `:raw` first
and leaves `:outline` on the path, while `kb://` and `skill://`, which split
once at the first colon, return `invalid_selector` for
`:outline:raw`, and any source given `:raw:outline`, whose remainder is outside
the grammar, returns `invalid_selector`. Directory reads SHALL apply single-range selectors to listing entries under the
directory listing requirements and SHALL NOT add context lines; an outline
request on a directory SHALL fail under the representation requirements rather
than reinterpret listing text.

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

#### Scenario: Outline selector is recognized before the numeric fallback

- **WHEN** no file named `/docs/guide.md:outline:10-40` exists and the model reads `/docs/guide.md:outline:10-40`
- **THEN** the read is the outline of `/docs/guide.md` scoped to source lines 10 through 40
- **AND** `/docs/guide.md:outline:raw` remains the shipped raw read of a path ending in `:outline`, while `/docs/guide.md:outline:1,3` fails with `invalid_selector`

#### Scenario: A tail member reads the last lines of a file

- **WHEN** the model reads `:-20` of a 500-line file
- **THEN** the result requests lines 481 through 500 and applies the ordinary context, truncation, and `nextOffset` rules to them
- **AND** the same read spelled `:raw:-20` returns those twenty lines verbatim

#### Scenario: An open-ended member runs to the last line

- **WHEN** the model reads `:50-` of a 3,000-line file of short lines
- **THEN** the requested range is 50 through 3,000 rather than an open-ended window
- **AND** the result is cut at the shared 2,000-line ceiling with the ordinary `nextOffset`

#### Scenario: A tail member larger than the file clips to the first line

- **WHEN** the model reads `:-50` of a 10-line file
- **THEN** the result requests lines 1 through 10, because `-K` resolves to `1..count` instead of failing

#### Scenario: A zero tail is refused

- **WHEN** the model reads `:-0`
- **THEN** the tool returns `invalid_selector` without opening the source

#### Scenario: Both raw orders are the same read

- **WHEN** the model reads `guide.md:raw:60-64` and `guide.md:60-64:raw` of the same file, or `kb://<id>/guide.md:60-64:raw` and `skill://<name>:60-64:raw`
- **THEN** each pair returns lines 60 through 64 verbatim with the same range metadata, because the shape gate every source validates against admits both spellings
- **AND** a file literally named `guide.md:60-64:raw` still wins the host literal-path probe, while `notes:draft:raw` stays the raw read of `notes:draft` because `draft` has no member-list shape

#### Scenario: A malformed suffix names the working forms on every source

- **WHEN** the model reads `kb://<id>/notes/a:b.md`, whose split-off suffix `b.md` lies outside the grammar
- **THEN** the tool returns `invalid_selector` with the one message that names the working forms, followed on a `kb://` or `skill://` resource path by the `%3A` spelling, here `kb://<id>/notes/a%3Ab.md`
- **AND** a malformed locator part, such as an undecodable segment, remains `invalid_path`

#### Scenario: A listing and the catalog read their tails

- **WHEN** the model reads `/var/log/:-20` and `skill://:-10`
- **THEN** the directory read returns the last twenty entries of its requested level and the catalog read the last ten entries of its count, as its single range
- **AND** neither adds context lines

### Requirement: Multi-range reads return context-bounded intervals

A regular-file `read` SHALL accept two or more comma-separated `N-M`, `N+K`,
`N-`, or `-K` ranges, or `raw:` followed by two or more comma-separated ranges
of those same members, `N+K` included. `N-` and `-K` are resolved against the
file's line count before the sort and merge below, exactly as a bare selector
resolves them, and a resolved empty `N-` member fails only when it is the
first requested start.
Every bound SHALL satisfy the existing positive safe-integer rules. Invalid
bounds and more than 64 input ranges SHALL fail with `invalid_selector`. Empty
members, whitespace, or malformed members SHALL fail the whole request with
`invalid_selector` on every source.
The tool SHALL sort ranges by start, merge overlapping or adjacent ranges,
expand each merged interval by one preceding and one following source line
when available, clip the expansion to the file bounds, and merge expanded
intervals that overlap or sit adjacent. Raw multi-range requests SHALL NOT
expand context. A comma-separated request SHALL report plural range fields
even if normalization and expansion leave one interval.

For a non-raw, non-outline Markdown source, each merged expanded passage SHALL
also prepend its ancestor headings as specified by the ranged Markdown ancestor
requirement.

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
retries, as in single-range continuations. Single-range continuation SHALL
remain unchanged, and single-range result fields remain singular unless the
ranged Markdown ancestor rule promotes them.

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
- **AND** a malformed `kb://` suffix such as `:5-10,,20-30` returns `invalid_selector` like a host selector, because the locator before the suffix parses

#### Scenario: Literal filename wins

- **WHEN** `/tmp/report:5-10,20-30` exists as a regular file and is read
- **THEN** it is read as the literal filename without applying ranges

#### Scenario: Resolved tail and open-ended members join one request

- **WHEN** a 40-line file is read with `:1-5,-20` or `:raw:1-5,30-`
- **THEN** the members resolve to 1..5 and 21..40, or to 1..5 and 30..40, and the shipped sort, merge, and context expansion run on the resolved ranges
- **AND** the raw form emits only the resolved lines verbatim, without context, gap markers, or prefixes

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
Markdown-only or per-file byte policy SHALL apply to `kb://` operations, except
that the explicit `outline` representation is available only for content the
representation requirements identify as Markdown; text and raw reads, edits,
and writes are unaffected.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`; content SHALL be returned
verbatim so that `edit` `oldText` can be copied from it once the generated
line-number prefixes are removed, or read with `:raw` to omit them. An
`outline` read returns a selection of verbatim source lines under that same
rule while retaining the same locator, Space attribution, and notice.

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
- **THEN** the tool returns `invalid_selector`, because a literal `:` after the identifier starts the selector and `b.md` lies outside the grammar
- **AND** it does not probe for a literal file; the message names the working forms and the file is addressed as `kb://<id>/notes/a%3Ab.md`

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

#### Scenario: Knowledge outline keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/notes/guide.md:outline`
- **THEN** the result is the note's outline with the Space identifier, display name, locator, and untrusted-content notice
- **AND** `kb://<id>/notes/guide.md:outline:raw` returns `invalid_selector`, because `raw` is not a member `outline` accepts

### Requirement: Web locators are fetched by the native read tool

The native `read` tool SHALL accept an absolute `http://` or `https://`
locator as its `path` and SHALL fetch it with the API process's own outbound
HTTP. No other web scheme SHALL be admitted, and `edit` and `write` SHALL
reject a web locator with `invalid_path` before any request. A submitted web
locator, after any fragment is cut and its selector is split off, SHALL be
normalized to its WHATWG URL serialization and requested as that text: an
uppercase scheme or host, a percent-encoded or Unicode host, an explicit
default port, a host's root dot, an empty path, unencoded path or query
characters, and percent-escapes in the path or query SHALL each be
normalized rather than refused, because none of them
addresses a different resource and refusing them cost a call that taught the
model nothing it could carry to the next locator. Path and query escapes
SHALL be normalized in one pass that yields a fixed point: a `%` that does not
begin a valid escape SHALL be encoded as `%25`, an escape of an unreserved
character (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) SHALL be decoded, and every
other escape, `%2F` included, SHALL stay encoded with uppercase hexadecimal
digits, so normalizing the normalized text changes nothing and llame's
normalization forms no new escape. A fragment SHALL be cut
before anything else reads the locator, because the request drops it anyway.
What no normalization can repair SHALL still fail before any request: a text
that is not a URL, a scheme outside `http` and `https`, and userinfo, which
SHALL fail with `invalid_path` so the tool never sends credentials the model
embedded in a URL, and whose message SHALL NOT echo them. A suffix outside the
selector grammar SHALL fail with `invalid_selector` naming the working forms,
because the locator before that suffix is a URL this tool can request.

After the submitted locator is admitted and canonicalized, the read SHALL
consider the ordered, code-owned web adapters before the generic HTML and text
ladder. A matching adapter SHALL be selected without network I/O. `:raw` SHALL
bypass every adapter and retain the raw-response behavior below; `:outline`
SHALL NOT bypass an adapter, because it describes the document a plain read
of the same locator returns, so a claiming adapter's rendered document is the
outline's input. An adapter SHALL
not add a tool id, a second permission group, or a different source authority.
An adapter target is another derived locator and SHALL be admitted in its own right.

Because the text requested is no longer always the text submitted, the
permission decision SHALL be taken over both: any reject clause matching
either the submitted locator with its read selector removed or its normalized form SHALL refuse the call, so
a spelling cannot be arranged to miss a reject, while the allow SHALL be
decided on the normalized form, because an allow names the resource the call
will reach and the two texts are one resource. A redirect hop is a different
resource and SHALL keep being admitted in its own right, and every address a
request would connect to SHALL additionally be judged under the
address-admission requirement below. Availability and
restriction for the web SHALL come only from the `read` permission group's
`path` clauses: a prefix allow admits the web, and a prefix or domain reject
removes a host. This web-availability rule governs a `default`-mode attempt; under `bypass` the web is reachable without a `path` allow, as this capability's Purpose states. No web tool id, `tools.allowed` entry, configuration block, or
advertisement condition SHALL be added; a process that does not advertise
`read` SHALL NOT reach a URL through it. Each call SHALL fetch afresh: no
response or render SHALL be cached, and a later selector read of the same
locator SHALL issue a new request. The tool SHALL NOT consult `robots.txt` or
any publisher signal such as `content-signal`, and a fetch SHALL NOT be
represented as permission from the publisher. The scheme split and trailing
selector rules that protect a `scheme://` prefix SHALL apply unchanged: the
scheme's own colon is never read as a selector, and the shipped
trailing-selector split (the last colon after the last slash) governs the
rest, except that the `:raw` and `:outline` representation forms are
recognized before that last-colon fallback. A selector SHALL be split only from a locator that has a path and
carries no `?` and no `#`, so a colon inside a query is part of the URL
(`https://example.test/search?at=2026:10` is fetched as written) and the only
colon of a pathless locator opens its port: `https://example.test:88` is port
88, `https://example.test/:88` is line 88 of the site root, and
`https://example.test:88/:88` is line 88 served from port 88.
A literal colon in the last path segment of a query-free locator SHALL be
written as `%3A` (`https://w.example/wiki/Special%3ASearch`), because a
trailing colon is always read as a selector split and the shipped grammar
admits `raw`, `raw:<list>`, `N`, `N-M`, `N+K`, `N-`, `-K`, comma lists of
those, `outline`, `outline:N`, `outline:N-M`, `outline:N+K`, `outline:N-`, and
`outline:-K`, with `:<list>:raw` the same read as `:raw:<list>`: `Search`
is outside it, so `https://w.example/wiki/Special:Search`
fails as `invalid_selector`, while `https://w.example/docs/2024:10` selects
line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of
`https://w.example/docs/2024`. A suffix `:outline` or `:outline:<range>` is
split as the outline representation before the last-colon fallback, so
`https://h.example/p:outline:5-40` requests `https://h.example/p` and scopes
the outline to rendered lines 5 through 40; a literal last-segment colon in a
path intended to end in `outline` SHALL be percent-encoded.
Each refusal that remains SHALL name the spelling that would work rather than
the rule that was broken: a selector written straight after the authority
(`https://example.test:1-5`, which is not a URL at all because `1-5` is not a
port) SHALL be answered with the authority's own serialization carrying that
selector (`https://example.test/:1-5`); a port that is not a number
(`https://example.test:abc/`) SHALL be answered by naming that rule and the
same locator without a port, rather than by the generic message, since the
locator is absolute and only its port is broken; a suffix that meant a line the
grammar cannot serve (`:12+`), or any other suffix outside it (`Search`), SHALL be answered with the forms, `N-` and
`-K` included, first and the literal colon's encoding second; and a selector
the render could not
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

#### Scenario: An encoded unreserved character cannot slip past a path reject

- **WHEN** the `read` group rejects `path` matching `^https://example\.test/private` and the model reads `https://example.test/%70rivate`
- **THEN** the call is rejected before any request, because the normalized text is `https://example.test/private`
- **AND** `https://example.test/%%370rivate` is requested as `https://example.test/%2570rivate`, whose once-decoded path is the literal `/%70rivate` it named, so llame's normalization forms no new escape; a server that decodes a path twice can still read it as `/private`, which a path-scoped rule cannot bound
- **AND** `https://example.test/a%2fb` is requested as `https://example.test/a%2Fb`, still encoded

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
- **AND** `https://w.example/wiki/Special:-5` is the last five rendered lines of `https://w.example/wiki/Special`, and the literal spelling of that same resource is `https://w.example/wiki/Special%3A-5`

#### Scenario: Outline representation splits before the last-colon fallback

- **WHEN** the model reads `https://h.example/p:outline:5-40`
- **THEN** the request targets `https://h.example/p` and the outline is scoped to rendered lines 5 through 40
- **AND** the `:outline` text is not sent as part of the URL path

#### Scenario: A refused locator names the spelling that works

- **WHEN** the model reads `https://example.test:1-5`, which no URL parser accepts because `1-5` is not a port
- **THEN** the read returns `invalid_path` naming `https://example.test/:1-5`, and resubmitting that reads lines 1 through 5 of the page
- **AND** reading `https://example.test/guide:12+` returns `invalid_selector` naming the `:N`, `:N-M`, `:N+K`, `:N-`, and `:-K` forms before the `%3A` spelling, while `https://example.test/guide:12-` reads line 12 through the render's last line
- **AND** a suffix outside the grammar with no line number in it, such as `https://w.example/wiki/Special:Search`, names the same forms and then the encoded spelling

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

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, `raw`, or
`adapter`, and SHALL name the ladder stage or adapter that produced the returned content.
For `method: "adapter"`, the result SHALL carry an `adapter` object with its
stable `id` and `route` (`native` or `rewrite`); `origin` SHALL be present only
for `rewrite`. The adapter result SHALL keep `finalUrl` equal to the source URL,
not its derived request target, and notes SHALL identify delegated content and
its origin when applicable. The result SHALL
NOT carry a `url` field, a `contentType` field, a `markdownTokens` field, a
text header before the content, or a metadata frontmatter block. Line
selectors SHALL apply to the rendered text exactly as to a local file, with
the existing context, range, `nextOffset`, and truncation rules, and the
rendered text SHALL be measured against the existing native read result bound,
which SHALL reserve space for `path`, `finalUrl`, `method`, `adapter`, and
`notes` before
truncating content. A `-K` member requested on an adapter document the web
plane cut at its 5 MiB document bound SHALL fail with `representation_too_large`
naming the cut and SHALL return no partial content, because the end of a cut
document is not the end the source holds; an `N-` member and an ordinary read of
the same document are unaffected and keep the ordinary truncation note. A web read SHALL NOT carry `realPath`. A selector read of
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

#### Scenario: A tail member on a cut adapter document is refused

- **WHEN** the model requests a `-K` member of an adapter document the web plane cut at its 5 MiB document bound
- **THEN** the tool returns `representation_too_large` naming the cut and no content
- **AND** an `N-` member and the ordinary read of that document still return it with the ordinary truncation note

#### Scenario: Adapter provenance preserves the source identity

- **WHEN** a declared rewrite entry renders `https://x.com/jack/status/20` through `https://x.pcstyle.dev`
- **THEN** the result has `method: "adapter"`, `finalUrl: "https://x.com/jack/status/20"`, and an adapter object with route `rewrite` and origin `https://x.pcstyle.dev`
- **AND** its notes state that the content came through the configured origin

### Requirement: Outline scope prepends the direct ancestors

`:outline:N-M` (and `:outline:N` for `N-N`, `:outline:N+K` for the `K` lines
from `N`, as ordinary `:N+K` selects, `:outline:N-` for the lines from `N`
through the source's last line, and `:outline:-K` for its last `K` lines, each
resolved against the source's count as an ordinary range member is) SHALL
restrict the emitted lines to those whose source line lies in the
scope, and SHALL prepend the direct ancestor chain of source line `N`: the
root headings whose sections contain `N`, from the shallowest to the deepest,
each rendered as an in-scope heading is (its heading lines and its excerpt
line) restricted to lines before `N`, because lines from `N` on follow the
in-scope rule, and each omitted when its own lines already lie in scope.
The ancestor chain is context: when the chain together with the first
in-scope entry does not fit the shared serialized result cap or the
2,000-line ceiling, the chain SHALL be omitted whole, so a continuation read
always advances. The omission is silent: `truncated` and `nextOffset` report
only in-scope output that was cut. A scope that holds no entry after its
chain is omitted SHALL return a successful outline with empty content and a
null shown range.
Frontmatter lines and the
root excerpt appear only when their source lines lie in scope. A scope that
begins past the source's last line SHALL fail as an ordinary range past the
end does. No comma-separated scope SHALL be accepted.

#### Scenario: A scope shows the headings it contains and what encloses them

- **WHEN** a file holds `# Title` at line 1, `## Setup` at line 30, `### Linux` at line 44, `### macOS` at line 70, and `## Use` at line 100, and the model reads `:outline:60-90`
- **THEN** the outline is the ancestor chain of line 60, `1: # Title`, `30: ## Setup`, and `44: ### Linux` with their excerpt lines before line 60, then `70: ### macOS` with its excerpt line
- **AND** `100: ## Use` is absent because line 100 lies outside the scope

#### Scenario: A single line answers with its ancestors

- **WHEN** the model reads `:outline:65` of that file
- **THEN** the outline is `1: # Title`, `30: ## Setup`, `44: ### Linux` with their excerpt lines
- **AND** nothing after line 65 is emitted

#### Scenario: An ancestor chain larger than the result is omitted

- **WHEN** a root setext heading has text on lines 1 through 3,000 and its `===` underline on line 3,001, its section holds `first body` on line 3,003, `## In scope` on line 3,550, and `scope body` on line 3,552, and the model reads `:outline:3500-3600`
- **THEN** the outline is `3550: ## In scope` and `3552: scope body`, without the omitted chain
- **AND** `truncated` is false, and an unscoped outline of the same file that is cut at the 2,000-line ceiling continues through `:outline:<nextOffset + 1>-M` without repeating a result

#### Scenario: A scope with no entry returns an empty outline

- **WHEN** the model reads `:outline:3500` of that file, whose line 3,500 lies in the heading's section body
- **THEN** the result is a successful outline with empty content, a null shown range, and `truncated: false`
- **AND** it carries no `nextOffset`

#### Scenario: A scope past the end is refused

- **WHEN** the model reads `:outline:500-600` of a 120-line file
- **THEN** the tool returns `invalid_selector` under the ordinary out-of-range rule
- **AND** no outline content is returned

#### Scenario: A scope reaches the last line or the tail of a source

- **WHEN** the model reads `:outline:60-` of the file whose `## Use` sits at line 100 and whose last line is 120
- **THEN** the outline carries the ancestor chain of line 60 and every entry whose source line lies in 60 through 120
- **AND** `:outline:-20` of that file is the same scope as `:outline:101-120`, with the chain of its first line prepended

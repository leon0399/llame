# native-file-tools

## MODIFIED Requirements

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`, plus comma-separated selectors under the
multi-range requirement below. It SHALL also accept the `outline`
representation member with at most one optional source range, `:outline`,
`:outline:N`, `:outline:N-M`, or `:outline:N+K`, under the representation
requirements below; a comma-separated list after `outline` is outside the
grammar and SHALL fail under each source's shipped precedence
(`invalid_selector` for host and web, `invalid_path` for `kb://` and
`skill://`). A valid selector SHALL be normalized once to
internal zero-based ranges. The tool SHALL recognize a `scheme://` prefix before
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

For an ordinary ranged read of a `text/markdown` source, `content` SHALL also prepend the direct ancestor heading lines for the passage's first requested line, as specified by the ranged Markdown ancestor requirement. When at least one ancestor line is emitted, a single-range result SHALL report plural `requestedRanges` and `shownRanges` fields instead of singular fields. For single-range reads, result
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
processors. `:outline:raw` and `:raw:outline` are not representation members
and SHALL follow each source's shipped precedence: host and web keep their raw
interpretation of `:outline:raw` as a path or URL ending in `:outline`, while
`kb://` and `skill://` return `invalid_path` for either suffix. Directory reads SHALL apply single-range selectors to listing entries under the
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

For a non-raw, non-outline Markdown source, each merged expanded passage SHALL prepend the direct ancestor heading lines for that passage's first requested line, shallowest first, deduplicated against every line already shown by earlier passages and chains, and output SHALL remain in source order. `requestedRanges` SHALL exclude ancestor lines, while `shownRanges` SHALL include them.
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
- **AND** a malformed `kb://` suffix such as `:5-10,,20-30` retains `invalid_path`; valid comma grammar with invalid numeric bounds retains `invalid_selector`

#### Scenario: Literal filename wins

- **WHEN** `/tmp/report:5-10,20-30` exists as a regular file and is read
- **THEN** it is read as the literal filename without applying ranges

### Requirement: Read representations are selected by media type and member

A representation SHALL be selected from a closed, compile-time table keyed by
the admitted content's media type and the requested member. The table SHALL
hold the `raw` and `outline` members; it
SHALL NOT be runtime-configurable, operator-loadable, or dynamically imported.
A member SHALL belong to one of two output classes: a `:` member returns
verbatim source lines with a shown range (`raw` without generated line
prefixes, as raw reads always have, and `outline` with the ordinary
line-number prefixes), and a future `?` member would return transformed
content with no prefixes and no shown range; no `?` member and no `?` grammar
exists yet. With no member named, reading SHALL remain unchanged except that an ordinary ranged Markdown read SHALL prepend the direct ancestor headings under the ranged Markdown ancestor requirement. A member
requested for a media type the table does not map SHALL fail with
`invalid_selector` naming the member's accepted media types, and the ordinary
read of that source SHALL remain available.

The media type SHALL be derived from the source, never from the body's
appearance: a host, `file://`, `kb://`, or `skill://` regular file by the
extension table `.md`, `.markdown`, `.mdown`, and `.mkd` to `text/markdown`,
with `.mdx` excluded and every other extension mapping to no
representation-eligible type; a web ladder result by its stage —
`text/markdown` for a `negotiated` response whose `Content-Type` is
`text/markdown` and for `alternate`, `md-suffix`, `readability`, and
`llms-txt`, the served type for `text` and for a `negotiated` `text/plain`
body, and none for `raw`; a web adapter result by the label the adapter
contract requires. A reader SHALL receive only the admitted decoded content as
a sequence of native lines, the source display identity, and the selector's
source scope; a file source SHALL feed those lines as it reads them rather
than decoding the whole file first. A reader SHALL NOT change source
admission, permission projection, owner resolution, executor binding, request
policy, or the source-specific result envelope. Readers over
bytes rather than decoded text SHALL define their own input contract rather
than widening this one.

#### Scenario: A Markdown file selects the outline reader

- **WHEN** the model calls `read` with an authorized Markdown file and the `:outline` member
- **THEN** the result has `representation: "outline"` and contains the deterministic outline
- **AND** the source is admitted exactly as it is for an ordinary read

#### Scenario: An omitted member keeps the existing read

- **WHEN** the model reads an authorized Markdown file without a member
- **THEN** the result uses the existing text representation and line-numbered source content
- **AND** no outline is appended or inferred; a ranged Markdown read prepends its ancestor headings under the ranged Markdown ancestor requirement.

#### Scenario: An unsupported media type names the accepted types

- **WHEN** the model requests `:outline` for an otherwise readable `.json`, `.mdx`, `.pdf`, `.txt`, or binary file, or for a web read whose result is `text`, `raw`, or a `negotiated` `text/plain` body
- **THEN** the tool returns `invalid_selector` naming `text/markdown` as the member's accepted media type
- **AND** an ordinary read of that source is unchanged

#### Scenario: Admission denies the submitted locator before any parse

- **WHEN** permission admission denies the submitted `:outline` locator, including a host rule that matches the suffix-bearing submitted text
- **THEN** the tool returns the same `permission_denied` result as the ordinary read
- **AND** no media-type derivation or Markdown scan is attempted

#### Scenario: Web ladder Markdown supports outline

- **WHEN** a web read's result method is `alternate`, `md-suffix`, `readability`, or `llms-txt`, or is `negotiated` with a `text/markdown` response
- **THEN** `:outline` scans that rendered body and its line numbers refer to the rendered text
- **AND** the web envelope and provenance remain present

#### Scenario: A directory or catalog is not an outline document

- **WHEN** the model requests `:outline` on a host, `file://`, `kb://`, or `skill://` directory, on `skill://`, or on a web read whose adapter returned a directory result
- **THEN** the tool returns `invalid_selector`
- **AND** it does not reinterpret the listing as headings or return a listing page as outline content

### Requirement: Outline output obeys explicit bounds

The Markdown reader SHALL scan the source in one forward pass, holding only
the open container and heading stacks, the lines it will emit, and the lines
whose meaning a later line decides (an open root paragraph that a setext
underline may turn into a heading, a paragraph whose first line may open a
link reference definition, and the lines after a line-one `---` until its
closer), so a file source SHALL have no input size ceiling beyond the
abort signal; a web body and an adapter document keep the web plane's 5 MiB
bounds. A source that is one undecided run, such as a single paragraph with
no blank line or a line-one `---` that never closes, is held until that run
is decided. The scan SHALL stop once the lines through the scope end are decided
or the result budget is spent. Outline output
SHALL obey the shared serialized result cap and 2,000-line ceiling; when it is
cut, `truncated` SHALL be true and `nextOffset` SHALL be the zero-based index
of the first omitted entry's source line, where an entry is one emitted line,
so an outline is cut between lines and never inside one, as every read result's
`nextOffset` is, so `:outline:<nextOffset + 1>-M` continues it against
the source observed by that later call. An adapter document the web plane
truncated at its document bound SHALL fail with `representation_too_large`
and SHALL return no partial outline, because an outline of a cut document
would omit structure without saying so. Line numbers SHALL use the native LF
line model that ordinary reads use. A successful outline SHALL not imply a
source snapshot: a later range read reauthorizes and rereads the current
source.

#### Scenario: A large file is outlined in one pass

- **WHEN** the model requests `:outline:40000-41000` of a 200 MiB Markdown file of ordinary blank-line-separated sections
- **THEN** the outline is returned without the file being loaded whole
- **AND** an ordinary range read of that file follows the ranged Markdown ancestor rule

#### Scenario: A long outline reports continuation

- **WHEN** the outline exceeds the shared line or serialized result bound
- **THEN** the result reports `truncated: true` and `nextOffset` as the zero-based index of the first omitted entry's source line
- **AND** a read of `:outline:<nextOffset + 1>-M` continues from that entry

#### Scenario: A truncated adapter document has no outline

- **WHEN** an adapter document was cut at the web plane's 5 MiB document bound and the model requests `:outline`
- **THEN** the tool returns `representation_too_large`
- **AND** no partial outline is returned, while the ordinary adapter read still returns its truncated document and note

#### Scenario: Line numbers use the native LF line model

- **WHEN** a Markdown source contains CRLF, a lone CR, and a trailing LF
- **THEN** outline line numbers count LF delimiters exactly as ordinary native reads count them, keep lone CR inside a line, and add no line for the trailing LF
- **AND** every emitted prefix is a valid ordinary selector line

#### Scenario: Outline coordinates are execution-time coordinates

- **WHEN** the source changes between an outline call and a later ordinary range read
- **THEN** the later read uses the current source and may return different text for the old range
- **AND** neither call claims a snapshot or stale-selection authority

## ADDED Requirements

### Requirement: Ranged Markdown reads prepend their ancestor headings

An ordinary, non-`:raw`, non-`:outline` ranged `read` of a `text/markdown`
source SHALL prepend the direct root-heading ancestor chain of each passage's
first requested source line N, shallowest first. The preceding context line at
N-1 remains shown but does not select headings. Each ancestor SHALL be rendered
from its own source lines with the ordinary one-based `N:` prefix followed by a
space. An ATX heading contributes its heading line; a setext heading
contributes all of its text lines plus its underline, verbatim. The chain SHALL
NOT include an excerpt line and SHALL NOT apply the outline reader's 120-code-
unit cut. A heading line already shown by the context-expanded window or an
earlier chain SHALL NOT be repeated.

A single-range result that emits at least one ancestor line SHALL use the plural
`requestedRanges` and `shownRanges` fields. Its `requestedRanges` SHALL contain
only the requested source interval, while its `shownRanges` SHALL contain the
ancestor lines and the ordinary context-expanded window, merging adjacent
intervals. A range with no emitted ancestor SHALL retain the singular result
shape. Comma-separated reads SHALL apply this rule independently to every
merged passage using that passage's first requested line, deduplicate by source
line, and keep the content in source order: a chain emits only heading lines
before its passage's first shown line, and a chain line that would precede
content already emitted SHALL be skipped.

Ancestor lines SHALL count against the shared 2,000-line ceiling and serialized
result bound. If a passage's complete chain plus all mandatory output through
the first requested line N does not fit, including the N-1 context line when it
is shown and not already emitted and line N, whole headings SHALL be dropped
from the outermost end until the deepest remaining heading plus that mandatory
output fits. A setext heading's text lines and underline SHALL be dropped as
one unit. If even the deepest heading does not fit, no chain SHALL be emitted
and the passage window SHALL still be returned when it can fit. `nextOffset`
keeps its existing meaning for single- and multi-range reads and never
identifies a line emitted only as an ancestor. A continuation at
`nextOffset + 1` SHALL calculate a fresh chain, so an ancestor MAY reappear
across continuations. A trimmed or absent chain SHALL be silent and SHALL NOT
add a flag field.

A ranged read SHALL never read past its requested window. The Markdown scanner
SHALL end at the window end; a line whose role is undecided at that boundary
SHALL count as not a heading for this read. An open paragraph that might become
a setext heading and an unclosed line-one `---` block SHALL be replayed as
Markdown rather than resolved with later input. The same window-end rule SHALL
apply to web renders, so host and web produce the same ancestors for the same
text and window.

The rule SHALL apply uniformly to host paths, `file://`, `kb://`, `skill://`,
and web renders labeled `text/markdown`, after existing permission admission
and source resolution. It SHALL preserve each source's existing identity,
Knowledge attribution and untrusted-content notice, web provenance, and
execution-time coordinates. `:raw`, `:outline`, directory reads, unselected
reads, empty files, non-Markdown reads, and `edit`/`write` post-edit previews
SHALL remain unchanged. Mutation previews SHALL not receive ancestor headings.

#### Scenario: A ranged read prepends its enclosing headings

- **WHEN** a Markdown file has `# Level one` at line 13, `## Level two` at line 32, `### Level three` at line 54, and a read requests `VISION.md:60-72`
- **THEN** the result emits the following source lines in order, including the ordinary context lines at 59 and 73:

  ```text
  13: # Level one
  32: ## Level two
  54: ### Level three
  59: <context line>
  60: ... through 72: <requested lines>
  73: <context line>
  ```

- **AND** the result reports `requestedRanges: [{startLine: 60, endLine: 72}]` and `shownRanges` covering `{13,13}`, `{32,32}`, `{54,54}`, and `{59,73}`

#### Scenario: Setext ancestors retain all text lines and the underline

- **WHEN** the first requested line of a Markdown passage is enclosed by a setext heading whose text occupies lines 9 and 10 and whose underline occupies line 11
- **THEN** all three source lines are emitted verbatim before the passage
- **AND** the three adjacent ancestor lines appear as one `{startLine: 9, endLine: 11}` interval in `shownRanges`

#### Scenario: An ancestor adjacent to the context line merges

- **WHEN** an ancestor heading is immediately before the preceding context line for a requested Markdown range
- **THEN** the heading, context line, requested lines, and following context line are emitted once in source order
- **AND** the adjacent heading and context line are represented in one merged `shownRanges` interval

#### Scenario: A window starting on a heading does not repeat it

- **WHEN** the requested line of a Markdown range is itself a heading already present in the selected window
- **THEN** the direct ancestor chain selected by that requested line is emitted before the window
- **AND** that heading source line appears only once

#### Scenario: No enclosing heading keeps the singular shape

- **WHEN** an ordinary Markdown range starts in content before any root heading, or starts at line 1
- **THEN** the read returns its existing context-expanded content
- **AND** it retains singular `requestedRange` and `shownRange` fields and emits no ancestor line

#### Scenario: An edit preview of a Markdown file has no ancestors

- **WHEN** `edit` or `write` produces a post-edit preview for a Markdown file whose changed region has an enclosing heading
- **THEN** the preview retains its existing context and line-range behavior without ancestor headings
- **AND** the mutation result does not promote its singular `shownRange`

#### Scenario: Non-Markdown `.txt` remains unchanged

- **WHEN** an ordinary range selects content from a `.txt` file with heading-looking lines
- **THEN** the result has the existing text-read content and context behavior
- **AND** it emits no ancestor headings and does not promote its range fields

#### Scenario: `:raw` remains unchanged

- **WHEN** the model reads a Markdown range with `:raw`
- **THEN** the selected source bytes remain verbatim without context or generated prefixes
- **AND** no ancestor line is emitted

#### Scenario: `:outline` remains unchanged

- **WHEN** the model reads a scoped Markdown range with `:outline`
- **THEN** the result follows the outline representation's existing scope, ancestor, excerpt, and output rules
- **AND** ordinary ranged-read ancestors are not added a second time

#### Scenario: A comma read with two passages emits a shared ancestor once

- **WHEN** a Markdown file has one root heading enclosing two disjoint requested passages in different child sections and the model requests both in one comma selector
- **THEN** each passage is preceded by its direct ancestor chain, in source order
- **AND** the shared root heading is emitted once, while each distinct child heading is emitted once before its own passage
- **AND** `requestedRanges` excludes all ancestor lines and `shownRanges` includes them

#### Scenario: A continuation at `nextOffset + 1` gets its own chain

- **WHEN** a truncated Markdown range returns a `nextOffset` inside a section and the caller retries from `nextOffset + 1`
- **THEN** the retry emits the direct ancestor chain for the retry's first requested line when it fits
- **AND** the retry does not treat the earlier result's chain as carried state

#### Scenario: Outermost headings are dropped first when a chain does not fit

- **WHEN** the chain is `# Title`, `## Setup`, and `### Linux`, and the shared budget fits only one heading line plus all mandatory output through the first requested line, including a shown and not already emitted N-1 context line and line N
- **THEN** the result emits `### Linux` and the requested passage, without `# Title` or `## Setup`
- **AND** whole setext headings are dropped as units, and if even the deepest heading cannot fit the passage window still returns when it can without emitting a chain

#### Scenario: Web Markdown renders get ancestors and web `text/plain` does not

- **WHEN** the web read renders one locator as `text/markdown` and another as `text/plain`, both with the same ordinary range selector
- **THEN** the Markdown result includes its ancestor headings and the plain-text result does not
- **AND** both results retain their existing web `path`, `finalUrl`, `method`, adapter, notes, and truncation behavior

#### Scenario: A `kb://` ranged read gets ancestors and keeps Space attribution and notice

- **WHEN** the model reads a Markdown note through `kb://<space-id>/notes/guide.md:60-72`
- **THEN** the result includes the direct ancestor chain and ordinary context lines for that note
- **AND** it retains the Space identifier, display name, locator, and untrusted-content notice

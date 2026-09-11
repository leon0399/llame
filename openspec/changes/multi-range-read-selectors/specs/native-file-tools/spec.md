## MODIFIED Requirements

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`, plus comma-separated selectors under the
multi-range requirement below. A valid selector SHALL be normalized once to
internal zero-based ranges. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing; a `kb://` path component SHALL NOT contain `:`, so the split is
unambiguous without probing. A `path` that begins with a `scheme://` prefix the
tool does not implement SHALL fail closed with `invalid_path` on every tool and
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

## ADDED Requirements

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

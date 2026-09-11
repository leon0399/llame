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

### Requirement: Multi-range reads return exact bounded intervals

A regular-file `read` SHALL accept two or more comma-separated `N-M` or `N+K`
ranges, or `raw:` followed by two or more comma-separated `N-M` ranges.
Every bound SHALL satisfy the existing positive safe-integer rules. Invalid
bounds and more than 64 input ranges SHALL fail with `invalid_selector`. Empty
members, whitespace, or malformed members SHALL fail the whole request under
existing error precedence: `invalid_selector` for parsed host selectors and
`invalid_path` for malformed `kb://` locator suffixes.
The tool SHALL sort ranges by start and merge overlapping or adjacent ranges.
A comma-separated request SHALL remain exact even if normalization leaves one
range: no context lines or duplicate source lines SHALL be emitted.
Absolute literal-path precedence and scheme-specific authorization SHALL apply
before reading as for existing selectors. Directory comma selectors SHALL fail
with `invalid_selector`; ordinary directory selectors SHALL remain unchanged.

Multi-range results SHALL replace singular `requestedRange` and `shownRange`
with `requestedRanges` and `shownRanges`, arrays of one-based inclusive
`{startLine, endLine}` intervals. Requested ranges SHALL retain normalized input
bounds; shown ranges SHALL describe only emitted lines. Content SHALL concatenate
selected source lines in source order, using existing numbered rendering or
verbatim raw rendering, without gap markers. `representation`, `path`, and
`truncated` SHALL retain their existing meanings. On reaching EOF, ends SHALL
clip to available source and later ranges SHALL emit nothing; EOF alone SHALL
NOT indicate truncation. A nonempty file whose first requested start exceeds
EOF SHALL fail with `invalid_selector`. An empty file starting at line 1 SHALL
return empty content and empty arrays; other starts SHALL fail.

The existing serialized-result cap, including metadata and the authority's
envelope, and shared 2,000-line ceiling SHALL apply once to the entire result.
If the required metadata cannot fit, the call SHALL fail with `invalid_selector`.
The tool SHALL return a prefix of normalized ranges, favoring whole ranges:
after emitting one complete range, a subsequent range that cannot fit SHALL be
omitted in full and end the read. If the first range cannot fit, the tool SHALL
emit the complete source lines from its prefix that fit. An individually
oversized line SHALL be omitted under the existing forward-progress rule.
A truncated result's zero-based `nextOffset`, when present, SHALL identify the
first remaining selected line, skipping gaps and an individually oversized
line that cannot fit on retry. It SHALL be absent when no selected line remains.
A caller SHALL resume by trimming `requestedRanges` at `nextOffset + 1`, rather
than reading a continuous interval through gaps. Single-range result fields and
continuation SHALL remain unchanged.

#### Scenario: Unsorted overlapping ranges become one exact interval

- **WHEN** a file read requests `:20-30,5-10,10+10`
- **THEN** it returns lines 5 through 30 exactly once, without lines 4 or 31
- **AND** requested and shown arrays each contain the interval 5..30 when it fits

#### Scenario: Disjoint and raw reads preserve selected source

- **WHEN** a file read requests `:5-10,20-30` or `:raw:5-10,20-30`
- **THEN** it emits only those two intervals, with two shown ranges
- **AND** raw content has no generated prefixes or gap markers

#### Scenario: Later range waits for continuation

- **WHEN** `:5-10,20-30` fits the first range but not all of the second
- **THEN** it emits only lines 5..10, reports truncation and `nextOffset: 19`
- **AND** an exact numbered retry uses `:20-30,20-30` to preserve comma mode

#### Scenario: First range exceeds the line ceiling

- **WHEN** `:1-2500,4000-4010` targets a sufficiently long file with short lines
- **THEN** it emits lines 1..2000, reports truncation and `nextOffset: 2000`
- **AND** the remaining request is `:2001-2500,4000-4010`

#### Scenario: The line ceiling is shared across ranges

- **WHEN** `:1-1500,3000-4500` targets a sufficiently long file with short lines
- **THEN** it emits only lines 1..1500 because the second whole range exceeds the remaining 500-line budget
- **AND** it reports truncation and `nextOffset: 2999`; an exact retry uses `:3000-4500,3000-4500`

#### Scenario: EOF limits shown ranges only

- **WHEN** a 25-line file is read with `:5-10,20-30,40-50` and output fits
- **THEN** requested ranges remain 5..10, 20..30, 40..50 and shown ranges are 5..10, 20..25
- **AND** the result is not truncated and has no continuation

#### Scenario: Invalid member rejects the request

- **WHEN** a nonliteral host read selector is `:5-10,,20-30`, `:5-10,0-2`, or contains 65 ranges
- **THEN** the tool returns `invalid_selector` without returning any selected content
- **AND** a malformed `kb://` suffix such as `:5-10,,20-30` retains `invalid_path`; valid comma grammar with invalid numeric bounds retains `invalid_selector`

#### Scenario: Literal filename wins

- **WHEN** `/tmp/report:5-10,20-30` exists as a regular file and is read
- **THEN** it is read as the literal filename without applying ranges

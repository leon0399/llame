# Spec Delta

## MODIFIED Requirements

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive selectors `:N-M`, `:N+K`,
`:raw`, and `:raw:N-M`, plus comma-separated selectors under the
multi-range requirement below. It SHALL also accept the explicit
representation selectors `:outline` and `:outline:<ranges>` for a supported
Markdown source; the range list after `outline` SHALL use the same positive
one-based range grammar and SHALL page the representation output rather than
filtering source lines. A valid selector SHALL be normalized once to internal
zero-based ranges. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing; a `kb://` path component SHALL NOT contain `:`, so the split
is unambiguous without probing. A `path` that begins with a `scheme://` prefix the
SHALL NOT be treated as a relative or literal filename. For regular-file reads,
ordinary single bounded ranges SHALL include one preceding and one following
source line when available, and the extended lines SHALL appear in the same
`content` block as the requested lines. For single-range reads, result details
SHALL identify requested and shown ranges, representation, path, and common
truncation state. For an `outline` result, requested and shown ranges SHALL
refer to lines of the generated outline content, while each generated outline
entry carries its own one-based source `N-M` range. Requested bounds SHALL
remain the normalized request even when the displayed source ends earlier; shown
bounds SHALL describe only emitted source lines. Empty files SHALL return null
ranges. `nextOffset` SHALL identify the next requested source line. Raw reads
SHALL return verbatim selected source content without generated line prefixes,
context expansion, or processors. `:raw:outline` and `:outline:raw` SHALL fail
with `invalid_selector`; `:raw` SHALL remain the existing raw representation.
Directory reads SHALL apply single-range selectors to listing entries under the
directory listing requirements and SHALL NOT add context lines. An outline
request on a directory SHALL fail under the outline refusal requirement rather
than reinterpret listing text as Markdown.

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
truncation, mutation, and `file_exists` behavior as absolute paths. Ordinary
`kb://` operations SHALL NOT acquire a Markdown-only or per-file byte policy;
the explicit `outline` representation SHALL be available only for a supported
Markdown file and SHALL NOT change that authority or ordinary non-Markdown
behavior.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`. An ordinary text or raw
read SHALL return content verbatim so that `edit` `oldText` can be copied from
it once the generated line-number prefixes are removed, or read with `:raw` to
omit them. An explicit `outline` read SHALL return generated outline content
instead of verbatim source while retaining the same locator, Space attribution,
and untrusted-content notice.

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

## ADDED Requirements

### Requirement: Read representations use the admitted content type

After the source-specific authority has admitted and resolved a `read`, the tool
SHALL select the content-type default reader when no explicit representation is
present. The default reader SHALL remain the existing line-numbered text
reader, with `:raw` retaining its existing verbatim behavior. An explicit
representation name SHALL select only a reader that supports the resolved
content type. The initial representation list SHALL contain `outline` for
Markdown content; the list SHALL be code-owned and static. A representation
reader SHALL not change source admission, permission projection, owner
resolution, executor binding, request policy, result bounds, or source-specific
result envelope. If a representation does not support the resolved type, the
tool SHALL return `invalid_selector` naming the supported Markdown types and
SHALL leave an ordinary read of that source available.

#### Scenario: A Markdown file selects the outline reader

- **WHEN** the model calls `read` with an authorized Markdown file and the `:outline` representation
- **THEN** the result has `representation: "outline"` and contains the deterministic outline
- **AND** the source is admitted exactly as it is for an ordinary read

#### Scenario: An omitted representation keeps the text reader

- **WHEN** the model reads an authorized Markdown file without a representation name
- **THEN** the result uses the existing text representation and line-numbered source content
- **AND** no outline is appended or inferred

#### Scenario: An unsupported representation names Markdown support

- **WHEN** the model requests `:outline` for an otherwise readable JSON, PDF, or binary source
- **THEN** the tool returns `invalid_selector` naming the supported Markdown content types
- **AND** an ordinary read of that source remains governed by its existing default reader

#### Scenario: A denied source is not parsed

- **WHEN** permission admission denies a path for an ordinary read and the model requests `:outline`
- **THEN** the tool returns the same `permission_denied` result as the ordinary read
- **AND** no content-type detection or Markdown parsing is attempted

#### Scenario: Raw and outline are not combined

- **WHEN** the model calls `read` with `:raw:outline` or `:outline:raw`
- **THEN** the tool returns `invalid_selector`
- **AND** it does not return source bytes or outline content

### Requirement: Markdown outlines have bounded navigable output

For a supported Markdown source, `:outline` SHALL return one generated output line
per recognized heading in document order, with indentation of two spaces per
heading depth below level one, the heading's plain text, and its one-based
inclusive source range written as `N-M`. The `N-M` token SHALL be directly
usable as the ordinary selector suffix on the original locator. Authored
frontmatter metadata and generated notes SHALL precede heading lines and SHALL
be marked as non-derived lines. The output SHALL contain no model-generated
summary, body excerpt, or heading-name selector. A Markdown source with no
recognized headings SHALL return its authored metadata, if any, followed by the
fixed minimal line `[outline] No headings found.`

#### Scenario: Outline entries carry source ranges

- **WHEN** an authorized Markdown file contains `# Guide` on line 3 and its section ends on line 12
- **THEN** outline content contains one line whose heading text is `Guide` and whose range token is `3-12`
- **AND** reading the original locator with `:3-12` addresses that section

#### Scenario: Hierarchy is represented by indentation

- **WHEN** a Markdown file contains a level-one heading followed by a level-three heading
- **THEN** the level-one line has no indentation and the level-three line has four spaces of indentation
- **AND** entries remain in source order without inserted ancestors

#### Scenario: A document without headings has a minimal result

- **WHEN** an authorized Markdown file has no recognized headings and no frontmatter metadata
- **THEN** the outline content is exactly `[outline] No headings found.`
- **AND** the result remains a bounded successful file read with `representation: "outline"`

#### Scenario: Outline output pages by output line

- **WHEN** the model calls `read` with `:outline:2-4`
- **THEN** the result selects outline output lines 2 through 4 under the ordinary result bounds
- **AND** it does not filter headings by source lines 2 through 4

### Requirement: Markdown heading sections use deterministic CommonMark boundaries

The outline SHALL recognize CommonMark ATX headings and setext headings only
outside fenced code blocks, indented code blocks, frontmatter, and HTML blocks.
An ATX heading starts at its ATX line. A setext heading starts at its text line
and includes its underline line. A heading's section SHALL begin at that
heading block and end at the line immediately before the next heading of equal
or greater depth, or at EOF when no such heading exists. A deeper heading SHALL
remain inside the nearest preceding shallower section. Heading text SHALL be
source-derived and untrusted; duplicate heading text SHALL remain separate,
and no selector SHALL address a heading by name.

#### Scenario: ATX and setext headings produce sections

- **WHEN** a Markdown file contains `# One` at line 1 and `Two` followed by `---` at lines 8 and 9
- **THEN** the outline reports the ATX section from line 1 and the setext section from line 8
- **AND** the first section ends before the next equal-or-higher heading

#### Scenario: Nested sections end at equal or higher depth

- **WHEN** a level-two heading is followed by a level-three heading and then another level-two heading
- **THEN** the level-three range ends before the second level-two heading
- **AND** the first level-two range includes the nested level-three section through the preceding line

#### Scenario: Fenced and indented code are not headings

- **WHEN** fenced or indented code contains lines such as `# not a heading`
- **THEN** those lines produce no outline entry
- **AND** surrounding real headings retain their source coordinates

#### Scenario: HTML blocks are not headings

- **WHEN** an HTML block contains a line beginning with `# not a heading`
- **THEN** that line produces no outline entry
- **AND** a Markdown heading after the closed HTML block is recognized normally

#### Scenario: Duplicate headings remain independently navigable

- **WHEN** a Markdown file contains two headings with the same text
- **THEN** the outline contains two entries with their own source ranges
- **AND** no name selector chooses either occurrence implicitly

### Requirement: Authored frontmatter is distinct from derived outline structure

Only a YAML frontmatter block that starts at line 1 with `---` and closes with
`---` or `...` SHALL be considered frontmatter. The block SHALL be excluded
from heading parsing. String scalar keys named exactly `title` and `description`
SHALL be emitted before headings as `[authored title] <value>` and
`[authored description] <value>` lines. Those lines SHALL be marked authored and
SHALL not claim source section ranges. A later horizontal rule SHALL remain
ordinary Markdown. A malformed or unclosed line-one frontmatter block SHALL be
ignored for metadata and headings SHALL still be parsed; the outline SHALL
include the fixed note `[note] Authored frontmatter ignored: malformed YAML.`

#### Scenario: Authored title and description are marked

- **WHEN** line one begins a valid YAML frontmatter block containing string `title` and `description` keys
- **THEN** the outline starts with `[authored title]` and `[authored description]` lines before derived heading entries
- **AND** those lines are visibly distinct from heading structure

#### Scenario: Frontmatter is excluded from heading parsing

- **WHEN** frontmatter contains `title: "# not a heading"` and the body contains one real Markdown heading
- **THEN** only the body heading produces a derived outline entry
- **AND** the authored title line contains the frontmatter value without a source range

#### Scenario: Malformed frontmatter does not block reading

- **WHEN** a line-one `---` block is unclosed or has malformed YAML and the body contains a valid heading
- **THEN** the outline contains the fixed malformed-frontmatter note and the body heading
- **AND** an ordinary read still returns the source under its existing contract

#### Scenario: A later horizontal rule is not frontmatter

- **WHEN** the first line is ordinary Markdown and a later line is `---`
- **THEN** the later rule is parsed under CommonMark and no authored metadata block is created
- **AND** any valid heading around it keeps its ordinary section boundaries

### Requirement: Outline parsing and output obey explicit bounds

An outline reader SHALL parse the complete decoded Markdown source only when the
source is no larger than 5 MiB in UTF-8 bytes. A larger source SHALL fail with
`representation_too_large`, SHALL not return a partial outline, and SHALL leave
ordinary reads available. The 5 MiB ceiling SHALL also apply to a web body
already bounded by the web read contract. Successful outline output SHALL use
the shared serialized result cap and 2,000-line ceiling after its source
ranges, authored lines, and notes are included. `truncated` and zero-based
`nextOffset` SHALL describe omitted outline output lines, and a continuation
SHALL re-run outline selection against the source observed by that call. A
successful outline SHALL not imply a source snapshot.

#### Scenario: A large source fails before parsing

- **WHEN** an authorized Markdown source exceeds 5 MiB in UTF-8 bytes and the model requests `:outline`
- **THEN** the tool returns `representation_too_large` without partial outline content
- **AND** an ordinary read of the same source retains its existing behavior

#### Scenario: A long outline reports continuation

- **WHEN** the generated outline exceeds the shared line or serialized result bound
- **THEN** the result reports `truncated: true` and a zero-based `nextOffset` for the next omitted outline line
- **AND** the emitted entries retain their source `N-M` coordinates

#### Scenario: Outline coordinates are execution-time coordinates

- **WHEN** the source changes between an outline call and a later ordinary range read
- **THEN** the later read uses the current source and may return different text for the old range
- **AND** neither call claims a snapshot or stale-selection authority

### Requirement: Unsupported Markdown outline targets fail closed without changing ordinary reads

The `outline` representation SHALL be available for host and `file://` sources
when their content type is identified as Markdown by the extension table
`.md`, `.markdown`, `.mdown`, or `.mkd`, and SHALL be available for `kb://` and
`skill://` resources under the same content-type rule. `.mdx` SHALL NOT be
included initially. For web sources, `outline` SHALL be available only when
the final adapter or generic ladder explicitly rendered the body as Markdown;
raw HTML, plain text, JSON, XML, and other non-Markdown text SHALL not be
reinterpreted by appearance. A directory target, unsupported content type,
invalid representation composition, or unsupported rendered web type SHALL
return `invalid_selector` naming Markdown outline support. A plain read,
including the existing directory listing, SHALL retain its result or error
contract.

#### Scenario: Markdown extensions select outline support

- **WHEN** the model requests `:outline` for files named `.md`, `.markdown`, `.mdown`, or `.mkd`
- **THEN** the Markdown outline reader is eligible
- **AND** a file named `.mdx` is not treated as Markdown for this representation

#### Scenario: A rendered web Markdown body supports outline

- **WHEN** a web adapter or ladder stage returns a body explicitly marked as Markdown
- **THEN** `:outline` parses that rendered body and its coordinates refer to the rendered Markdown
- **AND** the web source envelope and provenance remain present

#### Scenario: A non-Markdown web body is refused

- **WHEN** a web read returns raw HTML, JSON, or plain text and the model requests `:outline`
- **THEN** the tool returns `invalid_selector` naming the supported Markdown types
- **AND** the ordinary web read remains available under its existing content-type and rendering contract

#### Scenario: A directory is not an outline document

- **WHEN** the model requests `:outline` on a host, `file://`, `kb://`, or `skill://` directory
- **THEN** the tool returns `invalid_selector`
- **AND** it does not reinterpret the listing as headings or return a partial listing

### Requirement: Representation output preserves source attribution and authority

An outline SHALL run only after the same source admission, permission decision,
owner resolution, and content acquisition that an ordinary `read` would use. It
SHALL preserve the ordinary source identity and result envelope: host results
retain host path behavior, `file://` results retain normalized host identity,
`kb://` results retain their locator, Space identity, and closed
untrusted-content notice, `skill://` results retain their published skill
paths, and web results retain `path`, `finalUrl`, retrieval method, and notes.
Heading text, authored metadata values, and generated notes SHALL remain
untrusted content and SHALL NOT become instructions or authority. An outline
coordinate SHALL grant no access not already granted to the original locator.

#### Scenario: Host and Knowledge outlines are structurally equivalent

- **WHEN** equivalent Markdown is read through an authorized absolute host path and an authorized `kb://` locator
- **THEN** both outlines contain the same heading depths, text, ordering, and source ranges
- **AND** the host result has host identity while the Knowledge result has its Space attribution and untrusted-content notice

#### Scenario: Knowledge outline remains untrusted

- **WHEN** a Knowledge Markdown heading contains an instruction-like string
- **THEN** the outline returns that heading as untrusted content with the Knowledge notice
- **AND** the heading cannot change tool availability, owner identity, or read authority

#### Scenario: Skill outline retains path disclosure rules

- **WHEN** the model requests `:outline` for an eligible `skill://` Markdown resource
- **THEN** the outline result retains the skill locator, resolved path, skill directory, and existing skill instruction envelope
- **AND** the outline does not grant mutation or script execution

#### Scenario: Web outline retains provenance

- **WHEN** an admitted web adapter produces Markdown and the model requests `:outline`
- **THEN** the result retains the source `path`, `finalUrl`, method, and any notes
- **AND** the outline does not expose an adapter credential or turn the rendered content into authority

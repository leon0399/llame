## ADDED Requirements

### Requirement: Image reads return an image result

A native `read` SHALL return an image result when the bytes it acquires are a PNG, JPEG, GIF, or
WebP image: a host path, `file:` alias, or Workspace-relative path, `kb://`, `skill://`, a web image
body, or `media://`. The result SHALL carry `status: "ok"`, `kind: "image"`, `media` (the object's
`media://` locator), the stored original's `mediaType`, `width`, and `height`, and the source's
existing attribution fields, and no `content` or image bytes. It SHALL NOT depend on the Run's model.

#### Scenario: A host PNG returns an image result

- **WHEN** the model reads `/work/shot.png`, a regular file whose bytes are a 1600 by 900 PNG image
- **THEN** the result has `status: "ok"`, `kind: "image"`, a `media` locator `media://<id>`, `mediaType` `image/png`, `width` 1600, `height` 900, and `path` `/work/shot.png`
- **AND** it carries no `content` and no encoding of the image bytes

#### Scenario: A skill image keeps the skill envelope

- **WHEN** the model reads `skill://pdf/assets/sample.png`, whose bytes are a PNG image
- **THEN** the result is the image result with the logical locator, selected source, `resolvedPath`, and `skillDirectory`
- **AND** it carries no `content`

#### Scenario: A model without image input still receives the envelope

- **WHEN** a Run whose model declares no image input reads `/work/shot.png`, whose bytes are a PNG image
- **THEN** the tool result is the same image result, with the same `media` locator, that a Run on a model declaring image input receives
- **AND** the media object is created all the same

### Requirement: Image detection reads leading bytes before text decoding

For a regular file on a host path, `file:` alias, Workspace-relative path, `kb://`, or `skill://`,
after the same admission, permission decision, owner resolution, and regular-file check as a text
read, the reader SHALL compare the file's leading bytes with the PNG, JPEG, GIF, and WebP signatures
before any UTF-8 decoding or line counting. The file extension SHALL NOT decide. Bytes that match no
signature, SVG included, SHALL stay on the text path unchanged and SHALL create no media object.

#### Scenario: The extension does not decide

- **WHEN** the model reads `/work/notes.png`, whose bytes are an HTML document, and `/work/diagram.dat`, whose bytes are a JPEG image
- **THEN** `/work/notes.png` returns its text with line numbers and creates no media object
- **AND** `/work/diagram.dat` returns the image result with `mediaType` `image/jpeg`

#### Scenario: An SVG file stays text

- **WHEN** the model reads `/work/logo.svg`
- **THEN** the result is the file's text with line numbers, as an ordinary text read returns it
- **AND** no media object is created

#### Scenario: A denied read ingests nothing

- **WHEN** permission admission denies a `read` of `/work/shot.png`, whose bytes are a PNG image
- **THEN** the tool returns `permission_denied` without opening the file
- **AND** no media object is created

### Requirement: Image reads ingest into the owner's media store

A detected image SHALL be ingested into the Run owner's media store under tenant enforcement, with
provenance `read`, the submitted locator as source label, and the store's bounds. Bytes that owner
already stored SHALL resolve to the existing object. A regular file over the byte bound SHALL be
refused without being read whole. An ingest refusal SHALL fail the read with a bounded structured
error, `image_too_large` for the byte or pixel bound, create no object, and not fall back to text.

#### Scenario: The stored object records its read provenance

- **WHEN** the model reads `/work/shot.png`, whose bytes are a PNG image
- **THEN** the Run owner holds a media object named by the result's `media` locator
- **AND** that object has provenance `read` and source label `/work/shot.png`

#### Scenario: Re-reading an image reuses its object

- **WHEN** the model reads `/work/shot.png` twice without the file changing
- **THEN** both results carry the same `media` locator
- **AND** the Run owner holds one media object for those bytes

#### Scenario: Identical bytes stay separate across owners

- **WHEN** owner A's Run reads a PNG and owner B's Run later reads a file with identical bytes
- **THEN** owner B's result carries a `media` locator different from owner A's
- **AND** owner B's `read` of owner A's `media://` locator returns `not_found`

#### Scenario: An oversized image is refused

- **WHEN** the model reads a 21 MiB PNG file, or a PNG file under 20 MiB whose header declares 41 megapixels
- **THEN** the read fails with `image_too_large`
- **AND** no media object is created and no text content is returned

### Requirement: Media locators read the owner's stored media

`read` SHALL accept `media://<id>`, where `<id>` is a lower-case canonical UUID under the
`media-store` locator grammar, and SHALL return the image result for the Run owner's object with
that id, with `media` and `path` both equal to the locator. The id SHALL resolve under tenant
enforcement against the Run owner only. Another owner's id and an unknown id SHALL return the same
`not_found`. A bare `media://` or a malformed id SHALL fail with `invalid_path` before any lookup.

#### Scenario: The owner's stored image is returned

- **WHEN** the model reads `media://<id>` naming an image the Run owner stored
- **THEN** the result is the image result with `media` and `path` equal to `media://<id>` and the stored original's `mediaType`, `width`, and `height`
- **AND** no media object is created or changed

#### Scenario: Another owner's id is indistinguishable from an unknown id

- **WHEN** the model reads `media://<id>` naming an object another owner stored, and separately a well-formed id with no stored object
- **THEN** both reads return the same `not_found` result
- **AND** neither result carries any field of the other owner's object

#### Scenario: Bare and malformed media locators are invalid

- **WHEN** the model reads `media://`, `media://123`, or `media://` followed by an upper-case UUID
- **THEN** the tool returns `invalid_path`
- **AND** no media lookup is performed

### Requirement: Media locators route before local path resolution

`media://` SHALL be a scheme the shared locator parser recognizes, routed before local path
resolution like `kb://`, `skill://`, and web locators, so it is never projected from an entered
Workspace root, and `read` SHALL accept it on a process without a native executor.

#### Scenario: A media locator is read without host authority

- **WHEN** a process with no `tools.nativeExecutorId` allowlists `read`, and the model calls `read` with `media://<id>` naming an image the Run owner stored
- **THEN** the read returns that image result without returning `executor_unavailable`
- **AND** it binds no native executor identity and is not projected from an entered Workspace root

### Requirement: Media locators are read-only and take no selector

A `media://` read SHALL ingest nothing, SHALL NOT change the stored object, SHALL neither require
nor bind a native executor identity, and SHALL trigger no instruction-file chain. Any selector on a
`media://` locator SHALL fail with `invalid_selector` before any lookup. `edit` and `write` SHALL
reject a `media://` locator with the unsupported-operation error, without a lookup or any effect.

#### Scenario: A media read takes no selector

- **WHEN** the model reads `media://<id>:raw`, `media://<id>:1-5`, or `media://<id>:outline`
- **THEN** the tool returns `invalid_selector`
- **AND** no media lookup is performed

#### Scenario: Media locators are read-only

- **WHEN** `edit` or `write` targets `media://<id>`
- **THEN** the tool returns the unsupported-operation error
- **AND** the stored object is unchanged and no file is created

#### Scenario: A media read loads no instruction files

- **WHEN** the model reads `media://<id>` while a Workspace is entered
- **THEN** the result is the image result
- **AND** no instruction-file chain is triggered by the read

## MODIFIED Requirements

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
`1..count` and `-0` SHALL fail with `invalid_selector`. An `N-` whose `N`
lies past the last line resolves to an empty member. On a nonempty regular file
or web render, that member fails with `invalid_selector` when it is the first
requested start of the sorted members; when it is later, it is dropped before
merging and context expansion, so it emits nothing, adds no context line, and
appears in neither `requestedRanges` nor `shownRanges`. A comma list whose
members all resolve empty fails as a start past the last line on a nonempty
regular file or web render. On an empty regular file or web render, `-K` and
`1-` return the shipped empty result (the start-past-EOF rule does not apply to
a source with no last line at offset 0); any other `N-` fails as a start past
the last line when it is the first requested start of the sorted members, so a
comma list that starts at line 1, such as `:1-,2-`, returns empty plural ranges
as the multi-range rule states. On a listing or the catalog, an `N-` past the end returns the
empty page those sources return today; an empty listing or catalog keeps its
empty page for every member.

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

A read whose source is an image under the image read requirement, or whose
locator is `media://`, SHALL take no selector: any selector, every range member,
`:raw`, and `:outline` included, SHALL fail with `invalid_selector`, whose
message states that an image is read without a selector, and SHALL create no
media object. An image has no line count. On a host, `file://`, `kb://`, or
`skill://` regular file, the image check on the leading bytes SHALL run before
the line count an `N-` or `-K` member requires, so an image is never counted. An
image result SHALL carry no requested or shown range, `nextOffset`, or
`truncated` field.

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

#### Scenario: A selector on an image is refused

- **WHEN** the model reads `/work/shot.png:1-10`, `/work/shot.png:raw`, or `kb://<id>/diagrams/flow.png:raw`, and each file's leading bytes are a PNG image
- **THEN** the tool returns `invalid_selector` stating that an image is read without a selector
- **AND** no media object is created and no line content is returned

#### Scenario: A tail member on an image is refused before counting

- **WHEN** the model reads `:-20` of a host regular file whose leading bytes are a JPEG image
- **THEN** the tool returns `invalid_selector`
- **AND** the file's lines are not counted

#### Scenario: An image result has no line metadata

- **WHEN** the model reads `/work/shot.png` without a selector and its leading bytes are a PNG image
- **THEN** the image result carries no requested or shown range, `nextOffset`, or `truncated` field

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
than widening this one. Image detection is such a byte-level reader and sits
outside the table: under the image read requirement it inspects a regular
file's leading bytes, or a web body declared as an accepted image type, before
any text decoding. The table SHALL gain no image member and no image media type,
an image source SHALL have no representation, and an image result SHALL carry no
`representation` field.

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

- **WHEN** permission admission denies the submitted `:outline` locator, including a host rule that matches the selector-free submitted text
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

#### Scenario: An image is detected outside the representation table

- **WHEN** the model reads `/work/shot.png` without a member and its leading bytes are a PNG image
- **THEN** the result is the image result and carries no `representation` field
- **AND** `/work/shot.png:outline` returns `invalid_selector` rather than an outline or an image result

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
representation requirements identify as Markdown, and that a read whose leading
bytes are an image is bounded by the image ingest bounds under the image read
requirement; text and raw reads, edits, and writes are unaffected.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`; content SHALL be returned
verbatim so that `edit` `oldText` can be copied from it once the generated
line-number prefixes are removed, or read with `:raw` to omit them. An
`outline` read returns a selection of verbatim source lines under that same
rule while retaining the same locator, Space attribution, and notice. A `kb://`
read whose file is an image SHALL return the image result with the same
locator, Space attribution, and notice, and SHALL carry no line content.

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

#### Scenario: A Knowledge image keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/diagrams/flow.png` and the file's leading bytes are a PNG image
- **THEN** the result is the image result with `media`, `mediaType`, `width`, and `height`, plus the locator, Space identifier, display name, and untrusted-content notice
- **AND** it carries no `content` and exposes no configured root or resolved child path

#### Scenario: Another owner's Knowledge image is not ingested

- **WHEN** the model reads `kb://<id>/diagrams/flow.png` and the identifier belongs to another owner's Space that holds a PNG at that path
- **THEN** the tool returns `knowledge_space_not_found`, identical to the result for an absent identifier
- **AND** no file is opened and no media object is created for either owner

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, `raw`, `adapter`,
or `image`, and SHALL name the ladder stage or adapter that produced the returned content.
For `method: "image"`, the result SHALL instead be the image result under the
image read requirement — `status`, `kind: "image"`, `media`, `mediaType`,
`width`, and `height` — together with `path`, `finalUrl`, `method`, and `notes`
only when non-empty, and SHALL carry no `content`, range fields, `nextOffset`,
or `truncated`.
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

- **WHEN** a web read of a text body succeeds
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

#### Scenario: An image result carries the web fields and no content

- **WHEN** `https://example.test/shot` redirects to `https://cdn.example.test/shot.png`, which serves `image/png` with PNG bytes
- **THEN** the result has `kind: "image"`, a `media` locator, `mediaType`, `width`, `height`, `path` `https://example.test/shot`, `finalUrl` `https://cdn.example.test/shot.png`, and `method: "image"`
- **AND** it carries no `content`, range fields, `nextOffset`, `truncated`, `url`, or `contentType`

### Requirement: Web reads accept text and image bodies

A web read SHALL accept only text bodies and image bodies. Text bodies are
`text/*` media types, `application/json`, `application/xml`, and any type whose
subtype carries a `+json` or `+xml` suffix, so `image/svg+xml` is a text body.
`text/markdown` SHALL be handled as Markdown. An image body is a page response,
after any redirects, whose declared media type is `image/png`, `image/jpeg`,
`image/gif`, or `image/webp` and whose leading bytes match the PNG, JPEG, GIF,
or WebP signature; the format the bytes match, not the declared type, SHALL
decide the result's `mediaType`. An image body SHALL remain under the existing
5 MiB body bound, SHALL end the ladder with `method` `image`, and SHALL be
returned as the image result under the image read requirement, never as
content. A body declared as one of those image types whose leading bytes match
none of the four signatures SHALL fail with `unsupported_media_type`, SHALL
create no media object, and its body SHALL NOT be returned as content. Any
selector on an image body, `:raw` included, SHALL fail with `invalid_selector`
and SHALL create no media object. Every other content type, `application/pdf`
and `application/octet-stream` included, SHALL fail with
`unsupported_content_type` naming the received type, and its body SHALL NOT be
returned as content. An adapter response, or an alternate, suffix, or
`llms.txt` probe response, with an image type SHALL count as a refused content
type. An adapter
response with a refused content type SHALL disqualify that adapter with a
bounded `content_type` note and SHALL not fail the source call. Only a
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

- **WHEN** a locator serves `application/pdf` or `application/octet-stream`
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

#### Scenario: An image body is returned as an image

- **WHEN** a locator serves `image/png` and the body's leading bytes are a PNG image of 1600 by 900 pixels
- **THEN** the read returns the image result with `method` `image`, a `media` locator, `mediaType` `image/png`, `width` 1600, and `height` 900
- **AND** the result carries no `content` and the body is stored as a media object of the Run owner

#### Scenario: The bytes decide the image format

- **WHEN** a locator serves `image/png` and the body's leading bytes are a JPEG image
- **THEN** the read returns the image result with `mediaType` `image/jpeg`

#### Scenario: A declared image type over other bytes is refused

- **WHEN** a locator serves `image/png` and the body is an HTML document
- **THEN** the read fails with `unsupported_media_type`
- **AND** no media object is created and no part of the body is returned as content

#### Scenario: A selector on a web image is refused

- **WHEN** the model reads `https://example.test/shot.png:raw` or `https://example.test/shot.png:1-5` and the locator serves `image/png` with PNG bytes
- **THEN** the read fails with `invalid_selector`
- **AND** no media object is created and the raw bytes are not returned

#### Scenario: An SVG body stays text

- **WHEN** a locator serves `image/svg+xml`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** no media object is created

#### Scenario: An oversized image body fails the existing body bound

- **WHEN** a locator serves `image/png` with a body larger than 5 MiB
- **THEN** the read fails with `body_too_large`
- **AND** no media object is created

## RENAMED Requirements

- FROM: `### Requirement: Web reads accept text bodies only`
- TO: `### Requirement: Web reads accept text and image bodies`

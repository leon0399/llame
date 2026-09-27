## MODIFIED Requirements

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive numeric selectors `:N-M`,
`:N+K`, and comma-separated numeric selectors under the multi-range
requirement below. It SHALL accept the two representation members `:raw` and
`:outline`, each optionally followed by `:<ranges>`; `raw` retains its
existing verbatim meaning, while `outline` is available only for supported
Markdown content. A valid selector SHALL be normalized once to internal
zero-based ranges. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence
over selector parsing; after that literal probe, an `:outline` form with an
optional range list SHALL be recognized before the last-colon numeric fallback.
A `kb://` path component SHALL NOT contain `:`, so the split is unambiguous
without probing; its selector SHALL be validated as one of the two
representation members or a numeric form. A `skill://` selector SHALL follow
the same validation rule. A `path` that begins with a `scheme://` prefix the
SHALL NOT be treated as a relative or literal filename. Web locators SHALL
recognize the `:outline` form before the last-colon fallback while preserving
the existing path, query, fragment, and port rules. For regular-file reads,
ordinary single bounded numeric ranges SHALL include one preceding and one
following source line when available, and the extended lines SHALL appear in
the same `content` block as the requested lines. For single-range reads, result
details SHALL identify requested and shown ranges, representation, path, and
common truncation state. For an `outline` result, generated lines SHALL be
returned without generated line-number prefixes or context expansion, and
requested and shown ranges SHALL refer exactly to outline output lines. Each
outline entry carries its own one-based source `N-M` range. Requested bounds
SHALL remain the normalized request even when the displayed source ends
earlier; shown bounds SHALL describe only emitted source lines. Empty files
SHALL return null ranges. `nextOffset` SHALL identify the next requested source
line for an ordinary read, and the zero-based next outline output line for an
outline read. Raw reads SHALL return verbatim selected source content without
generated line prefixes, context expansion, or processors. `:outline:raw` and
`:raw:outline` are not representation members and SHALL follow each source's
shipped precedence: host and web preserve their raw interpretation of
`:outline:raw` as a path or URL ending in `:outline`, while `kb://` and
`skill://` return `invalid_path` for either invalid suffix. Directory reads
SHALL apply single-range selectors to listing entries under the directory
listing requirements and SHALL NOT add context lines. An outline request on a
directory SHALL fail under the outline refusal requirement rather than
reinterpret listing text as Markdown.

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
truncation, mutation, and `file_exists` behavior as absolute paths. No
Markdown-only or per-file byte policy SHALL apply to `kb://` operations, except
that the explicit `outline` representation is limited to Markdown files and to
the outline input ceiling; text and raw reads, edits, and writes are
unaffected.

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
resource and SHALL keep being admitted in its own right, and every address a
request would connect to SHALL additionally be judged under the
address-admission requirement below. Availability and
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
rest, except that `:raw` and `:outline` representation forms are recognized
before that last-colon fallback. A selector SHALL be split only from a locator
that has a path and carries no `?` and no `#`, so a colon inside a query is
part of the URL (`https://example.test/search?at=2026:10`) and the only colon
of a pathless locator opens its port: `https://example.test:88` is port 88,
`https://example.test/:88` is line 88 of the site root, and
`https://example.test:88/:88` is line 88 served from port 88. A literal colon
in the last path segment of a query-free locator SHALL be written as `%3A`
(`https://w.example/wiki/Special%3ASearch`), because a trailing colon is
always read as a selector split and the shipped grammar admits `raw`,
`raw:N`, `raw:N-M`, `N`, `N-M`, `N+K`, and comma lists of those, plus
`outline`, `outline:N`, `outline:N-M`, `outline:N+K`, and `outline` followed
by comma-separated numeric ranges. `Search` is outside it, so
`https://w.example/wiki/Special:Search` fails as `invalid_selector`, while
`https://w.example/docs/2024:10` selects line 10 and
`https://w.example/docs/2024:10-20` lines 10 through 20 of
`https://w.example/docs/2024`. A suffix `:outline:<ranges>` is split as the
outline representation before the last-colon fallback, so
`https://h.example/p:outline:5` requests `https://h.example/p` and selects
outline output line 5. A literal last-segment colon in a path intended to end
in `outline` SHALL be percent-encoded.
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

#### Scenario: Outline representation splits before the last-colon fallback

- **WHEN** the model reads `https://h.example/p:outline:5`
- **THEN** the request targets `https://h.example/p` and selects outline output line 5
- **AND** the `:outline` text is not sent as part of the URL path

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

## ADDED Requirements

### Requirement: Read representations use the admitted content type

The representation slot SHALL name one member of a closed, code-owned set:
`raw` (the existing verbatim member) and `outline`. Each member SHALL declare
the content types it accepts. With no member named, reading SHALL remain
unchanged. A member requested for a content type it does not accept SHALL fail
with `invalid_selector` naming that member's accepted types. A representation
reader SHALL receive only the admitted decoded content and source display
identity and SHALL NOT change source admission, permission projection, owner
resolution, executor binding, request policy, bounds, or source-specific result
envelope. Future byte-level readers for #916 or #935 SHALL define their own
input contract rather than widening this decoded-text seam.

#### Scenario: A Markdown file selects the outline reader

- **WHEN** the model calls `read` with an authorized Markdown file and the `:outline` representation
- **THEN** the result has `representation: "outline"` and contains the deterministic outline
- **AND** the source is admitted exactly as it is for an ordinary read

#### Scenario: An omitted representation keeps the existing read

- **WHEN** the model reads an authorized Markdown file without a representation name
- **THEN** the result uses the existing text representation and line-numbered source content
- **AND** no outline is appended or inferred

#### Scenario: An unsupported representation names its accepted types

- **WHEN** the model requests `:outline` for an otherwise readable JSON, PDF, or binary source
- **THEN** the tool returns `invalid_selector` naming the `outline` member's accepted Markdown content types
- **AND** an ordinary read of that source remains governed by its existing default reader

#### Scenario: Admission denies the submitted representation locator

- **WHEN** permission admission denies the submitted `:outline` locator, including a host rule that matches the suffix-bearing submitted text
- **THEN** the tool returns the same `permission_denied` result as the ordinary read
- **AND** no content-type detection or Markdown parsing is attempted

#### Scenario: Mixed representation text follows source precedence

- **WHEN** the model submits `:outline:raw` or `:raw:outline`
- **THEN** host and web parsing applies their shipped raw-first precedence, while Knowledge and Skill return `invalid_path`
- **AND** no new combined representation is selected

### Requirement: Markdown outlines have bounded navigable output

For a supported Markdown source, `:outline` SHALL return one generated output
line per recognized document-level heading in source order, exactly in the
format `<"#" repeated depth> <text> [<N>-<M>]`, with no generated line-number
prefix and no context expansion. Heading text SHALL concatenate inline text:
code spans contribute their text, links contribute link text, images contribute
alt text, and inline HTML is dropped. Whitespace and line breaks SHALL collapse
to one space and the result SHALL be trimmed. The `N-M` token SHALL be directly
usable as the ordinary selector suffix on the original locator. Authored
frontmatter metadata and generated notes SHALL precede heading lines, start
with `[`, and SHALL be marked as non-derived lines. The output SHALL contain no
model-generated summary, body excerpt, or heading-name selector. A Markdown
source with no recognized headings SHALL return its authored metadata, if any,
followed by the fixed minimal line `[outline] No headings found.`

#### Scenario: Outline entries carry source ranges

- **WHEN** an authorized Markdown file contains `# Guide` on line 3 and its section ends on line 12
- **THEN** outline content contains `# Guide [3-12]` without a generated line prefix or context line
- **AND** reading the original locator with `:3-12` addresses that section

#### Scenario: Heading depth is represented by repeated hash marks

- **WHEN** a Markdown file contains a level-one heading followed by a level-three heading
- **THEN** the outline contains `# One [1-M]` and `### Three [N-M]` forms with no leading indentation
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
at the root document level, outside fenced code blocks, indented code blocks,
frontmatter, and HTML blocks. Headings nested in list items or blockquotes
SHALL NOT produce entries. An ATX heading starts at its ATX line. A setext
heading starts at its text line and includes its underline line. A heading's
section SHALL begin at that heading block and end at the line immediately
before the next root heading whose depth is less than or equal to this
heading's depth (the same or a shallower level), or at the source's last line.
A deeper heading SHALL remain inside the nearest preceding shallower section.
Heading text SHALL be source-derived and untrusted; duplicate heading text
SHALL remain separate, and no selector SHALL address a heading by name.

#### Scenario: ATX and setext headings produce sections

- **WHEN** a 12-line Markdown file contains `# One` at line 1 and setext `Two` at lines 8 and 9
- **THEN** the outline reports `# One [1-12]` and `## Two [8-12]`
- **AND** the setext range starts at its text line and includes its underline

#### Scenario: Nested sections end at the same or a shallower level

- **WHEN** a level-two heading is followed by a level-three heading and then another level-two heading
- **THEN** the level-three range ends at the line before the second level-two heading
- **AND** the first level-two range includes the nested level-three section through that preceding line

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

#### Scenario: Container headings are excluded

Only a YAML block that starts at line 1 with `---` and closes with `---` or
`...` SHALL be considered frontmatter. Every such closed block SHALL be
excluded from heading parsing, even when its YAML is malformed or is not a
mapping. String scalar keys named exactly `title` and `description` SHALL be
emitted before headings as `[authored title] <value>` and
`[authored description] <value>` lines. Authored values SHALL collapse all
whitespace and line breaks to single spaces, trim the result, and cap it at 200
characters with a trailing `…` when truncated. Those lines SHALL be marked
authored, SHALL start with `[`, and SHALL not claim source section ranges. A
closed block whose YAML fails to parse or is not a mapping SHALL emit the fixed
note `[note] Authored frontmatter ignored: malformed YAML.`. An unclosed
line-one opener SHALL NOT be considered frontmatter, SHALL be parsed as
ordinary Markdown, and SHALL emit no malformed-frontmatter note. A later
horizontal rule SHALL remain ordinary Markdown.

#### Scenario: Authored title and description are marked

- **WHEN** line one begins a valid YAML frontmatter block containing string `title` and `description` keys
- **THEN** the outline starts with `[authored title]` and `[authored description]` lines before derived heading entries
- **AND** those lines are visibly distinct from heading structure and contain no source range

#### Scenario: Authored values remain one line

- **WHEN** a valid frontmatter title contains line breaks, repeated whitespace, and more than 200 characters
- **THEN** the outline emits exactly one `[authored title]` line with collapsed whitespace, a trimmed value, and a trailing `…` at the cap
- **AND** authored text cannot create a line beginning with `#`

#### Scenario: A closed frontmatter block is excluded even when malformed

- **WHEN** a closed line-one block contains malformed YAML or a scalar instead of a mapping and the body contains a valid heading
- **THEN** the outline emits the fixed malformed-frontmatter note and only the body heading as derived structure
- **AND** no YAML line or closing delimiter becomes a heading

#### Scenario: An unclosed opener is ordinary Markdown

- **WHEN** a line-one `---` opener has no closing `---` or `...` and the body contains a valid heading
- **THEN** the outline parses the document as ordinary Markdown without a frontmatter note
- **AND** the body heading retains its source coordinates

#### Scenario: A later horizontal rule is not frontmatter

- **WHEN** the first line is ordinary Markdown and a later line is `---`
- **THEN** the later rule is parsed under CommonMark and no authored metadata block is created
- **AND** any valid heading around it keeps its ordinary section boundaries

### Requirement: Outline parsing and output obey explicit bounds

For host, `file://`, `kb://`, and `skill://` sources, an outline reader SHALL
check the opened file's size before decoding and SHALL read at most 5 MiB plus
one byte. A source whose size or bounded read exceeds that ceiling SHALL fail
with `representation_too_large`, SHALL not return a partial outline, and SHALL
leave ordinary reads available. The loader SHALL preserve the source resolver's
authority, symlink policy, `not_regular_file`, and `invalid_utf8` behavior. Web
bodies are already bounded by the web read contract. Successful outline output
SHALL use the shared serialized result cap and 2,000-line ceiling after its
source ranges, authored lines, and notes are included. `truncated` and
zero-based `nextOffset` SHALL describe omitted outline output lines, and a
continuation SHALL re-run outline selection against the source observed by that
call. A successful outline SHALL not imply a source snapshot.

#### Scenario: Coordinates use the native LF line model

- **WHEN** a Markdown source contains CRLF, a lone CR, and a trailing LF
- **THEN** outline coordinates count LF delimiters exactly as ordinary native reads count them, keep lone CR inside a line, and add no line for the trailing LF
- **AND** every emitted `N-M` remains a valid ordinary selector range

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
included initially. For web sources, `outline` SHALL be available only for a
Markdown result: `negotiated` counts only when the response Content-Type is
`text/markdown`; `alternate`, `md-suffix`, `readability`, and `llms-txt` are
Markdown; `text`, `raw`, and `negotiated` `text/plain` are not. A future
adapter result may opt in by labeling its output Markdown. Raw HTML, plain
text, JSON, XML, and other non-Markdown text SHALL not be reinterpreted by
appearance. A directory target, skill catalog, unsupported content type,
invalid representation composition, or unsupported rendered web type SHALL
return `invalid_selector` naming the requested member's accepted types. A
plain read, including the existing directory or catalog listing, SHALL retain
its result or error contract.

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
- **THEN** the tool returns `invalid_selector` naming the `outline` member's accepted Markdown content types
- **AND** the ordinary web read remains available under its existing content-type and rendering contract

#### Scenario: A directory is not an outline document

- **WHEN** the model requests `:outline` on a host, `file://`, `kb://`, or `skill://` directory
- **THEN** the tool returns `invalid_selector`
- **AND** it does not reinterpret the listing as headings or return a partial listing

#### Scenario: A skill catalog is not an outline document

- **WHEN** the model requests `skill://:outline`
- **THEN** the catalog returns `invalid_selector`
- **AND** it does not return the first catalog page as outline content

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

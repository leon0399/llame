## MODIFIED Requirements

### Requirement: Read selectors and context are deterministic

`read` MUST accept one-based inclusive line members at the end of its locator. The five member
forms are `N`, `N-M`, `N+K`, `N-`, and `-K`. Each form can also carry the unit letter `L`, as the
unit-letter requirement states. A member MUST be accepted in each position that takes one. These
positions are a single member such as `:N-M` and a comma list under the multi-range requirement
below. They are also a `raw:` list and the one optional range after `outline` below. A `raw:` list MUST accept every member that a bare list
accepts, `N+K` included. `N-` is line `N` through the last line of the source. `-K` is the last `K`
lines of the source.

A `:<list>:raw` selector and the same list after `raw:` MUST be one read on every source. The shape
gate of each source MUST admit both spellings, and the canonical spelling is the `raw:` one. A host
or web split can find a final `:raw`. It MUST then take the colon segment before it as the list
only when that segment has the member-list shape. Any other segment MUST stay on the path. Thus
`notes:draft:raw` is the raw read of `notes:draft`, and `2024:10:raw` is line 10 of `2024`, read
raw. A literal file named `2024:10` is read raw only as `2024:10:raw:L1-N`.

`read` MUST also accept the `outline` representation member with at most one optional source
range: `:outline`, `:outline:N`, `:outline:N-M`, `:outline:N+K`, `:outline:N-`, or `:outline:-K`.
The representation requirements below govern it. A comma list after `outline` is outside the
grammar and MUST fail with `invalid_selector`. The tool MUST normalize a valid selector once to
internal zero-based ranges.

A final suffix can split off a locator that itself parses, and lie outside the grammar. That suffix
MUST fail with `invalid_selector`, with the shared refusal message. A path on a Machine and an
`ssh://` path are the exception. There, a suffix that is not a selector shape MUST stay on the
path. A selector shape is a suffix that the grammar admits, or a reserved-unit or misplaced-letter
member. On a source with an encoded spelling for a literal colon, the `%3A` spelling of
the same locator MUST follow the shared refusal message. These sources are a `kb://` or `skill://` resource path,
and web. A malformed locator part MUST stay `invalid_path`.

The tool MUST recognize a `scheme://` prefix before it splits a selector from the end. Thus it never
reads the colon of a scheme as a selector. For absolute paths, an existing literal path MUST take
precedence over the selector split. After that literal probe, the split MUST recognize the `:raw`
form first and the `:outline` form second. Each of these forms MUST also claim a line-and-column
suffix after it, which then fails. The split MUST then recognize the line-and-column suffix, and
then use the last-colon fallback.

A `kb://` path component MUST NOT contain `:`, so its split needs no probe. A `kb://` or
`skill://` selector MUST be a line form, the line-and-column suffix, or a `raw` or `outline` member. A web
locator MUST recognize the `:outline` form before its last-colon fallback. It MUST keep its path,
query, fragment, and port rules. A `path` that starts with a `scheme://` prefix MUST NOT be treated
as a relative or literal filename.

For a regular-file read, an ordinary single bounded range MUST include one source line before it
and one after it, when they exist. These context lines MUST appear in the same `content` block as
the requested lines.

The tool MUST resolve members against the count of the source before any of the shipped rules
apply. Those rules then apply to the resolved absolute ranges. `N-` resolves to `N..count`, and `-K`
resolves to `max(1, count-K+1)..count`. The count is one of these:

- the line count of a regular file on host, `file://`, `kb://`, or `skill://`,
- the rendered line count of a web document,
- the entry count of the requested level of a directory listing,
- the entry count of the skill catalog.

The tool MUST count the lines of a regular file before the ordinary read when a selector carries
an `N-` or `-K` member. It MUST count only after it admits the source and finds a regular file.
`requestedRange` and `requestedRanges` MUST report the resolved absolute lines. These are the
coordinates that this read observed, not a snapshot of the source.

A `-K` whose `K` is more than the count MUST resolve to `1..count`. `-0` MUST fail with
`invalid_selector`. An `N-` whose `N` is after the last line resolves to an empty member. On a
nonempty regular file or web render, that member MUST fail with `invalid_selector` when it is the
first requested start of the sorted members. When it is a later member, the tool MUST drop it before
merge and context expansion. Then it emits nothing, adds no context line, and appears in neither
`requestedRanges` nor `shownRanges`. A comma list whose members all resolve empty MUST fail as a
start after the last line on a nonempty regular file or web render.

On an empty regular file or web render, `-K` and `1-` MUST return the shipped empty result. The
start-after-EOF rule does not apply to a source with no last line at offset 0. Any other `N-` MUST
fail as a start after the last line when it is the first requested start of the sorted members.
Thus a comma list that starts at line 1, such as `:1-,2-`, returns empty plural ranges, as the
multi-range rule states. On a listing or the catalog, an `N-` after the end MUST return the empty
page that those sources return today. An empty listing or catalog MUST keep its empty page for every
member.

An ordinary ranged read of a `text/markdown` source MUST also start its `content` with the direct
ancestor heading lines. These are the headings of the first requested line of the passage. The ranged Markdown ancestor
requirement specifies them. For a single-range read, the result details MUST identify the requested
and shown ranges, the representation, the path, and the common truncation state.

For an `outline` result, `content` MUST hold verbatim source lines with the ordinary line-number
prefixes and no context lines. The Markdown outline requirements select these lines, not
contiguity. Its requested bounds are the source scope of the outline. Its shown bounds are the first
and last source lines that it emits.

Requested bounds MUST stay the normalized request also when the shown source ends earlier. Shown
bounds MUST describe only emitted source lines. An empty file MUST return null ranges. `nextOffset`
MUST identify the next requested source line. For a truncated outline, `nextOffset` MUST identify
the source line of the first omitted entry. A raw read MUST return the verbatim selected source
content without generated line prefixes, context expansion, or processors.

`:outline:raw` and `:raw:outline` are not representation members. Host and web MUST keep their raw
interpretation of `:outline:raw` as a path or URL that ends in `:outline`. Their split recognizes the final
`:raw` first and leaves `:outline` on the path. `kb://` and `skill://` split once at the first
colon, so they MUST return `invalid_selector` for `:outline:raw`. Every source MUST return
`invalid_selector` for `:raw:outline`, because its remainder is outside the grammar.

A directory read MUST apply a single-range selector to the listing entries under the directory
listing requirements, and MUST NOT add context lines. An outline request on a directory MUST fail
under the representation requirements. It MUST NOT reinterpret the listing text.

A read whose source is an image under the image read requirement, or whose locator is `media://`,
MUST take no selector. Any selector MUST fail with `invalid_selector` and the message
`An image or PDF is read without a selector.`, and the tool MUST decode no image. This includes
every range member, `:raw`, and `:outline`. An image has no line count. On a host, `file://`,
`kb://`, or `skill://` regular file, the image check on the first bytes MUST run first. It MUST run
before the line count that an `N-` or `-K` member requires. Thus the tool never counts an image. An image result
MUST carry no requested or shown range, `nextOffset`, or `truncated` field.

#### Scenario: Bounded read includes live adjacent lines

- **WHEN** the model reads lines 11 through 13 of a file with lines on both sides
- **THEN** content contains lines 10 through 14 in source order
- **AND** details identify requested range 11..13 and shown range 10..14

#### Scenario: Boundary range omits unavailable context

- **WHEN** a read starts at line 1 or ends at the last line of the file
- **THEN** it omits the unavailable context line before or after the range
- **AND** it does not make a blank source line

#### Scenario: Raw read is verbatim

- **WHEN** the model calls `read` with the `:raw` selector
- **THEN** the result contains the selected source bytes without line prefixes or generated helpers
- **AND** the common output bounds still apply, the shared 2,000-line read ceiling included

#### Scenario: Truncated result reports the shown range

- **WHEN** the common result limit stops the complete requested range and its context from a fit
- **THEN** the tool returns the ordinary truncation metadata and the content prefix that fits
- **AND** it does not claim that it observed the omitted lines

#### Scenario: Unknown scheme fails closed

- **WHEN** the model calls `read`, `edit`, or `write` with a path such as `vault://notes/a.md`
- **THEN** the tool returns `invalid_path`
- **AND** no file named `vault:` or `vault://notes/a.md` is read, created, or changed

#### Scenario: Directory range has no context lines

- **WHEN** the model reads a directory path with a range selector
- **THEN** content contains only the header line and the selected listing entries
- **AND** no entry outside the selected range is emitted

#### Scenario: Outline selector is recognized before the numeric fallback

- **WHEN** no file named `/docs/guide.md:outline:10-40` exists and the model reads `/docs/guide.md:outline:10-40`
- **THEN** the read is the outline of `/docs/guide.md`, scoped to source lines 10 through 40
- **AND** `/docs/guide.md:outline:raw` stays the shipped raw read of a path that ends in `:outline`
- **AND** `/docs/guide.md:outline:1,3` fails with `invalid_selector`

#### Scenario: A tail member reads the last lines of a file

- **WHEN** the model reads `:-20` of a 500-line file
- **THEN** the result requests lines 481 through 500, under the ordinary context, truncation, and `nextOffset` rules
- **AND** the same read written `:raw:-20` returns those twenty lines verbatim

#### Scenario: An open-ended member runs to the last line

- **WHEN** the model reads `:50-` of a 3,000-line file of short lines
- **THEN** the requested range is 50 through 3,000, not an open window
- **AND** the shared 2,000-line ceiling cuts the result, with the ordinary `nextOffset`

#### Scenario: A tail member larger than the file clips to the first line

- **WHEN** the model reads `:-50` of a 10-line file
- **THEN** the result requests lines 1 through 10, because `-K` resolves to `1..count` and does not fail

#### Scenario: A zero tail is refused

- **WHEN** the model reads `:-0`
- **THEN** the tool returns `invalid_selector` and does not open the source

#### Scenario: Both raw orders are the same read

- **WHEN** the model reads `guide.md:raw:60-64` and `guide.md:60-64:raw` of the same file, or `kb://<id>/guide.md:60-64:raw` and `skill://<name>:60-64:raw`
- **THEN** each pair returns lines 60 through 64 verbatim with the same range metadata, because the shape gate of each source admits both spellings
- **AND** a file literally named `guide.md:60-64:raw` still wins the host literal-path probe
- **AND** `notes:draft:raw` stays the raw read of `notes:draft`, because `draft` has no member-list shape

#### Scenario: A malformed suffix names the working forms on every source

- **WHEN** the model reads `kb://<id>/notes/a:b.md`, whose split-off suffix `b.md` is outside the grammar
- **THEN** the tool returns `invalid_selector` with the one message that names the forms that work
- **AND** on a `kb://` or `skill://` resource path the `%3A` spelling follows, here `kb://<id>/notes/a%3Ab.md`
- **AND** a malformed locator part, such as a segment that does not decode, stays `invalid_path`

#### Scenario: A listing and the catalog read their tails

- **WHEN** the model reads `/var/log/:-20` and `skill://:-10`
- **THEN** the directory read returns the last twenty entries of its requested level, as its single range
- **AND** the catalog read returns the last ten entries of its count, as its single range
- **AND** neither read adds context lines

#### Scenario: A selector on an image is refused

- **WHEN** the model reads `/work/shot.png:1-10`, `/work/shot.png:raw`, or `kb://<id>/diagrams/flow.png:raw`, and the first bytes of each file are a PNG image
- **THEN** the tool returns `invalid_selector` with the message `An image or PDF is read without a selector.`
- **AND** no image is decoded and no line content is returned

#### Scenario: A tail member on an image is refused before counting

- **WHEN** the model reads `:-20` of a host regular file whose first bytes are a JPEG image
- **THEN** the tool returns `invalid_selector`
- **AND** the tool does not count the lines of the file

#### Scenario: An image result has no line metadata

- **WHEN** the model reads `/work/shot.png` without a selector and its first bytes are a PNG image
- **THEN** the image result carries no requested or shown range, `nextOffset`, or `truncated` field

### Requirement: Web locators are fetched by the native read tool

The native `read` tool MUST accept an absolute `http://` or `https://` locator as its `path`. The API process MUST fetch it through its own outbound HTTP, and the fetch MUST NOT need a Machine. The tool MUST admit no other web scheme. `edit` and `write` MUST reject a web locator with `invalid_path` before any request.

The tool MUST first cut a fragment and keep it only for the GitHub line-anchor rule. It MUST then split off a selector. It MUST then normalize the submitted web locator to its WHATWG URL serialization and request that text. The tool MUST normalize these forms and not refuse them, because none of them addresses a different resource:

- an uppercase scheme or host, and a percent-encoded or Unicode host,
- an explicit default port, a root dot on a host, and an empty path,
- unencoded path or query characters, and percent escapes in the path or query.

A refusal of them costs a call and teaches the model nothing for the next locator.

The tool MUST normalize path and query escapes in one pass that gives a fixed point:

- It MUST encode a `%` that does not start a valid escape as `%25`.
- It MUST decode an escape of an unreserved character (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`).
- It MUST keep every other escape encoded with uppercase hexadecimal digits, `%2F` included.

A second normalization of the normalized text thus changes nothing, and llame forms no new escape. The tool MUST cut a fragment before any other step reads the locator, because the request drops it in any case. Only the GitHub line-anchor rule reads the cut fragment.

No normalization can repair these forms, so they MUST still fail before any request. They are a text that is not a URL, a scheme other than `http` and `https`, and userinfo. Userinfo MUST fail with `invalid_path`. Thus the tool never sends credentials that the model put in a URL, and the message MUST NOT repeat them. A suffix outside the selector grammar MUST fail with `invalid_selector` and name the forms that work. The locator before that suffix is a URL that this tool can request.

After the tool admits and canonicalizes the submitted locator, the read MUST consider the ordered, code-owned web adapters before the generic HTML and text ladder. The tool MUST select a matching adapter without network I/O. `:raw` MUST bypass every adapter and keep the raw-response behavior below. `:outline` MUST NOT bypass an adapter, because it describes the document that a plain read of the same locator returns.

The rendered document of the adapter that claims the locator is thus the input of the outline. An adapter MUST NOT add a tool id, a second permission group, or a different source authority. An adapter target is another derived locator, and the tool MUST admit it separately.

The requested text is not always the submitted text, so the permission decision MUST examine both. A reject clause that matches the submitted locator without its read selector, or its normalized form, MUST refuse the call. No spelling can thus miss a reject. The tool MUST decide the allow on the normalized form.

An allow names the resource that the call reaches, and the two texts are one resource. A redirect hop is a different resource, and the tool MUST admit it separately. The tool MUST also judge every address that a request connects to under the address-admission requirement below.

Only the `path` clauses of the `read` permission group MUST control the availability and restriction of web locators through `read`. A prefix allow admits the web, and a prefix or domain reject removes a host. This rule governs an attempt in `default` mode. Under `bypass`, the web is reachable without a `path` allow, as the Purpose of this capability states.

The system MUST NOT add a web tool id, a `tools.allowed` entry, a configuration block, or an advertisement condition for a web locator. `web_search`, which `web-search` specifies, is a separate tool with its own allowlist entry, configuration, and permission group. The `path` clauses of the `read` group do not restrict it. A process that does not advertise `read` MUST NOT reach a URL through it.

Each call MUST fetch again. The tool MUST NOT cache a response or a render, and a later selector read of the same locator MUST send a new request. The tool MUST NOT consult `robots.txt` or any publisher signal such as `content-signal`. The tool MUST NOT present a fetch as permission from the publisher.

The scheme split and the trailing selector rules that protect a `scheme://` prefix MUST apply unchanged. The tool never reads the colon of the scheme as a selector. The shipped trailing-selector split, the last colon after the last slash, governs the rest. The tool MUST recognize the `:raw` and `:outline` representation forms, and then the line-and-column form, before that last-colon fallback.

The tool MUST split a selector only from a locator that has a path and contains no `?` and no `#`. A colon in a query is thus part of the URL: `https://example.test/search?at=2026:10` is fetched as written. The only colon of a locator without a path opens its port. `https://example.test:88` is port 88, `https://example.test/:88` is line 88 of the site root, and `https://example.test:88/:88` is line 88 from port 88.

The model MUST write a literal colon in the last path segment of a locator without a query as `%3A`, as in `https://w.example/wiki/Special%3ASearch`. The tool always reads a trailing colon as a selector split. The grammar admits `raw`, `raw:<list>`, `outline`, and `outline:` with one line member. It admits the line members `N`, `N-M`, `N+K`, `N-`, and `-K`, with or without the unit letter `L`, and comma lists of them. It also admits the line-and-column form `N:M`. `:<list>:raw` is the same read as `:raw:<list>`. `Search` is outside the grammar, so `https://w.example/wiki/Special:Search` fails as `invalid_selector`.

`https://w.example/docs/2024:10` selects line 10 of `https://w.example/docs/2024`, and `https://w.example/docs/2024:10-20` selects lines 10 through 20. The tool MUST split a suffix `:outline` or `:outline:<range>` as the outline representation before the last-colon fallback. `https://h.example/p:outline:5-40` thus requests `https://h.example/p` and limits the outline to rendered lines 5 through 40. The model MUST percent-encode a literal colon in the last segment of a path that ends in `outline`.

Each other refusal MUST name the spelling that works, not the rule that the locator broke:

- A selector written directly after the authority, such as `https://example.test:1-5`, is not a URL, because `1-5` is not a port. The answer MUST be the serialization of the authority with that selector in its canonical spelling: `https://example.test/:L1-5`.
- For a port that is not a number, such as `https://example.test:abc/`, the answer MUST name that rule and the same locator without a port. The locator is absolute, and only its port is broken.
- A suffix can mean a line that the grammar cannot serve, such as `:12+`, or be outside the grammar, such as `Search`. The answer MUST then name the line forms first, as the selector refusal requirement gives them. It MUST name the encoding of the literal colon second.
- A selector can be past the end of the render or contain no line. The answer MUST then give the number of lines that the page rendered. The model cannot know that number before it reads the page.

#### Scenario: A web locator is fetched by the API process

- **WHEN** the model calls `read` with `https://example.test/guide`
- **THEN** the API process issues the request and returns the page content
- **AND** no Machine is needed, used, or reported

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
- **AND** a reject clause written against the canonical spelling still refuses every one of those variants
- **AND** the decision examines the submitted text and the normalized text
- **AND** a reject clause written against the submitted spelling, such as one that names `%72`, also refuses

#### Scenario: An encoded unreserved character cannot slip past a path reject

- **WHEN** the `read` group rejects `path` matching `^https://example\.test/private` and the model reads `https://example.test/%70rivate`
- **THEN** the call is rejected before any request, because the normalized text is `https://example.test/private`
- **AND** `https://example.test/%%370rivate` is requested as `https://example.test/%2570rivate`, whose path, decoded once, is the literal `/%70rivate` that it named
- **AND** llame's normalization thus forms no new escape
- **AND** a server that decodes a path twice can still read it as `/private`, which a path-scoped rule cannot bound
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
- **THEN** the read returns `invalid_path` that names `https://example.test/:L1-5`, and a new read of that locator returns lines 1 through 5 of the page
- **AND** a read of `https://example.test/guide:12+` returns `invalid_selector` that names the `:L5`, `:L5-10`, `:L5+10`, `:L5-`, and `:-L5` forms before the `%3A` spelling
- **AND** `https://example.test/guide:12-` reads line 12 through the last line of the render
- **AND** a suffix outside the grammar with no line number in it, such as `https://w.example/wiki/Special:Search`, names the same forms and then the encoded spelling

#### Scenario: A selector the page cannot serve reports the page's length

- **WHEN** the model reads `https://example.test/guide:100-200` and the render is 3 lines long
- **THEN** the read returns `invalid_selector` and reports that the page rendered 3 lines
- **AND** the message does not repeat the error type as its text

#### Scenario: A local-only allow does not admit the web

- **WHEN** the only allow clause of the `read` group is a `path` regex for `^machine://`
- **THEN** an `https://` locator matches no allow and is rejected as `no_allow` before any request

#### Scenario: Publisher signals are not permission

- **WHEN** a page's `robots.txt` disallows the path or its response carries `content-signal: ai-train=no`
- **THEN** an admitted read still fetches the locator and returns its content
- **AND** the read does not report or enforce the signal

#### Scenario: Read path clauses do not govern web search

- **WHEN** the `read` group has no allow for `^https://` and `tools.allowed`, `webSearch`, and `tools.permissions.web_search` admit `web_search`
- **THEN** a `web_search` call runs its engines and returns results
- **AND** a `read` of any returned `https://` URL is still rejected as `no_allow` before any request

### Requirement: An unselected read requests the whole source

A text file read with no line selector MUST report `requestedRange` from its first line to its
`lineCount`. This applies when the count is known and not zero. Thus a read that the bound cuts resumes to the end
of the source. When the count is unknown, `requestedRange` MUST end at line 2000, the read line
ceiling. An empty file and a directory listing MUST report no `requestedRange`. The continuation of
a listing stays open.

#### Scenario: An unselected read of a counted file requests every line

- **WHEN** the model reads `notes.txt` of a 3,000-line file and the bound cuts it at line 1500
- **THEN** the result carries `requestedRange` 1..3000 and `nextOffset: 1500`

#### Scenario: An empty file requests no range

- **WHEN** the model reads an empty `notes.txt`
- **THEN** the result carries `lineCount` 0
- **AND** it carries no `requestedRange`

#### Scenario: A listing reports no range

- **WHEN** the model lists a directory of 120 entries and the bound stops the page at entry 50
- **THEN** the result carries no `requestedRange`
- **AND** its continuation is open (`:L51-`)

## ADDED Requirements

### Requirement: Line members can name the L unit

A line member MUST accept the unit letter `L`, in upper or lower case, before its first number.
Thus `L5`, `L5-10`, `L5+10`, `L5-`, and `-L5` MUST select the same lines as `5`, `5-10`, `5+10`,
`5-`, and `-5`. When the first number of a range carries the letter, the second number can also
carry it, as in `L5-L10`. The letter MUST NOT appear in any other position. A member without a
letter MUST mean lines.

#### Scenario: Every line spelling reads the same lines

- **WHEN** the model reads `notes.md:L5-10`, `notes.md:5-10`, `notes.md:l5-L10`, and `notes.md:L5+6` of one file
- **THEN** each read returns lines 5 through 10 with the same context lines and range metadata

#### Scenario: The other forms take the letter

- **WHEN** the model reads `:L5-`, `:-L5`, `:raw:L4-5`, `:L4-5:raw`, and `:outline:L5-40` of a Markdown file
- **THEN** each read equals the read of the same form without the letter

#### Scenario: Every text source accepts the letter

- **WHEN** the model reads `kb://<id>/a.md:L5-10`, `ssh://box/etc/os-release:L2-3`, `https://example.test/guide:L10-20`, `artifact://grep-1:L5-7`, and `job://bash-4/stdout:-L50`
- **THEN** each read selects the same lines as the same form without the letter

#### Scenario: A literal file name wins over the letter

- **WHEN** a host file named `/tmp/notes:L5` exists and the model reads `/tmp/notes:L5`
- **THEN** the read returns that file, not line 5 of `/tmp/notes`

#### Scenario: A letter in another position is outside the grammar

- **WHEN** the model reads `kb://<id>/notes.md:L5+L10` or `kb://<id>/notes.md:5-L10`
- **THEN** the tool returns `invalid_selector` with the shared refusal message

### Requirement: A selector list names one unit

Each member of a comma list MUST carry its own unit letter or no letter. A bare member and an `L`
member both name lines, so one list MUST accept both. A list that names two units MUST fail with
`invalid_selector`. No source accepts a second unit yet, so a reserved letter in any member MUST
fail the list.

#### Scenario: Bare and lettered members combine

- **WHEN** the model reads `notes.md:L5-16,L960-973` and `notes.md:5-16,L960-973` of one file
- **THEN** both reads return the same ranges with the same metadata

#### Scenario: A second unit fails the list

- **WHEN** the model reads `notes.md:L5,P2`
- **THEN** the tool returns `invalid_selector` and reads no line

### Requirement: A misplaced unit letter is refused with a fixed hint

A member that puts `L` before its minus sign, such as `L-5`, MUST fail with `invalid_selector` on
every source, after any literal-path probe. The message MUST be
`Write -L5 for the last 5 lines, or L1-5 for the first 5.`, with the number of the member in place
of `5`. This refusal MUST NOT add the `%3A` spelling.

#### Scenario: The hint names both readings

- **WHEN** the model reads `/tmp/notes.md:L-20` and no file has that literal name
- **THEN** the tool returns `invalid_selector` with the message `Write -L20 for the last 20 lines, or L1-20 for the first 20.`
- **AND** it reads no line

#### Scenario: The hint applies on a remote path

- **WHEN** the model reads `ssh://box/notes:L-5` or `kb://<id>/notes.md:L-5`
- **THEN** the tool returns `invalid_selector` with the hint and no other text
- **AND** the read opens no file named `notes:L-5`

### Requirement: Unit letters are reserved

The unit letters `L` for lines, `P` for pages, and `M` for messages MUST be reserved, in upper or
lower case. No source accepts `P` or `M` yet. The tool MUST refuse a suffix with a `P` or `M` member
with `invalid_selector` on every source, after any literal-path probe. This also applies on `ssh://`
and on a Machine, where another unknown suffix stays on the path. Another letter MUST stay outside
the grammar.

#### Scenario: A reserved unit fails on a text file

- **WHEN** the model reads `/tmp/notes.md:P3` or `/tmp/notes.md:-M2` and no file has that literal name
- **THEN** the tool returns `invalid_selector` with the shared refusal message

#### Scenario: A reserved unit is a selector on a remote path

- **WHEN** the model reads `ssh://box/notes:M2`
- **THEN** the tool returns `invalid_selector` and opens no file named `notes:M2`
- **AND** `ssh://box/notes%3AM2` reads the file named `notes:M2`

#### Scenario: A letter outside the reserved set stays on the path

- **WHEN** the model reads `ssh://box/notes:X5`
- **THEN** the read opens the file named `notes:X5`, because `X5` is not a selector shape there

#### Scenario: A literal file name wins over a reserved unit

- **WHEN** a host file named `/tmp/notes:P3` exists and the model reads `/tmp/notes:P3`
- **THEN** the read returns that file

### Requirement: A media source refuses a lettered member

An image, a PDF, and a `media://` locator take no selector. A line member with the letter `L` MUST
fail on them with `invalid_selector` and the message `An image or PDF is read without a selector.`,
as a bare member does. The tool MUST then decode no image or PDF.

#### Scenario: A lettered member on an image is refused

- **WHEN** the model reads `/work/shot.png:L1-10` or `media://<id>:L1`, and the source is an image
- **THEN** the tool returns `invalid_selector` with the message `An image or PDF is read without a selector.`
- **AND** no image is decoded

### Requirement: The shared selector refusal names the lettered forms

Each source that refuses a suffix outside the grammar MUST give this `invalid_selector` message. On a
source with a `%3A` spelling, that spelling MUST follow the message.

```text
A line selector is :L5, :L5-10, :L5+10, :L5-, or :-L5, or a comma-separated list of them. A bare number also reads as a line. :raw is the whole file, or :raw: followed by a list of them, and :outline takes one of them after the colon. A line number starts at 1.
```

#### Scenario: A malformed suffix gets the shared message

- **WHEN** the model reads `kb://<id>/notes.md:5-10x`
- **THEN** the tool returns `invalid_selector` with the shared refusal message, then the `%3A` spelling

### Requirement: Other line refusals name the lettered forms

The listing refusals of `artifact://`, `job://`, and the skill catalog MUST name their single forms
as `:L5-10`, `:L5+10`, `:L5-`, and `:-L5`. The web refusal that reports the rendered line count
MUST name the `L` forms and the range `L1-<n>`. Each of these messages MUST then say that a bare
number also reads as a line.

#### Scenario: A listing refusal names the lettered forms

- **WHEN** the model reads `artifact://:raw`
- **THEN** the refusal names the single forms `:L5-10`, `:L5+10`, `:L5-`, and `:-L5`
- **AND** it says that a bare number also reads as a line

#### Scenario: The web line-count refusal names the lettered forms

- **WHEN** the model reads `https://example.test/guide:L100-200` and the render is 3 lines long
- **THEN** the tool returns `invalid_selector` that names the `L` forms and the rendered range `L1-3`

### Requirement: llame writes every selector in the canonical spelling

Each selector that llame prints, stores in a new result, or writes as a read argument MUST use the
canonical spelling. A line member MUST carry an upper-case `L`, as in `L5`, `L5-10`, `L5+10`,
`L5-`, and `-L5`. Each list member MUST carry its letter, as in `L5-16,L960-973`. A raw range MUST
be `raw:L4-5`, and an outline scope MUST be `outline:L5-40`. llame MUST NOT rewrite text that the
owner wrote. A message that quotes a selector from the model MUST quote it as written.

#### Scenario: A read argument that llame writes is canonical

- **WHEN** llame reads the first page of a Knowledge instruction file
- **THEN** the read argument ends in `:raw:L1-2000`

#### Scenario: A stored bare range stays valid

- **WHEN** a stored grep passage carries the locator `notes.md:5-10` and the model reads that locator
- **THEN** the read returns lines 5 through 10
- **AND** the stored locator is not rewritten, and its replay renders the file line `notes.md`

### Requirement: A line and column suffix reads the line

A suffix `:N:M` of two bare whole numbers MUST read line `N` of the locator before it, on every text
source. The tool MUST ignore the column `M`. A literal-path probe MUST run first where one exists.
Thus a file named `x:12:5` that exists is read as that file. The rule MUST NOT apply when either
part carries a letter or a range.

#### Scenario: A compiler location reads its line

- **WHEN** the model reads `src/x.ts:12:5` and no file named `src/x.ts:12:5` exists
- **THEN** the read returns line 12 of `src/x.ts` with context lines 11 and 13
- **AND** the read header names the shown range as `src/x.ts:L11-13`

#### Scenario: A literal file name wins over the line and column

- **WHEN** a host file named `/tmp/x:12:5` exists and the model reads `/tmp/x:12:5`
- **THEN** the read returns that file

#### Scenario: A letter names the line of a file with a colon

- **WHEN** a host file named `/tmp/x.ts:12` exists and the model reads `/tmp/x.ts:12:L5`
- **THEN** the read returns line 5 of `/tmp/x.ts:12`

#### Scenario: Every text source reads the line

- **WHEN** the model reads `kb://<id>/notes/a.md:12:5`, `ssh://box/etc/os-release:2:1`, or `https://example.test/src/x.ts:12:5`
- **THEN** each read returns line 12, line 2, or line 12 of the locator before the line and column

#### Scenario: A zero line is refused

- **WHEN** the model reads `/tmp/x.ts:0:5` and no file has that literal name
- **THEN** the tool returns `invalid_selector`

### Requirement: A line and column does not combine with a representation

A raw or outline member MUST NOT take a line-and-column suffix. The tool MUST refuse a suffix
`:raw:N:M` or `:outline:N:M` with `invalid_selector` on every source, after any literal-path probe. A final `:raw` after
`:N:M` MUST keep the shipped raw split. Thus `x.ts:12:5:raw` is line 5 of `x.ts:12`, read raw.
`2024:10:raw` MUST stay line 10 of `2024`, read raw.

#### Scenario: A raw suffix keeps its meaning

- **WHEN** the model reads `/tmp/2024:10:raw`
- **THEN** the read returns line 10 of `/tmp/2024`, read raw

#### Scenario: A representation with a line and column is refused

- **WHEN** the model reads `/tmp/x.ts:raw:12:5` or `kb://<id>/x.md:outline:12:5`, and no file has that literal name
- **THEN** the tool returns `invalid_selector`

#### Scenario: A final raw keeps the raw split

- **WHEN** a host file named `/tmp/x.ts:12` exists and the model reads `/tmp/x.ts:12:5:raw`
- **THEN** the read returns line 5 of `/tmp/x.ts:12`, read raw

### Requirement: GitHub blob line anchors select lines

A line anchor is a fragment `#L<n>` or `#L<n>-L<m>`, with upper-case `L`. An enabled GitHub
adapter can match a blob locator with a line anchor. The anchor MUST then select those lines of the
blob that the adapter renders. It MUST give the context, metadata, and header of `:L<n>` or `:L<n>-<m>`.
A `C<c>` column after a line number MUST be ignored. The fragment MUST NOT reach GitHub.

#### Scenario: A pasted GitHub range reads its lines

- **WHEN** the model reads `https://github.com/o/r/blob/main/f.ts#L10-L20` and an enabled GitHub adapter matches it
- **THEN** the read returns lines 10 through 20 of `f.ts` with the context lines of a `:L10-20` read
- **AND** the read header is `https://github.com/o/r/blob/main/f.ts:L9-21` with the source total
- **AND** no request to GitHub carries the fragment

#### Scenario: One line and columns

- **WHEN** the model reads the same blob with `#L10` or with `#L10C5-L20C3`
- **THEN** the read selects line 10, or lines 10 through 20

#### Scenario: A query keeps the anchor and loses the continuation

- **WHEN** the model reads `https://github.com/o/r/blob/main/README.md?plain=1#L10-L2500` and the render is cut
- **THEN** the read selects from line 10 and the header names the shown range
- **AND** the continuation states the remainder alone, because a locator with a query takes no line selector

### Requirement: A line anchor outside its rule keeps the shipped fragment rule

The read MUST drop a fragment that is not a line anchor, such as `#readme` or `#l10`, as every web
fragment is. The read MUST also drop an anchor when no enabled GitHub adapter matches the locator as
a blob. It MUST also drop it when that adapter fails and another method renders the read. An
anchor that an adapter matches MUST fail with `invalid_selector` before any request when it ends
before its start, or names line 0.

#### Scenario: Another fragment keeps its meaning

- **WHEN** the model reads `https://github.com/o/r/blob/main/README.md#readme` or `...#l10`
- **THEN** the read returns the whole file, as a read without the fragment does

#### Scenario: An anchor on another method is dropped

- **WHEN** the GitHub adapter fails for `https://github.com/o/r/blob/main/f.ts#L10-L20` and the read falls through to the generic ladder
- **THEN** the read returns the generic render without a line selection, with the note of the adapter

#### Scenario: A reversed anchor is refused

- **WHEN** an enabled GitHub adapter matches `https://github.com/o/r/blob/main/f.ts#L20-L10` or `...#L0`
- **THEN** the tool returns `invalid_selector` before any request
- **AND** without an enabled GitHub adapter, the same locator drops its fragment and reads the whole page

### Requirement: A line anchor and a selector together are refused

An enabled GitHub adapter can match a blob locator that carries a line anchor and also a selector,
`:raw` included. The read MUST then fail with `invalid_selector` before any request. This check
MUST run also for `:raw`, which skips the adapter for the read itself. The message MUST be
`This locator selects lines twice, with #<anchor> and with :<selector>. Write one of them.`, with
the anchor and the selector as written.

#### Scenario: A suffix and an anchor are refused

- **WHEN** the model reads `https://github.com/o/r/blob/main/f.ts:5-9#L10-L20` and an enabled GitHub adapter matches it
- **THEN** the tool returns `invalid_selector` with the message `This locator selects lines twice, with #L10-L20 and with :5-9. Write one of them.`
- **AND** no request is sent

#### Scenario: A raw read with an anchor is refused

- **WHEN** the model reads `https://github.com/o/r/blob/main/f.ts:raw#L10` and an enabled GitHub adapter matches the locator
- **THEN** the tool returns `invalid_selector` before any request

#### Scenario: Without the adapter the suffix wins

- **WHEN** `tools.webAdapters` enables no GitHub adapter and the model reads `https://github.com/o/r/blob/main/f.ts:5-9#L10-L20`
- **THEN** the read applies `:5-9` to the generic render and drops the fragment

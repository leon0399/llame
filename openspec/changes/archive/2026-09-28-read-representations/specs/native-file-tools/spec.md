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
lines SHALL appear in the same `content` block as the requested lines. For single-range reads, result
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

#### Scenario: Knowledge outline keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/notes/guide.md:outline`
- **THEN** the result is the note's outline with the Space identifier, display name, locator, and untrusted-content notice
- **AND** `kb://<id>/notes/guide.md:outline:raw` returns `invalid_path`

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
either the submitted locator or its normalized form SHALL refuse the call, so
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
admits `raw`, `raw:N`, `raw:N-M`, `N`, `N-M`, `N+K`, comma lists of
those, and `outline`, `outline:N`, `outline:N-M`, and `outline:N+K`: `Search`
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

- **WHEN** the model reads `https://h.example/p:outline:5-40`
- **THEN** the request targets `https://h.example/p` and the outline is scoped to rendered lines 5 through 40
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

### Requirement: Web adapter contract is ordered, admitted, and fallible

The web adapter plane SHALL be a static, code-owned ordered list selected by
`tools.webAdapters`; an absent setting SHALL enable no adapter. Every entry
SHALL provide a pure synchronous `match` over the canonical source URL, a
stable `id`, and one route kind, `native` or `rewrite`. A native route SHALL
contact only fixed first-party origins; a rewrite route SHALL contact only its
operator-declared target origin. Matching SHALL occur only after the source
locator passes the submitted and normalized `read` permission checks and
SHALL precede the generic ladder. A URL an adapter's `match` accepts is
claimed by that adapter; a URL every `match` rejects is unclaimed and SHALL
reach the generic ladder with no adapter request and no note. `:raw` SHALL
bypass every adapter; `:outline` SHALL NOT, and is applied to the claiming
adapter's rendered document.

Every request an adapter derives SHALL pass the same `read`-group admission,
address resolution and pinning, 10-second header bound, 30-second call bound,
5 MiB per-response body bound, and redirect rules as the generic web path.
There SHALL be no adapter request-count cap; the rendered adapter document
SHALL be bounded at 5 MiB. The GitHub `token` SHALL be the only adapter
credential; it SHALL be sent only to `https://api.github.com` and SHALL be
removed before any cross-origin hop. An adapter SHALL never widen the source
permission or bypass address admission.

A claimed URL whose primary request is refused before I/O, answers a non-2xx
status, is rate-limited, cannot be parsed, or renders empty SHALL yield a
bounded note naming the adapter and one failure category — `permission`,
`address`, `status`, `rate_limit`, `transport`, `parse`, `empty`, `binary`,
`too_large`, or `content_type` — and SHALL fall through to the next claiming
adapter, then the generic ladder. A claimed URL whose primary request
succeeded and whose later request for the same document fails, or whose call
deadline or document bound is reached, SHALL render the content that arrived
and attach one note per missing section naming its category. A spent shared
call bound or caller abort before the primary request SHALL end the call
under the existing web contract. A native permission error on the submitted
source request chain SHALL end the call; a permission error on an adapter
chain SHALL disqualify only that adapter. Adapter failures SHALL NOT return a
response body to the model. A successful adapter SHALL use the result
provenance requirement, including the source URL as `finalUrl`. A rendered
adapter outcome SHALL declare the media type of its document so the
representation requirements can decide whether a member applies: the GitHub
adapter labels its issue, pull request, repository, and commit renders
`text/markdown` and a decoded blob by the same extension table the file
sources use; a rewrite adapter forwards the media type its inner render
reports. The label is internal and SHALL NOT be returned as a result field. A successful
adapter MAY return a directory read instead of text; it SHALL be rendered
through the host directory-read path with the call's selector and result
budget, and whatever that path returns, including the host's
`directory_too_large` refusal, SHALL be the call's result with no adapter
note and no fall-through.

#### Scenario: Matching does no network work

- **WHEN** a canonical `github.com` issue URL is passed to the adapter list
- **THEN** the GitHub adapter claims it from URL shape alone
- **AND** no request occurs before the derived API locator is admitted

#### Scenario: An unclaimed URL is untouched

- **WHEN** no configured adapter's `match` accepts the admitted source URL
- **THEN** the generic ladder runs exactly as it does without adapters
- **AND** the result carries no adapter note and no `adapter` object

#### Scenario: A rejected adapter request falls through

- **WHEN** a claimed adapter derives `https://api.github.com/repos/o/r/issues/1`
- **AND** the `read` group rejects that API origin
- **THEN** no request is issued to `api.github.com`
- **AND** a note names the adapter and `permission`, after which the generic ladder may run

#### Scenario: A status or parse failure falls through without its body

- **WHEN** a claimed adapter's primary request answers a non-2xx status, a recognized rate limit, malformed data, or an empty render
- **THEN** the response body is not returned to the model
- **AND** the adapter records a bounded failure note and the next candidate may render the source

#### Scenario: A secondary request failure renders partial content with a note

- **WHEN** an adapter's primary request succeeded and a later request for the same document fails or the call deadline is reached
- **THEN** the content that arrived is rendered
- **AND** each missing section carries one omission note naming its category

#### Scenario: Raw mode skips all adapters

- **WHEN** a source URL is claimed by a configured adapter and the selector is `:raw`
- **THEN** no adapter request is issued
- **AND** the final response body follows the generic raw contract

#### Scenario: A directory result follows the host directory path

- **WHEN** an adapter succeeds with a directory read whose requested level
  exceeds the host per-directory entry budget
- **THEN** the call returns the host's `directory_too_large` refusal
- **AND** no adapter note is added and the generic ladder does not run

#### Scenario: A rewrite result identifies its origin

- **WHEN** a rewrite adapter succeeds through its declared origin
- **THEN** the result preserves the source URL as `finalUrl`
- **AND** `method: "adapter"`, an adapter object with route `rewrite` and that origin, and a provenance note identify it

#### Scenario: An adapter document carries its media type

- **WHEN** the GitHub adapter renders `https://github.com/o/r/issues/1`
- **THEN** its document is labeled `text/markdown` and `:outline` applies to that rendered document with `method: "adapter"` and the `adapter` object retained
- **AND** a decoded `data.json` blob is labeled by its extension, so `:outline` on it fails with `invalid_selector` naming the member's accepted media types

## ADDED Requirements

### Requirement: Read representations are selected by media type and member

A representation SHALL be selected from a closed, compile-time table keyed by
the admitted content's media type and the requested member. The table SHALL
hold the existing `raw` member and the `outline` member at introduction; it
SHALL NOT be runtime-configurable, operator-loadable, or dynamically imported.
A member SHALL belong to one of two output classes: a `:` member returns
verbatim source lines with a shown range (`raw` without generated line
prefixes, as raw reads always have, and `outline` with the ordinary
line-number prefixes), and a future `?` member would return transformed
content with no prefixes and no shown range; no `?` member and no `?` grammar
exists in this change. With no member named, reading SHALL remain unchanged. A member
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
- **AND** no outline is appended or inferred

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

### Requirement: Markdown outlines are verbatim structural lines

For Markdown content, `:outline` SHALL return, in source order and each with
its ordinary line-number prefix, exactly these source lines: the frontmatter
lines the frontmatter requirement selects; the first non-blank line of the
document that precedes the first root heading and is not itself a heading line
(the root excerpt); and, for every root heading, its heading lines (one line
for an ATX heading; every text line plus the underline for a setext heading)
followed by the first non-blank line of its section that is not a heading
line, whatever that line is. A heading immediately followed by another heading
or by the end of the document has no excerpt line. Each native line SHALL be
emitted at most once, even when a lone CR lets it hold more than one root
heading. Every emitted line SHALL be
the source line verbatim, cut at 120 UTF-16 code units with a trailing `…` when
longer; the only text the outline generates is that marker and the
frontmatter elision line. The output SHALL contain no synthesized heading
text, no section end coordinates, no summary, no body excerpt beyond the one
line, and no heading-name selector. A Markdown document with no root headings
SHALL return its frontmatter lines, if any, and its root excerpt, if any; an
empty document SHALL return the ordinary empty-file result with null ranges.

#### Scenario: An outline is the document's structural lines

- **WHEN** an authorized file holds `# Guide` on line 1, `Intro sentence.` on line 3, `## Install` on line 5, ` ```bash ` on line 7, `## Use` on line 12, and `### Flags` on line 14 with `Flag text.` on line 16
- **THEN** the outline content is `1: # Guide`, `3: Intro sentence.`, `5: ## Install`, `7: ```bash`, `12: ## Use`, `14: ### Flags`, `16: Flag text.` and nothing else
- **AND** `12: ## Use` has no excerpt line because its next line is a heading, and reading `:14-16` addresses the `Flags` section

#### Scenario: A setext heading shows its underline

- **WHEN** a file holds `Two` on line 8 and `===` on line 9
- **THEN** the outline contains `8: Two` followed by `9: ===`
- **AND** neither line is rewritten as `# Two`

#### Scenario: A long line is cut, not rewritten

- **WHEN** a heading or excerpt line is longer than 120 code units
- **THEN** the outline emits its first 120 code units followed by `…`
- **AND** a line of exactly 120 code units is emitted whole

#### Scenario: A document without headings shows its opening line

- **WHEN** an authorized Markdown file has no root heading and its first non-blank line is line 3
- **THEN** the outline content is `3: <that line>` after any frontmatter lines
- **AND** the result is a successful read with `representation: "outline"`

#### Scenario: Duplicate headings are told apart by line

- **WHEN** a file contains `## Notes` at lines 10 and 40
- **THEN** the outline contains `10: ## Notes` and `40: ## Notes`, each with its own excerpt line
- **AND** no selector addresses either occurrence by name

### Requirement: Markdown heading sections use deterministic CommonMark boundaries

The outline SHALL recognize CommonMark ATX headings and setext headings only
at the root document level, outside fenced code blocks, indented code blocks,
frontmatter, and HTML blocks. Headings nested in list items or blockquotes
SHALL NOT produce entries. An ATX heading starts at its ATX line. A setext
heading starts at its first text line and includes its underline line. One
leading U+FEFF on line 1 SHALL be ignored for recognition, as CommonMark
ignores it, and SHALL stay in the emitted line, which remains verbatim. A
heading's section SHALL begin at its first heading line and end at the line
immediately before the next root heading whose depth is less than or equal to
its own, or at the source's last line; a deeper heading remains inside the
nearest preceding shallower section. Section boundaries are used by the scope
and ancestor requirement and by the shared structure primitive; they are not
printed. Heading text SHALL be source-derived and untrusted.

#### Scenario: Nested sections end at the same or a shallower level

- **WHEN** a level-two heading at line 5 is followed by a level-three heading at line 9 and another level-two heading at line 20
- **THEN** the level-three section is lines 9 through 19
- **AND** the first level-two section is lines 5 through 19, containing it

#### Scenario: Fenced and indented code are not headings

- **WHEN** fenced or indented code contains lines such as `# not a heading`
- **THEN** those lines produce no outline entry
- **AND** surrounding real headings keep their line numbers

#### Scenario: HTML blocks are not headings

- **WHEN** an HTML block contains a line beginning with `# not a heading`
- **THEN** that line produces no outline entry
- **AND** a Markdown heading after the closed HTML block is recognized normally

#### Scenario: Container headings are excluded

- **WHEN** `- # in list` and `> ## in quote` precede `# Real` at line 3 of a three-line Markdown file
- **THEN** the outline contains `1: - # in list` as the root excerpt, because a list item is a content line, and `3: # Real` as the only heading entry
- **AND** no heading entry is produced for the list-item or blockquote heading

#### Scenario: A thematic break is not a setext underline

- **WHEN** a blank line precedes `---`
- **THEN** no heading is produced
- **AND** `Two` immediately followed by `---` is a depth-two setext heading

#### Scenario: A leading byte order mark is ignored for recognition

- **WHEN** a Markdown file begins with U+FEFF followed by `# Title` on line 1
- **THEN** line 1 is a root heading and the outline emits it verbatim, byte order mark included
- **AND** a line-one `---` preceded by U+FEFF still opens frontmatter

### Requirement: Frontmatter is shown as authored key lines

Only a block that starts at line 1 with `---` and closes with a later `---`
or `...` line SHALL be frontmatter; a delimiter line matches when its content,
after removing one trailing CR and any trailing spaces or tabs, is exactly
`---` or `...`, so CRLF files are recognized. A closed block SHALL be excluded
from heading recognition regardless of its contents. The outline SHALL emit
both delimiter lines and, between them, every top-level key line: a block line
that begins at column zero with a character other than whitespace, `#`, or
`-`. Indented lines, comments, and sequence items SHALL NOT be emitted. After
32 key lines the outline SHALL emit one generated line
`[… N more frontmatter lines]` in place of the rest, where N counts the omitted
key lines; that line carries no line-number prefix and no source coordinate
and does not extend the shown range. No YAML, TOML, or JSON parsing SHALL be performed and no note SHALL
be emitted for a block that would not parse. An unclosed line-one opener SHALL
NOT be frontmatter and SHALL be parsed as ordinary Markdown; a later `---` with
no closed line-one block is ordinary Markdown.

#### Scenario: Frontmatter keys precede the headings

- **WHEN** a skill file begins `---`, `name: octocat`, `description: Use for GitHub.`, `---`, then `# Octocat` on line 5
- **THEN** the outline begins `1: ---`, `2: name: octocat`, `3: description: Use for GitHub.`, `4: ---`, `5: # Octocat`
- **AND** no YAML line becomes a heading

#### Scenario: Nested values show their key only

- **WHEN** the block holds `tags:` on line 3 followed by an indented `- notes` sequence item on line 4 and `title: >` on line 5 followed by an indented folded scalar
- **THEN** the outline emits `3: tags:` and `5: title: >` and neither indented line
- **AND** a `# comment` line inside the block is not emitted

#### Scenario: A long frontmatter block is elided

- **WHEN** a note's closed block holds 60 top-level keys
- **THEN** the outline emits the first 32 key lines followed by `[… 28 more frontmatter lines]` and then the closing delimiter
- **AND** the headings that follow are unaffected

#### Scenario: A malformed block still shows its lines

- **WHEN** a closed line-one block is not valid YAML, or is a scalar rather than a mapping, and the body contains a valid heading
- **THEN** the outline emits the block's delimiter and key lines as they are and the body heading, with no note
- **AND** no line of the block becomes a heading

#### Scenario: An unclosed opener is ordinary Markdown

- **WHEN** a line-one `---` opener has no closing `---` or `...` and the body contains a valid heading
- **THEN** the outline parses the document as ordinary Markdown and emits no frontmatter lines
- **AND** the body heading keeps its line number

#### Scenario: CRLF frontmatter is recognized

- **WHEN** a CRLF Markdown file begins `---`, `title: X`, `---`, `# Body`, each line ending in CRLF
- **THEN** the closed block is excluded from heading recognition and the outline emits `1: ---`, `2: title: X`, `3: ---`, `4: # Body`
- **AND** the CR is not part of the delimiter match

### Requirement: Outline scope prepends the direct ancestors

`:outline:N-M` (and `:outline:N` for `N-N`, `:outline:N+K` for the `K` lines
from `N`, as ordinary `:N+K` selects) SHALL restrict the emitted lines to those whose source line lies in the
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
- **AND** an ordinary range read of that file is unchanged

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

### Requirement: Representation output preserves source attribution and authority

An outline SHALL run only after the same source admission, permission
decision, owner resolution, and content acquisition that an ordinary `read`
would use. It SHALL preserve the ordinary source identity and result envelope:
host results retain host path behavior, `file://` results retain the decoded
host identity, `kb://` results retain their locator, Space identity, and
closed untrusted-content notice, `skill://` results retain their published
skill paths, and web results retain `path`, `finalUrl`, `method`, the
`adapter` object when present, and `notes`. Emitted lines SHALL remain
untrusted content and SHALL NOT become instructions or authority. An outline
line number SHALL grant no access not already granted to the original locator.

#### Scenario: Host and Knowledge outlines are structurally equivalent

- **WHEN** equivalent Markdown is read through an authorized absolute host path and an authorized `kb://` locator
- **THEN** both outlines contain the same lines with the same prefixes
- **AND** the host result has host identity while the Knowledge result has its Space attribution and untrusted-content notice

#### Scenario: Knowledge outline remains untrusted

- **WHEN** a Knowledge Markdown heading contains an instruction-like string
- **THEN** the outline returns that heading line as untrusted content with the Knowledge notice
- **AND** the heading cannot change tool availability, owner identity, or read authority

#### Scenario: Skill outline retains path disclosure rules

- **WHEN** the model requests `:outline` for an eligible `skill://` Markdown resource
- **THEN** the outline result retains the skill locator, resolved path, skill directory, and existing skill instruction envelope
- **AND** the outline does not grant mutation or script execution

#### Scenario: Web outline retains provenance

- **WHEN** an admitted web adapter produces a Markdown document and the model requests `:outline`
- **THEN** the result retains the source `path`, `finalUrl`, `method: "adapter"`, the `adapter` object, and any notes
- **AND** the outline does not expose an adapter credential or turn the rendered content into authority

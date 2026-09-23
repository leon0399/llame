## MODIFIED Requirements

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

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and headers as the first, sending no cookie, `Authorization`, or other
credential on any request. The hop locator SHALL be the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so a relative `Location` becomes absolute and the
serialization is what policy sees: lowercase host, an internationalized host
as punycode, default port dropped, empty path as `/`, path and query
percent-encoded and normalized as for a submitted locator. A fragment SHALL be dropped from the resolved locator
before admission and before the request, so the text policy matches is
exactly the URL the next request uses. A redirect status without a parsable
`Location`, or a resolved locator that carries userinfo or a scheme other
than `http` or `https`, SHALL fail the call with `invalid_redirect` before
any request and SHALL NOT name the target. Before a hop's request is sent, the `read`
permission group SHALL be evaluated against that locator as if the model had
submitted it, through the same evaluator and the same projection the call
used. A rejected hop on the call's own request chain SHALL end the call with
a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. A rejected hop inside a
probe's own redirect chain SHALL disqualify that candidate instead, under the
adapter rule, so a page cannot end a read of itself through a redirect it
announced. When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the
response that produced the content as `finalUrl` and SHALL NOT enumerate the
hop chain: when a publisher-Markdown probe won, that is the probe's own
final URL, including any redirect it followed, rather than the page's.
The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. A hop admitted on its text
SHALL then connect only to the addresses the address-admission requirement
admits; a hop whose every address is refused SHALL end the call on the call's
own request chain and disqualify only the candidate on a probe's chain, as
that requirement states.

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

#### Scenario: A hop is judged by the address it resolves to

- **WHEN** a public page redirects to `https://files.example/private` and `files.example` resolves to `10.67.88.60`
- **AND** the `read` group allows everything and rejects `^https?://10\.67\.88\.60/private`
- **THEN** no connection is opened to `10.67.88.60` and the call ends with `permission_denied`, the refused-address message, and `rejectedUrl` `https://files.example/private`

#### Scenario: A hop to a private address is admitted by its text

- **WHEN** a redirect targets `http://127.0.0.1:8080/admin` and the `read` group admits that URL's text
- **AND** no reject matches its address locator `http://127.0.0.1:8080/admin`
- **THEN** the request is issued, because operator policy decides and no built-in address range refuses it
- **AND** the outcome is the same for a hostname whose address resolves into a private range

#### Scenario: The description explains where the content came from

- **WHEN** the packaged `read` description is rendered for a catalog that includes `read`
- **THEN** it states that redirects are followed and that the result reports the final URL

## ADDED Requirements

### Requirement: Web reads connect only to addresses the read group admits

Before each request a web read issues (the submitted locator, a redirect hop,
an announced alternate, a suffix candidate, or an `llms.txt` candidate) and
after that locator's own text is admitted, the tool SHALL determine the
addresses the request may connect to. A host that is an IP literal SHALL be its
own single address. Any other host SHALL be resolved through the system
resolver, so hosts files and the platform's name service apply as they do for
every other process of the host, at most once per call: a later request of
the same call to the same host SHALL reuse that answer. Resolution SHALL count
against the request's header bound and the call bound, and a resolution
failure SHALL fail the request as a transport failure does. No CNAME or other
intermediate name SHALL be evaluated.

For every address, the `read` group SHALL be evaluated against an address
locator: exactly the URL the request uses with only its host replaced by
that address, keeping the scheme, port, path, and query; a read selector is
never requested and SHALL NOT be part of it. An IPv4 address SHALL be written
in dotted decimal, an IPv6 address in brackets in its WHATWG serialization,
and an IPv4-mapped IPv6 address, in whichever textual form the resolver or the
locator gave it, as the dotted IPv4 address it maps; an IPv6 zone identifier
SHALL be dropped. An address SHALL be judged in its own form: `0.0.0.0` and
`::` are not rewritten to the loopback addresses the platform may connect
them to. An address locator SHALL be judged by reject clauses only: an address
SHALL be refused when a reject clause matches its address locator or when the
evaluation exceeds the inspection limit, and SHALL otherwise be admitted
whether or not any allow clause matches it, because allow is decided on the
locator text the request was admitted by. A call evaluated without a compiled
permission policy SHALL admit no address.

The request SHALL connect only to admitted addresses, racing them under the
runtime's ordinary address selection. A refused address SHALL never be
dialed, and trying the next admitted address while the connection is being
established is part of one request, not a retry. The host SHALL NOT be
resolved again between the decision and the connection. A connection SHALL
serve only the request whose address locators admitted it and SHALL NOT be
reused by another request, even one to the same host.

When every address of a request is refused, that request SHALL NOT be issued.
On the call's own request chain (the submitted locator or one of its redirect
hops) the call SHALL end with `status: "error"`, `type: "permission_denied"`,
and the fixed refused-address message, and a refused hop SHALL also carry its
hostname locator as `rejectedUrl` under the hop rules; on a probe's chain only
that candidate SHALL be disqualified. No result, message, or note SHALL carry
a resolved address. Each distinct refused address SHALL be recorded as a
derived-locator decision of kind `address` under the provenance requirement of
`tool-call-permissions`.

#### Scenario: An address reject holds for every name

- **WHEN** the `read` group is `{ "allow": true, "reject": [{ "field": "path", "regex": "^https?://10\\.67\\.88\\.60/private" }] }`
- **AND** `export.corp`, `x.attacker.example`, and a redirect target each resolve to `10.67.88.60`
- **THEN** reading `/private` through any of them opens no connection and ends with `permission_denied` and the refused-address message
- **AND** reading `https://export.corp/data` connects to `10.67.88.60` and returns the page

#### Scenario: A refused address is skipped

- **WHEN** a host resolves to `10.0.0.5` and `93.184.216.34` and a reject matches only the `10.0.0.5` address locator
- **THEN** the request connects to `93.184.216.34` and never to `10.0.0.5`
- **AND** the call succeeds and records one `address` rejection

#### Scenario: An address needs no allow of its own

- **WHEN** the `read` group's only allow is `^https://docs\.example\.com/` and `docs.example.com` resolves to an address no clause names
- **THEN** the read is admitted and fetched

#### Scenario: The checked answer is the one dialed

- **WHEN** the resolver answers `93.184.216.34` for a host when the request is decided and would answer `127.0.0.1` to any later query
- **THEN** the request connects to `93.184.216.34` and never to `127.0.0.1`
- **AND** a later probe of the same call to that host connects to `93.184.216.34` without a second resolution

#### Scenario: An IP literal is judged in its address form

- **WHEN** the model reads `https://[::ffff:169.254.169.254]/latest` and a reject matches `^https?://169\.254\.169\.254[:/]`
- **THEN** the read is refused with no connection, because its address locator is `https://169.254.169.254/latest`

#### Scenario: A connection is not reused across paths

- **WHEN** `a.example` resolves to `10.0.0.5` and `10.0.0.6`, the page `https://a.example/page` connects over `10.0.0.5`, and a path-scoped reject refuses `10.0.0.5` for its suffix probe `https://a.example/page.md`
- **THEN** the probe opens a new connection to `10.0.0.6` and never sends its request over the page's connection or to `10.0.0.5`
- **AND** the page's content is returned

#### Scenario: A resolved IPv4-mapped answer is judged as IPv4

- **WHEN** a host resolves only to the AAAA answer `::ffff:10.67.88.60` and a reject matches `^https?://10\.67\.88\.60/private`
- **THEN** reading `/private` on that host opens no connection, because its address locator is `https://10.67.88.60/private`

#### Scenario: A selector is not part of the address locator

- **WHEN** a reject matches `^https?://10\.67\.88\.60/private$` and the model reads `https://export.corp/private:raw` with `export.corp` resolving to `10.67.88.60`
- **THEN** the read is refused with no connection, because the address locator is the requested URL `https://10.67.88.60/private`

#### Scenario: No resolved address reaches the model

- **WHEN** every address of the call's own locator is refused
- **THEN** the result carries the fixed refused-address message and no address text
- **AND** a probe candidate whose every address is refused is disqualified without an error

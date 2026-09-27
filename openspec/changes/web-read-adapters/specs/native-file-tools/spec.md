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

After the submitted locator is admitted and canonicalized, the read SHALL
consider the ordered, code-owned web service adapters before the generic HTML
and text ladder. A matching adapter SHALL be selected without network I/O.
`:raw` SHALL bypass every adapter and retain the raw-response behavior below.
An adapter SHALL not add a tool id, a second permission group, or a different
source authority.

Because the text requested is no longer always the text submitted, the
permission decision SHALL be taken over both: any reject clause matching
either the submitted locator or its normalized form SHALL refuse the call, so
a spelling cannot be arranged to miss a reject, while the allow SHALL be
decided on the normalized form, because an allow names the resource the call
will reach and the two texts are one resource. A redirect hop is a different
resource and SHALL keep being admitted in its own right. An adapter target is
another derived locator and SHALL be admitted in its own right. Every address
a request would connect to SHALL additionally be judged under the
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

#### Scenario: Raw mode bypasses site adapters

- **WHEN** the model reads `https://x.example/post:raw` and a matching site adapter is configured
- **THEN** the adapter makes no request and the original web response is returned through the raw path

### Requirement: Web fetch bounds fail fast and are never retried

Every web request SHALL carry `User-Agent: llame/<version>`, where the version
is the boot-time value instance configuration resolves for the running
process. The tool SHALL NOT rotate, randomize, or omit that value and SHALL
NOT claim another product's client identity. A request whose response
headers do not arrive within 10 seconds SHALL fail the call with
`headers_timeout`. A call that has not completed within 30 seconds, counted
across every request it issues, SHALL fail with `call_timeout`. The response
body SHALL be streamed against a 5 MiB cap and aborted past it with
`body_too_large`, and a declared length above the cap SHALL fail before the
body is read. `Accept-Encoding` SHALL be left to the runtime. A web call
SHALL NOT retry: a transport failure, a timeout, and an error status SHALL
each be reported to the model as an error observation with no second
attempt. A non-2xx status other than a redirect status (301, 302, 303, 307,
308, which the redirect requirement governs whether or not a `Location` is
present) on the submitted source request or one of its redirect hops, SHALL fail the
call with `http_status` naming the status; a 429
SHALL additionally carry the `Retry-After` value when the response supplies
one. A status error SHALL NOT return the response body and SHALL NOT report
response headers other than that `Retry-After` delay. A redirect answer to a
probe request SHALL be followed under the shared redirect rules before any
terminal status is judged. An adapter request or its redirect chain whose
status, content type, transport, or adapter-local bound fails SHALL disqualify
that adapter without failing the call. A probe request (an
alternate, a suffix candidate, or an `llms.txt` candidate) whose terminal
response answers a non-2xx status, or a refused content type, or which fails
on a bound of its own (a headers timeout, an oversized body, a transport
failure, or a redirect it cannot follow), SHALL disqualify only that
candidate, and the pipeline SHALL continue; a probe that exhausts the call's
deadline or its redirect budget SHALL fail the call, while a refusal inside
a probe's own redirect chain disqualifies only that candidate, as a refused
probe locator does. Adapter requests SHALL have an adapter-phase budget of at
most eight requests per call, including redirects of those requests. They SHALL
share the 30-second call deadline, 5 MiB body bound, and 20-hop redirect
budget; exhausting the adapter budget SHALL disqualify the adapter and fall
through, not create a new call-ending error. A call SHALL issue at most one alternate request, one suffix-probe request,
and four `llms.txt` requests, and SHALL follow at most 20 redirects in total
across all of its requests.

#### Scenario: Every request identifies llame

- **WHEN** any web request of an admitted read is inspected
- **THEN** its `User-Agent` is `llame/<version>` with the boot-time version
- **AND** the value does not vary between the call's requests

#### Scenario: A redirect is followed, not failed, and a bare redirect fails closed

- **WHEN** the first response is 302 with a `Location` header and policy admits the target
- **THEN** the hop is followed and the call does not fail with `http_status`
- **AND** a 302 without a parsable `Location` fails the call with `invalid_redirect`

#### Scenario: Slow headers fail at the header bound

- **WHEN** a server accepts the connection and sends no response headers within 10 seconds
- **THEN** the call fails with `headers_timeout`
- **AND** the body is not read

#### Scenario: A call over the total bound fails

- **WHEN** each response arrives inside the header bound but the call passes 30 seconds while following hops or probing alternates
- **THEN** the call fails with `call_timeout`
- **AND** no further request is issued for that call

#### Scenario: An oversized body is aborted

- **WHEN** a response declares or streams more than 5 MiB
- **THEN** the call fails with `body_too_large`
- **AND** the read stops streaming instead of buffering the remainder

#### Scenario: Rate limiting is reported, not retried

- **WHEN** a server answers 429 with `Retry-After: 120`
- **THEN** the call fails with `http_status` naming 429 and the retry delay
- **AND** no retry is attempted

#### Scenario: An error status is not content

- **WHEN** a server answers 404 or 500
- **THEN** the call fails with `http_status` naming the status
- **AND** the response body is not returned as content

#### Scenario: An adapter budget failure falls through

- **WHEN** a matched adapter would issue a ninth request, including redirects, within one call
- **THEN** no ninth adapter request is issued
- **AND** the adapter records a `budget` note and the source may continue to the next adapter or generic ladder without resetting the shared deadline or redirect budget

### Requirement: Web HTML reads prefer publisher Markdown

After matching adapters produce no result, the first request for a page SHALL send `Accept: text/markdown,
text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`, so a publisher that serves
Markdown or plain text for agents is used without a second request or a
local conversion. A first response that is `text/markdown` or
`text/plain` SHALL be returned as the content with `method`
`negotiated`, ungated and unconverted: the publisher's agent-facing body is
taken as it is. Otherwise, for an HTML body, the tool SHALL try, in order,
a Markdown alternate announced by the response's `Link` header or by a `<link
rel="alternate" type="text/markdown">` element in the page head, resolved to
an absolute URL, fetched, and reported as `method` `alternate`; then the
publisher's Markdown suffix probe, mapping `/a/b.html` to `/a/b.html.md`,
`/a/b` to `/a/b.md`, and `/a/b/` to `/a/b/index.md`, reported as `method`
`md-suffix`. The first candidate that passes the quality gate SHALL win and
end the search. The quality gate SHALL judge an alternate, a suffix candidate,
and the local render alike: more than 100 non-whitespace characters, not
HTML-shaped for a Markdown candidate, and not low quality, where a candidate
is low quality when it is under 1,024 characters and contains a JavaScript
or captcha gate phrase, or when more than 70 percent of its non-blank lines
are shorter than 40 characters and fewer than 40 of them reach that length,
since a render that carries 40 substantial lines is a document whatever its
shape and the fallback it would be sent to is the same page's raw HTML.
Every derived locator, meaning an alternate,
a suffix candidate, an `llms.txt` candidate, a redirect hop, or an adapter request, SHALL be
evaluated against the `read` permission group before its request through
the same evaluator and the same projection the call used, as if the model
had submitted it; a rejected probe locator, adapter request, or rejected hop inside a
probe's own redirect chain SHALL disqualify that candidate or adapter without
failing the call and its decision SHALL be recorded like a hop decision, so a hostile
page cannot make a read of itself fail by announcing a refused alternate. A probe request SHALL send the same `Accept` header and
SHALL count against the call's total time, body, request, and redirect
bounds; a failure of its own disqualifies the
candidate without failing the call, while a spent call bound fails it. A candidate that fails the gate SHALL
NOT become the content, and a fetched candidate SHALL NOT be searched for
further alternates
or suffixes.

#### Scenario: Negotiated Markdown wins without a second request

- **WHEN** the first request's response is `text/markdown`
- **THEN** the content is that body and `method` is `negotiated`
- **AND** the call issues no further request for that page

#### Scenario: A Link header alternate is fetched

- **WHEN** an HTML response carries `Link: <https://example.test/guide.md>; rel="alternate"; type="text/markdown"`
- **THEN** that URL is requested and its body is returned with `method` `alternate`

#### Scenario: A head alternate link resolves against the page

- **WHEN** a page's head declares `<link rel="alternate" type="text/markdown" href="/guide.md">`
- **THEN** `/guide.md` is resolved against the page's URL, fetched, and reported as `method` `alternate`

#### Scenario: The suffix probe finds a publisher file

- **WHEN** an HTML page at `https://example.test/a/b` announces no alternate and `https://example.test/a/b.md` returns Markdown that passes the gate
- **THEN** the content is that file and `method` is `md-suffix`

#### Scenario: A candidate that fails the gate does not win

- **WHEN** an alternate or suffix URL answers 404, serves `application/pdf`, returns an HTML error page, or returns a body of 40 characters
- **THEN** that candidate is not returned as the content and the call does not fail
- **AND** the next ladder stage in order decides the content

#### Scenario: A low-quality candidate is rejected

- **WHEN** a page's only Markdown candidate is 900 characters dominated by short navigation lines, or a short page whose text is a JavaScript gate notice
- **THEN** the candidate fails the gate
- **AND** the pipeline continues past it

#### Scenario: A refused alternate is skipped, not fetched

- **WHEN** the `read` group's only allow is `^https://docs\.example\.com/` and a page on that host announces `Link: <https://evil.example/x.md>; rel="alternate"; type="text/markdown"`
- **THEN** the alternate locator is rejected before any request, no request reaches `evil.example`, and the decision is recorded like a hop decision
- **AND** the pipeline continues with the suffix probe and the local render, and the call does not fail

#### Scenario: Probes carry the negotiated accept header

- **WHEN** any alternate or suffix probe request is inspected
- **THEN** it sends the same `Accept` value as the first request
- **AND** it counts against the call's total time and body bound

### Requirement: Web reads accept text bodies only

A web read SHALL accept only text bodies: `text/*` media types,
`application/json`, `application/xml`, and any type whose subtype carries a
`+json` or `+xml` suffix. `text/markdown` SHALL be handled as Markdown. For the submitted source and generic ladder, every other content type SHALL
fail with `unsupported_content_type` naming the received type, and its body
SHALL NOT be returned as content. An adapter response with a refused content
type SHALL disqualify that adapter with a bounded note and SHALL not fail the
source call. Only a
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

- **WHEN** a locator serves `application/pdf` or `image/png`
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

#### Scenario: A content-type adapter failure falls through

- **WHEN** a matched adapter response declares `application/pdf` or `image/png`
- **THEN** the adapter is disqualified with a `content_type` (`unsupported_content_type`) note
- **AND** no adapter body is returned and the source may continue through the next candidate

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and non-credential headers as the first. The submitted source request, generic
probes, and every hop of those chains SHALL send no cookie, `Authorization`, or
other credential. An adapter request MAY send its configured credential only to
its declared origin and a same-origin hop of that adapter chain; that credential
SHALL be removed before any cross-origin hop. The hop locator SHALL be the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so a relative `Location` becomes absolute and the
serialization is what policy sees: lowercase host, an internationalized host
as punycode, default port dropped, empty path as `/`, path and query
percent-encoded and normalized as for a submitted locator. A fragment SHALL be dropped from the resolved locator
before admission and before the request, so the text policy matches is
exactly the URL the next request uses. A redirect status without a parsable
`Location`, or a resolved locator that carries userinfo or a scheme other
than `http` or `https`, SHALL fail the source request chain with
`invalid_redirect` before any request and SHALL NOT name the target. The same
condition on an adapter chain SHALL disqualify that adapter before its target
request. Before a hop's request is sent, the `read`
permission group SHALL be evaluated against that locator as if the model had
submitted it, through the same evaluator and the same projection the call
used. A rejected hop on the submitted source request chain SHALL end the call with
a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. A rejected hop inside a
probe's own redirect chain SHALL disqualify that candidate instead, under the
probe rule, so a page cannot end a read of itself through a redirect it
announced. A rejected hop inside an adapter chain SHALL disqualify that
adapter instead. When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the response that produced the content as
`finalUrl` and SHALL NOT enumerate the hop chain: when a publisher-Markdown probe won, that is the probe's own
final URL, including any redirect it followed, rather than the page's. An
adapter result instead reports its source URL as `finalUrl` under the result
requirement.
The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. A hop admitted on its text
SHALL then connect only to the addresses the address-admission requirement
admits; a hop whose every address is refused SHALL end the call on the submitted
source request chain and disqualify only the candidate on a probe's chain or
the adapter on an adapter chain, as that requirement states.

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

#### Scenario: An adapter hop refusal falls through

- **WHEN** an adapter target redirects to a locator refused by the `read` group
- **THEN** the adapter is disqualified before the refused target is requested
- **AND** the source call may continue with another adapter or the generic ladder

### Requirement: Web reads connect only to addresses the read group admits

Before each request a web read issues (the submitted locator, a redirect hop,
an announced alternate, a suffix candidate, an `llms.txt` candidate, or an
adapter request) and after that locator's own text is admitted, the tool SHALL determine the
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
On the submitted source request chain (the source locator or one of its
redirect hops) the call SHALL end with `status: "error"`,
`type: "permission_denied"`, and the fixed refused-address message, and a
refused hop SHALL also carry its hostname locator as `rejectedUrl` under the
hop rules; on a probe or adapter chain only that candidate or adapter SHALL be
disqualified. No result, message, or note SHALL carry
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

#### Scenario: A refused adapter address falls through

- **WHEN** every admitted address of an adapter target is refused
- **THEN** no adapter connection is opened and the adapter records an address failure
- **AND** the source may continue with another adapter or the generic ladder

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, `raw`, or `adapter`, and
SHALL name the ladder stage or service adapter that produced the returned
content. An adapter result SHALL additionally carry an `adapter` object with
its stable `id`, its `route` (`native`, `service`, or `rewrite`), and, for a
service or rewrite, its declared origin. For an adapter result, `finalUrl`
SHALL remain the source URL rather than the API, service, or rewrite target;
notes SHALL identify delegated content and its origin when applicable. The result SHALL
NOT carry a `url` field, a `contentType` field, a `markdownTokens` field, a
text header before the content, or a metadata frontmatter block. Line
selectors SHALL apply to the rendered text exactly as to a local file, with
the existing context, range, `nextOffset`, and truncation rules, and the
rendered text SHALL be measured against the existing native read result bound,
which SHALL reserve space for `path`, `finalUrl`, `method`, `adapter`, and
`notes` before truncating content. A web read SHALL NOT carry `realPath`. A selector read of
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

#### Scenario: Adapter provenance preserves the source identity

- **WHEN** `https://x.com/jack/status/20` is rendered by a declared `fxembed` service
- **THEN** the result has `method: "adapter"`, `finalUrl: "https://x.com/jack/status/20"`, and an `adapter` object naming the service route and origin
- **AND** its notes state that the content came through the configured third-party origin

## ADDED Requirements

### Requirement: Web adapter contract is ordered, admitted, and fallible

The web adapter plane SHALL be a static, code-owned ordered list. Every entry
SHALL provide a pure synchronous `match` over the canonical source URL, one
route kind (`native`, `service`, or `rewrite`), a bounded request/render path,
and a stable id. Native routes SHALL contact only fixed first-party origins;
service routes SHALL implement a code-owned protocol at an operator-declared
origin; rewrite routes SHALL use an operator-declared validated target and the
local negotiated/text or Readability stages without generic probes. Matching SHALL occur only after the source locator passes the
submitted and normalized `read` permission checks.

Every request an adapter derives SHALL pass the same `read`-group admission,
address resolution and pinning, 10-second header bound, 30-second call bound,
5 MiB body bound, request budget, and redirect rules as the generic web path.
A credential SHALL be sent only to its adapter's declared origin and SHALL be
removed before a redirect crosses origins. An adapter SHALL never widen the
source permission or bypass address admission.

A matched adapter that is refused before its request,
returns a non-2xx status, is rate-limited, cannot parse a bounded response,
produces an empty render, or exhausts its adapter sub-budget SHALL yield a
bounded note naming the adapter and failure category, then fall through to the
next matching adapter and finally the generic ladder. A spent shared call bound or caller abort SHALL end the call under the
existing web contract. A native permission error on the submitted source
request chain SHALL end the call; a permission error on an adapter chain SHALL
disqualify only that adapter. Adapter failures
SHALL NOT return a response body to the model. A successful adapter SHALL use
the result provenance requirement, including the source URL as `finalUrl`.

#### Scenario: Matching does no network work

- **WHEN** a canonical `github.com` issue URL is passed to the adapter list
- **THEN** the GitHub adapter can claim it from URL shape alone
- **AND** no request occurs before the derived API locator is admitted

#### Scenario: A rejected adapter request falls through

- **WHEN** a matched adapter derives `https://api.github.com/repos/o/r/issues/1`
- **AND** the `read` group rejects that API origin
- **THEN** no request is issued to `api.github.com`
- **AND** a note names the adapter and permission failure, after which the generic ladder may run

#### Scenario: A status or parse failure falls through without its body

- **WHEN** a matched adapter receives a non-2xx response, a recognized rate limit, malformed protocol data, or an empty render
- **THEN** the response body is not returned to the model as an error body
- **AND** the adapter records a bounded failure note and the next candidate may render the source

#### Scenario: Raw mode skips all adapters

- **WHEN** a source URL has a matching native or delegated adapter and the selector is `:raw`
- **THEN** no adapter request is issued
- **AND** the final response body follows the generic raw contract

#### Scenario: A service result identifies its third party

- **WHEN** a service adapter succeeds through an operator-declared origin
- **THEN** the result preserves the source URL as `finalUrl`
- **AND** `method: "adapter"`, the adapter route object, and a provenance note identify that origin

### Requirement: GitHub native adapter reads bounded public resources

The built-in `github` adapter SHALL be enabled when `tools.webAdapters` is absent and SHALL match canonical `github.com/{owner}/{repo}`
repository roots and the first-slice paths `/issues/{number}`,
`/pull/{number}`, `/blob/{ref}/{path}`, and `/commit/{sha}`. Owner segments
SHALL match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; repo segments SHALL match
`^[A-Za-z0-9._-]{1,100}$` but SHALL not be `.` or `..`; issue/PR numbers SHALL
match `^[1-9][0-9]{0,9}$`; and commit SHAs SHALL match
`^[0-9a-fA-F]{7,40}$`. A blob ref is the single path segment after `blob/`; refs containing `/` are
unsupported. The ref SHALL be decoded once, be non-empty, not `.` or `..`, and
contain no `/`, `\`, NUL, or control character; it SHALL be passed with
`URLSearchParams` rather than concatenated into the query. Blob path segments SHALL be decoded once
and be non-empty, not `.` or `..`, and contain no `/`, `\`, NUL, or control
character; each segment SHALL be re-encoded with `encodeURIComponent` when
building the API URL. Any shape outside these grammars SHALL be unclaimed. It SHALL use
only `https://api.github.com` and SHALL not follow a GitHub API response to a
different origin with an operator token. The repository root SHALL request
`/repos/{owner}/{repo}/readme` and a blob SHALL request
`/repos/{owner}/{repo}/contents/{path}?ref={ref}`, using
`Accept: application/vnd.github+json` JSON contents objects. The adapter SHALL
base64-decode `content` and render valid UTF-8 file text line-for-line, so
existing `:N-M` selectors address GitHub lines. NUL bytes, invalid UTF-8, an
`encoding` of `none`, empty content for a large file, or a declared size over
the body bound SHALL be a bounded `binary` or `too_large` failure that falls
through; it SHALL never present binary bytes as text. A commit
SHALL request `/repos/{owner}/{repo}/commits/{sha}` and render message, author,
timestamp, and a bounded changed-file summary.

An issue SHALL request `/repos/{owner}/{repo}/issues/{number}` and bounded
pages of `/repos/{owner}/{repo}/issues/{number}/comments`; a pull request
SHALL request `/repos/{owner}/{repo}/pulls/{number}`, bounded pages of
`/repos/{owner}/{repo}/issues/{number}/comments` and
`/repos/{owner}/{repo}/pulls/{number}/comments`, plus
`/repos/{owner}/{repo}/commits/{sha}/check-runs` for a check-runs summary. It
SHALL render base/head, merge state, and bounded review comments grouped by
thread. When a token is configured, the adapter MAY use a fixed code-owned GraphQL
query document with owner, repo, and number variables to POST to
`https://api.github.com/graphql` for `reviewThreads` resolution state. The
GraphQL request SHALL be admitted under both the literal GraphQL endpoint and
the admitted REST pull-request locator for the same owner/repo/number; it
SHALL use POST with a body and SHALL follow no redirect: any 3xx response is
a `status` adapter failure. Without a token it SHALL
use REST data and state that review-thread resolution is unavailable. A
per-call GitHub adapter budget SHALL be no more than eight API requests,
including redirects, bounded comment/review pagination, and the optional
GraphQL POST; omitted pages SHALL be reported
rather than silently presented as complete.

Without a configured token, requests SHALL carry no GitHub credential and
private repositories SHALL not be claimed as readable. An optional operator
token SHALL be interpolated as a secret and sent only to `api.github.com` for
this adapter; it SHALL never be sent to a rewrite, service origin, source
host, or redirected origin. The token is instance-wide authority: every owner
on the instance can address any repository visible to that token. GitHub `429`, or `403` with `x-ratelimit-remaining: 0` or with
`retry-after` (including a secondary limit) SHALL be classified as a rate-limit
failure with reset information when `x-ratelimit-reset` is also available. An
`x-ratelimit-reset` header alone SHALL not classify a response. Rate limits
are not permission errors and are not retried.
Enterprise hosts, writes, Actions, Projects, Discussions, search, and gists
SHALL fall through as unclaimed.

#### Scenario: A public blob preserves source lines

- **WHEN** the model reads `https://github.com/o/r/blob/main/src/a.ts`
- **THEN** the adapter contacts only the admitted `api.github.com` contents endpoint
- **AND** the rendered file text is line-for-line so a trailing `:10-20` selector addresses source lines

#### Scenario: An unauthenticated GitHub read sends no token

- **WHEN** no GitHub token is configured and the model reads a public issue
- **THEN** the API request has no `Authorization` header
- **AND** the result is still eligible for the native adapter

#### Scenario: A token is never sent to another origin

- **WHEN** a token-backed GitHub API response redirects or an adapter chain next considers a service or rewrite origin
- **THEN** no request to that other origin carries the GitHub token
- **AND** the redirected or delegated request is either unauthenticated or disqualified

#### Scenario: An instance token has accepted cross-owner authority

- **WHEN** an operator configures a token that can read private repositories and two different llame owners address repositories
- **THEN** both URLs are evaluated under the token's instance-wide authority
- **AND** the runbook identifies this as operator attestation, not tenant isolation

#### Scenario: Rate limit falls through with a note

- **WHEN** GitHub answers a matched API request with `403` and `x-ratelimit-remaining: 0`, or with `429` and `x-ratelimit-reset: 123`
- **THEN** the adapter records a rate-limit note with the reset information when available
- **AND** it returns no response body and does not retry, allowing the generic ladder to run

#### Scenario: Private content without a token is not claimed

- **WHEN** an unauthenticated GitHub API response does not expose a private repository resource
- **THEN** the adapter falls through without claiming private content
- **AND** no API error body is returned to the model

#### Scenario: Unsupported GitHub shapes fall through

- **WHEN** the source is an Enterprise host, an Actions log, a Project, a Discussion, a search result, a gist, or a write URL
- **THEN** the built-in adapter does not claim it
- **AND** the generic ladder handles the source

#### Scenario: A binary or too-large blob falls through

- **WHEN** the GitHub contents object reports binary bytes, invalid UTF-8, `encoding: "none"`, empty large-file content, or a size above the body bound
- **THEN** the adapter records `binary` or `too_large` and returns no file text
- **AND** the source may continue through another adapter or the generic ladder

#### Scenario: GraphQL is admitted as both endpoint and repository resource

- **WHEN** a token-backed PR read requests review-thread resolution
- **THEN** the REST pull-request locator and the literal `https://api.github.com/graphql` locator are both admitted before the POST
- **AND** the fixed query variables identify the same owner, repository, and number and a 303 is not followed

### Requirement: Telegram native adapter reads one public embed post

The built-in `telegram` adapter SHALL be enabled when `tools.webAdapters` is absent and SHALL pure-match only canonical public
`https://t.me/<channel>/<numeric-post-id>` or `https://telegram.me/<channel>/<numeric-post-id>` locators. The channel SHALL match
`^[A-Za-z][A-Za-z0-9_]{3,31}$` and SHALL not be `s`, `c`, `joinchat`,
`addstickers`, `share`, `proxy`, `socks`, `iv`, `addlist`, or `boost`; the post
id SHALL match `^[1-9][0-9]{0,9}$`; and the query SHALL be empty or only
`single`, never `comment` or `thread`. The locator SHALL not be under `t.me/c/`
and is not a feed, search, comment, or channel listing. It SHALL always request the first-party embed at
`https://t.me/<channel>/<id>?embed=1&mode=tme`, including when the source
host is `telegram.me`, subject to the same derived locator and address
admission as every web request. It SHALL parse the
server-rendered widget into Markdown containing the channel/author, timestamp,
post text, a bounded quoted or forwarded origin when present, and notes for
each media attachment naming its type. It SHALL not fetch media, follow
comment threads, or claim private channels.

A channel URL without one post id, `t.me/s/<channel>`, `t.me/c/<id>/<post>`,
search URL, comment URL, or another shape outside the pure grammar SHALL be
unclaimed and SHALL fall through without a note. A matched embed whose widget contains `tgme_widget_message_error`, lacks an
author, or has neither text nor any media node SHALL be a claimed `empty`
failure with a bounded note before fallthrough. A media-only post with an
author and media node SHALL be rendered with author, date, and media notes. No Bot API token, MTProto user session, or
operator Telegram credential SHALL be introduced by this adapter.

#### Scenario: A public post is parsed from the first-party embed

- **WHEN** the model reads `https://t.me/durov/300`
- **THEN** the adapter requests the first-party embed URL and returns author, timestamp, text, and media notes
- **AND** `finalUrl` remains `https://t.me/durov/300`

#### Scenario: Telegram media is represented without a media request

- **WHEN** the embed contains a photo, video, document, or other media class
- **THEN** the result carries a bounded type note
- **AND** no media URL is fetched

#### Scenario: A media-only post is not empty

- **WHEN** the embed has an author and media node but no text node
- **THEN** the adapter returns author, timestamp, and media notes
- **AND** it does not record an `empty` failure

#### Scenario: Private t.me/c URLs are not claimed

- **WHEN** the model reads `https://t.me/c/123/300`
- **THEN** the Telegram adapter does not claim the locator
- **AND** no Telegram credential or private-channel request is issued

#### Scenario: Feeds and comments fall through

- **WHEN** the locator names `t.me/s/channel`, a channel root, a search, or a linked discussion comment
- **THEN** the single-post adapter does not claim it
- **AND** the generic ladder may render the source

#### Scenario: A missing public post is a claimed empty failure

- **WHEN** a matched post URL returns a Telegram widget with `tgme_widget_message_error`, no author, or neither text nor any media node
- **THEN** the adapter records an `empty` note and returns no body
- **AND** the source may continue through another adapter or the generic ladder

#### Scenario: A private or feed shape is unclaimed without a note

- **WHEN** the source uses `t.me/c/...`, `t.me/s/...`, a reserved channel segment, or a `comment`/`thread` query
- **THEN** the Telegram adapter does not claim it and makes no embed request
- **AND** generic fallthrough has no Telegram adapter failure note

### Requirement: FxEmbed service protocol is opt-in and source-preserving

A configured `fxembed` entry SHALL match only canonical status URLs on
`x.com`, `twitter.com`, `www.x.com`, `www.twitter.com`, `mobile.x.com`, or
`mobile.twitter.com`. It SHALL accept `/{user}/status/{id}`, `/i/status/{id}`,
or `/i/web/status/{id}` (with an optional trailing `/photo/N` ignored), where
`{user}` matches `^[A-Za-z0-9_]{1,15}$` when present and `{id}` matches
`^[1-9][0-9]{0,19}$` (status ids are 64-bit snowflakes of up to 20 digits). The entry SHALL use its required operator-declared
HTTPS base URL reduced at boot to a base origin and construct the target with
`new URL(`/status/${id}`, baseOrigin)`, producing
`https://api.fxtwitter.com/status/20`, with no path traversal or source-origin
credential. A successful JSON response with a status code and a tweet object
SHALL render the source post's author, timestamp, text, quoted post when
present, and bounded media notes. The result SHALL name the x.com source as
`finalUrl`, set `method: "adapter"`, and record the configured service origin.
FxEmbed's status response does not provide a reply thread; the result SHALL
state that limitation rather than inventing replies.

The service origin, optional interpolated headers, and any service response
SHALL be subject to adapter-derived permission and address admission. The
adapter SHALL be off unless an operator declares it; an absent web-adapter
setting SHALL not contact FxEmbed or any other third party.

#### Scenario: FxEmbed maps a public status

- **WHEN** `fxembed` is declared for `https://x.com/jack/status/20` and its protocol returns the observed `code: 200` tweet object
- **THEN** the result renders `jack`, the timestamp, and `just setting up my twttr`
- **AND** `finalUrl` is the x.com URL while the adapter object identifies the configured FxEmbed origin

#### Scenario: FxEmbed does not fake replies

- **WHEN** the FxEmbed response contains no reply thread
- **THEN** the result states that the service response has no reply-thread data
- **AND** it does not request an unbounded second service or pretend replies were read

#### Scenario: FxEmbed is not contacted unless declared

- **WHEN** the source is an x.com status and `tools.webAdapters` is absent or contains only built-ins
- **THEN** no request reaches an FxEmbed origin
- **AND** the generic ladder may run after built-in adapters

### Requirement: Operator rewrite adapters are validated and opt-in

A `rewrite` adapter entry SHALL be enabled only when an operator declares it.
Its match SHALL contain an exact canonical host list and an optional bounded
path regular expression. Its target SHALL have a literal `http` or `https`
scheme, host, and optional port with no placeholder, userinfo, or fragment; a
literal query is allowed. Placeholders SHALL occur only after that literal
origin, with `{path}` allowed only in the target path. Boot validation SHALL
replace them with sentinels and record that literal origin and literal
target-path prefix. It SHALL reject an unknown placeholder, malformed template,
non-http(s) target, userinfo, or a template that cannot produce a valid target
with bounded sentinel values. The supported placeholders SHALL be `{host}`,
`{path}`, `{query}`, and `{url}`. `{host}`, `{query}`, and `{url}` SHALL each
be `encodeURIComponent` of their canonical source values wherever they appear
after the origin; `{path}` SHALL be the canonical source path verbatim,
preserving its existing percent escapes and leading `/`. Every produced target SHALL be re-parsed per call and
its origin SHALL equal the declared literal origin and its path SHALL start
with the declared literal target-path prefix. A target SHALL be admitted and
address-pinned before it is requested.

After the target is fetched once, the rewrite SHALL apply only the local
negotiated Markdown/text stages or the Readability render with its quality
gate; it SHALL issue no alternate, suffix, or `llms.txt` probes. Redirects of
that target count as adapter requests and the adapter budget, and configured
headers are sent only on the initial target request. A rendered body that
passes the applicable gate is success; a raw/challenge/failed render is an
`empty` adapter failure and falls through. The rewrite SHALL preserve the
source URL as `finalUrl`. The result SHALL set `method: "adapter"`, identify
route `rewrite`, and note that the operator-configured target received the
source-derived request. Optional
interpolated headers are secrets and SHALL be sent only to the declared target
origin, never across an origin-changing redirect. Operators SHALL treat a
rewrite as an explicit exfiltration decision because source path and query
text may be model-chosen and fetched content may attempt to influence the
next call; the read permission and address admission remain mandatory.

#### Scenario: A declared rewrite renders an x.com source

- **WHEN** an operator declares a rewrite matching `x.com` status paths with target `https://x.pcstyle.dev{path}`
- **THEN** the target is fetched only after its derived admission and address check
- **AND** the local negotiated/text or Readability stages render the response while `finalUrl` remains the x.com source

#### Scenario: A rewrite is off by default

- **WHEN** an x.com status matches no declared rewrite
- **THEN** no rewrite target is contacted
- **AND** the source falls through to other enabled adapters or the generic ladder

#### Scenario: Userinfo and non-web targets fail boot

- **WHEN** a rewrite target template produces `https://user:secret@example.test/{path}`, `file:///tmp/{path}`, or another malformed/non-http(s) URL under validation
- **THEN** startup fails naming the adapter entry and target field
- **AND** the instance does not start with the invalid rewrite enabled

#### Scenario: Placeholder data cannot inject target syntax

- **WHEN** the source is `https://x.com/a&admin=1` or its path/query contains `@`, `#`, `?`, or URL delimiter text
- **THEN** placeholder encoding keeps it data in the configured target position
- **AND** it cannot create target userinfo, a new scheme, or an unvalidated host

#### Scenario: A rewrite credential is origin-scoped

- **WHEN** a rewrite has an interpolated header and its target redirects to another origin
- **THEN** the header is removed before the redirected request
- **AND** the header value is absent from result notes, errors, and model-visible content

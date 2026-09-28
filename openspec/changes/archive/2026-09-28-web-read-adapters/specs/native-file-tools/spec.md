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
consider the ordered, code-owned web adapters before the generic HTML and text
ladder. A matching adapter SHALL be selected without network I/O. `:raw` SHALL
bypass every adapter and retain the raw-response behavior below. An adapter SHALL
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
present) on the first request, or on a
redirect hop, SHALL fail the call with `http_status` naming the status; a 429
SHALL additionally carry the `Retry-After` value when the response supplies
one. A status error SHALL NOT return the response body and SHALL NOT report
response headers other than that `Retry-After` delay. A redirect answer to a
probe request SHALL be followed under the shared redirect rules before any
terminal status is judged. An adapter request or its redirect chain whose
status, content type, or transport fails SHALL disqualify that adapter without
failing the call. Adapter requests share the 30-second call deadline, 5 MiB
per-response bound, and 20-hop redirect bound; the rendered adapter document
SHALL also be capped at 5 MiB, with no separate adapter request-count cap. A
probe request (an
alternate, a suffix candidate, or an `llms.txt` candidate) whose terminal
response answers a non-2xx status, or a refused content type, or which fails
on a bound of its own (a headers timeout, an oversized body, a transport
failure, or a redirect it cannot follow), SHALL disqualify only that
candidate, and the pipeline SHALL continue; a probe that exhausts the call's
deadline or its redirect budget SHALL fail the call, while a refusal inside
a probe's own redirect chain disqualifies only that candidate, as a refused
probe locator does. A
call SHALL issue at most one alternate request, one suffix-probe request,
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

### Requirement: Web HTML reads prefer publisher Markdown

The generic ladder begins only after matching adapters produce no result.

The first request for a page SHALL send `Accept: text/markdown,
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
a suffix candidate, an `llms.txt` candidate, or a redirect hop, SHALL be
evaluated against the `read` permission group before its request through
the same evaluator and the same projection the call used, as if the model
had submitted it; a rejected probe locator, or a rejected hop inside a
probe's own redirect chain, SHALL disqualify that candidate without failing
the call and its decision SHALL be recorded like a hop decision, so a hostile
page cannot make a read of itself fail by announcing a refused alternate. A probe request SHALL send the same `Accept` header and
SHALL count against the call's total time, body, request, and redirect
bounds; a failure of its own disqualifies the
candidate without failing the call, while a spent call bound fails it. A candidate that fails the gate SHALL
NOT become the content, and a fetched candidate SHALL NOT be searched for
further alternates
or suffixes.
An adapter request is also a derived locator and SHALL use the same admission,
address, and shared-bound checks before it is issued.

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
`+json` or `+xml` suffix. `text/markdown` SHALL be handled as Markdown. Every
other content type SHALL fail with `unsupported_content_type` naming the
received type, and its body SHALL NOT be returned as content. An adapter
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

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and non-credential headers as the first. The submitted source request and
generic probes SHALL send no cookie, `Authorization`, or other credential. The
GitHub adapter MAY send its token only to `https://api.github.com` and a
same-origin API hop; it SHALL be removed before any cross-origin hop. The hop
locator SHALL be the `Location` value
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
used. A rejected hop on the call's own request chain SHALL end the call with
a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. A rejected hop inside a
probe's own redirect chain SHALL disqualify that candidate instead, under the
adapter rule, so a page cannot end a read of itself through a redirect it
announced. A rejected hop inside an adapter chain SHALL disqualify that adapter.
When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the
response that produced the content as `finalUrl` and SHALL NOT enumerate the
hop chain: when a publisher-Markdown probe won, that is the probe's own
final URL, including any redirect it followed, rather than the page's. An
adapter result instead reports its source URL as `finalUrl`.
The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. A hop admitted on its text
SHALL then connect only to the addresses the address-admission requirement
admits; a hop whose every address is refused SHALL end the call on the call's
own request chain and disqualify only the candidate on a probe's chain or the
adapter on an adapter chain, as that requirement states.

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

### Requirement: Web reads connect only to addresses the read group admits

Before each request a web read issues (the submitted locator, a redirect hop,
an announced alternate, a suffix candidate, or an `llms.txt` candidate) and
after that locator's own text is admitted, the tool SHALL determine the
addresses the request may connect to. An adapter request SHALL use this same
address resolution and pinning before it is issued. A host that is an IP literal SHALL be its
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
that candidate SHALL be disqualified. An adapter chain whose addresses are
all refused SHALL disqualify only that adapter. No result, message, or note SHALL carry
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

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, `raw`, or
`adapter`, and SHALL name the ladder stage or adapter that produced the returned content.
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
truncating content. A web read SHALL NOT carry `realPath`. A selector read of
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

- **WHEN** a declared rewrite entry renders `https://x.com/jack/status/20` through `https://x.pcstyle.dev`
- **THEN** the result has `method: "adapter"`, `finalUrl: "https://x.com/jack/status/20"`, and an adapter object with route `rewrite` and origin `https://x.pcstyle.dev`
- **AND** its notes state that the content came through the configured origin

## ADDED Requirements

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
bypass every adapter.

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
provenance requirement, including the source URL as `finalUrl`. A successful
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

### Requirement: GitHub native adapter reads issues and pull requests

A configured `github` adapter SHALL claim canonical `github.com/{owner}/{repo}/issues/{number}`
and `github.com/{owner}/{repo}/pull/{number}` locators. Owner segments SHALL
match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; repo segments SHALL match
`^[A-Za-z0-9._-]{1,100}$` and SHALL not be `.` or `..`; numbers SHALL match
`^[1-9][0-9]{0,9}$`. `/pull/{number}.diff`, `/pull/{number}.patch`,
`/pull/{number}/files`, `/pull/{number}/commits`, `/pull/{number}/checks`,
the `/issues` and `/pulls` lists, Actions, Projects, Discussions, search,
gists, `raw.githubusercontent.com`, Enterprise hosts, and every write URL
SHALL be unclaimed. The adapter SHALL use only `GET` requests to
`https://api.github.com` with `Accept: application/vnd.github+json`.

An issue SHALL request `/repos/{owner}/{repo}/issues/{number}` and every
page of `/repos/{owner}/{repo}/issues/{number}/comments`. A pull request
SHALL request `/repos/{owner}/{repo}/pulls/{number}` and every page of
`/repos/{owner}/{repo}/issues/{number}/comments`,
`/repos/{owner}/{repo}/pulls/{number}/reviews`,
`/repos/{owner}/{repo}/pulls/{number}/comments`, and
`/repos/{owner}/{repo}/pulls/{number}/files`, and every page of
`/repos/{owner}/{repo}/commits/{head_sha}/check-runs` requested with
`filter=latest&per_page=100`. The whole document
SHALL be loaded before rendering, subject to the shared call deadline and the
5 MiB document bound; the model SHALL page the rendered text with the ordinary
`:N-M` selector, and each read SHALL refetch.

The issue view SHALL render `# Issue #{number}: {title}`, then the lines
`State`, `State reason` (when present), `Author`, `Created`, `Updated`,
`Labels`, and `URL`, then `## Body` with the body or `No description
provided.`, then `## Comments ({n})`. The pull request view SHALL render
`# Pull Request #{number}: {title}`, then `State`, `Draft`, `Author`, `Base`,
`Head`, `Reviews` as latest-per-reviewer counts (for example
`Reviews: 2 approved, 1 changes requested (latest per reviewer)`),
`Merge state` as the `mergeable_state` value returned, including `unknown`,
`Checks:` as counts from all check-runs pages requested with
`filter=latest&per_page=100` (for example
`Checks: 14 passed, 1 failed (lint), 2 pending`); the counts cover what the
endpoint returns, which GitHub limits to the 1000 most recent check suites.
If a check-runs page after the first does not arrive, the `Checks:` line
SHALL state the loaded counts plus `total_count` minus the loaded runs as
`{n} not loaded` (for example
`Checks: 97 passed, 1 failed (lint), 2 pending, 40 not loaded`); if the first
check-runs page does not arrive, the line SHALL render as
`Checks: unavailable`. A page that answers but cannot be parsed, or a first
page without a numeric `total_count`, SHALL count as not arriving. Either case
SHALL add an omission note naming check runs and its failure category. Then `Created`,
`Updated`, `Labels`, `URL`, and `Diff: https://github.com/{owner}/{repo}/pull/{number}.diff`,
then `## Body`, `## Files ({n})` listing every changed file with its status
and added/deleted counts, `## Reviews ({n})`, `## Review Comments ({n})`, and
`## Comments ({n})`. Every comment, review, and review comment SHALL be one
`### {author} · {timestamp}` heading at the same depth in source order,
followed by `ID`, `Reply to` (when the item answers another), `Location
{path}:{line}` and `Side` (review comments), `State` (reviews, the review's
own state such as `APPROVED`), and `URL` lines, then the body.
No `Review decision` line, patch text, or event timeline SHALL be rendered;
minimized comments SHALL render like any other comment.

Without a configured token, requests SHALL carry no credential and private
repositories SHALL not be claimed as readable. An optional operator token
SHALL be interpolated as a secret and sent only to `api.github.com`; it SHALL
never be sent to a rewrite target, a source host, or a redirected origin. The
token is instance-wide authority: every owner on the instance can address any
repository visible to that token. `429`, or `403` with
`x-ratelimit-remaining: 0` or with `retry-after`, SHALL be classified as
`rate_limit` with reset information when `x-ratelimit-reset` is also
available; `x-ratelimit-reset` alone SHALL not classify a response. Rate
limits are not permission errors and SHALL not be retried.

#### Scenario: An issue renders in the fixed layout with every comment

- **WHEN** the model reads `https://github.com/o/r/issues/12` and the issue has 230 comments
- **THEN** the adapter requests the issue and all three comment pages
- **AND** the rendered text has the title line, the metadata lines, `## Body`, and `## Comments (230)` with one `###` item per comment carrying `ID` and `URL`

#### Scenario: A pull request view carries Reviews, Checks, and Diff lines

- **WHEN** the model reads `https://github.com/o/r/pull/12`
- **THEN** the metadata block has `Reviews:` counts per latest review,
  `Merge state` as returned, `Checks:` counts from all check-runs pages
  requested with `filter=latest&per_page=100`, and `Diff: https://github.com/o/r/pull/12.diff`
- **AND** the `## Review Comments` items carry `Reply to` and `Location` lines
  instead of nested headings

#### Scenario: An unauthenticated GitHub read sends no token

- **WHEN** no GitHub token is configured and the model reads a public issue
- **THEN** the API request has no `Authorization` header
- **AND** the result is still eligible for the native adapter

#### Scenario: A token is never sent to another origin

- **WHEN** a token-backed GitHub API response redirects to another origin or a rewrite entry is next considered
- **THEN** no request to that other origin carries the GitHub token
- **AND** the redirected or rewrite request is either unauthenticated or disqualified

#### Scenario: An instance token has accepted cross-owner authority

- **WHEN** an operator configures a token that can read private repositories and two different llame owners address repositories
- **THEN** both URLs are evaluated under the token's instance-wide authority
- **AND** the runbook identifies this as operator attestation, not tenant isolation

#### Scenario: Rate limit falls through with a note

- **WHEN** GitHub answers a claimed primary request with `403` and `x-ratelimit-remaining: 0`, or with `429` and `x-ratelimit-reset: 123`
- **THEN** the adapter records a `rate_limit` note with the reset information when available
- **AND** it returns no response body and does not retry, allowing the generic ladder to run

#### Scenario: A secondary page failure renders a partial pull request

- **WHEN** the pull request request succeeded and the third review-comment page answers `403` with `x-ratelimit-remaining: 0`
- **THEN** the metadata, body, files, reviews, loaded review comments, and comments are rendered
- **AND** a note states that review comments were omitted with `rate_limit` and the reset time

#### Scenario: Check runs load every page and report an unloaded remainder

- **WHEN** a pull request's check-runs `total_count` is 140 at
  `filter=latest&per_page=100` and the second check-runs page fails after the
  first arrives
- **THEN** both check-runs pages are requested and the 100 loaded runs are
  counted
- **AND** the `Checks:` line ends with `40 not loaded` and an omission note
  names check runs

#### Scenario: A failed first check-runs page renders the line as unavailable

- **WHEN** the pull request request succeeds and the first check-runs page
  fails
- **THEN** the pull request renders with `Checks: unavailable`, never with
  invented zero counts
- **AND** an omission note names check runs and the failure category

#### Scenario: An unparsable check-runs page counts as not arriving

- **WHEN** the first check-runs page answers `200` without a numeric
  `total_count`, or a later check-runs page answers `200` with a body that
  cannot be parsed
- **THEN** the first case renders `Checks: unavailable` and the second renders
  the loaded counts plus the `total_count` remainder from the first page
- **AND** the omission note names check runs with the `parse` category

#### Scenario: Private content without a token is not claimed

- **WHEN** an unauthenticated GitHub API response does not expose a private repository resource
- **THEN** the adapter falls through without claiming private content
- **AND** no API error body is returned to the model

#### Scenario: Unsupported GitHub shapes are unclaimed

- **WHEN** the source is `/pull/12.diff`, `/pull/12/files`, an `/issues` or `/pulls` list, an Actions log, a Project, a Discussion, a search result, a gist, an Enterprise host, or a write URL
- **THEN** the adapter does not claim it and issues no request and no note
- **AND** the generic ladder handles the source exactly as before

### Requirement: GitHub native adapter reads repository code

A configured `github` adapter SHALL claim canonical
`github.com/{owner}/{repo}` repository roots, `/tree/{ref}[/{path}]`,
`/blob/{ref}/{path}`, and `/commit/{sha}` locators, with the owner and repo
grammars above and commit SHAs matching `^[0-9a-fA-F]{7,40}$`. Ref and path
segments SHALL be decoded once, SHALL be non-empty, not `.` or `..`, and free
of `\`, NUL, and control characters, and SHALL be re-encoded with
`encodeURIComponent` when building an API URL. Every request SHALL be a `GET`
to `https://api.github.com`; `raw.githubusercontent.com` SHALL never be
requested.

A blob SHALL request `/repos/{owner}/{repo}/contents/{path}?ref={ref}` with
the ref passed through `URLSearchParams`, base64-decode `content`, and render
valid UTF-8 text line-for-line without a heading, so `:N-M` addresses source
lines. NUL bytes, invalid UTF-8, an `encoding` of `none`, empty content for a
large file, or a declared size over the body bound SHALL be a `binary` or
`too_large` failure that falls through; binary bytes SHALL never be presented
as text. A commit SHALL request `/repos/{owner}/{repo}/commits/{sha}` and
render message, author, timestamp, the changed files with their status and
counts, loaded in pages of 100 until a short page; GitHub lists at most 3,000
files for a commit, so a list that reaches 3,000 files SHALL carry the note
`files omitted: too_large` marking it as possibly incomplete. The rendered
commit is paged with `:N-M` like any adapter document. The view SHALL also render `Diff: https://github.com/{owner}/{repo}/commit/{sha}.diff`; it
SHALL NOT render patches.

A directory SHALL request one
`/repos/{owner}/{repo}/git/trees/{ref}:{path}?recursive=1` (the root:
`/repos/{owner}/{repo}/git/trees/{ref}?recursive=1`), filter the result to
the requested level and one child level, and render the host directory
listing shape: the requested level, then each child directory's first 20
entries in order followed by `… N more`, with the same `… N entries`,
truncation, and range-selector rules as a host directory read. A response
over 5 MiB SHALL be `too_large` and fall through. A non-root directory whose
requested level exceeds the host per-directory entry budget SHALL end the
call with the host's `directory_too_large` error, exactly as a host directory
read does; that is a directory-read outcome, not an adapter failure, and it
does not fall through. A symlink entry (mode
`120000`) SHALL render with the host symlink marker as `- name@`, and a
submodule entry (mode `160000`) with the host special marker as `- name?`.
The repository root SHALL
additionally request `/repos/{owner}/{repo}` and render `Description`,
`Default branch`, `Visibility`, and `Language` lines before the listing, then
`## README` with the decoded `/repos/{owner}/{repo}/readme` content. When the
root's top-level entries exceed the host listing's per-directory entry budget
(the same count a host directory read bounds; child-level samples do not
count), the root SHALL render its metadata and README without the listing and
carry the section omission note `tree omitted: too_large`; this is a
render-time omission note, not an adapter failure, and nothing falls through.

Because a locator does not mark where a ref ends, the adapter SHALL try the
first segment after `tree/` or `blob/` as the ref. On a `404` with segments
remaining, it SHALL request `/repos/{owner}/{repo}/git/matching-refs/heads/{segment}`
and, when that yields no acceptable candidate, `/git/matching-refs/tags/{segment}`;
a candidate is acceptable only when it equals the remaining locator text or
is followed by `/` in it; the longest acceptable candidate SHALL be used and
the contents or tree request retried. A 40-character hexadecimal first
segment SHALL be treated as a SHA without a lookup. A `404` with nothing left
to split SHALL be a `status` failure.

#### Scenario: A public blob preserves source lines

- **WHEN** the model reads `https://github.com/o/r/blob/main/src/a.ts`
- **THEN** the adapter contacts only the admitted `api.github.com` contents endpoint, once
- **AND** the rendered file text is line-for-line so a trailing `:10-20` selector addresses source lines

#### Scenario: A binary or too-large blob falls through

- **WHEN** the GitHub contents object reports binary bytes, invalid UTF-8, `encoding: "none"`, empty large-file content, or a size above the body bound
- **THEN** the adapter records `binary` or `too_large` and returns no file text
- **AND** the source may continue through the generic ladder

#### Scenario: A branch containing a slash resolves through matching refs

- **WHEN** the model reads `https://github.com/o/r/blob/feature/foo/src/a.ts` and `feature/foo` is a branch
- **THEN** the contents request for ref `feature` answers `404`, `matching-refs/heads/feature` returns `refs/heads/feature/foo`, and the contents request is retried with `ref=feature/foo` and path `src/a.ts`
- **AND** a candidate such as `feature-old` is not accepted because it is not followed by `/` in the locator

#### Scenario: A tag shadowing a branch returns the tag's file

- **WHEN** tag `v1` and branch `v1/x` both contain `x/README.md` and the model reads `/blob/v1/x/README.md`
- **THEN** the first contents request at ref `v1` succeeds and the tag's file is returned
- **AND** this documented limit is not treated as an error

#### Scenario: A directory renders as a two-level listing

- **WHEN** the model reads `https://github.com/o/r/tree/main/apps`
- **THEN** one recursive tree request is issued and the listing shows the `apps` entries and each child directory's first 20 entries followed by `… N more`
- **AND** a `:1-10` selector and the result truncation behave as on a host directory

#### Scenario: Symlinks and submodules keep host markers

- **WHEN** a recursive tree response has entries of mode `120000` and `160000`
- **THEN** the symlink renders as `- name@` and the submodule as `- name?`
- **AND** neither renders as a plain file line

#### Scenario: An over-budget directory ends like a host directory

- **WHEN** `https://github.com/o/r/tree/main/big` has more top-level entries
  than the host per-directory entry budget and its tree response is under 5 MiB
- **THEN** the call ends with `directory_too_large`, as a host directory read
  over the budget does
- **AND** no fall-through to the generic ladder occurs

#### Scenario: An over-budget root omits only its listing

- **WHEN** a repository root has more top-level entries than the host
  per-directory entry budget
- **THEN** the metadata lines and `## README` render
- **AND** the listing is replaced by the omission note `tree omitted: too_large`
  and no fall-through occurs

#### Scenario: A repository root renders metadata, listing, and README

- **WHEN** the model reads `https://github.com/o/r`
- **THEN** the repository, tree, and readme endpoints are each requested once
- **AND** the text has `Description`, `Default branch`, `Visibility`, and `Language` lines, the two-level root listing, and `## README`

#### Scenario: A commit renders a summary with a Diff line

- **WHEN** the model reads `https://github.com/o/r/commit/c91b31c0`
- **THEN** the text has the message, author, timestamp, and each changed file with counts, up to 3,000 files
- **AND** `Diff: https://github.com/o/r/commit/c91b31c0.diff` is present and no patch text is rendered

#### Scenario: A commit at GitHub's file limit is marked

- **WHEN** a commit's file pages reach 3,000 files
- **THEN** all loaded files are rendered with counts and the view is paged with `:N-M`
- **AND** the note `files omitted: too_large` marks the list as possibly incomplete

### Requirement: Operator rewrite adapters are validated and opt-in

A `rewrite` adapter entry SHALL be enabled only when an operator declares it.
Its `hosts` SHALL be exact canonical host matches. Its optional
`pathPattern` SHALL be an RE2-compatible regular expression compiled by the
same bounded matcher `tools.permissions` uses, searched unanchored against
the canonical path. Its `target` SHALL be a literal `http` or `https` origin
containing no placeholder, userinfo, or fragment, followed by a path/query
template in which only `{path}` and `{query}` occur: `{path}` is allowed only
in the path and inserts the canonical source path as-is; `{query}` inserts
`encodeURIComponent` of the canonical query without its `?`. Boot SHALL
reject any other placeholder, a placeholder in the scheme, host, or port,
`{path}` in the query, a
non-http(s) target, userinfo, a fragment, a malformed template, or an invalid,
oversized, or unsupported `pathPattern`. Per call the target SHALL be rebuilt
from the template, revalidated against the declared origin and literal path
prefix, admitted, and address-pinned, then fetched once through the
negotiated/text or Readability stages only; no alternate, suffix, or
`llms.txt` probe SHALL run,
and a raw, challenge, or failed render SHALL fall through. The result SHALL
keep the source URL as `finalUrl`, report `method: "adapter"` with route
`rewrite` and the declared origin, and note that content came through the
configured origin. The runbook example SHALL be
`https://x.pcstyle.dev{path}` for `x.com` and `twitter.com` status paths,
and SHALL state that the source path reaches that origin.

#### Scenario: A declared rewrite renders an x.com source

- **WHEN** a rewrite with hosts `x.com` and `twitter.com` and target `https://x.pcstyle.dev{path}` is declared and the model reads `https://x.com/jack/status/20`
- **THEN** `https://x.pcstyle.dev/jack/status/20` is admitted and address-pinned before one fetch through the local stages
- **AND** the result keeps `https://x.com/jack/status/20` as `finalUrl` and names `https://x.pcstyle.dev`

#### Scenario: A rewrite is off unless declared

- **WHEN** no rewrite entry matches a source host
- **THEN** no rewrite target is contacted
- **AND** other configured adapters or the generic ladder may run

#### Scenario: Placeholder data cannot alter the target shape

- **WHEN** the source is `https://x.com/a&admin=1` or its query contains `/`, `?`, `#`, or `@`
- **THEN** the rebuilt target keeps the declared origin and literal path prefix and the inserted text remains data
- **AND** a rebuilt target that leaves the declared origin is refused before any request

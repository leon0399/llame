## MODIFIED Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and execute them with the trusted host process's OS authority in this alpha
capability, and SHALL accept `kb://` locators under the Knowledge locator
requirement. `read` SHALL additionally accept read-only skill locators under
the Skill locator requirement and read-only web locators under the Web locator
requirements. The scheme of the `path` argument SHALL select the authority; no
other argument or persisted declaration field SHALL. A web locator SHALL be
fetched by the API process's own outbound HTTP and SHALL NOT require or bind a
native executor identity. `edit` and `write` SHALL operate only on regular
files, and both SHALL reject an `http://` or `https://` locator with
`invalid_path` before any request. `read` SHALL operate on regular files and
directories, and a web locator SHALL be governed by the Web locator
requirements instead of by entry kind; every other entry kind SHALL fail. A
`read` that misses a regular file SHALL offer bounded sibling-name
suggestions from its existing parent directory on every scheme that resolves a
local directory, names only,
with one bounded directory read and bounded scoring work on the error path
and none on success; an absolute-path miss SHALL follow a symbolic-link
parent exactly as the read itself follows links. A web locator SHALL NOT
produce sibling suggestions, because a failed web read has no directory to
list. A trailing path separator SHALL be accepted on a directory path and
SHALL fail as `not_found` on any other target; in a web locator a trailing
separator SHALL remain part of the URL and SHALL NOT be read as a directory
request. A model argument SHALL NOT select a different
executor, owner, tenant, permission mode, or remote authority. `edit` and
`write` SHALL be advertised when the process has accepted native host
authority or has a configured Knowledge root. `read` SHALL be eligible for
advertisement whenever `tools.allowed` names it, because skill and web
locators need no host authority; that eligibility SHALL NOT admit
absolute-path host access, and an absolute path on a
process without accepted native authority SHALL fail closed with
`executor_unavailable` rather than resolving through a hosted, Knowledge, or
Sandbox path. A Run
SHALL bind to the trusted native executor identity on its first absolute-path
operation, including `read`, and SHALL remain bound to it; a `kb://` or web
operation SHALL NOT bind or require an executor identity; a later reattachment
to another executor SHALL fail closed rather than resolving the physical path
there.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path
- **THEN** the native host reads that file using its OS authority
- **AND** the result identifies the absolute path and does not invent a Knowledge Space binding

#### Scenario: Absolute path without accepted native authority fails closed

- **WHEN** the process has a configured Knowledge root and no `tools.nativeExecutorId`, and the model calls `read` with an absolute path
- **THEN** the tool returns `executor_unavailable`
- **AND** it does not resolve the path through the Knowledge root or any other authority

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing entry, or a device, socket, FIFO, or other special entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or invoke another executor

#### Scenario: A missed read suggests sibling names

- **WHEN** `read` targets a missing regular file, named without a trailing separator, whose parent directory exists, on any scheme that resolves a local directory
- **THEN** the `not_found` result also lists at most five entry names from that directory that score as plausible spellings of the requested name, as bare names without any path
- **AND** a miss with no plausible sibling, a trailing separator, or scoring work past its bound returns the bare `not_found`, and the suggestion list is never produced for `edit` or `write`

#### Scenario: A missed read under a missing parent says so

- **WHEN** `read` targets a path whose parent directory does not exist
- **THEN** the `not_found` result states that the parent directory is missing
- **AND** no entry of any other directory is listed

#### Scenario: Mutation on a directory fails

- **WHEN** `edit` or `write` targets an existing directory
- **THEN** the tool returns the `not_regular_file` error
- **AND** it does not create, rename, or modify any entry

#### Scenario: Trailing separator on a file fails

- **WHEN** `read` targets an existing regular file with a trailing path separator
- **THEN** the tool returns `not_found`
- **AND** it does not read the file

#### Scenario: Physical path is bound to one executor

- **WHEN** a later worker or host tries to continue a native Run with a different trusted executor identity
- **THEN** the native tool returns an executor-unavailable error
- **AND** it does not resolve the absolute path on the new host

#### Scenario: A web locator is read without host authority

- **WHEN** a process with neither accepted native host authority nor a configured Knowledge root allowlists `read`, and the model calls `read` with `https://example.test/guide`
- **THEN** `read` is advertised, the API process fetches the URL, and the page content is returned
- **AND** the read does not return `executor_unavailable` and binds no native executor identity, while an absolute path on the same process still returns `executor_unavailable` and `edit` and `write` are not advertised

#### Scenario: Mutation on a web locator fails before any request

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** the tool returns `invalid_path`
- **AND** no request is issued and no local entry is created, renamed, or modified

#### Scenario: A failed web read suggests no siblings

- **WHEN** `read` targets `https://example.test/missing` and the server answers 404
- **THEN** the error names the status and lists no sibling names
- **AND** no directory is read to produce suggestions

## ADDED Requirements

### Requirement: Web locators are fetched by the native read tool

The native `read` tool SHALL accept an absolute `http://` or `https://`
locator as its `path` and SHALL fetch it with the API process's own outbound
HTTP. No other web scheme SHALL be admitted, and `edit` and `write` SHALL
reject a web locator with `invalid_path` before any request. A submitted web
locator, after its selector is split off, SHALL be its own WHATWG URL
serialization: a locator whose `href` differs from the submitted text
(uppercase scheme or host, a percent-encoded or Unicode host, an explicit
default port, an empty path, or unencoded path or query characters) SHALL
fail with `invalid_path` before any request, and the error SHALL name the
canonical spelling so the model can resubmit it. Policy therefore matches
the same text the request uses, and every derived locator is canonical by
construction. A locator carrying userinfo SHALL fail with `invalid_path`
before any request, so the tool never sends credentials the model embedded
in a URL. Availability and
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
rest. A selector SHALL be split only from a locator that carries no `?` and
no `#`, so a colon inside a query or a fragment is part of the URL and never
a selector (`https://example.test/search?at=2026:10` is fetched as written).
A locator whose authority ends in a port SHALL therefore carry a path
after the port (`https://example.test:8080/` is a URL with no selector, while
`https://example.test:8080` reads the port as a selector and leaves the
empty-path locator `https://example.test`, which fails as `invalid_path`
rather than selecting a line),
and a literal colon in the last path segment of a query-free locator SHALL be
written as `%3A` (`https://w.example/wiki/Special%3ASearch`), because a
trailing suffix that is present but outside the grammar fails as
`invalid_selector`: `https://w.example/wiki/Special:Search` and
`https://w.example/docs/2024:10` both do, while
`https://w.example/docs/2024:10-20` selects lines 10 through 20.

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

#### Scenario: A noncanonical locator is refused before policy can be bypassed

- **WHEN** the model reads `https://g%72okipedia.com/page`, `HTTPS://Example.test/guide`, or `https://example.test:443/guide`
- **THEN** the read returns `invalid_path` naming the canonical spelling (`https://grokipedia.com/page`, `https://example.test/guide`) and issues no request
- **AND** a reject clause written against the canonical spelling cannot be evaded by an encoded, uppercase, or default-port variant

#### Scenario: Userinfo in a locator fails closed

- **WHEN** the model reads `https://user:secret@example.test/guide`
- **THEN** the read returns `invalid_path` before any request
- **AND** no credential from the locator is sent to the host

#### Scenario: A colon in the last path segment is a selector unless encoded

- **WHEN** the model reads `https://w.example/wiki/Special:Search`
- **THEN** the read fails with `invalid_selector` and issues no request
- **AND** `https://w.example/wiki/Special%3ASearch` is fetched as written

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
terminal status is judged. A probe request (an
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

### Requirement: Web reads accept text bodies only

A web read SHALL accept only text bodies: `text/*` media types,
`application/json`, `application/xml`, and any type whose subtype carries a
`+json` or `+xml` suffix. `text/markdown` SHALL be handled as Markdown. Every
other content type SHALL fail with `unsupported_content_type` naming the
received type, and its body SHALL NOT be returned as content. A `text/plain`
body that is HTML-shaped SHALL follow the HTML path rather than being returned
as plain text. A non-HTML text body SHALL be returned as the content
unchanged. Text SHALL be decoded with the charset from the `Content-Type`
parameter when present, else with a `<meta charset>` declaration found in the
first 2 KiB of the body, else as UTF-8.

#### Scenario: A JSON body is returned as text

- **WHEN** a locator serves `application/json`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** a first response that is `text/plain` and not HTML-shaped is returned unchanged with `method` `negotiated`

#### Scenario: A binary body is refused with its type named

- **WHEN** a locator serves `application/pdf` or `image/png`
- **THEN** the read fails with `unsupported_content_type` naming that type
- **AND** no conversion or extraction is attempted

#### Scenario: HTML served as text/plain is rendered

- **WHEN** a response declares `text/plain` and its body is an HTML document
- **THEN** the body follows the HTML path instead of being returned as plain text

#### Scenario: A declared charset is honored

- **WHEN** a response declares `charset=iso-8859-1` and its body contains bytes outside ASCII
- **THEN** the returned text is decoded with that charset
- **AND** a response that declares no charset and carries no `<meta charset>` in its first 2 KiB is decoded as UTF-8

### Requirement: Web HTML reads prefer publisher Markdown

The first request for a page SHALL send `Accept: text/markdown,
text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`, so a publisher that serves
Markdown or plain text for agents is used without a second request or a
local conversion. A first response that is `text/markdown`, or `text/plain`
that is not HTML-shaped, SHALL be returned as the content with `method`
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
are shorter than 40 characters. Every derived locator, meaning an alternate,
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
- **AND** the next adapter in order decides the content

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

### Requirement: Web HTML reads fall back to a local render, llms.txt, and the raw body

Only when no publisher Markdown candidate wins SHALL the tool render locally:
Readability main-content extraction over the response body, converted to
Markdown with GFM tables and reported as `method` `readability`. When
Readability finds no article, the whole body SHALL be converted instead and
reported with the same method. Only when that render fails the quality gate
SHALL the tool probe `llms.txt`, requesting at most four candidates from the
deepest path segment up to the site root (the three deepest scopes and the
root) until one is accepted, reported as `method` `llms-txt`. An `llms.txt`
candidate SHALL be accepted on the length and not-HTML-shaped conditions
only, because an index file is short link lines by construction. When no
attempt is accepted, the tool SHALL return the response body with `method`
`raw` and a note explaining that the page could not be converted. A
JavaScript or captcha challenge SHALL fail the gate, be returned with
`method` `raw`, and carry a note naming the detected challenge. A text body
outside the negotiation set (JSON, XML, and other `text/*` types) SHALL be
returned unchanged with `method` `text`. `:raw` SHALL skip every probe and
conversion and return, untouched and with `method` `raw`, the body of the
final response after any followed redirects, with `finalUrl` naming that
response; a `:raw` read of a refused content type SHALL still fail under the
content-type rule.

#### Scenario: A page without publisher Markdown is rendered

- **WHEN** an HTML page offers no negotiated body, no alternate, and no passing suffix candidate
- **THEN** Readability's main content is returned as Markdown with GFM tables and `method` `readability`

#### Scenario: A Readability miss converts the whole body

- **WHEN** Readability finds no article on a page that still has content
- **THEN** the whole body is converted to Markdown and reported with `method` `readability`

#### Scenario: A passing render stops the search before llms.txt

- **WHEN** the local render passes the quality gate
- **THEN** no `llms.txt` candidate is requested

#### Scenario: llms.txt is probed from the deepest segment upward

- **WHEN** the local render fails the gate and `https://example.test/a/b/llms.txt` does not exist while `https://example.test/llms.txt` does
- **THEN** the walk requests the deeper candidate first and returns the root one with `method` `llms-txt`

#### Scenario: The raw body is the last resort, with a note

- **WHEN** every Markdown and render attempt fails the gate
- **THEN** the response body is returned with `method` `raw`
- **AND** `notes` explains that the page could not be converted and the content is not presented as converted text

#### Scenario: A challenge page is reported, not converted

- **WHEN** a response body is a JavaScript or captcha gate under 1,024 characters
- **THEN** it is returned with `method` `raw` and `notes` naming the detected challenge

#### Scenario: Raw mode fetches once

- **WHEN** the model reads `https://example.test/guide:raw`
- **THEN** the body of the final response is returned untouched with `method` `raw`, `finalUrl` names that response, and no Readability or Turndown step runs
- **AND** no alternate, suffix, or `llms.txt` request is issued

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and headers as the first, sending no cookie, `Authorization`, or other
credential on any request. The hop locator SHALL be the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so a relative `Location` becomes absolute and the
serialization is what policy sees: lowercase host, an internationalized host
as punycode, default port dropped, empty path as `/`, path and query
percent-encoded, fragment retained. A redirect status without a parsable
`Location`, or a resolved locator that carries userinfo or a scheme other
than `http` or `https`, SHALL fail the call with `invalid_redirect` before
any request and SHALL NOT name the target. Before a hop's request is sent, the `read`
permission group SHALL be evaluated against that locator as if the model had
submitted it, through the same evaluator and the same projection the call
used. A rejected hop SHALL end the call with a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the
response that produced the content as `finalUrl` and SHALL NOT enumerate the
hop chain. The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. This change SHALL NOT
resolve a hostname to check its address before connecting: a `path` clause is
a rule over text, so a host it admits is admitted at every address that host
resolves to.

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

#### Scenario: A hop to a private address is admitted by its text

- **WHEN** a redirect targets `http://127.0.0.1:8080/admin` and the `read` group admits that URL's text
- **THEN** the request is issued because the tool performs no address check
- **AND** the outcome is the same for a hostname whose address resolves into a private range

#### Scenario: The description explains where the content came from

- **WHEN** the packaged `read` description is rendered for a catalog that includes `read`
- **THEN** it states that redirects are followed and that the result reports the final URL

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, or `raw`, and
SHALL name the adapter that produced the returned content. The result SHALL
NOT carry a `url` field, a `contentType` field, a `markdownTokens` field, a
text header before the content, or a metadata frontmatter block. Line
selectors SHALL apply to the rendered text exactly as to a local file, with
the existing context, range, `nextOffset`, and truncation rules, and the
rendered text SHALL be measured against the existing native read result bound,
which SHALL reserve space for `path`, `finalUrl`, `method`, and `notes` before
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

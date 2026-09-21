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
reject a web locator with `invalid_path` before any request. A locator
carrying userinfo SHALL fail with `invalid_path` before any request, so the
tool never sends credentials the model embedded in a URL. Availability and
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
rest, so a locator whose authority ends in a port SHALL carry a path after
the port: `https://example.test:8080/` is a URL with no selector, while
`https://example.test:8080` selects line 8080 of `https://example.test`.

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

#### Scenario: Userinfo in a locator fails closed

- **WHEN** the model reads `https://user:secret@example.test/guide`
- **THEN** the read returns `invalid_path` before any request
- **AND** no credential from the locator is sent to the host

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
NOT claim another product's client identity. A request SHALL fail when
response headers do not arrive within 10 seconds. The call SHALL fail when it
has not completed within 30 seconds, counted across every hop and every probe
request the call issues. The response body SHALL be streamed against a 5 MiB
cap and aborted past it with `body_too_large`, and a declared length above the
cap SHALL fail before the body is read. `Accept-Encoding` SHALL be left to the
runtime. A web call SHALL NOT retry: a transport failure, a timeout, and an
error status SHALL each be reported to the model as an error observation with
no second attempt. A 429 SHALL return an error observation carrying the
`Retry-After` value when the response supplies one, and every other non-2xx
status SHALL return an error naming the status. A status error SHALL NOT
return the response body, and SHALL NOT report response headers other than the
`Retry-After` delay it carries.

#### Scenario: Every request identifies llame

- **WHEN** any web request of an admitted read is inspected
- **THEN** its `User-Agent` is `llame/<version>` with the boot-time version
- **AND** the value does not vary between the call's requests

#### Scenario: Slow headers fail at the header bound

- **WHEN** a server accepts the connection and sends no response headers within 10 seconds
- **THEN** the call fails with an error naming that bound
- **AND** the body is not read

#### Scenario: A call over the total bound fails

- **WHEN** each response arrives inside the header bound but the call passes 30 seconds while following hops or probing alternates
- **THEN** the call fails with an error naming the total bound
- **AND** no further request is issued for that call

#### Scenario: An oversized body is aborted

- **WHEN** a response declares or streams more than 5 MiB
- **THEN** the call fails with `body_too_large`
- **AND** the read stops streaming instead of buffering the remainder

#### Scenario: Rate limiting is reported, not retried

- **WHEN** a server answers 429 with `Retry-After: 120`
- **THEN** the call returns an error naming the status and the retry delay
- **AND** no retry is attempted

#### Scenario: An error status is not content

- **WHEN** a server answers 404 or 500
- **THEN** the call returns an error naming the status
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
- **THEN** the read returns the body text unchanged and reports text retrieval

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
text/html;q=0.8, text/plain;q=0.7, */*;q=0.5`, so a publisher that serves
Markdown for agents is used without a second request. A response that is
`text/markdown`, or `text/plain` that is not HTML-shaped, SHALL be returned as
the render with `method` `negotiated`. Otherwise the tool SHALL try, in order,
a Markdown alternate announced by the response's `Link` header or by a `<link
rel="alternate" type="text/markdown">` element in the page head, fetched as an
absolute URL and reported as `method` `alternate`; then the publisher's
Markdown suffix probe, mapping `/a/b.html` to `/a/b.html.md`, `/a/b` to
`/a/b.md`, and `/a/b/` to `/a/b/index.md`, reported as `method` `md-suffix`.
The first candidate that passes the quality gate SHALL win and end the search.
Every candidate SHALL be judged by the same gate: more than 100 non-whitespace
characters, not HTML-shaped for a Markdown candidate, and not low quality,
where a candidate is low quality when it is under 1,024 characters and
contains a JavaScript or captcha gate phrase, or when more than 70 percent of
its non-blank lines are shorter than 40 characters. A probe request SHALL send
the same `Accept` header, SHALL count against the call's total time and body
bound, and SHALL be subject to the same status, content-type, and redirect
rules as the first request. A candidate that fails the gate SHALL NOT become
the render, and a fetched candidate SHALL NOT be searched for further
alternates or suffixes.

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

- **WHEN** an alternate or suffix URL returns an HTML error page or a body of 40 characters
- **THEN** that candidate is not returned as the render
- **AND** the next adapter in order decides the content

#### Scenario: A low-quality candidate is rejected

- **WHEN** a page's only Markdown candidate is 900 characters dominated by short navigation lines, or a short page whose text is a JavaScript gate notice
- **THEN** the candidate fails the gate
- **AND** the pipeline continues past it

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
SHALL the tool probe `llms.txt`, walking from the deepest path segment up to
the site root and requesting each candidate until one passes the gate,
reported as `method` `llms-txt`. When no attempt passes the gate, the tool
SHALL return the response body with `method` `raw` and a note explaining that
the page could not be converted. A JavaScript or captcha challenge SHALL fail
the gate, be returned with `method` `raw`, and carry a note naming the
detected challenge. A non-HTML text body SHALL be reported with `method`
`text`. `:raw` SHALL skip every probe and conversion and return the first
response's body untouched with `method` `raw`; a `:raw` read of a refused
content type SHALL still fail under the content-type rule.

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
- **THEN** the first response's body is returned untouched with `method` `raw` and no Readability or Turndown step runs
- **AND** no alternate, suffix, or `llms.txt` request is issued

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow redirect responses on any host, up to 20 hops, and
SHALL request each hop with the same bounds and headers as the first. Before a
hop's request is sent, the `read` permission group SHALL be evaluated against
the hop's absolute URL as if the model had submitted it, through the same
evaluator and the same projection the call used. A rejected hop SHALL end the
call with a `permission_denied` error naming the hop's URL, and the rejected
target's body SHALL NEVER be read. When the hop limit is reached the call
SHALL fail with an error naming that bound and SHALL issue no further request.
The result SHALL name the URL of the response that produced the content as
`finalUrl` and SHALL NOT enumerate the hop chain. The `read` tool description
SHALL state that redirects are followed and that `finalUrl` reports where the
content came from, so the model does not re-fetch a page to learn its
location. This change SHALL NOT resolve a hostname to check its address before
connecting: a `path` clause is a rule over text, so a host it admits is
admitted at every address that host resolves to.

#### Scenario: A cross-host hop is followed when policy admits it

- **WHEN** `https://a.example/start` answers 302 to `https://b.example/guide` and the `read` group admits both URLs
- **THEN** the second request is issued and `finalUrl` is the b.example URL
- **AND** the result reports no hop chain

#### Scenario: A hop naming a rejected host ends the call without reading its body

- **WHEN** a redirect target is refused by a `read` reject
- **THEN** the call returns `permission_denied` naming that target
- **AND** no request is sent to the refused target, so its body is never read, converted, or returned

#### Scenario: The hop limit bounds a redirect loop

- **WHEN** a server redirects more than 20 times
- **THEN** the call fails with an error naming the hop bound
- **AND** no further request is issued

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
as submitted — extended with `finalUrl` and `method`, plus `notes` only when
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
- **THEN** the result carries `content`, the range metadata, `path` as submitted, `finalUrl`, and `method`, with `notes` only when non-empty
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

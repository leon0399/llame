---
summary: "The http(s):// locator: form, adapter ladder and method values, bounds, and errors"
read_when:
  - you are about to read an http:// or https:// locator and need its exact form or its bounds
  - a web read returned a method, a note, or an error you need to interpret
spec: native-file-tools
configured_by:
  - ../../operator/web-read.md
  - ../../operator/web-adapters.md
  - ../../operator/tool-call-permissions.md
---

# Web locators

The native `read` tool accepts an absolute `http://` or `https://` locator and
fetches it with the API process's own outbound HTTP. A web read is the tool the
model already knows: the same trailing line selectors over the returned text,
the same result bound, and the same `read` permission group as a file read.

## Form

`read({ path: "https://example.test/guide" })`. A trailing selector uses the
shared grammar once the web path, query, fragment, and port rules have placed
it, and it addresses the returned text, never the URL:
`https://example.test/guide:10-20` fetches the page and returns
lines 10 through 20 of the rendered text. Only a locator with a path carries
one, and a locator carrying a query is never split: every colon the query opened
is URL text, so `https://example.test/search?at=2026:10` is fetched as written.
The grammar, the context lines, the range rules, and the truncation rules are
the shared ones ([selectors](../selectors.md)).

Only `http://` and `https://` are admitted. An unimplemented scheme, a
non-web URL, and userinfo all fail with `invalid_path` before any request, and
no credential from a locator is ever sent or echoed.

The URL is normalized to the text the request will use. An uppercase scheme
or host, a percent-encoded or Unicode host, an explicit default port, a host's
root dot, an empty path, an unencoded space, and a fragment are normalized
rather than refused. Path and query percent-escapes are normalized in one
pass to a fixed point: a stray `%` is first encoded as `%25`, escapes for
unreserved characters (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) are decoded,
and every other escape stays encoded with uppercase hexadecimal digits. The
URL parser serializes the result, and normalizing it again changes nothing.
The result's `path` reports the locator that was fetched:

| Submitted                            | Requested                          |
| ------------------------------------ | ---------------------------------- |
| `HTTPS://Example.test/guide`         | `https://example.test/guide`       |
| `https://g%72okipedia.com/page`      | `https://grokipedia.com/page`      |
| `https://example.test:443/guide`     | `https://example.test/guide`       |
| `https://example.test./guide`        | `https://example.test/guide`       |
| `https://example.test/a b`           | `https://example.test/a%20b`       |
| `https://example.test/guide#install` | `https://example.test/guide`       |
| `https://example.test/%7Euser?q=%2f` | `https://example.test/~user?q=%2F` |
| `https://example.test/%%370rivate`   | `https://example.test/%2570rivate` |

What no normalization can repair is still refused before any request: a text
that is not a URL, a scheme outside `http` and `https`, a suffix outside the
selector grammar (`invalid_selector`; see
[selectors](../selectors.md#malformed-selectors)), and userinfo
(`https://user:secret@example.test/x`), whose message never echoes the
credential.

A colon is read as a selector only after the path separator, which decides the
two readings of `:N`:

- `https://example.test:88` has no path, so its `88` is the port. It is
  requested as `https://example.test:88/` — the one spelling admitted that is
  not byte-identical to its serialization, because the empty path's slash
  addresses the same endpoint.
- `https://example.test/:88` is line 88 of the site root, and
  `https://example.test:88/:88` is line 88 served from port 88.
- `https://example.test:1-5` is not a URL at all: `1-5` sits where the port
  belongs. The refusal names `https://example.test/:1-5`, the same selector on
  the serialized authority, and `https://example.test:abc/` is answered with
  "a port must be a number" rather than the generic message.
- A literal colon in the last path segment is written `%3A`:
  `https://w.example/wiki/Special%3ASearch`, because
  `https://w.example/wiki/Special:Search` splits at the colon and `Search` is
  outside the grammar — the refusal names the forms and then that encoded
  spelling. `https://w.example/docs/2024:10` selects line 10 and `:10-20` lines
  10 through 20 of `https://w.example/docs/2024`, and
  `https://w.example/wiki/Special:-5` is the last five rendered lines of
  `https://w.example/wiki/Special`.
- A selector the render cannot serve — past the end, or empty — fails as
  `invalid_selector` reporting how many lines the page rendered, which is the
  one fact the model could not know before reading it.

A fragment is cut before anything else reads the locator, because the request
drops it anyway: `https://example.test/guide#install` is fetched as
`https://example.test/guide`, and a selector written after it goes with it, so
`guide#install:5-9` reads the whole page and `guide:5-9#install` is the working
spelling. Permission evaluation matches the fragment-free requested text and the
submitted text, which keeps its `#fragment`; see
[tool-call permissions](../../operator/tool-call-permissions.md#matching). Free
text inside a fragment therefore cannot satisfy a clause the requested URL does
not — an allow written for `/docs/` does not admit `https://evil.test/x#/docs/`.

A trailing separator stays inside the URL: `https://example.test/guide/` is
fetched as written and is never read as a directory request.

## Accepted by

The `read` tool, and nothing else. A web read adds no tool id of its own and no
advertisement condition, and `edit` and `write` reject a web locator with
`invalid_path` before any request.

## Authority

A web read needs no executor: a web locator binds no executor identity and no
host path. The only authority is the public web, and the `read` permission
group is the only boundary.

**Fetched text is untrusted input.** The tool neutralizes nothing and adds no
notice around fetched content, so a page's instructions reach the model with
the standing of any other tool output. The model can be told to read a URL by
anything it already has, including a Knowledge file or a page it read earlier.

## Behavior

Each successful read reports `method`, the adapter that produced the content,
and `finalUrl`, the URL whose response produced it: the call's own URL unless a
redirect or a winning probe named a different one. The result is otherwise the
native read object — `content`, the requested and shown range or ranges,
`nextOffset`, `truncated`, and `path` as the locator with its selector stripped
— plus `notes` only when the render reported something; there is no `url`,
`contentType`, `markdownTokens`, `realPath`, text header, or frontmatter block.

A page whose response, after any redirects, declares `image/png`, `image/jpeg`,
`image/gif`, or `image/webp` is not rendered: its body is stored as a media
object of the Run owner, and the read returns the
[image result](../tools/read.md#image-result) with `path`, `finalUrl`,
`method: "image"`, and `notes` only when non-empty, and no content or range
fields. The bytes decide the format, so a JPEG declared as `image/png` reports
`image/jpeg`, and bytes that are no PNG, JPEG, GIF, or WebP image fail with
`unsupported_media_type`. Any selector on an image, `:raw` included, fails with
`invalid_selector`. An adapter response or an alternate, suffix, or `llms.txt`
probe with an image type is a refused content type, never an image.

The web adapter stage runs after the source locator passes `read` permission
admission and before the source is fetched: a claimed URL whose adapter renders
makes no request to the source host. `:raw` bypasses every adapter. A URL
accepted by an adapter's pure match is **claimed**; an unclaimed URL reaches
the generic ladder with no adapter request and no adapter note. When every
claiming adapter falls through, the source is fetched and the generic ladder
runs.

The full order is:

| `method`      | Source of the content                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `adapter`     | a configured adapter's rendered content, with structured provenance and notes                                   |
| `image`       | a PNG, JPEG, GIF, or WebP page body, returned as the stored image with no content, before any probe             |
| `negotiated`  | the first response itself: `text/markdown` or `text/plain`, returned as served                                  |
| `alternate`   | a Markdown URL announced by a `Link` header or a head `<link rel="alternate" type="text/markdown">`             |
| `md-suffix`   | the publisher's `.md` suffix probe: `/a/b.html` → `/a/b.html.md`, `/a/b` → `/a/b.md`, `/a/b/` → `/a/b/index.md` |
| `readability` | local extraction and conversion of the HTML body                                                                |
| `llms-txt`    | an `llms.txt` index reached from the deepest path segment up to the site root                                   |
| `text`        | a JSON, XML, or other `text/*` body, returned unchanged                                                         |
| `raw`         | the response body unchanged, with a note; also `:raw` and a detected challenge page                             |

A successful adapter reports `method: "adapter"` and
`adapter: { id, route, origin }`; a rewrite uses `route: "rewrite"` and its
declared origin. Its `finalUrl` remains the source URL, and its notes say that
the content came through the operator-configured origin. A claimed adapter
whose primary request fails falls through with
`web adapter "<id>" fell through: <failure>`, where `<failure>` is one of
`permission`, `address`, `status`, `rate_limit`, `transport`, `parse`, `empty`,
`binary`, `too_large`, or `content_type`. A later request for the same
document, or a call deadline reached after the primary request, can render the
content that arrived and add one `<section> omitted: <failure>` note per
missing section. Adapter failures never return their response body. A rewrite
target is fetched once and rendered only through negotiated/text or
Readability; it does not run alternate, suffix, or `llms.txt` probes. A raw,
challenge, or failed render falls through.

The ladder also labels each outcome with a media type: `negotiated` and `text`
carry the type they were served (`text/markdown` supports an outline,
`text/plain` does not), `alternate`, `md-suffix`, `readability`, and
`llms-txt` are `text/markdown`, and `raw` has no media type. A rendered
adapter outcome carries an internal media-type label, listed per adapter in
[web adapters](../web-adapters.md#media-types). An unsupported web or
adapter result uses the same `invalid_selector` as any other source, while an
ordinary read of it stays available ([media types and
errors](../selectors.md#media-types-and-errors)).

Every request, probes included, carries
`Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5` and the
same `User-Agent: llame/<version>`. A publisher that serves Markdown or plain
text for agents is therefore used without a second request and without a local
conversion.

The first candidate that passes the quality gate wins and ends the search. The
gate requires more than 100 non-whitespace characters, requires a Markdown
candidate not to be HTML-shaped, and rejects a low-quality body: under 1,024
characters and containing a JavaScript or captcha phrase, or more than 70
percent of its non-blank lines shorter than 40 characters while fewer than 40
lines reach that length. The second clause is what keeps a reference page —
the CommonMark spec renders 6,821 lines, 88 percent of them short — out of the
raw fallback: a render with 40 substantial lines is a document whatever its
shape, and the raw HTML of the same page is never the better answer. An
`llms.txt`
candidate is judged on length and shape only, because an index file is short
link lines by construction. `readability` is Readability's main-content
extraction converted to Markdown with GFM tables, and it converts the whole
body when Readability finds no article. The render opens with the page's title
as a heading, because Readability strips it as the article's own heading —
without it `https://example.com/` rendered three lines that never named the
page. A candidate that fails the gate never
becomes the content, and a fetched candidate is not searched for further
alternates or suffixes.

A probe answers for itself only: its non-2xx status, a content type the read
refuses, an oversized body, a headers timeout, an unfollowable redirect, a
transport failure, a refusal inside its own redirect chain, or a failed gate
disqualifies that candidate and the pipeline continues, because the suffix
probe and the `llms.txt` walk expect 404 as their ordinary answer. From every
probe, only the call's own spent bounds — its 30-second deadline and its
20-hop budget — and the caller's abort end the read; a refused hop on the
call's own request chain ends it too, and reports the refused target.

A web read also fetches locators the model never wrote: redirect hops, an
announced alternate, a suffix candidate, an `llms.txt` candidate, and an
adapter target. A rejected hop ends the call: the model sees
`permission_denied`, and the result's `rejectedUrl` carries the refused
locator's origin and path only. A rejected probe or an announced alternate
only disqualifies its candidate, so a hostile page cannot make a read of
itself fail. The result reports only `finalUrl`; no hop chain is exposed.
Admission of each derived locator, and the address judgment behind it, is in
[derived locators and permission
admission](../../operator/web-read.md#derived-locators-and-permission-admission).

The URLs each configured adapter claims and the document it renders are in
[web adapters](../web-adapters.md).

## Bounds

| Bound                         | Value                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Response headers              | 10 s per request (`headers_timeout`)                                                                          |
| The whole call, every request | 30 s (`call_timeout`)                                                                                         |
| Response body                 | 5 MiB streamed (`body_too_large`)                                                                             |
| Page image                    | the 5 MiB body bound, then 40 megapixels (`image_too_large`)                                                  |
| Redirects per call            | 20 (`too_many_redirects`)                                                                                     |
| Requests per call             | 27: first, 20 hops, one alternate, one suffix probe, four `llms.txt`                                          |
| Retries                       | none: no request is repeated, and a probe's failure disqualifies its candidate                                |
| Charset                       | `Content-Type` parameter, else a `<meta charset>` in the first 2 KiB, else UTF-8                              |
| Read result                   | the shared native read bound, with the web fields reserved first ([selectors](../selectors.md#result-bounds)) |
| Request credentials           | none: no cookie, `Authorization`, or other credential on any request                                          |
| Adapter requests              | the generic web bounds above and the same address pinning; there is no separate adapter request-count cap     |
| Rendered document             | 5 MiB; a larger render is cut at a line boundary with `document truncated: too_large`                         |

A declared body length above the cap fails before the body is read, and a
streaming body is aborted at the first chunk past the cap instead of being
buffered. `Accept-Encoding` is left to the runtime; every request of a call
counts against the same 30-second deadline, while the 10-second wait for
headers and the 5 MiB body cap are each request's own.

Line selectors apply to the rendered text under the native rules
([selectors](../selectors.md)): the default window, context lines, merged
ranges, `nextOffset`, and `truncated` all behave as they do for any other read.
A `-K` member on an adapter document cut at the 5 MiB rendered-document bound is
refused ([selectors](../selectors.md#media-types-and-errors)).

## Errors

| Error type                 | Meaning                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid_path`             | the locator is not an absolute web URL, has a port that is not a number, carries userinfo, or targets `edit` or `write`                                      |
| `invalid_selector`         | the split-off suffix is outside the shipped selector grammar, such as an unencoded colon in the last segment, or any selector on an image body               |
| `executor_unavailable`     | instance configuration resolved no boot-time version for `User-Agent: llame/<version>`                                                                       |
| `headers_timeout`          | no response headers arrived within 10 seconds                                                                                                                |
| `call_timeout`             | the call passed 30 seconds across its requests                                                                                                               |
| `body_too_large`           | the body declared or streamed more than 5 MiB                                                                                                                |
| `representation_too_large` | a `-K` member or `:outline` on an adapter document cut at the 5 MiB rendered-document bound                                                                  |
| `http_status`              | a non-2xx, non-redirect status on the first response or a hop; a 429 also carries `Retry-After`, and the body is not returned                                |
| `unsupported_content_type` | the response is neither a text body nor, on the page response of a read with the owner's media store, an accepted image type, or it declares no content type |
| `unsupported_media_type`   | the response declared an accepted image type, but its bytes are no PNG, JPEG, GIF, or WebP image; nothing is stored                                          |
| `image_too_large`          | the page image passed the 5 MiB body bound but is over 40 megapixels; the shared message also names the 20 MiB store bound, which a web read never reaches   |
| `invalid_redirect`         | a redirect status without a parsable `Location`, or a hop with userinfo or a non-web scheme; the target is never named; a fragment is dropped, not refused   |
| `too_many_redirects`       | the call exceeded 20 redirects                                                                                                                               |
| `permission_denied`        | the `read` group refused the submitted locator or a hop, or every address was refused — a hop rejection carries `rejectedUrl`                                |
| `aborted`                  | the Run or the caller cancelled the read                                                                                                                     |
| `network_error`            | the transport failed (DNS, TLS, connection reset); a probe's failure disqualifies only its candidate, and no request is retried                              |

Failures never return partial content: the model sees the error and can
continue with other work. Only a submitted locator or a redirect hop can fail a
whole call on permissions; a refused probe only disqualifies its candidate.

### What is not read

- **PDF and every other non-text, non-image body.** They fail
  `unsupported_content_type` naming the received type, and no extraction or
  conversion is attempted. `image/svg+xml` is a text body.
- **A cache or a snapshot.** Nothing is stored between calls, so a selector
  read refetches and rerenders, and reading one locator twice issues two
  requests whose content may differ.
- **Publisher signals.** `robots.txt` and `content-signal` are neither
  consulted nor reported.

## Configured by

- [Web reads](../../operator/web-read.md): enabling, the adapter list, the
  rewrite and GitHub entries, derived-locator admission, address pinning, the
  threat model, and troubleshooting.
- [Tool-call permissions](../../operator/tool-call-permissions.md): the `read`
  group that admits or refuses a locator, the one-domain allowlist, and the
  shipped address rejects.

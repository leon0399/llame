---
summary: "Operator runbook for web adapters: each tools.webAdapters entry, what it claims, its requests, and allowlist needs"
read_when:
  - you are adding, ordering, or removing a tools.webAdapters entry
  - a domain allowlist refuses an adapter request
behavior:
  - ../reference/web-adapters.md
  - ../reference/locators/web.md
---

# Web adapters

A web adapter reads a URL it claims from the site's own API instead of the
page. Enabling `read`, the permission boundary around every adapter request,
and the threat model are in [web reads](web-read.md); the documents each
adapter renders are in the [web adapter reference](../reference/web-adapters.md).

`tools.webAdapters` absent means `[]` (no adapter); when present, the array is
the exact ordered list, with no built-in entries, and the entries that claim a
URL are tried in that order until one renders. How a claimed read falls through
and reports its provenance and notes is in [web
locators](../reference/locators/web.md#behavior).

Every adapter request is a derived locator, admitted by the `read` group
before I/O; see [derived locators and permission
admission](web-read.md#derived-locators-and-permission-admission).

| Entry           | Claims                                                                 | Credential       |
| --------------- | ---------------------------------------------------------------------- | ---------------- |
| `rewrite`       | the operator's hosts and path pattern                                  | none             |
| `github`        | issues, PRs, code, commits, releases, gists, Actions jobs, discussions | optional `token` |
| `bluesky`       | `bsky.app` posts and profiles                                          | none             |
| `npm`           | `npmjs.com` package pages                                              | none             |
| `huggingface`   | `huggingface.co` model, dataset, and Space pages                       | none             |
| `arxiv`         | `arxiv.org` abstract, HTML, and PDF links                              | none             |
| `stackexchange` | Stack Overflow and Stack Exchange questions                            | none             |
| `crates`        | `crates.io` crate pages                                                | none             |
| `hackernews`    | `news.ycombinator.com` items                                           | none             |
| `doi`           | `doi.org` links                                                        | none             |
| `discourse`     | topics on the listed forum `hosts`                                     | none             |
| `devto`         | `dev.to` articles                                                      | none             |
| `substack`      | `{publication}.substack.com` posts                                     | none             |
| `osv`           | OSV.dev, NVD, GitHub advisory, and cve.org links                       | none             |
| `wikipedia`     | `{lang}.wikipedia.org` articles                                        | none             |

## Rewrite adapter

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

## GitHub adapter

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
list URLs; Actions run pages, Projects, or search results;
`raw.githubusercontent.com`; Enterprise hosts; or any write URL. Those
locators stay on the generic ladder without an adapter request or note.

The same entry claims releases, gists, Actions jobs, and discussions:

- `https://github.com/{owner}/{repo}/releases`, `/releases/latest`, and
  `/releases/tag/{tag}`: one request each; the list renders the newest 30.
- `https://gist.github.com/{id}` and `/{owner}/{id}`: one request to
  `/gists/{id}`; a binary file is omitted, a truncated file renders the part
  that arrived with a `truncated` note, and one that arrived empty is omitted
  as `too_large`.
- `https://github.com/{owner}/{repo}/actions/runs/{run}/job/{job}`: the job's
  status and steps from one request. With a `token`, a second request fetches
  the log, which redirects to Azure blob storage; the token is not sent there.
  Admit `^https://productionresultssa[0-9]+\.blob\.core\.windows\.net/` for
  the log under a domain allowlist, or the job renders with
  `log omitted: permission`. Without a token it renders with
  `log omitted: token required`. The last 400 log lines render; a log over
  the 5 MiB body bound renders none, with `log omitted: too_large`.
- `https://github.com/{owner}/{repo}/discussions/{number}`, only with a
  `token`: one GraphQL `POST` to `https://api.github.com/graphql`. A
  fine-grained token needs Discussions read access, and Actions read access
  for job logs.

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

## Bluesky adapter

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

## npm adapter

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

## Hugging Face adapter

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

## arXiv adapter

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

## Stack Exchange adapter

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
pages stay on the generic ladder. A read requests the question and then up to
100 answers by score from `https://api.stackexchange.com/2.3/` (an `/a/` link
first looks up its question), so a read costs two requests, three for an `/a/`
link, and four for a `/q/` link that names an answer (the empty question
probe, then the lookup). Keyless use shares a quota of 300 requests per day
per IP address. The API reports a spent quota or a throttle as HTTP 400, so
until it resets reads fall through with `status`, or keep the question with
`answers omitted: status`. With a domain allowlist, add a clause for
`^https://api\.stackexchange\.com/`.

## crates.io adapter

Add a `crates` entry to render crates.io pages, which serve an empty
JavaScript shell to the generic ladder:

```jsonc
{ "id": "crates", "use": "crates" }
```

The entry takes no other field and sends no credential. It claims
`https://crates.io/crates/{name}` and `/crates/{name}/{version}`, also on
`www.crates.io`, which redirects there; search, version lists, and other
pages stay on the generic ladder. A read requests
`https://crates.io/api/v1/crates/{name}?include=default_version,keywords,categories,downloads`,
the pinned
version's `/api/v1/crates/{name}/{version}` when the URL names one other than
the default, then the version's `/dependencies` and `/readme`. Requests after
the first use the crate's canonical name, so `serde-json` reads `serde_json`. The README
redirects to `https://static.crates.io/readmes/...`, so with a domain allowlist
add clauses for `^https://crates\.io/api/` and `^https://static\.crates\.io/`;
without the second, reads carry `readme omitted: permission`. A failed
dependency list or README keeps the rest with an omission note.

## Hacker News adapter

Add a `hackernews` entry to render Hacker News threads, whose table layout
the generic converter leaves as raw markup:

```jsonc
{ "id": "hackernews", "use": "hackernews" }
```

The entry takes no other field and sends no credential. It claims
`https://news.ycombinator.com/item?id={id}`, ignoring other query parameters;
front pages, user pages, and every other path stay on the generic ladder. A
read is one request to `https://hn.algolia.com/api/v1/items/{id}`, which
returns the item with its whole reply tree, so with a domain allowlist add a
clause for `^https://hn\.algolia\.com/`. A very large thread whose response
exceeds the 5 MiB body bound falls through with `too_large`, and polls and
poll options, whose option texts the API does not return, fall through with
`parse`.

## DOI adapter

Add a `doi` entry to render DOI links as the work's metadata and abstract.
Without it, `doi.org` answers the read's `Accept` header with a one-line
formatted citation, or redirects to a publisher page that often refuses
non-browser clients:

```jsonc
{ "id": "doi", "use": "doi" }
```

The entry takes no other field and sends no credential. It claims
`https://doi.org/{doi}` and `https://dx.doi.org/{doi}` for any `10.`-prefixed
DOI, percent-decoded. A read is one request to
`https://api.openalex.org/works/doi:{doi}` with a fixed `select`, so with a
domain allowlist add a clause for `^https://api\.openalex\.org/`. A DOI
OpenAlex does not index answers 404 and falls through to the generic ladder.

## Discourse adapter

Add a `discourse` entry to render topics on the Discourse forums you list,
which answer a non-browser client with a JavaScript shell. Discourse runs on any
host, so the entry names them:

```jsonc
{
  "id": "forums",
  "use": "discourse",
  "hosts": ["meta.discourse.org", "users.rust-lang.org"],
}
```

`hosts` are exact canonical hostnames (lowercase, no port), checked at boot like
a rewrite entry's; the entry sends no credential. It claims `https://{host}/t/{id}`,
`/t/{id}/{post}`, `/t/{slug}/{id}`, and `/t/{slug}/{id}/{post}`, with or without
a trailing slash; the post number does not choose what renders, since a topic
always renders from its first post. `/last`, `/print`, `.json` URLs, and forums
installed under a subfolder stay on the generic ladder. A read requests
`https://{host}/t/{id}.json`, then the topic's remaining posts among its first
200 from `/t/{id}/posts.json?post_ids[]=...`, 100 ids per request: one to three
requests in all. A longer topic adds `posts truncated: the first 200 of N`. With
a domain allowlist, admit each listed host.

## dev.to and Substack adapters

Add a `devto` or `substack` entry to read blog articles from the platform's
API instead of converting the page:

```jsonc
{ "id": "devto", "use": "devto" }
{ "id": "substack", "use": "substack" }
```

Neither takes another field or sends a credential, and each read is one request.
`devto` claims `https://dev.to/{username}/{slug}` and requests
`https://dev.to/api/articles/{username}/{slug}`, which returns the author's own
Markdown; profiles, tag pages, search, and dev.to's site pages stay on the
generic ladder, and the API throttles bursts of keyless reads with `429`.
`substack` claims `https://{publication}.substack.com/p/{slug}` and requests
`https://{publication}.substack.com/api/v1/posts/{slug}`; a publication on a
custom domain redirects that request to its domain, so with a domain allowlist
admit that domain as well as `^https://[a-z0-9-]+\.substack\.com/`. A post for
subscribers renders its public preview with `body truncated: subscribers only`. Custom-domain
post URLs and Hashnode, whose free API was retired and whose pages answer
with a bot challenge, are not claimed.

## OSV adapter

Add an `osv` entry to read vulnerability advisories from
[OSV.dev](https://osv.dev), which aggregates GitHub, NVD, PyPA, RustSec, Go,
and distribution advisories:

```jsonc
{ "id": "advisories", "use": "osv" }
```

The entry takes no other field and sends no credential. It claims
`https://osv.dev/vulnerability/{id}`, `https://nvd.nist.gov/vuln/detail/{CVE}`,
`https://github.com/advisories/{GHSA}`, and `https://www.cve.org/CVERecord?id={CVE}`.
A read is one request to `https://api.osv.dev/v1/vulns/{id}`, so a domain
allowlist needs `^https://api\.osv\.dev/` as well as the advisory pages.
Repository security advisories under `github.com/{owner}/{repo}/security` stay on
the generic ladder.

## Wikipedia adapter

Add a `wikipedia` entry to read Wikipedia articles as their prose, without the
citation markers, reference lists, navigation boxes, and infobox the page
carries:

```jsonc
{ "id": "wikipedia", "use": "wikipedia" }
```

The entry takes no other field and sends no credential. It claims
`https://{lang}.wikipedia.org/wiki/{title}` and the mobile
`{lang}.m.wikipedia.org` form on any language edition. A URL with a query
(`?oldid=`, `?diff=`) and a title whose prefix runs straight into a colon, the
shape of every namespace such as `Talk:` or `Kategorie:`, stay on the generic
ladder. A read is one request to
`https://{lang}.wikipedia.org/w/rest.php/v1/page/{title}/html`, plus the
same-origin hop a redirect title answers with, so a domain allowlist clause for
`^https://[a-z-]+\.wikipedia\.org/` covers it. Infobox facts are dropped with
the table; read the page through the generic ladder when you need them.

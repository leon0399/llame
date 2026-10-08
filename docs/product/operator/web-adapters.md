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

`tools.webAdapters` absent means `[]`; when present, it is the exact ordered
list, and the entries that claim a URL are tried in order until one renders.
Rendered documents are in the [reference](../reference/web-adapters.md);
fall-through and notes are in [web locators](../reference/locators/web.md#behavior).

An entry is `{ "id": "<id>", "use": "<use>" }` unless a section below adds a
field. Only `github` sends a credential. Every adapter request is admitted by
the `read` group before I/O ([derived
locators](web-read.md#derived-locators-and-permission-admission)), so a domain
allowlist must admit the hosts in the last column; a refused primary request
falls through with `permission`, a refused secondary one adds
`<section> omitted: permission`.

| `use`           | Claims                                                                                          | Requests                                        | Allowlist                                                                |
| --------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `rewrite`       | `hosts` and `pathPattern`                                                                       | `target`                                        | the target origin                                                        |
| `github`        | see [GitHub](#github)                                                                           | REST, GraphQL for discussions                   | `api.github.com`; job logs: `productionresultssa*.blob.core.windows.net` |
| `bluesky`       | `bsky.app/profile/{actor}`, `/post/{rkey}`, `/followers`, `/follows`                            | 1 (post, follows) or 2 (profile)                | `public.api.bsky.app`                                                    |
| `npm`           | `npmjs.com/package/{name}[/v/{version}]`                                                        | 3: manifest, dist-tags, README                  | `registry.npmjs.org`, `cdn.jsdelivr.net/npm/`                            |
| `huggingface`   | `huggingface.co/[datasets/\|spaces/]{owner}/{name}`                                             | 2: API, raw README                              | `huggingface.co`                                                         |
| `arxiv`         | `arxiv.org/abs/`, `/pdf/`, `/html/{id}`                                                         | 1, or 2 when no HTML exists (abstract fallback) | `arxiv.org`                                                              |
| `stackexchange` | `/questions/`, `/q/`, `/a/` on Stack Exchange network sites                                     | 2–4                                             | `api.stackexchange.com`                                                  |
| `crates`        | `crates.io/crates/{name}[/{version}]`                                                           | 3–4: crate, version, dependencies, README       | `crates.io/api/`, `static.crates.io`                                     |
| `hackernews`    | `news.ycombinator.com/item?id={id}`                                                             | 1                                               | `hn.algolia.com`                                                         |
| `doi`           | `doi.org/{doi}`, `dx.doi.org/{doi}`                                                             | 1                                               | `api.openalex.org`                                                       |
| `discourse`     | `/t/[{slug}/]{id}[/{post}]` on `hosts`                                                          | 1–3                                             | each listed host                                                         |
| `devto`         | `dev.to/{username}/{slug}`                                                                      | 1                                               | `dev.to`                                                                 |
| `substack`      | `{publication}.substack.com/p/{slug}`                                                           | 1                                               | `*.substack.com` and any custom domain it redirects to                   |
| `osv`           | `osv.dev/vulnerability/`, `nvd.nist.gov/vuln/detail/`, `github.com/advisories/`, cve.org        | 1                                               | `api.osv.dev`                                                            |
| `wikipedia`     | `{lang}[.m].wikipedia.org/wiki/{title}`, no query, no namespace                                 | 1                                               | `{lang}.wikipedia.org`                                                   |
| `telegram`      | `t.me`, `telegram.me`, `telegram.dog`: `/{name}`, `/s/{name}`, `/{name}/{id}`, `/s/{name}/{id}` | 1                                               | `t.me`                                                                   |

## Rewrite

`{ id, use: "rewrite", hosts, pathPattern?, target }`. `hosts` are exact
canonical hostnames. `pathPattern` is an RE2-compatible regex searched
unanchored against the canonical path. `target` is an `http(s)` origin plus a
template where `{path}` inserts the source path and `{query}` its encoded
query. Boot rejects unknown fields, duplicate ids, noncanonical hosts, an
invalid pattern, non-secret interpolation, and a malformed target. Rewrite
targets get no headers or credentials.

```jsonc
{
  "id": "x",
  "use": "rewrite",
  "hosts": ["x.com", "twitter.com"],
  "pathPattern": "^/[^/]+/status/\\d+$",
  "target": "https://x.pcstyle.dev{path}",
}
```

## GitHub

`{ id, use: "github", token? }`. `token` must be a whole-value interpolation
such as `{env:GITHUB_READ_TOKEN}`. It is instance-wide authority: every owner
can read whatever it can, so use a fine-grained read-only token. It is sent
only to `api.github.com`. Without one, private repositories, job logs, and
discussions are unavailable, and reads share GitHub's 60 requests per hour per
egress IP.

Claims, on `github.com` unless stated: `/{owner}/{repo}`, `/tree/{ref}[/{path}]`,
`/blob/{ref}/{path}`, `/commit/{sha}`, `/issues/{n}`, `/pull/{n}`,
`/releases[/latest|/tag/{tag}]`, `/actions/runs/{run}/job/{job}`,
`/discussions/{n}` (token only), and `gist.github.com/[{owner}/]{id}`. Diffs,
patches, PR sub-pages, lists, run pages, `raw.githubusercontent.com`, and
Enterprise hosts stay on the generic ladder.

A ref is tried as the first segment, then as a longer branch or tag on 404, so
a tag `v1` shadows a branch `v1/x`. A job log redirects to Azure blob storage,
without the token; only its last 400 lines render, and a log over 5 MiB
renders none. A fine-grained token needs Actions read for logs and Discussions
read for discussions.

## Discourse

`{ id, use: "discourse", hosts }`, with `hosts` validated like a rewrite
entry's. A topic renders its first 200 posts whatever post number the URL
names.

## Telegram

`{ id, use: "telegram" }`. Every request goes to `https://t.me`, whichever
alias host the URL names: a post reads the Post Widget
(`/{name}/{id}?embed=1&mode=tme`, which also serves public-group messages), a
channel reads the web preview `/s/{name}` with at most one `before` or `after`
cursor. Both are keyless public HTML with no stability contract, so a markup
change falls through as `parse` instead of rendering wrong content.

A `/c/` private link, a `?q=` search, and a conflicting or malformed cursor
fall through as `address` before any request. A preview redirected off
`/s/{name}` (a user, bot, group, or unknown name) falls through as `status`;
a widget error ("Post not found") or service message falls through as `empty`.

## Quotas

Keyless APIs throttle per egress IP, and a throttled read falls through:
Stack Exchange allows 300 requests per day and reports a spent quota as HTTP
400 (`status`); Bluesky and dev.to answer `429` (`rate_limit`).

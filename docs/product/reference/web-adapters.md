---
summary: "What each configured web adapter claims and the document it renders"
read_when:
  - a web read reported method adapter and you need the shape of its content
  - you need to know whether a URL is read through an adapter
spec: native-file-tools
configured_by:
  - ../operator/web-adapters.md
---

# Web adapters

An operator-configured web adapter reads a URL it claims from the site's own
API and returns a rendered document with `method: "adapter"`. When and how
adapters run, fall through, and report failures is in [web
locators](locators/web.md#behavior); which adapters an instance has is the
operator's choice ([web adapters](../operator/web-adapters.md)).

## Media types

A GitHub blob uses the file extension table and a GitHub directory has no
outline type; a rewrite adapter forwards the inner render's label; every other
adapter render is `text/markdown`. See [media types and
errors](selectors.md#media-types-and-errors).

## GitHub adapter

A blob renders decoded UTF-8 source as plain lines with no heading, so `:N-M`
addresses source lines. A directory renders the requested level and one child
level in the host's two-level listing shape, including its selector and
elision rules; a symlink renders as `- name@` and a submodule as `- name?`.
A repository root renders `Description`, `Default branch`, `Visibility`, and
`Language`, then the root listing and `## README`. A commit renders a summary
with its message, author, timestamp, changed-file statuses and counts, and a
`Diff:` URL; it never renders patches.

Issues and pull requests render as a metadata block, the body, and flat `###`
items for files, reviews, review comments, and comments; no patches or event
timeline is rendered. For example:

```text
# Pull Request #12: Improve parser
State: open
Checks: 14 passed, 1 failed (lint), 2 pending
...
## Comments (2)
### alice · 2026-09-28T10:00:00Z
ID: 7
URL: https://github.com/o/r/pull/12#issuecomment-7
...
```

All lists are loaded sequentially in 100-item pages before rendering, subject
to the shared call deadline and document bound. Check runs use
`filter=latest&per_page=100` and load until GitHub's `total_count`; counts cover
the endpoint's at-most-1000 most recent check suites. The rendered document is
paged with the ordinary `:N-M` selector, and each read refetches it. `Checks:`
reports passed, failed (with failing names), and pending counts. With no runs
it reports `Checks: none`; if the first check-runs page fails, lacks a numeric
`total_count`, or cannot be parsed, it reports `Checks: unavailable`. If a
later page does not arrive, it reports loaded counts plus `N not loaded`.

A failed secondary page keeps the sections already loaded and adds an omission
note such as `review comments omitted: rate_limit`; the section is one of
`comments`, `reviews`, `review comments`, `files`, or `check runs`. A
`rate_limit` is a 429, or a 403 with `x-ratelimit-remaining: 0` or
`retry-after`; `x-ratelimit-reset` adds `resets <ISO-8601>` to notes when
present. A primary rate-limit fall-through note includes
`, resets <ISO-8601>` when that header is available; primary failures expose
no response body, and rate limits are not retried.

## Bluesky adapter

A post renders in the [x.md](https://x.pcstyle.dev/) thread layout: reachable
ancestors oldest first as `Parent`, the requested post as `Post`, then replies
depth-first, labeled `Thread` while the author continues their own chain and
`Reply` otherwise. Link facets become Markdown links to their full URIs,
media and quoted posts are blockquoted, and each entry ends with its
`bsky.app` URL and creation time:

```text
## Post · 1/3 — Alice (@alice.test)

Read [example.com/very…](https://example.com/very/long) now

> ![A cat sleeping](https://cdn.bsky.app/img/feed_fullsize/...)

Source: https://bsky.app/profile/alice.test/post/3mx5e63uvns2d
Date: 2026-10-01T00:00:00Z

---

## Reply · 2/3 — @bob.test
...
```

A profile renders its linked name, description, follower, following, and post
counts, then `## Latest posts` with one line per original post among the 30
most recent feed items, reposts dropped;
if the posts do not load, the profile stays and a `posts omitted: <failure>`
note is added. `/followers` and `/follows` render one linked line per account
for the first 100 and say when more were not loaded. Accounts that label
themselves `!no-unauthenticated` are withheld: a requested post, profile, or list falls
through with `empty`, their replies and list entries are omitted, and a quote
of one of their posts renders as unavailable.

## npm adapter

A package or package-version page renders the version manifest as metadata
lines, then the README:

```text
# react@19.3.0

React is a JavaScript library for building user interfaces.

License: MIT
Homepage: https://react.dev/
Repository: https://github.com/react/react
Dist-tags: latest 19.3.0, next 19.3.0-canary-…
Engines: node >=0.10.0
Tarball: https://registry.npmjs.org/react/-/react-19.3.0.tgz
URL: https://www.npmjs.com/package/react/v/19.3.0

## README
...
```

`Deprecated`, `Dependencies`, `Peer dependencies`, and `Maintainers` lines appear
when the manifest has them. A package page without `/v/` reads the `latest`
dist-tag. A failed dist-tags or README request leaves the rest with a note.

## Hugging Face adapter

A model, dataset, or Space page renders its Hub metadata as lines, then the
model card with its YAML front matter removed:

```text
# meta-llama/Llama-3.1-8B

Kind: Model · text-generation · transformers
License: llama3.1
Gated: manual
Parameters: 8,030,261,248
Downloads (last 30 days): 636,761
Likes: 2,613
Tags: transformers, safetensors, llama, ...
Created: 2024-07-14T22:20:15.000Z
Updated: 2024-10-16T22:00:37.000Z
Revision: d04e592bb4f6aa9cfee91e2e20afa771667e1d4b
URL: https://huggingface.co/meta-llama/Llama-3.1-8B

## README
...
```

Lines appear only when the Hub reports the field; `SDK` is a Space's. The card
is read at the reported revision, and a gated repository's card is not
readable without a token, so it renders with `readme omitted: status`.

## arXiv adapter

An `abs`, `pdf`, or `html` paper URL renders the paper's full text from its
arXiv HTML rendering, converted like a Readability render, so a PDF link is
readable. Inline math becomes a code span holding its LaTeX source, and a
display equation becomes a code block with one line per equation row and its
number:

````text
We compute the dot products of the query with all keys, divide each by
`\sqrt{d_{k}}`, ...

```
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}(\frac{QK^{T}}{\sqrt{d_{k}}})V    (1)
```
````

A version without an HTML rendering reads the abstract page instead, with the
note `full text omitted: status`. The render's media type is the converter's
`text/markdown`.

## Stack Exchange adapter

A question renders its title, counts, tags, asker, license, and URL, the
question body converted to Markdown, then each answer with the accepted one
first and the rest by score:

```text
# Why is processing a sorted array faster than processing an unsorted array?

Score: 27,546 · Answers: 25 · Views: 2,004,504
Tags: java, c++, performance, cpu-architecture, branch-prediction
Asked: 2012-06-27T13:51:36.000Z by GManNickG
License: CC BY-SA 4.0
URL: https://stackoverflow.com/questions/11227809/...

## Question
...

---

## Answer · 1/25 — accepted · score 35,296 — Mysticial
...
Source: https://stackoverflow.com/a/11227902
Date: 2012-06-27T13:56:42.000Z
```

An `/a/` link, or a `/q/` link that names an answer, renders the whole thread.
`answers truncated: the first 100 by score` when there are more, and a failed
answers request keeps the question with an `answers omitted:` note.

## crates.io adapter

A crate page renders its default version and a version page the named one:
the description, then `Yanked`, `License`, `Default version` (when another
version was named), `Rust version`, `Edition`, `Downloads`, `Repository`,
`Homepage`, `Documentation`, `Keywords`, `Categories`, `Features`,
`Dependencies`, `Build dependencies`, `Dev dependencies`, `Published`, and
`URL` lines for the fields present, then the README converted to Markdown
with its empty anchors, such as heading links, removed:

```text
# serde 1.0.229

A generic serialization/deserialization framework

License: MIT OR Apache-2.0
Rust version: 1.56
Edition: 2021
Downloads: 1,496,216,235 (345,806,252 in the last 90 days)
Repository: https://github.com/serde-rs/serde
Homepage: https://serde.rs
Documentation: https://docs.rs/serde
Keywords: serialization, no_std, serde
Categories: no-std, encoding, no-std::no-alloc
Features: alloc, default, derive, rc, std, unstable
Dependencies: (2) serde_core =1.0.229, serde_derive ^1 (optional)
Published: 2026-07-18T23:05:13.266456Z by dtolnay
URL: https://crates.io/crates/serde/1.0.229

## README
...
```

## Hacker News adapter

An item renders in the [x.md](https://x.pcstyle.dev/) thread layout: the
requested story or comment as `Post`, then every reply depth-first as `Reply`,
with `Replying to @{author}` when a reply answers someone other than the
requested item. A story carries its title in bold and a `Link:` line; each
entry ends with `Source:` (its `news.ycombinator.com` URL) and `Date:` lines,
and a story adds `Points:`. Dead and deleted comments are omitted together
with their replies, as the API omits them, and replies follow the API's order,
not Hacker News's ranking.

## DOI adapter

A DOI renders the work's title, then `Retracted` (only when retracted),
`Authors`, `Published` (date, venue, and type), `Cited by`, `Open access` (an
open copy's URL when one is known), and `DOI` lines, then `## Abstract` when
OpenAlex has one:

```text
# On the Dangers of Stochastic Parrots

Authors: Emily M. Bender, Timnit Gebru, Angelina McMillan-Major, Shmargaret Shmitchell
Published: 2021-03-01 in ACM Conference on Fairness, Accountability, and Transparency (FAccT) (conference-paper)
Cited by: 6,776
Open access: https://doi.org/10.1145/3442188.3445922
DOI: https://doi.org/10.1145/3442188.3445922

## Abstract
...
```

The `Open access` URL is a separate read; the adapter does not fetch it.

## Discourse adapter

A topic renders in the [x.md](https://x.pcstyle.dev/) thread layout: its first
post as `Post` with the topic title in bold, then every other post in stream
order as `Reply`, up to 200 posts. An author reads `Name (@username)`, or
`@username` when the name is missing or only repeats the username, and
`[deleted]` for a deleted account. A reply to a post other than the first adds
`Replying to @{author}` (`Replying to post #{n}` when that post is not
rendered). Bodies are converted to Markdown with root-relative links resolved
against the forum and empty heading anchors dropped; a small action without
text, such as a closing, renders its event name. Each entry ends with `Source:`
(the post's URL) and `Date:` lines.

## dev.to and Substack adapters

An article renders `# {title}`, the description (dev.to) or subtitle
(Substack), then `Author`, `Published`, and `Tags` lines for the fields present
and a `URL` line, then the body: dev.to's is the author's Markdown as written,
with Liquid tags such as `{% embed ... %}` left as they are; Substack's is the
post HTML converted to Markdown, with root-relative links resolved and the link
Substack wraps around each image to its full-size file dropped.

```text
# JavaScript Visualized: Promises & Async/Await

If you're here in 2024 (or later), here's an updated video: ...

Author: Lydia Hallie
Published: 2020-04-14T16:46:40Z
Tags: javascript, node, webdev
URL: https://dev.to/lydiahallie/javascript-visualized-promises-async-await-5gke

...
```

## OSV adapter

An advisory renders `# {id}: {summary}`, then `Withdrawn`, `Aliases`,
`Severity` (the source's rating, then each distinct score, including
per-package scores), `CWE`, `Published`,
`Modified`, `Related`, and `URL` lines for the fields present. `## Affected`
lists each package with its ecosystem and the range events OSV records
(`introduced`, `fixed`, `last_affected`), or its listed versions when it has
no ranges, and repository ranges by commit;
`## Details` carries the advisory text and `## References` its links. A
repository range names its repo as `GIT {repo}`, so a commit is not read as a
package version.

## Wikipedia adapter

An article renders `# {title}` and a `URL` line with its canonical address
(the target of a redirect title), then its body converted to Markdown. Citation
markers, reference lists, navigation boxes, maintenance notices, the infobox,
hidden text, and images are removed (a figure keeps its caption); a formula renders as its TeX source in
code, code renders as fenced blocks, and article links become absolute
`https://{lang}.wikipedia.org/wiki/...` links.

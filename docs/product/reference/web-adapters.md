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

An operator-configured adapter reads a URL it claims from the site's API and
returns `method: "adapter"`. Ordering, fall-through, and failure notes are in
[web locators](locators/web.md#behavior); which adapters exist is the
[operator's choice](../operator/web-adapters.md). A failed secondary request
keeps what loaded and adds `<section> omitted: <failure>`; a capped list adds
`<section> truncated: ...`.

## Media types

A GitHub blob uses the file extension table, a GitHub directory has no outline
type, and a rewrite forwards the inner render's label; everything else is
`text/markdown` ([media types](selectors.md#media-types-and-errors)).

## GitHub adapter

- **Blob:** decoded UTF-8 source, no heading, so `:N-M` addresses source lines.
- **Directory:** the requested level plus one child level, in the host listing
  shape; `- name@` is a symlink, `- name?` a submodule.
- **Repository:** description, default branch, visibility, language, root
  listing, `## README`.
- **Commit:** message, author, time, changed files with counts, a `Diff:` URL;
  never a patch.
- **Issue, pull request:** metadata, body, then flat `###` items for files,
  reviews, review comments, and comments; no patches or timeline. `Checks:`
  counts passed, failed (named), and pending runs, or reads `none`,
  `unavailable`, or `N not loaded`.
- **Release:** tag, name, author, dates, flags, assets, notes. `/releases` lists
  the newest 30.
- **Gist:** each text file in a code fence; binary and budget-spent files are
  noted, not shown.
- **Actions job:** status, conclusion, steps, and with a token the last 400 log
  lines, timestamps and color codes removed.
- **Discussion:** category, author, answer, and the first 100 comments with 20
  replies each.

```text
# Pull Request #12: Improve parser
State: open
Checks: 14 passed, 1 failed (lint), 2 pending
...
## Comments (2)
### alice · 2026-09-28T10:00:00Z
```

Lists load in 100-item pages within the call deadline. A rate limit is not
retried; its note adds `resets <ISO-8601>` when GitHub sends the header.

## Thread adapters

Bluesky, Hacker News, and Discourse use the [x.md](https://x.pcstyle.dev/)
thread layout: one `## {Label} · {i}/{n} — {author}` entry per post, ending in
`Source:` and `Date:` lines.

```text
## Post · 1/3 — Alice (@alice.test)

Read [example.com/very…](https://example.com/very/long) now

Source: https://bsky.app/profile/alice.test/post/3mx5e63uvns2d
Date: 2026-10-01T00:00:00Z
```

- **Bluesky:** ancestors as `Parent`, the post, then replies depth-first as
  `Thread` (same author) or `Reply`; media and quotes are blockquoted. A
  profile lists its original posts among the latest 30; `/followers` and
  `/follows` list the first 100. Accounts labeled `!no-unauthenticated` are
  withheld.
- **Hacker News:** the item as `Post` (a story adds its title, `Link:`, and
  `Points:`), then replies depth-first in API order. Dead and deleted comments
  are omitted.
- **Discourse:** the first post as `Post` with the topic title, then up to 199
  replies, each with `Replying to @{author}` when it answers a later post.

## Package adapters

npm, crates.io, and Hugging Face render a `# {name}[@ or space]{version}`
heading, the description, metadata lines for the fields the registry reports,
a `URL` line, then `## README`.

```text
# react@19.3.0

React is a JavaScript library for building user interfaces.

License: MIT
Dist-tags: latest 19.3.0, next 19.3.0-canary-…
URL: https://www.npmjs.com/package/react/v/19.3.0

## README
```

A page without a version reads the default (`latest` on npm). A gated Hugging
Face card renders with `readme omitted: status`.

## Paper adapters

- **arXiv:** `abs`, `pdf`, and `html` URLs render the full text from arXiv's
  HTML, with math as LaTeX in code spans and blocks. Without HTML, the
  abstract renders with `full text omitted: status`.
- **DOI:** title, authors, venue and date, citation count, open-access URL, and
  `## Abstract` when known. The open-access copy is not fetched.

## Article adapters

- **dev.to, Substack:** `# {title}`, the description or subtitle, `Author`,
  `Published`, `Tags`, `URL`, then the body: dev.to's author Markdown as
  written, Substack's HTML converted. A subscriber-only Substack post renders
  its preview with `body truncated: subscribers only`.
- **Wikipedia:** `# {title}`, `URL` (a redirect title's target), then the
  article without citations, reference lists, navboxes, maintenance notices,
  infobox, hidden text, or images. Captions stay, formulas render as TeX, and
  links are absolute.
- **Stack Exchange:** the question with counts, tags, asker, and license, then
  the accepted answer and the rest by score, up to 100. Any answer link renders
  the whole thread.

## OSV adapter

`# {id}: {summary}`, then `Withdrawn`, `Aliases`, `Severity`, `CWE`, dates,
`Related`, and `URL`, then `## Affected` (each package with its range events
or listed versions; a repository range as `GIT {repo}`), `## Details`, and
`## References`.

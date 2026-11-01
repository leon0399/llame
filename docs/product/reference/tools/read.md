---
summary: "The native read tool: one path argument whose scheme selects the authority, plus line and representation selectors"
read_when:
  - you need to know what a read returns or how a selector changes the result
  - you need to know which scheme a path addresses or why a read failed
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
  - ../../operator/web-read.md
  - ../../operator/web-adapters.md
  - ../../operator/knowledge.md
  - ../../operator/skills.md
  - ../../operator/media.md
---

# read

## Purpose

`read` takes one `path` argument and returns a bounded view of what that path
addresses. The scheme of the path selects the authority — a host filesystem, a
Knowledge Space, a skill package, the owner's stored media, or a web URL — and the trailing selector
selects lines or a representation. It never changes the source.

## Arguments

| Argument | Meaning                                                  |
| -------- | -------------------------------------------------------- |
| `path`   | a locator with an optional trailing selector (see below) |

One argument only. There is no separate range, depth, or representation
argument: the selector in `path` carries all of that. See
[selectors](../selectors.md) for the full grammar.

## Locators

| Scheme                                         | Executor | Mutable | Authority and listing                    |
| ---------------------------------------------- | -------- | ------- | ---------------------------------------- |
| [absolute host path](../locators/host-path.md) | yes      | yes     | the worker's filesystem; depth-2 listing |
| [`file://`](../locators/host-path.md#form)     | yes      | yes     | the same path, decoded once              |
| [`machine://`](../locators/machine.md)         | no       | yes     | a configured Machine, over SSH           |
| [`ssh://`](../locators/ssh.md)                 | no       | no      | an external host, over SSH               |
| [`kb://`](../locators/kb.md)                   | no       | yes     | the owner's Knowledge Space tree         |
| [`skill://`](../locators/skill.md)             | no       | no      | an installed skill package, read-only    |
| [`http(s)://`](../locators/web.md)             | no       | no      | the public web, through the API process  |
| [`media://`](../locators/media.md)             | no       | no      | the owner's stored media, read-only      |

## Result

A successful read returns the selected content plus the fields that describe how
much of it was shown. A model reads the result as plain text — one header line,
the attribution lines the source adds, the numbered content, and, when a bound
cut it, one bracketed continuation line — while the owner's UI reads the stored
object:

```text
src/app.ts:1-2001 of 2162 lines
1: import { app } from './app.ts';
…
2001: export default app;
[162 more lines. Use src/app.ts:2001- to continue]
```

The header names the source and the shown range: `path:start-end` for one range,
`path:a-b,c-d` for a comma list, `path:raw:start-end` for a raw read, and
`path:outline:start-end` for an outline, then, after one space,
`of <total> lines` when `lineCount` is stored. A null shown range renders
`path: empty`, or
`path: line <N> exceeds the result bound and was skipped` when the first line
itself is larger than the bound; the continuation line resumes after it. A part
stored before the ranges were kept carries no shown range key at all, so it
renders the bare locator with `of <total> lines` when one is stored. A directory
listing renders its `content` as-is (its first line is the path) with no header
line. The attribution lines follow the header, or a listing's entries, in the
order the source adds them. The continuation line names the exact read that
resumes the source in its own form, open-ended once the requested range is
spent, and states how many lines or entries remain when the count is stored. A
web locator that carries a query or a fragment takes no selector, so its line
states the remaining lines and that the locator takes no line selector instead
of naming a read.

| Field                                | Meaning                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `content`                            | the emitted source lines, each with its `N:` prefix, or the verbatim bytes for a raw read  |
| `requestedRange` / `requestedRanges` | the resolved source scope that was requested                                               |
| `shownRange` / `shownRanges`         | the source lines actually emitted                                                          |
| `truncated`                          | whether a bound cut the result                                                             |
| `nextOffset`                         | the zero-based index of the first omitted source line; the continuation line resumes there |
| `lineCount`                          | the source's line count, when it is known                                                  |
| `entryCount`                         | a directory listing's requested-level entry count                                          |
| `realPath`                           | the canonical absolute path, when it differs from the path as given                        |
| `path`                               | the path the result identifies itself by                                                   |

A text read carries `lineCount` when the count is known: a web render, and a
regular file, `kb://` file, or `skill://` file of at most 32 MiB, counted by a
byte scan for line feeds without a decode. A larger file and an outline carry
none, and their header and continuation line then omit the total and the
remaining count. A directory listing carries `entryCount`, the requested level's
entry count the listing already computes. A `machine://` read carries the count
its daemon reports and none when the daemon sends none.

A file read on an absolute path reports `realPath` when a symbolic link in the
path or in one of its components makes it differ from the normalized path as
given; `realPath` counts within the result bound, and the header and line
numbering stay those of the path as given. A directory listing never carries it,
and neither does a `kb://` or `skill://` read.

A multi-range read reports the plural `requestedRanges` (the merged request) and
`shownRanges` (emitted lines); continuation and trimming are under
[selectors](../selectors.md#result-bounds).

### Image result

A host, `file://`, `machine://`, Workspace-relative, `kb://`, or `skill://`
regular file whose leading bytes are a PNG, JPEG, GIF, or WebP image is not
decoded as text: the worker decodes it with the same preparation as an upload,
creates no media object, and the read returns an image result instead of
`content`:

| Field               | Meaning                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `kind`              | `image`                                                             |
| `mediaType`         | the original's format                                               |
| `width`             | the original's width in pixels                                      |
| `height`            | the original's height in pixels                                     |
| `path`              | the path as for a text read of the same source                      |
| `display.thumbnail` | a display-only WebP data URL, at most 256 px; never sent to a model |

The source's attribution stays: `realPath` on a host path, the Space fields and
notice on `kb://`, the skill fields on `skill://`. The result has no `media`
field, no line metadata, and takes no selector. The extension never decides: an
SVG, or any file matching no signature, stays on the text path whatever its
size. `display.thumbnail` is one WebP encode at quality 60, transparency
flattened onto white; an image whose data URL would exceed 65,536 characters has
no thumbnail. It is stored with the tool output for the chat UI only: the model
receives the result without it, and it counts toward no result or replay
budget.

An `http(s)://` page whose response, after redirects, declares `image/png`,
`image/jpeg`, `image/gif`, or `image/webp` within the 5 MiB web body bound is
decoded the same way and creates no media object, and returns the image result
plus `finalUrl`, `method: "image"`, and `notes` only when non-empty; `path` is
the requested URL. The bytes still decide the format, `:raw` is refused like any
selector, and `image/svg+xml` stays text; see
[web](../locators/web.md#behavior).

The decoded model variant stays in the chat row beside the result. A model that
declares image input receives the image with the result in that attempt's later
steps, and in every later request of the epoch — a later turn, a retry or
resume, a Continue, a compaction, or an owner fork — as the epoch image window
in [media](../../operator/media.md#media-window) admits it. When the window does
not admit it, the result instead carries
`[image "<path>" W×H, not attached: this context's image limit is reached]`, the
path being the one the model submitted, as a JSON string literal. A model
without image input receives the omitted placeholder instead. A read that would
pass its message's retained-media bound keeps no bytes and takes the limit
placeholder too. A [`media://`](../locators/media.md) read returns a stored
object with its `media` locator and no `thumbnail`, and replays from the store
the same way.

### PDF result

A host, `file://`, `machine://`, Workspace-relative, `kb://`, or `skill://`
regular file starting with `%PDF-` returns `kind: "pdf"`, `mediaType:
"application/pdf"`, `pages`, and `byteSize`, with the same source attribution as
a text read.
There is no `content`, line metadata, thumbnail, or embedded PDF data. The
extension never decides: an HTML file named `.pdf` stays text.

An [`http(s)://`](../locators/web.md#behavior) page declaring
`application/pdf` and starting with `%PDF-` returns the same PDF result with
`finalUrl`, `method: "pdf"`, and `notes` only when non-empty. Its body bound is
20 MiB; it is also unstored and takes no selector.

The worker validates the original without storing it. The original stays in the
chat row beside the result, so a model that declares PDF input receives its
bytes in the reading attempt's later steps, and in every later request of the
epoch — a later turn, a retry or resume, a Continue, a compaction, or an owner
fork — under the shared [media window](../../operator/media.md#media-window).
When the window does not admit it, the result instead carries
`[pdf "<path>" <P> pages, not attached: this context's PDF limit is reached]`.
A model without PDF input receives an omitted placeholder. A
[`media://`](../locators/media.md) PDF result also carries its stored `media`
locator and replays from the store across turns.

## Behavior

`read({ path: "/absolute/file.md:10-20" })` returns lines 10 through 20, plus one
live line of context on either side when available. `:raw` returns verbatim
source without line numbers or added context. The full line (including the
open-ended `N-` and tail `-K` members), raw, and representation grammar is under
[selectors](../selectors.md#line-selectors).

A read never mutates its source. A read of a host path also triggers that
directory's instruction chain, and a `kb://` read triggers its Space's chain; a
read on a Machine triggers the chain inside the registered root containing it.
See [instruction files](../instruction-files.md). A `skill://`, `http(s)://`,
`media://`, or `bash` call never triggers a load.

A `machine://` read returns the same contents, listing shape, selectors, and
bounds as the local executor, with every reported path written as a Machine
locator; a bare `machine://` lists the configured Machines with their status and
`machine://<name>` that Machine's registered roots. The Machine's OS user runs
it with no sandbox and no isolation between users who share the Machine; see
[machine](../locators/machine.md#authority).

An `ssh://` read runs on an external host as its login user, over the operator's
SSH configuration and the instance's SSH identity, with no sandbox and no
isolation between llame users. It returns UTF-8 text up to 1 MiB with the same
selectors and line numbers as a local read, or one level of the directory in the
local listing form, capped at 1,000 entries with a line saying more exist; a
larger file is `file_too_large`, and a FIFO, socket, or device is
`not_regular_file`. Its directory is not entered by any Workspace, and its
instruction chain is never loaded; `bash` accepts the same locator as a `cwd`.
See [ssh](../locators/ssh.md#authority).

A marker in a prompt (`@path`, `@"…"`, `@'…'`, ``@`…` ``, `@[label](path)`, or
`[label](path "import")`) is read once for the owner before the first model
request, with the same locators and selectors; see [prompt imports](../prompt-imports.md).

## Bounds

Every read shares the result bound documented in
[selectors](../selectors.md#result-bounds); a directory read has its own
traversal budget, in [host-path](../locators/host-path.md#listing).

## Errors

Knowledge identifier failures — `knowledge_space_not_found` and
`knowledge_space_unavailable` — are specific to `kb://`; see
[kb](../locators/kb.md#errors). Every other path and file failure a read can
return — `invalid_path`, `not_found`, `not_regular_file`, `invalid_utf8`,
`executor_unavailable`, `directory_too_large`, ... — is the same native
vocabulary regardless of scheme. `file_exists` is not one of them: it belongs to
the mutations, in [write](write.md#errors).

A selector the source does not accept fails with `invalid_selector`, and a
suffix outside the grammar is `invalid_selector` on every scheme, with one
message naming the working forms; see
[selectors](../selectors.md#malformed-selectors). A `-K` member on a web
adapter document cut at the document bound fails as `representation_too_large`
instead ([selectors](../selectors.md#media-types-and-errors)).
A selector on an image or PDF is `invalid_selector`
(`An image or PDF is read without a selector.`), including `:raw`, `:outline`,
tail, open-ended, and multi-range selectors. An image or PDF over 20 MiB fails
`media_too_large` before it is read whole, as does an image over 40 megapixels
or a PDF over 100 pages. An encrypted or unopenable PDF, or image bytes that
cannot be decoded, fails `unsupported_media_type`. Neither falls back to text.
`unsupported_operation` is a `skill://` or `media://` mutation refusal, and
`skill_requires_explicit_selection` a manual-only package refusal; both are in
[skill](../locators/skill.md#errors).

## Configured by

- [Native files](../../operator/native-files.md) enables the host executor and
  the `read` entry.
- [Web reads](../../operator/web-read.md) configures `http(s)://` restrictions,
  and [web adapters](../../operator/web-adapters.md) configures adapters.
- [SSH locators](../../operator/ssh.md) enables `ssh://` and pins the host keys
  behind it.
- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge root
  behind `kb://`.
- [Skills](../../operator/skills.md) installs the packages `skill://` reads.

`machine://` needs no local executor: the operator declares the Machines and
pins their SSH host keys, and the feature is absent without that configuration;
see [machine](../locators/machine.md).

A read is gated by the `read` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md#matching). That
group matches the resource without the read selector the tool splits off, on
every source; `edit` and `write` have no selector, so any suffix they carry
stays in the matched text.

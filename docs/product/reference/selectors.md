---
summary: "The trailing selector a read path may carry: line ranges, :raw, :outline, Markdown ancestors, and the shared result bound"
read_when:
  - you are choosing a selector or deciding how a read was bounded
  - you need the range, raw, or outline grammar and the errors it can produce
spec: native-file-tools
configured_by:
  - ../operator/native-files.md
  - ../operator/web-read.md
---

# Selectors

A `read` path is `<locator>[:<selector>]`. The selector chooses which lines the
result carries and in what representation; the locator chooses the source. See
[locators](locators/index.md) for the schemes a locator may name.

## Line selectors

`read({ path: "/absolute/file.md:10-20" })` returns lines 10 through 20, plus
one live line of context on either side when available. `:10+11` selects the
same requested range. Existing literal filenames take precedence over selector
syntax, so a file whose name ends in `:20` is still read as that file.

Comma-separated ranges such as `:4-5,7-8` read several passages in one bounded
call: ranges sort, merge, grow one context line per side, and merge again when
the grown windows touch, so `:4-5,7-8` renders lines 3 through 9. Up to 64 ranges
per read. Multi-range results report `requestedRanges` (the merged request) and
`shownRanges` (emitted lines).

A directory read takes a range selector too: `:1-5` returns a flat listing of
root-level entries only, with no child content.

## Raw

`:raw` and `:raw:<ranges>` return verbatim source, without line numbers or added
context. `:raw:4-5,7-8` stays verbatim without context. Only a raw read is
byte-for-byte source. `:raw` is not supported for directories.

## Markdown outline

Representation selectors are chosen after source admission and content
acquisition. The grammar accepts `:raw`, `:raw:<ranges>`, `:outline`,
`:outline:<N>`, `:outline:<N-M>`, and `:outline:<N+K>`. `<ranges>` uses the
raw-range grammar, including comma-separated ranges; an outline scope accepts
exactly one range and never a comma list. `:outline:N` means source line N only,
and `:outline:N+K` means K source lines from N (N through N+K-1). Ordinary
bounded reads add one preceding and one following live line when available;
these are called **context lines**. Outline reads do not add context lines.

Host literal-path probing still happens first, and host and web split the outline
form after the raw form and before the last-colon numeric fallback. Thus
`:outline:raw` is the shipped raw read of a path or URL ending in `:outline`,
not an outline request. On host and web, `:raw:outline` is not a representation
member and fails with `invalid_selector`; `kb://` and `skill://` return
`invalid_path` for either form. The host permission check sees the submitted
suffix-bearing path, including `:outline`, before selector parsing.

### Outline output

For Markdown, `:outline` returns source lines in source order with the ordinary
`N:` prefix and space: the selected frontmatter lines, the first non-blank root
excerpt before the first root heading, and each root heading's heading lines
followed by the first non-blank non-heading line in its section. ATX headings
contribute one line; setext headings contribute their text lines and underline. A
heading followed immediately by another heading or by the end of the document has
no excerpt. Fenced or indented code, HTML blocks, list items, blockquotes, and
frontmatter do not create root headings. No heading text, section coordinates,
summaries, or heading-name selectors are generated.

The result uses `representation: "outline"`. Apart from the ordinary prefix and
the documented long-line cut, each emitted line retains its authored text and
native terminator. Root sections end immediately before the next root heading at
the same or a shallower depth; deeper headings remain inside the preceding
shallower section.

The exact structural example from the specification is:

````text
1: # Guide
3: Intro sentence.
5: ## Install
7: ```bash
12: ## Use
14: ### Flags
16: Flag text.
````

A setext heading remains verbatim, including its underline:

```text
8: Two
9: ===
```

Every emitted source line is cut after 120 UTF-16 code units and gets a trailing
`…` when it is longer. A line of exactly 120 code units is unchanged. The only
generated text is that marker and the frontmatter elision marker below. A
document without root headings returns its frontmatter and root excerpt, while an
empty document returns empty content with null ranges.

### Frontmatter

Only a block that starts on line 1 with `---` and closes with the first later
`---` or `...` delimiter is frontmatter. Both delimiter lines are emitted.
Between them, the outline emits up to 32 top-level key lines: lines beginning in
column zero with a character other than whitespace, `#`, or `-`. Indented lines,
comments, and sequence items are omitted. After 32 key lines, the remaining keys
are replaced by one unprefixed generated line, with no source coordinate:

```text
[… 28 more frontmatter lines]
```

For example, the specification's frontmatter case produces:

```text
1: ---
2: name: octocat
3: description: Use for GitHub.
4: ---
5: # Octocat
```

That elision line does not extend `shownRange`. No YAML, TOML, or JSON parse is
performed; malformed or scalar frontmatter is shown by the same rule, with no
note. An unclosed line-one opener is ordinary Markdown, not frontmatter.

The native line model counts LF delimiters, keeps a lone CR inside its source
line, and does not add a line for a trailing LF. Frontmatter delimiter matching
removes one trailing CR and trailing spaces or tabs, so CRLF frontmatter is
recognized. A leading U+FEFF on line 1 is ignored for heading and frontmatter
recognition but remains in the emitted source line.

### Outline scope

The outline prepends the direct ancestor chain of source line N: root headings
whose sections contain N, shallowest first. Each ancestor is rendered with its
heading lines and excerpt, restricted to lines before N, and is omitted when its
own lines are already in scope. Frontmatter and the root excerpt appear only
when their source lines are in scope. If the ancestor chain of N does not fit
the result budget or 2,000-line cap on its own, omit the whole chain and
continue with in-scope lines, so every continuation read makes progress. A scope
beginning past the last source line fails with `invalid_selector`, as an ordinary
out-of-range read does.

Scope is by source coordinates, not by the number of outline lines, and outline
output has no context lines. `requestedRange` remains the normalized source scope
(or line 1 through the scanned source end when unscoped), while `shownRange` is
the first and last emitted source line, or null when no source line is emitted;
an empty source has null ranges.

For a file with `# Title` at line 1, `## Setup` at line 30, `### Linux` at line
44, `### macOS` at line 70, and `## Use` at line 100, `:outline:60-90` returns the
ancestor chain of line 60 (`1: # Title`, `30: ## Setup`, and `44: ### Linux`, with
their excerpt lines before line 60), then `70: ### macOS` with its excerpt line;
`100: ## Use` lies outside the scope. `:outline:65` returns `1: # Title`,
`30: ## Setup`, and `44: ### Linux`, with their excerpt lines, and nothing after
line 65.

## Ranged Markdown ancestors

An ordinary ranged read of a `text/markdown` source prepends the direct
root-heading chain that contains each passage's first requested source line,
shallowest first. This applies to host paths, `file://`, `kb://`, `skill://`, and
web renders labeled `text/markdown`; the preceding context line does not choose
the chain. Each heading contributes only its own source lines, in source order,
with an ordinary `N:` prefix followed by a space: an ATX heading contributes one
line, and a setext heading contributes all of its text lines and its underline
verbatim. No excerpt line or outline 120-code-unit cut is added, and lines
already emitted by the passage window or an earlier chain are not repeated.

For a single range, emitting at least one ancestor promotes the result to the
existing plural `requestedRanges` and `shownRanges` shape. `requestedRanges`
contains only the requested interval; `shownRanges` includes the ancestor and
context intervals, merging adjacent intervals. If no ancestor line is emitted,
singular `requestedRange` and `shownRange` remain unchanged. A comma-separated
request is plural as usual; each merged passage gets the chain for its first
requested line. A chain emits only heading lines before its passage's first shown
line, and a chain line that would precede content already emitted is skipped, so
output stays in source order. Lines are deduplicated by source line against every
earlier emitted passage or chain. Ancestors never enter `requestedRanges`.

For example, if `VISION.md` has `# Level one` at line 13, `## Level two` at line
32, and `### Level three` at line 54, a read of `VISION.md:60-72` includes the
ordinary context lines at 59 and 73:

```text
13: # Level one
32: ## Level two
54: ### Level three
59: <context line>
60: ... through 72: <requested lines>
73: <context line>
```

The result reports `requestedRanges: [{startLine: 60, endLine: 72}]` and
`shownRanges` covering `{13,13}`, `{32,32}`, `{54,54}`, and `{59,73}`.

The scanner sees only the lines through the selected window's end and is ended
there; it never reads past that window. A role still undecided at the boundary
counts as a non-heading, including an open paragraph that might become a setext
heading and an unclosed line-one `---` block, which is replayed as Markdown. CPU
for a large-offset Markdown read scales with the offset because every skipped line
is parsed.

Ancestor lines count against the shared 2,000-line ceiling and serialized result
bound. If the chain plus the N-1 context line (when shown) and line N do not fit,
whole heading units are dropped from the outermost end first until the deepest
remaining heading fits. An oversized outer heading is an unrenderable unit and is
skipped during trimming. A setext heading's text lines and underline are one unit.
If even the deepest heading is unrenderable or does not fit, the chain is
silently absent and the passage window is still returned when it can fit.
`nextOffset` continues to identify the next requested source line, never an
ancestor line; a continuation at `nextOffset + 1` computes a fresh chain, so a
heading may reappear.

`:raw`, `:outline`, directory reads, unselected reads, empty files, and
non-Markdown sources remain unchanged. Ancestors are chosen only after the
existing source resolution and permission admission, so permissions, source
identity, Knowledge attribution and untrusted-content notice, web provenance, and
result envelopes are unchanged. Heading lines and their coordinates are
untrusted, execution-time navigation metadata rather than a snapshot, hash, lock,
or authority token; a later read reauthorizes and rereads the current source.

## Result bounds

Line numbers are display metadata, not source. Continuation uses zero-based
`nextOffset`; add one when composing the next one-based read selector. For
multi-range reads, trim `requestedRanges` at `nextOffset + 1` (dropping fully
shown ranges) and re-run the same selector pipeline; context lines may reappear,
as in single-range continuations.

Native files have no blanket size cap. Reads stream a bounded window; exact
editing currently buffers the file in memory. Normal reads default to 2,000
requested lines, plus available adjacent context. Multi-range reads share the
same 2,000-line ceiling across all passages. Serialized native results are
bounded to the shared 16,000 UTF-16 code-unit cap and retain whole source lines.

File outlines stream the source and have no whole-file input ceiling, but the
shared 2,000-emitted-line and 16,000-UTF-16-code-unit result bounds still apply.
When those bounds cut an outline, `truncated` is true and `nextOffset` is the
zero-based index of the first omitted entry's source line. Resume with
`:outline:<nextOffset + 1>-M`; a cut at the frontmatter elision line reports the
closer's source line.

## Media types and errors

The outline reader is selected by source media type, never by heading-looking
text. Host, `file://`, `kb://`, and `skill://` regular files map
case-insensitively by extension: `.md`, `.markdown`, `.mdown`, and `.mkd` map to
`text/markdown`; `.mdx` is excluded; every other extension has no outline reader.
An unsupported member returns `invalid_selector` with:

> The :outline member reads text/markdown content only; read this source without it.

A web read's method ladder decides its label, so a rendered document may or may
not support `:outline`; see [web](locators/web.md).

An outline request on a host, `file://`, `kb://`, or `skill://` directory, or on
a web adapter directory, returns `invalid_selector` with:

> The :outline member is not supported for directory reads.

The skill catalog (`skill://:outline`) returns `invalid_selector` with:

> The :outline member is not supported for the skill catalog.

If the web plane cut an adapter document at its 5 MiB document bound, `:outline`
returns `representation_too_large` and no partial outline, with:

> The adapter document was cut at the web read's document bound, so an outline would omit structure; read it without :outline.

The ordinary adapter read still returns its cut document and note.

Admission, permission checks, owner resolution, and content acquisition finish
before media-type derivation or Markdown scanning. A denied submitted locator
therefore fails like an ordinary read and is never parsed. `:outline` runs over
the rendered adapter document; `:raw` is the only member that bypasses adapters.

Headings, excerpts, frontmatter keys, and every other emitted line remain
untrusted content. They cannot change tool availability, owner identity,
permissions, or source authority, and a line number grants no access beyond the
original locator. Outline line numbers are execution-time navigation coordinates,
not a snapshot, hash, lock, or authority token: a later read reauthorizes and
rereads the current source, so an old range may return different text.

## Configured by

- [Native files](../operator/native-files.md) enables the host executor and the
  `read` entry.
- [Web reads](../operator/web-read.md) configures web adapters; the web document
  bound is fixed.

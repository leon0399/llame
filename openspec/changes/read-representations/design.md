## Context

See [proposal.md](proposal.md) for motivation and the observable contract.
This change owns plane 3 of the three-plane read architecture:

```text
source authority -> web service adapter/render (http/https only)
                 -> representation reader -> shared selector/result envelope
```

Plane 1 (host paths, the `file://` alias, `kb://`, `skill://`) and plane 2
(the web ladder and the adapter plane) are shipped on `master`. This change
consumes both, adds no authority, and issues no network request.

Today `executeNative` decodes a `file:` alias to a host path, then dispatches
`kb`, `skill`, and `http(s)` before the host branch and refuses other schemes
(`apps/api/src/tools/native-files.ts:69-106`). Authorized scheme readers call
`readResolvedFile` with a display path, selector, envelope reservation,
symlink policy, and abort signal. The result primitives carry
`representation`, content, range metadata, truncation, and `nextOffset`, with
a 2,000-line ceiling and a 16,000-code-unit serialized result cap
(`packages/native-file-tools/src/source-lines.ts:4-10`).

The host selector parser gives an existing literal path precedence, then
recognizes the `:raw` form before a last-colon numeric fallback
(`packages/native-file-tools/src/path.ts:221-277`). Knowledge and Skill split
a selector before decoding path segments. Web splits only after a path
separator and never inside a query or fragment
(`apps/api/src/tools/web-read/locator.ts`).

The web pipeline labels each result with its ladder stage or `adapter`
(`apps/api/src/tools/web-read/pipeline.ts`). A rendered adapter outcome
carries `content`, optional `origin` and `directory`, and `notes`, but no
media type (`apps/api/src/tools/web-read/adapters/contract.ts:46-60`); the
GitHub adapter renders Markdown documents without saying so, and the rewrite
adapter discards the `method` its inner render reported
(`apps/api/src/tools/web-read/adapters/rewrite.ts:65-77`). An adapter
document over 5 MiB is cut at the last newline with a `document truncated:
too_large` note (`contract.ts:211-213`).

No API or native package owns a Markdown parser. `mdast-util-from-markdown`
2.0.2 and `micromark` 4.0.2 are in the lockfile through `packages/ui`.
micromark's tokenizer buffers every chunk and returns its event list only on
the final write (`micromark/lib/create-tokenizer.js:134-147`), so it cannot
drive a streaming outline; its `stream.js` streams input and emits output at
`end`.

## Goals / Non-Goals

**Goals:**

- Put one explicit representation decision between authorized source content
  and the existing selector/result machinery, keyed so that later readers
  (code symbols, JSON or YAML keys, converted documents) are new table rows.
- Make the Markdown outline deterministic, verbatim, source-addressable, and
  bounded by output rather than input.
- Produce a structure primitive that #544 indexing and the later
  ancestor-context change for ranged reads consume as-is.
- Preserve source identity, permission, attribution, truncation, and
  untrusted-content behavior.

**Non-Goals:**

- A runtime reader registry, dynamic plugin loader, or operator-supplied
  reader.
- Binary, PDF, image, JSON query, notebook, or code-outline implementation.
- Ancestor context or non-contiguous shown ranges on ordinary ranged reads.
- Source snapshots, caches, index rows, model summaries, frontmatter parsing
  or writes, or new authority and permission rules.

## Decisions

### D1: A compile-time reader table keyed by media type and member

**Decision:** After source admission and content acquisition, select a reader
from a static table keyed by `(media type, member)`. The table has the
existing `raw` member and `outline` for `text/markdown` at introduction. It is
code-owned: no configuration, no dynamic import. With no member named, the
existing text read is unchanged. A member requested for a media type the table
does not map returns `invalid_selector` naming the member's accepted media
types.

Members belong to one of two output classes. A `:` member (`raw`, `outline`)
returns verbatim source lines with the ordinary prefixes and a shown range. A
`?` member would return transformed content with no prefixes and no shown
range; none exists in this change and its grammar is not defined. The class
is a property of the reader so that a later `jq` reader over
`application/json` is a table row and a renderer, not a new seam.

**Alternatives rejected:**

- Source-specific `if` branches adding `outline` in every executor. Duplicates
  selector, bounds, and envelope logic across host, Knowledge, Skill, and web.
- A generalized registry with extension points. Violates
  `CODING_STANDARDS.md` without a present need; the table is the extension
  point.
- Operator-configured readers. A reader sees admitted content; an
  operator-supplied one is an authority and supply-chain surface.

**Consequence:** The later code outline is `(text/x-<language>, outline)`
rows over a tree-sitter producer of the same primitive. Byte-level readers
define their own input contract rather than widening this one.

### D2: `outline` spelling, grammar, and splitter precedence

**Decision:** The slot accepts `:raw`, `:raw:<ranges>`, `:outline`, and
`:outline:<range>` where the range is one `N`, `N-M`, or `N+K` and never a
comma list. The outline form is recognized with the same suffix shape as the
raw form (`/:outline(?::([^:/]*))?$/` beside the shipped
`/:raw(?::([^:/]*))?$/`), after the raw form and before the last-colon
numeric fallback, and its member text is then validated, so `:outline:1,3` is
`invalid_selector` rather than a path ending in `:outline` plus a multi-range.
`:outline:raw` and `:raw:outline` are not members; each source applies its
shipped precedence. Knowledge and Skill split before decoding and reject an
invalid suffix with `invalid_path`. Web splits after a path separator, never
inside query or fragment text, and recognizes the outline form before its
last-colon fallback.

`outline` is the name because it is the established term for the union this
slot will cover: editor outline panels are fed by LSP `documentSymbol` and
show Markdown headings, code symbols, and JSON keys through one interface.
`toc` names a document artifact and is wrong for a class; `overview` and
`summary` suggest generated prose. One name lets the tool description stay
at one sentence.

**Consequence:** The model sees one short, copyable name. A prefixed line in
an outline is an ordinary selector line on the same locator.

### D3: A pure reader over decoded text, before shared paging

**Decision:** The reader receives admitted decoded text, the source display
identity, and the selector's scope. It returns the lines to emit. It has no
authority resolver, filesystem port, network port, permission callback, owner
identity, or envelope mutator. The shared result code bounds the lines; the
source executor merges its normal envelope afterwards. A successful outline
is the existing file success object with `representation: "outline"`; web,
Knowledge, and Skill wrappers add their existing fields exactly as they do for
text.

**Alternatives rejected:**

- Pass a host path or Knowledge handle to the reader. Lets a representation
  reopen or escape the source.
- Let each reader serialize its own envelope. Makes a Knowledge notice or web
  provenance optional.
- Parse before permission admission. A denied path must fail like a plain
  read without opening content.

### D4: Media type from the source, and adapters label their documents

**Decision:** Host, `file://`, `kb://`, and `skill://` regular files map by a
code-owned extension table: `.md`, `.markdown`, `.mdown`, `.mkd` to
`text/markdown`; `.mdx` excluded because JSX is not CommonMark; every other
extension to no representation-eligible type. The web ladder labels by stage:
`text/markdown` for a `negotiated` `text/markdown` response and for
`alternate`, `md-suffix`, `readability`, and `llms-txt`; the served type for
`text` and for `negotiated` `text/plain`; none for `raw`.

The rendered adapter outcome gains a required `mediaType`. The GitHub adapter
labels issue, pull request, repository, and commit renders `text/markdown` and
a decoded blob by the file extension table. The rewrite adapter forwards the
type its inner render reports instead of discarding the method. The label is
internal and is not a result field (the canonical result requirement forbids a
`contentType` field). `:outline` runs after adapters, over the document a
plain read of the same locator returns; `:raw` keeps skipping them.

**Alternatives rejected:**

- Sniff headings or delimiters. Prose and code contain those strings.
- Treat all adapter output as Markdown. A JSON blob through the GitHub adapter
  would be outlined as Markdown.
- Refuse `:outline` over adapters. The most common web outline target, a
  repository README or an issue thread, is the one that would fail.

**Consequence:** One MODIFIED sentence in the adapter contract; a
`mediaType` field on the outcome type and its three producers.

### D5: A streaming block scanner, with mdast as the test oracle

**Decision:** `packages/native-file-tools/src/markdown-structure.ts` is a
hand-written CommonMark block-level state machine that yields root-level
spans in one forward pass. Its API:

```ts
type MarkdownSpan = {
  kind: "heading" | "frontmatter";
  depth: number; // 1-6 for headings, 0 for frontmatter
  line: number; // one-based first source line
  headEnd: number; // one-based last heading line (the setext underline)
  endLine: number; // one-based last source line of the section
  label: string; // verbatim first source line
};

scanMarkdownStructure(
  lines: Iterable<string>,
  onSpan: (span: MarkdownSpan) => boolean, // false stops the scan
): void;
```

It tracks: ATX headings (indent ≤ 3, `#{1,6}` then space or end); setext
headings (paragraph lines then a `=` or `-` underline with indent ≤ 3, which
also settles thematic break versus setext); fenced code open and close;
indented code; the seven HTML block kinds and their closers; blockquote and
list-item containment with content-offset continuation, so a heading inside a
container is skipped; and the closed line-one frontmatter span. It performs
no inline parsing: heading lines are emitted verbatim, so link text, code
spans, and images need no normalization. Positions use the native LF line
model from `splitSourceLines`.

Memory is the open-heading stack (at most 6), block state, and whatever the
consumer keeps: the outline keeps only the lines it will emit, bounded by the
result cap, and stops the scan after the scope end or when the budget is
spent; #544 keeps one record per heading.

Conformance is proved by a differential suite: `mdast-util-from-markdown`
(already in the lockfile, MIT) becomes a dev dependency of the native package
and the suite asserts that the scanner's root-heading lines equal mdast's
over the CommonMark spec examples and the repository fixtures (ATX, setext,
duplicates, fenced and indented code, HTML blocks, list and blockquote
headings, closed and unclosed frontmatter, lone CR, CRLF, trailing LF, two
headings on one native line). A disagreement is a scanner defect fixed in the
parser layer.

**Alternatives rejected:**

- `mdast-util-from-markdown` at runtime. Whole-document AST at roughly 10-20×
  the input size forces an input ceiling; a 16 MiB ceiling would keep a
  worst-case call under about 300 MiB, and the stated purpose of outlines is
  files too large to read whole.
- `micromark` streaming. Its tokenizer buffers all chunks and resolves events
  only at the end (`create-tokenizer.js:134-147`), so it is whole-document
  with a lower-level API.
- A heading regex. Mishandles fences, HTML blocks, setext, containers, and
  indentation; the state machine is the difference.

**Consequence:** No runtime parser dependency; no input ceiling for file
sources; one primitive for three consumers.

### D6: Output is verbatim prefixed source lines

**Decision:** The outline emits source lines with the ordinary `N:` prefix and space,
in source order: both frontmatter delimiters and column-zero key lines (D7);
the root section's first non-blank non-heading line; and for each root
heading its heading lines (ATX: one; setext: text lines plus underline)
followed by its section's first non-blank non-heading line, whatever that
line is (a fence opener counts and tells the model the section is code). A
heading followed directly by a heading or EOF has no excerpt. Lines are cut
at 120 UTF-16 code units with `…`. A headingless document emits its
frontmatter and root excerpt; an empty document returns the ordinary
empty-file result.

The prefix convention is the one every other read result already uses, so
nothing new is described to the model. The section end is derivable (next
heading of depth ≤ own, else EOF) and is not printed. A setext heading shows
its underline so depth stays readable without synthesizing `##`.

**Alternatives rejected:**

- `<"#"×depth> <text> [N-M]` lines (the earlier draft). A second convention,
  synthesized text, and a redundant end coordinate.
- Headings only, no excerpt. Duplicate headings need a follow-up read to tell
  apart; the excerpt is the Markdown analogue of a code outline's signature.
- Excerpt only for duplicate headings. Non-uniform output needs explaining.

### D7: Frontmatter as key lines, never parsed

**Decision:** A closed line-one `---` block (closer `---` or `...`, CRLF
tolerated by stripping one trailing CR and trailing blanks from the delimiter
match) is excluded from heading recognition and shown as its two delimiter
lines plus every column-zero key line, meaning a line whose first character
is not whitespace, `#`, or `-`. Indented lines, comments, and sequence items
are omitted. After 32 key lines, one generated line
`[… N more frontmatter lines]` replaces the rest. No YAML, TOML, or JSON
parse; a block that would not parse shows its lines like any other, with no
note. An unclosed opener is ordinary Markdown.

Skills, Obsidian, Jekyll, OKF, and Hugo all use closed `---` YAML with
different keys, so the rule is key-agnostic and the model sees the same
information a read of lines 1-N would show. The key budget keeps a
property-heavy vault note from spending the outline on metadata.

**Alternatives rejected:**

- Parse YAML and emit marked `title`/`description` lines (the earlier draft).
  A parser, a cap, a marker, and a malformed note, for two keys.
- Emit the whole block. A 40-line header takes 40 outline lines.
- Recognize `+++` TOML and JSON openers. One Hugo option; a later table row
  if wanted.

### D8: Scope restricts, ancestors are prepended

**Decision:** `:outline:N-M` (and `:outline:N`, `:outline:N+K`) emits only
lines in the scope, preceded by the direct ancestor chain of line `N`: the
root headings whose sections contain `N`, shallowest first, rendered like
in-scope headings, each omitted when already in scope. Frontmatter and the
root excerpt appear only when in scope. A scope starting past the last line
fails as an ordinary range past the end does. This is the query the later
ancestor-context change makes on ranged reads; it is built and tested here
against the primitive without touching the ordinary read path.

**Alternatives rejected:**

- Page outline output lines (the earlier draft). Prefixes would count source
  lines while the selector counted output lines.
- Scope without ancestors. A scoped outline would not say what encloses it,
  and `:outline:N` would answer nothing.

### D9: Bounds are output bounds

**Decision:** File sources have no input ceiling; the abort signal and the
shared 2,000-line and 16,000-code-unit result caps bound the call, and the
scan stops after the scope end or when the budget is spent. A truncated
outline sets `truncated` and reports `nextOffset` as the source line of the
first omitted entry, so `:outline:<nextOffset>-M` continues against the
source observed then. Web bodies and adapter documents keep the web plane's
5 MiB bounds; an adapter document the web plane already cut fails
`representation_too_large` with no partial outline, because an outline of a
cut document would omit structure silently. `representation_too_large` stays
in the closed `NativeFileError` union for that case.

**Alternatives rejected:**

- A 5 MiB whole-file loader (the earlier draft). Unneeded once the scanner
  streams.
- Outline the truncated adapter text with the note. The last section's
  implied end is the cut, not the document.

### D10: Source envelopes and web provenance are preserved

**Decision:** The reader runs only after the source resolver and web renderer
have completed. Host and `file://` retain path identity; `kb://` retains
Space id/name and the untrusted notice; `skill://` retains locator, resolved
path, and skill directory; web retains `path`, `finalUrl`, `method`, the
`adapter` object, and `notes`. The reader never receives credentials,
resolved Knowledge roots, executor identities, or adapter secrets. A heading
is untrusted data with no ability to alter source decisions or tool
authority.

### D11: Coordinates are execution-time, not a snapshot

**Decision:** Outline line numbers describe the source observed during that
call and are navigation hints for a later ordinary read, not a content hash,
lock, or authority token. A later call reauthorizes and rereads. Heading text
is never a selector.

## Reserved for the ancestor-context follow-up

Ranged reads of structured files will prepend the direct ancestor chain of
the requested range and, for code, enclosing declarations. That change
consumes `scanMarkdownStructure` (D5) and the ancestor query (D8) as they
are; what it adds is a result-envelope change for a non-contiguous shown
range and its rendering, which are its own proposal. Nothing in this change
needs to move for it.

## Risks / Trade-offs

- **[Risk]** The scanner disagrees with CommonMark on a container or HTML
  block edge case. **Mitigation**: the differential suite over the spec
  examples in the parser layer; a failure is fixed there.
- **[Risk]** Heading or excerpt text can contain prompt-injection
  instructions. **Mitigation**: keep every emitted line as ordinary untrusted
  tool output; preserve the Knowledge notice and web provenance; never route
  parsed text into authority or tool selection.
- **[Risk]** A selector parser change reinterprets a literal host filename or
  a web port/query. **Mitigation**: preserve host literal probing, scheme
  split order, web `opensSelector` rules, and encoded-colon behavior; add
  focused tests for all source splitters.
- **[Risk]** Adding `mediaType` to the adapter outcome touches three
  producers. **Mitigation**: the field is required, so the type checker
  finds every producer; the GitHub and rewrite tests assert the label.
- **[Risk]** A source mutation between outline and section read makes a line
  number stale. **Mitigation**: state execution-time coordinates and no
  snapshot in the result contract.

## Migration Plan

1. Merge the proposal layer after strict OpenSpec and Markdown checks and
   proposal approval. No application behavior changes on this branch.
2. Land `parser`: the scanner, the primitive, the dev-only oracle, and the
   differential suite. `outline` is not advertised yet.
3. Land `outline`: the reader table, selector grammar on all four splitters,
   media-type labels including the adapter field, the outline reader and
   scope/ancestor rendering, prompt/docs, changelog, and `Closes #572`.
4. Enter `read-representations/finalize` with `$gh-stack` before any
   `$openspec-sync-specs` invocation; synchronize and archive after every
   implementation task and review gate is complete.
5. Rollback is a clean cutover: remove the outline reader, the scanner, and
   the adapter label together. No database rows or migrations exist.

## Open Questions

None on product or contract. The differential suite in D5 is the one gate
before the parser layer is published.

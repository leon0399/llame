## Why

`read` resolves host files, `file://`, `kb://`, `skill://`, and web content
through one bounded result path, but its selector grammar has no way to ask
for anything other than a window of lines. #572 needs a deterministic
Markdown outline that lets a model find where to read next in a file too
large to read whole, and #801 needs the same slot, output convention, and
structure primitive later for code. This change adds the representation seam
those need without the speculative extractor framework both issues reject,
and it makes the seam the place where later readers (code symbols, JSON or
YAML keys, converted documents) plug in at compile time.

## What Changes

- Add a representation slot with the members `raw` and `outline`. `raw`
  keeps its existing range forms. `outline` takes at most one source range
  (`:outline:N`, `:outline:N-M`, `:outline:N+K`) that scopes the outline to
  those source lines. Host and web splitters recognize the outline form after
  the raw form and before their last-colon fallback; Knowledge and Skill
  validate it as a member of the shared grammar.
- Add a content-reader boundary after source resolution, authorization, and
  content acquisition and before shared selector paging, result bounds, and
  source envelopes. Readers are a compile-time table keyed by media type and
  member. A reader receives only admitted decoded text, source display
  identity, and the selector's scope; it cannot resolve authority, open a
  path, issue a request, or alter Knowledge, Skill, or web attribution. A `:`
  member returns verbatim source lines with the ordinary prefixes; a future
  `?` member would return transformed content, and none exists here.
- Derive the media type from the source, never from the body: a code-owned
  extension table for files (`.md`, `.markdown`, `.mdown`, `.mkd`; `.mdx`
  excluded), the ladder stage for web renders, and a new required media-type
  label on every rendered web adapter document. `:outline` runs over the
  document an adapter produced, so a GitHub issue, pull request, repository,
  or README read through the adapter can be outlined.
- Define the outline as the document's structural lines, verbatim and
  prefixed with their source line numbers: the frontmatter delimiters and
  top-level keys, the root section's first body line, and for each root
  heading its heading line(s) followed by its section's first body line. A
  setext heading shows its text line(s) and underline. Lines longer than 120
  code units are cut with `…`. Nothing else is generated except one
  frontmatter elision line.
- Define deterministic structure: document-level CommonMark ATX and setext
  headings only, with headings inside list items, blockquotes, fenced and
  indented code, HTML blocks, and frontmatter excluded. A section ends before
  the next heading of the same or shallower depth, or at the last line.
  Section ends are used for scoping and ancestors and are not printed.
- `:outline:N-M` restricts output to lines in the scope and prepends the
  direct ancestor chain of line `N`, so a scoped outline is self-describing
  and `:outline:N` answers "what encloses line N". This is the ancestor query
  a later change reuses for ranged reads.
- Show frontmatter without parsing it: a closed line-one `---` block emits
  its delimiter lines and every column-zero key line, up to 32 keys and then
  `[… N more frontmatter lines]`; indented lines are omitted. No YAML, TOML,
  or JSON parser, no malformed-frontmatter note; an unclosed opener is
  ordinary Markdown.
- Scan Markdown in one forward pass with a block-level state machine in the
  native package, holding only the open-heading stack and the lines to emit,
  so file sources have no input ceiling. `mdast-util-from-markdown` is a
  dev-only oracle in a differential test suite over the CommonMark spec
  examples and repository fixtures; no runtime parser dependency is added.
  The pass stops after the scope or the result budget. A truncated outline
  reports `nextOffset` as the source line of the first omitted entry.
- Keep `representation_too_large` for one case: an adapter document the web
  plane already cut at its 5 MiB bound has no outline, because an outline of
  a cut document would omit structure silently. Directories, the skill
  catalog, and unsupported media types return `invalid_selector` naming the
  member's accepted media types; ordinary reads are unchanged.
- Preserve source identity, permissions, and attribution: host, `file://`,
  `kb://`, `skill://`, and web results retain their existing envelopes,
  including the Knowledge untrusted-content notice and the web `finalUrl`,
  `method`, `adapter`, and `notes`. Line numbers describe the source observed
  at execution and never imply a snapshot.
- Update the model-facing `read` description by one sentence, the operator
  documentation (including naming the existing ±1 behavior "context lines"),
  tests, and changelog in the implementation layers. Those files are not
  changed on this proposal branch.

This output supersedes the format sketched in #572 (`[N-M]` coordinates and
marked authored metadata lines): prefixed verbatim lines reuse the convention
every other read result already has, and the section end is derivable.

## Capabilities

### New Capabilities

None. The representation slot and the Markdown reader are requirements
within the existing native file capability, so source admission, result
envelopes, and permission behavior stay on the shipped `read` surface.

### Modified Capabilities

- `native-file-tools`: extend the selector grammar and common read pipeline
  with representation selection; require a media-type label on rendered web
  adapter documents and apply `:outline` after adapters; add the reader seam,
  outline format, section boundaries, frontmatter lines, scope and ancestors,
  bounds, and refusal behavior.

## Impact

- `packages/native-file-tools/src/path.ts` and the shared read/result helpers
  gain representation-aware selector parsing and outline output semantics.
  The current grammar is centralized in `isSelectorSuffix` and the host
  splitter (`packages/native-file-tools/src/path.ts:216-288`), while `kb://`,
  `skill://`, and web split selectors in their own locator modules. Host
  literal-path precedence and the `file:` alias decoding that precedes it
  (`apps/api/src/tools/native-files.ts:73-86`) are unchanged.
- `apps/api/src/tools/native-files.ts` dispatches authorized decoded text
  through the reader seam after the source-specific resolvers and the web
  pipeline run. Existing dispatch and envelopes are preserved.
- A source-independent Markdown structure module lives in
  `packages/native-file-tools/src/markdown-structure.ts`. It exposes a flat
  source-ordered span list (`line`, `endLine`, `depth`, `kind`, `label`) and
  the frontmatter span. #544 can consume it for indexing, and the ancestor
  context follow-up for ranged reads queries it, without either depending on
  outline output.
- `apps/api/src/tools/web-read/adapters/contract.ts` gains a required media
  type on the rendered outcome; the GitHub adapter labels its renders and
  decoded blobs, and the rewrite adapter forwards its inner render's type
  instead of discarding it (`apps/api/src/tools/web-read/adapters/rewrite.ts:65-77`).
- No runtime dependency is added. `mdast-util-from-markdown` (already in the
  lockfile through `packages/ui`) becomes a dev dependency of the native
  package for the differential suite only.
- The implementation stack closes #572 on its outline layer. #801 remains
  blocked by #572 and is not closed here. #544 shares only the structure
  primitive. Ancestor context on ranged reads is a follow-up issue over that
  primitive. Related decisions are tracked in #544, #573, #705, #916, #927,
  #932, #935, and #938.

## Non-goals

- No model-generated synopsis, heading-name selector, source snapshot, index,
  embedding, search path, or frontmatter mutation.
- No PDF, image, JSON, or code-outline reader implementation. #801 defines
  the code outline and reuses the slot, reader table, output convention,
  bounds, attribution, and primitive after this change ships.
- No `?` transforming member or its grammar; `jq`-style queries are later
  work that the output-class distinction leaves room for.
- No ancestor context on ordinary ranged reads and no non-contiguous `shown`
  range. That change consumes the primitive this change adds.
- No runtime reader registry, dynamic import, or operator-loaded reader. The
  table is static and code-owned.
- No new source authority, permission group, tool id, web request, adapter,
  credential, or envelope field. A representation cannot bypass source
  admission, owner isolation, path disclosure rules, or the Knowledge
  untrusted-content notice.

## Acceptance

- An authorized absolute Markdown path and equivalent authorized `kb://`
  content produce identical outline lines while retaining source-specific
  identity and attribution.
- `read path:outline` returns the frontmatter delimiter and key lines, the
  root excerpt, and each root heading with its first body line, every line
  verbatim with its ordinary `N:` prefix and space and no context lines; a setext
  heading shows its underline; lines over 120 code units end in `…`.
- A file with `# Title` at line 1, `## Setup` at line 30, `### Linux` at
  line 44, `### macOS` at line 70, and `## Use` at line 100 answers
  `:outline:60-90` with lines 1, 30, and 70 (plus excerpts) and `:outline:65`
  with lines 1, 30, and 44. Headings in fenced, indented, list, blockquote,
  and HTML blocks produce no entry.
- Duplicate heading text never chooses a section by name; each occurrence is
  its own prefixed line, and ordinary `:N-M` reads the selected section.
- A closed line-one frontmatter block emits its delimiters and column-zero
  keys with no parsing and no note; more than 32 keys elide with a count; an
  unclosed opener is ordinary Markdown.
- A GitHub issue, pull request, or Markdown blob read through the adapter can
  be outlined with `method: "adapter"` and the `adapter` object retained; a
  JSON blob returns `invalid_selector` naming `text/markdown`; a document the
  web plane truncated returns `representation_too_large`.
- `:outline:raw` and `:raw:outline` are not members and follow source
  precedence; a directory, the skill catalog, and an unsupported media type
  return `invalid_selector` while ordinary read is unchanged.
- A 200 MiB Markdown file is outlined in one pass; a truncated outline
  reports `nextOffset` as the first omitted entry's source line. Permission
  admission denies the submitted `:outline` locator before any scan.
  Coordinates describe the source observed for that execution, not a
  snapshot.

## Open questions

- The differential suite must show the block scanner agrees with
  `mdast-util-from-markdown` on root-heading lines over the CommonMark spec
  examples before the parser layer is published. A disagreement is a scanner
  defect to fix in that layer, not a design revision.

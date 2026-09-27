## Why

`read` already resolves host files, `kb://`, `skill://`, and web content through
one bounded result path, but its selector grammar has no way to ask for a
content-specific representation. #572 needs a deterministic Markdown outline
that lets a model discover source ranges before an ordinary read, and #801
needs the same reviewed slot and coordinate convention later. The change adds
the first real reader seam without creating the speculative extractor
framework both issues reject.

## What Changes

- Add a representation slot whose members are `raw` and `outline`, each
  optionally followed by the existing numeric range list. `:outline:<ranges>`
  pages outline output lines exactly; source ranges printed in that output are
  used with a subsequent ordinary read. Host and web splitters recognize the
  outline form before their last-colon fallback, while Knowledge and Skill
  selectors validate it as a member of the shared grammar.
- Add a content-type reader boundary after source resolution and authorization
  and before shared selector paging, result bounds, and source envelopes.
  Readers receive only admitted decoded text and source display identity. They
  cannot resolve authority, access a path, issue a request, or alter Knowledge,
  Skill, or web attribution. Future byte-level readers own a separate input
  contract.
- With no explicit member, keep the existing default text reader. An explicit
  member is accepted only when its declared content type is supported;
  `invalid_selector` names that member's accepted types, and ordinary read
  remains available.
- Implement the first non-default reader, Markdown `outline`, for Markdown
  content from authorized host paths and `kb://` locators, with the same
  structure and source coordinates. The same reader applies to `file://` once
  the sibling source change lands, to `skill://` Markdown resources, and to
  the current web ladder's Markdown outputs. Future adapter results count when
  an adapter labels its output Markdown; they do not block this change.
- Define deterministic Markdown structure: document-level CommonMark ATX and
  setext headings, with headings inside list items or blockquotes excluded;
  fenced and indented code and HTML blocks are excluded. Each output line is
  `<"#" repeated depth> <text> [<N>-<M>]`, with no generated line prefix or
  context. The section ends before the next heading whose depth is less than
  or equal to its own, or at the source's last line. Duplicate text is
  navigated by ranges, never by a heading-name selector.
- Surface authored frontmatter `title` and `description` as one-line,
  explicitly marked metadata lines. Every closed line-one `---` block is
  blanked before heading parsing; YAML parse errors and non-mappings emit a
  fixed note, while an unclosed opener is ordinary Markdown. Authored values
  collapse whitespace and are capped at 200 characters with a trailing `…`.
  A Markdown file without headings produces a defined minimal outline.
- Apply the ordinary result character and envelope bounds to outline output,
  but no generated prefixes or context expansion. Outline parsing has a
  bounded whole-input ceiling of 5 MiB, with `representation_too_large` above
  it; file-backed sources check size before reading and web bodies already
  obey their 5 MiB cap. `nextOffset` is the zero-based next outline line.
- For web, `negotiated` counts as Markdown only when the response
  `Content-Type` is `text/markdown`; `alternate`, `md-suffix`, `readability`,
  and `llms-txt` are Markdown. `text`, `raw`, and `negotiated` `text/plain`
  are not Markdown. A future adapter may opt in by labeling its output
  Markdown without making this change depend on that adapter.
- `:outline` on directories and unsupported content types returns
  `invalid_selector`, without changing directory listing or plain-read
  behavior. `:outline:raw` and `:raw:outline` are not representation members;
  host and web source precedence therefore keeps their shipped raw
  interpretation of `:outline:raw` as a path or URL ending in `:outline`,
  while Knowledge and Skill return `invalid_path` for either invalid suffix.
  A denied submitted `:outline` locator fails before parsing.
- Preserve source-specific identity, permissions, and attribution. Host,
  `file://`, `kb://`, `skill://`, and web sources retain their existing
  envelopes, including the Knowledge untrusted-content notice and web
  provenance. Coordinates describe the source observed at execution and never
  imply a snapshot.
- Update the model-facing `read` description, operator documentation, tests,
  changelog, and shared Markdown structure package in the implementation
  layers. Those files are not changed on this proposal branch.

## Capabilities

### New Capabilities

None. The new representation and Markdown reader are requirements within the
existing native file capability so source admission, result envelopes, and
permission behavior stay on the shipped `read` surface.

### Modified Capabilities

- `native-file-tools`: extend the selector grammar and common read pipeline
  with explicit representation selection; add the content-reader seam,
  Markdown outline format, source coordinates, frontmatter, bounds, and
  refusal behavior.

## Impact

- `packages/native-file-tools/src/path.ts` and the shared read/result helpers
  gain representation-aware selector parsing and output semantics. The
  current grammar is centralized in `isSelectorSuffix` and the host splitter
  (`packages/native-file-tools/src/path.ts:216-288`), while `kb://`, `skill://`,
  and web split selectors in their own locator modules. `outline` is distinct
  from `raw` and numeric members, and host literal-path precedence remains
  unchanged.
- `apps/api/src/tools/native-files.ts` will dispatch authorized decoded text
  through the reader seam after the source-specific resolvers run. Existing
  dispatch and envelopes are preserved (`apps/api/src/tools/native-files.ts:66-87`,
  `:145-166`, `:218-246`).
- A source-independent Markdown structure module will live in
  `packages/native-file-tools/src/markdown-structure.ts` and expose only
  headings, section coordinates, and frontmatter spans/metadata. #544 can
  consume this primitive for indexing without depending on overview output,
  index rows, or search readiness.
- `apps/api` currently has no Markdown parser dependency. `marked` is a direct
  dependency of `packages/ui`, while `apps/api` and
  `packages/native-file-tools` have none (`apps/api/package.json:44-85`,
  `packages/native-file-tools/package.json:17-29`,
  `pnpm-lock.yaml:720-749`, `:808-878`). The design compares available
  CommonMark parsers and assigns a bounded spike before any dependency is
  added.
- The sibling `file-locator` change owns the source plane and `file://` alias;
  the sibling `web-read-adapters` change owns the web service plane. This
  change consumes those sources and must not duplicate their authority or
  network policy.
- The implementation stack closes #572 on its outline layer. #801 remains
  blocked by #572 and is not closed here. #544 shares only the Markdown
  structure primitive. Related decisions are tracked in #544, #573, #705,
  #916, #927, #932, #935, and #938.

## Non-goals

- No model-generated synopsis, heading-name selector, source snapshot, index,
  embedding, search path, or frontmatter mutation.
- No PDF, image, JSON/JQ, or code-outline reader implementation. #801 defines
  the later code outline and reuses the slot, reader boundary, bounds,
  attribution, and coordinate conventions only after this change ships.
- No byte-level reader framework. The representation list is static and
  code-owned, with the existing text reader and the concrete Markdown outline
  as its two members at introduction; no runtime registry, dynamic import, or
  operator-loaded reader exists.
- No new source authority, permission group, tool id, web request, adapter,
  credential, or envelope field. A representation cannot bypass source
  admission, owner isolation, path disclosure rules, or the Knowledge
  untrusted-content notice.

## Acceptance

- An authorized absolute Markdown path and equivalent authorized `kb://`
  content produce equivalent outline headings, depths, text, and source `N-M`
  coordinates while retaining source-specific identity and attribution.
- `read path:outline` returns one output line per heading in the exact
  `<"#" repeated depth> <text> [<N>-<M>]` format, without generated line
  prefixes or context. Authored title and description lines start with
  `[authored ...]`, and malformed closed frontmatter emits `[note]` without
  blocking outline or ordinary read.
- A 12-line document with `# One` at line 1 and setext `Two` at lines 8-9
  reports `1-12` for `One` and `8-12` for `Two`. A section ends before the
  next heading whose depth is less than or equal to its own, or at the last
  source line. Headings in fenced, indented, list, blockquote, and HTML blocks
  do not produce entries.
- Duplicate heading text never chooses a section by name. Each occurrence has
  its own source range, and ordinary `:N-M` or multi-range selectors read the
  selected source section.
- `:outline:N-M` pages outline lines exactly, without prefixes or context, not
  source lines. A truncated outline reports the zero-based next outline line;
  emitted entries retain source coordinates in the native LF line model.
- A closed line-one frontmatter block is excluded from headings even when its
  YAML is malformed or not a mapping, and emits the fixed note in those cases.
  An unclosed line-one opener is ordinary Markdown with no frontmatter note.
  Authored values are one line, whitespace-collapsed, and capped at 200
  characters with a trailing `…`.
- `:outline:raw` and `:raw:outline` are not members and follow source
  precedence; a host or web `...:outline:raw` is the shipped raw read of a
  path or URL ending in `:outline`, while Knowledge and Skill return
  `invalid_path`. A directory
  request returns `invalid_selector`; an unsupported PDF, binary, JSON, plain
  text, or `.mdx` request returns `invalid_selector` naming the requested
  member's accepted Markdown types while ordinary read is unchanged.
- Outline parsing checks file-backed size before reading and returns
  `representation_too_large` above 5 MiB; web bodies use their existing cap.
  Permission admission denies the submitted `:outline` locator before any
  content-type detection or parsing, with the ordinary `permission_denied`.
  Coordinates describe the source observed for that execution, not a snapshot.

## Open questions

- The implementation spike must confirm the selected parser's CommonMark
  behavior, positional line data under the native LF line model, root-only
  heading walk, frontmatter blanking, bundle size, and MIT license before its
  dependency is added. If the spike fails, the parser comparison in
  `design.md` names the replacement and records why; product behavior does not
  change.
- The outline layer depends on the sibling source-plane branch only for
  `file://`. The current web ladder already labels its Markdown outputs, and
  future adapter labels are forward-compatible rather than a dependency. Any
  same-file conflict in `native-files.ts`, `read.md`, or docs is resolved by
  the later landing change, as recorded in `tasks.md`.

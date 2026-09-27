# Proposal

## Why

`read` already resolves host files, `kb://`, `skill://`, and web content through
one bounded result path, but its selector grammar has no way to ask for a
content-specific representation. #572 needs a deterministic Markdown outline
that lets a model discover source ranges before an ordinary read, and #801
needs the same reviewed slot and coordinate convention later. The change adds
the first real reader seam without creating the speculative extractor
framework both issues reject.

## What Changes

- Add an explicit representation slot to the trailing selector grammar. The
  first member is `outline`; existing `raw` and numeric range selectors keep
  their meaning. `:outline:<ranges>` pages the outline output, while the
  source ranges printed in that output are used with a subsequent ordinary
  read.
- Add a content-type reader boundary after source resolution and authorization
  and before shared selector paging, result bounds, and source envelopes.
  Readers are pure post-processors over decoded text and cannot resolve
  authority, access a path, issue a request, or alter Knowledge, Skill, or web
  attribution.
- Make the default reader the existing line-numbered text reader for every
  content type. An explicit representation is accepted only when the resolved
  content type supports it; otherwise `invalid_selector` names the supported
  Markdown types and ordinary read remains available.
- Implement the first non-default reader, the Markdown `outline`, for Markdown
  content from authorized host paths and `kb://` locators, with the same
  structure and source coordinates. The same reader applies to `file://` once
  the sibling source change lands, to `skill://` Markdown resources, and to
  web output only after the adapter or generic ladder has produced Markdown.
- Define deterministic Markdown structure: CommonMark ATX and setext
  headings, heading depth and hierarchy, fenced and indented code excluded,
  HTML blocks excluded, and YAML frontmatter at line 1 treated as authored
  metadata rather than a heading. Each heading line reports its source section
  as a one-based inclusive `N-M` range; duplicate text is navigated by ranges,
  never by a heading-name selector.
- Surface authored frontmatter `title` and `description` as explicitly marked
  outline header lines. Malformed frontmatter is ignored and produces a
  bounded note. A Markdown file without headings produces a defined minimal
  outline rather than an empty or inferred synopsis.
- Apply the ordinary result line, character, envelope, truncation, and
  `nextOffset` bounds to outline output. Outline parsing has a bounded whole
  input ceiling because it needs the complete decoded document; it never
  creates a snapshot or grants access beyond the ordinary source read.
- Refuse `:outline` on directories and unsupported content types with
  `invalid_selector`, without changing the directory listing or plain-read
  contract. A denied path fails with the same permission result as an
  ordinary read, before parsing. `:raw:outline` and `:outline:raw` are refused
  rather than composing incompatible representations.
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
- The sibling `read-file-locator` change owns the source plane and
  `file://` alias; the sibling `read-web-adapters` change owns the web service
  plane. This change consumes those sources and must not duplicate their
  authority or network policy.
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
  content produce equivalent outline headings, depths, and source `N-M`
  coordinates while retaining source-specific identity and attribution.
- `read path:outline` returns one bounded line per heading with indentation,
  heading text, and its source range. Authored title and description lines are
  marked as authored, and malformed frontmatter emits a note without blocking
  the outline or ordinary read.
- A heading's range starts at the heading block and ends immediately before the
  next heading of equal or greater depth, or at EOF. ATX and setext headings
  work; headings inside fenced or indented code and HTML blocks do not.
- Duplicate heading text never chooses a section by name. Each occurrence has
  its own source range, and ordinary `:N-M` or multi-range selectors read the
  selected source section.
- `:outline:N-M` pages outline lines, not source lines, under the existing
  line/result bounds. A truncated outline reports `nextOffset`; the ranges in
  emitted outline lines remain source coordinates.
- `:raw:outline` and `:outline:raw` fail with `invalid_selector`; a directory
  request fails with `invalid_selector`; an unsupported PDF, binary, or JSON
  representation fails with `invalid_selector` naming Markdown support while
  an otherwise-valid plain read is unchanged.
- Permission denial occurs before outline parsing and has the same
  `permission_denied` result as a plain read. Outline output carries no extra
  authority, and coordinates describe the source observed for that execution,
  not a snapshot.
- The implementation layers prove the parser and reader with focused tests,
  then run `pnpm exec openspec validate read-representations --strict`,
  `pnpm exec prettier --write <changed files>`, `pnpm format:check`,
  `pnpm lint:markdown`, and `git diff --check`.

## Open questions

- The implementation spike must confirm the selected parser's CommonMark
  behavior, positional line data, frontmatter handling boundary, bundle size,
  and MIT license before its dependency is added. If the spike fails, the
  parser comparison in `design.md` names the replacement and records why;
  product behavior does not change.
- The outline layer depends on the sibling source-plane branch for `file://`
  and on the sibling web-plane branch for rendered Markdown. Their integration
  must preserve this representation contract; any same-file conflict in
  `native-files.ts`, `read.md`, or docs is resolved by the later landing
  change, as recorded in `tasks.md`.

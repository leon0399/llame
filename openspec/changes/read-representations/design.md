# Design

## Context

See [proposal.md](proposal.md) for motivation and the observable contract. This
change owns plane 3 of the approved three-plane read architecture:

```text
source authority -> web service adapter/render (http/https only)
                 -> representation reader -> shared selector/result envelope
```

The source plane is owned by the sibling `read-file-locator` change. It drives
host paths, the `file://` alias, `kb://`, and `skill://` admission and
resolution. The web plane is owned by the sibling `read-web-adapters` change;
its operator-configurable delegated routes remain opt-in and preserve the
submitted source URL in provenance. This change must not duplicate either
plane, add authority, or issue network requests.

Today `executeNative` dispatches `kb`, `skill`, and `http(s)` before the host
branch and refuses other schemes (`apps/api/src/tools/native-files.ts:66-87`).
Authorized scheme readers already call `readResolvedFile` with a display path,
selector, envelope reservation, symlink policy, and abort signal
(`apps/api/src/tools/native-files.ts:145-166`, `:218-246`;
`packages/native-file-tools/src/read.ts:47-74`, `:117-160`). The result
primitives carry `representation`, content, range metadata, truncation, and
`nextOffset`, with a 2,000-line ceiling and shared serialized-result cap
(`packages/native-file-tools/src/source-lines.ts:1-40`, `:48-73`).

The host selector parser gives an existing literal path precedence, recognizes
a scheme before splitting, and accepts only `raw` or numeric range suffixes
(`packages/native-file-tools/src/path.ts:182-212`, `:216-288`). Knowledge and
Skill split a selector before decoding path segments
(`apps/api/src/knowledge/knowledge-locator.ts:34-65`,
`apps/api/src/skills/skill-locator.ts:46-98`). Web splits only after a path
separator and refuses selector splitting in queries or fragments
(`apps/api/src/tools/web-read/locator.ts:33-60`). The current packaged
instruction enumerates numeric, raw, and multi-range forms and says Markdown
processing is separate (`apps/api/src/prompts/tools/read.md:3-10`;
`docs/native-files.md:142-160`, `:219-225`).

Web rendering already labels its output methods and reports Markdown for
publisher and local rendered bodies (`apps/api/src/tools/web-read/pipeline.ts:1-33`,
`:104-115`, `:443-485`). The reader seam therefore consumes the body after a
web method wins, not before adapter selection. A Knowledge result must retain
its notice and attribution, and a Skill result must retain its path envelope.

No current API or native package owns a Markdown parser. `apps/api` has
`linkedom`, `turndown`, `yaml`, and the web conversion dependencies but no
Markdown structure parser (`apps/api/package.json:44-85`).
`packages/native-file-tools` has only its runtime-safety dependency and no
parser (`packages/native-file-tools/package.json:17-29`). The UI directly uses
`marked@16.4.2` while the lockfile contains `micromark@4.0.2`,
`mdast-util-from-markdown@2.0.2`, and `remark-parse@11.0.0` in the UI's
transitive graph (`packages/ui/package.json:25-38`,
`pnpm-lock.yaml:808-878`, `:7587-7627`).

## Goals / Non-Goals

**Goals:**

- Put one explicit representation decision between authorized source content
  and the existing selector/result machinery.
- Make Markdown outline structure deterministic, bounded, source-addressable,
  and shareable with #544 without coupling it to indexing.
- Preserve source-specific identity, permission, attribution, truncation, and
  untrusted-content behavior.
- Keep the first seam small enough that #801 can reuse reviewed conventions
  without forcing a common AST or byte-reader abstraction today.

**Non-Goals:**

- A runtime reader registry, dynamic plugin loader, operator-supplied code, or
  generic extractor framework.
- Binary, PDF, image, JSON query, notebook, or code-outline implementation.
- Source snapshots, caches, index rows, model summaries, frontmatter writes, or
  new authority and permission rules.

## Decisions

### D1: Keep representation dispatch as a static plane-3 list

**Decision:** After source admission and content acquisition, dispatch through a
code-owned ordered list containing the existing text reader/default and the
explicit Markdown `outline` reader. The list is not runtime-configurable and
its entries are not dynamically imported. An omitted representation selects the
content type's default, which remains text. An explicit name selects one reader
only after the content type is known.

This is a real seam, not a speculative framework. It has two concrete members
at introduction: the existing text default and the Markdown outline. Both are
needed by the shipped behavior, and both use the same selector and result
serializer. No PDF, image, JQ, or code reader is preallocated. #572 and #801
both forbid designing a generic extractor framework before a concrete first
outline exists; #544 requires a shared Markdown parser but explicitly excludes
using index infrastructure for universal overviews.

**Alternatives rejected:**

- Keep source-specific `if` branches and add `outline` inside every source
  executor. This duplicates selector, bounds, and envelope logic and makes
  host, Knowledge, Skill, and web behavior drift.
- Add a generalized reader registry with extension points for every future
  format. That would violate `CODING_STANDARDS.md:38-41` and the explicit issue
  boundaries without a present implementation need.
- Let operators configure readers. Reader code is trusted and static; an
  operator-controlled reader would be an authority and supply-chain surface.

**Consequence:** Adding the later code outline is a new concrete reader and a
static entry, not a new abstraction design. The list's order is observable only
for applicability conflicts; `outline` is explicit and cannot silently replace
text.

### D2: Use `outline` as the representation spelling

**Decision:** The representation slot accepts `:<name>` or
`:<name>:<ranges>`. This change reserves `outline` and
`outline:<numeric-range-list>`. `raw` remains the existing representation and
its `raw:<ranges>` form. `:raw:outline` and `:outline:raw` are invalid rather
than a composition of two readers.

`outline` does not match the current selector keywords or numeric grammar:
`isSelectorSuffix` currently admits only `raw` and numeric members
(`packages/native-file-tools/src/path.ts:216-225`). A host path whose complete
literal spelling exists still wins before splitting (`packages/native-file-tools/src/path.ts:182-212`),
so a real filename ending in `:outline` retains literal-path behavior. In
`kb://` and `skill://`, the first raw colon after the logical path/name opens
the selector and a literal colon remains percent-encoded
(`apps/api/src/knowledge/knowledge-locator.ts:44-65`;
`apps/api/src/skills/skill-locator.ts:61-80`). In web locators, a colon can
open a selector only after the path separator and never inside query/fragment
text (`apps/api/src/tools/web-read/locator.ts:33-60`). Thus `outline` adds no
new interpretation of a legitimate port, query, fragment, or encoded path
colon.

**Alternatives rejected:**

- `toc`: familiar but describes a presentation rather than the source
  representation and is less reusable for later structural outlines.
- `overview`: matches issue prose but suggests a generated synopsis and is
  ambiguous with future #574 enrichment.
- `summary`: collides conceptually with code summaries and implies content
  omission rather than heading navigation.
- A query key or `:representation=outline`: query ownership is source/web
  specific and would break the one trailing-selector split. The slot requested
  by #938 is the shared future surface.

**Consequence:** The model sees one short, copyable name. The output range
shown in an outline is an ordinary source suffix, while a range after
`outline` pages outline lines. There is no name-based selector, so duplicate
headings cannot select the wrong occurrence.

### D3: Apply a pure reader over decoded text, before shared paging

**Decision:** The reader boundary receives the already-authorized decoded text,
source display identity, content type, selected representation name, and the
call's ordinary budget context. It returns generated text plus its
representation label. It has no authority resolver, filesystem port, network
port, permission callback, owner identity, or envelope mutator. The shared
selector/result code then pages and bounds the returned text; the source
executor merges its normal envelope afterwards.

The Markdown parser itself is pure and source-independent. The outline reader
uses it to produce text lines, then the shared line serializer applies
`requestedRange`, `shownRange`, `requestedRanges`, `shownRanges`, truncation,
and `nextOffset` to outline output lines. The generated source coordinates are
part of the text, not a second authority channel.

**Alternatives rejected:**

- Pass a host path or Knowledge handle to the reader. That allows a
  representation to reopen or escape the source and risks dropping owner
  framing.
- Let each reader serialize its own result envelope. That duplicates result
  bounds and would make a Knowledge notice or web provenance optional.
- Run representation parsing before permission admission. A denied path must
  fail like a plain read without opening or parsing content.

**Consequence:** There is no envelope schema migration. A successful outline
uses the existing file success object with `representation: "outline"`; web,
Knowledge, and Skill wrappers add their existing fields exactly as they do for
text.

### D4: Detect Markdown by source-aware content type, not body appearance

**Decision:** Host, `file://`, `kb://`, and `skill://` regular files use a
code-owned extension table: `.md`, `.markdown`, `.mdown`, and `.mkd` map to
Markdown. `.mdx` is deliberately excluded because JSX and embedded component
semantics are not CommonMark and no MDX parser is being added. Other extensions
remain text by default and cannot select `outline`.

For web, the representation sees the final rendered content type. A response
served as `text/markdown` is Markdown. An adapter or generic ladder render
counts as Markdown only when that renderer labels its output Markdown. The
reader does not infer Markdown from `text/plain`, JSON, XML, raw HTML, or
heading-looking bytes. The web pipeline's existing renderer is the authority
for whether a body was rendered (`apps/api/src/tools/web-read/pipeline.ts:431-485`).

**Alternatives rejected:**

- Sniff the first heading or delimiter. Prose and code can contain those
  strings, producing false positives and making representation selection
  content-dependent.
- Treat every `text/*` body as Markdown. JSON, XML, and plain text would gain a
  parser unexpectedly, changing the existing web contract.
- Add a MIME database for local files. The initial extension table is explicit,
  auditable, and sufficient for #572; byte-level detection belongs to later
  readers with their own evidence.

**Consequence:** An explicit unsupported request returns `invalid_selector`
with Markdown types named, while ordinary text or raw reading follows the
existing contract. The host extension table applies equally to `file://` once
plane 1 lands, and no source gets a hidden Markdown exception.

### D5: Share a small Markdown structure parser from the native package

**Decision:** Put the source-independent parser in
`packages/native-file-tools/src/markdown-structure.ts`, exported through the
package entry point for #544 and API readers. Its minimal API is:

```ts
type MarkdownHeading = {
  depth: number;
  text: string;
  startLine: number;
  endLine: number;
};

type MarkdownFrontmatter = {
  startLine: 1;
  endLine: number;
  malformed: boolean;
};

type MarkdownStructure = {
  headings: ReadonlyArray<MarkdownHeading>;
  frontmatter?: MarkdownFrontmatter;
};

parseMarkdownStructure(source: string): MarkdownStructure;
```

`endLine` on a heading is the computed section boundary, not just the syntax
block. The parser recognizes ATX and setext headings through CommonMark, keeps
original one-based lines when frontmatter is blanked, and excludes fenced and
indented code and HTML blocks through the parser's block model. It reports a
line-one frontmatter span separately; the API outline reader uses the existing
`yaml` dependency to inspect only scalar `title` and `description` values. The
parser does not render HTML, execute directives, mutate source, or construct
index rows. #544 can use headings, line boundaries, and the frontmatter span
without importing the read result or relying on an index.

The dependency decision follows the repository inspection:

| Candidate                  | Observed version and license                                                                                                                                              | Position/conformance                                                                                            | Cost and decision                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `marked`                   | 16.4.2 direct in UI; MIT (`node_modules/.pnpm/marked@17.0.6/node_modules/marked/package.json:1-5`, `:31-40`)                                                              | Fast token stream, but heading line positions are not the primary API and section offsets need custom tracking  | Small migration because UI already uses it, but extra line-tracking and token-shape coupling make it second choice         |
| `micromark`                | 4.0.2 in lockfile; MIT and explicitly CommonMark/positional (`node_modules/.pnpm/micromark@4.0.2_supports-color@8.1.1/node_modules/micromark/package.json:1-5`, `:26-27`) | Strong conformance and concrete positional events, but heading text extraction and block grouping are low-level | Small parser core, more code in the shared module; viable fallback                                                         |
| `mdast-util-from-markdown` | 2.0.2 in lockfile; MIT (`node_modules/.pnpm/mdast-util-from-markdown@2.0.2_supports-color@8.1.1/node_modules/mdast-util-from-markdown/package.json:7-21`, `:67-68`)       | Uses micromark, exposes MDAST node positions with heading depth and CommonMark semantics                        | **Selected.** Direct dependency in the native package gives the minimal AST boundary without unified's processor pipeline  |
| `remark-parse`             | 11.0.0 in lockfile; MIT (`node_modules/.pnpm/remark-parse@11.0.0_supports-color@8.1.1/node_modules/remark-parse/package.json:1-5`)                                        | MDAST positions and CommonMark, but includes `unified` and plugin machinery                                     | Larger dependency graph and unnecessary processor abstraction; fallback only if the selected package cannot meet the spike |

The parser layer runs a bounded spike before committing the dependency: a
throwaway fixture covers ATX, setext, duplicate headings, fenced and indented
code, HTML blocks, valid and malformed line-one frontmatter, inline links, and
Unicode. The spike checks heading depth/text/line positions, section ends,
frontmatter span, and parser behavior against expected output. It records the
command and result in the implementation PR, not a tracked artifact. A failed
spike blocks the dependency addition and requires a new design decision before
implementation continues.

**Alternatives rejected:**

- A hand-written heading regex. It would mishandle fenced code, HTML blocks,
  setext boundaries, and CommonMark indentation.
- Reuse the UI renderer or web Turndown pipeline. Those are presentation paths,
  not a source-independent structural parser and do not preserve source lines.
- Build an AST abstraction shared with #801 now. #801 gets this concrete
  Markdown primitive's coordinates and bounds, not a language-neutral AST API.

**Consequence:** One parser module can serve two real consumers, native outline
and #544 indexing, without making either depend on the other's persistence or
result format.

### D6: Treat frontmatter as a bounded authored header

**Decision:** A frontmatter scanner runs before Markdown parsing only when line 1
is exactly the YAML opener `---`. A valid block ends at a line containing only
`---` or `...`; its span is blanked with newline-preserving placeholders before
CommonMark parsing. The outline reader parses valid YAML through the already
installed API `yaml` package and emits only exact string scalar keys `title` and
`description` as authored lines. It does not emit arbitrary metadata or let
frontmatter choose a reader.

An unclosed or malformed block is marked malformed, not treated as a body-wide
frontmatter region. The parser then preserves line positions and parses the
body as Markdown, while the outline reader emits the fixed bounded note. A
later `---` is ordinary Markdown when no valid line-one block exists.

**Alternatives rejected:**

- Treat all leading `---` rules as frontmatter. That breaks ordinary Markdown
  horizontal rules and arbitrary files.
- Return raw YAML in a metadata field. The result envelope has no such field,
  and arbitrary metadata would consume the shared bound and blur authored and
  derived content.
- Require frontmatter for outline support. #573 requires ordinary Markdown to
  remain usable without OKF or metadata conventions.

**Consequence:** Authored values remain visibly distinct from derived headings,
malformed metadata never blocks ordinary read, and #544 can ignore metadata
without losing body headings.

### D7: Parse whole input under a 5 MiB representation ceiling

**Decision:** The outline reader must see the whole decoded document to compute
section ends. It reads through the source's already-authorized bounded path and
rejects decoded UTF-8 input above 5 MiB with `representation_too_large` before
parsing. This reuses the web read's existing 5 MiB body ceiling for web and
sets the same documented local/Knowledge/Skill representation ceiling without
imposing a ceiling on ordinary reads. No partial outline is returned.

The reader uses the existing abort signal and result-envelope reservation. A
successful outline is passed to the shared selector serializer, which applies
the 2,000-line and serialized result caps after generated lines and source
ranges are present. A range after `outline` addresses generated output lines;
`nextOffset` is zero-based in that generated output. A source `N-M` shown inside
an outline line is a navigation hint and does not alter paging coordinates.

**Alternatives rejected:**

- Parse a streaming prefix and guess section ends. A later heading can change
  every open section's boundary, so a partial result would claim false ranges.
- Remove the cap because host reads currently have no blanket size cap. That
  makes an explicit whole-document representation an unbounded allocation and
  is not required for ordinary windows.
- Page by source ranges. Sparse headings make source-line pages unpredictable;
  model navigation needs stable outline-line pages and separate source ranges.

**Consequence:** A large Markdown file remains readable with ordinary ranges,
while the explicit outline fails predictably. A continuation reparses the
source observed by that call and never implies a snapshot.

### D8: Preserve source envelopes and web render provenance

**Decision:** The representation reader runs only after the source resolver and
web renderer have completed. Host and `file://` retain their path identity and
host binding; `kb://` retains Space id/name and the closed untrusted notice;
`skill://` retains locator, resolved path, and skill directory; web retains
source path, `finalUrl`, method, and notes. The reader never receives or emits
credentials, resolved Knowledge roots, executor identities, or adapter service
secrets.

For web, only a winning Markdown render can feed `outline`. A delegated adapter
or rewrite may supply Markdown, but its provenance remains the web plane's
`finalUrl`, method, and note. A raw HTML, JSON, XML, or plain-text result is
not promoted to Markdown by appearance.

**Alternatives rejected:**

- Run outline before web adapter selection. It would parse an HTML/API body and
  bypass the adapter's representation decision.
- Replace source envelopes with an outline-specific object. This would make
  Knowledge and Skill authority harder to audit and break existing consumers.
- Put adapter credentials in reader input. Representation has no network need
  and must not become a credential path.

**Consequence:** A heading is untrusted data with no ability to alter the
source decision or tool authority. The same outline structure can be compared
across host and Knowledge while their identities remain distinct.

### D9: Keep stale selection explicitly non-snapshot

**Decision:** The outline's source ranges describe bytes observed during the
outline call. They are navigation hints for a later ordinary read, not a
content hash, lock, or authority token. A later call reauthorizes the source
and observes it again. If the file changes, the old range may point to a new
section; the tool does not claim otherwise.

**Alternatives rejected:**

- Store a snapshot keyed by outline output. This adds persistence and stale
  lifecycle outside #572 and conflicts with the live Knowledge contract.
- Reject a later range when the source changed. The read API has no snapshot
  guarantee today, and a range read remains useful on the current source.
- Encode heading text as a selector. Duplicate headings and untrusted text make
  name selectors ambiguous and unsafe.

**Consequence:** The model receives reproducible coordinates for unchanged
content without an implied index authority or content version.

## Risks / Trade-offs

- **[Risk]** `mdast-util-from-markdown` positions or CommonMark edge cases differ
  from the expected fixture. **Mitigation**: run the bounded parser spike before
  adding the dependency; keep fixtures for ATX, setext, code, HTML, frontmatter,
  and Unicode in the parser layer.
- **[Risk]** Whole-document outline parsing uses more memory than a normal
  window. **Mitigation**: enforce the 5 MiB decoded-input ceiling, the existing
  abort signal, and the shared result bounds; ordinary reads remain streaming.
- **[Risk]** Heading text can contain prompt-injection instructions.
  **Mitigation**: keep heading and authored values in ordinary untrusted tool
  output; preserve the Knowledge notice and web provenance; never route parsed
  text into authority or tool selection.
- **[Risk]** A selector parser change could reinterpret a literal host filename
  or a web port/query. **Mitigation**: preserve host literal probing, scheme
  split order, web `opensSelector` rules, and encoded-colon behavior; add
  focused tests for all source splitters.
- **[Risk]** The three independent stacks touch `native-files.ts`, `read.md`,
  and docs. **Mitigation**: keep this proposal's tasks explicit about sibling
  ownership; the later landing change resolves same-file conflicts and must
  preserve both contracts.
- **[Risk]** A source mutation between outline and section read makes a range
  stale. **Mitigation**: state execution-time coordinates and no snapshot in the
  result contract; ordinary reads reauthorize and reread.

## Migration Plan

1. Merge the proposal layer only after strict OpenSpec and Markdown checks and
   proposal approval. No application behavior changes on this branch.
2. Land the `parser` implementation layer first. It adds the shared parser and
   tests but does not advertise `outline` until the outline layer can consume
   it. If the parser spike fails, revise that layer's design before adding the
   dependency.
3. Land the `outline` layer on top of `parser`. It adds the representation
   grammar and reader, source-type selection, focused source equivalence and
   negative tests, prompt/docs, changelog, and closes #572. It integrates with
   whichever sibling source/web layers are present at that stack point; no
   sibling is silently reimplemented.
4. Enter `read-representations/finalize` with `$gh-stack` before any
   `$openspec-sync-specs` invocation. Synchronize the native-file-tools delta
   and archive only after every implementation task and review gate is complete.
5. Rollback is a clean cutover: remove the outline implementation and parser
   dependency together, then retain ordinary selectors and source readers.
   No database rows, durable API records, or migration backfills exist.

## Open Questions

No product or contract decision remains open. The only conditional is the
bounded parser spike in D5: it verifies the selected package against the
recorded fixture before the parser layer commits the dependency. A failed spike
requires a design revision, not an implementation guess.

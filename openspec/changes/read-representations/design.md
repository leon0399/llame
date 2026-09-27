## Context

See [proposal.md](proposal.md) for motivation and the observable contract. This
change owns plane 3 of the approved three-plane read architecture:

```text
source authority -> web service adapter/render (http/https only)
                 -> representation reader -> shared selector/result envelope
```

The source plane is owned by the sibling `file-locator` change. It drives
host paths, the `file://` alias, `kb://`, and `skill://` admission and
resolution. The web plane is owned by the sibling `web-read-adapters` change;
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
`:104-115`, `:443-485`). The current ladder is already available on `master`;
the reader consumes its Markdown outputs without waiting for the sibling
adapter change. A future adapter result can opt in by labeling its output
Markdown. A Knowledge result must retain its notice and attribution, and a
Skill result must retain its path envelope.

No current API or native package owns a Markdown parser. `apps/api` has
`linkedom`, `turndown`, `yaml`, and the web conversion dependencies but no
Markdown structure parser (`apps/api/package.json:44-85`).
`packages/native-file-tools` has only its runtime-safety dependency and no
parser (`packages/native-file-tools/package.json:17-29`). The UI directly uses
`marked@16.4.2`, resolved from the workspace store with an MIT license
(`packages/ui/package.json:25-38`;
`node_modules/.pnpm/marked@16.4.2/node_modules/marked/package.json:1-5`,
`:31-40`), while the lockfile contains `micromark@4.0.2`,
`mdast-util-from-markdown@2.0.2`, and `remark-parse@11.0.0` in the UI's
transitive graph (`pnpm-lock.yaml:808-878`, `:7587-7627`).

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

### D1: Keep representation dispatch as a static plane-3 set

**Decision:** After source admission and content acquisition, use a code-owned
set containing the existing `raw` member and the explicit Markdown `outline`
member. The set is not runtime-configurable and its entries are not dynamically
imported. With no member named, the existing text read is unchanged. Each
member declares the content types it accepts; an unsupported explicit member
returns `invalid_selector` naming that member's accepted types.

This is a real seam, not a speculative framework. It has two concrete members
at introduction: the existing raw/text path and the Markdown outline. Both are
needed by the shipped behavior and both use the same selector and result
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

**Consequence:** Adding the later code outline is a new concrete member, not a
new abstraction design. Byte-level readers for #916 and #935 will require their
own input contract rather than being forced through decoded text.

### D2: Use `outline` as the representation spelling and preserve splitter precedence

**Decision:** The representation slot accepts `:raw`, `:raw:<ranges>`,
`:outline`, and `:outline:<range>`, where an outline range is one `N`, `N-M`,
or `N+K` and never a comma list. The outline form is recognized with the same
suffix shape as the raw form (`/:outline(?::([^:/]*))?$/` beside the shipped
`/:raw(?::([^:/]*))?$/`), after the raw form and before the last-colon numeric fallback, and its member
text is then validated, so `:outline:1,3` is an `invalid_selector` rather than a
path ending in `:outline` plus a multi-range.
`outline:raw`, `raw:outline`, and other mixed forms are not members; each source
applies its shipped precedence instead of a new blanket refusal. On host and
web, `:outline:raw` is therefore the raw read of a path or URL ending in
`:outline`; `:raw:outline` fails the existing raw-member validation. Knowledge
and Skill reject either invalid suffix with `invalid_path`.

`outline` does not match the current numeric grammar
(`packages/native-file-tools/src/path.ts:216-225`). The host full-locator
literal probe still runs first, but a non-existent full spelling ending in
`:outline:<range>` is no longer interpreted by the last-colon fallback as a
path ending in `:outline` plus a numeric selector. A literal colon
is written as `%3A` where the source grammar requires it. Knowledge and Skill
split before decoding path segments (`apps/api/src/knowledge/knowledge-locator.ts:44-65`;
`apps/api/src/skills/skill-locator.ts:61-80`). Web splits after a path
separator, never inside query or fragment text, and recognizes the outline
form before its last-colon fallback (`apps/api/src/tools/web-read/locator.ts:33-60`).

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

**Consequence:** The model sees one short, copyable name. A source range shown
in an outline is an ordinary selector suffix, while a range after `outline`
pages outline lines. Duplicate headings remain range-addressed, not
name-addressed.

### D3: Apply a pure reader over decoded text, before shared paging

**Decision:** The reader boundary receives only admitted decoded text, source
display identity, and the selected representation's content type. It returns
generated text plus its representation label. It has no authority resolver,
filesystem port, network port, permission callback, owner identity, or
envelope mutator. The shared selector/result code then pages and bounds the
returned text; the source executor merges its normal envelope afterwards.

The Markdown parser itself is pure and source-independent. Outline output lines
are emitted verbatim by the outline reader: no generated line-number prefixes
and no context expansion. The shared selector machinery applies the requested
outline-output range exactly and reports `nextOffset` as the zero-based next
outline line. Generated source coordinates are text, not a second authority
channel.

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
is Markdown only when its Content-Type is `text/markdown` for the
`negotiated` method. `alternate`, `md-suffix`, `readability`, and `llms-txt`
are Markdown. `text`, `raw`, and `negotiated` `text/plain` are not Markdown.
A future adapter result can opt in by labeling its output Markdown. The reader
does not infer Markdown from JSON, XML, raw HTML, plain text, or heading-looking
bytes. The web pipeline supplies the method and content body
(`apps/api/src/tools/web-read/pipeline.ts:1-33`, `:104-115`, `:443-485`).

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
with the requested member's accepted types named, while ordinary text or raw
reading follows the existing contract. The host extension table applies equally
to `file://` once plane 1 lands, and no source gets a hidden Markdown
exception.

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

type MarkdownFrontmatterSpan = {
  startLine: 1;
  endLine: number;
};

type MarkdownStructure = {
  headings: ReadonlyArray<MarkdownHeading>;
  frontmatter?: MarkdownFrontmatterSpan;
};

parseMarkdownStructure(source: string): MarkdownStructure;
```

The parser reports only a closed line-one `---` block as `frontmatter`; an
unclosed opener is ordinary Markdown and produces no span. Every closed span
is blanked with newline-preserving placeholders before CommonMark parsing,
regardless of whether the API `yaml` parser later accepts it as a mapping.
Only root-level document headings are walked; headings nested in list items or
blockquotes are ignored. ATX and setext positions, section ends, and EOF use
the native LF line model from `splitSourceLines`: lone CR is source text and a
trailing LF opens no extra line (`packages/native-file-tools/src/source-lines.ts:43-46`).
The parser derives positions from source offsets under that model instead of
trusting parser line numbers.

Heading text is the concatenated text of inline content: code spans contribute
their text, links contribute link text, images contribute alt text, and inline
HTML is dropped. Whitespace and line breaks collapse to one space and the
result is trimmed. A heading section ends immediately before the next root
heading whose depth is less than or equal to its own, or at the source's last
line, and never before its own start line: when the next boundary heading
starts on the same native line (a lone CR), the section is that single line.
The outline renderer writes each heading as
`<"#" repeated depth> <text> [<N>-<M>]`, with no generated line prefix or
context expansion. Authored metadata and notes start with `[` and therefore
cannot be confused with heading entries.

The API outline reader uses the existing `yaml` dependency to classify the
closed span as a mapping or malformed, emits only scalar `title` and
`description` values, collapses their whitespace to one line, trims them, and
caps each at 200 characters with a trailing `…`. It does not emit arbitrary
metadata or let frontmatter choose a reader. The parser does not render HTML,
execute directives, mutate source, or construct index rows. #544 can use
headings, line boundaries, and the frontmatter span without importing the read
result or relying on an index.

The dependency decision follows the repository inspection:

| Candidate                  | Observed version and license                                                                                                                                              | Position/conformance                                                                                            | Cost and decision                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `marked`                   | 16.4.2 direct in UI; MIT (`node_modules/.pnpm/marked@16.4.2/node_modules/marked/package.json:1-5`, `:31-40`)                                                              | Fast token stream, but heading line positions are not the primary API and section offsets need custom tracking  | Small migration because UI already uses it, but extra line-tracking and token-shape coupling make it second choice         |
| `micromark`                | 4.0.2 in lockfile; MIT and explicitly CommonMark/positional (`node_modules/.pnpm/micromark@4.0.2_supports-color@8.1.1/node_modules/micromark/package.json:1-5`, `:26-27`) | Strong conformance and concrete positional events, but heading text extraction and block grouping are low-level | Small parser core, more code in the shared module; viable fallback                                                         |
| `mdast-util-from-markdown` | 2.0.2 in lockfile; MIT (`node_modules/.pnpm/mdast-util-from-markdown@2.0.2_supports-color@8.1.1/node_modules/mdast-util-from-markdown/package.json:7-21`, `:67-68`)       | Uses micromark, exposes MDAST node positions with heading depth and CommonMark semantics                        | **Selected.** Direct dependency in the native package gives the minimal AST boundary without unified's processor pipeline  |
| `remark-parse`             | 11.0.0 in lockfile; MIT (`node_modules/.pnpm/remark-parse@11.0.0_supports-color@8.1.1/node_modules/remark-parse/package.json:1-5`)                                        | MDAST positions and CommonMark, but includes `unified` and plugin machinery                                     | Larger dependency graph and unnecessary processor abstraction; fallback only if the selected package cannot meet the spike |

The parser layer runs a bounded spike before committing the dependency: a
throwaway fixture covers ATX, setext, duplicate headings, fenced and indented
code, HTML blocks, list and blockquote headings, valid closed frontmatter,
malformed closed frontmatter, a closed non-mapping block, an unclosed opener,
inline links, Unicode, lone CR, CRLF, and trailing LF. The spike checks root
heading selection, normalized text, depth/positions, section ends,
frontmatter span, native line coordinates, and parser behavior against
expected output. It records the command and result in the implementation PR,
not a tracked artifact. A failed spike blocks the dependency addition and
requires a new design decision before implementation continues.

**Alternatives rejected:**

- A hand-written heading regex. It would mishandle fenced code, HTML blocks,
  setext boundaries, containers, and CommonMark indentation.
- Reuse the UI renderer or web Turndown pipeline. Those are presentation paths,
  not a source-independent structural parser and do not preserve source lines.
- Build an AST abstraction shared with #801 now. #801 gets this concrete
  Markdown primitive's coordinates and bounds, not a language-neutral AST API.

**Consequence:** One parser module can serve two real consumers, native outline
and #544 indexing, without making either depend on the other's persistence or
result format.

### D6: Treat closed frontmatter as a bounded authored header

**Decision:** A frontmatter scanner recognizes a line-one YAML opener and a
later closer when each delimiter line, after removing one trailing CR and any
trailing spaces or tabs, is exactly `---` (the closer may also be `...`), so
CRLF files are recognized. Every such closed span is blanked with newline-preserving placeholders
before Markdown parsing, regardless of whether YAML later parses it as a
mapping. The API outline reader uses the installed `yaml` package to classify
the span: a parse error or non-mapping emits the fixed bounded note, while a
mapping emits only exact string scalar `title` and `description` values.
Authored values collapse whitespace to one line, trim, and cap at 200
characters with a trailing `…`. Frontmatter does not choose a reader.

An unclosed line-one opener is not frontmatter. It is parsed as ordinary
Markdown and emits no malformed-frontmatter note. A later `---` is ordinary
Markdown when no closed line-one span exists.

**Alternatives rejected:**

- Treat an unclosed opener as a body-wide frontmatter region. That would hide
  real headings and make malformed content change section structure.
- Let malformed closed YAML reach CommonMark unblanked. Its YAML lines can be
  parsed as setext headings and would leak authored text into derived structure.
- Return raw YAML in a metadata field. The result envelope has no such field,
  and arbitrary metadata would consume the shared bound and blur authored and
  derived content.
- Require frontmatter for outline support. #573 requires ordinary Markdown to
  remain usable without OKF or metadata conventions.

**Consequence:** Authored values remain visibly distinct from derived headings,
malformed closed metadata never blocks ordinary read, and #544 can ignore
metadata without losing body headings.

### D7: Parse whole input under a 5 MiB representation ceiling

**Decision:** The outline reader must see the whole decoded document to compute
section ends. For host, `file://`, `kb://`, and `skill://` files, the native
package adds a bounded whole-file loader that preserves resolver authority,
`O_NOFOLLOW`/follow-symlink policy, `not_regular_file`, and `invalid_utf8`
semantics. It checks the opened file's size before decoding and reads at most
5 MiB plus one byte; either an oversized stat or an extra byte returns the new
`representation_too_large` error before parsing. This does not impose a cap on
ordinary reads. Web bodies already obey the web read's 5 MiB cap. No partial
outline is returned.
The new error is added to the closed `NativeFileError` union and the native
error vocabulary documentation, which currently enumerate the union and
cross-scheme failures (`packages/native-file-tools/src/path.ts:16-33`;
`docs/native-files.md:207-211`). The reader uses the existing abort signal and
result-envelope reservation. A successful outline is emitted without generated
line prefixes or context expansion and then paged exactly by outline-output
lines under the 2,000-line and serialized result caps. `nextOffset` is the
zero-based next outline line; a source `N-M` shown inside an outline line is a
navigation hint and does not alter paging coordinates.

**Alternatives rejected:**

- Parse a streaming prefix and guess section ends. A later heading can change
  every open section's boundary, so a partial result would claim false ranges.
- Call the existing unbounded `loadText` and check afterward. That allocates
  the entire file before enforcing the representation bound
  (`packages/native-file-tools/src/read.ts:76-94`).
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
  adding the dependency; keep fixtures for ATX, setext, containers, code, HTML,
  frontmatter, native line endings, and Unicode in the parser layer.
- **[Risk]** Whole-document outline parsing uses more memory than a normal
  window. **Mitigation**: check file size before reading, cap reads at 5 MiB plus
  one byte, enforce the existing abort signal and result bounds, and keep
  ordinary reads streaming.
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
   negative tests, prompt/docs, changelog, and closes #572. It consumes the
   current web ladder's labeled Markdown outputs immediately; future adapter
   labels are forward-compatible. Only `file://` waits for the sibling
   source-plane layer, and no sibling is silently reimplemented.
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

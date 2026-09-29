# Design

## Context

See [proposal.md](proposal.md) for the motivation and observable contract. This change consumes the representation and Markdown scanner work archived by `read-representations`; it does not add source authority, permissions, or a web request.

The native package currently represents one selected window with singular `requestedRange` and `shownRange`, and a comma request with plural arrays (`packages/native-file-tools/src/source-lines.ts:12-36`). Single-range selection expands one preceding and one following line in memory (`packages/native-file-tools/src/source-lines.ts:48-72`). File reads stream from line 1 through the selected window (`packages/native-file-tools/src/stream-read.ts:199-224`), while the file-backed and in-memory multi-range paths share one range walk (`packages/native-file-tools/src/stream-read.ts:473-517`). Resolved readers dispatch through that stream path after a source resolver has supplied the display path and selector (`packages/native-file-tools/src/read.ts:117-133`, `packages/native-file-tools/src/stream-read.ts:519-542`).

The Markdown outline reader already maintains an open heading stack, stores heading source lines, and prepends an ancestor chain for a scoped outline (`packages/native-file-tools/src/markdown-outline.ts:162-220`). Its input primitive reports native lines, heading roles, and heading metadata from a one-pass scanner (`packages/native-file-tools/src/markdown-structure.ts:44-82`). Local media type selection is code-owned and maps the Markdown extensions to `text/markdown` (`packages/native-file-tools/src/representations.ts:13-29`). Web reads select rendered content in memory, invoke the representation reader for outlines, or invoke the single- and multi-range selectors, then merge the result with the existing web envelope (`apps/api/src/tools/web-read/result.ts:67-124`).

The implementation therefore adds one source-independent ancestor decision between the existing line stream and result assembly. File and web paths must share the decision so the same rendered Markdown has the same ranges; the source-specific envelopes stay outside it.

## Goals / Non-Goals

**Goals:**

- Make ordinary, explicit Markdown ranges self-describing with verbatim direct ancestor heading lines.
- Reuse the scanner and outline ancestor rule for file-backed and in-memory single- and multi-range reads.
- Preserve the existing context-line semantics, selector precedence, bounds, continuation, source identity, permission admission, and web or Knowledge envelopes.
- Make the result shape unambiguous when shown lines are non-contiguous, without adding a new metadata family.
- Keep the implementation bounded by the existing line and serialized-result caps and by the range window's scanner cutoff.

**Non-Goals:**

- Opt-in configuration, an operator flag, a new selector member, a separate context field, or a policy that hides ancestors from some ordinary Markdown ranges.
- Changes to raw or outline representations, directory listings, unselected reads, empty files, non-Markdown media types, or code outlines.
- Excerpt selection, line shortening, heading-name selection, source snapshots, caching, parser replacement, or new authority and permission behavior.
- Changes to durable data, API envelopes, Knowledge notices, web provenance, or adapter requests.

## Decisions

### D1: Ancestors are always on for ordinary Markdown ranges

**Decision:** An explicit ordinary range is ancestor-aware when its resolved source media type is `text/markdown` and it is neither raw nor outline. The direct ancestor chain is emitted for every passage, with no setting, member, or caller-controlled switch. The existing media-type rules remain authoritative: local extensions use the code-owned table, and web callers pass the render label already consumed by `buildWebReadResult` (`packages/native-file-tools/src/representations.ts:13-29`, `apps/api/src/tools/web-read/result.ts:102-123`). Non-Markdown ranges follow the existing selector path.

**Alternatives rejected:**

- A separate `contextLines` field. It would create a second output convention for information that is already source-addressable and would force every consumer to combine fields before it can read the passage.
- Unlisted context, such as only the deepest heading or only headings explicitly requested by a caller. The issue's purpose is a deterministic section context; hiding part of the direct chain makes the same source ambiguous.
- An operator flag or setting. It would make model-visible output depend on deployment configuration and would turn a deterministic read contract into an authorization-like policy surface.
- A new `:ancestors` member. It would duplicate the already-shipped outline slot and leave ordinary ranged reads without the context promised by #1018.

**Consequence:** A plain unscoped read still starts at line 1 and has no enclosing heading to add. `:raw`, `:outline`, and non-Markdown results remain on their existing paths.

### D2: The chain is heading source lines for requested line N

**Decision:** For each passage, the chain is the root heading stack whose
sections contain the passage's first requested source line N, shallowest first.
The preceding context line at N-1 remains shown but does not select headings.
Each heading contributes all of its own source lines only, rendered with the
ordinary `N:` prefix followed by one space. An ATX heading contributes one line.
A setext heading contributes all of its text lines plus its underline, verbatim.
The chain is not shortened, synthesized, or supplemented with a section
excerpt. A heading line already shown by the context-expanded window or an
earlier chain is not repeated. The source line and heading state come from the
scanner primitive and the outline's existing heading stack
(`packages/native-file-tools/src/markdown-structure.ts:44-82`,
`packages/native-file-tools/src/markdown-outline.ts:162-191`).

**Alternatives rejected:**

- The first shown line. A context line can sit in the previous section, such as
  `## A` immediately above a window whose requested line N is `## B`; using
  N-1 would select the wrong chain.
- Excerpt lines in ancestors. Excerpts describe the first body line of an
  outline section, not the heading chain. Adding them would repeat content from
  a later read and make the chain depend on a different outline presentation
  rule.
- The outline's 120-code-unit cut. Ordinary reads are verbatim source reads,
  and cutting a heading would make the prefix unsuitable for `edit`-style
  source navigation. The shared result cap still decides whether a complete
  line fits.
- Synthesized `#` text or normalized heading labels. Coordinates and original
  syntax are already available; generated labels could lose setext depth,
  spacing, or prompt-bound source text.
- A heading-name selector. It would add a second addressing grammar and is not
  needed to make the selected range self-describing.

**Consequence:** Heading lines are navigation hints and untrusted source data.
No excerpt line consumes a shown interval on behalf of an ancestor.

### D3: Ancestors use the existing plural result shape

**Decision:** When at least one ancestor line is prepended to a single-range
result, the result is represented as the existing multi-range shape:
`requestedRanges` contains the one requested interval, and `shownRanges`
contains the ancestor intervals and the context-expanded window. Adjacent
shown lines merge, including all text lines plus the underline of a setext
ancestor and an ancestor adjacent to the preceding or following context line.
Setext ancestor lines remain verbatim. The requested interval never includes
context or ancestors. If no ancestor is emitted, the current singular object is
returned byte for byte. The type distinction and existing plural fields are in
`packages/native-file-tools/src/source-lines.ts:12-36`.

**Alternatives rejected:**

- A new `context` or `ancestors` array beside singular ranges. It would make
  consumers understand two incompatible range descriptions and would not
  describe deduplicated source intervals as one ordered result.
- Keeping singular fields and encoding a discontiguous shown range as its first
  and last line. That would claim lines were emitted through gaps and would make
  continuation unsafe.
- Always returning plural fields. The brief preserves the current no-ancestor
  result contract, including unselected and non-Markdown reads; changing those
  callers adds compatibility churn without a behavioral need.

**Consequence:** Result construction needs one explicit promotion point from
single to plural. Existing envelope measurement sees the same `content`, range
metadata, and truncation fields; no envelope field changes.

### D4: Comma reads expand and deduplicate per passage

**Decision:** A comma request keeps the current merged requested intervals and
context expansion. For each resulting passage, the implementation obtains the
ancestor chain for that passage's first requested line N, emits the chain before
the passage, and deduplicates every source line against all earlier emitted
passage and chain lines. It preserves source order. `requestedRanges` remains
the pre-expansion request; `shownRanges` includes context and ancestor lines.
A later passage's ancestor lines that are not already shown and follow the
last emitted line are inserted immediately before that passage. Only a heading's lines before the passage's
first shown line are emitted as its chain; lines at or after it are the
window's own lines or follow it. A heading that encloses a later requested
start and lies before an earlier passage usually encloses the earlier start as
well, but the earlier passage may not have emitted it (its chain was trimmed,
or a later line settled the heading only after that passage), so a chain line
that would precede content already emitted is skipped rather than emitted out
of source order. Skipping stays per line rather than per heading unit: a
heading that straddles the last emitted line has that line among its own, so
its remaining lines directly continue it, and dropping the whole unit would
instead leave the earlier passage's partial heading text without its
underline and the later passage without that ancestor. A heading whose lines
include N itself (a requested setext text line or underline) is N's own
heading, not an ancestor.

The existing multi-range walk is shared by file and in-memory sources and
already owns sorted/merged intervals, whole-range rollback, the line ceiling,
and `nextOffset` (`packages/native-file-tools/src/stream-read.ts:275-365`,
`packages/native-file-tools/src/stream-read.ts:473-517`). Ancestor admission
will sit at the passage boundary rather than treating ancestors as requested
lines.

**Alternatives rejected:**

- The first shown line. A context line can sit in the previous section, so it
  can select a chain unrelated to the passage's requested start.
- Ancestors only for the first range. It would make a disjoint second passage
  lose the section identity the feature exists to provide.
- A chain per raw input member before merging. Normalization already defines
  passages; duplicating chains before merge would repeat lines and make output
  depend on selector spelling.
- A separate output block for each chain. The existing content contract is one
  source-ordered block with shown intervals; adding block markers would be
  generated content with no source coordinate.
- Supporting only one requested range. Issue #1018 explicitly includes comma
  reads, and the repository already has a bounded multi-range path
  (`packages/native-file-tools/src/stream-read.ts:473-517`).

**Consequence:** A later chain can never reorder an earlier passage.
Deduplication is by source line coordinate, not heading text, so duplicate
headings remain distinct occurrences.

### D5: Existing unaffected reads remain unchanged

**Decision:** The ancestor decision is bypassed for `:raw` and `:raw:<ranges>`,
`:outline`, directories, unselected reads, empty files, every non-Markdown
media type, and post-edit previews produced by `edit` or `write`. Raw reads
continue to return verbatim source bytes, outline reads retain their own
ancestor and excerpt rules, directory selectors remain listing selectors, and
mutation previews remain ordinary mutation results. `streamFileWindow` already
separates outline, multi-range, and single-range dispatch
(`packages/native-file-tools/src/stream-read.ts:519-542`), web directory and
outline refusals are assembled before ordinary selection
(`apps/api/src/tools/web-read/result.ts:97-163`), and `describeMutation` calls
`selectSourceLines` without a media type
(`packages/native-file-tools/src/mutate.ts:143-172`).

**Alternatives rejected:**

- Applying ancestors to raw output. Raw content is the source-preserving input
  used by edit workflows; generated prefixes would change bytes.
- Applying ancestors to mutation previews. A preview describes the post-edit
  result and has no source media type, so making it Markdown-aware would make
  mutation output differ from the ordinary mutation contract.
- Replacing the outline ancestor rule with the ordinary range rule. Outline
  scope has a different output contract and deliberately includes its own
  excerpts.
- Adding context or ancestors to directory listings. Directory entries do not
  have Markdown sections, and the listing contract already forbids context
  lines.
- Guessing Markdown from body text for unsupported media. Media type is source
  metadata, not content sniffing; non-Markdown behavior must stay unchanged
  until a declared reader exists.

**Consequence:** The change is a clean cutover at the Markdown range reader,
with no compatibility aliases or special output markers. Mutation previews do
not promote their singular `shownRange`.

### D6: Bounds preserve existing continuation semantics

**Decision:** Ancestor lines count against the shared 2,000-line ceiling and
serialized result cap. Admission tests the chain together with all mandatory
output through the first requested line N: the N-1 context line when it is
shown and not already emitted, plus line N. It applies the outermost-heading
overflow rule in D8. `nextOffset` keeps its existing meaning for single- and
multi-range reads and never identifies a line emitted only as an ancestor. A
continuation at `nextOffset + 1` recomputes the chain for its new first
requested line, so an ancestor may reappear across continuations just as
context lines can. The existing caps and budget reservation are defined in
`packages/native-file-tools/src/source-lines.ts:1-9`.

**Alternatives rejected:**

- Charging ancestors outside the shared cap. That would let the result exceed
  the contract that already includes content, metadata, and authority
  envelopes.
- Advancing `nextOffset` to an ancestor line. Ancestors are navigation context,
  not requested work; doing so would make a retry reread or skip selected
  source lines.
- Carrying a chain across continuation calls. A continuation is a new execution
  against potentially changed source; recomputing it follows existing
  execution-time semantics and guarantees progress.

**Consequence:** A trimmed or absent chain is silent. There is no completeness
flag because ancestors are extra context, not a commitment to a complete
outline.

### D7: The scanner ends at the range window

**Decision:** A ranged read never reads past its selected window. File sources
already walk from line 1 through the requested offset and stop at the bounded
window (`packages/native-file-tools/src/stream-read.ts:199-224`). The Markdown
scanner is fed through the window end and then ended. If a line's role is still
undecided at that boundary, it counts as not a heading for this read: an open
paragraph that might become a setext heading and an unclosed line-one `---`
block are replayed as Markdown rather than resolved with later input. Web
renders are already in memory before the same selector path
(`apps/api/src/tools/web-read/result.ts:97-123`), so host and web produce the
same ancestors for the same text and window. The I/O walk is unchanged, but
every skipped line before the window is parsed by the scanner, so CPU for a
large-offset Markdown read scales with the offset. An open root paragraph
spanning that prefix is buffered in the same memory shape that `:outline`
already accepts under its no-input-ceiling bound.

**Alternatives rejected:**

- Read until the scanner settles every deferred block. A 200 MiB file with no
  blank line could be read in full for a 15-line request.
- Capped lookahead. It adds another arbitrary rule and remains inexact when the
  deferred block extends past the cap.

**Consequence:** The implementation has no lookahead, input-sized cache, or
large-offset refusal. A boundary-undecided line simply cannot contribute a
heading to this result.

### Shared tracker placement

**Decision:** Extract the ancestor-stack responsibility currently held in
`packages/native-file-tools/src/markdown-outline.ts:162-191` into a new
`packages/native-file-tools/src/markdown-ancestors.ts` that consumes
`createMarkdownScanner`; `markdown-structure.ts` is already at the repository's
file-length limit, so the tracker sits in its own module. The shared tracker consumes the scanner's native line
stream, records each heading's verbatim source lines and open section depth,
and exposes the direct heading chain for a requested source line. The outline
reader continues to add its outline-specific excerpts and scope filtering;
ordinary range readers request heading lines only. File and in-memory range
selection use the same tracker interface.

**Alternatives rejected:**

- A second ancestor tracker in the range selector. It would duplicate
  heading-stack semantics and let outline and ordinary reads disagree on setext
  or duplicate-heading boundaries.
- A general runtime registry or plugin interface. There is one Markdown
  implementation and the compile-time representation table is already the
  extension point; a registry would violate the repository's smallest-complete
  design rule.
- A full AST parser for every read. The shipped scanner is one-pass and reports
  native lines and heading metadata
  (`packages/native-file-tools/src/markdown-structure.ts:44-82`); a
  whole-document AST would consume memory unrelated to the selected result.

**Consequence:** Parser behavior remains in the native package, while source
authorities only feed admitted lines. The shared helper is the single place to
test root-heading ancestry.

### D8: Ancestor overflow drops outermost headings first

**Decision:** Ancestor lines count against the shared 2,000-line ceiling and
serialized result cap. When the complete chain plus all mandatory output
through the first requested line N does not fit, including the N-1 context line
when it is shown and not already emitted and line N, whole heading units are
removed from the outermost end until the deepest remaining heading plus that
mandatory output fits. A setext heading's text lines and underline are one unit.
If even the deepest heading does not fit, no chain is emitted. Remaining
headings stay in source order. A trimmed or absent chain is silent and carries
no flag field.

**Alternatives rejected:**

- Drop the whole chain. It discards useful deepest context even when one or more
  heading units fit.
- Cut the innermost heading. A partial or missing deepest heading makes the
  selected section less useful and can leave an outer heading without its
  immediate context.
- Split a setext heading between its text and underline. The two lines are one
  syntactic heading and must remain a unit.

**Consequence:** A result may carry a shorter but still source-ordered chain.
Only a result that emits at least one ancestor promotes to plural range fields;
an absent chain leaves the ordinary single-range shape.

### D9: Source envelopes, permissions, and media labels stay outside the reader

**Decision:** The reader runs only after source resolution and permission
admission. It receives decoded lines, a display identity, the selector, and the
source media type; it does not resolve a path, issue a request, inspect
credentials, or mutate an envelope. Host and scheme-specific callers retain
their existing result fields. The web path continues to build its envelope
first and merge it after selection (`apps/api/src/tools/web-read/result.ts:47-59`,
`apps/api/src/tools/web-read/result.ts:67-124`). The web caller passes the
render's existing `mediaType` to the ordinary selectors, so Markdown ladder
stages and adapter documents are eligible while `text/plain` and raw content
are not.

**Alternatives rejected:**

- Letting the reader infer authority from a display path. A display path is
  model-facing data, not permission identity.
- Parsing before admission. A denied path must fail before content is opened or
  scanned, as the existing resolver boundary guarantees
  (`packages/native-file-tools/src/read.ts:117-133`).
- Adding a media type to the public result envelope. The label selects a reader
  internally; exposing it would change unrelated result contracts.
- Treating every web render as Markdown. The rendered document's label is the
  source of truth; plain text and raw HTML must not gain heading behavior by
  accident.

**Consequence:** The implementation changes the web selector call signatures
and native range helpers, not authority or envelope code. Knowledge retains its
Space attribution and untrusted-content notice because the selector result is
still wrapped by its existing resolver. A trimmed or absent chain is silent;
ancestors are extra context, not a completeness signal.

### D10: Coordinates remain execution-time navigation hints

**Decision:** Every emitted ancestor and context interval uses the native line coordinates of the source observed during that call. A heading line number is a navigation hint for a later read, not a content hash, lock, or authority token. A later call rereads and reauthorizes the source. The ordinary line renderer already derives prefixes from source indexes (`packages/native-file-tools/src/source-lines.ts:169-175`), and the scanner reports one-based native lines (`packages/native-file-tools/src/markdown-structure.ts:44-58`).

**Alternatives rejected:**

- Snapshotting the source between reads. That would add storage and authority semantics not required by the feature.
- Returning heading text without coordinates. It would make a model unable to navigate directly to the enclosing section and would diverge from every existing numbered read.
- Treating a heading prefix as trusted metadata. Heading text remains untrusted source content and never changes permissions, owner identity, or tool selection.

**Consequence:** A source mutation between calls may make a previously emitted coordinate stale, exactly as it can for existing context lines. Documentation must state that coordinates describe the execution that produced them.

## Risks / Trade-offs

- **[Risk]** A large-offset Markdown read scans many source lines before it can emit a small window. **Mitigation:** the I/O walk remains the existing forward walk, but the scanner parses skipped lines; document the CPU scaling with offset, retain bounded scanner state and the existing result caps, and accept the open-paragraph buffer shape already permitted by `:outline`.
- **[Risk]** A deferred Markdown role remains undecided at the window end and would differ if later lines were read. **Mitigation:** end the scanner at the window boundary, classify the undecided line as non-heading for this read, and test open setext paragraphs and unclosed line-one `---` blocks on both host and web paths.
- **[Risk]** A heading chain consumes enough of the shared budget to change truncation or continuation. **Mitigation:** admit all mandatory output through N, drop complete outermost heading units first, preserve existing `nextOffset` semantics, keep omission silent, and cover the 2,000-line and serialized-cap boundaries with focused tests.
- **[Risk]** A single-range consumer assumes singular fields and mishandles an ancestor-aware result. **Mitigation:** use the existing `ReadSuccess` union, promote only when an ancestor is emitted, and test host, Knowledge, Skill, web, and mutation-preview envelopes at the public result boundary.
- **[Risk]** Scanner state disagrees between ordinary ranges and `:outline`. **Mitigation:** extract one ancestor tracker beside the scanner and keep the differential scanner suite as the structural oracle.
- **[Risk]** Heading or web-render text contains prompt-injection instructions. **Mitigation:** emit source verbatim as untrusted tool output, preserve Knowledge notices and web provenance, and never route parsed text into authority or tool selection.
- **[Risk]** A missing or incorrect web media label makes Markdown behavior differ by ladder stage. **Mitigation:** pass the existing label through ordinary selectors and add focused tests for Markdown, `text/plain`, and raw renders.

## Migration Plan

1. Merge the proposal layer after the strict OpenSpec, canonical delta, and Markdown checks. It changes no application behavior.
2. Create `ranged-read-ancestors/reader` only after proposal approval and the current stack head is verified with `$gh-stack`.
3. Implement the shared tracker and native file and in-memory range paths, then update the web selector callers, focused tests, prompt, operator documentation, dated changelog, and issue-closing PR body in that layer.
4. At the reader boundary, complete self-review and the GitHub review and CI loop before creating `ranged-read-ancestors/finalize`.
5. Enter `ranged-read-ancestors/finalize` with `$gh-stack` before any `$openspec-sync-specs` invocation. Finalize synchronizes canonical specs, preserves checked task history, and archives the change; it does not repair application code.
6. Rollback is a clean cutover: remove the shared tracker integration and web media-type argument together. No database rows, migrations, or durable records exist for this feature.

## Open Questions

None. The settled brief fixes scope, result shape, ancestor semantics, bounds, media types, source coverage, and delivery layers. The implementation may choose private helper names within the interfaces above without changing the contract or task breakdown.

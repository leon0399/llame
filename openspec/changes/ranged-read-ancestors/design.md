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
- Keep the implementation bounded by the existing line and serialized-result caps and by the scanner's deferred-run behavior.

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

### D2: The chain is heading source lines only

**Decision:** For each passage, the chain is the root heading stack whose sections contain the passage's first shown source line, shallowest first. Each heading contributes its own source lines only, rendered with the ordinary `N:` prefix followed by one space. An ATX heading contributes one line. A setext heading contributes its text line or lines and its underline. The chain is verbatim and is not shortened, synthesized, or supplemented with a section excerpt. The first shown line is the context-expanded window start, so a heading already present in that window is not repeated. The source line and heading state come from the scanner primitive and the outline's existing heading stack (`packages/native-file-tools/src/markdown-structure.ts:44-82`, `packages/native-file-tools/src/markdown-outline.ts:162-191`).

**Alternatives rejected:**

- Excerpt lines in ancestors. Excerpts describe the first body line of an outline section, not the heading chain. Adding them would repeat content from a later read and make the chain depend on a different outline presentation rule.
- The outline's 120-code-unit cut. Ordinary reads are verbatim source reads, and cutting a heading would make the prefix unsuitable for `edit`-style source navigation. The shared result cap still decides whether a complete line fits.
- Synthesized `#` text or normalized heading labels. Coordinates and original syntax are already available; generated labels could lose setext depth, spacing, or prompt-bound source text.
- A heading-name selector. It would add a second addressing grammar and is not needed to make the selected range self-describing.

**Consequence:** Heading lines are navigation hints and untrusted source data. No excerpt line consumes a shown interval on behalf of an ancestor.

### D3: Ancestors use the existing plural result shape

**Decision:** When at least one ancestor line is prepended to a single-range result, the result is represented as the existing multi-range shape: `requestedRanges` contains the one requested interval, and `shownRanges` contains the ancestor intervals and the context-expanded window. Adjacent shown lines merge, including a multi-line setext heading and an ancestor adjacent to the preceding or following context line. The requested interval never includes context or ancestors. If no ancestor is emitted, the current singular object is returned byte for byte. The type distinction and existing plural fields are in `packages/native-file-tools/src/source-lines.ts:12-36`.

**Alternatives rejected:**

- A new `context` or `ancestors` array beside singular ranges. It would make consumers understand two incompatible range descriptions and would not describe deduplicated source intervals as one ordered result.
- Keeping singular fields and encoding a discontiguous shown range as its first and last line. That would claim lines were emitted through gaps and would make continuation unsafe.
- Always returning plural fields. The brief preserves the current no-ancestor result contract, including unselected and non-Markdown reads; changing those callers adds compatibility churn without a behavioral need.

**Consequence:** Result construction needs one explicit promotion point from single to plural. Existing envelope measurement sees the same `content`, range metadata, and truncation fields; no envelope field changes.

### D4: Comma reads expand and deduplicate per passage

**Decision:** A comma request keeps the current merged requested intervals and context expansion. For each resulting passage, the implementation obtains the ancestor chain for that passage's first shown line, emits the chain before the passage, and deduplicates every source line against all earlier emitted passage and chain lines. It preserves source order. `requestedRanges` remains the pre-expansion request; `shownRanges` includes context and ancestor lines. If a later passage's ancestor heading is not already shown, it is inserted immediately before that passage. A heading that encloses a later start but lies before an earlier passage's start also encloses the earlier start, so an unshown later ancestor cannot need to appear before an earlier passage.

The existing multi-range walk is shared by file and in-memory sources and already owns sorted/merged intervals, whole-range rollback, the line ceiling, and `nextOffset` (`packages/native-file-tools/src/stream-read.ts:275-365`, `packages/native-file-tools/src/stream-read.ts:473-517`). Ancestor admission will sit at the passage boundary rather than treating ancestors as requested lines.

**Alternatives rejected:**

- Ancestors only for the first range. It would make a disjoint second passage lose the section identity the feature exists to provide.
- A chain per raw input member before merging. Normalization already defines passages; duplicating chains before merge would repeat lines and make output depend on selector spelling.
- A separate output block for each chain. The existing content contract is one source-ordered block with shown intervals; adding block markers would be generated content with no source coordinate.
- Supporting only one requested range. Issue #1018 explicitly includes comma reads, and the repository already has a bounded multi-range path (`packages/native-file-tools/src/stream-read.ts:473-517`).

**Consequence:** A later chain can never reorder an earlier passage. Deduplication is by source line coordinate, not heading text, so duplicate headings remain distinct occurrences.

### D5: Existing unaffected reads remain unchanged

**Decision:** The ancestor decision is bypassed for `:raw` and `:raw:<ranges>`, `:outline`, directories, unselected reads, empty files, and every non-Markdown media type. Raw reads continue to return verbatim source bytes, outline reads retain their own ancestor and excerpt rules, and directory selectors remain listing selectors. `streamFileWindow` already separates outline, multi-range, and single-range dispatch (`packages/native-file-tools/src/stream-read.ts:519-542`), while web directory and outline refusals are assembled before ordinary selection (`apps/api/src/tools/web-read/result.ts:97-163`).

**Alternatives rejected:**

- Applying ancestors to raw output. Raw content is the source-preserving input used by edit workflows; generated prefixes would change bytes.
- Replacing the outline ancestor rule with the ordinary range rule. Outline scope has a different output contract and deliberately includes its own excerpts.
- Adding context or ancestors to directory listings. Directory entries do not have Markdown sections, and the listing contract already forbids context lines.
- Guessing Markdown from body text for unsupported media. Media type is source metadata, not content sniffing; non-Markdown behavior must stay unchanged until a declared reader exists.

**Consequence:** The change is a clean cutover at the Markdown range reader, with no compatibility aliases or special output markers.

### D6: Bounds omit a complete chain, then preserve progress

**Decision:** Ancestor lines count against the shared 2,000-line ceiling and serialized result cap. Before emitting a passage, the implementation tests the complete chain together with that passage's first shown source line. If that group cannot fit, it omits the entire chain and still emits the passage window when possible. A chain is never partially emitted. `nextOffset` continues to identify the next requested source line, never an ancestor line. A continuation at `nextOffset + 1` recomputes the chain for its new first shown line, so an ancestor may reappear across continuations just as context lines can. The existing caps and budget reservation are defined in `packages/native-file-tools/src/source-lines.ts:1-9`, and the outline already admits or omits an ancestor chain as a unit (`packages/native-file-tools/src/markdown-outline.ts:194-220`).

**Alternatives rejected:**

- Truncating a chain at the cap. A partial chain would falsely describe the section and could leave a continuation stuck on an already emitted heading.
- Charging ancestors outside the shared cap. That would let the result exceed the contract that already includes content, metadata, and authority envelopes.
- Advancing `nextOffset` to an ancestor line. Ancestors are navigation context, not requested work; doing so would make a retry reread or skip requested source lines.
- Carrying a chain across continuation calls. A continuation is a new execution against potentially changed source; recomputing it follows existing execution-time semantics and guarantees progress.

**Consequence:** A result with an omitted chain has no emitted ancestors and retains the singular shape when it is a single request. A result with an emitted chain promotes to plural fields even if only one requested passage exists.

### D7: Scanning cost is accepted and remains bounded by deferred decisions

**Decision:** File sources already walk from line 1 to the selected offset rather than seeking to a line (`packages/native-file-tools/src/stream-read.ts:199-224`). The added work is the scanner's CPU over those lines and the small open-heading state; it does not add a cache, random-access index, or whole-file buffer. A scanner may consume lines beyond the requested window when an open root paragraph, link-reference definition paragraph, or line-one `---` opener has not yet settled the role of lines before the window. It stops once the relevant decisions are settled or the existing result budget and line ceiling force a bounded result. Web renders are already in memory before selection (`apps/api/src/tools/web-read/result.ts:97-123`).

**Alternatives rejected:**

- Caching ancestor indexes. A cache would add invalidation and stale-coordinate behavior to a read path that currently observes source content per call; the issue does not require repeated-read acceleration.
- A whole-file loader. It would turn a streaming file read into an input-sized allocation and contradict the scanner's purpose for large files.
- A fixed scan cutoff at the requested end. Deferred Markdown blocks can make a line's structural role undecidable at that boundary, producing incorrect ancestors.
- A new large-offset error. The existing forward scan is the accepted source behavior; introducing a new refusal would make valid ranges depend on their offset rather than their result.

**Consequence:** High offsets can consume more CPU than a small window, but memory remains flat apart from scanner state and emitted output. Focused tests must cover deferred runs and a large offset.

### D8: One shared ancestor tracker serves outline and ranges

**Decision:** Extract the ancestor-stack responsibility currently held in `packages/native-file-tools/src/markdown-outline.ts:162-191` into `packages/native-file-tools/src/markdown-structure.ts` beside `createMarkdownScanner`. The shared tracker consumes the scanner's native line stream, records each heading's verbatim source lines and open section depth, and exposes the direct heading chain for a source line. The outline reader continues to add its outline-specific excerpts and scope filtering; ordinary range readers request heading lines only. File and in-memory range selection use the same tracker interface.

**Alternatives rejected:**

- A second ancestor tracker in the range selector. It would duplicate heading-stack semantics and let outline and ordinary reads disagree on setext or duplicate-heading boundaries.
- A general runtime registry or plugin interface. There is one Markdown implementation and the compile-time representation table is already the extension point; a registry would violate the repository's smallest-complete-design rule.
- A full AST parser for every read. The shipped scanner is one-pass and reports native lines and heading metadata (`packages/native-file-tools/src/markdown-structure.ts:44-82`); a whole-document AST would consume memory unrelated to the selected result.

**Consequence:** Parser behavior remains in the native package, while source authorities only feed admitted lines. The shared helper is the single place to test root-heading ancestry.

### D9: Source envelopes, permissions, and media labels stay outside the reader

**Decision:** The reader runs only after source resolution and permission admission. It receives decoded lines, a display identity, the selector, and the source media type; it does not resolve a path, issue a request, inspect credentials, or mutate an envelope. Host and scheme-specific callers retain their existing result fields. The web path continues to build its envelope first and merge it after selection (`apps/api/src/tools/web-read/result.ts:47-59`, `apps/api/src/tools/web-read/result.ts:67-124`). The web caller passes the render's existing `mediaType` to the ordinary selectors, so Markdown ladder stages and adapter documents are eligible while `text/plain` and raw content are not.

**Alternatives rejected:**

- Letting the reader infer authority from a display path. A display path is model-facing data, not permission identity.
- Parsing before admission. A denied path must fail before content is opened or scanned, as the existing resolver boundary guarantees (`packages/native-file-tools/src/read.ts:117-133`).
- Adding a media type to the public result envelope. The label selects a reader internally; exposing it would change unrelated result contracts.
- Treating every web render as Markdown. The rendered document's label is the source of truth; plain text and raw HTML must not gain heading behavior by accident.

**Consequence:** The implementation changes the web selector call signatures and native range helpers, not authority or envelope code. Knowledge retains its Space attribution and untrusted-content notice because the selector result is still wrapped by its existing resolver.

### D10: Coordinates remain execution-time navigation hints

**Decision:** Every emitted ancestor and context interval uses the native line coordinates of the source observed during that call. A heading line number is a navigation hint for a later read, not a content hash, lock, or authority token. A later call rereads and reauthorizes the source. The ordinary line renderer already derives prefixes from source indexes (`packages/native-file-tools/src/source-lines.ts:169-175`), and the scanner reports one-based native lines (`packages/native-file-tools/src/markdown-structure.ts:44-58`).

**Alternatives rejected:**

- Snapshotting the source between reads. That would add storage and authority semantics not required by the feature.
- Returning heading text without coordinates. It would make a model unable to navigate directly to the enclosing section and would diverge from every existing numbered read.
- Treating a heading prefix as trusted metadata. Heading text remains untrusted source content and never changes permissions, owner identity, or tool selection.

**Consequence:** A source mutation between calls may make a previously emitted coordinate stale, exactly as it can for existing context lines. Documentation must state that coordinates describe the execution that produced them.

## Risks / Trade-offs

- **[Risk]** A large-offset file read scans many source lines before it can emit a small window. **Mitigation:** keep the existing streaming line source, bounded scanner state, abort signal, and result caps; do not add an input-sized cache.
- **[Risk]** A heading chain consumes enough of the shared budget to change truncation or continuation. **Mitigation:** admit chains atomically, omit a chain rather than truncating it, preserve requested-line `nextOffset`, and cover the 2,000-line and serialized-cap boundaries with focused tests.
- **[Risk]** A single-range consumer assumes singular fields and mishandles an ancestor-aware result. **Mitigation:** use the existing `ReadSuccess` union, promote only when an ancestor is emitted, and test host, Knowledge, Skill, and web envelopes at the public result boundary.
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

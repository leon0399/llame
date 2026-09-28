## Why

Issue #1018 asks an ordinary ranged `read` to carry the Markdown headings that enclose the requested passage, so a model can identify the section without a separate `:outline` call. The shipped Markdown outline already tracks ancestor headings, while ordinary selectors currently expose only the requested window and its adjacent context; this change makes the same structural context available on the ordinary read path without weakening `:raw`, source admission, or attribution.

## What Changes

- Every explicit, ordinary non-`:raw`, non-`:outline` range over a `text/markdown` source prepends the direct ancestor heading chain for each passage's first requested line, shallowest first. The context line at N-1 remains shown but does not select headings. The chain is rendered from the source's own lines with the existing `N:` prefix followed by one space. Setext ancestors include all of their text lines plus the underline, verbatim; no excerpt line is added and no line is cut.
- A single-range result that prepends at least one ancestor uses the existing plural range shape: `requestedRanges` contains the requested interval and `shownRanges` contains the ancestor lines plus the context-expanded window. Adjacent shown lines merge. A read with no emitted ancestors retains the current singular shape.
- Comma-separated reads apply a chain to every merged passage using that passage's first requested line, deduplicate lines already emitted by earlier passages or chains, and retain source order; a setext ancestor partly shown by an earlier passage contributes only its remaining lines, which directly follow it. `requestedRanges` remains the pre-expansion request; `shownRanges` includes context and ancestor lines.
- Ancestor lines count against the shared 2,000-line and serialized result bounds. If a chain plus all mandatory output through the first requested line cannot fit, including the N-1 context line when it is shown and not already emitted and line N, whole headings are dropped from the outermost end until the deepest remaining heading fits; a setext heading is dropped as one unit. If even the deepest heading cannot fit, no chain is emitted, the window still returns when it can, and `nextOffset` keeps its existing meaning for single- and multi-range reads and never identifies a line emitted only as an ancestor. A continuation starts a fresh ancestor calculation.
- `:raw`, `:outline`, directory reads, unselected reads, empty files, non-Markdown sources, and `edit`/`write` post-edit previews retain their current behavior. In particular, raw content remains verbatim for edit workflows, and previews do not receive ancestor headings.
- Host, `file://`, `kb://`, and `skill://` reads and web Markdown renders receive the same behavior after their existing permission and source-resolution steps. Knowledge and web envelopes, notices, provenance, and source identity remain unchanged; ancestors grant no authority.
- A ranged read never reads past its window. The Markdown scanner ends at the window end, and a line whose role is undecided at that boundary counts as not a heading for this read. The I/O walk is unchanged, but every skipped line before the window is parsed by the scanner, so CPU for a large-offset Markdown read scales with the offset; an open root paragraph spanning that prefix is buffered in the same memory shape that `:outline` already accepts. Host and web use the same cutoff and ancestors for the same text.

## Capabilities

### New Capabilities

None. The behavior is a new requirement within the existing native file capability.

### Modified Capabilities

- `native-file-tools`: extend deterministic selector results and multi-range metadata with ancestor-aware Markdown ranges, and add the ranged Markdown ancestor contract while preserving raw, outline, directory, source, permission, and envelope behavior.

## Impact

- The current single-range result union uses `requestedRange` and `shownRange`, while the multi-range union already uses plural intervals (`packages/native-file-tools/src/source-lines.ts:12-36`). The implementation will use that existing multi-range shape when an ancestor chain is emitted rather than inventing a `contextLines` field.
- File reads currently stream source lines from line 1 through the selected window (`packages/native-file-tools/src/stream-read.ts:199-224`), and file-backed multi-range reads already share one walk, line ceiling, budget, rollback, and continuation path (`packages/native-file-tools/src/stream-read.ts:473-517`).
- The Markdown outline reader already tracks heading state and emits direct ancestors for a scoped outline (`packages/native-file-tools/src/markdown-outline.ts:162-220`). The change reuses that structural rule for ordinary ranges, while the scanner remains the native line primitive (`packages/native-file-tools/src/markdown-structure.ts:44-82`).
- Web rendered text is selected in memory and merged with its web envelope in `apps/api/src/tools/web-read/result.ts:67-124`; the web caller will pass the render media type to the ordinary single- and multi-range selectors so rendered Markdown is treated like a Markdown file.
- The existing file media-type table recognizes `.md`, `.markdown`, `.mdown`, and `.mkd` as `text/markdown` (`packages/native-file-tools/src/representations.ts:13-29`). No dependency, database migration, authority, permission group, or new envelope field is required.

## Non-Goals

- No opt-in setting, separate `contextLines` field, operator flag, or unlisted context policy. The behavior is always on for the defined Markdown ranged reads.
- No changes to `:raw` or `:raw:<ranges>`, `:outline`, directory reads, unselected reads, empty files, or non-Markdown media types.
- No excerpt lines in ancestor chains, 120-code-unit cutting, synthesized heading text, source snapshots, caching, or coordinate stability guarantees.
- No code-outline implementation, JSON/YAML reader, new parser dependency, new source authority, permission bypass, adapter, or web request.

## Acceptance

- `read("VISION.md:60-72")` over the example in #1018 returns the heading lines at 13, 32, and 54, then the existing context line at 59, lines 60 through 72, and the context line at 73, in source order.
- ATX and setext ancestor lines are verbatim and prefixed. A heading already shown in the window or an earlier chain is not repeated, and adjacent ancestor/context lines appear in one shown interval.
- A Markdown range with no enclosing heading, a range beginning on its heading, a non-Markdown file, a raw read, an outline read, a directory read, an empty file, and an unselected read preserve their current result contract.
- Comma reads apply and deduplicate chains per passage; a continuation at `nextOffset + 1` gets a fresh chain; an over-budget chain drops complete outermost headings first, keeps setext headings intact, and silently emits no chain only when even the deepest heading cannot fit.
- Host, `file://`, `kb://`, and `skill://` Markdown reads preserve their existing source and security envelopes. Web Markdown renders receive ancestors, while web `text/plain` and raw renders do not. A Knowledge result keeps its Space attribution and untrusted-content notice.
- The proposal delta passes the canonical preservation script, `openspec validate ranged-read-ancestors --strict`, and `pnpm lint:markdown`.

## Assumptions and Resolved Decisions

The settled brief for #1018 resolves the issue's result-shape, per-passage, cost, bounds, and media-type questions. Media type remains source-derived: the existing file table governs local resources and the existing web render labels govern web resources. Coordinates remain execution-time navigation hints, not snapshots. No product or contract question remains open for implementation.

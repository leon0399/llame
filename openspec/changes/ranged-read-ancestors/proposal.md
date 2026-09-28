## Why

Issue #1018 asks an ordinary ranged `read` to carry the Markdown headings that enclose the requested passage, so a model can identify the section without a separate `:outline` call. The shipped Markdown outline already tracks ancestor headings, while ordinary selectors currently expose only the requested window and its adjacent context; this change makes the same structural context available on the ordinary read path without weakening `:raw`, source admission, or attribution.

## What Changes

- Every explicit, ordinary non-`:raw`, non-`:outline` range over a `text/markdown` source prepends the direct ancestor heading chain of each passage's first shown line, shallowest first. The chain is rendered from the source's own lines with the existing `N:` prefix followed by one space. Setext ancestors include their text and underline; no excerpt line is added and no line is cut.
- A single-range result that prepends at least one ancestor uses the existing plural range shape: `requestedRanges` contains the requested interval and `shownRanges` contains the ancestor lines plus the context-expanded window. Adjacent shown lines merge. A read with no emitted ancestors retains the current singular shape.
- Comma-separated reads apply a chain to every merged passage, deduplicate lines already emitted by earlier passages or chains, and retain source order. `requestedRanges` remains the pre-expansion request; `shownRanges` includes context and ancestor lines.
- Ancestor lines count against the shared 2,000-line and serialized result bounds. A chain that cannot fit together with its passage's first shown line is omitted as a whole, the window still returns, and `nextOffset` continues to identify requested source lines. A continuation starts a fresh ancestor calculation.
- `:raw`, `:outline`, directory reads, unselected reads, empty files, and non-Markdown sources retain their current behavior. In particular, raw content remains verbatim for edit workflows.
- Host, `file://`, `kb://`, and `skill://` reads and web Markdown renders receive the same behavior after their existing permission and source-resolution steps. Knowledge and web envelopes, notices, provenance, and source identity remain unchanged; ancestors grant no authority.
- The read may consume source lines beyond the requested window when the Markdown scanner must settle a deferred block decision. This is bounded by the scanner's existing deferred-run rule and does not add a source cache or input ceiling.

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
- Comma reads apply and deduplicate chains per passage; a continuation at `nextOffset + 1` gets a fresh chain; an over-budget chain is omitted as a whole while the passage progresses.
- Host, `file://`, `kb://`, and `skill://` Markdown reads preserve their existing source and security envelopes. Web Markdown renders receive ancestors, while web `text/plain` and raw renders do not. A Knowledge result keeps its Space attribution and untrusted-content notice.
- The proposal delta passes the canonical preservation script, `openspec validate ranged-read-ancestors --strict`, and `pnpm lint:markdown`.

## Assumptions and Resolved Decisions

The settled brief for #1018 resolves the issue's result-shape, per-passage, cost, bounds, and media-type questions. Media type remains source-derived: the existing file table governs local resources and the existing web render labels govern web resources. Coordinates remain execution-time navigation hints, not snapshots. No product or contract question remains open for implementation.

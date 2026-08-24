## Context

See [proposal.md](proposal.md) for motivation. The shipped `knowledge_search` scans every admitted live Markdown file, returns the first matching line from at most one result per file, and exposes a SHA-256 whole-file hash. The shipped `knowledge_read` opens one explicitly selected file, buffers at most 64 KiB, and succeeds only when the complete result fits below the 15,000-code-unit Knowledge result cap.

Multiple Knowledge Spaces, current-access-per-call authorization, bounded incomplete multi-space results, exact stable-ID attribution, safe path walking, `O_NOFOLLOW` final-file opens, UTF-8 validation, abort propagation, and generic tool persistence/replay are already shipped. This change must preserve those boundaries while making long notes navigable. It does not introduce an index or a filesystem snapshot.

## Goals / Non-Goals

**Goals:**

- Make the same `knowledge_read` tool useful for both whole-file and line-range reads.
- Let search return every reachable literal passage, including multiple non-overlapping passages from one file.
- Make search coordinates directly reusable as read arguments.
- Bound memory, filesystem work, and persisted tool output without presenting a prefix as complete.
- Remove unused model-facing revision syntax while keeping historical tool observations readable.
- Keep the implementation separable into reviewable read, search, and acceptance layers.

**Non-Goals:**

- Stable citations, accepted revisions, Git state, dirty flags, or search/read snapshot isolation.
- Markdown parsing, headings, tables of contents, frontmatter semantics, OKF/OpenWiki behavior, indexes, ranking, or embeddings.
- Generic filesystem access, byte/character-range reads, arbitrary encodings, or non-Markdown files.
- A generic cursor framework or generic partial-result envelope.
- Rewriting already persisted Knowledge tool calls or results.

## Decisions

### D1. Use one zero-based line-slice contract for search and read

`knowledge_read` keeps required `knowledgeSpaceId` and `path` arguments and adds optional `offset` and `limit` safe integers. `offset` is the number of logical lines skipped and defaults to zero. `limit` is the maximum requested logical-line count, accepts 1 through 2,000, and, when omitted, means through the current end of file subject to the server's 2,000-line and output bounds. A negative offset, out-of-range limit, non-integer, or unsafe integer fails input validation before filesystem access.

Search passages return the same zero-based `offset` and positive `limit` pair, so the model can pass those fields directly into `knowledge_read`. Read content renders one-based source line labels because that is the established agent-harness convention and gives future write tools unambiguous anchors; the machine navigation fields remain zero-based, with displayed line number equal to `offset + 1` for the first returned line.

`startLine`/`endLine` was rejected because it mixes a positional endpoint with an inclusive/exclusive convention and differs from the repository's existing offset/limit pagination vocabulary. A separate range object was rejected because it adds nesting without adding semantics.

### D2. Omitted ranges request the whole note but degrade honestly to continuation

If the selected note reaches EOF within 2,000 lines and the Knowledge result cap, a read with no range returns its complete current numbered content. Otherwise it returns the largest non-empty whole-line prefix allowed by the 2,000-line and output bounds and supplies `nextOffset`; it never returns a clipped line or a prefix without continuation metadata. The same output-bound rule applies to an explicit requested range. When more current logical lines remain after any successful slice, the result includes `nextOffset = offset + lineCount`; at current end of file it omits `nextOffset`.

A read result contains `status`, response-time space ID/name, exact relative path, effective `offset`, returned `lineCount`, model-visible line-numbered `content`, optional `nextOffset`, optional `cutReason: "line_limit" | "output_limit"`, and the existing untrusted-content notice. `nextOffset` says that more current lines exist for any reason; `cutReason` appears only when the first server bound reached omitted part of the requested range and tells the model why it should continue. A caller-requested `limit` that completes normally may still produce `nextOffset` without `cutReason`. The result does not add `totalLines`, `eof`, reserved generic `truncated`/`truncationNotice` fields, or a second cursor.

An offset beyond the current logical-line range returns a closed range error rather than an empty success, except that an empty file at offset zero returns empty content. This catches stale or mistaken navigation instead of silently looking like an empty note.

### D3. Stream bounded files and cut only at logical-line boundaries

The filesystem adapter opens the final regular file once with the existing no-follow handle, validates the same trusted path, and reads fixed-size chunks. LF terminates a logical line; CRLF is one delimiter; a lone CR remains source text. Empty files have zero logical lines, a terminal delimiter creates no phantom line, and blank lines count. Search and read use those rules consistently.

Read renders each selected logical line as `<one-based line number>: <source text>` while retaining that line's original LF or CRLF delimiter and retaining the absence of a delimiter on an unterminated final line. The prefixes are model-facing navigation, not canonical file content; coordinates count logical lines, not bytes. Per-line JSON objects were rejected because their repeated field syntax would consume the bounded tool result without improving navigation.

The current 1 MiB admitted search-file bound becomes the shared maximum addressable file size for both operations. A ranged read therefore makes the common long-note case reachable without admitting unbounded files or buffering the whole file. The 15,000-code-unit structured-result cap remains unchanged. If one logical line alone cannot fit in a successful structured result, read returns `knowledge_limit_exceeded`; adding byte-range continuation solely for pathological lines is deferred.

UTF-8 validity applies to the complete admitted file, not merely the returned slice. Otherwise an invalid suffix could be hidden by a valid prefix and later calls could disagree about whether the same file is admissible. The reader validates incrementally while scanning through the file and observes at most the existing per-file byte cap.

Reading the entire file into a larger buffer was rejected because it preserves the exact failure mode ranged reads are meant to remove. Removing the per-file bound was rejected because seeking to a high line offset still requires bounded work without a line index.

### D4. Literal search returns deterministic passage windows

Search remains a case-insensitive literal scan with the existing 1-200-code-point query and 1-10 result limit. It uses no grep subprocess, regex, Markdown parser, ranking score, or index.

Each literal occurrence produces a candidate window containing the matching logical line plus at most one preceding and one following line. Occurrences on the same line share one candidate. Candidate windows in the same file are sorted and unioned transitively when they overlap or touch before result limiting. A merged interval longer than 2,000 lines is then partitioned into adjacent deterministic passages of at most 2,000 lines; boundaries are chosen so every emitted passage contains a literal match and the passages together cover the complete merged interval. Each returned passage contains response-time space ID/name, path, zero-based window `offset`, source-line `limit` from 1 through 2,000, and one `excerpt` of at most 500 Unicode code points. When the source window exceeds the excerpt cap, the excerpt is cropped around a literal match and visibly marks omitted text; `offset` and `limit` still identify the full emitted window to read.

Passages are ordered by current space `(createdAt, id)`, relative path, and candidate offset. The requested result limit applies to passages, not files. No separate matching-line string or `matchMode` is returned: the excerpt already contains the match and this iteration has only one mode.

Paragraph- or heading-aware windows were rejected because #544 owns the Markdown parser and indexed passage semantics. Returning only the first match per file was rejected because it makes later sections of a long note unreachable without guessing a narrower query.

### D5. Add one Knowledge-local live search cursor

`knowledge_search` accepts an optional opaque `cursor` and returns `nextCursor` only when another deterministic passage exists after the last returned result. The cursor binds the normalized request query and optional explicit space selector to the last returned `(spaceCreatedAt, spaceId, path, passageOffset)` ordering tuple. It is canonical base64url data, validated strictly, but is not signed, encrypted, stored server-side, or part of a generic cursor abstraction.

The cursor is a live keyset continuation, not a snapshot receipt. On a later call, current authorization is resolved again; removed spaces disappear, newly added or changed passages after the cursor may appear, and changes ordered before it may be skipped. A cursor used with a different query or selector fails closed as invalid. Deleting the exact anchor does not invalidate the keyset because continuation compares the stored tuple rather than locating a persisted row.

Completeness is evaluated per invocation. An incomplete successful page may still return `nextCursor` when another current passage follows its last result. On unscoped continuation, spaces ordered strictly before the cursor's space key cannot contribute a later passage and are not reopened; the anchor space and every later space are reauthorized and inspected. A failed space before the last returned passage is therefore not retried by a continuation anchored after it. A failed space after the last returned passage is re-evaluated on continuation while it remains after the anchor, producing another bounded warning if it still fails. Failure does not suppress a cursor for later usable passages, and a final incomplete page with no later passage omits `nextCursor`.

Offset pagination was rejected because every continuation already rescans a live filesystem and positional shifts would compound duplicates/skips. Stateful result handles were rejected because they create cache lifetime and authority semantics for an MVP scan. A reusable generic cursor layer was rejected because the existing Knowledge Space cursor and this filesystem traversal have different keys and invalidation rules.

### D6. Remove hashes from the model contract rather than rename them

New search and read successes omit `contentHash`, and `knowledge_read` accepts no `expectedContentHash`. The returned bytes, line coordinates, space identity, and path describe what that individual live call observed; they do not claim later stability. Search-to-read drift is handled by reading current authorized content or searching again, not by rejecting the current file through an optimistic-lock parameter.

The current call path no longer computes SHA-256 solely for output. #544 may independently hash source bytes as internal derived-index identity, and future Git-backed authoring may expose a commit and dirty-state contract if that becomes useful. Neither future mechanism is pre-shaped here.

A renamed `fileContentHash` was rejected because it clarifies the old field but preserves its token cost and false implication that callers should coordinate reads through it. A shortened hash or transient server-side receipt was rejected because each invents collision or state semantics without providing stable citations.

### D7. Preserve existing multi-space failure and safety behavior

Explicit-space failures remain top-level errors. An all-current search that successfully inspects at least one space may retain usable results plus the existing bounded call-level warnings and `complete: false`; payload-cleared replay retains `incomplete`. Global traversal, byte, timeout, cancellation, path, and output limits remain top-level failures and do not turn accumulated passages into a falsely complete response.

The search cursor paginates the deterministic result set; it does not bypass or reset per-call global safety budgets. Current access is checked before every target open exactly as shipped. Search and read retain the configured-root, stable-ID-child, trusted-writer, no-symlink, regular-file, Markdown-only, and safe-error boundaries.

### D8. Keep historical persisted observations immutable

Tool calls already persisted without read ranges remain valid because both new arguments are optional. Historical search/read results containing `contentHash`, `line`, and `snippet` remain stored and replayed as recorded. Newly executed results use only the new passage/range shape. There is no data migration and no rewrite of Chat history.

Knowledge-specific tests and any structured renderer narrow only the newly authored shape; generic persistence continues treating tool result values as bounded JSON. Replay and compaction do not synthesize missing hashes or normalize old observations into the new schema. This makes the breaking change prospective at execution while retaining historical truth.

### D9. Split implementation by independently reviewable behavior

The delivery stack is:

`master <- knowledge-ranges/proposal <- knowledge-ranges/read <- knowledge-ranges/search <- knowledge-ranges/acceptance <- knowledge-ranges/finalize`

The proposal layer owns only the planning artifacts. The read layer owns line coordinates, streaming range extraction, output continuation, and removal of read hashes. The search layer owns multiple passages, merging/cropping, live cursors, and removal of search hashes. Acceptance owns cross-layer Run persistence/replay/UI compatibility, E2E coverage, documentation, roadmap, and changelog. The finalization layer first applies the verified deltas to canonical specs, then archives that same completed active change without modifying runtime behavior or changing the synchronized canonical specs again. No layer mixes indexed-search or overview work from the #541 tracker.

## Risks / Trade-offs

- [A file changes between search and read] -> Treat search coordinates as live navigation hints and let the next call read current authorized bytes; do not imply optimistic locking.
- [A live cursor skips or repeats results after concurrent edits] -> Document live keyset semantics and guarantee deterministic behavior only for an unchanged corpus.
- [UTF-8 validation still scans through the admitted file] -> Keep the existing 1 MiB bound; #544's index removes repeated full scans later.
- [One extremely long line cannot be continued by line offset] -> Return `knowledge_limit_exceeded`; add byte ranges only after a real Markdown use case demonstrates need.
- [Old and new result shapes coexist in history] -> Preserve each observation verbatim and test generic replay/rendering against both shapes.
- [More passages per file consume the result limit early] -> Preserve deterministic ordering and use the live cursor; relevance ranking belongs to #544.

## Migration Plan

1. Land the proposal layer with no runtime behavior.
2. Treat the read declaration change as a coordinated API/worker revision boundary: quiesce new Run acceptance, drain accepted Runs against the old declaration, deploy matching API and worker binaries, then resume. Existing calls without ranges remain valid after the cutover.
3. Repeat that quiesce/drain/deploy/resume boundary for the search declaration change before accepting Runs with cursors and passage results. Existing calls without cursors remain valid after the cutover.
4. Verify new and historical persisted observations through live streaming, reload, bounded replay, and compaction before updating user/operator documentation.
5. In one separate finalization PR, apply the verified deltas to canonical specs and then archive the completed change without altering those synchronized specs again.
6. Rollback requires the same boundary in reverse: quiesce new Run acceptance and drain Runs carrying the newer declaration before restoring older API or worker binaries. No database rollback is required. Historical new-shape JSON remains renderable through the generic tool-result path; rollback MUST NOT rewrite it or assume every Knowledge result contains a hash.

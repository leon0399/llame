# Proposal

## Why

Native tool results repeat data the model already holds and wrap source text in
JSON the model has to decode before it can reuse it. `edit` returns the
replacement as a `diff` and again as numbered `content`, on top of the
`oldText`/`newText` the model just sent; `write` echoes the whole file it was
given; a 40-line `read` spends 31% of its tokens on JSON quoting and `\u003c`
escapes. No surveyed harness hands the model a diff, written content, or a
structured result document ([#1419](https://github.com/leon0399/llame/issues/1419),
[#917](https://github.com/leon0399/llame/issues/917)). Measured on a real
562-line TSX file with the `o200k_base` tokenizer:

| Case                  | Today (tokens) | After (tokens) | Change |
| --------------------- | -------------: | -------------: | -----: |
| `read` 40 lines       |            575 |            395 |   −31% |
| `read` 562 lines      |          4,758 |          3,936 |   −17% |
| `edit`, 4-line change |            280 |            109 |   −61% |
| `write` 562 lines     |          4,740 |              8 |  −100% |
| `grep`, 4 passages    |            447 |            332 |   −26% |
| `bash`, 30 lines      |            361 |            282 |   −22% |
| `bash`, no output     |             27 |             13 |   −52% |

The "after" column is the text shape this change specifies; the `grep` row
keeps today's opaque cursor (192 of its 332 tokens), which a later change
replaces. The measurement script and fixture are recorded in
[design.md](design.md).

A second reason is experimentation. The owner UI renders an `edit` as a diff it
computes from the call's `oldText`/`newText`. An edit regime that does not take
those arguments (hashline anchors, line ranges) has nothing to render from. The
persisted part needs display data the model never sees, through one rule rather
than the three name-based special cases `thumbnail` has today.

## What Changes

- **BREAKING (model-facing)**: every tool result reaching a model passes through
  one rendering entry point, live, on replay, and in the Continue projection.
  `read`, `edit`, `write`, `grep`, and `bash` render as plain text: one header
  line, `N: text` source lines, and one bracketed continuation notice. Every
  other tool keeps its JSON rendering through the same entry point.
- Persisted tool parts keep their structured object. A reserved `display` key
  on any result is persisted and never rendered. The image `thumbnail` moves to
  `display.thumbnail`.
- `edit` persists `display: { startLine, oldText, newText }`, drops `diff`, and
  keeps a post-edit `content` region of the changed lines plus two live lines
  on each side. The model sees a header and the numbered region, never a diff.
- `write` persists no `content` and renders as one status line.
- `grep` renders each file once under a `## <locator>` line, marks a matched
  line as `*N: text`, and emits context lines as `N: text`; the persisted
  passages keep `locator`, `content`, and `matches`.
- `bash` persists `wallTimeMs`, renders `exit <code>, <seconds> s` as its
  header, `(no output)` when both streams are empty, and a `[stderr]` section
  only when stderr is non-empty; `operation` and `executor` are dropped.
- Text payloads are neutralized under the reserved-delimiter rule only: a
  reserved tag name (`tool-result`, `system-reminder`, …) is escaped, every
  other `<` and `>` survives, so a line copied from a result is an exact `edit`
  target. JSON payloads keep today's neutralization.
- Result bounds (16,000 units per native result, 15,000 per `grep` page,
  8,000/32,000 on replay) are measured on the rendered text.
- The `read` header carries the source's total line count.
- `conversation_read` is untouched: it is due to fold into `read`.
- A root `gpt-tokenizer` dev dependency and a measurement script record
  before/after token counts on a fixed fixture set.

## Assumptions, confirmed with Leo

Settled in the grilling of 2026-10-30; codes are stable.

- Q1 — `edit` renders the numbered post-edit region with two context lines,
  not a bare status.
- Q2 — a reserved `display` key, stripped by one serializer, replaces
  name-based stripping; `thumbnail` moves under it.
- Q3 — `display` for `edit` is `{ startLine, oldText, newText }`, not a
  unified diff.
- Q4 — content-bearing tools render as plain text in this change;
  `conversation_read` is excluded; structured tools stay JSON.
- Q5 — reserved-tag neutralization replaces wholesale `<`/`>` escaping.
- Q6, Q9 — `grep` prints each path once and marks a matched line with a `*`
  before its number; one line grammar (`[*]N: text`) for every tool.
- Q7 — the `read` header carries the total line count.
- Q8 — `bash` renders the Codex-style header with exit code and wall time.

Assumptions that follow from those answers but were not asked:

- `conversation_read` keeps its JSON rendering and its current fields.
- Image and PDF results, which carry no `content`, keep JSON rendering.
- Continuation fields (`nextOffset`, `cursor`, `nextCursor`) keep their
  semantics; the text rendering shows each as one notice line. Replacing them
  with re-readable artifacts is [#915](https://github.com/leon0399/llame/issues/915),
  a separate change.
- Clearing old tool results (#1419 T9) is postponed, as Leo stated.

## Deviation from the grilling record

Q5 was answered as "run the authored-text sanitizer over the text payload;
ordinary `<div>` survives". The sanitizer in use also escapes an _unmatched_
closing tag (a value may never close a tag it did not open within that value).
A 20-line window of a JSX file routinely shows `</div>` without its opener, so
that rule would rewrite exactly the lines a model copies into `oldText`. This
proposal therefore applies only the reserved-name rule to text payloads: a tag
naming a reserved delimiter is escaped in any position and spelling; every
other tag passes. The wrapper around a tool result is a bracketed text line,
not a tag, and the wire carries tool results as structured blocks, so the
unmatched-closer rule protects nothing there. Leo to confirm.

## Capabilities

### New Capabilities

- `tool-result-rendering`: how a persisted tool result becomes the text or
  JSON a model reads — the single entry point, the `display` partition, the
  text shapes of `read`, `edit`, `write`, `grep`, and `bash`, the line prefix
  convention, header and continuation lines, neutralization of text payloads,
  and bound measurement on rendered text.

### Modified Capabilities

- `native-file-tools`: "Exact edit replaces one current unique match" returns
  display data and a two-line-context region instead of a diff; "Only a media
  read's image result carries a media locator" stores the thumbnail under
  `display`.
- `media-attachments`: "Unstored images carry a display-only inline thumbnail",
  "A thumbnail over its cap is omitted", and "Thumbnails are display-only" name
  `display.thumbnail` as the stored location.
- `grep-tool`: "Results are ordered, bounded, and paged by a keyset cursor"
  measures its 15,000-unit page budget on the rendered model text.
- `bash-execution`: "Command results are bounded and explicit" adds wall time
  and the empty-output marker.
- `knowledge-tools`: "Knowledge content is untrusted and potentially stale"
  states the reserved-delimiter rule as the one exception to verbatim bytes.

Deliberately unchanged: `tool-calling` "Tool observations survive into later
turns as stored UI parts" (its budgets and `thumbnail` removal hold under the
`display` rule; the rendered text is the serialized text it bounds);
`conversation-reads`; `chat-search`; `web-search`; `mcp-tools`;
`native-file-tools` read, directory, web-read, image, and PDF result
requirements, whose fields stay in the persisted object.

## Impact

- `packages/native-file-tools`: `serialization.ts` becomes the rendering entry
  point; `mutate.ts` result shape; `source-lines.ts` and `grep/page.ts` budget
  measurement on rendered text.
- `apps/api`: `run-execution.service.ts` `toModelOutput` for every tool,
  `tool-observation-part.ts`, `continue-projection.ts`,
  `tool-observation-neutralizer.ts`, `bash-result.ts` and the three bash
  producers, `grep.ts`, `prompt-imports-item.ts` (thumbnail location),
  `machine-files.ts`.
- `packages/ui`: `edit.tsx` renders from `display`; `read.tsx` image thumbnail
  from `display`; `bash.tsx` shows wall time; stories.
- Docs: `docs/product/reference/tools/{read,edit,write,grep,bash}.md`,
  `apps/api/src/tools/prompts/read.md` (the JSON-decoding instruction is
  deleted), `CHANGELOG.md`.
- Historical persisted parts keep their authored shape; the UI tolerates both.
- New root dev dependency: `gpt-tokenizer`.

## Non-Goals

- Replacing continuation cursors and offsets with re-readable artifacts (#915).
- Clearing old tool results on compaction (#1419 T9, #1068).
- Changing `conversation_read`, `search_conversations`, `knowledge_search`,
  `web_search`, or MCP result shapes or their JSON rendering.
- Shortening spec-mandated untrusted-content notices (#1419 T7).
- Plain-text cursors for `grep` (#1419 T10 comment); superseded by #915.
- Any change to edit matching semantics; this change only makes a later regime
  renderable.

## Acceptance

- Every tool result a model receives, live or replayed, is produced by one
  function; a `display` key never reaches a model on any path.
- `write` results carry no content; `edit` results carry no diff; both are
  verified by a test that fails on the old shape.
- A `read`, `edit`, `grep`, or `bash` result with `</div>` reaches the model
  verbatim; one with `</tool-result>` reaches it escaped.
- Before/after `o200k_base` token counts on the fixture set are recorded in
  `design.md` and reproducible by the committed script.
- The owner UI renders live and historical `edit`, `write`, `read`, `grep`,
  and `bash` parts, including parts persisted before this change.

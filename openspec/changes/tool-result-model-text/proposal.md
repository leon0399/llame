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

| Case                                     | Today (tokens) | After (tokens) | Change |
| ---------------------------------------- | -------------: | -------------: | -----: |
| `read` 40 lines                          |            575 |            395 |   −31% |
| `read`, bound-limited (386 of 562 lines) |          4,758 |          3,961 |   −17% |
| `edit`, 4-line change                    |            280 |            109 |   −61% |
| `write` 562 lines                        |          4,740 |              8 |  −100% |
| `grep`, 4 passages                       |            447 |            336 |   −25% |
| `bash`, 30 lines                         |            361 |            282 |   −22% |
| `bash`, no output                        |             27 |             13 |   −52% |

The "after" column is the text shape this change specifies, with the shown
window held equal to today's. The bound-limited row is today's 16,000-unit JSON
bound stopping at line 386; its "after" adds the continuation line and does not
refill the window to the text bound. The `grep` row keeps today's opaque cursor
(192 of its 336 tokens), which a later change replaces. The measurement script
and fixture are recorded in [design.md](design.md).

A second reason is experimentation. The owner UI renders an `edit` as a diff it
computes from the call's `oldText`/`newText`. An edit regime that does not take
those arguments (hashline anchors, line ranges) has nothing to render from. The
stored part needs display data the model never sees, through one rule rather
than the name-based special cases `thumbnail` has today.

## What Changes

- **BREAKING (model-facing)**: every tool result reaching a model passes through
  one rendering function, live, on replay, and in the Continue projection. Its
  input is the tool result object; replay rebuilds a failure from the stored
  outcome and error text. `read`, `edit`, `write`, `grep`, and `bash`
  successes render as plain text: one header line, `N: text` source lines, and
  one bracketed continuation notice. Every other result, failures included,
  keeps its JSON rendering through the same function, and image and PDF reads
  keep their media reference.
- Stored tool parts keep their structured object. A reserved `display` key on
  any result is stored and never rendered. The image `thumbnail` moves to
  `display.thumbnail`; a part stored with a top-level `thumbnail` is still
  stripped on every path.
- `edit` stores `display: { startLine, oldText, newText }`, drops `diff`, and
  keeps a post-edit `content` region of the changed lines plus two live lines
  on each side, with the post-edit `lineCount`. The model sees a header and
  the numbered region, never a diff.
- `write` stores no `content` and renders as one status line with `lineCount`.
- Text reads store `lineCount` when it is known: web renders always, files
  of at most 32 MiB by a line-feed byte scan; directory listings store
  `entryCount`; larger files and outlines store none. The `read` header
  carries the count when present, and the continuation line names the
  remaining lines.
- `grep` renders each run of a file's passages under one `## <locator>` line,
  marks a matched line as `*N: text`, emits context lines as `N: text`, and
  marks a capped twentieth passage; the stored passages keep `locator`,
  `content`, and `matches`.
- `bash` stores `wallTimeMs` when the producer reports it, renders `exit
  <code>, <seconds> s` as its header, `(no output)` when both streams are
  empty, and a `[stderr]` section only when stderr is non-empty; `operation`
  and `executor` are dropped. Cut output ends with a marker. A
  `command_failed` message uses the same shape with the non-zero exit code,
  inside the JSON failure object.
- **BREAKING (neutralization)**: every tool result payload, text or JSON
  (keys and string values), live or replayed, is neutralized under one rule:
  a tag naming a reserved delimiter is escaped, every other character
  survives. The wholesale
  `<`/`>` escaping of native results and the unmatched-closer rule of
  `neutralizeToolResult` are deleted, so a line copied from a result is an
  exact `edit` target. The replay framing stops applying a second pass.
- Result bounds (16,000 units per native result, 15,000 per `grep` page) are
  measured on the neutralized rendering, so the neutralizer and renderers live
  in a package every bounding process can import, the Machine daemon included.
  The global result cap measures the rendering too.
- Machine wire changes are additive: `lineCount`, `entryCount`, `wallTimeMs`,
  and `display` are new optional fields; the hub maps an old daemon's
  `diff`/`operation`/`executor` away, keeps its `content` and `shownRange`,
  and renders without the missing counts. A new daemon needs a new hub; the
  runbook orders the hub first.
- Parts stored before this change render from the fields they have: no total
  in a `read` or `write` header, no counts in an `edit` header, no time in a
  `bash` header, no content for a stored `write`.
- A prompt import (`@` marker) embeds the `read` text rendering, as
  `prompt-imports` already requires of the model-facing output.
- The model-facing tool descriptions (`apps/api/src/prompts/tools/*.md`)
  describe the text shapes; the JSON-decoding instruction is deleted.
- `conversation_read` is untouched: it is due to fold into `read`.
- A root `gpt-tokenizer` dev dependency and a measurement script record
  before/after token counts on a fixed fixture set; the "today" column is a
  committed fixture captured at `64db12c9`.

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
- Q6, Q9 — `grep` prints each path once per run of passages and marks a
  matched line with a `*` before its number; one line grammar (`[*]N: text`)
  for every tool.
- Q7 — the `read` header carries the total line count.
- Q8 — `bash` renders the Codex-style header with exit code and wall time.

Assumptions that follow from those answers but were not asked:

- `conversation_read` keeps its JSON rendering and its current fields.
- Image, PDF, and `skill://` catalog results, which carry no `content`, keep
  JSON rendering.
- Continuation fields (`nextOffset`, `cursor`, `nextCursor`) keep their
  semantics; the text rendering shows each as one notice line. Replacing them
  with re-readable artifacts is [#915](https://github.com/leon0399/llame/issues/915),
  a separate change.
- Clearing old tool results (#1419 T9) is postponed, as Leo stated.
- A non-zero exit stays a `command_failed` error outcome; only its message
  takes the text shape.

## Deviation from the grilling record

Q5 was answered as "run the authored-text sanitizer over the text payload;
ordinary `<div>` survives". The sanitizer in use also escapes an _unmatched_
closing tag (a value may never close a tag it did not open within that value).
A 20-line window of a JSX file routinely shows `</div>` without its opener, so
that rule would rewrite exactly the lines a model copies into `oldText`. This
proposal therefore applies only the reserved-name rule to tool results: a tag
naming a reserved delimiter is escaped in any position and spelling; every
other tag passes. It applies the same rule to JSON payloads and error texts,
so there is one regime for tool results instead of three (`\u003c` for native
JSON, both rules for other JSON, both rules again over the replay wrapper).
The wrapper around a tool result is a bracketed text line, not a tag, and the
wire carries tool results as structured blocks, so the unmatched-closer rule
protects nothing there. Leo to confirm.

## Capabilities

### New Capabilities

- `tool-result-rendering`: how a stored tool part becomes the text or JSON a
  model reads — the rendering function, the `display` partition, the global
  cap on the rendering, the text shapes of `read`, `edit`, `write`, `grep`,
  and `bash`, the line prefix grammar, header, attribution, and continuation
  lines, rendering of parts stored before the contract, the one neutralization
  rule, and bound measurement on the neutralized rendering.

### Modified Capabilities

- `native-file-tools`: "Exact edit replaces one current unique match" returns
  display data, `lineCount`, and a two-line-context region instead of a diff;
  "Image reads return an image result" and "Only a media read's image result
  carries a media locator" store the thumbnail as `display.thumbnail`. Added:
  "A write result carries no content" and "A text read carries the source
  line count when it is known".
- `media-attachments`: "Unstored images carry a display-only inline thumbnail",
  "A thumbnail over its cap is omitted", and "Thumbnails are display-only" name
  `display.thumbnail` as the stored location.
- `grep-tool`: "Results are ordered, bounded, and paged by a keyset cursor"
  measures its 15,000-unit page budget on the rendered model text.
- `bash-execution`: "Command results are bounded and explicit" adds wall time,
  the `command_failed` text shape, and drops the constant fields.
- `knowledge-tools`: "Knowledge content is untrusted and potentially stale"
  states the reserved-name rule as the one exception to verbatim bytes.
- `tool-calling`: "Framing llame authors inside tool results is a packaged
  template" hands payload neutralization to `tool-result-rendering` and keeps
  the framing bytes.

Deliberately unchanged, with the reading this change relies on:

- `tool-calling` "Tool failure is an observation, not a crash": its cap is
  "measured over the serialized result"; this change defines the serialized
  result as the rendering, and its `thumbnail` lives at `display.thumbnail`.
- `tool-calling` "Tool observations survive into later turns as stored UI
  parts": its budgets measure "the exact serialized text of the pair", which
  is the rendered pair; `thumbnail` there means `display.thumbnail`, and a
  stored top-level `thumbnail` is removed on every path as the requirement
  demands. Its "neutralized" bullet is satisfied by the one rule, keys
  included.
- `prompt-imports` "Imported results equal native read output": the body is
  the `read` rendering, so it stays equal.
- `turn-actions` Continue "as the live loop sent it": a part stored before
  deployment is sent in the new rendering; the live loop would send the same.
- `native-file-tools` "Ranged Markdown reads prepend ancestor headings": its
  "post-edit previews remain unchanged" excludes previews from ancestor
  prepending only; the preview's own shape is this change's.
- `native-file-tools` "Web read results carry the final URL and retrieval
  method": the stored result and its `content` carry no header; the header is
  part of the rendering only.
- `instance-config` "Prompt-file rules govern replaceable files only": its
  reserved-delimiter rules apply "wherever a producer neutralizes untrusted
  text", and a tool result is such a producer. This change keeps rule 2, the
  reserved-name rule, for tool results and drops rule 1, the unmatched-closer
  rule, because a 20-line window of a JSX file carries `</div>` without its
  opener. A tool result is therefore governed by the reserved-name rule alone,
  as `tool-result-rendering` states.
- `grep-tool` "Every hit is a locator that the read group admits": the stored
  passages keep their ranged `locator`; the rendered `##` line plus a line
  number forms the same argument.
- `conversation-reads`, `chat-search`, `web-search`, `mcp-tools`,
  `agent-skills`, `remote-machines` (additive wire fields keep protocol
  version 1 as the Git methods did; during skew an old daemon bounds by JSON
  and sends no counts), and the `read`, directory, PDF, and outline
  requirements of `native-file-tools`.

## Impact

- `packages/runtime-safety`: the reserved-name neutralizer and the global cap
  measured on the rendering.
- `packages/native-file-tools`: `serialization.ts` replaced by the
  `read`/`edit`/`write` renderers; `mutate.ts` result shape; `lineCount` and
  `entryCount`; `source-lines.ts`, `stream-read.ts`, `directory-listing.ts`,
  and `grep/page.ts` budget measurement on rendered text; the `grep` renderer.
- `packages/machine-protocol`, `apps/machine`: additive wire fields.
- `apps/api/src/tools/conversation-read.ts`: bounds on the one rule.
- `apps/api`: `run-execution.service.ts` `toModelOutput` for every tool and
  the end of result neutralization in `settleBoundTool`;
  `tool-observation-part.ts`, `continue-projection.ts`,
  `tool-observation-neutralizer.ts`, `instance-config/authored-text.ts`,
  `tools/runner.ts`, `bash-result.ts` and the three bash producers, `grep.ts`,
  `chats/prompt-imports-item.ts` (thumbnail location), `machine-files.ts`,
  `machine-call.ts`, `skills/skill-results.ts`, `web-read/result.ts` and
  `native-files.ts` (envelope reservation becomes attribution-line width).
- `packages/ui`: `edit.tsx` renders from `display`; `read.tsx` image thumbnail
  from `display`; `bash.tsx` shows wall time; stories.
- Docs: `docs/product/reference/tools/{read,edit,write,grep,bash}.md`,
  `apps/api/src/prompts/tools/{read,edit,write,grep,bash}.md` (the JSON
  descriptions become the text shapes; the JSON-decoding instruction is
  deleted; the reserved-name rule is named),
  `docs/product/operator/machines.md` (hub before daemon), `CHANGELOG.md`.
- Historical stored parts keep their authored shape; renderers and UI rows
  tolerate both.
- New root dev dependency: `gpt-tokenizer`.

## Non-Goals

- Replacing continuation cursors and offsets with re-readable artifacts (#915).
- Clearing old tool results on compaction (#1419 T9, #1068).
- Changing `conversation_read`, `search_conversations`, `knowledge_search`,
  `web_search`, or MCP result shapes or their JSON rendering.
- Shortening spec-mandated untrusted-content notices (#1419 T7).
- Plain-text cursors for `grep` (#1419 T10 comment); superseded by #915.
- Making a non-zero exit a success outcome.
- Any change to edit matching semantics; this change only makes a later regime
  renderable.

## Acceptance

- Every tool result a model receives, live, replayed, or kept by Continue, is
  produced by one function; a `display` key or a stored top-level `thumbnail`
  never reaches a model on any path.
- `write` results carry no content; `edit` results carry no diff; both are
  verified by a test that fails on the old shape.
- A `read`, `edit`, `grep`, or `bash` result with `</div>` reaches the model
  verbatim; one with `</tool-result>` reaches it escaped; a replayed
  `command_failed` message gets the same treatment.
- A read that fills its 16,000-unit text bound is stored without a
  `truncationNotice`.
- Before/after `o200k_base` token counts on the fixture set are recorded in
  `design.md` and reproducible by the committed script.
- The owner UI renders live and historical `edit`, `write`, `read`, `grep`,
  and `bash` parts, including parts stored before this change.

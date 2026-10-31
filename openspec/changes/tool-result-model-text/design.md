# Design

## Context

Inspected at `64db12c9` (`origin/master`, 2026-10-30). See
[proposal.md](proposal.md) for motivation.

- Only `read`, `edit`, and `write` have a `toModelOutput` hook
  (`apps/api/src/runs/run-execution.service.ts:1853-1878`, attached when
  `isNativeFileTool`, `apps/api/src/tools/native-files.ts:609-615`). It calls
  `serializeNativeModelOutput` (`packages/native-file-tools/src/serialization.ts:9-21`):
  strip `thumbnail` for `kind === 'image'`, `JSON.stringify`, then `<`/`>` to
  `\u003c`/`\u003e`. Every other tool returns `neutralizeToolResult(result)`
  from `settleBoundTool` (`run-execution.service.ts:1839`;
  `apps/api/src/chats/tool-observation-neutralizer.ts:16-24`, both sanitizer
  rules over every string) and reaches the model as the AI SDK's default JSON.
- Replay re-serializes the stored object: native names through
  `serializeNativeModelOutput`, others through `JSON.stringify`
  (`apps/api/src/chats/tool-observation-part.ts:225-267`), wrapped in
  `apps/api/src/chats/prompts/tool-output-untrusted.md` and passed through
  `sanitizeAuthoredText` as a whole (`:283-291`). The Continue projection has
  the same split (`apps/api/src/chats/continue-projection.ts:176-194`) and
  sends JSON tools as `{ type: 'json' }`. A failure is stored as
  `errorText` only (`apps/api/src/runs/assistant-transcript.ts:400-405`), so
  a replayed error body is sanitized only by that wrapper pass.
- The stored part holds the tool's object verbatim
  (`assistant-transcript.ts:396`). `thumbnail` is special-cased by name in
  `serialization.ts:13-17`, `packages/runtime-safety/src/result-truncation.ts:173-179`,
  `apps/api/src/chats/prompt-imports-item.ts:84,153-168`, and produced at
  `apps/api/src/media/tool-media-store.ts:117-126`.
- The global cap `truncateOversizedResult` runs on every result in
  `apps/api/src/tools/runner.ts:459,469` and measures `JSON.stringify(result)`
  against 16,000 (`result-truncation.ts:12,181`).
- `edit` and `write` results (`packages/native-file-tools/src/mutate.ts:38-50`,
  `:143-206`) carry `diff`, numbered `content` (one context line), `shownRange`,
  `truncated`; bounding shrinks `content` first, then binary-searches `diff`.
  A read result carries no total line count
  (`packages/native-file-tools/src/source-lines.ts:17-36`); the count is
  computed only for `N-`/`-K` selectors. The UI renders the edit diff from
  `input.oldText`/`newText` (`packages/ui/src/components/custom/edit.tsx:253-285`),
  reads the result only for the `@@ replacement at line N @@` header, and
  never shows `content` (`:286-297`).
- `grep` pages (`apps/api/src/tools/grep.ts:456-469`) carry
  `results[{locator, content, matches, truncated?}]`, `complete`, `warnings`,
  `notice?`, `cursor?`; the page budget is `measureNativeModelOutput` of the
  JSON (`packages/native-file-tools/src/grep/page.ts`,
  `grep/cursor.ts:86-113` reserves the cursor's JSON width). `matches` are
  absolute one-based line numbers.
- `bash` success is `{status, operation:'bash', executor:'managed', exitCode,
  stdout, stderr, truncated}` (`apps/api/src/tools/bash-result.ts:10-22`); a
  non-zero exit becomes `{status:'error', type:'command_failed', message}`
  with the streams inside `message` (`:37-41`). No producer measures elapsed
  time (`packages/bash-executor/src/types.ts:24-33`,
  `apps/api/src/tools/ssh-bash.ts:104-127`,
  `apps/api/src/tools/machine-call.ts:349-371`).
- The Machine daemon builds `read`/`edit`/`write`/`bash` results from the
  shared packages (`apps/machine/src/files.ts:243-272`); the hub requires
  `diff` and `content` (`apps/api/src/tools/machine-files.ts:493-507`) and
  `operation`/`executor` (`machine-call.ts:353-356`). Additive wire fields
  keep `PROTOCOL_VERSION` 1 (`packages/machine-protocol/src/git.ts:3`).
- The sanitizer (`apps/api/src/instance-config/authored-text.ts:116-172`)
  applies two rules: a reserved tag name (seven names, matched
  case-insensitively) is escaped in any position (rule 2), and an unmatched or
  malformed closing tag is escaped (rule 1).
- Clients can send only `text` and `file` parts; any other part is dropped
  (`apps/api/src/chats/context-item.ts:222-237`), and the DTO forbids unknown
  keys. There is no `thumbnail`-specific rejection.
- The web UI hands the stored `output` to each row unchanged; every row parses
  it with its own zod schema and falls back to raw JSON when the shape does not
  match (`packages/ui/src/components/custom/tool-row.tsx:95-108`).
- No tokenizer is installed; every bound is UTF-16 code units.

### Prior art

Source inspected at the pinned revisions; full notes in the issue thread.

| Harness (revision)   | UI-only data                                                                                    | Model format                                                                                                                                                 | After `edit`                                                                                           | Delimiters                         |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| OMP `dcafcef`        | `details` beside `content` (`packages/agent/src/types.ts:1025-1038`); `wallTimeMs` details-only | text: `[path#TAG]` + `N:content`; grep `## file` + `*N:content` (`match-line-format.ts:9-21`); `[N more lines. Use :M to continue]`; spill to `artifact://N` | `[path#TAG]` + post-edit rows, changed ±2 (`crates/pi-edit/src/session.rs:495-535`)                    | none; warns on prefix-looking rows |
| OpenCode `70a2469`   | `metadata.diff` UI-only; replay uses `state.output` only                                        | text; `Edit applied successfully.`; truncation to a file with a hint (`tool/truncate.ts:120-186`)                                                            | bare status                                                                                            | none                               |
| Codex CLI `13ab0b2`  | diff on a separate event channel                                                                | text: `Exit code: N` / `Wall time: 1.2 seconds` / `Output:` (`core/src/tools/mod.rs:92-116`)                                                                 | `Success. Updated the following files:\nM p`                                                           | none                               |
| Gemini CLI `b633c07` | `llmContent` / `returnDisplay` slots (`tools.ts:750-768`)                                       | `{"output": text}` envelope; read has no line prefixes; grep `L<n>:` prefixes                                                                                | `Successfully modified file: p (N replacements)` + ±5 merged context, no numbers (`edit.ts:1086-1092`) | escapes its own closing tag only   |
| goose `090dedb`      | text blocks + `structured_content`                                                              | text; 2,000 lines / 50 KB then tempdir file                                                                                                                  | `Edited p (3 lines -> 5 lines)`                                                                        | none                               |

Consensus: plain text with a small fixed header to the model, a sibling slot
for UI data, no diff fed back. The fork is bare status versus post-edit
region; Q1 chose the region.

## Goals / Non-Goals

**Goals:**

- One function produces every model-facing rendering of a tool result; the
  stored part is the input on every path, failures included.
- A stored field the model must not see has one home, `display`.
- Content-bearing results are text a model can copy back into an `edit`
  argument without decoding.
- Bounds are measured on what the model receives, in every process that
  bounds.

**Non-Goals:**

- Changing what the UI renders for structured tools, or the UI's tolerance of
  historical shapes.
- A new package. The renderer and neutralizer live in packages that exist.
- A text rendering for `conversation_read`, image, PDF, skill-catalog, or
  structured results.

## Decisions

### D1: One rendering function in `apps/api`, renderers in the packages that own the shapes

`renderToolResultForModel(toolName, result)` in `apps/api/src/tools/model-text.ts`
is the only function that turns a tool result into model content. Its input
is the `ToolResult` object the executor returned: a success object, or a
failure object `{ status: 'error', type, message, rejectedUrl?, leftDirectory? }`.
Live and Continue already hold that object; replay rebuilds a failure from
the stored `outcome`, `errorText`, and `errorRejectedUrl`
(`resolveResultBody` does this today), so `leftDirectory` stays live-only as
it is now. The function selects a text renderer for `read`, `edit`, `write`,
`grep`, and `bash` successes by tool name (Machine variants share the names),
and renders every other success and every failure as JSON. A renderer reads the
`display` values its shape needs — an edit header's start line and line counts —
and the emitted rendering carries no `display` key, nor a legacy top-level
`thumbnail`. It returns the rendered string and its kind, `text` or `json`. The three call sites wrap it as they do today:
`toolResultOutput(text, retainedReadRef(...))` for native tools, so an image
or PDF read keeps its media reference and the SDK output type `text` it has
now; `{ type: 'json', value }` for JSON tools live and in Continue; the
untrusted framing on replay. Call sites: `createModelToolDefinition` (every
tool gets a `toModelOutput`), `settleBoundTool` (stops neutralizing; the hook
receives the result object), `tool-observation-part.ts`, and
`continue-projection.ts`. The prompt-import body
(`run-execution.service.ts:2938`) is the same `read` rendering, as
`prompt-imports` "Imported results equal native read output" demands.

The `read`, `edit`, and `write` renderers live in
`packages/native-file-tools/src/model-text.ts`, `grep`'s in
`packages/native-file-tools/src/grep/`, and `bash`'s in
`packages/bash-executor`, because the package bounding code and the Machine
daemon measure them. `measureNativeModelOutput` stays until the last bound
moves: in the seam layer it measures the JSON rendering with the reserved-name
rule, which is never shorter than what is sent; each text layer re-points its
own bounds (`source-lines.ts`, `stream-read.ts`, `directory-listing.ts`,
`markdown-ancestors.ts`, `markdown-outline.ts`, `mutate.ts`, `web-read/result.ts`,
`grep/page.ts`, `apps/api/src/tools/grep.ts`) at the text renderer, and the
grep layer deletes it. `conversation-read.ts` bounds itself on
`neutralizeToolResult` today and switches to the reserved-name rule in the
seam layer. The aggregate JSON measures that are not tool results
(`skills/skill-activation.ts`) use `measureJson` in `runtime-safety`. The
`reserveCodeUnits` the scheme resolvers pass (`native-files.ts:272,373,450`,
`web-read/result.ts:81,198`) becomes the width of the attribution lines their
envelope renders.

Rejected: rendering at the tool (returning text from the executor). The
stored part would then be text, the UI would lose its structured rows, and
history would carry two shapes.

### D2: `display` is a reserved key of every result object

Any result may carry `display: Record<string, unknown>`. The rendering
function reads the values its shape needs and emits no `display` key;
`truncateOversizedResult` sets the object aside and re-attaches it unchanged,
as it does for `thumbnail` today. `thumbnail` becomes
`display.thumbnail` at its producer (`tool-media-store.ts`) and at the read
of it in `prompt-imports-item.ts`; the prompt-import payload keeps its own
`thumbnail` key, which the web client parses strictly. A part stored before the change keeps its
top-level `thumbnail`; the rendering function removes that too, so the
canonical "a thumbnail never reaches the model" holds for old and new parts.
`edit` stores `display: { startLine, oldText, newText }`; `bash` stores
`wallTimeMs` as an ordinary field (the model sees it in the header) and
nothing under `display`. A client cannot submit a tool part at all
(`context-item.ts:222-237` drops every part that is not `text` or `file`, and
the DTO forbids unknown keys), which is the boundary the negative test pins;
the canonical "rejected" wording is kept.

Rejected: a per-tool strip list (a fourth special case per field) and a
sibling column on the part (a schema change for the same effect; the part
already holds one object).

### D3: Text shapes

Line grammar everywhere: `N: text`, and `*N: text` for a `grep` match. The
renderer never numbers a `raw` read. Shapes, with `<locator>` the caller's
locator as the stored `path`, and `[…]` parts present only when their field
is:

```text
read   <locator>:<start>-<end>[ of <lineCount> lines]
       <attribution lines>
       <N: text …>
       [[<k> more lines. ]Use <locator>:<nextOffset+1>-<end> to continue]
       [<truncationNotice>]

       multi-range: <locator>:<a>-<b>,<c>-<d>[ of <lineCount> lines]
                    resume with the remaining members: :<n+1>-<b>,<c>-<d>
       raw:         <locator>:raw:<a>-<b>[ of <lineCount> lines]
       outline:     <locator>:outline:<a>-<b>
                    resume: :outline:<n+1>-<end>
       open-ended:  the resume selector is :<n+1>- once nextOffset reaches the
                    stored requested end or that end reaches lineCount (an
                    unselected read with a known count stores lineCount as its
                    end, so a cut at 1500 resumes :1501-, and an explicit
                    :1-2000 cut at 1500 resumes :1501-2000)
       directory:   the stored content as-is (its first line is the path),
                    then [[<k> more entries. ]Use <locator>:<n+1>- to continue]
       empty:       <locator>: empty                       (not truncated)
       skipped:     <locator>: line <nextOffset> exceeds the result bound and was skipped

edit   edited <locator>: line <startLine>, <old> -> <new> lines[ (<lineCount> lines total)]
       <attribution lines>
       <N: text …>   changed lines plus two live lines each side
       [region cut at the bound]                           when truncated
       stored without display: edited <locator>: region from line <shownRange.startLine>

write  created <locator>[ (<lineCount> lines)]
       replaced <locator>[ (<lineCount> lines)]
       <attribution lines>

grep   <notice line, when present>
       ## <file locator>          one per run of consecutive passages of a file
       *<N>: <matched line>
       <N>: <context line>
                                  (blank line between passages of one run)
       [more passages in this file; read it to see them]   after a capped 20th
       [warnings: <count> <kind>, …]
       [more results. Continue with cursor: <cursor>]

bash   exit <code>[, <seconds> s]
       <stdout>
       [stderr]
       <stderr>
       (no output)                             when both streams are empty
       [output cut at the bound]               when truncated
       [<truncationNotice>]
```

Attribution lines render one `<field>: <value>` per field the stored object
carries, in the order the spec lists; `adapter` joins `id`, `route`, `origin`
with spaces; `notes` renders one line per entry. The Knowledge and skill
notices stay verbatim: they are closed templates under `tool-calling`.

`<k>` is `lineCount - nextOffset` and appears only when `lineCount` is
stored. Reads stream and stop when the window is full
(`stream-read.ts:150-200`); the only count today is `countSourceLines`, a
positional line-feed byte scan that runs for `N-`/`-K` selectors
(`:470-490`). `lineCount` reuses that scan, without a decode, for files of at
most 32 MiB (a few milliseconds; invalid UTF-8 after the window cannot fail
the read), and is omitted above that size so a ranged read of a multi-GiB log
stays a window read. A web render, an `edit`, and a `write` hold the text in
memory and count it directly. An outline stores none (its scan can stop
early). A directory stores `entryCount`, the requested-level count the
listing already computes. `command_failed` and `timed_out` messages are
composed by `bash-result.ts` in the bash shape, so the error text a model
reads live and on replay is the same shape as a success, inside the JSON
failure object.

Rejected: Gemini's unnumbered context (loses the anchor a chained `edit` uses);
ripgrep's `N-` context separator (a second prefix grammar); printing `status`
or `path` as fields (both are in the header); a text form for the `skill://`
catalog (a list of packages, not content; it keeps JSON with image and PDF); a
second header line on a directory listing (its stored content already starts
with the path, as `native-file-tools` requires); counting `lineCount` by
decoding the rest of the stream (a decode failure after the window would turn
a success into `invalid_utf8`).

### D4: One neutralization rule, in a package

The reserved-name rule (rule 2 of `authored-text.ts`) moves to
`packages/runtime-safety/src/reserved-delimiters.ts` with the reserved set;
`runtime-safety` has no runtime dependencies and `native-file-tools`,
`bash-executor`, and `apps/machine` already depend on it, so no cycle.
`authored-text.ts` imports it and keeps rule 1 for owner-authored prompt
values. The rendering function applies the rule to a text rendering as a
whole and to every object key and string value of a JSON rendering, failure
objects included; keys matter because an MCP `structuredContent` key is
server-authored and the replay wrapper pass that escaped it is gone. `neutralizeToolResult`
is deleted; the replay wrapper no longer sanitizes the composed result, since
its own lines are static and the payload arrives neutralized. The package
renderers call the same function before measuring, so a bound counts the
escaped width.

Rejected: keeping rule 1 for JSON tools (three regimes for one boundary);
keeping the wrapper pass (double escaping of `&lt;`, and a second place to
audit).

See the proposal's deviation note for why rule 1 is excluded from tool
results.

### D5: Every bound measures the neutralized rendering

`selectSourceLines`, `selectMultiRangeLines`, the directory bound,
`boundMutationResult`, and `appendGrepFile` measure the renderer's output for
the candidate result. The grep cursor reservation (`grepCursorFieldUnits`,
the 64-zero placeholder hash) becomes the width of the continuation line for
the candidate cursor. The replay budgets keep measuring
`JSON.stringify(pairEnvelope)`, whose payload is now the rendered text. The
global cap (`truncateOversizedResult` in `runtime-safety`, called from
`runner.ts` and once more in `mcp-runtime.service.ts:601`) takes a measure
parameter and measures `renderToolResultForModel` for the result, so a
self-bounded text result at exactly 16,000 units passes unchanged while an
oversized JSON result is cut as before. Its shrink still converges: one limit
applies to every string, so the rendered length rises with the limit, and the
binary search accepts only candidates that fit. The notice's omitted count is
stated in rendered units. The renderer shows the `truncationNotice` as a
bracketed line.

The earlier draft kept the cap on the JSON and argued text is never longer;
that is true and irrelevant: a text bounded at 16,000 serializes to more than
16,000 JSON characters and the cap would cut it.

### D6: `edit` and `write` stored shapes

```ts
{
  status: 'success', operation: 'edit', path, replacements: 1,
  content,            // changed lines plus two live lines each side, numbered
  shownRange, truncated,
  lineCount,          // post-edit total
  display: { startLine, oldText, newText },
}
{ status: 'success', operation: 'write', path, created | replaced, lineCount }
```

`diff` is gone. The UI's `EditDiff` takes `display` when present and falls
back to `input.oldText`/`newText` plus the legacy `diff` header for parts
stored before this change. The UI already renders a write's content from the
input. The hub's `readFsMutateResult` accepts both the new fields and an old
daemon's `diff`/`content`/`shownRange`, forwards `content` and `shownRange`
so the legacy edit form renders, and drops `diff`. Skew runs one way: an old
daemon on a new hub works; a new daemon on an old hub fails `edit`, `write`,
and `bash` because the old hub requires the removed fields. The operator
runbook says to update the hub before the daemon.

### D7: `bash` wall time

Every producer (managed watcher, SSH, Machine) records `wallTimeMs` from
spawn to settlement. Success carries it as a field; `command_failed` and
`timed_out` messages name the elapsed time in seconds with one decimal. The
Machine wire gains the field as optional; the hub maps `operation` and
`executor` away and renders `exit <code>` without a time when a daemon sends
none.

### D8: Measurement

A root dev dependency `gpt-tokenizer` and `scripts/measure-tool-results.mjs`
produce the proposal's table with `o200k_base`. The fixture file is
`apps/web/app/(chat)/components/chat-message-row.tsx` at `64db12c9` (562
lines), read with `git show 64db12c9:<path>` rather than copied. The "today"
column is a committed JSON fixture of the result objects the old serializer
produced at `64db12c9`, captured once from a worktree at that commit. The
"after" column, per row: `read` rows render the fixture objects with
`lineCount` injected, holding the window equal to today's (so the
bound-limited row stays comparable rather than refilling to the text bound);
`edit` and `write` rows run the live package on a temporary copy; `grep` rows
render the fixture passages; `bash` rows render fixture objects. Run:
`pnpm --filter @workspace/native-file-tools build && node scripts/measure-tool-results.mjs`.
The numbers in the proposal came from the scratch script at `64db12c9`; the
committed script reproduces them from the fixture.

### D9: Layering

Five layers. The first lands the rendering function on every path with JSON
output, `display` with the thumbnail move and the legacy strip, the one
neutralization rule, and the cap on the rendering: a run then exercises the
new seam with every tool's text unchanged except for escaping. The second
adds the `read` text, `lineCount`/`entryCount`, the read bounds on text, the
`fs.read` wire field, the prompt-import body, and the `read` description. The
third adds the `edit`/`write` shapes and text, the mutate wire mapping, the UI
edit row, and the `edit`/`write` descriptions. The fourth adds `grep` and
`bash` and closes both issues. The fifth is finalize. Round 2 measured the
earlier combined file layer above the budget (59 test references to the
measure, 26 `diff:` references, six header forms, the UI, and the
descriptions), which is why read and mutation are separate.

## Risks / Trade-offs

- [A model trained on JSON tool results treats a text header as prose] → the
  header is one line in a fixed form; the reference harnesses ship the same
  shape; a torture run on the second layer's draft is the check before ready.
- [A reserved tag inside source code is escaped and an `edit` with that line
  as `oldText` misses] → the set is seven names (`system-reminder`,
  `tool-call`, `tool-result`, `user_chat_history`, `user_personalization`,
  `skill`, `available_skills`), matched case-insensitively. They do occur in
  llame's own repository (tests and prompts) and `<Skill>` is a plausible JSX
  component, so an agent editing llame will meet it. The failure is the
  existing `stale/missing-target` error, the `read` description names the
  rule, and the model can re-read with `:raw` to see the escaped form.
- [Rendered-text budgets differ from JSON budgets, so a page holds more
  lines] → the bounds are unchanged in code units; only the measured string
  changes; tests pin the bound on the rendered string.
- [Historical `edit` parts carry `diff` and no `display`] → the UI keeps the
  input-derived fallback and the renderer has a stated legacy form; no history
  is rewritten.
- [Hub and daemon versions differ] → every wire change is additive; the hub
  tolerates an old daemon's fields and the missing counts have a stated
  rendering. A new daemon on an old hub fails `edit`, `write`, and `bash`;
  the runbook orders the hub first. During skew an old daemon bounds by JSON
  and sends no counts, which is the transitional reading of `remote-machines`
  "Native file tools behave identically".
- [The `tool-calling` cap and replay requirements still spell `thumbnail`]
  → the key is `display.thumbnail`, the stored top-level form is removed on
  every path, and the proposal records the reading; a later STE pass over
  those blocks can rename it.

## Migration Plan

Pre-launch: no data migration. Stored parts written before the change keep
their shape; renderers and UI rows tolerate both. Rollback is a code revert;
parts written with `display` render under the old serializer as JSON with a
`display` object, which the model would see once — acceptable for a revert.

## Open Questions

None that change the specs or the layering. Whether the `bash` header should
also carry the command's `cwd` can be decided after the first torture run.

## Revision history

- **v3 (2026-10-30):** Review round 2 (2 reviewers, 0 P0, 10 P1, 22 P2).
  Rendering input is the `ToolResult` object; replay rebuilds a failure;
  failures render as JSON; the function returns string plus kind so media
  references and SDK output types survive. Keys of JSON renderings are
  neutralized too. Truncation markers for bash, grep's capped passage, and a
  cut edit region; oversized-first-line header; open-ended resume selectors;
  `lineCount` by byte scan up to 32 MiB. Directory renders its stored content
  with no second header. Prompt-import body is the `read` rendering.
  `measureNativeModelOutput` kept until the last bound moves; `conversation-read`,
  Markdown bounds, apps `grep.ts`, `mcp-runtime` cap call, and the
  model-facing tool descriptions named in tasks. Hub-first skew rule. Five
  layers: read and mutation text split.

- **v2 (2026-10-30):** Review round 1 (2 reviewers, 10 P0, 23 P1, 14 P2).
  Input of the rendering function is the stored part, failures included.
  Global cap measures the rendering (D5 argument was backwards). One
  neutralization rule for text, JSON, and errors, in a package so bounds
  measure the escaped text. `lineCount`/`entryCount` stored; outline carries
  none. Continuation keyed on `truncated`, `nextOffset + 1`, per-form resume
  selectors. Legacy-part renderings and legacy thumbnail strip. `command_failed`
  message in the bash shape; wall time optional on the wire. Grep file line
  per run of passages; `[warnings: …]`. Skill catalog stays JSON.
  `truncationNotice` rendered. MODIFIED blocks rewritten in STE; image-read and
  `tool-calling` framing requirements added to the deltas. Measurement rows
  corrected (bound-limited read, absolute `matches`). Four layers.
- **v1 (2026-10-30):** Initial draft.

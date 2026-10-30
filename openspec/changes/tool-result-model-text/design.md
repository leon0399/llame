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

`renderToolResultForModel(toolName, part)` in `apps/api/src/tools/model-text.ts`
is the only function that turns a stored part into model content. Its input
is the stored part: `output` for a success, `errorText` plus
`errorRejectedUrl` for a failure. It strips `display` and a legacy top-level
`thumbnail`, selects a text renderer for `read`, `edit`, `write`, `grep`, and
`bash` successes by tool name (Machine variants share the names), renders
every other success as JSON and every failure as the neutralized error text,
and returns `{ type: 'text' }` for a text rendering and `{ type: 'json' }`
otherwise, so the live and Continue outputs of JSON tools keep their SDK
type. The `read`, `edit`, and `write` renderers live in
`packages/native-file-tools/src/model-text.ts` (replacing
`serialization.ts`), `grep`'s in `packages/native-file-tools/src/grep/`, and
`bash`'s in `packages/bash-executor`, because the package bounding code and
the Machine daemon measure them. Four call sites use the function:
`createModelToolDefinition` (every tool gets a `toModelOutput`),
`settleBoundTool` (stops neutralizing; the hook receives the stored object),
`tool-observation-part.ts`, and `continue-projection.ts`.

`measureNativeModelOutput` survives only as the JSON measure of context items
that are not tool results (`skills/skill-activation.ts`, the prompt-import
body in `run-execution.service.ts:2938`), renamed `measureJson` in
`runtime-safety`. The `reserveCodeUnits` the scheme resolvers pass
(`native-files.ts:272,373,450`, `web-read/result.ts:81,198`) becomes the
width of the attribution lines their envelope renders.

Rejected: rendering at the tool (returning text from the executor). The
stored part would then be text, the UI would lose its structured rows, and
history would carry two shapes.

### D2: `display` is a reserved key of every result object

Any result may carry `display: Record<string, unknown>`. The rendering
function deletes it; `truncateOversizedResult` sets it aside and re-attaches
it unchanged, as it does for `thumbnail` today. `thumbnail` becomes
`display.thumbnail` at its producer (`tool-media-store.ts`) and consumer
(`prompt-imports-item.ts`). A part stored before the change keeps its
top-level `thumbnail`; the rendering function removes that too, so the
canonical "a thumbnail never reaches the model" holds for old and new parts.
`edit` stores `display: { startLine, oldText, newText }`; `bash` stores
`wallTimeMs` as an ordinary field (the model sees it in the header) and
nothing under `display`. A client cannot persist a tool part at all
(`context-item.ts:222-237`), which is the boundary the negative test pins.

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
       [<k> more lines. ]Use <locator>:<nextOffset+1>-<end> to continue]
       [<truncationNotice>]

       multi-range: <locator>:<a>-<b>,<c>-<d>[ of <lineCount> lines]
                    continue with the remaining members: :<n+1>-<b>,<c>-<d>
       directory:   <locator> (directory, entries <a>-<b>[ of <entryCount>])
                    continue: :<nextOffset+1>
       outline:     <locator>:outline:<a>-<b>
                    continue: :outline:<n+1>-<end>
       raw:         <locator>:raw:<a>-<b>[ of <lineCount> lines]
       empty:       <locator>: empty

edit   edited <locator>: line <startLine>, <old> -> <new> lines[ (<lineCount> lines total)]
       <attribution lines>
       <N: text …>   changed lines plus two live lines each side
       stored without display: edited <locator>: line <shownRange.startLine>

write  created <locator>[ (<lineCount> lines)]
       replaced <locator>[ (<lineCount> lines)]
       <attribution lines>

grep   <notice line, when present>
       ## <file locator>          one per run of consecutive passages of a file
       *<N>: <matched line>
       <N>: <context line>
                                  (blank line between passages of one run)
       [warnings: <count> <kind>, …]
       [more results. Continue with cursor: <cursor>]

bash   exit <code>[, <seconds> s]
       <stdout>
       [stderr]
       <stderr>
       (no output)                             when both streams are empty
       [<truncationNotice>]
```

Attribution lines render one `<field>: <value>` per field the stored object
carries, in the order the spec lists; `adapter` joins `id`, `route`, `origin`
with spaces; `notes` renders one line per entry. The Knowledge and skill
notices stay verbatim: they are closed templates under `tool-calling`.

`<k>` is `lineCount - <end>` and appears only when `lineCount` is stored. The
`read` `lineCount` is the count of logical lines of the text the selector was
resolved against: a regular file (already loaded whole for a single-range
read; counted once in the streaming multi-range path), a web render, a `kb://`
or `skill://` file. An outline stores none (its scan can stop early). A
directory stores `entryCount`, the requested-level count the listing already
computes. The `edit` total is the post-edit count. `command_failed` and
`timed_out` messages are composed by `bash-result.ts` in the bash shape, so
the error text a model reads live and on replay is the same shape as a
success.

Rejected: Gemini's unnumbered context (loses the anchor a chained `edit` uses);
ripgrep's `N-` context separator (a second prefix grammar); printing `status`
or `path` as fields (both are in the header); a text form for the `skill://`
catalog (a list of packages, not content; it keeps JSON with image and PDF).

### D4: One neutralization rule, in a package

The reserved-name rule (rule 2 of `authored-text.ts`) moves to
`packages/runtime-safety/src/reserved-delimiters.ts` with the reserved set;
`authored-text.ts` imports it and keeps rule 1 for owner-authored prompt
values. The rendering function applies the rule to text renderings, to every
string value of a JSON rendering, and to error texts. `neutralizeToolResult`
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
global cap in `runner.ts` measures `renderToolResultForModel` for the result,
so a self-bounded text result at exactly 16,000 units passes unchanged while
an oversized JSON result is cut as before; the cap then shrinks the stored
object, as today, and the renderer shows the `truncationNotice` as a
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
daemon's `diff`/`content`, and drops the latter.

### D7: `bash` wall time

Every producer (managed watcher, SSH, Machine) records `wallTimeMs` from
spawn to settlement. Success carries it as a field; `command_failed` and
`timed_out` messages name the elapsed time in seconds with one decimal. The
Machine wire gains the field as optional; the hub maps `operation` and
`executor` away and renders `exit <code>` without a time when a daemon sends
none.

### D8: Measurement

A root dev dependency `gpt-tokenizer` and `scripts/measure-tool-results.mjs`
produce the proposal's table with `o200k_base`. Fixture:
`apps/web/app/(chat)/components/chat-message-row.tsx` at `64db12c9` (562
lines), copied to `scripts/fixtures/tool-results/`. The "today" column is a
committed JSON fixture of the results the old serializer produced at
`64db12c9`, captured once by the scratch script; the "after" column is the
live renderer over the same fixture file. Run:
`pnpm --filter @workspace/native-file-tools build && node scripts/measure-tool-results.mjs`.
The numbers in the proposal came from the scratch script at `64db12c9`; the
committed script reproduces them from the fixture.

### D9: Layering

Four layers. The first lands the rendering function on every path with
byte-identical JSON output, `display` with the thumbnail move and the legacy
strip, the one neutralization rule, and the cap on the rendering: a run then
exercises the new seam with every tool's text unchanged except for escaping.
The second adds the `read`/`edit`/`write` text, `lineCount`, the mutation
shapes, the Machine additive fields, and the UI edit row. The third adds
`grep` and `bash` and closes both issues. The fourth is finalize.

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
  rendering.
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

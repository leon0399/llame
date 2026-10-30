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
  (`run-execution.service.ts:1839`; `apps/api/src/chats/tool-observation-neutralizer.ts:16-24`,
  `&lt;`/`&gt;` through `sanitizeAuthoredText`) and reaches the model as the
  AI SDK's default JSON.
- Replay re-serializes the stored object: native names through
  `serializeNativeModelOutput`, others through `JSON.stringify`
  (`apps/api/src/chats/tool-observation-part.ts:225-267`), wrapped in
  `apps/api/src/chats/prompts/tool-output-untrusted.md` and passed through
  `sanitizeAuthoredText` (`:285-290`). The Continue projection has the same
  split (`apps/api/src/chats/continue-projection.ts:176-194`). So live and
  replayed text differ in neutralization path for non-native tools.
- The persisted part stores the tool's object verbatim
  (`apps/api/src/runs/assistant-transcript.ts:396`). `thumbnail` is
  special-cased by name in `serialization.ts:13-17`,
  `packages/runtime-safety/src/result-truncation.ts:173-179`, and
  `apps/api/src/prompt-imports/prompt-imports-item.ts:83-87`.
- `edit` and `write` results (`packages/native-file-tools/src/mutate.ts:38-50`,
  `:143-206`) carry `diff`, numbered `content` (one context line), `shownRange`,
  `truncated`; bounding shrinks `content` first, then binary-searches `diff`.
  The UI renders the diff from `input.oldText`/`newText`
  (`packages/ui/src/components/custom/edit.tsx:253-285`), reads the result
  only for the `@@ replacement at line N @@` header, and never shows `content`
  (`:286-297`).
- `grep` pages (`apps/api/src/tools/grep.ts:456-469`) carry
  `results[{locator, content, matches, truncated?}]`, `complete`, `warnings`,
  `notice?`, `cursor?`; the page budget is `measureNativeModelOutput` of the
  JSON (`packages/native-file-tools/src/grep/page.ts`,
  `grep/cursor.ts:86-113` reserves the cursor's JSON width).
- `bash` success is `{status, operation:'bash', executor:'managed', exitCode,
  stdout, stderr, truncated}` (`apps/api/src/tools/bash-result.ts:10-22`); no
  producer measures elapsed time (`packages/bash-executor/src/types.ts:24-33`,
  `apps/api/src/tools/ssh-bash.ts:104-127`,
  `apps/api/src/tools/machine-call.ts:349-371`).
- The sanitizer (`apps/api/src/instance-config/authored-text.ts:116-151`)
  applies two rules: a reserved tag name is escaped in any position (rule 2),
  and an unmatched or malformed closing tag is escaped (rule 1).
- The web UI hands the stored `output` to each row unchanged; every row parses
  it with its own zod schema and falls back to raw JSON when the shape does not
  match (`packages/ui/src/components/custom/tool-row.tsx:95-108`).
- No tokenizer is installed; every bound is UTF-16 code units
  (`packages/runtime-safety/src/result-truncation.ts:12`).

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
  persisted object is the input on every path.
- A persisted field the model must not see has one home, `display`.
- Content-bearing results are text a model can copy back into an `edit`
  argument without decoding.
- Bounds are measured on what the model receives.

**Non-Goals:**

- Changing what the UI renders for structured tools, or the UI's tolerance of
  historical shapes.
- A new package. The renderer lives beside the shapes it renders.
- A text rendering for `conversation_read`, image, PDF, or structured results.

## Decisions

### D1: One rendering entry point in `apps/api`, per-shape renderers beside their tools

`renderToolResultForModel(toolName, output)` in `apps/api/src/tools/model-text.ts`
is the only function that turns a persisted result into model content. It
strips `display`, selects a text renderer for `read`, `edit`, `write`, `grep`,
and `bash` by tool name (Machine variants share the names), and otherwise
renders JSON exactly as `neutralizeToolResult` does today. The text renderers
for `read`, `edit`, and `write` live in `packages/native-file-tools/src/model-text.ts`
(they replace `serializeNativeModelOutput` and are what the package's budget
code measures); `grep`'s lives in `packages/native-file-tools/src/grep/`;
`bash`'s beside `bash-result.ts`. Three call sites use the entry point:
`createModelToolDefinition` (every tool gets a `toModelOutput`),
`tool-observation-part.ts`, and `continue-projection.ts`.

Rejected: rendering at the tool (returning text from the executor). The
persisted part would then be text, the UI would lose its structured rows, and
history would carry two shapes.

### D2: `display` is a reserved key of every result object

Any result may carry `display: Record<string, unknown>`. The entry point
deletes it before rendering; `truncateOversizedResult` sets it aside and
re-attaches it unchanged, as it does for `thumbnail` today; the client-supplied
part check rejects it as it rejects `thumbnail`. `thumbnail` becomes
`display.thumbnail`; `prompt-imports-item.ts` reads it there. `edit` persists
`display: { startLine, oldText, newText }`; `bash` persists `wallTimeMs` as an
ordinary field (the model sees it in the header) and nothing under `display`.

Rejected: a per-tool strip list (a fourth special case per field) and a
sibling column on the part (a schema change for the same effect; the part
already holds one object).

### D3: Text shapes

Line grammar everywhere: `N: text`, and `*N: text` for a `grep` match. The
renderer never numbers a `raw` read. Shapes, with `<locator>` the caller's
locator as the persisted `path`:

```text
read   <locator>:<start>-<end> of <total> lines
       <attribution lines>
       <N: text …>
       [<k> more lines. Use <locator>:<nextOffset> to continue]

       multi-range header: <locator>:<a>-<b>,<c>-<d> of <total> lines
       directory header:   <locator> (directory, entries <a>-<b> of <n>)
       outline header:     <locator>:outline (<a>-<b> of <total> lines)
       raw header:         <locator>:raw:<a>-<b> of <total> lines

edit   edited <locator>: line <startLine>, <old> -> <new> lines (<total> lines total)
       <attribution lines>
       <N: text …>   changed lines plus two live lines each side

write  created <locator> (<total> lines)
       replaced <locator> (<total> lines)

grep   <notice line, when present>
       ## <file locator>
       *<N>: <matched line>
       <N>: <context line>
                                  (blank line between passages of one file)
       [skipped: <count> <kind>, …]            when warnings are non-empty
       [more results. Continue with cursor: <cursor>]

bash   exit <code>, <seconds> s
       <stdout>
       [stderr]
       <stderr>
       [output truncated at <bound> code units]
       (no output)                             when both streams are empty
```

Attribution lines render one `<field>: <value>` per field the persisted
object carries, in this order: `realPath`, `finalUrl`, `method`, `adapter`
(`id`, `route`, `origin` joined by spaces), `notes` (one line each),
`knowledgeSpaceName`, `knowledgeSpaceId`, `notice`, `locator`,
`sourceDirectory`, `resolvedPath`, `skillDirectory`, `realSkillDirectory`,
`skillPathInstruction`. The Knowledge and skill notices stay verbatim: they
are closed templates under `tool-calling`.

The `read` total is the line count the selector was resolved against (the
count `native-file-tools` already defines); for an outline it is the source's
count. The `edit` total is the post-edit count.

Rejected: Gemini's unnumbered context (loses the anchor a chained `edit` uses);
ripgrep's `N-` context separator (a second prefix grammar); printing `status`
or `path` as fields (both are in the header).

### D4: Neutralization of text payloads

The entry point passes rendered text through a reserved-name-only sanitizer
(rule 2 of `authored-text.ts`, exported separately): any tag-shaped token
naming a reserved delimiter is angle-escaped in any position or spelling;
everything else passes byte-for-byte. The replay wrapper then no longer runs
`sanitizeAuthoredText` over the composed result; the payload arrives
neutralized and the wrapper's own lines are static. JSON payloads keep
`neutralizeToolResult` (rule 1 and 2 over every string), as today.

See the proposal's deviation note for why rule 1 is excluded.

### D5: Bounds are measured on rendered text

`selectSourceLines`, `boundMutationResult`, and `appendGrepFile` measure the
renderer's output for the candidate result instead of its JSON. The grep
cursor reservation (`grepCursorFieldUnits`, the 64-zero placeholder hash)
becomes the width of the continuation line for the candidate cursor. The
replay budgets (8,000 per pair, 32,000 per turn) measure the rendered pair.
The global `RESULT_TRUNCATE_CHARS` guard in the runner keeps measuring the
persisted object: it is a last-resort guard for tools that do not self-bound,
and rendered text is never longer than the JSON it comes from for the
text-rendered tools.

### D6: `edit` persisted shape

```ts
{
  status: 'success', operation: 'edit', path, replacements: 1,
  content,            // changed lines plus two live lines each side, numbered
  shownRange, truncated,
  lineCount,          // post-edit total
  display: { startLine, oldText, newText },
}
```

`diff` is gone. The UI's `EditDiff` takes `display` when present and falls
back to `input.oldText`/`newText` plus the legacy `diff` header for parts
persisted before this change. `write` persists `{ status, operation, path,
created|replaced, lineCount }`; the UI already renders the submitted content
from the input.

### D7: `bash` wall time

Every producer (managed watcher, SSH, Machine) records `wallTimeMs` from
spawn to settlement. Success carries it as a field; `command_failed` and
`timed_out` messages name the elapsed time in seconds with one decimal. The
Machine wire gains the field; a Machine that omits it renders `? s`.

### D8: Measurement

A root dev dependency `gpt-tokenizer` and `scripts/measure-tool-results.mjs`
produce the proposal's table: fixture
`apps/web/app/(chat)/components/chat-message-row.tsx` at `64db12c9` (562
lines), real `readFile`/`editFile`/`createFile`/`grepFilePassages` calls from
the built package, `o200k_base`. Run: `node scripts/measure-tool-results.mjs`
after `pnpm --filter @workspace/native-file-tools build`. The numbers in the
proposal came from the same script run from a scratch directory before it
was committed; the committed script reproduces them.

### D9: Layering

Three layers. The first lands the entry point, `display`, `edit`/`write`
shapes, the `read` renderer, neutralization, and the UI edit row, so a run
exercises the new path end to end with every other tool unchanged. The second
adds `grep` and `bash` text and closes both issues. The third is finalize.

## Risks / Trade-offs

- [A model trained on JSON tool results treats a text header as prose] → the
  header is one line in a fixed form; the reference harnesses ship the same
  shape; the measurement script and a torture run on the first layer's draft
  are the check before ready.
- [A reserved tag inside source code is escaped and an `edit` with that line
  as `oldText` misses] → the tag set is six names that do not occur in
  ordinary code; the `read` description names the rule; the failure is the
  existing `stale/missing-target` error, not silent damage.
- [Rendered-text budgets differ from JSON budgets, so a page holds more
  lines] → the bounds are unchanged in code units; only the measured string
  changes; tests pin the bound on the rendered string.
- [Historical `edit` parts carry `diff` and no `display`] → the UI keeps the
  input-derived fallback; no history is rewritten.
- [`display` from a client] → rejected at the same boundary that rejects
  `thumbnail` today; negative test in the first layer.
- [Live and replay text no longer byte-match the pre-change wrapper
  scenario in `tool-calling` "Framing llame authors…"] → that scenario pins a
  template migration already shipped; its wrapper lines are unchanged and the
  payload contract is this change's.

## Migration Plan

Pre-launch: no data migration. Persisted parts written before the change keep
their shape; renderers and UI rows tolerate both. Rollback is a code revert;
parts written with `display` render under the old serializer as JSON with a
`display` object, which the model would see once — acceptable for a revert.

## Open Questions

None that change the specs or the layering. Whether the `bash` header should
also carry the command's `cwd` can be decided after the first torture run.

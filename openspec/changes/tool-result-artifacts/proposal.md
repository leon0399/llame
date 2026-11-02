## Why

A tool result that does not fit the model-facing bounds is cut and lost.

- **The result cap** of 16,000 units keeps the head of a result. For a `bash`
  log that drops the tail, where the failure summary usually is.
- **`bash` streams** stop at 32,000 units in the executor. A failed command
  keeps its whole output in its error message, because the cap never shortens
  an error.
- **`web_search`** discards every result past `limit`.
- **`grep`** keeps the rest of its walk behind a keyset cursor, so a second
  look repeats the walk.
- **Replay** clears the payload of a pair over 8,000 characters on the next
  user turn, so even the inline part disappears.

Issues: [#915](https://github.com/leon0399/llame/issues/915),
[#1519](https://github.com/leon0399/llame/issues/1519),
[#1525](https://github.com/leon0399/llame/issues/1525), and
[#1526](https://github.com/leon0399/llame/issues/1526).

This change stores the whole result once as a snapshot scoped to the Chat: an
artifact. The model reads it with ordinary selectors
(`read("artifact://grep-7:201-")`), or, on the llame host, with `bash` over a
host file. The research behind it is the objective-rerank study
([#1524](https://github.com/leon0399/llame/pull/1524)). This change ships its
artifact half, in walk order and engine order, with no ranking.

## What Changes

- **New capability `tool-artifacts`.** A tool result that does not fit is
  stored whole in Postgres, scoped to its Chat. Each artifact has the locator
  `artifact://<toolName>-<n>`, numbered from one counter per Chat. A `bash`
  artifact names its parts by stream: `artifact://bash-12/stdout`.
- **`read` accepts `artifact://`.**
  - Line selectors, `:raw`, and `:outline` work on Markdown parts.
  - `read("artifact://")` lists the Chat's artifacts, and
    `read("artifact://bash-12")` lists the streams of one artifact.
  - `edit` and `write` refuse the scheme.
  - A part that renders as JSON is stored with one member per line. Line
    numbers count a line over 8,000 units as several lines, so a long MCP
    text or a one-line JSON stdout is still readable by range.
- **Read-time authority.** Each artifact read re-checks the current `read`
  group on each `grep` or `web_search` finding that it serves. It uses the
  rule that admitted that finding. A refused finding renders as `[withheld]`
  lines, and line numbers stay the same.
- **Generic spill.** A result above the result cap keeps its bounded head
  inline. The full result goes to an artifact. **BREAKING:** the cap notice
  now names the artifact, its line count, and `<locator>:1-`. A result larger
  than `tools.artifacts.maxBytes` is not stored, and its notice says so.
- **`bash`.** The tool spills its streams itself, before the call is
  recorded, for a success, a `command_failed`, and a `timed_out` result.
  - Inline, each spilled stream shows its head, an omitted-range line, and
    its tail.
  - The run event holds the inline result and the locator. A replayed call
    reuses the artifact.
  - **BREAKING:** on the llame host and over `ssh://`, each stream is captured
    up to the artifact bound instead of 32,000 units. A Machine keeps its
    protocol bound.
- **Each tool declares its spill shape.** The shapes are `head`, the default,
  and `tool`. `bash`, `grep`, and `web_search` declare `tool` and build their
  own inline part.
- **`grep`.** The walk continues until the scopes end, a configured bound,
  the artifact bound, or the call deadline.
  - The inline text holds the first files that fit, and the artifact holds
    every passage.
  - A remainder line names the next files with their artifact line ranges.
  - Pages continue internally, for the engine on the host and over `fs.grep`
    on a Machine.
  - **BREAKING:** the `cursor` input and output are removed, with no resume
    ([#1527](https://github.com/leon0399/llame/issues/1527)).
  - `unfinishedFile` and progress apply within one call.
- **`web_search`.**
  - A text shape for the model, in the style of the `grep` result
    ([#1525](https://github.com/leon0399/llame/issues/1525)).
  - Engines fetch `max(limit, webSearch.fetchLimit)` results, default 20,
    clamped per vendor.
  - `limit` results render inline. When anything is left out of the inline
    text, the artifact holds the whole output: results, answers, and
    citations ([#1526](https://github.com/leon0399/llame/issues/1526)).
  - **BREAKING** for the model-facing rendering. The stored part holds the
    inline output, so the web UI renderer shows what the model saw.
- **Host files.** When `bash` is allowlisted, artifact parts are also files
  under `$TMPDIR/llame/chats/<chatId>/artifacts/` on the llame host.
  - Files are written at creation. They are restored from Postgres at attempt
    start and before each `bash` call, by size and modification time.
  - The notice names the directory. In a Machine Workspace, or for `ssh://`
    `bash`, it says that the files are on the llame host only.
  - A worker removes a Chat directory that no attempt reconciled for 7 days.
- **Replay keeps the locator.** A replayed tool pair keeps
  `Artifact: artifact://<id>` when its payload is cleared.
- **Forks copy the artifacts that their copied parts cite**, with the same
  locators. Prompt imports do not accept `artifact://`.
- **Configuration.** `tools.artifacts.maxBytes` bounds each part: default
  8 MiB, minimum 128 KiB, so a Machine stream of 32,000 units always fits. `webSearch.fetchLimit` sets the wider web fetch:
  default 20, range 1-100.

## Assumptions, confirmed with Leo

The design grilling of 2026-11-02 settled these. Codes come from the decision
record, summarized in design.md.

- **Q1, Q4.** The bytes live in Postgres, in tables scoped to the Chat, with a
  `chat_id` foreign key `ON DELETE CASCADE` and forced RLS. The tool part
  stores only the inline result and the locator.
- **Q2, Q6, Q8, Q9.**
  - Artifacts are also host files, with no isolation between owners. Every
    known deployment has a single user.
  - Files are written eagerly and restored at attempt start and before each
    `bash` call, only when `bash` is allowlisted.
  - The directory is `$TMPDIR/llame/chats/<chatId>/artifacts/`. The command
    text is not rewritten, and the real path is announced.
- **Q3, Q11.** `read` on `artifact://` re-checks each finding and shows
  `[withheld]`. Files hold the content as admitted. A later format change
  keeps no backward compatibility.
- **Q5.** Generic spill is in scope.
- **Q7.** An artifact lives as long as its Chat.
- **Q10.** No files on a Machine. `read("artifact://…")` works in every
  Workspace ([#1528](https://github.com/leon0399/llame/issues/1528),
  [#1363](https://github.com/leon0399/llame/issues/1363)).
- **Q12, Q16, Q19.** `artifact://<toolName>-<n>` with one counter per Chat.
  `bash` parts are nested (`bash-12/stdout`). The file type follows the
  content.
- **Q13.** One byte bound covers every producer.
- **Q14.** No continuation for a stopped `grep`
  ([#1527](https://github.com/leon0399/llame/issues/1527)).
- **Q15.** No `@artifact://` prompt imports
  ([#1011](https://github.com/leon0399/llame/issues/1011)).
- **Q17.** The `bash` stream bound rises to the artifact bound.
- **Q18.** Each tool's spill policy is data on the tool definition
  ([#1489](https://github.com/leon0399/llame/issues/1489)).
- **Q20.** An artifact exists only when the result does not fit.
- **Q21.** The locator stays in replay, and the Chat list exists.
- **Q22.** No `artifact://` scope for `grep`
  ([#1529](https://github.com/leon0399/llame/issues/1529)).
- **Q23.** `webSearch.fetchLimit`, and the artifact holds the whole result.
- **Q24.** MCP base64 stays in the JSON artifact
  ([#1530](https://github.com/leon0399/llame/issues/1530)).
- **Q25.** One change in one stack.

Assumptions that follow from these but were never asked:

- **A1.** The counter is per Chat across tools (`grep-7`, then `bash-8`), not
  per tool.
- **A2.** `grep` keeps 20 passages per file in the artifact too. One noisy
  file cannot fill the result, and `read` of that file reaches the rest.
- **A3.** `grep`'s `limit` still bounds the files inline. The artifact holds
  every file up to the byte bound.
- **A4.** A `head` result keeps today's shape-preserving cut inline. Its
  artifact holds the full rendering, with JSON printed one member per line.
- **A5.** The `bash` inline preview gives about a quarter of its budget to the
  head and the rest to the tail.
- **A6.** The byte bound applies to each part. A `bash` artifact can hold two
  streams at the bound.

## Deviation from the grilling record

- **Host path in model context.** The `AGENTS.md` "Security" section says
  server-resolved host paths stay private, and the announced directory (Q6)
  is one.
  - The exception applies only when `bash` is allowlisted. That `bash` can
    already find the directory: `echo $TMPDIR` prints it, and the files are
    ordinary host storage.
  - Without `bash`, no file exists and no path is shown.
  - Please confirm this exception.
- **Host files can outlive a deleted Chat by up to 7 days (Q7).** The rows go
  at once with the Chat. The files are a cache on each worker host, and a
  deletion on the API host cannot reach every worker. So each worker removes a
  Chat directory that no attempt reconciled for 7 days.
- **No artifact when the Run cannot read it.** A Run without `read` and
  without host files gets the inline result with a count of what it left out.
  This differs from Q20, where every result that does not fit has an
  artifact.
- **Line numbers are shared for passages and results only (D23).** The record
  says every producer shares line numbers with the inline part and gives a
  continuation selector. That holds for `grep` and `web_search` passages and
  results. A `head` spill keeps a compact inline cut and stores pretty JSON,
  so its notice gives `<locator>:1-`. `bash` parts hold raw streams.
- **A stream part exists only when that stream does not fit (D16).** The
  record says each non-empty stream gets a file. A short stderr beside a
  spilled stdout stays inline, with no part and no file.
- **Host files are compared by size and modification time (D8).** The record
  says hashes. A hash needs a read of every file before each `bash` call; size
  and time need none.
- **A result larger than the byte bound is not stored (Q13).** Producers that
  stream, `grep` and `bash`, stop at the bound. A whole result that arrives
  larger, such as an MCP response, cannot be cut into valid JSON, so the
  system does not store it.

## Capabilities

### New Capabilities

- `tool-artifacts`: snapshots of whole tool results, scoped to the Chat, with
  `artifact://` locators, reads and lists, read-time authority, spill shapes,
  the `bash` stream spill, host files and their restore, replay, and lifetime.

### Modified Capabilities

- **`grep-tool`.**
  - REMOVED:
    - "Results are ordered, bounded, and paged by a keyset cursor"
    - "Walks are bounded"
    - "A stop in a file that blocks progress skips that file"
    - "A stop after progress opens the file again"
  - MODIFIED:
    - "The grep tool accepts one strict input object"
    - "The grep deadline derives from the tool call timeout"
    - "Operator bounds limit a grep walk only when configured"
    - "Byte bounds count the bytes that the walk takes"
    - "Reads run concurrently and keep canonical order"
    - "Excluded directories are reported"
    - "Scope backends fail closed per scheme"
    - "A file is searched as a stream"
    - "The excluded-directory report is filtered and bounded"
  - ADDED: skips, the stop rule, order, ordinals, 20 passages per file, the
    inline head, the remainder line, the stop before progress, and the
    skipped Machine file.
  - The canonical scenarios of the removed "Walks are bounded" move to its
    ADDED replacements.
- **`tool-result-rendering`.**
  - REMOVED: "A grep passage cut at the page bound names the cursor".
  - MODIFIED:
    - "Results that carry content render as text", which adds `web_search`
    - "A grep page groups consecutive passages under one file line"
    - "Continuation is one bracketed notice line"
    - "A cap notice ends the text"
    - "A bash result renders a status header and its streams"
  - ADDED: the `web_search` results, answers, and structure guard; the
    artifact notice; the cut marker that names the artifact; the remainder
    line; and the line-break rule for the new lines.
- **`tool-calling`.** ADDED: a replayed pair keeps its artifact locator.
- **`bash-execution`.** MODIFIED: "Command results are bounded and explicit".
- **`web-search`.**
  - MODIFIED:
    - "The web search tool has one stable model-facing contract"
    - "Engines clamp the result count to their vendor maximum"
    - "Aggregate engines fan out and merge by rank fusion"
    - "Output fields are bounded within the result cap"
    - "The serialized output fits the result cap"
    - "Stored output is the normalized result only"
    - "API and keyless engines speak their vendor wire"
    - "DeepSeek engines call the DeepSeek search API"
    - "Parallel engines call the Parallel search API"
    - "Yandex engines call the Yandex web search API"
    - "Removed entries can empty an engine outcome"
    - "Attached answers fit the result cap after results"
  - ADDED: output past the inline part goes to an artifact.
- **`prompt-imports`.** MODIFIED: "Prompt imports cover every native read
  scheme", which excludes `artifact://`.
- **`owner-chat-forks`.** ADDED: a fork copies the artifacts that its copied
  parts name.
- **`tool-call-permissions`.**
  - MODIFIED: "Grep scopes are admitted per scope and files per hit", which
    drops `cursor` from the all-fields traversal.
  - ADDED: `artifact://` locators match as their logical text, and the sixth
    named exception covers each served finding.
- **`instance-config`.**
  - MODIFIED: "Operator configuration declares web search engines and a
    chain", which adds `fetchLimit`.
  - ADDED: `tools.artifacts.maxBytes` and `webSearch.fetchLimit`.

Deliberately unchanged:

- **`tool-calling` "Tool failure is an observation, not a crash".** "Error
  results are never truncated" still holds: the cap leaves errors alone, and
  `bash` bounds its own error message before it returns. The cap marker still
  states "that narrowing the call's arguments recovers the omitted content".
  The spilled notice adds the artifact to that statement.
- **`tool-calling` "Tool observations survive into later turns as stored UI
  parts".**
  - It clears "payloads, oldest first" and keeps "identity and outcome before
    payload". The `Artifact:` line is part of the kept identity, not the
    payload.
  - The rule of "no compacted tool record to read back" holds. An artifact is
    a Chat resource reached through `read` or a host file, never through
    replay or a checkpoint, as `tool-artifacts` states.
  - The 8,000 and 32,000 budgets are unchanged.
- **`tool-calling` "Durable, replayable tool activity".** Tool parts still
  persist and stream as before. The part gains an `artifact` field that names
  the locator. The artifact itself is a separate row.
- **`tool-result-rendering` "The global result cap measures the rendering".**
  The cap and its measurement stay. Only the notice text and the spill change.
- **`tool-call-permissions` "File permission matching uses logical resource
  locators".** Its Knowledge, host, file-alias, and media rules stay.
  `artifact://` gets its own ADDED requirement.
- **`native-file-tools`.** The `read` rules for the scheme live in
  `tool-artifacts`, as the `media://` rules live in their own requirements.
  "Locator-scheme routing SHALL happen before local path resolution" covers
  the new scheme.

## Impact

- **Database.** New `tool_artifacts` and `tool_artifact_parts` tables, scoped
  to the Chat, with forced RLS. A counter column `chats.artifact_seq`.
  Drizzle migrations.
- **API and tools.**
  - The `artifact` reader (`apps/api/src/tools/native-files.ts`).
  - Generic spill at the cap sites: `runner.ts` and `mcp-runtime.service.ts`.
  - The spill field on tool definitions.
  - The `artifact` field from the runner to the stored part:
    `run-execution.service.ts`, `assistant-transcript.ts`,
    `tool-observation-part.ts`, and `continue-projection.ts`.
  - The `bash` spill before `native.result`: `bash.ts`, `ssh-bash.ts`,
    `bash-result.ts`, `machine-call.ts`, `packages/bash-executor`, the
    `ToolResult` error variant in `packages/runtime-safety`, and
    `priorOutcome` in `native-files-repository.ts`.
  - The `grep` layout and internal paging: `apps/api/src/tools/grep*.ts`. The
    engine cursor stays for `fs.grep`.
  - The `web_search` text shape and fetch size: `web-search/*`.
  - Fork copy: `chats.service.ts` `copyOwnedChat` and `chats/fork-copy.ts`.
  - The prompt-import opt-out.
- **Machine protocol.** No wire change. `fs.grep` keeps its page budget,
  which stays under one protocol message, and its internal cursor. A Machine
  `bash` keeps `BASH_BOUNDS.outputBound`.
- **Docs.**
  - `docs/product/reference/tools/`: `grep.md`, `web-search.md`, `bash.md`,
    `read.md`, and a new `artifacts.md`.
  - The operator runbooks `native-files.md` and `web-search.md`. With field
    allows for `read`, an `^artifact://` allow is needed.
  - The model-facing prompts in `apps/api/src/prompts/tools/`.
  - `CHANGELOG.md`.

## Non-Goals

- **No ranking by `objective`**
  ([#1521](https://github.com/leon0399/llame/issues/1521)).
- **No further `grep` or `bash` features:**
  - no `grep` resume ([#1527](https://github.com/leon0399/llame/issues/1527));
  - no `artifact://` scope for `grep`
    ([#1529](https://github.com/leon0399/llame/issues/1529));
  - no `bash` stdin ([#1531](https://github.com/leon0399/llame/issues/1531)).
- **Machines and media:**
  - no files on Machines and no larger Machine `bash` bound
    ([#1528](https://github.com/leon0399/llame/issues/1528));
  - no MCP image files
    ([#1530](https://github.com/leon0399/llame/issues/1530)).
- **No isolation between owners** for host files.
- **No expiry or quota** for artifact rows.
- **No change to `knowledge_search` or `search_conversations`**
  ([#1522](https://github.com/leon0399/llame/issues/1522),
  [#1523](https://github.com/leon0399/llame/issues/1523)).

## Acceptance

- A `bash` build that exits 1 and prints 3 MB keeps every line in
  `artifact://bash-<n>/stderr`. The error message shows the head and the
  tail. `read("artifact://bash-<n>/stderr:<a>-<b>")` returns the omitted
  lines.
- A broad `grep` returns its first files inline, every passage up to 8 MiB in
  `artifact://grep-<n>`, and no `cursor`. The same selectors work after a
  host restart.
- `web_search` renders as text. With 20 results fetched and `limit: 10`, ten
  render inline, and `artifact://web_search-<n>` holds all 20.
- After a new `read` reject, `read("artifact://grep-<n>")` shows `[withheld]`
  lines for the refused file. The line numbers do not change.
- Deleting the Chat deletes its artifact rows. A fork resolves the locators
  in its copied parts. Another Chat or owner gets `not_found`.
- On the next turn, a cleared pair still carries `Artifact: artifact://<id>`.

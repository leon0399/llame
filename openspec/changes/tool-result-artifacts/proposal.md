## Why

A tool result that does not fit the model-facing bounds is cut and lost. The 16,000-unit result cap keeps the head of a `bash` log and drops its tail, where the failure summary usually is. `bash` streams stop at 32,000 units in the executor. `web_search` discards every result past `limit`. `grep` keeps the rest of its walk behind a keyset cursor, so a second look repeats the walk. On the next user turn, a pair over 8,000 characters loses its payload in replay, so even the inline part disappears ([#915](https://github.com/leon0399/llame/issues/915), [#1519](https://github.com/leon0399/llame/issues/1519), [#1525](https://github.com/leon0399/llame/issues/1525), [#1526](https://github.com/leon0399/llame/issues/1526)).

This change stores the whole result once as a Chat-scoped snapshot, an artifact. The model reads it with ordinary selectors (`read("artifact://grep-7:201-")`) or, on the llame host, with `bash` over a materialized file. The research behind it is the objective-rerank study ([#1524](https://github.com/leon0399/llame/pull/1524)); this change ships its artifact half, in walk and engine order, with no ranking.

## What Changes

- **New capability `tool-artifacts`.** A tool result that does not fit is stored whole in Postgres, scoped to its Chat. Each artifact has the locator `artifact://<toolName>-<n>`, numbered from one counter per Chat. A result with several parts, such as the two `bash` streams, adds one path segment: `artifact://bash-12/stdout`.
- **`read` accepts `artifact://`.** Line selectors, `:raw`, and the Markdown and JSON handling select by the file type of each part (`.md`, `.json`, `.txt`). `read("artifact://")` lists the Chat's artifacts, and `read("artifact://bash-12")` lists the parts of one artifact. `edit` and `write` refuse the scheme.
- **Read-time authority.** Each artifact read checks the current `read` group against the source locator of each finding that it shows. A refused finding renders as `[withheld]` lines, and the line numbers stay the same.
- **Generic spill.** When a result goes above the result cap, the tool still returns its bounded rendering. The full result goes to an artifact, and the cap notice names the artifact and the selector that continues it. **BREAKING** for the model-facing cap notice text.
- **`bash`.** Each stream is captured up to the artifact bound, not 32,000 units. A stream that does not fit inline is stored as its own part, and the inline text shows its head, its tail, and the omitted line range. **BREAKING**: the executor stream bound changes.
- **Each tool declares its spill shape.** `bash` shows head and tail, `grep` shows head plus a remainder map, `web_search` splits by result count, and a tool that declares nothing shows its head.
- **`grep`.** The walk continues until it ends, reaches the artifact bound, or reaches the call deadline. The inline text holds the first files that fit, and the artifact holds every passage. A remainder line names the files after the inline part with their artifact line ranges. **BREAKING**: the `cursor` input and output are removed, with no resume ([#1527](https://github.com/leon0399/llame/issues/1527) tracks resume). The `unfinishedFile` and progress rules apply within one call only.
- **`web_search`.** A text shape for the model, in the style of the `grep` page ([#1525](https://github.com/leon0399/llame/issues/1525)). Engines fetch `webSearch.fetchLimit` results (default 20, capped by the vendor maximum), and `limit` results render inline. When more results came back, the artifact holds all of them ([#1526](https://github.com/leon0399/llame/issues/1526)). **BREAKING** for the model-facing rendering; stored parts and the web UI renderer keep the normalized output.
- **Materialized files.** When `bash` is allowlisted, artifacts are written to `$TMPDIR/llame/chats/<chatId>/artifacts/` on the llame host. They are written at creation and restored from Postgres at attempt start and before each `bash` call. The inline notice names the host path. In a Machine Workspace, the notice says that the file is on the llame host only.
- **Replay keeps the locator.** A replayed tool pair keeps `Artifact: artifact://<id>` when the replay clears its payload.
- **Forks copy the artifacts that their copied parts cite**, with the same identifiers. Prompt imports do not accept `artifact://`.
- **Configuration.** `tools.artifacts.maxBytes` (default 8 MiB) bounds each artifact. `webSearch.fetchLimit` (default 20) sets the wider web fetch.

## Assumptions, confirmed with Leo

The design grilling of 2026-11-02 settled these (codes from the decision record, summarized in design.md):

- **Q1, Q4.** The bytes are in Postgres, in a separate table scoped to the Chat, with a `chat_id` foreign key `ON DELETE CASCADE` and forced RLS. The tool part stores only the locator.
- **Q2, Q6, Q8, Q9.** The artifacts are also materialized as files on the host, with no isolation between owners. Every known deployment has a single user. Files are written eagerly and restored at attempt start and before each `bash` call, only when `bash` is allowlisted. The directory is `$TMPDIR/llame/chats/<chatId>/artifacts/`. The command text is not rewritten, and the real path is announced.
- **Q3, Q11.** `read` and `grep` on `artifact://` check each finding again and show `[withheld]`. The files hold the content as admitted. When the format changes later, it changes with no backward compatibility.
- **Q5.** Generic spill is in scope.
- **Q7.** An artifact lives as long as its Chat.
- **Q10.** In a Machine Workspace there are no files on the Machine. `read("artifact://…")` works in every Workspace ([#1528](https://github.com/leon0399/llame/issues/1528), [#1363](https://github.com/leon0399/llame/issues/1363)).
- **Q12, Q16, Q19.** The locator is `artifact://<toolName>-<n>`, with one counter per Chat. A result with several parts is nested (`bash-12/stdout`). The file type follows the content.
- **Q13.** One byte bound covers every producer.
- **Q14.** No continuation for a stopped `grep` ([#1527](https://github.com/leon0399/llame/issues/1527)).
- **Q15.** No `@artifact://` prompt imports ([#1011](https://github.com/leon0399/llame/issues/1011)).
- **Q17.** The `bash` stream bound rises to the artifact bound.
- **Q18.** Each tool's spill policy is data on the tool definition ([#1489](https://github.com/leon0399/llame/issues/1489)).
- **Q20.** An artifact exists only when the result does not fit.
- **Q21.** The locator stays in replay, and the Chat listing exists.
- **Q22.** No `artifact://` scope for `grep` ([#1529](https://github.com/leon0399/llame/issues/1529)).
- **Q23.** `webSearch.fetchLimit`, and the artifact holds the whole result.
- **Q24.** MCP base64 stays in the JSON artifact ([#1530](https://github.com/leon0399/llame/issues/1530)).
- **Q25.** One change in one stack.

Assumptions that follow from these but were never asked:

- **A1.** The counter is per Chat across tools (`grep-7`, then `bash-8`), not per tool.
- **A2.** `grep` keeps 20 passages per file in the artifact too. One noisy file cannot fill the result, and `read` of that file reaches the rest.
- **A3.** `grep`'s `limit` still bounds the files inline. The artifact holds every file up to the byte bound.
- **A4.** For a JSON-rendered tool, generic spill keeps today's shape-preserving cut inline and stores the full JSON.
- **A5.** The `bash` inline preview gives about a quarter of its budget to the head and the rest to the tail.

## Deviation from the grilling record

- **Host path in model context.** `AGENTS.md` ("Security") says to keep server-resolved host paths private. The materialized path (Q6) is server-resolved. The deviation applies only when `bash` is allowlisted. That `bash` can already discover the path, because `echo $TMPDIR` prints it and the directory is ordinary host storage. So the announcement discloses nothing that the model cannot already reach. Without `bash`, no file exists and no path is shown. Please confirm this exception.

## Capabilities

### New Capabilities

- `tool-artifacts`: Chat-scoped snapshots of whole tool results, `artifact://` locators, reads and listings, read-time authority, spill, materialized host files, replay, forks, and lifetime.

### Modified Capabilities

- `grep-tool`:
  - REMOVED: "Results are ordered, bounded, and paged by a keyset cursor", "A stop in a file that blocks progress skips that file", and "A stop after progress opens the file again".
  - MODIFIED: "The grep tool accepts one strict input object", "Walks are bounded", "The grep deadline derives from the tool call timeout", "Operator bounds limit a grep walk only when configured", "Byte bounds count the bytes that the walk takes", "Reads run concurrently and keep canonical order", "Scope backends fail closed per scheme", and "Excluded directories are reported".
  - ADDED: ordering, the inline part and the artifact, the remainder line, and the stop inside a file.
- `tool-result-rendering`:
  - REMOVED: "A grep passage cut at the page bound names the cursor".
  - MODIFIED: "Results that carry content render as text" (adds `web_search`), "A grep page groups consecutive passages under one file line", "Continuation is one bracketed notice line", "A cap notice ends the text", and "A bash result renders a status header and its streams".
  - ADDED: the `web_search` text shape and the artifact notice line.
- `tool-calling`: ADDED: a replayed pair keeps its artifact locator.
- `bash-execution`: MODIFIED: "Command results are bounded and explicit" (the stream bound becomes the artifact bound).
- `web-search`:
  - MODIFIED: "The serialized output fits the result cap", "Engines clamp the result count to their vendor maximum", "Aggregate engines fan out and merge by rank fusion", and "Output fields are bounded within the result cap".
  - ADDED: fetch size and the offload.
- `prompt-imports`: MODIFIED: "Prompt imports cover every native read scheme" (excludes `artifact://`).
- `owner-chat-forks`: ADDED: a fork copies the cited artifacts.
- `tool-call-permissions`: ADDED: `artifact://` locators match as their logical text.
- `instance-config`: ADDED: `tools.artifacts.maxBytes` and `webSearch.fetchLimit`.

Deliberately unchanged:

- **`tool-calling` "Tool observations survive into later turns as stored UI parts".** It clears "payloads, oldest first" and keeps "identity and outcome before payload". The artifact locator is part of the kept identity line, not the payload. The new requirement states this. The 8,000 and 32,000 budgets are unchanged.
- **`tool-calling` "Durable, replayable tool activity".** Tool parts still persist and stream unchanged. The artifact is a separate row, which the part references by locator.
- **`tool-result-rendering` "The global result cap measures the rendering".** The cap and its measurement stay. Only the notice text and the spill side effect change, in "A cap notice ends the text" and `tool-artifacts`.
- **`tool-call-permissions` "File permission matching uses logical resource locators".** Its Knowledge, host, file-alias, and media rules stay. `artifact://` gets its own ADDED requirement, as `media://` did in `native-file-tools`.
- **`native-file-tools`.** The `read` rules for the scheme live in `tool-artifacts`, as the `media://` rules live in their own requirements. "Locator-scheme routing SHALL happen before local path resolution" already covers a new scheme.

## Impact

- **Database.** A new `tool_artifacts` table and a `tool_artifact_parts` table, scoped to the Chat with forced RLS. A per-Chat counter column on `chats`. Drizzle migrations.
- **API, tools, and runtime.**
  - `apps/api/src/tools`: the artifact reader for `read`; spill in the cap path (`runner.ts`, `packages/runtime-safety/src/result-truncation.ts`); the spill policy on each tool definition; the `grep` layout and the removed cursor (`grep*.ts`, `packages/native-file-tools/src/grep/*`); and the `web_search` text shape and fetch size (`web-search/*`).
  - `bash` stream bounds (`bash-limits.ts`, `packages/bash-executor`); the replay locator (`chats/tool-observation-part.ts`); fork copy (`chats/messages-repository.ts`); and the prompt-import opt-out (`prompt-imports/prompt-imports.ts`).
- **Machine protocol.** `fs.grep` keeps its internal paging cursor between the API and the daemon. The model-facing cursor is removed. `bash` on a Machine keeps its stream bound until [#1528](https://github.com/leon0399/llame/issues/1528).
- **Docs.** `docs/product/reference/tools/{grep,web_search,bash,read}.md`, a new `docs/product/reference/tools/artifacts.md`, the operator runbooks for `native-files.md` and `web-search.md`, the model-facing prompts in `apps/api/src/prompts/tools/`, and `CHANGELOG.md`.

## Non-Goals

- No ranking by `objective` ([#1521](https://github.com/leon0399/llame/issues/1521)). The artifact keeps walk order and engine order.
- No `grep` resume ([#1527](https://github.com/leon0399/llame/issues/1527)), no `artifact://` scope ([#1529](https://github.com/leon0399/llame/issues/1529)), no `bash` stdin ([#1531](https://github.com/leon0399/llame/issues/1531)), no files on Machines ([#1528](https://github.com/leon0399/llame/issues/1528)), and no MCP image files ([#1530](https://github.com/leon0399/llame/issues/1530)).
- No isolation between owners for the materialized files.
- No expiry, quota, or sweep.
- No change to `knowledge_search` or `search_conversations`. Their redesign is deferred ([#1522](https://github.com/leon0399/llame/issues/1522), [#1523](https://github.com/leon0399/llame/issues/1523)).

## Acceptance

- A `bash` command that prints 3 MB keeps every line in `artifact://bash-<n>/stdout`. The inline text shows its head and its tail, and `read("artifact://bash-<n>/stdout:<a>-<b>")` returns the omitted lines.
- A broad `grep` returns its first files inline, every passage up to 8 MiB in `artifact://grep-<n>`, and no `cursor`. The same `read` selectors work after a host restart.
- `web_search` renders as text. With 20 results fetched and `limit: 10`, ten results render inline, and `artifact://web_search-<n>` holds all 20.
- After a new `read` reject rule, `read("artifact://grep-<n>")` shows `[withheld]` lines for the refused file. The line numbers do not change.
- Deleting the Chat deletes its artifacts. A fork resolves the locators in its copied parts. Another owner's Chat gets `not_found`.
- On the next turn, a cleared pair still carries `Artifact: artifact://<id>`.

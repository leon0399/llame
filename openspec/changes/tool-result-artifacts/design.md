## Context

See proposal.md for the motivation. The facts below are at `16095515`
(master after `grep-scan-throughput`).

- **Run topology.** A Run attempt runs in one worker process. A retry, a
  reclaim after worker death, or a deploy drain can run the next attempt on
  another replica or host. A deploy stops workers after a 30 s drain, and
  pg-boss retries their Runs from the beginning
  (`docs/product/operator/scaling.md:105-119`). Postgres is the only durable
  owner store.
- **Result cap.** `truncateOversizedResult` cuts a success result at
  `RESULT_TRUNCATE_CHARS = 16_000` and returns every error unchanged
  (`packages/runtime-safety/src/result-truncation.ts:12,203-212`).
  - The call sites are the tool runner (`apps/api/src/tools/runner.ts:462,472`)
    and MCP (`apps/api/src/mcp/mcp-runtime.service.ts:900`). MCP caps before
    it persists (`:600-605`).
  - A JSON-rendered result is compact, one-line JSON
    (`packages/native-file-tools/src/serialization.ts:15-18`).
- **`bash`.**
  - A non-zero exit and a timeout become error results whose `message` is the
    whole rendered stream text (`apps/api/src/tools/bash-result.ts:24-45`).
  - The host and `ssh://` context sets `outputBound: 32000`
    (`apps/api/src/tools/bash-limits.ts:12-24`), counted in string length
    (`packages/bash-executor/src/watch.ts:327-339`). `ssh://` sizes its
    buffers at three bytes per unit (`apps/api/src/tools/ssh-bash.ts:180-188`).
  - Host `bash` appends the uncapped result to `native.result` before the
    runner caps it (`apps/api/src/tools/bash.ts:247-257`). A retry replays
    that event (`apps/api/src/runs/native-files-repository.ts:153-156`).
  - A Machine applies `BASH_BOUNDS.outputBound: 32_000`
    (`packages/machine-protocol/src/constants.ts:31-36`). Only one managed
    `bash` runs per process.
- **Replay.** `TOOL_REPLAY_CALL_LIMIT = 8000` and `TOOL_REPLAY_TURN_LIMIT = 32_000`
  (`apps/api/src/chats/tool-observation-part.ts:40-41`). A cleared pair keeps
  the tool identity and the `Outcome:` line, and loses its input and payload
  (`:298-324`). A dropped pair leaves only the omission count (`:43-44`).
  `StoredToolPart` declares the fields that replay reads (`:94-117`).
- **Side fields of a tool part.** They reach the stored part only by explicit
  copy, as `retainedMedia` and `permission` do
  (`apps/api/src/runs/assistant-transcript.ts:372-381`).
- **Locators.** `read` dispatches by scheme through `LOCATOR_READERS`
  (`apps/api/src/tools/native-files.ts:137-166`).
  - Web reads apply selectors and outlines to rendered text in memory, through
    `selectSourceLines`, `selectMultiRangeLines`, and `outlineReader`
    (`apps/api/src/tools/web-read/result.ts:1-14`).
  - Prompt imports accept every scheme in `LOCATOR_READERS`
    (`apps/api/src/prompt-imports/prompt-imports.ts:256-264`).
  - The permission projection splits the read selector off a locator that has
    no branch of its own (`apps/api/src/tools/permissions/locator-projection.ts:36-64`).
- **`grep`.** The engine stops when a page fills, and the API builds a keyset
  cursor.
  - The daemon `fs.grep` handler uses the same engine page stop and cursor
    (`apps/machine/src/grep.ts:186-188,221-245`).
  - A daemon response must fit `MAX_MESSAGE_BYTES = 1 MiB`
    (`packages/machine-protocol/src/constants.ts:9`,
    `packages/machine-protocol/src/frame.ts:46-47`).
  - The wire `unfinished` names a file only before progress
    (`packages/machine-protocol/src/types.ts:318-328`).
- **`web_search`.**
  - It drops a URL only on a `read` reject clause
    (`apps/api/src/tools/web-search/removal.ts:18-55`).
  - `grep` keeps a file only on an allow (`apps/api/src/tools/grep-admission.ts:213-234`).
  - The aggregate slices to `request.limit`
    (`apps/api/src/tools/web-search/aggregate.ts:242`).
- **Storage precedents.**
  - Media bytes live in tables scoped to the owner that are never deleted
    (`apps/api/src/db/schema/media.ts:46-127`). That is the wrong lifecycle
    for a Chat resource.
  - `run_events` uses split SELECT and INSERT policies through the Chat owner
    (`apps/api/src/db/schema/chats.ts:476-491`).
- **Forks.** An owner fork copies messages in `copyOwnedChat`
  (`apps/api/src/chats/chats.service.ts:526`) and `apps/api/src/chats/fork-copy.ts`.
  A shared fork copies text parts only.
- **Host isolation.** `bash` runs as the worker OS user with no confinement,
  "not tenant isolation" (`openspec/specs/bash-execution/spec.md:9`). It gets
  `TMPDIR` from the worker environment (`packages/bash-executor/src/env.ts:1-46`).

The design session's fact files and decision record are summarized here and
are not committed.

## Goals / Non-Goals

**Goals:**

- One store, one locator grammar, and one reader for every tool that spills.
- Each tool decides how its inline part looks.
- A Run that moves to another worker sees the same artifacts.

**Non-Goals:**

- See proposal.md "Non-Goals".

## Prior art

| Product     | Store                                                 | Address                                         | Shell reaches it   | Lifetime                                 | Missing file                  |
| ----------- | ----------------------------------------------------- | ----------------------------------------------- | ------------------ | ---------------------------------------- | ----------------------------- |
| OMP         | session directory, `<n>.<tool>.log`                   | `artifact://<n>`, rewritten to a path in `bash` | yes                | session                                  | `ENOENT`                      |
| Claude Code | `~/.claude/projects/<p>/<s>/tool-results/` (MCP only) | path                                            | yes                | 30-day sweep                             | file-not-found                |
| Cursor      | project tree                                          | path                                            | yes (`tail`, `rg`) | none published                           | file-not-found                |
| Hermes      | `$HERMES_HOME/cache/spillover/<id>.txt`               | path                                            | yes                | session retention, reference-aware sweep | `expired: true`               |
| Codex CLI   | none (hooks only)                                     | none                                            | none               | none                                     | the model runs the call again |

Every peer is a local process for one user, and the operating system
permissions are their only protection. llame differs because Runs move
between workers and owners share one host. So Postgres is the authority, and
the files are a cache that can be restored (D1, D10).

## Decisions

### D1: Two tables scoped to the Chat and a counter (Q1, Q4, Q12)

- **`tool_artifacts`.** One row per tool call.
  - Columns: `id`, `chat_id` (foreign key to `chats`, `ON DELETE CASCADE`),
    `seq`, `tool_name`, `tool_call_id`, `run_id`, `complete`, and
    `created_at`. The Chat list shows `created_at`. The writer runs after the
    producer stops, so `complete` is known when the row is inserted, in the
    same transaction as its parts.
  - `run_id` is a plain column with no foreign key. A fork copies artifacts
    but no Runs, and a foreign key to `runs` would tie the fork's rows to the
    source Chat.
  - Unique on `(chat_id, seq)` and on `(chat_id, run_id, tool_call_id)`.
    Providers and scripted test models can reuse a tool call id across Runs,
    so the id alone is not a key. A conflict is a failed write, never a
    lookup of another call's artifact.
- **`tool_artifact_parts`.** One row per part. Columns: `artifact_id`
  (foreign key, cascade), `name` (the stream name for `bash`, otherwise
  empty), `content_type`, `content bytea`, `sha256`, `byte_size`,
  `line_count`, and `findings jsonb`.
- **`chats.artifact_seq integer not null default 0`.** The number comes from
  `UPDATE chats SET artifact_seq = artifact_seq + 1 … RETURNING`. That runs in
  its own short transaction before the part insert, so the Chat row lock is
  not held during an 8 MiB insert. A failed write leaves a gap in the
  numbers, which is accepted.
- **RLS.** Forced, with split SELECT and INSERT policies through
  `chats.owner_user_id`, as `run_events` has. No UPDATE policy exists, and
  DELETE happens only by cascade.
- **`bytea`.** It keeps the image parts of
  [#1530](https://github.com/leon0399/llame/issues/1530) possible with no
  schema change.

Rejected:

- **Inside `messages.parts`.** Every `select *` reads the bytes back.
- **Run the call again.** That loses the pinned bytes and costs money.
- **Rows owned by the owner, like media.** They outlive the Chat.

### D2: One reader for `artifact://` (Q12, Q16, Q19, Q21)

`artifact` joins `LOCATOR_READERS` and routes before local path resolution. It
needs no native executor.

- **Selection.** The reader loads the part and selects lines with the
  in-memory helpers of web reads, so `:N-M`, multi-range, `:raw`, and
  `:outline` on Markdown parts behave as on a file.
- **Lists.** A bare `artifact://` lists the Chat's artifacts. `artifact://bash-<n>`
  lists its streams. Both use the directory-list shape.
- **Content types.**
  - `grep` and `web_search` parts are `text/markdown`.
  - A `bash` stream is `application/json` when it parses as JSON, else
    `text/plain`.
  - A `head` spill of a JSON rendering is stored as `JSON.stringify(value, null, 2)`.
    A text rendering is stored as rendered.
- **Long lines.** `read` skips a line longer than its bound
  (`packages/native-file-tools/src/stream-read.ts:422-424`), and an MCP `text`
  item or a one-line JSON stdout stays one line. The reader therefore numbers
  artifact lines by 8,000-unit pieces: a longer source line counts as several
  lines. Notices, ranges, and the `bash` preview use the same count. Host files
  keep the raw lines, so a `sed -n` count can differ on long lines only.
- **Refusals.** `edit` and `write` refuse the scheme with `invalid_path`.

### D3: Spill shapes on the tool definition (Q18)

A tool definition gets an optional `spill` field, `'head'` (the default) or
`'tool'`.

- **`'tool'`.** The tool builds its inline part and its artifact itself, and
  returns the locator in its result. `bash`, `grep`, and `web_search` declare
  it, so each keeps its layout rules in its own module.
- **`'head'`.** The runner and the MCP cap path render the result, measure
  it, and write the full rendering. They then keep today's shape-preserving
  cut inline. The cap notice text names the artifact and keeps the canonical
  "narrow the call's arguments" statement.
- No code switches on a tool name. [#1489](https://github.com/leon0399/llame/issues/1489)
  later takes the field into its registration surface.

### D4: `bash` spills inside the native fence (Q16, Q17)

- **Bound.** The host and `ssh://` `outputBound` becomes
  `tools.artifacts.maxBytes`, counted in UTF-8 bytes. The `ssh://` buffer
  multiplier becomes 1, because the bound is now in bytes. A Machine keeps the
  protocol constant ([#1528](https://github.com/leon0399/llame/issues/1528)).
- **Byte bound only on the hub.** `packages/bash-executor` gains a byte bound
  option that the hub context uses. The Machine daemon shares the package and
  keeps its unit bound from the protocol constant.
- **Order of steps.** After the executor returns and before `toToolResult`,
  `bash` does these steps. The host and `ssh://` paths run them in `bash.ts`
  and `ssh-bash.ts`. The Machine path runs them before `machine-call.ts:277-281`
  appends `native.result` in `runMachineMutation`.
  1. measures each stream against its inline share;
  2. writes the artifact with a part for each stream that does not fit;
  3. builds the head, the omitted-range line, and the tail for those streams;
  4. renders the result, whose error message for `command_failed` and
     `timed_out` is now bounded;
  5. appends `native.result` with that inline result and the locator.

  A Run with a `native.attempt` is never retried; it ends as `outcome_unknown`
  (`apps/api/src/runs/run-execution.service.ts:1067-1104`). The only replay is
  `settleOpenToolCalls`, through `priorOutcome`, which rebuilds an error as
  status, type, and message only (`native-files-repository.ts:157-164`).
  `priorOutcome` therefore copies `artifact` too, and the error variant of
  `ToolResult` in `packages/runtime-safety` gains an optional `artifact`.

- **Preview.** The streams that spill share the inline budget equally. A
  quarter of each share is the head, the rest is the tail (A5).
- **Memory.** The peak per call is the two streams as JS strings, up to twice
  their bytes. Add one copy for redaction, the JSON parse for type detection,
  and the `Buffer` for the insert: about 4 × 2 × 8 MiB = 64 MiB at the
  default. One managed `bash` per process bounds it.

### D5: Read-time authority (Q3, Q11)

- **Findings.** At write time, `grep` and `web_search` record one finding for
  each file, result, or answer: its source locators, its rule (`allow_only`
  for `grep`, `reject_only` for `web_search`), and its artifact line range.
  The range includes the heading line. An answer lists its citation URLs, and
  any rejected one withholds the whole answer.
- **Trailing lines stay inline.** The `grep` artifact holds headings and
  passages only. The `[warnings]`, `[ignored]`, `[not searched to the end]`,
  remainder, and notice lines exist only in the inline text, so they never
  need a re-check.
- **Evaluation.** On a read, the reader evaluates the `read` group only for
  the findings that overlap the served lines, once for each locator. It
  withholds by the rule of each finding:
  - `allow_only` withholds unless the decision is an allow;
  - `reject_only` withholds only when a reject clause matched.
- **Rendering.** Each line in a withheld range renders as `[withheld]`. An
  outline runs after the withholding, so no withheld file is named.
- **Permission exception.** It extends the sixth named exception in
  `tool-call-permissions`: no decision record per finding, no audit count,
  and no evaluation in `bypass`.
- **Projection.** It treats `artifact://` as logical text through the
  generic selector split. The task adds tests, not a new branch.

### D6: The `artifact` field travels with the result

- **The field.** A spilled `ToolResult`, success or error, carries `artifact`
  inside the result object. Side data such as `retainedMedia` travels in a
  per-attempt Map keyed by tool call id; the locator does not need that,
  because it is small and belongs to the result.
- **The seams.** These change to carry it:
  - `runTool` and the `tool.completed` payload;
  - `toolActivityPart` and `assistant-transcript.ts`, which copy side fields;
  - `StoredToolPart` and `tool-observation-part.ts`;
  - `continue-projection.ts`;
  - the chat DTO, so the web UI can show the locator.
- **Failure.** A failed artifact write leaves the inline result with
  `[full result not stored]` and no field.
- **Above the bound.** A `head` rendering larger than
  `tools.artifacts.maxBytes` is not stored, because cutting JSON would make
  it invalid.

### D7: `grep` walks to the end (Q13, Q14, Q20, Q22)

- **Engine.** It keeps its page stop and its cursor, because the daemon uses
  them.
- **Host scopes.** The API runs the engine once for each scope, with no file
  limit and a page budget equal to the artifact bytes left, so read-ahead is
  not thrown away at a page boundary. It renders each passage into the
  artifact text as it arrives.
- **Machine scopes.** These page over `fs.grep`.
  - The API keeps today's `pageUnits` of 15,000 units for each response. The
    wire repeats `path`, line numbers, and `matches` for each passage, so no
    fixed unit-to-byte ratio is safe for a larger page; 15,000 units is the
    page size that ships today without frame failures. A broad Machine walk
    makes more round trips instead.
  - The API asks for the next response after the daemon position of the
    previous one, not after the last passage it kept. A page of refused
    passages still advances the walk, as `runDaemonPages` does today.
  - It loops on the daemon cursor in the same way.
  - The wire is unchanged, so no daemon release is needed.
- **Progress.** `progressed` and `unfinished` keep their meaning within one
  call.
  - A Machine response that names an unfinished file makes the next request
    start after it. The daemon's time budget is nine tenths of the time left,
    so this can happen.
  - A host stop before progress names the file in `unfinishedFile`.
- **Inline part and cursor.** The inline part is the head of the artifact
  text, at most `limit` files, under 15,000 units. The remainder line names
  the next ten files with their ranges. The model-facing `cursor` field is
  removed.
- **Time.** A no-match walk over this repository took 3.4 s at #1515. A broad
  walk can now use the whole deadline, 108 s by default. The artifact bound is
  the early stop. Q14 accepts that a result at the bound means the search is
  wrong.

### D8: Replay keeps `Artifact:` (Q21)

`tool-observation-part.ts` emits `Artifact: <locator>` with the outcome of the
pair. The line survives payload clearing, so it counts in the envelope that
cannot shrink. It adds about 30 units to each pair with an artifact.

### D9: `web_search` text and fetch size (Q23)

- **Text shape.** It is new in `tool-result-rendering`: `## <rank>. <title>`,
  then the URL and host lines, then snippet lines that begin with `>`. The
  `engine` and `query` line folds line breaks into spaces.
- **Fetch size.** Engines ask for `max(limit, webSearch.fetchLimit)`, clamped
  per vendor. The aggregate merges and cuts to that size.
- **Inline part.** The inline text holds up to `limit` results and fits
  15,000 units. When anything is left out, the artifact holds the whole
  output as text.
- **Stored part.** It holds the inline output and the locator, so the web chat
  renderer shows what the model saw.
- **Cost.** Most engines bill per request (`docs/product/operator/web-search.md`).
  Parallel adds $1 per 1,000 results past ten.

### D10: Host files are a cache that can be restored (Q2, Q6, Q8, Q9, Q10)

- **When.** Only when `bash` is in `tools.allowed` and the Run has a native
  executor.
- **Path and write.** The path is
  `$TMPDIR/llame/chats/<chatId>/artifacts/<tool>-<n>.<ext>`, or
  `bash-<n>/<stream>.<ext>`. A write goes to a temporary name, then a rename.
  It sets the modification time to `created_at`.
- **Reconcile.** At attempt start and before each `bash` call:
  1. read the metadata of the Chat's parts: name, size, and created time, with
     no content;
  2. list the directory;
  3. fetch and write only what is absent or has another size or time.
- **Sweep.** Reconcile touches the directory, which marks it as seen. At
  worker start (`RunsWorkerService.onApplicationBootstrap`) and attempt start,
  the worker removes Chat directories not seen for 7 days. A sweep that races
  a reconcile in another process can remove a fresh file; the next reconcile
  writes it again.
- **Notice.** It names the directory. For a Machine Workspace or `ssh://`
  `bash`, it says "on the llame host only".
- **Rejected: rewriting `artifact://` tokens in command text, as OMP does.**
  A loop such as `cat ".../tool-${i}.txt"` cannot be rewritten, and
  permission rules match the submitted text.

### D11: Forks copy what they cite (Q7)

`copyOwnedChat` copies the `tool_artifacts` rows, with their parts, that the
copied tool parts name in the same Chat. It copies with `INSERT … SELECT`, so
the bytes never pass through Node. It also copies `artifact_seq`. A
shared fork copies no tool part, so it copies no artifact.

### D12: Prompt imports opt out (Q15)

`prompt-imports.ts` skips the `artifact` scheme explicitly. In the plugin
model the opt-out belongs on the source ([#1011](https://github.com/leon0399/llame/issues/1011)).

### D13: Operator policy

With field allows for `read`, the documented hardening, an operator needs an
`^artifact://` allow, as for `^media://`. The `native-files.md` runbook and
its example allow list name it.

## Risks / Trade-offs

- [The database grows with every large result for the life of the Chat] ->
  8 MiB per part. A sweep or quota comes when measured growth calls for it.
- [A broad `grep` now takes its whole deadline] -> the artifact bound stops it
  at 8 MiB, and the remainder line shows the scale.
- [Any owner's `bash` can read another owner's files under `$TMPDIR`] -> this
  is accepted for single-user deployments (Q2). The proposal asks Leo to
  confirm the host-path exception.
- [A deleted Chat's files stay up to 7 days on a worker] -> stated as a
  deviation. The rows go at once.
- [A retried attempt leaves artifacts that no part cites] -> the list shows
  them. They go with the Chat.
- [Restore after a reboot reads every artifact of the Chat] -> once per host
  and Chat, and only with `bash`.
- [A `bash` call can hold about 64 MiB at the default bound] -> one managed
  `bash` per process. Operators can lower `tools.artifacts.maxBytes`.

## Migration Plan

- The schema change is additive: two tables and one column. Old tool parts
  have no `artifact` field and replay as today.
- Pre-launch rule: the `grep` cursor and the old cap notice text go with no
  compatibility path. A stored `grep` part with a `cursor` renders without its
  continuation line.
- Rollback: revert the layer. After a later layer merges, drop the tables and
  the column in a new migration.

## Open Questions

- The `bash` inline budget split (A5) can change in implementation without a
  spec change.

## Revision history

- **v4 (2026-11-02):** GitHub review round 1 (29 threads).
  - **Machine paging.** Today's 15,000-unit page; resume after the daemon
    position, so refused pages still advance.
  - **Spec fixes.** `bash` parts hold the redacted stream. The artifact keeps
    the lines that start the inline text. Pieces end on a code point, and a
    read returns pieces up to the read bound. Fork copies are limited to the
    source Chat. `Prompt targets resolve as native read locators` excludes
    `artifact://`. A `tool` result never carries a cap notice. Counts of one
    are singular. The bound floor is 128 KiB, so a Machine stream always fits.
  - **Tasks.** The `grep-cursorless` layer updates the `grep` prompt,
    reference, and changelog.
- **v3 (2026-11-02):** Review round 2 (two reviewers: 0 P0, 13 P1, 20 P2).
  - **`bash` without an artifact.** Head and tail apply whenever a stream does
    not fit; a left-out line covers results with no artifact.
  - **Long lines.** Numbered by 8,000-unit pieces; MCP and one-line JSON stay
    readable.
  - **Machine.** A skipped file is reported. The page size comes from a
    worst-case byte ratio. Machine `bash` spills on the hub.
  - **`bash` settle path.** `priorOutcome` and the error variant carry the
    locator. The key is `(chat_id, run_id, tool_call_id)`.
  - **Contracts.** Line identity covers passages and results only, and
    `<next>` is defined. The `web_search` artifact rule no longer contradicts
    itself. Answers are findings. `grep` trailing lines stay inline.
  - **Spec gaps.** `tool-call-permissions` "Grep scopes are admitted per scope
    and files per hit" drops `cursor`. Three more deviations are listed.
  - **Layers.** `store` and the `grep` walk are each split in two, and every
    task cites a scenario that its layer can produce.
- **v2 (2026-11-02):** Review round 1 (two reviewers: 5 P0, 28 P1, 25 P2).
  - **`bash` spill.** Moved inside the native fence, for failures too (P0).
  - **Machine paging.** Pages stay under one protocol message; the engine
    cursor stays for the daemon (P0).
  - **Grep spec gaps.** "A file is searched as a stream" and "The
    excluded-directory report is filtered and bounded" are now modified (P0).
  - **Cap marker.** Keeps its narrowing statement (P0).
  - **Contracts.** One spill model, `head` or `tool`, and one notice model. A
    `bash` locator always names its stream, and the byte bound is per part.
  - **JSON parts.** Printed one member per line.
  - **Findings.** Each keeps the admission rule of its producer. The sixth
    named exception covers it, with `bypass`.
  - **Progress.** It stays within one call.
  - **`web_search`.** Vendor, answer, and removal requirements now count by
    the fetch size.
  - **Host files.** Reconciled by size and time, swept after 7 days, and
    named for `ssh://` too.
  - **Smaller fixes.** No artifact without a reader; `run_id` with no foreign
    key; the counter in its own transaction; the `artifact` field seams; the
    layer split and estimates; and corrected citations.
- **v1 (2026-11-02):** Initial draft from the design grilling (Q1-Q25).

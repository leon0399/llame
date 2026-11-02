## Context

See proposal.md for the motivation. Facts below are at `16095515` (master
after `grep-scan-throughput`).

- **Run topology.** A Run attempt runs in one worker process. A retry, a
  reclaim after worker death, or a deploy drain can run the next attempt on
  another replica or host (`docs/product/operator/scaling.md:12-52`). Postgres
  is the only durable owner store. Process-local state cannot be canonical.
- **Result cap.** `truncateOversizedResult` cuts every tool result at
  `RESULT_TRUNCATE_CHARS = 16_000` (`packages/runtime-safety/src/result-truncation.ts:12,208`).
  The two call sites are the tool runner (`apps/api/src/tools/runner.ts:462,472`)
  and MCP (`apps/api/src/mcp/mcp-runtime.service.ts:900`). It keeps the head
  of each string and array.
- **`bash` bounds.** The host and `ssh://` executor context sets
  `outputBound: 32000` (`apps/api/src/tools/bash-limits.ts:12-24`), counted
  in string length (`packages/bash-executor/src/watch.ts:327-339`). A Machine
  applies `BASH_BOUNDS.outputBound: 32_000` from the shared protocol constant
  (`packages/machine-protocol/src/constants.ts:31-36`). Only one managed
  `bash` runs per process (`maxProcesses: 1`).
- **Replay.** `TOOL_REPLAY_CALL_LIMIT = 8000` and `TOOL_REPLAY_TURN_LIMIT = 32_000`
  (`apps/api/src/chats/tool-observation-part.ts:40-41`). A cleared pair keeps
  `toolCallId`, `toolName`, and its `Outcome:` line, and loses its input and
  payload (`:364-373`). A dropped pair leaves only the omission count
  (`:43-44`).
- **Locators.** `read` dispatches by scheme through `LOCATOR_READERS`
  (`apps/api/src/tools/native-files.ts:137-166`). Web reads already apply
  selectors and outlines to rendered text in memory, with no host path.
  They use the `@workspace/native-file-tools` helpers `selectSourceLines`,
  `selectMultiRangeLines`, and `outlineReader` (`apps/api/src/tools/web-read/result.ts:1-14`).
  Prompt imports accept every scheme in `LOCATOR_READERS`
  (`apps/api/src/prompt-imports/prompt-imports.ts:256-264`).
- **`grep`.** The engine stops when a page fills, and the API builds a keyset
  cursor (`openspec/specs/grep-tool/spec.md`). A Machine scope pages through
  `fs.grep` with an internal daemon cursor.
- **Storage precedents.**
  - Media bytes live in `media_objects` and `media_blobs`, scoped to the
    owner, immutable, and never deleted (`apps/api/src/db/schema/media.ts:31-135`).
    That lifecycle is wrong for artifacts scoped to a Chat.
  - Tool-read image bytes (`retainedMedia`) live inside `messages.parts`, and
    every `messages` read is `select *`. The media runbook states that
    Postgres reads those bytes back whole on history pages and forks
    (`docs/product/operator/media.md:389-393`).
- **Host isolation.** `bash` runs as the worker OS user with no confinement.
  The spec says this is "not tenant isolation"
  (`openspec/specs/bash-execution/spec.md:9`). `bash` gets `TMPDIR` and `HOME`
  from the worker environment (`packages/bash-executor/src/env.ts:1-46`). In a
  Machine Workspace, only the `bash` `cwd` is remapped to the box
  (`apps/api/src/tools/bash.ts:71-152`).

Fact files from the design session:

- `local://artifact-internals.md`, `local://artifact-round2.md`, and
  `local://artifact-round3.md` hold the internal facts.
- `local://artifact-prior-art.md` holds the prior art.
- `local://artifact-decisions.md` holds the decision record.

They are summarized here and are not committed.

## Goals / Non-Goals

**Goals:**

- One store, one locator grammar, and one reader for every tool that spills.
- Each tool decides how its inline part looks. The artifact always holds the
  whole result in the same text.
- A Run that moves to another worker sees the same artifacts.

**Non-Goals:**

- A sandbox for host files, artifacts on Machines, expiry, and ranking. See
  proposal.md "Non-Goals".

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

### D1: Two tables scoped to the Chat, with a counter on the Chat (Q1, Q4, Q12)

- `tool_artifacts`: one row per tool call. Columns: `id`, `chat_id` (foreign
  key to `chats`, `ON DELETE CASCADE`), `seq`, `tool_name`, `tool_call_id`,
  `run_id`, `created_turn_seq`, `complete`, `created_at`. Unique on
  `(chat_id, seq)`.
- `tool_artifact_parts`: one row per part. Columns: `artifact_id` (foreign
  key, cascade), `name` (an empty string for a result with one part),
  `content_type`, `content bytea`, `sha256`, `byte_size`, `line_count`, and
  `findings jsonb` (the source locator and line range of each finding, for
  D5).
- `chats.artifact_seq integer not null default 0`. Allocation is
  `UPDATE chats SET artifact_seq = artifact_seq + 1 … RETURNING`, in the write
  transaction. The update locks the Chat row. This keeps numbers unique when
  read-only calls in one step run concurrently.
- RLS: forced, with SELECT and INSERT policies joined through
  `chats.owner_user_id`, as the `messages` policies do. No UPDATE policy
  exists. DELETE happens only by cascade.
- `bytea` instead of `text` keeps the image files of
  [#1530](https://github.com/leon0399/llame/issues/1530) possible with no
  schema change.

Rejected alternatives:

- **Inside `messages.parts`.** Every `select *` would read the bytes back, on
  each turn, history page, reindex, and fork.
- **Run the call again.** That loses the pinned bytes, and a second
  `web_search` costs money.
- **Rows owned by the owner, like media.** They outlive the Chat.

### D2: One reader for `artifact://` (Q12, Q16, Q19, Q21)

`artifact` joins `LOCATOR_READERS` and routes before local path resolution,
as `media://` does. It needs no native executor.

- The reader loads the part.
- It selects lines with the in-memory helpers that web reads use (see
  Context), so `:N-M`, multi-range, `:raw`, and `:outline` for Markdown parts
  behave as on a file.
- A bare `artifact://` lists the Chat's artifacts. An artifact with parts
  lists its parts. Both lists use the directory-list shape.
- `edit` and `write` refuse the scheme with `invalid_path`.

The content type comes from the producer:

- `grep` and `web_search` produce `text/markdown`, because their text shapes
  are Markdown.
- A `bash` stream is `application/json` when the whole stream parses as JSON,
  and `text/plain` otherwise.
- MCP results are `application/json`.
- Other generic spill uses the type of its rendering: JSON for a JSON
  rendering, plain text otherwise.

### D3: Each tool declares how it spills (Q18)

A tool definition gets an optional `spill` field:

- `head`, the default;
- `head_tail`, used by `bash`;
- `tool`.

A tool that declares `tool` renders both texts itself, the inline part and the
artifact. `grep` and `web_search` declare `tool`, so their layout rules stay
in their own modules.

The runner calls the cap only for `head` and `head_tail`:

- `head` keeps today's shape-preserving cut inline (A4).
- `head_tail` builds the head and tail text for each part.

Then the runner writes the artifact and appends the notice. MCP results go
through the same path at `mcp-runtime.service.ts:900`. No code switches on a
tool name; [#1489](https://github.com/leon0399/llame/issues/1489) later takes
the field into its registration surface.

### D4: `bash` streams up to the artifact bound (Q16, Q17)

- **Bounds.** The host and `ssh://` `outputBound` becomes
  `tools.artifacts.maxBytes`, counted in UTF-8 bytes. A Machine keeps the
  protocol constant: a daemon change ships with
  [#1528](https://github.com/leon0399/llame/issues/1528).
- **Memory.** One managed `bash` per process caps the extra memory at two
  streams of 8 MiB each.
- **Parts.** A stream becomes a part only when it does not fit inline:
  `artifact://bash-<n>/stdout` or `/stderr`.
- **Inline preview.** The over-budget streams share the inline budget
  equally. A quarter of each share is the head, the rest is the tail (A5).
  An `[lines A-B omitted; read <locator>:A-B]` line separates them.

### D5: Read-time authority (Q3, Q11)

At write time, `grep` and `web_search` record each finding's source locator
and its artifact line range in `findings`. On each artifact read, the reader
evaluates the current `read` group once for each distinct locator. The
evaluation is silent, with no audit event per finding; this follows the
excluded-directory rule of `grep-scan-throughput`. Each line in a refused
range renders as `[withheld]`. Line numbers stay the same.

`bypass` mode evaluates no group, as everywhere. Host files keep the content
as admitted (D10). The permission projection treats `artifact://` as logical
text with its selector removed, as it does for `media://`.

### D6: Generic spill writes once, after the rendering

The runner renders the result, measures it, and writes the artifact in one
transaction. A failed write leaves the inline text with `[full result not
stored]` and no locator.

The tool part stores:

- the inline output;
- an `artifact` field that holds the locator.

The `artifact` field is outside the payload, so replay keeps it (D8). The
runner refuses to write past `tools.artifacts.maxBytes`. A producer that
streams (`grep`, `bash`) stops at the bound before that point.

### D7: `grep` walks to the end (Q13, Q14, Q20, Q22)

- **No page stop.** The engine no longer stops when a page fills. The API
  renders passages into the artifact text while it walks. It stops at the end
  of the scopes, a configured bound, the artifact bound, or the deadline.
- **Inline part.** The inline part is the head of that text, at most `limit`
  files, under 15,000 units. The remainder line names the next ten files with
  their artifact line ranges.
- **Removed.** The keyset cursor and the `cursor` input go. The cursor-shaped
  progress rules of `grep-scan-throughput` (D5 there) apply within one call
  only. `unfinishedFile` names the file that the stop happened in.
- **Machines.** A Machine scope still pages internally with the daemon cursor
  of `fs.grep`. The request carries the artifact bytes that are left in place
  of a page budget. The wire shape is unchanged, so no daemon release is
  needed.
- **Time.** A no-match walk over this repository took 3.4 s at #1515. A
  broad walk can now use the whole deadline, 108 s by default. The artifact
  bound is the early stop; Q14 accepts that a result at the bound means the
  search is wrong.

### D8: Replay keeps `Artifact:` (Q21)

`tool-observation-part.ts` emits `Artifact: <locator>` in the outcome block of
the pair. The line survives payload clearing, so it counts in the
irreducible envelope. That adds about 30 units to each pair with an artifact.
Pairs without an artifact are unchanged.

### D9: `web_search` text and fetch size (Q23)

- **Text shape.** The text shape is new in `tool-result-rendering`: `## <rank>. <title>`,
  then the URL and host lines, then snippet lines that begin with `>`.
- **Fetch size.** Engines ask for `max(limit, webSearch.fetchLimit)`, clamped
  per vendor. The aggregate cuts its merged list to that size.
- **Split.** The inline text holds `limit` results. The artifact holds all of
  them as text. The stored part holds the inline results and the locator, so
  the web chat renderer shows what the model saw.
- **Cost.** Most engines bill per request (`docs/product/operator/web-search.md`).
  Parallel adds $1 per 1,000 results past ten.

### D10: Host files are a cache that can be restored (Q2, Q6, Q8, Q9, Q10)

- **When files exist.** Only when `bash` is in `tools.allowed` and the Run
  has a native executor.
- **Path and write.** The path is `$TMPDIR/llame/chats/<chatId>/artifacts/<tool>-<n>[/<part>].<ext>`.
  A write goes to a temporary name, then a rename. The writer runs right after
  the database commit.
- **Reconcile.** At attempt start and before each `bash` call, the system
  lists the directory and compares names and hashes with the artifact rows.
  The row metadata comes from one query with no content. It then fetches and
  writes only what is absent or different.
- **Notice.** It names the path. In a Machine Workspace it says "on the
  llame host only".
- **Rejected:** rewriting `artifact://` tokens in the command text (OMP).
  Loops such as `cat ".../tool-${i}.txt"` cannot be rewritten, and permission
  rules match the submitted text.

### D11: Forks copy what they cite (Q7)

The fork transaction copies the `tool_artifacts` rows, with their parts, that
the copied tool parts name. It also copies `artifact_seq`. Only owner forks
copy tool parts. A shared fork copies no tool part, so it copies no artifact.

### D12: Prompt imports opt out (Q15)

`prompt-imports.ts` skips the `artifact` scheme explicitly. The opt-out
belongs on the source in the plugin model ([#1011](https://github.com/leon0399/llame/issues/1011)).

## Risks / Trade-offs

- [Database growth: every large result is stored for the life of the Chat] ->
  8 MiB per artifact. A sweep or quota comes when measured growth calls for
  it.
- [A broad `grep` now takes its whole deadline] -> the artifact bound stops it
  at 8 MiB. The notice and the remainder line show the scale, so the model
  can narrow the search.
- [Any owner's `bash` can read another owner's files under `$TMPDIR`] -> this
  is accepted for single-user deployments (Q2). The proposal records the
  host-path exception for Leo's confirmation. Files exist only where `bash`
  already has host authority.
- [Restore after a reboot reads every artifact of the Chat] -> it happens only
  once per host and Chat, and only with `bash` allowlisted.
- [JSON detection parses up to 8 MiB of stdout] -> it parses once, when the
  stream is stored, and only for a stream that spills.
- [The artifact can be up to 8 MiB in worker memory while it renders] -> one
  producer per call. This is the same order as today's 32 MiB `grep` byte
  bound before `grep-scan-throughput` made it opt-in.

## Migration Plan

- The schema change is additive: two tables and one column. No backfill is
  needed; old tool parts have no `artifact` field and replay as today.
- Pre-launch rule: the `grep` cursor and the old cap notice text go with no
  compatibility path. A stored `grep` part with a `cursor` renders without its
  continuation line.
- Rollback before the merge of a later layer: revert the layer. After that,
  drop the two tables and the column in a new migration.

## Open Questions

- The exact inline budget split for `bash` (A5) and the count of files on the
  remainder line can change in the implementation layer without changing the
  specs. The specs fix only the presence and order of the lines.

## Revision history

- **v1 (2026-11-02):** Initial draft from the design grilling (Q1-Q25).

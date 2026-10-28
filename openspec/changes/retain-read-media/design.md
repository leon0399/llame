## Context

See proposal.md for the motivation. Code facts are at `1b4e890d`.

- A read decodes its bytes in the media hook (`apps/api/src/media/tool-media-store.ts:139-166`). An
  image keeps only its model variant, and a PDF keeps its original. The entry goes into a per-attempt
  map, `HeldMedia`, keyed by the tool call id or by the prompt-import key
  (`apps/api/src/media/attempt-media.ts:28-56`). Each `executeRun` creates a fresh map
  (`apps/api/src/media/media-descriptors.ts:192-221`, `apps/api/src/runs/run-execution.service.ts:1131`).
- Model messages never carry bytes. A tool result carries a `custom` reference part keyed by the
  tool call id, and a prompt import an image-shaped marker
  (`apps/api/src/media/epoch-admission.ts:225-320`). The step composer replaces each marker on every
  step, with bytes from the map or from the media store (`apps/api/src/models/step-composer.ts:102-127`,
  `:294-324`).
- The composer releases the bytes of each reference that the window does not attach, and admission
  keeps the released size (`attempt-media.ts:38-56`, `epoch-admission.ts:428-449`). A reference
  without a map entry is `not-retained`.
- One `ToolResult` object feeds the model text (`toModelOutput`, `run-execution.service.ts:1805-1819`),
  the `tool.completed` payload (`:1541-1552`), and the stored part (`apps/api/src/runs/assistant-transcript.ts:365-395`).
  Only the model text strips a key (`thumbnail`, `packages/native-file-tools/src/serialization.ts:4-22`).
  The result is also subject to the 16,000-character truncation (`apps/api/src/tools/runner.ts:456`,
  `packages/runtime-safety/src/result-truncation.ts:12`) and, on replay, to the 8,000/32,000 budgets
  measured over its serialized form (`apps/api/src/chats/tool-observation-part.ts:25-27`, `:279-283`).
- The reply row is the source of later requests (`rebuildContextForChat`,
  `run-execution.service.ts:2369-2414`, reads only the rows after the active checkpoint). A settler
  without the live collector rebuilds the reply from `tool.completed` payloads
  (`apps/api/src/runs/run-reply-finalizer.ts:309-345`, `assistant-transcript.ts:577-600`). A
  Continue Run copies the reply's kept parts into `run.continued` and seeds its collector from them
  (`apps/api/src/chats/run-creation.ts:94-99`, `run-execution.service.ts:1299`).
- `GET /api/v1/chats/:id/messages` returns `parts` as stored (`apps/api/src/chats/dto/chats.dto.ts:527`).
  The stream bridge forwards only `tool.completed.output` (`apps/api/src/runs/run-stream-bridge.ts:295-331`).
  The public projection, `conversation_read`, search, the title, and the recency digest read text
  parts only (`chats.dto.ts:604-611`, `apps/api/src/tools/conversation-read.ts:141-148`,
  `apps/api/src/search/chat/conversation-chunker.ts:72-73`, `apps/api/src/titles/title.ts:87`,
  `apps/api/src/chats/recency-digest.service.ts:54-58`). An owner fork copies `parts` verbatim
  (`apps/api/src/chats/fork-copy.ts:174-190`).
- The overflow trigger needs a stored reference in an earlier row
  (`apps/api/src/compaction/compaction.ts:116-124`).

## Goals / Non-Goals

**Goals:**

- One byte source for every request: the stored part, and the live read until the part exists.
- Model messages stay byte-free markers, so no estimator, budget, or serializer changes.
- No retained byte crosses a client, stream, log, or model-text boundary.

**Non-Goals:**

- A storage abstraction for retained bytes. Q12-A accepts a later migration.
- Any change to the window's bounds, to placeholder text other than not-retained, or to uploads.

## Prior art

| System                                                                                                           | Where tool-read media lives                                                    | Eviction                |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| [Codex CLI](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs#L888-L935)                 | inline data URL in the rollout JSONL                                           | compaction              |
| Claude Code ([#67313](https://github.com/anthropics/claude-code/issues/67313))                                   | inline base64, twice per item                                                  | `/compact`              |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli/issues/24432)                                           | inline `inlineData` in the session JSON                                        | none found              |
| [OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/blob.ts#L311-L430)           | inline by default; `experimental.media_blob` uses `blob` and `blob_ref` tables | compaction; refcount GC |
| [oh-my-pi](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/blob-store.ts#L8-L18) | `blob:sha256:` reference, bytes in files                                       | compaction              |

The inline harnesses show two costs that llame avoids here: Claude Code stores each image twice in
one record, and Gemini CLI loads every byte at startup. llame strips the bytes before each client
response and loads only the rows of the current epoch.

`vision-media` rejected the ingestion of every read into the media store
(`openspec/changes/archive/2026-10-12-vision-media/design.md:480-483`): it filled the gallery and
gave reads ids that outlived their source. Inline retention has neither problem.

## Decisions

### D1: Retained bytes sit beside the result, never inside it

A `tool-read` part gains one field, `retainedMedia`, next to `output`. A prompt-import entry gains
the same key. The image form is `{ mediaType, width, height, data }` for the model variant; the PDF
form is `{ mediaType: "application/pdf", data }`. `data` is base64, because `jsonb` holds no binary.

The result object stays as `read` returns it. So the truncation cap, the native serializer, the
replay budgets, the prompt-import 128 KiB bound, and the `tool.completed.output` that the bridge
forwards never see the bytes. Each of them would need its own exception if the bytes were in the
result.

Rejected: a key in `output`. The 16,000-character truncation would cut it, the serializer would put
it in model text, and an 8,000-unit replay budget would clear the pair on the next turn.

### D2: The per-attempt map stays, as a base64 index without release

`HeldMedia` becomes `RetainedMedia`: every entry holds its base64 string, and `releaseMedia` is
deleted. The map has two writers. The media hook writes a live read, now whatever the model's
input, and encodes its bytes once. Context assembly writes each `retainedMedia` of the rows it
loads: epoch rows, Continue kept parts, and the compaction prefix. The rows are already in memory,
so this adds no copy of the strings.

Admission sizes an entry from its string length, which is its exact base64 size, so it decodes
nothing. The composer decodes only the entries that the window attaches, at most 28 MiB per request.

Model messages keep their byte-free markers. `estimateProjectionTokens` serializes raw messages when
no sizing is given (`compaction.ts:139-177`), so bytes on a marker would reach that estimate.

Rejected: the bytes on the marker itself. It removes the map but puts megabytes into every
`JSON.stringify` of request messages.

A marker exists only for an item with bytes. Each producer checks `retainedMedia` before it emits
one: the replay of a stored part (`tool-observation-part.ts:463-497`), the Continue projection
(`continue-projection.ts:171-184`, which today derives the marker from the recorded result), the
prompt-import marker (`prompt-imports-item.ts:211-245`), and the live `toModelOutput`. A marker
without a map entry is then a defect, and the composer throws. The `not-retained` status, the
not-retained placeholder, and the released-size fields are deleted.

A marker carries its own key, and one key function serves the loader and every producer. A stored
tool part's key is `<message id>:<part index>`, a Continue kept part's key is `continued:<part
index>`, and a prompt-import entry keeps `prompt-import:<run id>:<locator>`. A key from row identity
stays the same in every build of one attempt: the main request, the continuation estimate
(`compaction.ts:192`), and the compaction request (`compaction.ts:370`) all share one map. The
provider's tool call id is not unique across rows: some OpenAI-compatible servers number calls
`call_0`, `call_1` in each response. A live marker keeps the tool call id, because the transcript
already requires it to be unique in a Run (`assistant-transcript.ts:277-281`).

### D3: Every durable writer carries the bytes

- The live collector adds `retainedMedia` from the map when it builds a `tool-read` part.
- A model call's `tool.completed` carries `retainedMedia` as a payload field beside `output`. The
  event-log rebuild copies it into the part. This is the deviation from Q18-A that the proposal
  asks Leo to confirm. A system-origin read, such as a prompt import, keeps its bytes only in the
  item entry, so its `tool.completed` carries none.
- `run.continued` keeps the kept parts verbatim, `retainedMedia` included.
- The prompt-import pass writes `retainedMedia` into the entry when it creates the item.

Rejected: byte-free events. A reply settled after a crash, a dead-letter expiry, or a claim-time
cancel would lose its media, and each Continue of that reply would copy the loss.

### D4: Each egress strips the bytes

One function removes `retainedMedia` from parts, prompt-import entries, and event payloads. Its
callers:

- `toChatMessageResponse`, for the history response (`chats.dto.ts:518-547`);
- the run event stream, which writes stored payloads as SSE frames
  (`runs.controller.ts:234-251`);
- `toRunUserMessage`, for the Continue and Regenerate job payloads
  (`chat-message-parts.ts:36-42`, `follow-up-admission.service.ts:328`, `:376`). The worker reads
  the triggering row from the database (`run-execution.service.ts:2385`).

The UI stream bridge and `keptPartEvents` build chunks from `output` only, so neither forwards the
bytes. The web schemas stay unchanged, because every response is the same as today. Tests pin the
history response, both streams, the job payload, and model text.

AI SDK telemetry is off: `agentTelemetry` sets only `functionId` (`model-client.ts:56-58`), so no
prompt reaches a span.

### D5: Each stored message keeps at most 28 MiB of retained base64

Postgres limits one `jsonb` value to 255 MiB. Ten 20 MiB PDF reads in one reply would exceed it,
and the reply would fail to persist. So each message keeps at most 29,360,128 bytes of retained
base64, the window's own byte bound.

`recordToolCompleted` decides before it writes the event (`run-execution.service.ts:1541-1556`).
It runs inside the tool's `execute`, before the SDK calls `toModelOutput`
(`run-execution.service.ts:1771-1776`), so the live step, the event, the part, and a rebuilt reply
agree. The running sum starts from the seeded Continue kept parts (`run-execution.service.ts:1299`)
and adds each settled read in settlement order. A read past it removes its map entry, and both the
event and the part record `retainedMedia: { "exceeded": true }`. The prompt-import pass applies the
same sum to the entries of its item.

An exceeded record takes the limit placeholder, or the omitted placeholder on a model without its
kind, and it latches the window as the first reference past a bound does. That is what the window
gives such a read today, so the canonical `The byte bound applies within a Run` scenario stays true.
A reference past the sum could never attach on a model that declares every kind, because the window
admits oldest first and latches. On a model that omits PDFs, an image after large PDFs can take the
limit placeholder although the window could fit it. That case is accepted for one simple bound.

Rejected: a read that fails past the bound. It turns a storage limit into a tool error that the
model cannot act on. Rejected: plain text with no placeholder. The model then gets no signal that it
did not see the content.

### D6: Admission sizes retained references from their bytes

A retained image costs the length of its base64 string and one image. A retained PDF costs the
length of its string and its pages. The window is now append-only across attempts, because no
entry leaves it at an attempt boundary.

### D7: The overflow trigger counts retained references

`mediaOverflowCompacts` treats a retained reference in an earlier row like a stored one. Otherwise a
retained read past the bounds keeps the limit placeholder and never compacts.

Continue kept messages follow the trigger (`run-execution.service.ts:5384`). Today their unstored
references are `not-retained` and count nothing, so the trigger's slice of the last
`triggerRefCount` statuses (`compaction.ts:108-124`) and the continuation estimate's alignment to
the end (`step-composer.ts:184`) ignore them. With retention they count, so both consumers take an
explicit kept-reference count and skip it.

### D8: Rows without bytes replay as text

A `read` result or entry stored before this change has no `retainedMedia`. It emits no marker, so
its serialized result text replays alone (Q10-B). No backfill is possible, because the bytes no
longer exist.

### D9: The tool description and docs change with the behavior

The packaged `read` description (`apps/api/src/prompts/tools/read.md:66-68`) stops saying that read
media is not kept. `SPEC.md`, the `read`, locator, prompt-import, Continue, and web-read docs, and
the media operator page change in the same layer.

## Fixture costs

Real admission constants: an image costs `ceil(w × h / 750)` tokens on its model variant, a PDF
3,000 tokens per page, and the not-retained placeholder about 12 tokens.

| Fixture                                            |                 Before, each later request | After, each later request |
| -------------------------------------------------- | -----------------------------------------: | ------------------------: |
| one 1600×900 screenshot                            | 12 (+1,920 and one tool call when re-read) |                     1,920 |
| one 2000×1125 screenshot                           |                   12 (+3,000 when re-read) |                     3,000 |
| one 15-page PDF                                    |                  12 (+45,000 when re-read) |                    45,000 |
| 40 screenshots at 2000×1125, 500,000-byte variants |                                        480 |                   120,000 |

The last row fits the window: 40 × 666,668 base64 bytes is 26.7 MB. Its 120,000 tokens stay under
the 160,000-token threshold of a 200,000-token model, so they stay until a later turn crosses it.
The after column applies until a compaction absorbs the row. The window's append-only order keeps
the prefix stable, so providers with prompt caching bill these tokens at the cached rate after the
first request.

## Risks / Trade-offs

- [A row with a PDF read grows by up to about 27 MiB of base64, and history pages detoast it] ->
  The server strips the bytes before the response. A blob table can replace the inline field later.
- [`run_events` holds a second copy of each item] -> Run-event retention (#119) can prune
  `tool.completed` payloads of terminal Runs.
- [Each Continue copies its kept media into a new `run.continued`] -> Bounded by the reply's own
  retained media. The same retention work applies.
- [Each request loads its epoch rows with their base64 strings, and an owner fork loads every row
  of the chat] -> The per-message bound caps each row, and the composer decodes only attached
  entries. A blob table is the later fix if rows grow past what history loads tolerate.
- [The stream bridge reads the whole `run.continued` payload on each connection] -> The
  per-message bound caps it at about 28 MiB.
- [An owner fork copies every row in chunks of 500 (`messages-repository.ts:306-309`), and 37 rows
  at the bound exceed the 1 GiB statement limit] -> The fork copy chunks its inserts by part bytes,
  at most 256 MiB for each statement.
- [Kinds that the model omits never reach the window limit, so their retained bytes accumulate in
  the epoch until the token threshold fires. The worst case is 100 turns of 28 MiB, about 2.8 GB
  loaded per attempt] -> Accepted under D6: the case needs a text-only or image-only model that
  reads many PDFs without compaction. A blob table removes it.
- [Retained media costs tokens on every later request] -> The epoch window bounds it, and overflow
  compaction absorbs it.
- [Host, Knowledge, skill, machine, and web media persist in chat rows and backups] -> The rows keep
  the owner-only RLS of `messages` and `run_events`, and chat deletion removes them. The proposal
  records the threat.
- [A rollback to older code sends retained bytes to the owner's browser and fails the strict
  prompt-import validator] -> Owner-only data, no cross-tenant exposure. A rollback needs a strip
  of `retainedMedia` first.
- [Legacy results lose their placeholder] -> Their result text still names the kind, the
  dimensions, and the path.

## Migration Plan

No schema migration: `parts` and `payload` are `jsonb`. New reads retain their bytes at deploy.
Earlier results take the D7 form. Rollback is a redeploy of the earlier code after a strip of
`retainedMedia` from parts and events.

## Open Questions

None.

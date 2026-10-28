## Why

An image or PDF that `read` returns from a locator reaches the model only inside the attempt that
read it. Every later request, a later turn, a Continue, or a compaction, replays it as
`[image "/work/shot.png" 1600×900, not retained]`, and the model must read the locator again. A
second read can see changed bytes, and nothing tells the model so
([#1422](https://github.com/leon0399/llame/issues/1422)).

Every reference harness keeps tool-read media in its history until compaction: Codex CLI, Claude
Code, Gemini CLI, and OpenCode store the bytes inline in the transcript; OpenCode's experimental
blob store and oh-my-pi keep a content-addressed reference. llame's epoch media window and
overflow compaction already bound what such retention sends, so retention cannot produce the
accumulation failures Claude Code reports. The decisions come from a grilling round with Leo on
2026-10-28, recorded on #1422.

## What Changes

- **Read media is retained.** Every successful image or PDF `read` of a locator other than
  `media://`, and every such `@path` prompt-import entry, stores its model bytes in the stored
  message part: an image's model variant, or a PDF's original. This applies to every locator,
  present and future, and to text-only models too.
- **Retained media replays like an upload.** A later turn, a Continue, an owner fork, and a
  compaction request attach retained media under the same epoch window as owner attachments, until
  a compaction absorbs its row. Each `read` keeps the bytes it read, so two reads of one file attach
  twice, and a file that changed between reads replays each version.
- **BREAKING: the not-retained placeholder is deleted.** No request carries
  `[image <locator> W×H, not retained]` or `[pdf <locator> P pages, not retained]`. A result
  stored before this change has no retained bytes and replays as its result text only, with no
  image and no placeholder.
- **Attempt-boundary exceptions are deleted.** The window becomes strictly append-only within an
  epoch: an attempt boundary no longer releases read media from the window.
- **Overflow compaction counts retained media.** A retained reference in an earlier row enables the
  overflow trigger, as a stored reference does today.
- **Bytes stay on the server.** No history response, stream frame, model text, conversation read,
  search index, title input, share, or log carries retained bytes. Request-size estimates, replay
  budgets, and result truncation exclude them, and media keeps its dimension and page charges.
- **No media objects.** Retained media is not written to the media store, has no `media://` id, and
  does not appear in the gallery. It is deleted with its chat, and an owner fork copies it with the
  rows.
- **Tool description and docs.** The `read` description stops telling the model that read media is
  not kept. `read`, prompt-import, locator, Continue, and operator media docs change with it.

## Assumptions, confirmed with Leo

- No live measurement first (Q1-A). The design records fixture costs from the real admission
  constants instead.
- Bytes live inline in `messages.parts` (Q12-A), the image model variant and the PDF original
  (Q17-A). A later move to a blob store needs a data migration, and Leo accepts that cost.
- Retention applies to every locator, present and future, and to prompt imports (Q3-A), whatever
  the model's declared input (Q8-A).
- Compaction is the only eviction (Q4-A).
- The model sees `path` only, with no id and no digest (Q20-A). The display thumbnail stays.
- Rows stored before this change replay as their result text only (Q10-B).
- The media store's no-deletion gap for uploads stays open, under a new follow-up issue (Q11-A).

These follow from those decisions and were not asked separately:

- A vision summarizer receives retained prefix media under the window, as it receives uploads.
- The overflow trigger counts retained references in earlier rows. Without this, retained media
  beyond the bounds keeps the limit placeholder and never compacts.
- A reply that a settler rebuilds from the event log keeps its retained media.

## Deviation from the grilling record

Q18-A chose that no run event holds retained bytes. The code makes the event log a durable writer
of the reply: a settler without the live collector rebuilds the reply's tool parts from
`tool.completed` payloads (`run-reply-finalizer.ts:309-345`, `assistant-transcript.ts:577-600`),
and a Continue Run copies the reply's kept parts into its `run.continued` event
(`chats/run-creation.ts:94-99`). Without bytes in those events, a reply settled after a worker crash
or a dead-letter expiry loses its retained media, and so does every Continue of such a reply.

This proposal keeps the bytes in those two server-side events, outside the `output` that the
stream bridge forwards, so no stream frame carries them. The cost is a second copy of each retained
item in `run_events`, until run-event retention ([#119](https://github.com/leon0399/llame/issues/119))
prunes it. **Leo: confirm this, or choose byte-free events and accept the loss on those settlement
paths.**

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `media-attachments`: replaces attempt-memory retention with part retention. Modified: `Tool-result
  and prompt-import images reach the model with their text`, `No placeholder directs the model to
  read an image again`, `Each image reference takes exactly one model-facing form`, `Image
  placeholders name the image by its locator`, `Placeholder locators are exact JSON string
  literals`, `The byte bound is summed from variant sizes before loading`, `Only attachable
  references count toward the window`, `Image overflow compacts at the start of the next Run`,
  `Image bytes join a request only when attached`, `Compaction requests carry images as a Run
  would`, and the PDF counterparts of the first five, of the two byte rules, and of the compaction
  rule. Removed: the attempt-memory, release, not-retained, attempt-boundary, and byte-free-part
  requirements. Added: retention, replay, per-read bytes, server-only bytes, and legacy replay.
- `tool-calling`: `Tool observations survive into later turns as stored UI parts` and `PDF tool
  observations are stored and replayed like image results` change the stored form and replay.
- `prompt-imports`: the two unstored-entry requirements are replaced by retained-entry
  requirements; the two private-payload requirements and the payload validator gain
  `retainedMedia`.
- `context-injection`: `Stored parts cross a minimal SDK conversion boundary` names the stored part
  as the byte source.
- `native-file-tools`: `Image reads are decoded without being stored` and `PDF reads are parsed
  without being stored`.
- `model-system-prompts`: `A model switch replaces the top-level prompt and preserves portable
  history` (the vision-model switch scenario).

Deliberately unchanged: `media-store` (no object is created), the epoch window's bounds, the
placeholder forms other than not-retained, the thumbnail rules, and owner attachments.

## Impact

- `apps/api/src/media` (attempt memory, read hook, admission, descriptors), `apps/api/src/models/step-composer.ts`,
  `apps/api/src/chats` (replay, prompt-import entries, history DTO), `apps/api/src/runs` (part
  collector, `tool.completed`, event-log reconstruction), `apps/api/src/compaction` (overflow
  trigger), and the packaged `read` tool description.
- Storage: one inline copy per retained read in `messages.parts` and one in `run_events`. A PDF read
  can add up to about 27 MiB of base64 to a row. Owner history reads detoast the column and strip
  the bytes on the server.
- The web client is unchanged: it receives the same parts as today.
- Threat: host, Knowledge, skill, machine, and web media that the model reads now persists in the
  chat's rows, in the event log, and in database backups until the chat is deleted.

## Non-Goals

- A blob table, content addressing, or deduplication of retained bytes.
- Deletion, quota, or GC for the media store (follow-up issue).
- A `media://` id or a digest for read media.
- Removing the display thumbnail.
- Retaining text results longer than today, or any change to text-result replay budgets.

## Acceptance

- A later turn on a vision model attaches an image that an earlier turn read from a host path,
  under the epoch window, with no read in the later turn.
- A Continue, a reply rebuilt from the event log, and an owner fork each replay that image.
- A request on a text-only model carries the omitted placeholder for it.
- No response of `GET /api/v1/chats/:id/messages`, no stream frame, and no model text carries the
  retained bytes.
- A result stored before this change replays as its text with no placeholder and no failure.
- An owner upload behaves exactly as it does today.

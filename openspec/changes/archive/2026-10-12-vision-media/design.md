## Context

See proposal.md (Why). State at `fc06bdba` (master):

- Native `read` dispatches by scheme in `apps/api/src/tools/native-files.ts:29-122`: `file:` aliases, `kb://`,
  `skill://`, `http(s)://`; any other `scheme://` is `invalid_path` "This path scheme is not available."
  Host and `kb://` reads go through `streamFileWindow`, which decodes 64 KiB chunks with a fatal
  `TextDecoder` (`packages/native-file-tools/src/stream-read.ts:93-110`), so a PNG fails as
  `invalid_utf8`; nothing sniffs magic bytes. The image check belongs ahead of the first chunk decode.
- Admission and compaction size every prepared request as `JSON.stringify({ system, messages, tools })`
  length / 4 (`apps/api/src/compaction/compaction.ts:112-135`), already excluding replayed reasoning
  metadata. Base64 image data counted that way would make one 1 MiB screenshot about 350k tokens.
- Web reads accept text media types only and reject `image/png` as `unsupported_content_type` before
  reading the body (`TEXT_MEDIA_TYPE` and `unsupportedContentType` in
  `apps/api/src/tools/web-read/http-client.ts:113-115,286-297`), pinned by
  `native-file-tools` "Web reads accept text bodies only".
- Tool results replay as `{ type: 'text' }` outputs (`apps/api/src/chats/tool-observation-part.ts:220-265`),
  bounded in UTF-16 code units (`tool-calling` "Tool observations survive into later turns as stored UI
  parts": 8,000 per pair, 32,000 per stored turn).
- The owner send DTO accepts 1–50 text parts of at most 20,000 characters
  (`apps/api/src/chats/dto/chats.dto.ts:165-235`), and the loop rejects a message with no text part
  (`apps/api/src/chats/chat-loop.service.ts:200-212`). No spec states these limits.
- `models[]` declares no input modality (`apps/api/src/instance-config/llame.config.schema.json:434-531`).
- No blob, upload, or object-storage code exists. `messages.attachments` (`chats.ts:238-241`) is
  written as an empty array on both insert paths (`messages-repository.ts:518,551,576`), published in
  the message DTO (`chats.dto.ts:492,549`), and copied verbatim by forks (`fork-copy.ts:176`); no
  producer fills it. This change leaves it as is and stores attachments as `file` parts, the AI SDK
  shape `useChat` sends. The API and a dedicated worker share Postgres and no filesystem except
  Knowledge mounts (`docs/product/operator/scaling.md:10-21,121-127`).
- The web client sends `sendMessage({ text })` through AI SDK `useChat`
  (`apps/web/app/(chat)/components/use-chat-conversation.ts:27-66`) with cookie credentials; the session
  cookie is `SameSite=Lax` (`apps/api/src/auth/auth.controller.ts:246`). `packages/ui` has a
  `MessageAttachment` primitive with 96 px image thumbnails that render `<img src={data.url}>`
  (`ai-elements/message.tsx:358-383`) and no
  lightbox.
- Installed adapters: `ai@6.0.256`, `@ai-sdk/openai@3.0.97`, `@ai-sdk/anthropic@3.0.118`,
  `@ai-sdk/openai-compatible@2.0.75`. The Responses and Messages adapters convert a tool output of
  `type: 'content'` with `image-data` parts into provider image blocks. The Chat Completions adapter
  `JSON.stringify`s a `content` output into the tool message
  (`@ai-sdk/openai-compatible/dist/index.mjs`, `case "tool"`), so an image there would reach the model
  as base64 text.
- Provider limits: Anthropic accepts at most 100 images per request (600 on some models), 8,000 px per
  side, tighter per-image dimensions above 20 images, and a 32 MB request; Bedrock and Vertex cap an
  image at 5 MB of base64
  ([vision](https://platform.claude.com/docs/en/build-with-claude/vision#request-limits)). OpenAI
  accepts PNG, JPEG, WebP, and non-animated GIF
  ([images](https://developers.openai.com/api/docs/guides/images-vision#image-input-requirements)).

### Prior art

| Harness        | Storage                                                    | Bounds                                                  | Non-vision                                                                           | Reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OMP            | session JSONL, images externalized as `blob:sha256:<hex>`  | 20 MiB in; resize to 1568 px / 500 KiB with `Bun.Image` | placeholder; Chat Completions moves tool-result images into a following user message | [read.ts](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/tools/read.ts#L636-L637), [image-resize.ts](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/utils/image-resize.ts), [openai-completions.ts](https://github.com/can1357/oh-my-pi/blob/cde91bb38674d365e8c3916d05d2292273bb8554/packages/ai/src/providers/openai-completions.ts#L2699-L2770) |
| OpenClaw       | private `${configDir}/media`; `media://inbound/<id>`       | 5 MiB                                                   | offload to managed media, reference in text                                          | [inbound-media-uri.ts](https://github.com/openclaw/openclaw/blob/main/src/media/inbound-media-uri.ts), [store.ts](https://github.com/openclaw/openclaw/blob/main/src/media/store.ts)                                                                                                                                                                                                                                                                                         |
| Open WebUI     | `File` row plus pluggable provider (local, S3, GCS, Azure) | configured                                              | none                                                                                 | [storage/provider.py](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/storage/provider.py)                                                                                                                                                                                                                                                                                                                                                             |
| Vercel Chatbot | public Vercel Blob URL                                     | JPEG/PNG, 5 MiB                                         | none                                                                                 | [upload route](https://github.com/vercel/chatbot/blob/main/app/%28chat%29/api/files/upload/route.ts)                                                                                                                                                                                                                                                                                                                                                                         |
| OpenCode       | data URLs in session parts                                 | 20 MiB in; 2000 px, 5 MiB base64                        | text-only models may reject                                                          | [attachments](https://opencode.ai/v2/docs/attachments)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Codex CLI      | local paths                                                | —                                                       | —                                                                                    | images submitted before one text item: [input_submission.rs](https://github.com/openai/codex/blob/217c2d21a5097fedc33ecbb71c08c2b31bff8fd0/codex-rs/tui/src/chatwidget/input_submission.rs)                                                                                                                                                                                                                                                                                  |

Shipped web chats (ChatGPT, Claude.ai, Open WebUI) attach images to the message, not to a text
position. Terminal harnesses (Codex, OpenCode, Claude Code) insert `[Image #N]` placeholders kept whole
by editor marks; a browser `<textarea>` has no such marks.

## Goals / Non-Goals

**Goals:** one owner-scoped media store for uploaded images, which every upload writes to and every
`media://` replay reads from; one locator, `media://<id>`, the model and the owner both use for
uploads; images the model or a prompt import reads elsewhere reach the model in the reading attempt
without being stored; provider image parts built at request time, never stored base64.

**Non-Goals:** object storage, deletion, a media library view, PDF/audio/video, SVG rasterization
(#1160), public-share media, per-provider image re-encoding beyond one model variant.

## Decisions

### R1 revision: tool-read images are not stored

Leo decided on 2026-10-11, after the proposal's approval, that the media store holds owner uploads
only. This revision supersedes the approved proposal where they differ and rewrites D1, D2, D3, D6,
D7, D8, D9, and D11:

- The store keeps only images uploaded through `POST /api/v1/media`. `media_objects.provenance` and
  its enum are deleted, and descriptors and lightbox captions carry no provenance (R1.1).
- `read("media://<id>")` is unchanged and is the only read whose image persists across turns (R1.2).
- Host, `file:`, `kb://`, `skill://`, and `http(s)://` image reads, and prompt imports of those
  targets, decode the image with the upload pipeline and store nothing. Their result carries no
  `media` field (R1.3, R1.6).
- The worker keeps each such decoded model variant in the reading attempt's memory only, keyed by
  tool call id or prompt-import entry, and only while the epoch window attaches it (R2.3). Later
  steps of that attempt attach it under the unchanged epoch window. Any other request on a vision
  model gets `[image <locator> W×H, not retained]`, with `<locator>` a JSON string literal (R1.4); a
  text-only model gets the omitted placeholder.
- Each unstored image result or prompt-import entry stores a display-only WebP `thumbnail` data URL
  that never reaches a model (R1.5). The read tool card and prompt-import chip render it, and the
  lightbox shows it as a single-variant slide (R1.7).
- Owner attachments, the `/model` routes, the composer, the Chat Completions transport, and the epoch
  window mechanics are unchanged (R1.8).

### R2 revision: simplifications

Leo confirmed a second set of decisions on 2026-10-11, after a grilling round of its own, numbered
R2.1–R2.15 below. They apply on top of R1 and rewrite parts of D2, D6, D8, D9, D10, and D11:

- Unstored thumbnails stay inline in the tool part and the prompt-import payload, and the
  `tool.completed` run event keeps its copy (R2.1, R2.12). A thumbnail is one encode: alpha
  flattened onto white, fit within 256 px without enlargement, WebP quality 60. When its data URL
  exceeds 65,536 characters, nothing is stored: a tool result has no `thumbnail` key, an import
  entry keeps `width`, `height`, and `mediaType`, and the web client shows a dimensions-only tile.
  The quality ladder and edge halving are gone (R2.2).
- Attempt memory holds the model variant whenever the attempt's model declares `image` input,
  counting nothing at hold time. The composer releases the bytes of every unstored reference the
  epoch window does not attach, so after each compose the retained bytes are those the window
  attached, at most 24 MiB of base64. A released entry keeps its locator, dimensions, and
  model-variant byte size, so the window still sizes it and, being append-only, refuses it again;
  an attached reference whose bytes are gone falls back to the not-retained placeholder (R2.3).
- A placeholder locator is plain `JSON.stringify(locator)`, with no further escapes (R2.4).
- `conversation_read` and title lines are `[image media://<id> <name>]`, rendered from the stored
  file part's `filename` alone, with no descriptor lookup, dimensions, or unavailable form (R2.5).
- The lightbox is a shadcn `Dialog` over the clicked row only: a message's attachments, a `read`
  result's image, a prompt-import chip, or the composer's uploaded tiles. Each slide has one source,
  the `/original` route for a stored image and the inline thumbnail for an unstored one, with no
  variant toggle and no descriptor fetch. Zoom toggles between fit and natural size only when the
  natural size exceeds the fit; an unstored read's thumbnail always fits and shows no toggle (R2.6,
  R2.7, R2.13, R2.14).
- Composer tiles keep add order, with no reordering (R2.8). Under a text-only model the attach
  picker is disabled, and a refused paste or drop shows a toast (R2.9).
- On Chat Completions wires, each moved tool-result image is preceded by the label
  `Image from <toolName> <JSON locator>:`, and the tool message keeps only its text envelope
  (R2.15).
- Overflow-triggered compaction and the model-variant encode ladder stay (R2.10, R2.11).
- `models[].maxImages`, a resize or coordinate note, a 200 px minimum edge, `variant_version`, HEIC,
  and crop on read are deferred to follow-up issues.

### D1: Postgres metadata and blob tables under RLS (Q1, R1.1)

`media_objects` holds one row per uploaded owner image: id (UUIDv7, generated in the API with the
`uuid` package's `v7()`, because neither PostgreSQL 17 nor Node 22 provides one), owner id, detected
format, original byte size and dimensions, model-variant format, byte size, and dimensions, SHA-256
of the original, a single-line source label, and creation time. It records no provenance: every row
is an upload. The label is the upload filename with control characters replaced by spaces, `[` and
`]` replaced by `(` and `)`, reserved delimiters neutralized, and at most 256 characters.
Placeholders name a stored object by this label but write an unstored image's locator exactly, as a
JSON string literal (D6). `media_blobs` holds `(media_id, variant)` → `bytea` for `original` and
`model`. Both tables use enabled, forced RLS keyed on the authenticated
owner, like every tenant table. The metadata/blob split lets a later object-storage move replace only
`media_blobs` rows without changing any stored part.

Rejected: a local uploads directory (needs a new shared mount across API and worker, and moves isolation
from the datastore into path checks); S3-compatible storage now (new required infrastructure for every
self-hoster and the E2E harness); a pluggable interface (one implementation today).

Dedup: a new upload whose original SHA-256 matches an existing row of the same owner reuses that row,
so re-pasting the same image yields the same `media://` id. Dedup never crosses owners: a cross-owner
match would reveal that another owner holds the image.

### D2: Image preparation with `sharp`; original plus one model variant (Q2, Q3, Q14, Q15, R1.3)

`sharp` (libvips) is added to `apps/api`. Image preparation, shared by upload, read, and prompt
import:

1. Refuse inputs over 20 MiB before decoding.
2. Detect the format by magic bytes; accept PNG, JPEG, GIF, WebP; everything else, including SVG, is
   `unsupported_media_type`. Declared names, extensions, and Content-Type never decide the format.
3. Read dimensions from the header and refuse above 40 megapixels before a full decode
   (`limitInputPixels`).
4. Build the model variant: apply EXIF orientation, strip metadata, take the first frame of an
   animated GIF or WebP, scale so the long edge is at most 2000 px, encode PNG; if that exceeds
   3.75 MiB, encode JPEG quality 85; if that still exceeds 3.75 MiB, scale down by 0.75 steps until
   it fits.

Ingest, for uploads only, then stores the original bytes unchanged and writes the metadata row and
both blobs in one short transaction, after all decoding and encoding. A pooled connection
(`db.poolSize`, default 10) is never held across `sharp` work.

A read or prompt import of an image that is not `media://` runs steps 1–4 in the worker (the header
check of `prepareMedia` plus the model-variant derivation) and writes nothing. It also encodes the
display-only thumbnail from the model variant in one pass: alpha flattened onto white, resized to fit
256 px on the longest side without enlargement, WebP quality 60. When the data URL exceeds 64 KiB
(65,536 characters), no thumbnail is stored (R2); a screenshot thumbnail is typically under 20 KB.

The original keeps its EXIF, because it is only ever served to its owner; only the model variant leaves
llame. Bounds are code constants; no deployment needs different values yet (Q14).

### D3: Upload first, owner-owned media, no deletion (Q6, Q7, Q13, Q17, Q18)

- `POST /api/v1/media` accepts one `multipart/form-data` file per request, ingests it, and returns the
  media descriptor: `id`, `locator`, `mediaType`, `name`, `width`, `height`, `byteSize`,
  and a `model` object with the variant's `mediaType`, `width`, `height`, `byteSize`. The route uses
  Nest's `FileInterceptor` (multer 2.2.0 already ships with `@nestjs/platform-express`) with
  `limits.fileSize` at 20 MiB; `@types/multer` is added as a dev dependency. Multer's `LIMIT_FILE_SIZE`
  surfaces as Nest's generic `PayloadTooLargeException`, so the route maps it to `413` with the
  `image_too_large` body every other ingest refusal uses. Multer keeps the file in memory; at most
  20 MiB per concurrent upload is the same per-request bound ingest already holds. The JSON body limit
  is unchanged.
- `GET /api/v1/media/:id` returns the descriptor; `GET /api/v1/media/:id/original` and `/model` return
  bytes with the stored type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`,
  `Content-Security-Policy: sandbox`, a strong `ETag` from the content hash, and
  `Cache-Control: private, no-cache`. The browser revalidates every reuse against the authenticated
  route and gets `304` when the ETag matches, so a profile shared by two owners never serves one
  owner's cached bytes to the other. Another owner's id, or an unknown id, is `404`.
- Media belongs to its owner. Messages reference it; forks copy the reference (`owner-chat-forks` already
  copies parts verbatim). Nothing deletes media: no automatic collection on chat deletion, no delete
  route, and unsent uploads are kept (Q13, Q17, Q18). This is recorded as a known gap for the library.

`<img src>` against these routes authenticates through the existing session cookie: the web app's
credentialed `fetch` already requires the API to be same-site, and `SameSite=Lax` cookies are sent on
same-site image requests.

### D4: `media://<uuidv7>` locator (Q11)

The grammar is `media://` followed by a lower-case canonical UUID. Bare `media://` is reserved and
returns `invalid_path` until a library listing exists. `media://` is read-only: `edit` and `write` return
the existing unsupported-operation error, as `skill://` does. The scheme resolves only the Run owner's
media; another owner's id, or an id that does not exist, is `not_found`. A `media://` read takes no
selector: any selector is `invalid_selector`. Permission matching projects a `media://` locator
unchanged, so a restricted `read` group admits it with `^media://`.

### D5: Owner attachments are message-level `file` parts (Q12)

An owner message may carry up to 10 AI SDK `file` parts `{ type: 'file', mediaType, url:
'media://<id>', filename? }` alongside its text parts. The server checks each id belongs to the
sender, then rewrites `mediaType` and `filename` from the stored descriptor, so the client cannot
mislabel an object. A message needs at least one text part or one file part; text bounds are
unchanged. File parts are stored in thumbnail order. Using the AI SDK part shape lets `useChat`
send files; the web client rewrites `media://<id>` to the `/model` route before rendering (D10).

Rejected: placeholders in the text (`[Image 1]`) and interleaved parts at the paste position. No shipped
web chat preserves paste position, and a plain `<textarea>` cannot keep a placeholder token whole.

### D6: Model input and replay (Q4, Q5, Q8, R1.4)

`models[].input` is an optional array over the closed set `text`, `image`; it must contain `text` and no
duplicates. Absent means `["text"]`. `GET /api/v1/models` always publishes `input`.

One pure admission function decides the epoch window: given the request's attachable image references
in order and their descriptors, it returns which are attached. Request preparation calls it before the
pre-step compaction trigger (`evaluateCompactionTrigger`), so the trigger sees the same
not-attached result the request will carry; the step composer calls the same function on each step's
references. Because admission is oldest first and append-only, both calls agree on every reference
the earlier call saw. The conversion boundary (`buildContext`) keeps media references as stored and
maps none of them to bytes; the composer is the only place that emits image parts or placeholders.
The `context-injection` and `prompt-imports` requirements state the mapping for request assembly as
a whole, `buildContext` and the composer together, so their scenarios are verified on the composed
request, never on `buildContext` output alone.

One step composer builds every Run request and compaction request, including each step of a Run.
Title generation calls `generateText` directly (`generateToolBoundObject`,
`openai-model-client.ts:706-717`) and never reaches the composer; it receives the placeholder lines of
D9 instead. History conversion and
live tool outputs both carry no image bytes: a `read` image result's `toModelOutput` is its text
envelope with any `thumbnail` stripped. `ai@6.0.256` `streamText` pushes each tool output permanently
into its response messages and rebuilds every step as initial plus response messages
(`ai/dist/index.mjs:7723-7741`, `responseMessages.push` at `:8191`), so bytes returned there would
reach every later step whatever the epoch window decides; the composer adds image parts per step
instead.

The composer runs on every model request, whether or not it offers tools, as an always-installed
`prepareStep`: `ai@6.0.256` awaits `prepareStep` on every step with or without tools
(`ai/dist/index.mjs:7724`), while the client's `streamText` call is synchronous and cannot await
the resolver itself. `applyToolCallingOptions` returns early without tools
(`openai-model-client.ts:149`), so only the step cap and the `onStepStart` override stay gated on
tools; the composer runs on the final messages after that override, so the in-Run splice's recorded
prefix index (`in-run-context-items.ts:154`) is computed before any transform. It takes a media
resolver, built for each attempt, passed on `ModelStreamInput`, and loaded under the Run owner's
identity, that returns each `media://` reference's descriptor (name, original and variant
dimensions, variant byte size) and loads variant bytes on demand, and that also holds the attempt's memory of unstored
images (below). For each step:

- **Owner file parts.** Within one user message, the file parts are inserted in stored order
  immediately after the last context rail item (the temporal row included), or at the start of a
  message without one, every other part keeping its stored relative order. Each becomes a label text
  part `Image n (media://<id>):` followed by an image part from the model variant; `n` counts that
  message's attachments from 1.
- **Tool results.** A `read` image result becomes a tool output of type `content`: the text envelope
  plus an image part, built from the stored variant for a `media://` result and from the attempt's
  memory for every other image result.
- **Prompt imports.** An image entry in a `prompt-imports` item becomes an image part after the item's
  text, from the store for a `media://` entry and from the attempt's memory otherwise.
- **Attachment.** Each image reference takes exactly one form, in this order of precedence:

  - `[image media://<id> unavailable]` for a `media://` reference that does not resolve;
  - `[image <subject> <width>×<height>, omitted: this model has no image input]` for a model that
    does not declare `image`;
  - `[image <locator> <width>×<height>, not retained]` for an unstored image the attempt's memory
    holds no entry for, and, as a guard, for one the window attaches whose entry holds no bytes
    (unreachable in practice, because admission is append-only within an attempt, so a released
    entry is never attached again);
  - an image part when the epoch window (below) attaches it, the only case whose bytes are loaded;
  - `[image <subject> <width>×<height>, not attached: this context's image limit is reached]`
    otherwise.

  `<subject>` is `media://<id> <name>` for a stored object, with `name` its single-line source
  label, and the submitted locator for an unstored image: the `read` path the model gave, or the
  import marker's locator the owner wrote. That `<locator>` is a JSON string literal, exactly
  `JSON.stringify` of the locator with no further escapes (R2.4), and never truncated, for example
  `[image "app/[slug]/shot.png" 1600×900, not retained]`. The source-label
  rules would rewrite `[slug]` to `(slug)`, mangle `http://[::1]/x.png`, and cut long paths, so a
  re-read or a summary copying the placeholder would name a different file. The literal is one line,
  because `JSON.stringify` escapes LF, CR, and every other C0 control, and its closing quote bounds
  it, while `JSON.parse` returns the exact locator. The dimensions are the original's. No
  placeholder directs the model to read the image again: a compaction request, the step at the step
  cap, and a Run whose `tools.allowed` omits `read` cannot act on such a directive, and the `read`
  tool description already tells the model that an image read outside `media://` must be read again
  in a later turn. The not-retained form names the exact locator, so a model that can `read` re-reads
  it. `conversation_read` and title lines use the bare `[image media://<id> <name>]` form (D9),
  which states no cause; they render owner attachments only.

  Naming the cause follows the harnesses that handle non-vision models in source:

  | Harness                  | Placeholder                                                                 | Source                                                                                                                                                        |
  | ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Codex CLI                | `image content omitted because you do not support image input`              | [unsupported_media.rs](https://github.com/openai/codex/blob/89c8759d8c497b30629a2d67a51c163aa9ed3c44/codex-rs/core/src/context/unsupported_media.rs#L10-L14)  |
  | pi (`earendil-works/pi`) | `(image omitted: model does not support images)`, `(tool image omitted: …)` | [transform-messages.ts](https://github.com/earendil-works/pi/blob/eba849739511223c51a62bbd7e3f1c00f99fb1d0/packages/ai/src/api/transform-messages.ts#L12-L77) |
  | OpenClaw                 | same strings as pi                                                          | [transcript-transform.ts](https://github.com/openclaw/openclaw/blob/3e90389813229bd33c169fb07b883b567847224e/packages/ai/src/transcript-transform.ts#L19-L41) |
  | OMP                      | `[image omitted: model does not support vision]`                            | [vision-guard.ts](https://github.com/can1357/oh-my-pi/blob/5aafbec7a2f03c836fe2b938b3adfbbd46e8482e/packages/ai/src/providers/vision-guard.ts#L4-L43)         |

  None of them includes a locator the model can re-read; naming one is llame's addition.

- **Chat Completions wires.** On `openai-completions` and `opencode-go`, a tool output's image cannot
  travel in the tool message: the adapter would serialize it as text. A tool message whose image is
  sent as an image part (attached, vision model) keeps only its text envelope, or, if that would be
  empty, a line saying the image follows in the next message. The images of consecutive tool
  results follow in one synthetic user message headed `Images from tool results:`, as OMP does, each
  preceded by the label `Image from <toolName> <locator>:`, with `<locator>` the JSON string literal
  of the submitted locator, or of `media://<id>` for a `media://` read, so the model can tell which
  image answers which call (R2.15). Request-size estimates count the header and labels as text.
  Every other tool message keeps its placeholder.

**Attempt-scoped retention (R1.4).** The worker keeps an entry for every unstored image read or
imported in an attempt, keyed by tool call id or prompt-import entry, in that attempt's memory only,
and drops the memory when the attempt ends. Every attempt starts empty: a retry or a resume, on the
same worker or another, is a new attempt and shares nothing with the attempt it supersedes, even
while that one is still running in the same process. Keying by Run instead would let a same-process
retry attach what a retry on another worker cannot, so the request would depend on which worker
claimed the attempt; canonical per-attempt state already lives "only in the active attempt's
memory" (`tool-calling`).

An entry keeps the decoded model variant (bytes, byte size, media type, model width and height)
whenever the attempt's model declares `image` input, and otherwise only what its placeholder needs
(locator and original dimensions); holding it counts nothing (R2.3). The composer applies the epoch
window at every compose and releases the bytes of each unstored reference the window does not
attach, keeping the entry's locator, dimensions, and byte size. Admission is append-only within an
attempt and compaction never runs inside one, so a reference the window leaves unattached is never
attached later in that attempt and its bytes would buy nothing; the kept byte size lets every later
compose size it and refuse it again by the same rule, with no separate released state. Should the
window ever attach a reference whose entry holds no bytes, the composer sends the not-retained
placeholder instead. A prompt import is first composed in the attempt's first request, after any
compaction, so an import that triggered overflow compaction is admitted into the new epoch. After
each compose, the retained variants of one attempt are those the window attached, at most 24 MiB of
base64, however many steps it runs, although `maxSteps` defaults to no cap and several attempts
share one worker process.

A later turn, a new attempt, a compaction request, and a fork hold no entry, so a vision model gets
the not-retained placeholder there. A text-only model still gets the omitted form, which takes
precedence.

Composing from references every step is idempotent: the SDK hands `prepareStep` the untransformed
messages again on each step.

**Request-size estimate.** Every admission and compaction estimate leaves image bytes out, as it
already leaves out reasoning metadata, and charges each image reference `ceil(width × height / 750)`
tokens on its model variant's dimensions (Anthropic's documented formula; a 2000×1125 variant is
3,000 tokens). Placeholders count as their text. The estimators (`estimateProjectionTokens`,
`estimateContinuationTokens`, and the context-window fit check) receive the resolver's descriptor
map and the attempt's memory, because stored file parts and image envelopes do not carry variant
dimensions.

Stored parts never contain base64 model data; the only image data they hold is the display-only
`thumbnail` of an unstored image (D7). The 8,000/32,000 code-unit budgets measure a tool pair's text
only, without `thumbnail`; a `read` image result's text envelope fits well inside them, and its image
falls under the epoch window.

**Epoch window (Q22).** The window follows the rule llame already applies to frozen prompt state
("Compaction is the rail's re-baseline boundary", `context-injection`): it changes only when a
checkpoint is published. Within one compaction epoch (the rows after the active checkpoint, plus the
current attempt), attachable image references are attached oldest first in request order while both
bounds hold: at most 100 images and at most 24 MiB of summed base64 model variants. A variant's
base64 size is `4 × ceil(byteSize / 3)`, from the descriptor's `model.byteSize` for a stored object
and from the byte size the attempt-memory entry records for an unstored image (kept after its bytes
are released), so the sum is known before any bytes load; the dimension-based token estimate above
plays no part in it. Attachable means a resolvable `media://` reference or an unstored image whose
attempt-memory entry records a model-variant byte size; not-retained and unavailable references
never count. The first reference that would exceed either
bound, and every newer one in that epoch, is not attached. Admission is append-only, so a new turn
or a new step never changes whether an earlier image is attached, and the request prefix stays
byte-identical for provider prompt caching. Anthropic invalidates cached message blocks when images
are added or removed anywhere in the prompt
([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

R1 adds two exceptions, both at an attempt boundary: when an attempt ends, and when a new attempt
(a retry or a resume, on any worker) starts with empty memory, the unstored images an earlier
attempt held become not-retained in later requests and leave the window, and the references after
them are admitted again oldest first. The first request after the boundary misses the provider
cache from the first such image on, once, because the image itself leaves the prompt; every later
request is stable again.

Before a Run's first model step, a vision-model request with an unattached image and at least one
stored image in a row before the triggering user message counts as reaching the compaction
threshold, so it selects the threshold variant on the attempt's own model: the request fits, and
that variant is the cache-aligned continuation. An unstored image in an earlier row is never
attached and never counts. A request that also does not fit still selects the window variant. An
overflow-only compaction that fails or yields no usable summary does not fail the attempt; the attempt
proceeds and the overflowing images keep the limit placeholder. The trigger is re-evaluated before
every Run, so images left unattached are attached again by the next successful compaction. Absorbed
images survive as the locators the summary keeps, `media://` or source locator, and the model
re-reads them into the new epoch with `read`. Compaction never runs inside a Run, so an image read
past the bounds mid-Run stays unattached for that attempt and becomes not-retained in the next turn.
Overflow inside the triggering message alone (ten maximum-size images exceed 24 MiB) does not
compact, because compaction cannot absorb that message.

The count bound is 100, Anthropic's per-request limit for 200k-context models. Anthropic's
2000×2000 limit above 20 images per request is already met, because every model variant is at most
2000 px on its long edge. Both bounds are code constants (Q14).

Prior art for when images leave the request:

- OMP drops the oldest images on every request
  ([provider-image-budget.ts](https://github.com/can1357/oh-my-pi/blob/5aafbec7a2f03c836fe2b938b3adfbbd46e8482e/packages/coding-agent/src/session/provider-image-budget.ts#L21-L160)),
  which misses the cache on every request once over budget.
- Claude Code fixed the same symptom: "prompt-cache misses on every turn in long screenshot-heavy
  sessions once images exceeded the per-request size cap"
  ([CHANGELOG](https://github.com/anthropics/claude-code/blob/602df92bf481ed904533e95c09f740f40aab5aed/CHANGELOG.md#L2593)).
- OpenClaw advances its image cut only at user-turn boundaries, in batches of 8 turns, "to stop
  repeated image payloads ... busting prompt caches"
  ([session-pruning.md](https://github.com/openclaw/openclaw/blob/23b8ffe56805d966e4f6a17a2bc9bc94b82173cb/docs/concepts/session-pruning.md),
  [history-image-prune.ts](https://github.com/openclaw/openclaw/blob/23b8ffe56805d966e4f6a17a2bc9bc94b82173cb/src/agents/embedded-agent-runner/run/history-image-prune.ts#L19-L62)).
- pi and Codex never evict mid-session and leave images to compaction
  ([pi compaction.ts](https://github.com/earendil-works/pi/blob/eba849739511223c51a62bbd7e3f1c00f99fb1d0/packages/coding-agent/src/core/compaction/compaction.ts#L276-L335),
  [Codex compact.rs](https://github.com/openai/codex/blob/65b82cdf96f9d305494bc8c6c8d2404d37709030/codex-rs/core/src/compact.rs#L443-L560)).

A cut at compaction is the limit case of OpenClaw's batching: one rewrite per checkpoint, at a point
that already invalidates the cache.

### D7: Native `read` of images (Q5, Q8, R1.2, R1.3, R1.5)

Every native `read` locator that yields bytes may yield an image: host paths and `file:` aliases,
`kb://`, `skill://`, `http(s)://`, and `media://`. For a regular file (host, `kb://`, `skill://`),
the reader checks the magic bytes of the first bytes before UTF-8 decoding. On a match, the worker
prepares the image (D2) without storing it, keeps an entry in the attempt's memory (D6), and
returns an image result:

```json
{
  "status": "success",
  "kind": "image",
  "mediaType": "image/png",
  "width": 1600,
  "height": 900,
  "path": "<as today for the source>"
}
```

The envelope keeps the source's existing attribution (host `path`, Knowledge Space and notice, web
`finalUrl` and `method: "image"`). Its `mediaType`, `width`, and `height` describe the original. It
has no `media` field and no `media://` id. The image itself reaches the model through D6 in that
attempt only. A model without `image` input receives the same envelope plus the omitted placeholder
naming the read's locator.

The tool part stores the envelope plus a display-only `thumbnail` when one fits its cap (D2), which
`toModelOutput` and the replay envelope strip. It is excluded from the observation budgets and the
result truncation cap and is never accepted from a client. Shares and public forks already strip
tool parts, so no thumbnail leaves the owner.

A `media://` read is unchanged by R1: it stores nothing, returns the stored object with
`media: "media://<id>"`, carries no `thumbnail`, and replays from the store in later turns. It is
the only read whose image persists across turns.

Web reads also accept `image/png`, `image/jpeg`, `image/gif`, and `image/webp`, under the existing
5 MiB body bound, with magic bytes required to match an accepted image format. Other binary types,
PDF included, stay `unsupported_content_type`. Selectors on an image are `invalid_selector`; `:raw` on
a web image is equally refused.

Instruction-file triggers are unchanged: a host or `kb://` image read triggers its directory chain like
any read, and a `media://` read triggers nothing.

The 20 MiB refusal applies only to a file whose leading bytes match an image signature; a large file
matching no signature keeps the text path, which has no size ceiling. Bytes that match a signature
but cannot be decoded fail as `unsupported_media_type`.

Rejected: ingesting every read image into the store (the approved design). It grew each owner's
store with screenshots nobody uploaded, gave them ids that outlived their source, and needed
provenance, URL label stripping, and a system-read origin on `ToolContext` only to record where an
image came from.

### D8: Prompt-import images (Q9, R1.6, R2.2)

An admitted prompt-import target whose native `read` returns an image becomes an image entry in the same
`prompt-imports` item, followed in the request by the image part or placeholder from D6. Image entries
count toward the 8-target bound; their bytes and thumbnails do not count toward the 128 KiB output
bound, which measures the item's text. The entry body is the image result envelope native `read`
returns, so "Imported results equal native read output" holds unchanged.

A local, `kb://`, `skill://`, or web target is not stored. Its entry's private payload records the
original's `width`, `height`, and `mediaType`, which the lightbox caption needs and the payload
otherwise lacks, the display-only `thumbnail` when one fits its cap (D2), and no `media` key; the
importing attempt's memory keeps the image under that item entry, so the importing attempt attaches
it when the window admits it, and every later request, including a retry or resume as a new attempt
on any worker, gets the not-retained placeholder on a vision model and the omitted placeholder on a
text-only one. Recovery reuses the persisted entry without rereading, as for a text result. An
`@media://<id>` target records `media: "media://<id>"` alone instead and replays from the store in
every later turn.

The payload validator (`isPromptImportsPayloadEntry` in `apps/api/src/chats/prompt-imports-item.ts`,
an exact-key check) accepts two image forms: `width` and `height` (positive integers) and
`mediaType` (`image/png`, `image/jpeg`, `image/gif`, or `image/webp`), all three together, with or
without `thumbnail` (a `data:image/webp;base64,` URL within the 64 KiB cap); or `media` alone. The
web client's own exact-key check (`isPromptImportEntry` in `apps/web/lib/services/chat/history.ts`)
must accept the same forms, or the owner chip disappears for the whole item. The Migration Plan
states the rollback consequence for such items. The owner chip renders `thumbnail` directly, shows a
dimensions-only tile for an unstored entry without one, and loads a `media` entry from the `/model`
route. This delta ADDs six requirements to the `prompt-imports` capability: image entries, their
attempt-scoped model delivery, their private `thumbnail` or `media` payload record, its validation,
keeping it from the model, and `media://` as a prompt-import target. It does not restate that
capability's requirements.

### D9: Text-only projections (Q16, R2.5)

- `conversation_read` renders the message's visible text exactly as today, then one line per owner
  file part, `[image media://<id> <name>]`, with `<name>` the part's stored `filename` passed
  through the source-label rules. The line comes from the stored part alone: no media lookup, no
  dimensions, and no unavailable form, so it discloses nothing beyond the owner's own part. Search
  line coordinates are unaffected because search indexes only the text that precedes those lines.
- Title generation receives the same lines after the titled turn's message text (the existing path
  titles from the Run's triggering message, `run-execution.service.ts:3607`), so an image-only prompt
  can still be titled.
- Compaction sends the prepared prefix exactly as the Run would (D6, projected for the compaction
  model's own `input`), so unstored images in the prefix appear as their not-retained or omitted
  placeholder. The summarization instruction tells the summarizer to keep every image locator it
  mentions, `media://` or source locator, so a later turn can re-read an image after its message is
  absorbed. That rule defers to the instruction's existing redaction rule, which already states that
  redaction takes precedence over verbatim quoting: a credential in a locator, such as a URL's
  `?token=secret`, is written `[REDACTED]`. An unstored image's locator passes through no
  source-label sanitizing (R1 stores no read image, so `media-store`'s URL-label rule went with
  them), so this redaction is the only guard keeping such a secret out of the durable summary.
- Search indexes nothing from images; the recency digest keeps its rule that a first message without
  text renders no excerpt; public shares and shared forks omit file parts and keep text.

### D10: Composer and message thumbnails (Q19, R2.8, R2.9)

Inside the existing input card, above the textarea, a row of square `rounded-xl` thumbnails; the
composer, toolbar, and bubble designs are otherwise unchanged. Paste (Ctrl/Cmd+V with image clipboard
items), the file picker, and drag-and-drop all upload immediately through `POST /api/v1/media`.

- **Upload states.** A thumbnail shows a progress overlay while uploading, and an error overlay with
  retry when the upload fails. Send stays disabled while any upload is in flight.
- **Remove.** Remove (`×`) appears on hover and focus. Thumbnails keep the order they were added in;
  there is no reordering. At most 10 per message.
- **Text-only model.** The attach picker is disabled, and a pasted or dropped image is refused with
  the app's existing `toast()`: "`<model label>` has no image input". Thumbnails already attached
  stay, and send stays disabled, with the same reason inline, until a vision model is selected or the
  images are removed.
- **Sent messages.** The same thumbnails appear read-only above the user bubble, loaded from the
  `/model` route as `<img loading="lazy">`.

### D11: Lightbox (Q10, Q20, Q21, R1.7, R2.6, R2.7, R2.13, R2.14)

A wide variant of the existing shadcn `Dialog` (`packages/ui/src/components/dialog.tsx`, with its
`DialogContent` and `DialogOverlay`), sized to the image at about `max-w-[90vw] max-h-[90vh]`, the
image `object-contain`. The dialog brings focus trapping, the close button, and `Escape` with focus
return; ghost icon `Button`s move to the previous and next slide, as do `ArrowLeft` and
`ArrowRight`; the caption sits under the image. Zoom is a toggle, by clicking the image or a button,
between fit and natural size; at natural size the panel scrolls natively to pan. The image stays
centred and is never enlarged, and an image whose natural size already fits offers no toggle (an
unstored read's thumbnail always fits).

- **Slides.** The images of the clicked row only: a message's attachments, a `read` result's image,
  a prompt-import chip's image entries, or the composer's uploaded thumbnails. A composer thumbnail
  that is uploading or failed, and an unstored image without a `thumbnail` (a dimensions-only tile),
  do not open it.
- **One source per slide.** A stored image loads `/api/v1/media/<id>/original`; an unstored image
  shows its inline `thumbnail`. There is no variant toggle and no descriptor fetch; the descriptor
  route itself stays.
- **Caption.** `W×H FORMAT · <locator>` where the row already has the original's dimensions and
  format without a fetch: a `read` result, an unstored import entry's payload, or a composer
  thumbnail's upload descriptor. Sent attachments and `media://` import entries show `media://<id>`
  alone. An unstored image's locator is, as plain text, the one its placeholders name, the one the
  model submitted to `read` (the tool call's input) or the owner wrote in the import marker (the
  payload entry's `locator`), not the result's resolved `path`. The read tool card and the
  prompt-import chip render the same `thumbnail` as `<img src="data:...">`.
- **No provenance.** No caption shows a provenance (R1.1).

Rejected: `yet-another-react-lightbox` (the approved design), whose chat-wide gallery needed
occurrence parsing, a chat-level lightbox context, and per-image descriptor fetches for a variant
toggle; the shared `Dialog` covers one row's images with no new dependency.

## Risks / Trade-offs

- [No deletion path] A pasted secret stays stored and re-readable through `media://` → recorded as a
  known gap in the proposal and the operator docs; the library issue owns the delete action. R1
  limits the gap to owner uploads: read and imported images are never stored.
- [Unstored images leave the prompt after their Run] A later turn sees a read image only as the
  not-retained placeholder, and the first request after the Run misses the provider cache from that
  image on → the placeholder names the exact locator, and the `read` tool description tells the
  model to read such an image again, which attaches it in that Run; an image the owner wants kept
  is uploaded instead.
- [Thumbnails in stored parts] Each unstored image adds up to 64 KiB of data URL to its tool part or
  prompt-import payload, and again to the `tool.completed` run event's copy → capped, omitted
  rather than degraded when over the cap, excluded from every model budget, and stripped from every
  model request.
- [Database growth] Originals up to 20 MiB live in Postgres and `pg_dump` grows with them → the
  metadata/blob split makes a later object-storage move a data migration with no part rewrite; the
  operator runbook states the growth and backup cost.
- [Request size] Text, tool output, and 24 MiB of images can still exceed a provider's request ceiling
  on another provider with a lower limit → a provider rejection surfaces under the existing failure
  contract, and both window bounds are code constants that can drop without a migration.
- [Native dependency] `sharp` ships prebuilt libvips binaries for glibc and musl x64/arm64 → the
  production image (#116) must use a supported libc; CI exercises ingest on the runner image.
- [Decompression bombs] → header-only dimension check against 40 MP before decode, and `sharp`'s
  `limitInputPixels`.
- [Stored XSS through previews] → magic-byte allowlist excludes SVG and HTML; bytes are served with
  `nosniff`, `sandbox`, and the stored type only.
- [Wrong vision declaration] A model declared `image` that rejects images fails its Run with the
  provider's error → documented in the runbook; the declaration is per entry.
- [Concurrent changes] `tool-search` and `knowledge-submit` modify `tool-calling` and
  `tool-call-permissions` requirements this change also modifies → whichever finalizes second rebases its
  MODIFIED blocks onto the synced text.
- [Instruction and skill imports of images] Instruction-file imports page with `:raw:N-M` and skill
  package-local imports read with `:raw`, so an `@diagram.png` marker in `AGENTS.md` or `SKILL.md`
  hits the image selector refusal and is reported `failed` without decoding → recorded as deliberate:
  those imports stay text-only, and images reach the model through prompt imports, attachments, or
  `read`.

## Migration Plan

- One Drizzle migration adds both tables with `pgPolicy` owner policies and a hand-appended
  `FORCE ROW LEVEL SECURITY`; owner-keyed tables need no `db:provision-rls` change, which only owns
  cross-tenant SECURITY DEFINER functions; it touches no existing table.
- A rollback to a build without this change keeps stored `file` parts that the old conversion
  boundary does not map (`userPartsToModelContent` in `apps/api/src/chats/context-builder.ts` emits
  only text and context parts), so the model silently stops seeing those images while the tables
  remain.
- A rollback also degrades `prompt-imports` items that carry an image entry. The old exact-key
  validator rejects the whole payload on its `thumbnail`, `width`, `height`, `mediaType`, or
  `media` key, and `PromptImportPartsRepository.findForRun` keeps it as `undefined`
  (`apps/api/src/chats/prompt-import-parts.repository.ts:57-59`). The item text still replays, but
  every derived state of that item is lost, including `derivePromptImportTriggers`. The
  instruction-file loads for the text imports in the same item are therefore skipped on recovery.
- Dropping the tables loses every stored image and is a separate, deliberate step.
- Existing configs keep working: `input` is optional and defaults to text-only.
- `sharp` adds a native dependency to the API image.

## Open Questions

None.

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
- No blob, upload, or object-storage code exists; `messages.attachments` is an unused JSONB column
  (`apps/api/src/db/schema/chats.ts:237-241`). The API and a dedicated worker share Postgres and no
  filesystem except Knowledge mounts (`docs/product/operator/scaling.md:10-21,121-127`).
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

**Goals:** one owner-scoped media store that every image path writes to and every replay reads from; one
locator, `media://<id>`, the model and the owner both use; provider image parts built at request time
from stored variants, never stored base64.

**Non-Goals:** object storage, deletion, a media library view, PDF/audio/video, SVG rasterization
(#1160), public-share media, per-provider image re-encoding beyond one model variant.

## Decisions

### D1: Postgres metadata and blob tables under RLS (Q1)

`media_objects` holds one row per owner image: id (UUIDv7), owner id, detected format, original byte
size and dimensions, model-variant format, byte size, and dimensions, SHA-256 of the original,
provenance (`upload`, `read`, `prompt-import`), a source label (upload filename or source locator,
neutralized, at most 256 characters), and creation time. `media_blobs` holds `(media_id, variant)` →
`bytea` for `original` and `model`. Both tables use enabled, forced RLS keyed on the authenticated owner,
like every tenant table. The metadata/blob split lets a later object-storage move replace only
`media_blobs` rows without changing any stored part.

Rejected: a local uploads directory (needs a new shared mount across API and worker, and moves isolation
from the datastore into path checks); S3-compatible storage now (new required infrastructure for every
self-hoster and the E2E harness); a pluggable interface (one implementation today).

Dedup: a new image whose original SHA-256 matches an existing row of the same owner reuses that row, so
re-reading or re-pasting the same image yields the same `media://` id. Dedup never crosses owners: a
cross-owner match would reveal that another owner holds the image.

### D2: Ingest with `sharp`; original plus one model variant (Q2, Q3, Q14, Q15)

`sharp` (libvips) is added to `apps/api`. Ingest, shared by upload, read, and prompt import:

1. Refuse inputs over 20 MiB before decoding.
2. Detect the format by magic bytes; accept PNG, JPEG, GIF, WebP; everything else, including SVG, is
   `unsupported_media_type`. Declared names, extensions, and Content-Type never decide the format.
3. Read dimensions from the header and refuse above 40 megapixels before a full decode
   (`limitInputPixels`).
4. Store the original bytes unchanged.
5. Build the model variant: apply EXIF orientation, strip metadata, take the first frame of an animated
   GIF or WebP, scale so the long edge is at most 2000 px, encode PNG; if that exceeds 3.75 MiB, encode
   JPEG quality 85; if that still exceeds 3.75 MiB, scale down by 0.75 steps until it fits.
6. Do the decoding and encoding above before opening a transaction, then write the metadata row and
   both blobs in one short transaction. A pooled connection (`db.poolSize`, default 10) is never held
   across `sharp` work.

The original keeps its EXIF, because it is only ever served to its owner; only the model variant leaves
llame. Bounds are code constants; no deployment needs different values yet (Q14).

### D3: Upload first, owner-owned media, no deletion (Q6, Q7, Q13, Q17, Q18)

- `POST /api/v1/media` accepts one `multipart/form-data` file per request, ingests it, and returns the
  media descriptor: `id`, `locator`, `provenance`, `mediaType`, `name`, `width`, `height`, `byteSize`,
  and a `model` object with the variant's `mediaType`, `width`, `height`, `byteSize`. The route uses
  Nest's `FileInterceptor` (multer 2.2.0 already ships with `@nestjs/platform-express`) with
  `limits.fileSize` at 20 MiB; `@types/multer` is added as a dev dependency. Multer's `LIMIT_FILE_SIZE`
  surfaces as Nest's generic `PayloadTooLargeException`, so the route maps it to `413` with the
  `image_too_large` body every other ingest refusal uses. Multer keeps the file in memory; at most
  20 MiB per concurrent upload is the same per-request bound ingest already holds. The JSON body limit
  is unchanged.
- `GET /api/v1/media/:id` returns the descriptor; `GET /api/v1/media/:id/original` and `/model` return
  bytes with the stored type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`,
  `Content-Security-Policy: sandbox`, and `Cache-Control: private, max-age=31536000, immutable`
  (content under an id never changes). Another owner's id, or an unknown id, is `404`.
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

### D6: Model input and replay (Q4, Q5, Q8)

`models[].input` is an optional array over the closed set `text`, `image`; it must contain `text` and no
duplicates. Absent means `["text"]`. `GET /api/v1/models` always publishes `input`.

One step composer builds every model request, including each step of a Run. History conversion and
live tool outputs both carry media references only: a `read` image result's `toModelOutput` is its
text envelope, never bytes. `ai@6.0.256` `streamText` pushes each tool output permanently into its
response messages and rebuilds every step as initial plus response messages
(`ai/dist/index.mjs:7723-7741`, `responseMessages.push` at `:8191`), so bytes returned there would
stay in worker memory for the whole Run while only 20 images are ever sent.

The composer runs on every model request, whether or not it offers tools. With tools, it runs in the
clients' shared `prepareStep` composition, on the final messages after the `onStepStart` override
that in-Run context items use, so that splice's recorded prefix index (`in-run-context-items.ts:154`)
is computed before any transform. Without tools (the default `tools.allowed: []`, and compaction
when no tool declarations exist), `applyToolCallingOptions` returns before installing `prepareStep`
(`openai-model-client.ts:145-149`), so the composer is applied once to the initial messages before
`streamText`. It takes a per-Run media resolver, passed on `ModelStreamInput` and loaded under the
Run owner's identity, that returns each reference's descriptor (name, original and variant
dimensions) and loads variant bytes on demand. For each step:

- **Owner file parts.** Within one user message, after context rail items and the temporal row and
  before the owner's text, each file part becomes a label text part `Image n (media://<id>):` followed
  by an image part from the model variant; `n` counts that message's attachments from 1.
- **Tool results.** A `read` image result becomes a tool output of type `content`: the text envelope
  plus an image part.
- **Prompt imports.** An image entry in a `prompt-imports` item becomes an image part after the item's
  text.
- **Window.** Only image references inside the image window (below) become image parts, and only their
  bytes are loaded. Older ones, and every image when the request's model does not declare `image`,
  become the placeholder `[image media://<id> <name> <width>×<height>]`, with `name` the neutralized
  source label and the original's dimensions.
- **Chat Completions wires.** On `openai-completions` and `opencode-go`, a tool output's image cannot
  travel in the tool message: the adapter would serialize it as text. The tool message carries its text
  and the line `(image attached below)`, and the images of consecutive tool results follow in one
  synthetic user message `Images from tool results:`, as OMP does.

Composing from references every step is idempotent: the SDK hands `prepareStep` the untransformed
messages again on each step.

**Request-size estimate.** Every admission and compaction estimate leaves image bytes out, as it
already leaves out reasoning metadata, and charges each image reference `ceil(width × height / 750)`
tokens on its model variant's dimensions (Anthropic's documented formula; a 2000×1125 variant is
3,000 tokens). Placeholders count as their text. The estimators (`estimateProjectionTokens`,
`estimateContinuationTokens`, and the context-window fit check) receive the resolver's descriptor
map, because stored file parts and image envelopes do not carry variant dimensions.

Stored parts never contain base64. The 8,000/32,000 code-unit budgets measure a tool pair's text
only; a `read` image result's text envelope fits well inside them, and its image falls under the
image window.

The window takes image references newest first while both bounds hold: at most 20 images, matching
Anthropic's tighter-dimension threshold, and at most 24 MiB of summed base64 model variants, leaving
headroom under Anthropic's 32 MB request limit for text. The first reference that would exceed either
bound, and every older one, is a placeholder. Both bounds are code constants (Q14).

### D7: Native `read` of images (Q5, Q8)

Every native `read` locator that yields bytes may yield an image: host paths and `file:` aliases,
`kb://`, `skill://`, `http(s)://`, and `media://`. For a regular file (host, `kb://`, `skill://`),
the reader checks the magic bytes of the first bytes before UTF-8 decoding. On a match, it ingests
the file (D2) with provenance `prompt-import` when the read's system origin is `prompt-import` and
`read` otherwise, and the requesting locator as source label, then returns an image result:

```json
{
  "status": "success",
  "kind": "image",
  "media": "media://<id>",
  "mediaType": "image/png",
  "width": 1600,
  "height": 900,
  "path": "<as today for the source>"
}
```

The envelope keeps the source's existing attribution (host `path`, Knowledge Space and notice, web
`finalUrl` and `method: "image"`). The image itself reaches the model through D6. A model without
`image` input receives the same envelope plus the placeholder, and the model still knows the id.

Web reads also accept `image/png`, `image/jpeg`, `image/gif`, and `image/webp`, under the existing
5 MiB body bound, with magic bytes required to match an accepted image format. Other binary types,
PDF included, stay `unsupported_content_type`. Selectors on an image are `invalid_selector`; `:raw` on
a web image is equally refused. A `media://` read ingests nothing and returns the stored object.

Instruction-file triggers are unchanged: a host or `kb://` image read triggers its directory chain like
any read, and a `media://` read triggers nothing.

The 20 MiB refusal applies only to a file whose leading bytes match an image signature; a large file
matching no signature keeps the text path, which has no size ceiling.

### D8: Prompt-import images (Q9)

An admitted prompt-import target whose native `read` returns an image becomes an image entry in the same
`prompt-imports` item, followed in the request by the image part or placeholder from D6. Image entries
count toward the 8-target bound; their bytes do not count toward the
128 KiB output bound, which measures the item's text. Recovery reuses the persisted media id like a
persisted text result. The entry's private payload records `media: "media://<id>"`, which is
where the conversion boundary and the owner chip find the image; the payload validator
(`isPromptImportsPayloadEntry` in `apps/api/src/chats/prompt-imports-item.ts`, an exact-key check)
accepts that key, and a rollback build drops items carrying it from derived state. Provenance
`prompt-import` needs the system-read origin on `ToolContext`, which today reaches only the audit
callbacks. The entry body is the image result envelope native `read` returns, so
"Imported results equal native read output" holds unchanged. This delta ADDs three requirements to the
`prompt-imports` capability: image entries, their private `media` payload field, and `media://` as
a prompt-import target. It does not restate that capability's requirements.

### D9: Text-only projections (Q16)

- `conversation_read` renders the message's visible text exactly as today, then one line per media
  reference, `[image media://<id> <name> <width>×<height>]`. Search line coordinates are unaffected
  because search indexes only the text that precedes those lines.
- Title generation receives the same placeholder lines after the first message's text, so an image-only
  prompt can still be titled.
- Compaction sends the prepared prefix exactly as the Run would (D6, projected for the compaction
  model's own `input`). The summarization instruction tells the summarizer to keep every `media://`
  locator it mentions, so a later turn can re-read an image after its message is absorbed.
- Search indexes nothing from images; the recency digest keeps its rule that a first message without
  text renders no excerpt; public shares and shared forks omit file parts and keep text.

### D10: Composer and message thumbnails (Q19)

Inside the existing input card, above the textarea, a row of square `rounded-xl` thumbnails; the
composer, toolbar, and bubble designs are otherwise unchanged. Paste (Ctrl/Cmd+V with image clipboard
items), the file picker, and drag-and-drop all upload immediately through `POST /api/v1/media`.

- **Upload states.** A thumbnail shows a progress overlay while uploading, and an error overlay with
  retry when the upload fails. Send stays disabled while any upload is in flight.
- **Remove and reorder.** Remove (`×`) appears on hover and focus. Thumbnails reorder by drag, or with
  `Alt+←/→` when focused. At most 10 per message.
- **Text-only model.** Attaching is blocked with the message "`<model label>` has no image input".
  Thumbnails already attached keep their order, and send stays disabled until a vision model is
  selected or the images are removed.
- **Sent messages.** The same thumbnails appear read-only above the user bubble, loaded from the
  `/model` route as `<img loading="lazy">`.

### D11: Lightbox (Q10, Q20, Q21)

`yet-another-react-lightbox` with its Zoom plugin, wrapped once in `packages/ui` and themed with
semantic tokens. It is MIT-licensed and handles pinch zoom, keyboard navigation, swipe, and focus
trapping. Its Zoom plugin defaults do not meet the requirement: `scrollToZoom` is `false` (a plain
wheel pans) and `maxZoomPixelRatio` is `1` (an image already at natural size cannot zoom). The wrapper
sets `scrollToZoom: true` and `maxZoomPixelRatio: 8`. Clicking any thumbnail opens it.

- **Slides.** Every image in the chat in transcript order: owner attachments, images returned by `read`
  (the read tool card shows a thumbnail), and prompt-import images. Arrow keys move between them.
- **Composer.** Opened from the composer, the lightbox spans the unsent thumbnails only.
- **Variant toggle.** A segmented control switches between `original` and `model`.
- **Caption.** It shows the variant's dimensions and format, the provenance, and the `media://`
  locator.

Rejected: a hand-built viewer on the Base UI Dialog with `react-zoom-pan-pinch`, which would rebuild
navigation, preloading, and zoom reset.

## Risks / Trade-offs

- [No deletion path] A pasted secret stays stored and re-readable through `media://` → recorded as a
  known gap in the proposal and the operator docs; the library issue owns the delete action.
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
  hits the image selector refusal and is reported `failed` without ingest → recorded as deliberate:
  those imports stay text-only, and images reach the model through prompt imports, attachments, or
  `read`.

## Migration Plan

- One Drizzle migration adds both tables, their RLS policies, and the provisioning grants; it touches no
  existing table. A rollback to a build without this change leaves stored `file` parts that the old
  conversion boundary does not map (`userPartsToModelContent` in `apps/api/src/chats/context-builder.ts`
  emits only text and context parts), so the model silently stops seeing those images while the tables
  remain. Dropping the tables loses every stored image and is a separate, deliberate step.
- Existing configs keep working: `input` is optional and defaults to text-only.
- `sharp` adds a native dependency to the API image.

## Open Questions

None.

## Why

llame is text-only at every image boundary. `read` refuses a PNG (`invalid_utf8` on host and `kb://`,
`unsupported_content_type` on the web). The composer cannot attach a screenshot, and no model declares
that it accepts images. Screenshots, diagrams, and design exports are what a coding assistant is
handed most often ([#935](https://github.com/leon0399/llame/issues/935)).

## What Changes

- **Media store.** A Postgres-backed, owner-owned store keeps each image's original and one model
  variant. Ingest uses `sharp`: magic-byte format detection, a 20 MiB and 40-megapixel ceiling, EXIF
  orientation and stripping, and a downscaled model variant. Each object has a `media://<uuidv7>`
  locator, and identical bytes from the same owner reuse one object.
- **Owner media routes.** `POST /api/v1/media` uploads one image. `GET /api/v1/media/:id`, `/original`,
  and `/model` return the descriptor and bytes with `nosniff` and `sandbox` headers.
- **Owner attachments.** Messages accept up to 10 AI SDK `file` parts referencing the sender's own
  media. A message with images and no text is valid. The model receives the images before the text,
  labelled `Image n (media://<id>):`.
- **Model input declaration.** `models[].input` (`["text"]` or `["text", "image"]`, default text-only)
  is published by `GET /api/v1/models`.
- **Image window and placeholders.**
  - The newest images in the request, up to 20 and 24 MiB of base64, are sent as provider image
    parts. The window applies to history and is re-applied at every step of a Run.
  - Every image sent to a model without `image` input becomes
    `[image media://<id> <name> <w>×<h>, omitted: this model has no image input]`.
  - For a vision model, older images outside the window become
    `[image media://<id> <name> <w>×<h>, not attached; read the locator to view it]` when the step
    offers `read`, and the model can re-read them. Steps without `read` (compaction, an empty
    `tools.allowed`, the step-cap final step) get `[image media://<id> <name> <w>×<h>, not
attached]`.
  - Admission and compaction estimates charge each image `ceil(width × height / 750)` tokens on its
    model variant instead of counting its base64.
- **Native `read` of images.** Host paths, `file:`, `kb://`, `skill://`, `http(s)://`, and the new
  `media://` scheme can return PNG, JPEG, GIF, and WebP images:
  - The result is a typed image envelope, and the image reaches the model as tool-result content.
  - On Chat Completions wires, tool-result images move into a following user message.
  - Web reads accept those four image types and still refuse PDF and other binary types.
- **Prompt imports.** An image target of a prompt import marker becomes an
  image entry in the `prompt-imports` item.
- **Text projections.**
  - `conversation_read` and title generation append image placeholders.
  - Compaction keeps `media://` locators in its summary.
  - Search, the recency digest, and public shares stay text-only.
- **Web composer.** Paste, the file picker, and drag-and-drop add thumbnails inside the input card. Each
  thumbnail shows upload progress and offers retry, remove, and reorder. Attaching is blocked while a
  text-only model is selected.
- **Sent messages and lightbox.** Sent messages show the thumbnails above the bubble. A lightbox
  (`yet-another-react-lightbox`) opens any image in the chat, with zoom, arrow navigation, and an
  original/model-variant toggle.

No breaking configuration or API change: `input` is optional and the message DTO only widens.

## Assumptions, confirmed with Leo

From the 2026-10-08 design session, Q1–Q21, recorded on
[#935](https://github.com/leon0399/llame/issues/935#issuecomment-6068004247):

- Postgres metadata plus `bytea` blobs under RLS (Q1).
- Original plus one model variant, built with `sharp` (Q2, Q3).
- Explicit `models[].input`, text-only by default (Q4).
- Placeholders for non-vision models; the composer blocks attaching (Q5).
- Upload first, then reference the id (Q6).
- Media is owned by the owner, and forks reuse ids (Q7).
- A bounded image window with re-readable placeholders (Q8).
- Image entries inside the `prompt-imports` item (Q9).
- A chat-wide lightbox that includes images the model read (Q10).
- A flat `media://<uuidv7>` locator (Q11).
- Message-level attachments sent before the text (Q12).
- No deletion of any kind: no automatic collection (Q13), no delete action until the library ships
  (Q17), and unsent uploads kept (Q18).
- Bounds are code constants (Q14).
- Images only (Q15).
- Image-only prompts and text-only projections (Q16).
- Thumbnail tiles in the existing composer and above the bubble, with reorder, paste, picker, and drop
  (Q19).
- `yet-another-react-lightbox` (Q20) with a variant toggle (Q21).

Not asked directly, and following from those decisions:

- Identical bytes from one owner reuse one media object; dedup never crosses owners (D1).
- The original keeps its EXIF because only its owner can fetch it; the model variant is stripped (D2).
- `skill://` images are readable like any other read locator. A `media://` read takes no selector, and
  any selector on an image is `invalid_selector` (D4, D7).
- The image window also stops at 24 MiB of base64 so 20 large images stay under Anthropic's 32 MB
  request limit, and it is re-applied to every step's messages, because live tool results never cross
  the history conversion boundary (D6).
- Request-size estimates use Anthropic's `width × height / 750` image formula for every wire, because
  the current characters/4 estimate would count one screenshot's base64 as hundreds of thousands of
  tokens (D6).
- On `openai-completions` and `opencode-go`, tool-result images travel in a synthetic user message after
  the tool messages, because that adapter serializes tool content as text (D6).
- Web image bodies keep the existing 5 MiB body bound rather than the 20 MiB upload bound (D7).
- `conversation_read` appends placeholders after the message text, so search line coordinates do not
  move. Compaction sends images as the Run would and asks the summarizer to keep `media://` locators
  (D9).

Known gap: nothing can delete an image. A pasted secret stays stored and readable through `media://`
until the library ships a delete action.

## Capabilities

### New Capabilities

- `media-store`: the owner media object, ingest bounds and formats, the model variant, dedup, the upload
  and fetch routes, the `media://` grammar and its owner-only resolution, retention without deletion,
  and tenant isolation.
- `media-attachments`: owner `file` parts on messages, image-only messages, the model projection
  (ordering, labels, image window, placeholders, Chat Completions transport), text-only projections,
  the composer thumbnails, sent-message thumbnails, and the lightbox.

### Modified Capabilities

- `native-file-tools`:
  - ADDED requirements: image reads (result, leading-byte detection, ingest, ingest refusals) and
    `media://` locators
    (owner resolution, routing before local path resolution, read-only with no selector).
  - "Read selectors and context are deterministic" refuses selectors on images.
  - "Read representations are selected by media type and member" places image detection outside the
    representation table.
  - "Web reads accept text bodies only" is RENAMED to "Web reads accept text and image bodies" and
    admits the four image types.
  - "Web read results carry the final URL and retrieval method" adds `method: "image"` and the image
    envelope.
  - "Knowledge locators resolve through trusted owner authority" carries the Knowledge notice on image
    results.
  - The scheme lists in "Native tools operate on absolute local regular files" stay unchanged; the
    ADDED routing requirement makes `media://` a recognized scheme.
- `knowledge-tools`: "Knowledge content is untrusted and potentially stale" covers image results, which
  are not `edit` targets.
- `tool-calling`:
  - "Tool observations survive into later turns as stored UI parts" measures text only and defers images
    to the image window.
  - "Tool failure is an observation, not a crash" never truncates an image reference.
  - "Tool registry with mandatory safety classification" adds owner media authority.
- `tool-call-permissions`:
  - "File permission matching uses logical resource locators" leaves `media://` unchanged by
    projection and matches it in its canonical form.
  - "Recommended portable policy with explicit replacement" adds `^media://` to the restricted-read
    example.
- `workspace-entry`: "Relative filesystem paths share one Workspace projection rule" names `media://`
  among unchanged locators.
- `instance-config`: "Model catalog configuration" adds `input`.
- `available-models`: "Available model entries use opaque ids and rich display metadata" adds `input`
  to the required fields with its `["text"]` default; ADDED "Available model entries publish their input
  modalities".
- `context-injection`:
  - "Stored parts cross a minimal SDK conversion boundary" maps file parts and image results.
  - "Every item declares metadata and persists its final model-facing text" lets a message with a
    surviving file part pass the service-level check.
- `temporal-anchor`: "Only the system may author a temporal row" rejects a message only when neither
  user text nor a file part remains.
- `conversation-reads`:
  - "Visible message text is deterministic and message-scoped" appends image placeholder lines after
    the text, outside the view search indexes.
  - "Conversation reads use Knowledge-style logical-line ranges" keeps those lines out of every line
    bound and offset.
- `model-system-prompts`:
  - "A model switch replaces the top-level prompt and preserves portable history" carries images and
    placeholders across switches.
- `media-attachments` also owns an ADDED compaction rule: the compaction request carries images as the
  summarizing model's projection would, and the instruction keeps `media://` locators. The compaction
  requirement in `model-system-prompts` stays unchanged, because its prefix already follows the
  conversion boundary.
- `owner-chat-forks`: "A shared or public fork receives no checkpoint row" omits file parts from shared
  and public forks.
- `prompt-imports`: ADDED "Image targets import as image entries", "Image entries record their media
  locator privately", and "Media locators are prompt-import targets".

Deliberately unchanged:

- `chat-recency-digest`: a first message without text still renders no excerpt.
- `instruction-files`: image reads trigger chains like any host or `kb://` read; `media://` triggers
  none. An instruction import of an image is read with `:raw:N-M`, so it is refused by the image
  selector rule and reported `failed` without ingest.
- `agent-skills`: a package-local import of an image is read with `:raw` and likewise reported
  `failed`; skill imports stay text-only.
- `tool-call-permissions` "Match submitted string values without serialization artifacts": its list of
  locators unchanged by Workspace projection is not exhaustive, and the modified matching requirement
  covers `media://`.
- `search-projection` and `chat-search`: attachments already never enter the index.
- `permission-modes` and `durable-runs`: no rule names message part types.

## Impact

- `apps/api/src/db`: `media_objects` and `media_blobs` schema and one migration with owner RLS policies.
- `apps/api/src/media` (new): ingest, routes, and the `media://` resolver.
- `apps/api/src/chats`: DTO, loop validation, conversion boundary, tool observation replay.
- `apps/api/src/tools`: native read, web read, and `media://` dispatch.
- `apps/api/src/models`: the Chat Completions tool-image transform.
- `apps/api/src/instance-config`: `models[].input`, schema, and example.
- `apps/api/src/compaction` and the title job.
- `packages/native-file-tools`: magic-byte check before UTF-8 decoding.
- `apps/web`: composer, chat rows, the read tool card, and lightbox wiring.
- `packages/ui`: thumbnail and lightbox components and their stories.
- Dependencies: `sharp` (API), `@types/multer` (API dev; multer itself already ships with
  `@nestjs/platform-express`), and `yet-another-react-lightbox` (UI).
- Tests that pin old behavior:
  - text-only DTO tests and the "Message must contain a text part" test;
  - the web `image/png` refusal test;
  - tool-observation text replay tests.
- Docs:
  - a new operator runbook `docs/product/operator/media.md`;
  - reference pages for `read` image results and `media://`;
  - `README.md`, `SPEC.md`, dated `CHANGELOG.md` entries;
  - the read tool prompt (`apps/api/src/prompts/tools/read.md` says images are refused).

## Non-Goals

- Deleting media, a media library view, or listing `media://`.
- Object storage, local upload directories, or a storage interface.
- PDF, audio, and video input.
- SVG rasterization ([#1160](https://github.com/leon0399/llame/issues/1160)); SVG is refused at upload
  and read as text.
- Media in public shares or shared forks.
- Image generation and model-produced images.
- Delegated image questions (#849).

## Acceptance

- With a vision model selected, a pasted screenshot shows as a thumbnail, uploads, and is described by
  the model. It survives reload, retry, and fork.
- `read` of a PNG on the host, in Knowledge, behind an `https://` URL, and at `media://<id>` returns the
  image to a vision model on each provider wire. On Chat Completions wires the image arrives as an image
  part, not base64 text.
- With a text-only model selected, the composer blocks attaching. The same chat's earlier images replay
  as placeholders, and the model can name their `media://` ids.
- A prompt import of `@/path/to/shot.png` delivers the image inside the `prompt-imports` item.
- Clicking any thumbnail opens the lightbox. Wheel and pinch zoom work, arrow keys move across every
  image in the chat, and the toggle shows the model variant.
- Another owner's media id is `404` on every route, `not_found` through `read`, and rejected in a
  message, enforced by RLS with a negative isolation test.
- An SVG, an HTML file renamed `.png`, a 41-megapixel image, and a 21 MiB file are refused at upload. At
  read, the first two return text and the last two fail with `image_too_large`.
- A Run that reads more images than the image window sends the oldest as placeholders on its next
  step, and one maximum-size screenshot is admitted on a 200k-token model without compaction.

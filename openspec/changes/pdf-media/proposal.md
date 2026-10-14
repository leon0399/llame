## Why

llame refuses every PDF:

- `read` of a local PDF fails `invalid_utf8`;
- a web PDF fails `unsupported_content_type`;
- an upload is refused as `unsupported_media_type`.

Papers, specifications, invoices, and datasheets are what an owner hands an assistant after
screenshots, and every adapter llame already ships accepts a native PDF part
([#1275](https://github.com/leon0399/llame/issues/1275); web UI in
[#1277](https://github.com/leon0399/llame/issues/1277)).

This change carries the image path shipped by `vision-media` over to PDFs. The decisions come
from a grilling round with Leo on 2026-10-14, recorded on #1275.

## What Changes

- **Native PDF input.** Models that declare `pdf` receive the PDF itself on every wire:

  - Responses and Codex: an `input_file` part;
  - Chat Completions: a `file` part;
  - Anthropic Messages: a `document` block.

  No text is extracted in this change.

- **Model input declaration.** `models[].input` gains `pdf` (`["text", "pdf"]`, `["text", "image",
"pdf"]`). It is still published by `GET /api/v1/models`, and absent still means text-only.
- **Media store.**
  - `POST /api/v1/media` accepts PDFs detected by `%PDF-` magic bytes.
  - A PDF is stored as its original only, with its page count and without dimensions or a model
    variant.
  - Ingest refuses a PDF over 20 MiB or 100 pages, and an encrypted or unopenable PDF.
  - The PDF descriptor is `id`, `locator`, `mediaType`, `name`, `byteSize`, `pages`.
  - `/original` serves the PDF; `/model` of a PDF is `404`.
- **BREAKING: `image_too_large` becomes `media_too_large`.** This applies on upload (`413`), native
  read, web read, and prompt imports. The message names what was detected. The web client changes
  with it, and no alias remains.
- **Owner attachments.** A message's file parts may reference stored PDFs, under the same
  10-attachment limit. Each reaches the model labelled `PDF n (media://<id>):`, where `n` counts
  the message's PDFs. Images keep `Image n`.
- **Native `read` of PDFs.**
  - Host paths, `file:`, `kb://`, `skill://`, `http(s)://`, and `media://` return a
    `kind: "pdf"` envelope with `pages` and `byteSize`.
  - Only `media://` PDFs persist across turns. Every other PDF is parsed, stored nowhere, and held
    in the reading attempt's memory, so later turns get `[pdf "<locator>" P pages, not retained]`.
  - A selector on a PDF is `invalid_selector`.
  - Web reads accept `application/pdf` bodies that start with `%PDF-`, under a 20 MiB bound for
    PDF responses only, with `method: "pdf"`.
- **Prompt imports.** `@path` targets that are PDFs become PDF entries in the `prompt-imports` item,
  attached in the importing attempt, or replayed from the store for `@media://`.
- **One window for images and PDFs.**
  - The epoch window attaches images and PDFs together, oldest first and append-only, up to 100
    images, 28 MiB of base64 (up from 24 MiB), and a PDF page bound of 100 pages or
    `floor((contextWindowTokens × 0.8 − reservedOutputTokens) / 3,000)` for the model, whichever is
    smaller (53 pages on a 200,000-token model with no output reserve). A 20 MiB PDF fits, and a
    request stays inside Anthropic's 32 MB and
    100-page limits while its text is under about 2.6 MB. A PDF or image counts only on a model
    that declares its kind.
  - An overflowing PDF gets
    `[pdf media://<id> <name> P pages, not attached: this context's PDF limit is reached]`.
  - Overflow compacts at the next Run, as image overflow does, so a PDF too big for the model
    never leaves the chat unable to answer.
- **Placeholders and sizing.**
  - A model without `pdf` gets
    `[pdf <subject> P pages, omitted: this model has no PDF input]`.
  - An unresolvable reference gets `[pdf media://<id> unavailable]`.
  - Estimates charge 3,000 tokens per attached page.
- **Chat Completions.** Tool-result PDFs move into the trailing user message with the images. That
  message's header becomes `Files from tool results:`, and each PDF is labelled
  `PDF from <toolName> <locator>:`.
- **Text projections.** `conversation_read`, title generation, and compaction render
  `[pdf media://<id> <name>]` and keep PDF locators.

Out of scope:

- text extraction, page subsets, and the outline overview (#1276);
- rendering pages to images;
- DOCX, ODT, and other formats (#1074);
- deleting stored media;
- the web UI (#1277: tiles, picker accept list, refusal toast), which is designed in design D10
  and kept out of the specs.

## Capabilities

### New Capabilities

None. PDFs extend `media-store` and `media-attachments`.

### Modified Capabilities

- `media-store`:
  - PDF detection, parsing, bounds, and refusals;
  - the PDF object and descriptor shapes;
  - an optional model variant;
  - `media_too_large`;
  - `/model` of a PDF.
- `media-attachments`:
  - PDF attachments and their label;
  - PDF tool-result and prompt-import parts;
  - attempt memory for unstored PDFs;
  - the shared epoch window (28 MiB, a model-relative PDF page bound);
  - the PDF placeholders;
  - per-page sizing;
  - the Chat Completions move and header;
  - title lines;
  - compaction.
- `native-file-tools`:
  - PDF detection on host, `file:`, `kb://`, `skill://`, web, and `media://` reads;
  - the PDF result;
  - the PDF selector refusal;
  - web PDF bodies, their 20 MiB bound, and `method: "pdf"`;
  - `media_too_large`.
- `knowledge-tools`: `kb://` PDF reads carry the Knowledge notice.
- `prompt-imports`: PDF entries, their payload validation, and their delivery.
- `context-injection`: PDF file parts, PDF tool parts, and prompt-import PDF entries across the
  conversion boundary.
- `conversation-reads`: `[pdf media://<id> <name>]` lines.
- `tool-calling`: how PDF results are carried, stored, and replayed.
- `model-system-prompts`: PDF overflow triggers compaction.
- `instance-config`: `models[].input` accepts `pdf`.
- `available-models`: published `input` may contain `pdf`.

## Impact

- **Dependency.** `unpdf` (MIT, pdf.js serverless build) in `apps/api`, used for page count and
  encryption only, and run in a short-lived child process killed after 10 seconds, so a crafted
  PDF cannot stall or crash the API or a Run worker (design D1).
- **Database.** One migration on `media_objects`:

  - nullable dimension and model columns;
  - a `page_count` column;
  - a shape CHECK.

  RLS is unchanged.

- **API.** Upload accepts PDFs. The descriptor union and `media_too_large` change the OpenAPI
  document and the generated web client.
- **Model requests.** Native PDF parts on all three wires, and the `Files from tool results:`
  header on Chat Completions. Cost grows about 1,500–3,000 tokens per attached page (Anthropic's
  documented range).
- **Operators.**
  - Declare `pdf` only for models whose provider accepts PDFs.
  - Whether the ChatGPT Codex backend accepts `input_file` is verified during implementation and
    documented (design, Open Questions).
- **Docs.**
  - the operator media runbook;
  - the `read`, web-read, and media locator references;
  - the `read` tool prompt (the `TODO(#1074)` line stays);
  - `README.md` `models[].input`;
  - `SPEC.md`;
  - `CHANGELOG.md`.
- **Issues.** The web-read layer closes #916. #1074 keeps the non-PDF formats. #1276 follows.

## Acceptance

- An owner uploads a 15-page PDF and sends it. A model declaring `pdf` receives
  `PDF 1 (media://<id>):` followed by the PDF on the Responses, Chat Completions, and Messages
  wires. A text-only model receives the omitted placeholder.
- `read("/docs/paper.pdf")` returns `kind: "pdf"`, `pages: 15`. The PDF is attached in that attempt
  and is `not retained` in the next turn. `read("/docs/paper.pdf:1-10")` is `invalid_selector`.
- A 21 MiB PDF and a 101-page PDF fail `media_too_large`, and an encrypted PDF fails
  `unsupported_media_type`, at upload, read, and import alike; none stores anything. An HTML file
  renamed `.pdf` is refused at upload and still reads as text.
- A web `application/pdf` response of 12 MiB reads as a PDF. A 21 MiB one fails `body_too_large`.
  An `application/zip` response stays `unsupported_content_type`.
- Six stored PDFs of 3.75 MiB (5 MiB of base64) and 10 pages each in one epoch: five are attached,
  and the sixth gets the limit placeholder and triggers compaction at the next Run.
- A crafted PDF whose parse exceeds 10 seconds is refused `unsupported_media_type` without stalling
  other requests.
- Owner B cannot attach, read, or import owner A's PDF `media://` id.

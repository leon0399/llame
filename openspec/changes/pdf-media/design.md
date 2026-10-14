## Context

See proposal.md (Why). State at `09596126` (master):

- vision-media shipped the image path end to end. The pieces this change reuses:
  - the media store (`media_objects` + `media_blobs`, owner RLS with FORCE, `media://<uuidv7>`);
  - owner `file` parts;
  - the per-step composer (`apps/api/src/models/step-composer.ts`), which is the only place that
    emits image bytes or placeholders;
  - the append-only epoch window (`apps/api/src/media/epoch-admission.ts`: 100 images, 24 MiB of
    base64);
  - per-attempt memory for unstored reads (`attempt-images.ts`);
  - the Chat Completions move of tool-result images into a trailing user message;
  - the cause-naming placeholders and the prompt-import image entries.
- A PDF has no path today:
  - Native `read` of a host, `kb://`, or `skill://` PDF fails `invalid_utf8`, because
    `isImageSignature` (`packages/native-file-tools/src/image.ts:54-64`) matches no `%PDF-` and the
    text path decodes with `TextDecoder(fatal)`.
  - Web read refuses `application/pdf` as `unsupported_content_type`
    (`apps/api/src/tools/web-read/http-client.ts:136,285-301`, pinned by integration tests).
  - Ingest is sharp-only, and the bundled libvips 8.18.7 has no PDF loader
    (`sharp.format.pdf.input.buffer === false`, run on this host).
  - `models[].input` is the closed set `text`, `image` (`llame.config.schema.json:527-533`,
    `model-catalog.ts:68-69`).
- Every installed adapter accepts a PDF user `file` part. The research record is
  `local://pdf-llame-provider-facts.md`.
  - `@ai-sdk/openai` 3.0.97, Responses and Codex: `input_file` with `file_data` (`dist/index.mjs:3196-3221`).
  - `@ai-sdk/openai-compatible` 2.0.75, Chat Completions: `{type:'file', file:{filename, file_data}}`
    (`:168-182`).
  - `@ai-sdk/anthropic` 3.0.118: a `document` block, with the `pdfs-2024-09-25` beta added by the
    adapter (`:2462-2486`).
- Tool-result PDFs (`file-data` in a `content` output) differ by adapter:
  - Responses and Anthropic carry them natively (`openai :3734-3751`, `anthropic :2582-2598`).
  - openai-compatible `JSON.stringify`s the whole output (`:254-275`), as it does for images.
- Provider ceilings, from provider docs, not adapter code:
  - Anthropic: 32 MB per request, and 600 PDF pages per request, or 100 when the request's context
    window is under 1M tokens; it rejects encrypted PDFs.
  - OpenAI: 50 MB per request.
- Neither the source nor the docs say whether the ChatGPT Codex backend
  (`openai-codex-model-client.ts:14`) accepts `input_file`.

### Prior art

Full evidence: `local://pdf-peers-omp-pi.md`, `local://pdf-peers-coding-clis.md`,
`local://pdf-peers-chat-products.md` (peer SHAs recorded there).

| Harness                            | Model input                                                       | Gating                                                                                                    | Bounds                                                                                                                 | Later turns                                                |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| OpenCode (sst/opencode core)       | whole PDF as a base64 file part                                   | `capabilities.input.pdf`; others get `ERROR: Cannot read "x.pdf" (this model does not support pdf input)` | 20 MiB, flat 2,000-token estimate                                                                                      | moved to a user message on wires without tool-result files |
| Gemini CLI                         | `inlineData`                                                      | none (Gemini only)                                                                                        | 20 MB, flat 25,800 tokens                                                                                              | resent every turn                                          |
| Claude Code                        | `document` block in a meta user message                           | `isPDFSupported()`                                                                                        | 20 MB, 100 pages; `pages` param renders ≤ 20 pages; `%PDF-` check, because a bad block returns 400 on every later call | `[document]` at compaction                                 |
| goose                              | native `Document` part where the provider accepts it              | per provider: `[document "x" not sent: …]`                                                                | —                                                                                                                      | `[document: name]`                                         |
| OMP                                | extracted Markdown, `<!-- Page N -->`, line selectors             | none                                                                                                      | generic truncation                                                                                                     | text                                                       |
| OpenClaw, Open WebUI, Hermes, khoj | extracted text; OpenClaw renders pages with little text to images | none                                                                                                      | 10–25 MB, 20–150 pages                                                                                                 | text                                                       |

The native-part design has shipped in OpenCode, Gemini CLI, Claude Code and goose. Our version is
OpenCode's shape plus two things those four lack:

- a page-based estimate and page cap, because a flat estimate undercounts a 50-page PDF about 75×;
- the existing append-only window, which keeps an over-limit PDF from poisoning later requests.

Text extraction (OMP and the chat products) is issue #1276.

## Goals / Non-Goals

**Goals:**

- One preparation for every PDF source: upload, `read`, and prompt import.
- One model-facing form per PDF reference, chosen by the same precedence as images.
- One window that keeps every composed request inside the strictest provider ceiling.

**Non-Goals:**

- Text extraction, page subsets, the outline overview (#1276), rendering pages to images, and
  document formats other than PDF (#1074).
- A model variant: the original is what every adapter takes.
- Detecting at runtime whether a provider accepts PDFs. The operator's `input` declaration is the
  only gate, as it is for images.

## Decisions

### D1: `unpdf` parses structure only

`unpdf` 1.8.1 (MIT, pdf.js serverless build, about 2.6 MB unpacked, no native binaries, ships ESM
and CJS) opens each PDF to read its page count and encryption. It extracts no text in this change.

A spike on this host (`~/.cache/llame-scripts/unpdf-spike/spike.mjs`, Node 22) gave these results:

| Input                        | Result                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| 2.2 MB, 15-page arXiv PDF    | page count in about 100 ms                                                   |
| 300 blank pages              | about 16 ms                                                                  |
| truncated PDF                | `InvalidPDFException`                                                        |
| `%PDF-` followed by garbage  | `InvalidPDFException`                                                        |
| user password set            | `PasswordException`                                                          |
| owner password only          | opens; `getPermissions()` returns the permission flags, not `null`           |
| owner password, `/P` removed | opens; `getPermissions()` returns `null`; the bytes still contain `/Encrypt` |

Preparation refuses:

- every input that fails to open (user password included: `PasswordException`);
- every encrypted input, because Anthropic rejects encrypted PDFs and a refused block in history
  fails every later request. A PDF counts as encrypted when `getPermissions()` is non-`null` or its
  bytes contain the `/Encrypt` name (`spike/encrypt-probe.cjs`: an encryption dictionary without
  `/P` makes `getPermissions()` return `null`, round 5). The byte check alone can false-positive
  on `/Encrypt` inside an uncompressed content stream, which refuses a valid PDF; that fails closed.
  `getMetadata()` is not called: it decodes the whole XMP `/Metadata` stream, which preparation
  does not need and which a deflate bomb can inflate without bound;
- every input reporting fewer than 1 page: pdf.js accepts `/Count 0` and negative counts.

Two properties of pdf.js shape the preparation, both confirmed on this host:

- **It takes ownership of its input.** `getDocumentProxy(view)` transfers the view's `ArrayBuffer`,
  so the caller's `Buffer` reads as length 0 afterwards. Preparation keeps the caller's bytes for
  hashing, storage, and attempt memory, and parses a copy.
- **It parses on the calling thread, with unbounded off-heap memory.** The serverless build runs its
  "worker" in-thread: a crafted 20 MiB `%PDF-` body that forces xref recovery blocked the event loop
  for 3.1 s (reviewer measurement, round 1). Flate decoding grows a `Uint8Array` by doubling with no
  cap, outside the V8 heap, so a worker thread's `resourceLimits` would not bound it, and an
  out-of-memory abort in a worker thread takes the whole process down.

Preparation therefore parses in a **child process**: the API or Run worker spawns `node` on a small
parse entry, writes the bytes to its stdin, and reads `{ pages, encrypted }` as JSON from stdout,
killing it with `SIGKILL` after 10 seconds. A timeout, a non-zero exit, a signal, or unparseable
output refuses the input as `unsupported_media_type`. The child runs under two OS-level bounds,
set by spawning it through `sh -c 'ulimit -v 2097152; echo 1000 > /proc/self/oom_score_adj; exec
node <entry>'` (round 5):

- a 2 GiB address-space limit (`RLIMIT_AS`), which caps off-heap allocation too: an unbounded
  `Buffer` loop fails `RangeError: Array buffer allocation failed` and the child exits 1, while a
  23 MB PDF still parses (1 GiB is too low, because V8 reserves address space at start);
- `oom_score_adj` 1000, which any process may set on itself, so if the container still runs out of
  memory the kernel kills a parse child before the API or Run worker.

A spike (`~/.cache/llame-scripts/unpdf-spike/child-spike.cjs`) measured:

| Input                          | Result                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| 15-page paper                  | `{ pages: 15, encrypted: false }` in about 0.3 s, process start included |
| owner-password PDF             | `encrypted: true` in about 0.6 s                                         |
| user-password PDF              | `PasswordException` in about 0.5 s                                       |
| crafted 20 MiB body, 2 s bound | killed at 2.0 s; a 10 ms parent interval kept firing (192 ticks)         |
| child exhausting its heap      | child exits `SIGABRT`; the parent keeps running                          |

The per-call start (about 0.3 s) is accepted over a pooled parser: PDFs are read seconds apart,
each read is followed by a provider call, and a pool adds lifecycle code. At most two parse
children run at once per process; further parses wait for a slot, and the 10-second bound runs
from a child's start. Without the cap, several crafted uploads at once could exhaust the container
together while each child stays smaller than its parent, so the OOM killer would pick the parent
(round 3). Rejected: a `worker_threads` worker (round 1's first answer), because it bounds neither
off-heap memory nor the blast radius of an abort.

Rejected alternatives:

- **Counting `/Type /Page` with a regular expression.** Compressed object streams hide page objects.
- **`pdf-lib`.** Unmaintained since 2021, and larger.
- **`mupdf`.** AGPL, in an MIT repository.
- **poppler binaries.** Absent from the deploy image, and the API and worker share no filesystem.

`unpdf` also carries `extractText` for #1276.

### D2: PDFs in the media store, without a model variant

Ingest accepts `%PDF-` by magic bytes. It refuses:

- an input over 20 MiB before parsing;
- a PDF over 100 pages, unopenable, or encrypted after parsing.

It stores only the `original` blob. One migration:

- makes `width`, `height`, and the `model_*` columns nullable;
- adds `page_count integer`;
- adds a CHECK requiring exactly one shape, declared with Drizzle's `check()` in
  `src/db/schema/media.ts` as `chats.ts` does, so the snapshot carries it:
  - an image row has every dimension and model column and no page count;
  - an `application/pdf` row has a page count between 1 and 100 and no dimension or model column.

RLS, FORCE, the deduplication constraint, and immutability are unchanged.

The descriptor becomes a union on `mediaType`:

- The image descriptor is unchanged.
- The PDF descriptor is exactly `id`, `locator`, `mediaType` (`application/pdf`), `name`,
  `byteSize`, and `pages`.

`GET /:id/original` serves the PDF bytes with the existing `nosniff`, `sandbox` CSP, ETag, and
`private, no-cache` headers. `GET /:id/model` on a PDF is `404`, the same response as a missing id,
because no model variant exists. The composer reads the original.

Rejected alternatives:

- **Storing the original twice as `model`.** Doubles storage for no reader.
- **A separate `documents` table.** Duplicates RLS, deduplication, the routes and the resolver for
  one column.

### D3: One size refusal code, `media_too_large` (**BREAKING**)

`image_too_large` becomes `media_too_large` on upload (`413`), native read, web read, and prompt
imports.

The upload byte limit fires in multer before the bytes are typed. Under the old code, a 25 MiB PDF
would be refused as an image. A third code beside `image_too_large` and `pdf_too_large` would have
to be chosen by a type nobody has detected yet.

The message names what was detected:

- `Image exceeds 20 MiB or 40 megapixels` for an image;
- `PDF exceeds 20 MiB or 100 pages` for a PDF;
- `File exceeds 20 MiB` before detection.

`unsupported_media_type` covers an unopenable or encrypted PDF, with the message
`Only unencrypted PDFs that open are accepted`.

The web client and the generated client change in the same layer (pre-launch evolution: no alias).

### D4: `pdf` input and the request forms

`models[].input` gains `pdf`. Absent still means `["text"]`, and `GET /api/v1/models` publishes it.

The composer gives each PDF reference exactly one form, in this order:

1. `[pdf media://<id> unavailable]` for a `media://` reference that does not resolve.
2. `[pdf <subject> <P> pages, omitted: this model has no PDF input]` when the request's model
   declares no `pdf`.
3. `[pdf <locator> <P> pages, not retained]` for an unstored PDF the attempt's memory holds no entry
   for.
4. The PDF itself when the window attaches it, the only case whose bytes load:
   - an owner attachment is a label text part, `PDF n (media://<id>):`, then a user `file` part
     with `mediaType: 'application/pdf'` and `filename` set to the stored name;
   - a `read` result is the text envelope followed by a `file-data` part;
   - a prompt-import entry is a `file` part after the item's text.
5. `[pdf <subject> <P> pages, not attached: this context's PDF limit is reached]` otherwise.

`<subject>` and `<locator>` follow the image rules unchanged: `media://<id> <name>`, or the
submitted locator as an exact `JSON.stringify` literal.

In a label, `n` counts that message's attachments of the same kind, so one message reads
`Image 1`, `Image 2`, `PDF 1`. A message with images only is unchanged.

Every PDF part carries a filename, because the Responses adapter otherwise names a tool-output file
`data` (`@ai-sdk/openai` `dist/index.mjs:3739-3742`): the stored name for an owner attachment or a
`media://` read or import, otherwise the last non-empty path segment of the submitted locator (a web
locator's URL path), or `document.pdf` when there is none.

The kind of every reference is known: a stored file part carries `mediaType`, an import entry
carries `kind`, and a read envelope carries `kind`. The unavailable form follows it.

### D5: One epoch media window: 28 MiB, 100 images, a model-relative PDF page bound

`admitEpochImages` becomes the epoch media window. It keeps:

- the same order: oldest first, request order, a repeated id counting again;
- the same append-only admission and attempt-boundary exceptions.

It enforces three bounds together; the first reference that would exceed any of them, and every
later one in the epoch, is not attached:

| Bound              | Value                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| summed base64 size | 29,360,128 bytes (28 MiB), up from 24 MiB                                                                                |
| attached images    | 100                                                                                                                      |
| attached PDF pages | the smaller of 100 and `floor(max(0, contextWindowTokens × 0.8 − reservedOutputTokens) / 3,000)` for the request's model |

A PDF's base64 size is `4 × ceil(byteSize / 3)` of its original.

The page bound is 53 pages on a 200,000-token model, 34 on 128,000, and 100 from 375,000 up. The
hard 100 is this change's own per-PDF ingest bound, which also keeps a request within Anthropic's
100-page limit for windows under 1M tokens; larger windows would allow 600. The
0.8 is `COMPACTION_WINDOW_RATIO`, the share of the window the default compaction threshold already
reserves for history, so attached PDFs alone never reach the default threshold and 20% stays for
the system prompt, tools, and the rest of the history. The configured output reserve
(`runs.maxOutputTokens`, which the fit check adds) is subtracted first (round 4): without it, a
64,000-token reserve on a 200,000-token model would admit a 53-page PDF that can never fit. Rounds 2 and 3 replaced two
narrower rules with this one: a per-PDF "too large for the window" exclusion missed several PDFs
that only overflow together and a PDF that fits alone but not with the system prompt, and either
would leave a chat whose every request, compaction included, fails `context_incompatible`. With an
ordinary bound, such a PDF takes the limit placeholder, its first request proceeds, and the next
Run's overflow trigger compacts its row away.

A reference counts only when the request's model declares its kind: an image on a model without
`image` input and a PDF on a model without `pdf` input take the omitted placeholder and consume no
budget. An unstored PDF read on a model without `pdf` input therefore holds no bytes and no byte
size, exactly as an image does on a text-only model. Without this rule a 20 MiB PDF on an
image-only model would consume 27,962,028 of the 29,360,128 bytes while sending none, and refuse
every later image.

Why 28 MiB: a 20 MiB PDF is 27,962,028 bytes of base64. 28 MiB is the smallest round bound that
admits one, and it leaves about 2.6 MB under Anthropic's 32 MB request limit for text and JSON.
30 MiB would leave about 0.5 MB, which a long chat exceeds. The headroom assumes the request's text
stays under about 2.6 MB, roughly 650k tokens at four characters per token. A model configured
with a larger context window can exceed the 32 MB request limit with a 20 MiB PDF attached (Risks).

Images gain the same 4 MiB. Their 100-image bound is unchanged.

Overflow keeps the image behavior, now for both kinds:

- the limit placeholder;
- an overflow-triggered compaction at the next Run when an earlier row holds a stored image or PDF;
- never a failed Run.

Rejected: a separate PDF window. Two budgets can together exceed one request ceiling unless a
third, combined check is added.

### D6: 3,000 tokens per attached page

The admission and compaction estimate charges each attached PDF `3,000 × pages` tokens, in place of
its base64 length, as images are charged `ceil(w × h / 750)`. Anthropic documents 1,500–3,000 text
tokens per page plus a page-image cost, so this is its upper text figure, not an upper bound.

With the model-relative page bound (D5), attached PDFs are charged at most 80% of the window minus
the output reserve, so the estimate cannot by itself make a request fail `context_incompatible`.

A placeholder is counted as its text.

### D7: Native `read` of PDFs

The native read hook (`ImageReadHook`) becomes a media read hook. A regular file (host path,
`file:`, `kb://`, `skill://`) whose first bytes are `%PDF-`:

- over 20 MiB is refused `media_too_large` before it is read whole;
- otherwise goes through D1/D2 preparation without storing.

On success:

- the worker holds `{locator, pages, byteSize, bytes}` in the attempt's memory, keyed by tool call
  id, when the attempt's model declares `pdf`, and only `{locator, pages}` otherwise;
- the read returns this envelope, with the source's existing attribution:

  ```json
  {
    "status": "success",
    "kind": "pdf",
    "mediaType": "application/pdf",
    "pages": 15,
    "byteSize": 2215244,
    "path": "…"
  }
  ```

A `media://` PDF read returns the same envelope plus `media: "media://<id>"`, and replays from the
store.

A selector on a PDF, `:raw` included, is `invalid_selector`. The image and `media://` refusal
message becomes `An image or PDF is read without a selector.` and covers PDFs too: a `media://`
selector is refused before any lookup, so the kind is unknown when it fails, and one message is
simpler than three. There is no thumbnail.

Attempt memory becomes `Map<string, HeldMedia>`, where `HeldMedia` is the image entry or the PDF
entry. `release` keeps a PDF's `byteSize` and `pages`, so the window refuses it the same way at
every later compose of the attempt.

Web read accepts a response whose `Content-Type` is `application/pdf` and whose body starts with
`%PDF-`:

- under a 20 MiB body bound for that response only; HTML and images keep 5 MiB;
- with result `method: "pdf"` and `finalUrl`;
- every other binary type stays `unsupported_content_type`.

The arXiv adapter is unchanged: `/pdf/` links keep reading the HTML full text.

### D8: Chat Completions move and text-only projections

On `openai-completions` and `opencode-go`, tool-result PDFs move with the tool-result images into
the trailing user message:

- that message's header becomes `Files from tool results:`;
- each PDF is preceded by `PDF from <toolName> <JSON locator>:`.

The header change touches image-only requests once; the image labels are unchanged.

`conversation_read` and title generation render a PDF file part as `[pdf media://<id> <name>]`.
Compaction keeps PDF locators verbatim, under the existing redaction precedence.

### D9: Prompt imports

An admitted target whose native `read` returns a PDF becomes a PDF entry in the `prompt-imports`
item:

```text
{ locator, resolved, outcome, kind: 'pdf', mediaType, pages, byteSize, media? }
```

The API and web exact-key validators widen together. The entry follows D4 and D5 like a `read`
result: from memory in the importing attempt, from the store for `@media://`.

### D10: Web UI (#1277, not in specs)

- **Tiles.** A PDF uses the image tile's square, gray, with a darker document icon and the name.
  This applies in the composer, messages, `read` cards, and import chips.
- **Click.** A stored PDF's tile opens `/original` in a new tab, where the browser's PDF viewer
  renders it. An unstored PDF's tile is not clickable. The lightbox is untouched.
- **Composer.**
  - The picker's accept list adds `application/pdf` only when the selected model declares `pdf`;
    otherwise a pasted or dropped PDF is refused with a toast.
  - The 10-attachment limit counts images and PDFs together.

## Risks / Trade-offs

- **Codex `input_file` is unverified.** A Codex model that declares `pdf` may be refused by the
  backend. The implementation layer probes it once with the operator's credentials. The operator
  docs then either list it or tell operators not to declare `pdf` on `openai-codex` entries. No
  code changes either way.
- **Gateway rejection.** An `openai-completions` gateway (vLLM, Ollama, OpenCode Go) may reject
  `file` parts. The operator declares `pdf` only for models known to accept it; the default is
  `["text"]`.
- **Cost and window fit.** A 100-page PDF is charged 300k tokens. On models with windows under
  375k tokens, the page bound is lower than 100 (53 at 200k), so a longer PDF takes the limit
  placeholder on that model even though the provider might have accepted it. That is the price of
  a conservative estimate; text extraction (#1276) is the path for long documents on small windows.
- **One wasted compaction.** A PDF longer than the model's page bound, attached in a turn whose
  earlier rows hold a stored reference, triggers overflow compaction at the next Run that cannot
  admit it in the new epoch either; the Run after that compacts its row away. Two summaries for
  one oversized upload are accepted over a rule that predicts whether a new epoch would admit it.
- **Lying page counts.** pdf.js trusts the page tree's `/Count` (a 150-page PDF patched to
  `/Count 1` reports 1 page, reviewer measurement), and an encrypted PDF that both drops `/P` and
  spells `/Encrypt` with a `#xx` name escape evades both encryption checks. Such a PDF passes the
  bounds and the
  provider may refuse the request. An unstored read fails only its attempt, since later turns get
  the not-retained placeholder. A stored upload fails the chat's requests on PDF-declaring models,
  compaction requests included, because the summarizer receives the same PDF; the owner continues
  on a model without `pdf` input or in another chat. Walking the page tree ourselves is rejected:
  it duplicates the parser for an input that only breaks its own uploader's chat.
- **Context windows above about 650k tokens.** The 28 MiB budget leaves about 2.6 MB of headroom
  under Anthropic's 32 MB request limit (D5). The operator runbook says so for models configured
  with larger windows.
- **Scanned and figure-only PDFs** are fine: the provider renders the pages. Text-only models get
  only the placeholder until #1276.
- **No deletion path** (inherited). A stored PDF stays readable through `media://`.

## Migration Plan

- One Drizzle migration, generated from the schema:

  - nullable dimension and `model_*` columns;
  - `page_count`;
  - the shape CHECK, declared in the schema.

  Existing rows are images and already satisfy the CHECK.

- FORCE RLS is unchanged.
- Rollback before any PDF is stored is the reverse migration. After a PDF exists, rollback must
  first delete PDF rows, so it is effectively forward-only.
- The `media_too_large` rename ships with its web client change in one layer.
- No configuration migration: `input` stays optional.

## Open Questions

- Whether the ChatGPT Codex backend accepts `input_file` (Risks). The answer changes operator docs
  only.

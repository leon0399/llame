Track [#1275](https://github.com/leon0399/llame/issues/1275), [#1277](https://github.com/leon0399/llame/issues/1277), and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's approval
of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer is
created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed before
it is marked ready, and monitored per [CONTRIBUTING.md](../../../CONTRIBUTING.md). Each implementation
layer also gets one code-review and one ponytail-review subagent pass on its draft diff before ready.

```text
(master) <- pdf-media/proposal
         <- pdf-media/pdf-store
         <- pdf-media/pdf-attachments
         <- pdf-media/pdf-read
         <- pdf-media/pdf-read-web
         <- pdf-media/prompt-import-pdfs
         <- pdf-media/web-ui
         <- pdf-media/finalize
```

| Layer                | Parent               | Owns                                                                                                                                                                                                                        | Estimated authored lines         |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `proposal`           | `master`             | this ledger, the proposal, the design, and the delta specs; closes no issue                                                                                                                                                 | about 4,250; see the budget note |
| `pdf-store`          | `proposal`           | `unpdf`, the shared PDF preparation, the migration, PDF ingest, the descriptor union, the routes, and the `media_too_large` rename across the API and web client                                                            | about 1,300                      |
| `pdf-attachments`    | `pdf-store`          | `models[].input` `pdf`; the shared epoch media window and per-page sizing; owner PDF attachments with their label, placeholders, text lines, compaction, and overflow trigger; the Codex probe                              | about 1,800                      |
| `pdf-read`           | `pdf-attachments`    | PDF reads on host, `file:`, `kb://`, `skill://`, and `media://`; attempt memory for unstored PDFs; PDF tool outputs on every wire, including the Chat Completions move and its new header; the `read` prompt and references | about 1,800                      |
| `pdf-read-web`       | `pdf-read`           | web PDF bodies, the PDF-only 20 MiB bound, and `method: "pdf"`                                                                                                                                                              | about 500                        |
| `prompt-import-pdfs` | `pdf-read-web`       | PDF entries in the `prompt-imports` item, their validators, and their delivery; closes #1275                                                                                                                                | about 500                        |
| `web-ui`             | `prompt-import-pdfs` | the PDF tile, composer accept list and refusal, and `/original` in a new tab; closes #1277                                                                                                                                  | about 800                        |
| `finalize`           | `web-ui`             | spec synchronization, task records, and archive movement only                                                                                                                                                               | under 400                        |

Dependencies and budget:

- `proposal` is a named exception to the review budget: 11 capability deltas, of which about 2,720
  lines are 42 MODIFIED blocks that restate canonical requirements verbatim; about 665 of those
  lines differ from the canonical text (the 207-line selector requirement changes 3). Requirements
  merely silent about PDFs get ADDED siblings instead of MODIFIED copies, which keeps the restated
  text to blocks the change contradicts. Splitting the proposal would publish an incomplete
  contract.
- `pdf-read` is the largest implementation layer; re-estimate at its boundary and split the Chat
  Completions move into its own layer if it would exceed the budget.
- Generated output (Drizzle snapshot, OpenAPI document and client, lockfile) counts zero and is
  reported separately.
- Three interim guards keep PDFs away from code that cannot carry them yet. Each fails closed,
  names its cause, and is deleted by the layer named:
  - from `pdf-store` until `pdf-attachments`, a message whose file part references a stored PDF is
    refused `400` before any row is written;
  - from `pdf-store` until `pdf-read`, `read("media://<id>")` of a stored PDF, and therefore an
    `@media://<id>` import of one, fails `unsupported_media_type`;
  - from `pdf-read` until `prompt-import-pdfs`, a prompt import whose read returns a PDF is recorded
    as a failed import naming that PDF imports are not supported yet, so no owner chip or model
    text claims an import the request does not carry.

Each layer leaves the repository shippable:

- After `pdf-store`, PDFs can be uploaded and fetched, and the two interim guards refuse every other
  use; no model can declare `pdf` yet.
- After `pdf-attachments`, the API accepts and replays PDF attachments; the web client still offers
  only images.
- Until `pdf-read`, a local PDF read keeps failing as text; until `pdf-read-web`, a web PDF keeps
  failing `unsupported_content_type`.
- `web-ui` adds the composer and tiles.

Each shipping layer adds its own documentation and dated `CHANGELOG.md` entry.

## 0. `pdf-media/proposal` — planning artifacts

- [x] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited upstream sources; commit each round separately and record it in the PR body
- [x] 0.2 Verify every MODIFIED block against its canonical requirement with a sentence-level diff after applying any explicit RENAMED mapping, keeping every canonical scenario heading verbatim
- [x] 0.3 Verify `pnpm exec openspec validate pdf-media --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [x] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [x] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision before creating `pdf-media/pdf-store`

## 1. `pdf-media/pdf-store` — PDF preparation, storage, routes (design D1–D3)

- [x] 1.1 Add `unpdf` to `apps/api` and implement the PDF preparation shared with unstored reads: `%PDF-` detection, the 20 MiB refusal before parsing, page count, the 100-page bound, and refusal of every PDF that fails to open, reports fewer than 1 page, or is encrypted (`getPermissions()` non-`null` or the byte sequence `/Encrypt` anywhere in the file), without calling `getMetadata()`; parse in a short-lived child process (a parse entry shipped in the API build, bytes on stdin, JSON on stdout), spawned on Linux through the design D1 `sh` chain (address-space limit clamped to the host's hard limit, then `oom_score_adj` 1000, then `exec node`) and elsewhere as `node <entry>`, at most two children at once per process with others waiting, each killed 10 seconds after its own start, consuming `error` events on the child's stdin, a timeout, non-zero exit, signal, or unparseable output refusing `unsupported_media_type`, and a child whose `sh` exits with the start-failure status 70 and no output logged at error level with its stderr and refused with `PDF parsing is unavailable on this server`; verify by unit tests over generated fixtures (valid, truncated, `%PDF-` plus garbage, `/Count 0`, 101 pages, user-password, owner-password-only, and owner-password without `/P` encryption, an unencrypted PDF with uncompressed `/Encrypt` text, 21 MiB) for every `media-store` preparation scenario, plus tests with an injected parse entry and short time bound that a crafted body is refused while a parent timer keeps firing, that on Linux a child allocating past the address-space limit exits non-zero and is refused while the parent keeps serving, that a small valid fixture and a 20 MiB body written to a child that cannot start are both refused with the unavailable message while the parent keeps serving, that an inherited hard limit between 1.25 and 2 GiB still lets a parse run while one below 1.25 GiB exits 70 and is refused with the unavailable message, that five concurrent preparations never exceed two live children and are all answered, and that the caller's bytes are unchanged after preparation; the parent-survival assertion covers `RLIMIT_AS` allocation failure, not kernel OOM selection
- [x] 1.2 Make `media_objects` width, height, and `model_*` nullable, add `page_count`, and declare the shape CHECK with Drizzle `check()` in `src/db/schema/media.ts`, then generate the migration and re-append FORCE RLS only if regeneration drops it; verify `pnpm db:migrate` on a fresh database, `pnpm --filter api db:check`, and an integration test that the CHECK rejects a mixed row and that owner B cannot select owner A's PDF row
- [x] 1.3 Ingest PDFs (original blob only, SHA-256 per-owner dedup unchanged), return the PDF descriptor, serve `/original` with the existing headers and answer `/model` of a PDF `404` before any `ETag` or `If-None-Match` handling; add the two interim guards (a message referencing a stored PDF refused `400`, `read("media://<id>")` of a stored PDF failing `unsupported_media_type`); rename `image_too_large` to `media_too_large` in ingest, native read, web read, prompt imports, the upload body limit, `packages/native-file-tools`, and the web client, with the three messages from design D3; regenerate the OpenAPI document and client; verify by API integration tests for a PDF upload, its closed descriptor, dedup, `/original` headers, `/model` `404` with and without a matching `If-None-Match`, a 21 MiB upload answered `413` `File exceeds 20 MiB`, a 101-page PDF `413`, an encrypted PDF `415`, owner B's `404` on owner A's PDF, both interim guards, and a clean second OpenAPI generation
- [x] 1.4 Replace `image_too_large` with `media_too_large` in `apps/api/src/prompts/tools/read.md`, `docs/product/reference/tools/read.md`, `docs/product/reference/locators/web.md`, and `docs/product/operator/web-read.md`; document PDF storage, bounds, refusals (including the literal-`/Encrypt` false positive), the parse bounds (Linux address-space and OOM bounds, which need `sh` and a writable `/proc/self/oom_score_adj` in the image; time bound only on macOS and Windows development builds) and the `PDF parsing is unavailable on this server` refusal, and `media_too_large` in `docs/product/operator/media.md`; add the dated `CHANGELOG.md` entry marking the rename **Breaking**; verify `pnpm lint:markdown`, `pnpm format:check`, and a search finding no `image_too_large` in `apps/`, `packages/`, `docs/`, `README.md`, or `SPEC.md` (canonical specs change at `finalize`; `CHANGELOG.md` history and archived changes keep it)
- [x] 1.5 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter web lint typecheck`, the focused unit tests, and the touched integration suites
- [x] 1.6 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 1.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `pdf-media/pdf-attachments` — input declaration, window, owner PDFs (design D4–D6, D8)

- [ ] 2.1 Accept `pdf` in `models[].input` in the config type, published schema, loader, `llame.config.jsonc.example`, and the `GET /api/v1/models` DTO enum, and publish it; regenerate the OpenAPI document and client; verify by loader tests for the `instance-config` scenarios, an API test for the `available-models` scenario, and a clean second OpenAPI generation
- [ ] 2.2 Generalize the epoch window to images and PDFs in one order with three bounds (29,360,128 bytes of base64, 100 images, and the smaller of 100 PDF pages and `floor(max(0, contextWindowTokens × 0.8 − reservedOutputTokens) / 3,000)` pages for the request's model), a PDF counting its original's base64 size and pages, and a reference counting only when the request's model declares its kind; pass the model's context window and the output reserve to every caller of the window (admission and trigger estimates, the compaction fit check, and the step composer) so all compute the same set; charge `3,000 × pages` tokens per attached PDF in every admission and compaction estimate, excluding PDF bytes; verify by unit tests for every window, byte-bound, and sizing scenario of `media-attachments`, including the re-numbered five-of-six scenarios, a 53-page bound on a 200,000-token model, a 32-page bound with a 64,000-token reserve, a 20 MiB PDF on an image-only model leaving the image budget untouched, and the estimate and the composer agreeing on the same references
- [ ] 2.3 Delete the interim attachment guard; compose owner PDF file parts as `PDF n (media://<id>):` plus a native `file` part of the original, carrying the stored name as filename, loaded only when attached, with per-kind counters, and the omitted, unavailable, and limit placeholders; render `[pdf media://<id> <name>]` in `conversation_read` and title generation, keep PDF locators in compaction, carry attached PDFs into compaction requests, and let image or PDF overflow trigger compaction when an earlier row holds a stored reference of a kind the model declares; make the web transcript skip non-image file parts until `web-ui` renders PDF tiles (no `/model` request for a PDF); verify by unit tests for the PDF form-precedence, label, text-line, overflow, oversized-PDF, and compaction scenarios, by client tests capturing the Responses, Chat Completions, and Messages request bodies (`input_file`, `file`, `document`), and by a web story play function that a PDF file part renders no image
- [ ] 2.4 Prove the end-to-end path with the scripted model client whose models declare `pdf` and text only: an uploaded PDF sent in a message reaches the request labelled before the text, survives retry and fork, and is the omitted placeholder for a text-only model; verify by an integration test, including owner B's message refused for owner A's PDF id before any row is written
- [ ] 2.5 Probe the ChatGPT Codex backend once with an `input_file` PDF part using operator credentials and record the result; document `pdf` in `models[].input` in `README.md` and the operator media runbook, stating which provider types accept it; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 2.6 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter web lint typecheck`, the focused unit tests, and the touched integration suites
- [ ] 2.7 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 2.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `pdf-media/pdf-read` — local and media PDF reads (design D7, D8)

- [ ] 3.1 Delete the interim `media://` read guard and add the interim PDF-import guard; detect `%PDF-` ahead of text decoding for host, `file:`, `kb://`, and `skill://` regular files; refuse one over 20 MiB before reading it whole and otherwise run the shared preparation without storing; return the `kind: "pdf"` envelope with the source's attribution; refuse every selector on an image, PDF, or `media://` locator, `:raw` included, with the one message `An image or PDF is read without a selector.`; return the PDF result with `media` for a `media://` PDF; verify by native-file-tools and API unit tests for every `native-file-tools` and `knowledge-tools` PDF scenario, including an HTML file named `.pdf` read as text and an encrypted PDF refused without text fallback, and a test that a PDF import is recorded as a failed import
- [ ] 3.2 Hold unstored PDFs in the attempt's memory beside images (bytes and `byteSize` only when the attempt's model declares `pdf`, `pages` always; release keeps `byteSize` and `pages`); emit a PDF `read` result as its text envelope plus a `file-data` part with the design D4 filename on the Responses, Codex, and Messages wires, and move tool-result PDFs on `openai-completions` and `opencode-go` into the trailing user message under `Files from tool results:` with `PDF from <toolName> <locator>:` labels; store and replay PDF tool parts with the not-retained, omitted, and unavailable placeholders; verify by unit tests for the attempt-memory, tool-calling, and Chat Completions scenarios and client tests capturing every wire's request body, with no PDF bytes in stored parts or run events
- [ ] 3.3 Update `apps/api/src/prompts/tools/read.md` (PDFs are returned to models with PDF input, take no selector, and only `media://` PDFs are kept across turns; keep the `TODO(#1074)` line), `docs/product/reference/tools/read.md`, and `docs/product/reference/locators/media.md`; update `SPEC.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 3.4 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter @workspace/native-file-tools test`, the focused unit tests, and the touched integration suites
- [ ] 3.5 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 3.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `pdf-media/pdf-read-web` — web PDF bodies (design D7)

- [ ] 4.1 Accept `application/pdf` responses whose body starts with `%PDF-` under a 20 MiB bound for that response only, parsed without storing like a local PDF read, with `method: "pdf"`; keep HTML and images at 5 MiB, every other binary type `unsupported_content_type`, and every probe or alternate candidate serving a PDF disqualified; verify by web-read tests against the local fixture server for each PDF scenario of "Web fetch bounds fail fast and are never retried", "Web reads accept text and image bodies", and "Web read results carry the final URL and retrieval method", including a 12 MiB PDF, a 21 MiB PDF, `application/pdf` over HTML bytes, and an `application/zip` body
- [ ] 4.2 Update `apps/api/src/prompts/tools/read.md` (a web PDF body is read like a local PDF; other binary bodies stay refused), the web-read operator runbook, `docs/product/reference/locators/web.md`, and `docs/product/reference/tools/read.md`; add the dated `CHANGELOG.md` entry; this layer completes web PDF reads, so its PR carries `Closes #916`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 4.3 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the web-read integration suite
- [ ] 4.4 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 4.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `pdf-media/prompt-import-pdfs` — PDF entries (design D9)

- [ ] 5.1 Delete the interim PDF-import guard; turn an admitted prompt-import PDF result into a PDF entry of the `prompt-imports` item, counted toward the 8-target bound and outside the 128 KiB text bound, attached from the importing attempt's memory or replayed from the store for `@media://`, and counted among the triggering message's own references by the overflow trigger; widen the API and web exact-key validators together; verify by unit tests for every `prompt-imports` PDF scenario, including a payload with an extra key refused on both sides and a triggering-message-only PDF import over the page bound that does not compact
- [ ] 5.2 Update the prompt-imports reference page; add the dated `CHANGELOG.md` entry; this layer completes #1275's acceptance, so its PR carries `Closes #1275`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 5.3 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter web lint typecheck`, the focused unit tests, and the touched integration suites
- [ ] 5.4 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 5.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `pdf-media/web-ui` — PDF tiles and composer (design D10)

- [ ] 6.1 Add the gray PDF tile variant (darker document icon, name) beside the image tile in `packages/ui`, with stories for the composer, message, `read`, and import contexts; verify with Storybook MCP story tests and return preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [ ] 6.2 Accept `application/pdf` in paste, picker, and drop only when the selected model's published `input` contains `pdf`, refuse it otherwise with a toast, count PDFs toward the 10-attachment limit, and open a stored PDF's `/original` in a new tab while an unstored PDF tile is not clickable; verify by story play functions and a focused product E2E test that uploads a PDF, sends it to a scripted `pdf` model, reloads, and sees the tile
- [ ] 6.3 Document PDF attachments in `docs/product/reference/locators/media.md`; add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #1277`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 6.4 Verify `pnpm --filter web lint`, `typecheck`, the `packages/ui` checks, and the focused E2E spec
- [ ] 6.5 SR: self-review the parent-relative diff with the code-review and ponytail-review passes, fix accepted findings, then mark ready
- [ ] 6.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `pdf-media/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the implementation top, before `$openspec-sync-specs`
writes. Its self-review and GitHub review are post-archive gates, not tasks here.

- [ ] 7.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass, or that every failure also fails on `master`
- [ ] 7.2 Confirm `openspec status --change pdf-media --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

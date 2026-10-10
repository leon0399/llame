Track [#935](https://github.com/leon0399/llame/issues/935), [#1166](https://github.com/leon0399/llame/issues/1166), and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's approval
of the published proposal revision; keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Every layer is
created and published with `$gh-stack`, implemented with `$openspec-apply-change`, self-reviewed before
it is marked ready, and monitored per [CONTRIBUTING.md](../../../CONTRIBUTING.md).

```text
(master) <- vision-media/proposal
         <- vision-media/media-store
         <- vision-media/model-input
         <- vision-media/attachments-api
         <- vision-media/vision-read-local
         <- vision-media/vision-read-completions
         <- vision-media/vision-read-web
         <- vision-media/prompt-import-images
         <- vision-media/composer
         <- vision-media/previews-lightbox
         <- vision-media/finalize
```

| Layer                     | Parent                    | Owns                                                                                                                                                                                                                                                                                                              | Estimated authored lines         |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `proposal`                | `master`                  | this ledger, the proposal, the design, and the delta specs; closes no issue                                                                                                                                                                                                                                       | about 3,900; see the budget note |
| `media-store`             | `proposal`                | the two tables, migration and RLS, `sharp` ingest, the upload and fetch routes, retention, the isolation test, and the operator runbook                                                                                                                                                                           | about 1,900                      |
| `model-input`             | `media-store`             | `models[].input` and its publication; the per-step composer and media resolver; owner `file` parts with labels, the image window, placeholders, and dimension-based request sizing; the text-only projections of owner attachments                                                                                | about 1,800                      |
| `attachments-api`         | `model-input`             | `file` parts on the owner send DTO, ownership and descriptor rewriting, image-only messages, and the regenerated OpenAPI client                                                                                                                                                                                   | about 900                        |
| `vision-read-local`       | `attachments-api`         | image detection and ingest on host, `file:`, `kb://`, and `skill://` reads; the `media://` scheme and its permission and Workspace rules; image `content` tool outputs live and in replay on the Responses, Codex, and Messages wires with the per-step image window; Chat Completions wires receive placeholders | about 1,900                      |
| `vision-read-completions` | `vision-read-local`       | the Chat Completions transform that moves tool-result images into a following user message, live and in replay                                                                                                                                                                                                    | about 600                        |
| `vision-read-web`         | `vision-read-completions` | web image bodies and `method: "image"`                                                                                                                                                                                                                                                                            | about 700                        |
| `prompt-import-images`    | `vision-read-web`         | image entries and `media://` targets in the `prompt-imports` item; closes #935                                                                                                                                                                                                                                    | about 500                        |
| `composer`                | `prompt-import-images`    | composer thumbnails, paste, picker, drag-and-drop, upload states, reorder, and the text-only-model block                                                                                                                                                                                                          | about 1,500                      |
| `previews-lightbox`       | `composer`                | sent-message, read-tool, and prompt-import thumbnails, the lightbox and its variant toggle; closes #1166                                                                                                                                                                                                          | about 1,500                      |
| `finalize`                | `previews-lightbox`       | spec synchronization, task records, and archive movement only                                                                                                                                                                                                                                                     | under 400                        |

Dependencies and budget:

- `vision-read-local` fails closed on the Chat Completions wires: until `vision-read-completions`
  lands, an attached tool-result image for a model declaring `image` on `openai-completions` or
  `opencode-go` reaches it as the interim placeholder
  `[image media://<id> <name> W×H, omitted: this connection cannot carry tool-result images yet]`, never as base64 text and never with a re-read hint. This
  form names the real cause, differs from every spec form, and is removed by `vision-read-completions`.
  Every other reference keeps its spec form.
- Comparable shipped layers ran above estimate (#1134, GitHub read
  adapters: 2,581; #1104, `web_search` with one engine: 3,214); re-estimate each layer at its
  boundary and split again before publication rather than exceed the budget.
- `proposal` is a named exception to the review budget: 15 capability deltas, of which about 2,200
  lines are MODIFIED blocks that restate canonical requirements verbatim with one- or two-sentence
  edits. Splitting the proposal would publish an incomplete contract.
- Generated output (Drizzle snapshot, OpenAPI document and client, lockfile) counts zero and is
  reported separately.

Each layer leaves the repository shippable:

- After `media-store`, media can be uploaded and fetched, but nothing references it.
- After `attachments-api`, the API accepts and replays attachments.
- After `vision-read-local`, `read` returns images on every non-web locator.
- From `attachments-api` until `composer`, the web transcript withholds `file` parts rather than
  printing its "unsupported part type" fallback.
- The web client gains attachments and read-only sent-message thumbnails in `composer`.
- `previews-lightbox` adds the lightbox and the read-tool and prompt-import thumbnails.

Each shipping layer adds its own documentation and dated `CHANGELOG.md` entry.

## 0. `vision-media/proposal` — planning artifacts

- [x] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited upstream sources; commit each round separately and record it in the PR body
- [x] 0.2 Verify every MODIFIED and RENAMED block against its canonical requirement with a sentence-level diff, keeping every canonical scenario heading verbatim
- [x] 0.3 Verify `pnpm exec openspec validate vision-media --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [x] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [x] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision before creating `vision-media/media-store`

## 1. `vision-media/media-store` — store, ingest, routes (design D1–D4)

- [x] 1.1 Add `media_objects` and `media_blobs` to the Drizzle schema with `pgPolicy` owner policies and a hand-appended `FORCE ROW LEVEL SECURITY`, UUIDv7 ids generated with a direct `uuid` dependency's `v7()`, and generate the migration (no `db:provision-rls` change: owner-keyed tables need none); verify `pnpm db:migrate` on a fresh database and an API integration test that owner B cannot select, insert against, or update owner A's rows
- [x] 1.2 Add `sharp` to `apps/api` and implement ingest: 20 MiB pre-decode refusal, magic-byte detection of PNG, JPEG, GIF, and WebP, a 40-megapixel header check, original storage, the model variant (orientation, metadata strip, first frame, 2000 px long edge, PNG then JPEG q85 then 0.75 downscale steps under 3.75 MiB), SHA-256 per-owner dedup, and the single-line, credential-free 256-character source label (control characters to spaces, `[`/`]` to `(`/`)`, web sources reduced to scheme, host, port, and path); verify by unit tests over fixture files for every `media-store` ingest scenario, including SVG, HTML renamed `.png`, a 41-megapixel PNG header, a 21 MiB file, an EXIF-rotated JPEG, and an animated GIF, a filename containing a newline, and a web source `https://u:p@example.test/a.png?token=secret#x`
- [x] 1.3 Add `POST /api/v1/media` (one multipart file through `FileInterceptor` with `limits.fileSize`; add `@types/multer` as a dev dependency; map multer's `LIMIT_FILE_SIZE` to `413` with `image_too_large`) and `GET /api/v1/media/:id`, `/original`, and `/model` with the stored type, `nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: sandbox`, a strong content-hash `ETag`, and `Cache-Control: private, no-cache`; regenerate the OpenAPI document and web client; verify by API integration tests for upload, dedup, fetch headers, a matching `If-None-Match` answered `304`, unauthenticated `401`, a 21 MiB upload answered `413` with `image_too_large`, another owner's id as `404` on every route, and every scenario of "Media is retained without deletion" (chat deletion keeps media, no delete route, an unsent upload retained)
- [x] 1.4 Write `docs/product/operator/media.md` (storage in Postgres, growth and backup cost, bounds, formats, `sharp` platform support, the no-deletion gap) and link it from the operator index; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 1.5 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [x] 1.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [x] 1.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `vision-media/model-input` — input declaration and owner-attachment projections (design D6, D9)

- [x] 2.1 Add `models[].input` to the raw and resolved config, the published schema, the loader (closed set, must contain `text`, no duplicates, default `["text"]`), and `llame.config.jsonc.example`; publish `input` on every `GET /api/v1/models` entry; verify by loader tests for each `instance-config` scenario and an API test for the `available-models` scenarios
- [x] 2.2 Add one pure epoch-admission function (media references and descriptors in, attached set out) that request preparation calls before `evaluateCompactionTrigger` and the step composer calls on every step; keep `buildContext` emitting media references only; add the step composer, run on every model request: as an always-installed `prepareStep` whether or not the request offers tools (only the step cap and `onStepStart` stay gated on tools), running on the final messages after `onStepStart` and the step-cap check; export it as one helper that every `ModelClient` implementation installs, including the test `HarnessModelClient` (`apps/api/src/runs/scripted-model-client.ts`); feed it a per-Run media resolver passed on `ModelStreamInput` and loaded under the Run owner's identity, and map stored owner `file` parts through it: labels and image parts after rail items and the temporal row and before the text, model variants loaded under the Run owner's identity, the epoch image window (100 images, 24 MiB base64, admitted oldest first within the compaction epoch, append-only), the limit placeholder for unattached images, non-vision models, and unresolvable ids; verify by unit tests seeding stored owner `file` parts for the `media-attachments` projection, window, placeholder, and unresolvable-reference scenarios and the `context-injection` conversion scenarios that involve owner `file` parts; also verify that a tool-less Run and a compaction without tool declarations both carry an owner attachment as an image part, that adding a 101st image leaves the first 100 attached and byte-identical, that a Run whose prepared request has an unattached image and an earlier-row image takes the threshold compaction variant before its first step while overflow in the triggering message alone does not, and that a failed overflow-only compaction lets the attempt proceed with the limit placeholder
- [x] 2.3 Size image references by `ceil(width × height / 750)` on the model variant in every admission and compaction estimate, excluding image bytes, with `estimateProjectionTokens`, `estimateContinuationTokens`, and the context-window fit check taking the per-Run resolver's descriptor map; verify by unit tests for the `media-attachments` sizing scenarios, including one maximum-size screenshot admitted on a 200,000-token model
- [x] 2.4 Carry owner attachments through model switches, append placeholder lines in `conversation_read` inside the 15,000-code-unit result bound, give title generation the placeholder lines, add the `media://` retention line to the summarization instruction, carry attachments into compaction requests, and omit `file` parts from shared and public forks; verify by unit tests for the `conversation-reads` and `owner-chat-forks` scenarios, the owner-attachment scenarios of the `model-system-prompts` model-switch requirement and the `media-attachments` compaction requirement, a test that search chunking ignores placeholder lines, and a test for the `media-attachments` scenario "An image-only first message can be titled", including a message whose text alone would fill the result bound
- [x] 2.5 Document `models[].input` in `README.md` and the operator media runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 2.6 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [x] 2.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 2.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `vision-media/attachments-api` — owner file parts (design D5)

- [x] 3.1 Accept up to 10 `file` parts with `media://` URLs on the owner send DTO, verify ownership under the sender's identity, rewrite `mediaType` and `filename` from the descriptor, allow a message with file parts and no text, and apply the same rule to the `context-injection` and `temporal-anchor` service-level checks; make the web transcript withhold `file` parts (no "unsupported part type" fallback); regenerate the OpenAPI document and client; verify by API integration tests for an image-only message, a message with neither text nor file parts, a non-media URL, file parts keeping submitted order, a foreign id indistinguishable from an unknown id, 11 parts refused, another owner's id refused before any message row, and a mislabelled `mediaType` rewritten, and by unit tests for the image-only scenarios of the `context-injection` metadata requirement and the `temporal-anchor` forged-row requirement; verify by a search and recency-digest test that an attachment filename is neither searchable nor in the digest excerpt, for the `media-attachments` requirement "Search, the recency digest, and public shares carry no image content"
- [x] 3.2 Prove the end-to-end path with the scripted model client, whose models declare `input` so both branches run: an uploaded image sent in a message reaches the model request as a labelled image part before the text, survives retry and fork, and becomes a placeholder for a text-only model; verify by an integration test
- [x] 3.3 Document the message `file` part and image-only messages in `docs/product/operator/media.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 3.4 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, the touched integration suites, and a clean second OpenAPI generation
- [x] 3.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 3.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `vision-media/vision-read-local` — images through local and media reads (design D4, D6, D7)

- [x] 4.1 Check magic bytes ahead of the first chunk decode in the streaming reader for host, `file:`, `kb://`, and `skill://` regular files; ingest a match with provenance `read`; return the image envelope with the source's attribution, refuse selectors with `invalid_selector`, and keep SVG and other files on the text path; verify by unit tests for every `native-file-tools` local image-read and ingest-refusal scenario except the prompt-import provenance scenario, including a 25 MiB text file read as text, and the `knowledge-tools` notice scenario
- [x] 4.2 Add the `media://` scheme: grammar, reserved bare form, owner-only resolution, `not_found` for another owner's id, read-only operations; add the `media://` projection to permission matching and Workspace projection; verify by unit tests for every `media://` scenario in `native-file-tools`, `tool-call-permissions`, and `workspace-entry`, the `tool-calling` registry scenarios, and an integration test that owner B's Run cannot read owner A's id
- [x] 4.3 Make a `read` image result's `toModelOutput` its text envelope only, and extend the step composer from `model-input` to tool-result references: `content` outputs on the Responses, Codex, and Messages wires, built every step on the final messages after `onStepStart`, with variant bytes loaded only for attached references and newly read images admitted append-only into the epoch; on the Chat Completions wires send attached tool-result images for vision models as the interim `[image media://<id> <name> W×H, omitted: this connection cannot carry tool-result images yet]` until `vision-read-completions` removes it; size tool-result images by the same dimension rule; verify by client tests capturing the request body on each wire, by unit tests for the `tool-calling` observation-budget and truncation scenarios, the tool-result scenarios of `context-injection`, `media-attachments`, and the `model-system-prompts` model-switch requirement, by a scenario where a Run's live reads exceed the epoch bounds and only the newest get the limit placeholder, and by the `media-attachments` sizing scenarios with the image carried by a replayed `read` result; verify that no Chat Completions tool message in this layer carries image content or a re-read hint
- [x] 4.4 Update `apps/api/src/prompts/tools/read.md`, `docs/product/reference/tools/read.md`, and a new `docs/product/reference/locators/media.md` linked from its index; document `^media://` in the domain-restricted `read` alternative of `docs/product/operator/tool-call-permissions.md`; update `SPEC.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 4.5 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter @workspace/native-file-tools test`, the focused unit tests, and the touched integration suites
- [x] 4.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [x] 4.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `vision-media/vision-read-completions` — Chat Completions transport (design D6)

- [x] 5.1 Remove the interim Chat Completions placeholder from `vision-read-local`; on `openai-completions` and `opencode-go`, move the images of consecutive tool results into one synthetic user message `Images from tool results:` after the tool messages, whose text says `(image attached below)`, live through `prepareStep` and in replay; verify by client tests capturing both wires' request bodies that each image is an `image_url` part and never base64 text, and by unit tests for the `media-attachments` Chat Completions scenarios; also verify the `media-attachments` scenario "A text-only Chat Completions model gets no image message"
- [x] 5.2 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [x] 5.3 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [x] 5.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 5.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `vision-media/vision-read-web` — web image bodies (design D7)

- [ ] 6.1 Accept `image/png`, `image/jpeg`, `image/gif`, and `image/webp` web bodies under the 5 MiB bound with matching magic bytes and `method: "image"`, keeping PDF and other types `unsupported_content_type`; verify by web-read tests against a local fixture server for every scenario of "Web reads accept text and image bodies" and the web image scenario of "Web read results carry the final URL and retrieval method", including an `image/png` header over HTML bytes and `:raw` on an image
- [ ] 6.2 Update the web-read operator runbook and `docs/product/reference/tools/read.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 6.3 Verify `pnpm --filter api lint`, `typecheck`, and the focused unit tests
- [ ] 6.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 6.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `vision-media/prompt-import-images` — image entries (design D8)

- [ ] 7.1 Turn an admitted prompt-import image result into an image entry of the `prompt-imports` item whose body is the native image result envelope, counted toward the 8-target bound and outside the 128 KiB text bound, emitted as an image part or placeholder after the item text, and reused on recovery; accept `media://` targets under the host and Knowledge denial and bound rules; record the entry's `media` locator in the payload and accept that key in both exact-key payload validators (API `isPromptImportsPayloadEntry` and web `isPromptImportEntry` with its `PromptImportsPayload` type); add the system-read origin to `ToolContext` so ingest can record provenance `prompt-import`; verify by tests for every scenario of the three `prompt-imports` requirements this change adds, the `context-injection` scenario "A prompt-import image crosses as an image part or a placeholder", a web test that a chip whose payload holds an image entry still lists every outcome, and the `native-file-tools` scenario "A prompt-import read records prompt-import provenance"
- [ ] 7.2 Update `docs/product/reference/prompt-imports.md` or the page that documents prompt imports; add the dated `CHANGELOG.md` entry; this layer completes #935's acceptance, so its PR carries `Closes #935`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 7.3 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 7.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 7.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 8. `vision-media/composer` — attaching images (design D10)

- [ ] 8.1 Add the thumbnail component to `packages/ui` (square `rounded-xl`, remove on hover and focus, progress and error overlays with retry, drag and `Alt+←/→` reorder) with stories for each state; verify with Storybook MCP story tests and return preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [ ] 8.2 Wire paste, the file picker, and drag-and-drop into the composer with immediate upload, the 10-image cap, send disabled while uploading, `file` parts sent in thumbnail order, and the text-only-model block from the published `input`; render read-only thumbnails above sent user bubbles (rewriting `media://<id>` to the `/model` route); leave the existing composer, toolbar, and bubble designs unchanged; verify by component tests and by exercising paste, pick, drop, reorder, retry, and the model block in a browser against a local API
- [ ] 8.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 8.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, and the `packages/ui` checks
- [ ] 8.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 8.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 9. `vision-media/previews-lightbox` — history thumbnails and viewer (design D10, D11)

- [ ] 9.1 Add `yet-another-react-lightbox` with the Zoom plugin to `packages/ui`, wrapped once with `scrollToZoom: true` and `maxZoomPixelRatio: 8`, themed with semantic tokens, with the original/model toggle and caption; add stories; verify with Storybook story tests that plain wheel zoom (also on an image smaller than the viewport), arrow navigation, `Escape`, and the toggle work and focus returns to the opener
- [ ] 9.2 Render thumbnails in the `read` tool card and the prompt-import chip, and open the lightbox over every image of the chat in transcript order (composer-only when opened from the composer); verify by component tests and in a browser across reload, a fork, and an image-only message
- [ ] 9.3 Add a focused product E2E test: paste an image, send it to a scripted vision model, reload, open the lightbox, and switch variants; update the user-facing reference; add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #1166` and references #935; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 9.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, the `packages/ui` checks, and the focused E2E spec
- [ ] 9.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 9.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 10. `vision-media/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the implementation top, before `$openspec-sync-specs`
writes. Its self-review and GitHub review are post-archive
gates, not tasks here.

- [ ] 10.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [ ] 10.2 Confirm `openspec status --change vision-media --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

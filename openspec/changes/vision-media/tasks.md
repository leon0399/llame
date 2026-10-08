Track [#935](https://github.com/leon0399/llame/issues/935) and its PR layers through
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
         <- vision-media/vision-read
         <- vision-media/prompt-import-images
         <- vision-media/composer
         <- vision-media/previews-lightbox
         <- vision-media/finalize
```

| Layer                  | Parent                 | Owns                                                                                                                                                                                          | Estimated authored lines         |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `proposal`             | `master`               | this ledger, the proposal, the design, and the delta specs; closes no issue                                                                                                                   | about 3,850; see the budget note |
| `media-store`          | `proposal`             | the two tables, migration and RLS, `sharp` ingest, the upload and fetch routes, the isolation test, and the operator runbook                                                                  | about 1,900                      |
| `model-input`          | `media-store`          | `models[].input`, its publication, the conversion of stored `file` parts with labels, the image window and placeholders, and the text-only projections                                        | about 1,800                      |
| `attachments-api`      | `model-input`          | `file` parts on the owner send DTO, ownership and descriptor rewriting, image-only messages, and the regenerated OpenAPI client                                                               | about 900                        |
| `vision-read`          | `attachments-api`      | image detection in native `read` on every locator, the `media://` scheme, web image bodies, image tool results and their replay, the Chat Completions transform, and permission locator rules | about 2,000                      |
| `prompt-import-images` | `vision-read`          | image entries in the `prompt-imports` item                                                                                                                                                    | about 500                        |
| `composer`             | `prompt-import-images` | composer thumbnails, paste, picker, drag-and-drop, upload states, reorder, and the text-only-model block                                                                                      | about 1,500                      |
| `previews-lightbox`    | `composer`             | sent-message and read-tool thumbnails, the lightbox and its variant toggle; closes #935                                                                                                       | about 1,500                      |
| `finalize`             | `previews-lightbox`    | spec synchronization, task records, and archive movement only                                                                                                                                 | under 400                        |

Dependencies and budget:

- `prompt-import-images` needs the `import-markers` implementation (#1146 and its layers) on `master`.
  If that has not merged when `vision-read` is ready, move `prompt-import-images` to the top of the
  stack, below `finalize`. `Closes #935` then moves with it, because that layer completes the
  acceptance.
- `finalize` runs after `import-markers/finalize`, so `prompt-imports` exists when this change's
  ADDED requirement syncs.
- `vision-read` sits at the review budget. If it exceeds about 2,000 authored lines, split it into
  `vision-read-local` (host, `file:`, `kb://`, `skill://`, `media://`, tool-result replay, and the
  Chat Completions transform) below `vision-read-web` (web image bodies). Decide the split, or name an
  exception, before publication.
- `proposal` is a named exception to the review budget: 17 capability deltas, of which about
  2,100 lines are MODIFIED blocks that restate canonical requirements verbatim with one- or
  two-sentence edits. Splitting the proposal would publish an incomplete contract.
- Generated output (Drizzle snapshot, OpenAPI document and client, lockfile) counts zero and is
  reported separately.

Each layer leaves the repository shippable:

- After `media-store`, media can be uploaded and fetched, but nothing references it.
- After `attachments-api`, the API accepts and replays attachments.
- The web client gains attachments in `composer`.
- The web client renders them in history in `previews-lightbox`.

Each shipping layer adds its own documentation and dated `CHANGELOG.md` entry.

## 0. `vision-media/proposal` — planning artifacts

- [ ] 0.1 Run the review rounds Leo requests on the proposal, design, and delta specs; verify each finding against the repository and cited upstream sources; commit each round separately and record it in the PR body
- [ ] 0.2 Verify every MODIFIED and RENAMED block against its canonical requirement with a sentence-level diff, keeping every canonical scenario heading verbatim
- [ ] 0.3 Verify `pnpm exec openspec validate vision-media --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`
- [ ] 0.4 SR: self-review the PR diff, fix accepted findings, then mark ready for Leo's approval
- [ ] 0.5 GR: complete the ready-PR monitoring loop and obtain Leo's approval of the published revision before creating `vision-media/media-store`

## 1. `vision-media/media-store` — store, ingest, routes (design D1–D4)

- [ ] 1.1 Add `media_objects` and `media_blobs` to the Drizzle schema with enabled and forced owner RLS, generate the migration, and extend RLS provisioning; verify `pnpm db:migrate` and `pnpm db:provision-rls` on a fresh database and an API integration test that owner B cannot select, insert against, or update owner A's rows
- [ ] 1.2 Add `sharp` to `apps/api` and implement ingest: 20 MiB pre-decode refusal, magic-byte detection of PNG, JPEG, GIF, and WebP, a 40-megapixel header check, original storage, the model variant (orientation, metadata strip, first frame, 2000 px long edge, PNG then JPEG q85 then 0.75 downscale steps under 3.75 MiB), SHA-256 per-owner dedup, and the neutralized 256-character source label; verify by unit tests over fixture files for every `media-store` ingest scenario, including SVG, HTML renamed `.png`, a 41-megapixel PNG header, a 21 MiB file, an EXIF-rotated JPEG, and an animated GIF
- [ ] 1.3 Add `POST /api/v1/media` (one multipart file, its own body limit) and `GET /api/v1/media/:id`, `/original`, and `/model` with the stored type, `nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: sandbox`, and immutable private caching; regenerate the OpenAPI document and web client; verify by API integration tests for upload, dedup, fetch headers, unauthenticated `401`, and another owner's id as `404` on every route
- [ ] 1.4 Write `docs/product/operator/media.md` (storage in Postgres, growth and backup cost, bounds, formats, `sharp` platform support, the no-deletion gap) and link it from the operator index; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 1.5 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 1.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 1.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 2. `vision-media/model-input` — input declaration and projections (design D6, D9)

- [ ] 2.1 Add `models[].input` to the raw and resolved config, the published schema, the loader (closed set, must contain `text`, no duplicates, default `["text"]`), and `llame.config.jsonc.example`; publish `input` on every `GET /api/v1/models` entry; verify by loader tests for each `instance-config` scenario and an API test for the `available-models` scenarios
- [ ] 2.2 Map stored owner `file` parts at the SDK conversion boundary: labels and image parts after rail items and the temporal row and before the text, model variants loaded under the Run owner's identity, the image window (20 images, 24 MiB base64, newest first across user messages and tool results), placeholders for out-of-window images, non-vision models, and unresolvable ids; verify by unit tests seeding stored parts for every `media-attachments` projection scenario and the `context-injection` conversion scenarios
- [ ] 2.3 Carry images and placeholders through model switches, append placeholder lines in `conversation_read`, give title generation the placeholder lines, add the `media://` retention line to the summarization instruction, and omit `file` parts from shared and public forks; verify by unit tests for the `conversation-reads`, `model-system-prompts`, and `owner-chat-forks` scenarios and a test that search chunking ignores placeholder lines
- [ ] 2.4 Document `models[].input` in `README.md` and the operator media runbook; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 2.5 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 2.6 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 2.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `vision-media/attachments-api` — owner file parts (design D5)

- [ ] 3.1 Accept up to 10 `file` parts with `media://` URLs on the owner send DTO, verify ownership under the sender's identity, rewrite `mediaType` and `filename` from the descriptor, allow a message with file parts and no text, and apply the same rule to the `context-injection` and `temporal-anchor` service-level checks; regenerate the OpenAPI document and client; verify by API integration tests for an image-only message, 11 parts refused, another owner's id refused before any message row, and a mislabelled `mediaType` rewritten
- [ ] 3.2 Prove the end-to-end path with the scripted model client: an uploaded image sent in a message reaches the model request as a labelled image part before the text, survives retry and fork, and becomes a placeholder for a text-only model; verify by an integration test
- [ ] 3.3 Document the message `file` part and image-only messages in `docs/product/operator/media.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 3.4 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, the touched integration suites, and a clean second OpenAPI generation
- [ ] 3.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 3.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `vision-media/vision-read` — images through native read (design D4, D6, D7)

- [ ] 4.1 Check magic bytes before UTF-8 decoding for host, `file:`, `kb://`, and `skill://` regular files; ingest a match with provenance `read`; return the image envelope with the source's attribution, refuse selectors with `invalid_selector`, and keep SVG and other files on the text path; verify by unit tests for every `native-file-tools` image-read scenario and the `knowledge-tools` notice scenario
- [ ] 4.2 Add the `media://` scheme: grammar, reserved bare form, owner-only resolution, `not_found` for another owner's id, read-only operations; add the `media://` projection to permission matching and Workspace projection; verify by unit tests for every `media://` scenario in `native-file-tools`, `tool-call-permissions`, and `workspace-entry`, and an integration test that owner B's Run cannot read owner A's id
- [ ] 4.3 Accept `image/png`, `image/jpeg`, `image/gif`, and `image/webp` web bodies under the 5 MiB bound with matching magic bytes and `method: "image"`, keeping PDF and other types `unsupported_content_type`; verify by web-read tests against a local fixture server, including an `image/png` header over HTML bytes and `:raw` on an image
- [ ] 4.4 Return image results as `content` tool outputs and replay them from stored parts within the image window; on `openai-completions` and `opencode-go`, move tool-result images into one synthetic user message after consecutive tool messages, live through `onStepStart` and in replay; verify by client tests capturing the request body on each of the five wires that the image is an image block and never base64 text
- [ ] 4.5 Update `apps/api/src/prompts/tools/read.md` `docs/product/reference/tools/read.md`, and a new `docs/product/reference/locators/media.md` linked from its index; update `SPEC.md`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 4.6 Verify `pnpm --filter api lint`, `typecheck`, `pnpm --filter @workspace/native-file-tools test`, the focused unit tests, and the touched integration suites
- [ ] 4.7 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 4.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `vision-media/prompt-import-images` — image entries (design D8)

- [ ] 5.1 Turn an admitted prompt-import image result into an image entry of the `prompt-imports` item, counted toward the 8-target bound and outside the 128 KiB text bound, emitted as an image part after the item text, and reused on recovery; verify by tests for every scenario of the `prompt-imports` image requirement
- [ ] 5.2 Update the prompt-imports reference page shipped by `import-markers`; add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 5.3 Verify `pnpm --filter api lint`, `typecheck`, the focused unit tests, and the touched integration suites
- [ ] 5.4 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 5.5 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `vision-media/composer` — attaching images (design D10)

- [ ] 6.1 Add the thumbnail component to `packages/ui` (square `rounded-xl`, remove on hover and focus, progress and error overlays with retry, drag and `Alt+←/→` reorder) with stories for each state; verify with Storybook MCP story tests and return preview URLs, or the Storybook CLI fallback when MCP is unavailable
- [ ] 6.2 Wire paste, the file picker, and drag-and-drop into the composer with immediate upload, the 10-image cap, send disabled while uploading, `file` parts sent in thumbnail order, and the text-only-model block from the published `input`; leave the existing composer, toolbar, and bubble designs unchanged; verify by component tests and by exercising paste, pick, drop, reorder, retry, and the model block in a browser against a local API
- [ ] 6.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 6.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, and the `packages/ui` checks
- [ ] 6.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 6.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. `vision-media/previews-lightbox` — history thumbnails and viewer (design D10, D11)

- [ ] 7.1 Add `yet-another-react-lightbox` with the Zoom plugin to `packages/ui`, wrapped once, themed with semantic tokens, with the original/model toggle and caption; add stories; verify with Storybook story tests that wheel zoom, arrow navigation, `Escape`, and the toggle work and focus returns to the opener
- [ ] 7.2 Render read-only thumbnails above sent user bubbles and in the `read` tool card and prompt-import chip, and open the lightbox over every image of the chat in transcript order (composer-only when opened from the composer); verify by component tests and in a browser across reload, a fork, and an image-only message
- [ ] 7.3 Add a focused product E2E test: paste an image, send it to a scripted vision model, reload, open the lightbox, and switch variants; update the user-facing reference; add the dated `CHANGELOG.md` entry; this layer's PR carries `Closes #935`; verify `pnpm lint:markdown` and `pnpm format:check`
- [ ] 7.4 Verify `pnpm --filter web lint`, `typecheck`, the focused unit tests, the `packages/ui` checks, and the focused E2E spec
- [ ] 7.5 SR: self-review the parent-relative diff, fix accepted findings, then mark ready
- [ ] 7.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 8. `vision-media/finalize` — spec sync and archive

Enter this layer with `$gh-stack` from the implementation top, after `import-markers/finalize` has
merged, and before `$openspec-sync-specs` writes. Its self-review and GitHub review are post-archive
gates, not tasks here.

- [ ] 8.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; verify both pass
- [ ] 8.2 Confirm `openspec status --change vision-media --json` and this file show every task complete, run `$openspec-archive-change`, and verify `git diff --check` is clean

## 1. Prompt assets and instance configuration

- [x] 1.1 Add `apps/api/src/prompts/chat-default.md` as a moderately detailed baseline covering llame's role, instruction priority, concise behavior, tool-use expectations, and transparency boundaries; do not copy or attempt a comprehensive vendor prompt. Configure Nest to package the asset and add a test that the built runtime can load it.
- [x] 1.2 Add failing instance-config schema/loader tests for optional `models[].systemPromptFile`, config-directory-relative and absolute resolution, line-ending normalization, trailing-whitespace normalization, and default-prompt selection when omitted.
- [x] 1.3 Implement the dedicated prompt-file loader and resolved model prompt/source fields without reusing `{path:...}` secret interpolation or retaining resolved host paths in the public model catalog.
- [x] 1.4 Add failing startup tests for missing, unreadable, non-file, and empty overrides and for a missing/empty packaged default; implement fail-loud diagnostics that name the model and field without logging prompt contents.
- [x] 1.5 Add failing tests and implement single-pass rendering for `${model.id}`, `${model.name}`, and the `$${model.name}` literal escape in both default and override files; fail startup for absent referenced names and every other `${...}` expression, without exposing prompt contents or server-only config.
- [x] 1.6 Update `apps/api/llame.config.json.example`, JSON Schema descriptions, and operator configuration documentation with independent whole-prompt overrides, the exact three interpolation forms, and the no-silent-fallback rule; record [`system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) as research provenance without embedding its prompt bodies in runtime assets.

## 2. Immutable effective-context storage

- [x] 2.1 Add failing schema tests for owner-scoped immutable model-context snapshots, deterministic prompt/tool hashes, and an owner-constrained run reference.
- [x] 2.2 Define the Drizzle snapshot schema and run relationship, then generate—not hand-write—the migration with `ENABLE`/`FORCE` RLS, owner-only policy, owner-constrained foreign keys, and owner-local content-addressing constraints.
- [x] 2.3 Add RLS harness coverage proving cross-tenant snapshot reads, inserts, reuse, and run bindings fail closed, including under the owning database role.
- [x] 2.4 Implement repository methods to create or reuse an owner-local snapshot and retrieve it through an owned run, without storing or returning prompt-file paths.

## 3. Enqueue-time context binding

- [x] 3.1 Add failing unit tests for canonicalizing the selected model's effective prompt plus advertised tool ids, descriptions, and input schemas into a stable manifest and content hash.
- [x] 3.2 Implement an effective-context resolver that intersects the operator tool allowlist with the trusted registry and emits the canonical snapshot payload for the selected model.
- [x] 3.3 Add failing chat-loop transaction tests proving the user message, immutable context snapshot binding, and queued run commit atomically and roll back together on failure.
- [x] 3.4 Bind every new run to its resolved snapshot at enqueue, reusing identical snapshots only within the owner and preserving the existing strict selected-model validation.
- [x] 3.5 Add tests proving a configured prompt or tool declaration change affects later runs only and cannot mutate an already-bound queued or retried run.

## 4. Model-switch semantic boundary

- [x] 4.1 Add the trusted `data-model-context` message-part type and failing persistence/DTO tests that reject or discard client-authored copies while allowing server-authored switch metadata.
- [x] 4.2 Add failing chat-loop tests for no marker on the first run, no marker for the same model, an `A` to `B` marker for a changed selection, and comparison against a failed prior run's durable model id.
- [x] 4.3 Persist the model-switch part atomically on the triggering user message by comparing the new selection with the most recent prior run in that chat.
- [x] 4.4 Add failing context-builder tests for the exact canonical current-model-only reminder, XML-safe current model ids, omission of the previous id from model-facing prose, placement immediately before the triggering user text, preservation on later reconstructions, and removal with compacted-away history.
- [x] 4.5 Serialize trusted switch parts into the model-facing reminder while keeping the canonical portable projection of visible user/assistant text and typed checkpoints, and excluding persisted system messages, literal reminder text, the previous model's prompt, reasoning, provider-native metadata, and display-only tool activity/results.
- [x] 4.6 Add target-window preflight tests for a smaller-context switch, including the configured context window, reserved output budget, and a cutoff that excludes the triggering user message from transition compaction.
- [x] 4.7 Add failing run-state tests for unavailable source execution, failed transition compaction, and an over-window public-chat fork; implement the structured `context_incompatible` failure before the target provider call with no truncation, implicit fallback, or cross-owner snapshot access.

## 5. Snapshot-driven execution

- [x] 5.1 Add failing run-execution tests proving the worker reads the bound top-level prompt and advertised tool contract instead of `CHAT_SYSTEM_PROMPT`, live prompt files, or newly resolved tool declarations.
- [x] 5.2 Build the model tool set from snapshotted declarations and stable trusted executor ids, failing before the provider call when an executor is absent or incompatible.
- [x] 5.3 Replace the hardcoded system prompt path with snapshot-driven execution and remove `CHAT_SYSTEM_PROMPT` only after equivalent default behavior is covered.
- [x] 5.4 Add integration coverage that a model switch sends the target prompt, target tools, portable old history, canonical reminder, and new user text in the required order, with no runtime model fallback on target failure.

## 6. Compaction continuity

- [x] 6.1 Extend `ModelStreamInput` with provider-neutral `toolChoice`, then add failing compaction tests proving the summarization call uses the completed run's selected model, exact bound effective system prompt, byte-equivalent schema-only tool declarations, and `toolChoice: "none"` without executor functions or the dedicated title-generation prompt.
- [x] 6.2 Add a negative provider-result test proving a tool call returned despite `toolChoice: "none"` executes nothing and prevents the compaction checkpoint from being persisted.
- [x] 6.3 Replace the prose-only compaction instruction with the accepted stable Markdown section contract and add validation/fixtures for non-empty text output.
- [x] 6.4 Add failing context-builder tests for the deterministic typed user-role `conversation-checkpoint`, historical-data framing, retained-recent ordering, and current-run top-level prompt/tool placement; implement the wrapper without storing it as a human-authored message.
- [x] 6.5 Add the dedicated transition-`up_to` instruction and tests proving it summarizes only through the last assistant turn, preserves unresolved state and critical references, and does not invent a next step that may conflict with the unseen triggering user turn.
- [x] 6.6 Add integration coverage for a smaller-context model switch after transition compaction, proving the source snapshot generates the portable checkpoint and the target prompt replaces the source prompt while the switch reminder stays attached to the new user turn.

## 7. Owner context-receipt API and projection safety

- [x] 7.1 Add failing controller/service tests for `GET /api/v1/runs/:runId/context-receipt`, including the exact owner-visible fields, not-found semantics for non-owners, and absence of paths, provider model ids, credentials, executors, and authorization context.
- [x] 7.2 Implement the owner-scoped receipt DTO, repository query, endpoint, and OpenAPI annotations; expose the originating run id in owner-only assistant-turn metadata.
- [x] 7.3 Add negative public-share and Markdown-export tests, then strip model-context parts, receipt references, checkpoints, and effective-context contents from those projections.
- [x] 7.4 Add search chunker/rebuild tests using distinctive model ids, reminder prose, prompt text, tool-schema text, generated compaction-summary text, and checkpoint-envelope text, proving none can be matched or excerpted while canonical original conversation text remains searchable.

## 8. Transparent web UI

- [x] 8.1 Add typed web service support for switch parts, owner-only run metadata, and on-demand context-receipt retrieval without embedding receipt contents in chat history responses.
- [x] 8.2 Add component tests and stories for a compaction-aligned collapsed model-switch boundary immediately before the triggering user message, including ellipsized long model ids with conditional full-value tooltips and keyboard/screen-reader behavior.
- [x] 8.3 Implement the expandable switch explanation and shared effective-context inspector showing source label, complete prompt, tool descriptions/schemas, hash, and timestamp without any host path.
- [x] 8.4 Add an “Effective context” action near each owner-visible assistant turn's model/usage metadata and verify same-model turns do not render a switch boundary.
- [x] 8.5 Add an authenticated browser test covering a model change, boundary placement, receipt expansion, prompt/tool visibility, and absence of reminders, prompts, and generated compaction summaries from chat-search results.

## 9. Verification and project documentation

- [x] 9.1 Regenerate and verify the committed OpenAPI document and handwritten typed web API contract after the receipt and history-contract changes; client/SDK code generation remains deferred by `SPEC.md` §22.0.
- [x] 9.2 Update `SPEC.md` authority links, focused operator/user documentation, `ROADMAP.md`, and `CHANGELOG.md` in the implementation PR without duplicating normative OpenSpec behavior; keep concrete per-model prompt authoring and eval-driven refinement as explicit follow-up work.
- [x] 9.3 Run focused API, RLS, search, web, Storybook, and E2E tests for the changed surfaces and record exact commands/results.
- [x] 9.4 Run repository `pnpm format:check`, `pnpm lint`, `pnpm build`, and the relevant full test suites; resolve all failures attributable to this change before requesting review.

### Verification record — 2026-07-18

- `TEST_DATABASE_URL=postgres://app:app@127.0.0.1:55492/llame_test pnpm --filter api exec jest --runInBand src/runs/model-context-snapshots.integration.spec.ts src/chats/chats-search.integration.spec.ts src/compaction/compaction-context.integration.spec.ts` — 3 suites, 35 tests passed.
- `pnpm --filter storybook test:storybook` — 14 files, 64 browser tests passed.
- `nix shell nixpkgs#postgresql_17 --command env POSTGRES_URL=postgres://app:app@127.0.0.1:55492/llame_test pnpm exec playwright test e2e/chat/model-context-transparency.spec.ts --workers=1` — 1 authenticated full-stack test passed.
- `pnpm test` — repository unit suites passed (web: 53 files/326 tests; API: 49 suites/484 tests before the final API regression); final `pnpm --filter api test` passed 49 suites/485 tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm --filter api db:check`, `openspec validate model-specific-system-prompts --strict`, and `git diff --check` passed. The sandboxed build first hit Turbopack's localhost-binding `EPERM`; the required escalated rerun passed all three build tasks.
- `pnpm format:check` reports only 15 unrelated untracked `.codex`/`.opencode` files already present in the worktree; task-owned files pass scoped Prettier checks and were not mixed with those local assets.

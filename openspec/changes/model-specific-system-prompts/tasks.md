## 1. Prompt assets and instance configuration

- [ ] 1.1 Add `apps/api/src/prompts/chat-default.md` as a moderately detailed baseline covering llame's role, instruction priority, concise behavior, tool-use expectations, and transparency boundaries; do not copy or attempt a comprehensive vendor prompt. Configure Nest to package the asset and add a test that the built runtime can load it.
- [ ] 1.2 Add failing instance-config schema/loader tests for optional `models[].systemPromptFile`, config-directory-relative and absolute resolution, line-ending normalization, trailing-whitespace normalization, and default-prompt selection when omitted.
- [ ] 1.3 Implement the dedicated prompt-file loader and resolved model prompt/source fields without reusing `{path:...}` secret interpolation or retaining resolved host paths in the public model catalog.
- [ ] 1.4 Add failing startup tests for missing, unreadable, non-file, and empty overrides and for a missing/empty packaged default; implement fail-loud diagnostics that name the model and field without logging prompt contents.
- [ ] 1.5 Add failing tests and implement single-pass rendering for `${model.id}`, `${model.name}`, and the `$${model.name}` literal escape in both default and override files; fail startup for absent referenced names and every other `${...}` expression, without exposing prompt contents or server-only config.
- [ ] 1.6 Update `llame.config.example.json`, JSON Schema descriptions, and operator configuration documentation with independent whole-prompt overrides, the exact three interpolation forms, and the no-silent-fallback rule; record [`system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) as research provenance without embedding its prompt bodies in runtime assets.

## 2. Immutable effective-context storage

- [ ] 2.1 Add failing schema tests for owner-scoped immutable model-context snapshots, deterministic prompt/tool hashes, and an owner-constrained run reference.
- [ ] 2.2 Define the Drizzle snapshot schema and run relationship, then generate—not hand-write—the migration with `ENABLE`/`FORCE` RLS, owner-only policy, owner-constrained foreign keys, and owner-local content-addressing constraints.
- [ ] 2.3 Add RLS harness coverage proving cross-tenant snapshot reads, inserts, reuse, and run bindings fail closed, including under the owning database role.
- [ ] 2.4 Implement repository methods to create or reuse an owner-local snapshot and retrieve it through an owned run, without storing or returning prompt-file paths.

## 3. Enqueue-time context binding

- [ ] 3.1 Add failing unit tests for canonicalizing the selected model's effective prompt plus advertised tool ids, descriptions, and input schemas into a stable manifest and content hash.
- [ ] 3.2 Implement an effective-context resolver that intersects the operator tool allowlist with the trusted registry and emits the canonical snapshot payload for the selected model.
- [ ] 3.3 Add failing chat-loop transaction tests proving the user message, immutable context snapshot binding, and queued run commit atomically and roll back together on failure.
- [ ] 3.4 Bind every new run to its resolved snapshot at enqueue, reusing identical snapshots only within the owner and preserving the existing strict selected-model validation.
- [ ] 3.5 Add tests proving a configured prompt or tool declaration change affects later runs only and cannot mutate an already-bound queued or retried run.

## 4. Model-switch semantic boundary

- [ ] 4.1 Add the trusted `data-model-context` message-part type and failing persistence/DTO tests that reject or discard client-authored copies while allowing server-authored switch metadata.
- [ ] 4.2 Add failing chat-loop tests for no marker on the first run, no marker for the same model, an `A` to `B` marker for a changed selection, and comparison against a failed prior run's durable model id.
- [ ] 4.3 Persist the model-switch part atomically on the triggering user message by comparing the new selection with the most recent prior run in that chat.
- [ ] 4.4 Add failing context-builder tests for the exact canonical current-model-only reminder, XML-safe current model ids, omission of the previous id from model-facing prose, placement immediately before the triggering user text, preservation on later reconstructions, and removal with compacted-away history.
- [ ] 4.5 Serialize trusted switch parts into the model-facing reminder while keeping the canonical portable projection of visible user/assistant text and typed checkpoints, and excluding persisted system messages, literal reminder text, the previous model's prompt, reasoning, provider-native metadata, and display-only tool activity/results.
- [ ] 4.6 Add target-window preflight tests for a smaller-context switch, including the configured context window, reserved output budget, and a cutoff that excludes the triggering user message from transition compaction.
- [ ] 4.7 Add failing run-state tests for unavailable source execution, failed transition compaction, and an over-window public-chat fork; implement the structured `context_incompatible` failure before the target provider call with no truncation, implicit fallback, or cross-owner snapshot access.

## 5. Snapshot-driven execution

- [ ] 5.1 Add failing run-execution tests proving the worker reads the bound top-level prompt and advertised tool contract instead of `CHAT_SYSTEM_PROMPT`, live prompt files, or newly resolved tool declarations.
- [ ] 5.2 Build the model tool set from snapshotted declarations and stable trusted executor ids, failing before the provider call when an executor is absent or incompatible.
- [ ] 5.3 Replace the hardcoded system prompt path with snapshot-driven execution and remove `CHAT_SYSTEM_PROMPT` only after equivalent default behavior is covered.
- [ ] 5.4 Add integration coverage that a model switch sends the target prompt, target tools, portable old history, canonical reminder, and new user text in the required order, with no runtime model fallback on target failure.

## 6. Compaction continuity

- [ ] 6.1 Extend `ModelStreamInput` with provider-neutral `toolChoice`, then add failing compaction tests proving the summarization call uses the completed run's selected model, exact bound effective system prompt, byte-equivalent schema-only tool declarations, and `toolChoice: "none"` without executor functions or the dedicated title-generation prompt.
- [ ] 6.2 Add a negative provider-result test proving a tool call returned despite `toolChoice: "none"` executes nothing and prevents the compaction checkpoint from being persisted.
- [ ] 6.3 Replace the prose-only compaction instruction with the accepted stable Markdown section contract and add validation/fixtures for non-empty text output.
- [ ] 6.4 Add failing context-builder tests for the deterministic typed user-role `conversation-checkpoint`, historical-data framing, retained-recent ordering, and current-run top-level prompt/tool placement; implement the wrapper without storing it as a human-authored message.
- [ ] 6.5 Add the dedicated transition-`up_to` instruction and tests proving it summarizes only through the last assistant turn, preserves unresolved state and critical references, and does not invent a next step that may conflict with the unseen triggering user turn.
- [ ] 6.6 Add integration coverage for a smaller-context model switch after transition compaction, proving the source snapshot generates the portable checkpoint and the target prompt replaces the source prompt while the switch reminder stays attached to the new user turn.

## 7. Owner context-receipt API and projection safety

- [ ] 7.1 Add failing controller/service tests for `GET /api/v1/runs/:runId/context-receipt`, including the exact owner-visible fields, not-found semantics for non-owners, and absence of paths, provider model ids, credentials, executors, and authorization context.
- [ ] 7.2 Implement the owner-scoped receipt DTO, repository query, endpoint, and OpenAPI annotations; expose the originating run id in owner-only assistant-turn metadata.
- [ ] 7.3 Add negative public-share and Markdown-export tests, then strip model-context parts, receipt references, checkpoints, and effective-context contents from those projections.
- [ ] 7.4 Add search chunker/rebuild tests using distinctive model ids, reminder prose, prompt text, tool-schema text, generated compaction-summary text, and checkpoint-envelope text, proving none can be matched or excerpted while canonical original conversation text remains searchable.

## 8. Transparent web UI

- [ ] 8.1 Add typed web service support for switch parts, owner-only run metadata, and on-demand context-receipt retrieval without embedding receipt contents in chat history responses.
- [ ] 8.2 Add component tests and stories for a compaction-aligned collapsed model-switch boundary immediately before the triggering user message, including long model ids and keyboard/screen-reader behavior.
- [ ] 8.3 Implement the expandable switch explanation and shared effective-context inspector showing source label, complete prompt, tool descriptions/schemas, hash, and timestamp without any host path.
- [ ] 8.4 Add an “Effective context” action near each owner-visible assistant turn's model/usage metadata and verify same-model turns do not render a switch boundary.
- [ ] 8.5 Add an authenticated browser test covering a model change, boundary placement, receipt expansion, prompt/tool visibility, and absence of reminders, prompts, and generated compaction summaries from chat-search results.

## 9. Verification and project documentation

- [ ] 9.1 Regenerate and verify the committed OpenAPI document and generated web API types after the receipt and history-contract changes.
- [ ] 9.2 Update `SPEC.md` authority links, focused operator/user documentation, `ROADMAP.md`, and `CHANGELOG.md` in the implementation PR without duplicating normative OpenSpec behavior; keep concrete per-model prompt authoring and eval-driven refinement as explicit follow-up work.
- [ ] 9.3 Run focused API, RLS, search, web, Storybook, and E2E tests for the changed surfaces and record exact commands/results.
- [ ] 9.4 Run repository `pnpm format:check`, `pnpm lint`, `pnpm build`, and the relevant full test suites; resolve all failures attributable to this change before requesting review.

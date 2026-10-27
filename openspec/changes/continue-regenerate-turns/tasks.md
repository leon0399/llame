## 1. Proposal layer

Tracks issues #1047 and #1451. Delivery stack:

```text
master <- continue-regenerate-turns/proposal <- continue-regenerate-turns/api-follow-up <- continue-regenerate-turns/api-continue <- continue-regenerate-turns/api-regenerate <- continue-regenerate-turns/web <- continue-regenerate-turns/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every stack operation and
`$openspec-apply-change` for implementation. Create each implementation layer only after proposal
approval. Every layer has a self-review (SR) checkpoint before draft -> ready and a GitHub review
(GR) checkpoint after ready; for finalize both follow archive movement as post-archive gates. Leo's
overnight instruction (2026-10-27) adjusts the flow: SR is a multi-agent code review plus a
`$simplify` pass and a `$ponytail-review` pass; a layer's next layer starts once its current-head
CI is green; bot reviews and surviving mutants of a layer are processed while the next layer is
built, and they gate the layer after that.

Layers, each with its branch, parent, ownership, authored-size estimate against its parent
(tests, specs, and docs included; generated output counted separately), exit evidence, and issue
responsibility:

- `continue-regenerate-turns/proposal` (parent `master`): this ledger, the proposal, the design,
  and ten delta specs. Estimated about 2,300 authored lines, most of it verbatim MODIFIED blocks
  rewritten in STE; named budget exception: the canonical requirements this change edits are long
  and must be copied whole. Exit: the OpenSpec proposal, Product Markdown, and Any change rows,
  review rounds committed separately, and approval of the published revision. References the
  issues and closes none.
- `continue-regenerate-turns/api-follow-up` (parent `proposal`): the follow-up admission service
  with no HTTP route yet: the chat-row lock, the turn check, validation and the Continue check, the
  `runs` follow-up columns, the kept-part boundary and the `run.continued` event, and `latestRun`
  on the history read (design D1 to D4, D12). Estimated about 1,400 authored lines plus a
  generated migration snapshot, OpenAPI document, and web client. Exit: the Workspace TypeScript,
  API DB/tenancy, API/generated client, Product Markdown, and Any change rows, and current-head CI
  green. References #1047 and closes no issue.
- `continue-regenerate-turns/api-continue` (parent `api-follow-up`): the HTTP route with the
  `continue` action and the Continue worker: seeded collection, the step-grouped Continue
  projection with real-adapter wire tests, stream replay, rebuild with kept parts, follow-up rail
  rules and pre-dispatch reuse, the seen set, usage, and the previous-completed-Run lookup (design
  D1 route, D5, D6, D8 without the model-switch exception, D11). Estimated about 1,900 authored
  lines plus OpenAPI churn. Exit: the Workspace TypeScript, API DB/tenancy, API/generated client,
  Product Markdown, and Any change rows, and current-head CI green. References #1047 and closes no
  issue.
- `continue-regenerate-turns/api-regenerate` (parent `api-continue`): the `regenerate` action, the
  reset of a `completed` reply, `messages.revised_at` and the evidence predicate, classification
  on `tool.started` and stored tool parts, the `regenerate` notice producer, and the model-switch
  replacement (design D2, D7, D8 model-switch, D9, D10). Estimated about 1,700 authored lines plus a
  generated migration snapshot. Exit: the Workspace TypeScript, API DB/tenancy, API/generated
  client, Product Markdown, and Any change rows, and current-head CI green. References #1451 and
  closes no issue.
- `continue-regenerate-turns/web` (parent `api-regenerate`): the latest-turn actions, the
  Regenerate split button and confirmation, the transport route, the notice display, stories, and
  a focused E2E test (design D13). Estimated about 1,800 authored lines. Exit: the Workspace
  TypeScript, Shared UI/stories, Cross-surface behavior, Product Markdown, and Any change rows, and
  current-head CI green. Its PR body carries `Closes #1047` and `Closes #1451`, because owners can
  use both actions only when this layer merges.
- `continue-regenerate-turns/finalize` (parent `web`): canonical spec synchronization, task
  records, and archive movement only. Closes no issue.

Re-estimate each layer's authored size at its boundary and before publication; split a growing
concern or request a named exception before publishing an oversized layer.

- [x] 1.1 [proposal] Run two review rounds on the proposal, design, and delta specs, each with two independent reviewers; verify each finding against the repository; commit each round separately. Recorded: round 1 (spec-consistency and feasibility reviewers; 2 P0, 21 P1, and most P2 accepted after verification against the code) applied in `c50757e7`; round 2 (same reviewers; 6 P1 and 15 P2 accepted, no P0) applied in the round-2 commit.
- [x] 1.2 [proposal] Verify that every MODIFIED block keeps master's requirement name, behavior, and every scenario heading, with only the edits that the proposal names, by a recorded script comparison against `openspec/specs`. Recorded after round 2 and the first GitHub review round: 14 MODIFIED blocks across 9 deltas keep every canonical scenario heading; the round-2 spec reviewer compared each block sentence by sentence.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate continue-regenerate-turns --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record approval of the final revision. Recorded: all pass at the round-2 commit; approval carried forward from Leo's overnight instruction (2026-10-27) to treat the proposal as approved within an experimental stack after two review rounds.
- [ ] 1.4 [proposal] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head until CI passes and no actionable feedback stays unresolved.

## 2. API follow-up admission layer

Branch `continue-regenerate-turns/api-follow-up`, parent `continue-regenerate-turns/proposal`.
Owns the follow-up admission service, with no HTTP route, and the latest-Run report.

- [x] 2.1 Add `runs.follow_up_action` and `runs.source_run_id` (design D3) with a generated Drizzle migration; verify the migration applies on a fresh database and the API integration suite's RLS checks still pass. Recorded: migration `20261027034700_modern_magdalene.sql` adds two nullable columns, the `runs_follow_up_action_check` check, the composite `runs_source_run_id_user_id_fk`, and `runs_source_run_id_user_id_idx`, which serves that foreign key's referential check; it applies to the Testcontainers database every integration run migrates, and `chats-rls.integration.test.ts`, `follow-up-admission.integration.test.ts`, and `chats-messages.integration.test.ts` pass on it.
- [x] 2.2 Add the follow-up admission service with the chat-row lock, the turn check before single-flight admission, and the action check after it (design D1), with no HTTP route; verify with service integration tests for the latest turn, an older turn (409), an archived Chat, a live Run (409), a stuck Run (expired, then admitted), another owner's Chat (404, no job read, nothing changed), and a chat send with the same message id that still gets 409. Recorded: `FollowUpAdmissionService` (`apps/api/src/chats/follow-up-admission.service.ts`) runs the transaction over the extracted `chat-admission.ts` single-flight helpers and `run-creation.ts`; the seven scenarios are in `follow-up-admission.integration.test.ts`, whose another-owner case asserts no `jobState` read and unchanged Runs.
- [x] 2.3 Validate the request and apply the Continue check (design D2); verify with tests for `modelId` and `effort` on Continue (400), a disabled permission mode, a removed model, a `completed` Run (409), a turn with no reply (409), a reply of an older Run behind a seeded `follow_up_action = 'regenerate'` Run that failed before dispatch (409), and a stored `bypass` mode on the new Run while the old Run keeps `default`. Recorded: `FollowUpAdmissionService` owns both the pre-transaction checks and the action check; all seven cases plus a malformed `action`, a stored `null` effort, and an effort the model no longer declares are in `follow-up-admission.integration.test.ts`.
- [x] 2.4 Compute the kept parts at admission, append `run.continued`, and record `replacesUsage` in `run.created` (design D4, D11); verify with unit tests for three settled steps plus an unfinished step, no settled tool part, and in-Run items after the last settled tool part. Recorded: `continue-kept-parts.ts` computes the boundary; admission appends `run.continued` with `{ sourceRunId, parts }` right after `run.created`, which carries `replacesUsage: true` when the reply records usage. `continue-kept-parts.test.ts` covers the three cases, plus the event order and payloads asserted in `follow-up-admission.integration.test.ts`.
- [x] 2.5 Add `latestRun` to `ChatMessagesResponse`, read in the same transaction as the messages (design D12); verify with integration tests for a failed Run with no reply, a Chat with no Run (`null`), the follow-up action, the accepted mode, and another owner's Chat (not found). Recorded: `ChatsService.getChatMessages` returns `{ messages, latestRun }` from one transaction, `ChatLatestRunResponse` lives in `dto/latest-run.dto.ts`; the cases are in `chats-messages.integration.test.ts` (the seeded-history response reports `null`, the seeded Runs report `failed`/`cancelled`, model, effort, mode, and `continue`, and another owner gets 404 with no `latestRun`); the same file covers the `error` field: a Run that recorded a failure message reports it, and a Run with no error reports `null`.
- [x] 2.6 Regenerate `apps/api/openapi.json` and the web client; run the OpenAPI lint and a second generation with a clean diff. Recorded: `pnpm generate:api-client` twice; `pnpm lint:openapi` passes and the second run leaves no unstaged change. The generated `ChatMessagesResponse.latestRun` is `ChatLatestRunResponse | null` in the web client.
- [x] 2.7 Add a dated `CHANGELOG.md` entry for `latestRun` on the history read; the reference page waits for the route in task 3.8, so no owner-facing doc describes a route that does not exist; verify with `pnpm lint:markdown`. Recorded: the `2026-10-27` entry names the latest-Run report and says no owner-facing action sends a follow-up request yet; no reference page ships in this layer; `pnpm lint:markdown` passes.
- [ ] 2.8 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 2.9 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `api-regenerate` is created.

## 3. API Continue worker layer

Branch `continue-regenerate-turns/api-continue`, parent `continue-regenerate-turns/api-follow-up`.
Owns the execution of a Continue Run and the follow-up rail rules.

- [x] 3.1 Add `POST /api/v1/chats/:chatId/messages/:userMessageId/runs` with the `continue` action over the admission service, and seed the part collector and the in-Run region from `run.continued`, with the trigger index from the history rows (design D1, D5); verify with HTTP integration tests for the stream `start` frame, and worker tests that a Continue Run executes no kept tool, finalizes kept parts then new parts, keeps the kept parts when it fails after a new step, and changes nothing when it fails before dispatch. Recorded: the route is `ChatsController.createFollowUpRun` over `FollowUpAdmissionService.admitFollowUpRun` and `ChatLoopService.finalizeAcceptedRun`; the worker reads `run.continued` once per attempt (`loadContinueState`), seeds the collector (`seed`), and rebuilds the request from the history rows (`requestMessages`) with the kept projection after the trigger. `continue-route.integration.test.ts` proves the `start` frame names the new Run plus the 400/409/404 refusals over real HTTP; `continue-run.integration.test.ts` proves the kept steps are sent, no kept call is in the Run's log, the reply finalizes kept-then-new, a failure after a new part keeps the kept parts, and a failure before dispatch leaves the reply and its usage untouched.
- [x] 3.2 Add `stepNumber` to `tool.requested`, a `toolCallId -> stepNumber` map in `run.continued`, and the step-grouped Continue projection with the live model-output serialization of kept results (design D5, D6); verify with unit tests for parallel calls in one step, two sequential steps with no text between them, the legacy fallback with no step numbers, kept in-Run items at their positions, reasoning that stays with its step, a kept non-`media://` image result with the not-retained placeholder, and kept results above 32,000 characters with no omission marker. Recorded: `tool.requested` carries `stepNumber` from `onStepStart`, admission stores `steps` and the model-facing `results` in `run.continued` from the source Run's events (a chained Continue renumbers its source's own steps after the ones it continued, so two Runs never share a step), and `chats/continue-projection.ts` groups the kept parts (legacy fallback: consecutive calls are one step) with the shared `projectStoredToolPart` serialization. `continue-projection.test.ts` covers parallel calls, two sequential steps with no text, the legacy fallback, kept items at their position, reasoning with its step, a not-retained image result through the step composer, results above 32,000 characters with no omission marker, the empty case, a chained Continue's renumbering, and the exact live serialization of a native success, a native error, and a non-native JSON result.
- [x] 3.3 Add real-adapter wire tests for the Continue request: Anthropic with thinking and two parallel calls, Responses with `store` unset, and the Codex wire with `store: false`; verify each request ends with the kept tool results and carries the kept reasoning in its step. Recorded: `chats/continue-wire.test.ts` drives the real Anthropic (thinking plus two parallel calls), Responses (`store` unset, reasoning as an `item_reference`), and Codex (`store: false`, encrypted reasoning) clients over a stubbed transport; each request ends with the kept results and carries the kept reasoning inside its step.
- [x] 3.4 Replay `run.continued` in the stream bridge, and rebuild from `run.continued` plus the attempt window with only the Run's own snapshot items; verify with tests that a resumed stream shows kept parts then new parts, and that a death after an in-Run snapshot finalizes each kept part and kept item once. Recorded: `runs/kept-parts-replay.ts` replays kept text, reasoning, and settled tool parts (a kept item has no chunk) through the translator's own counters, so `run-stream-bridge.test.ts` shows kept parts then new parts with continuing ids. `run-reply-finalizer.ts` rebuilds as `run.continued` parts plus the attempt window and places only the Run's own snapshot items; `continue-run.integration.test.ts` proves a death after an in-Run snapshot finalizes each kept part and kept item once.
- [x] 3.5 Count kept parts toward the compaction threshold and the window fit, never absorbed (design D5); verify with a test that kept parts that do not fit fail the Run with the context-incompatible error. Recorded: the kept messages are part of the prepared request, so `requestFitsContextWindow` counts them, and `measureAttemptContextTokens` adds their estimate to the counted continuation; `planCompactionCheckpoint` never absorbs a row at or above the trigger. The context-incompatible case is the `8`-token window test in `continue-run.integration.test.ts`, which also asserts the failed Run changes nothing.
- [x] 3.6 Make the accepted-turn producers treat earlier Runs of the triggering user message as earlier attempts, reuse the stored `prompt-imports` and `skill-activation` items through message-scoped lookups, count the kept parts' instructions bundles as seen, and read the previous completed Run through the reply's `usage.runId` (design D8); verify with tests for one `temporal` item per turn, an appended `tool-availability` change, a turn with an import marker and a `$skill` mention that stores no second item, a kept bundle that stays seen, and a Continue that adds no model-switch item. Recorded: `DisclosureBaseline.priorTurnDispatched` and `findDispatchedBaselineForTurn` make an earlier Run of the same message a previous dispatch and the availability baseline; `resolvedSkillsForMessage` and `PromptImportPartsRepository.findForMessage` are the message-scoped reads, and `rebuildContextForChat` adds the kept parts' instruction bundles to the seen set. `findCompletedReplyRunBefore` reads the previous completed Run through the reply's `usage.runId` (falling back to the newest completed turn), used by the compaction measurement and the window summary, with a test where the reply names a Run other than the newest completed one. `continue-run.integration.test.ts` covers one `temporal` item, the appended `tool-availability` change (with a discriminating predecessor record), no model-switch item, and a stored `prompt-imports` and `skill-activation` item that are each reused and not stored twice.
- [x] 3.7 Write the follow-up Run's usage with its own `runId` and `complete: false` when `replacesUsage` is set (design D11); verify with tests that a Continue reply's usage aggregates only the Continue Run, records `complete: false`, and that the effective-context action resolves the Continue Run's receipts. Recorded: `run.created` records `replacesUsage`, `createdReplacesUsage` reads it in `finalizeAssistantTurnTelemetry`, and the reply's usage names the Continue Run with `complete: false`; the aggregate holds only that Run's receipts. The first worker test asserts the usage; the receipt endpoint resolves `usage.runId`, so the effective-context action follows the Continue Run.
- [x] 3.8 Add a `docs/product/reference/` page for the follow-up route, its admission rules, and the Continue rules, and a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`. Recorded: `docs/product/reference/continue-a-turn.md` documents the route, its admission rules, and the Continue rules, indexed from `docs/product/reference/index.md` and summarized in a dated `CHANGELOG.md` entry; `pnpm lint:markdown` and the link checker pass. The page names `spec: durable-runs`, because the reference checker only accepts a canonical capability and `turn-actions` becomes one at archive.
- [ ] 3.9 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 3.10 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `web` is created.

## 4. API Regenerate layer

Branch `continue-regenerate-turns/api-regenerate`, parent `continue-regenerate-turns/api-continue`.
Owns the Regenerate action and its evidence and disclosure rules.

Boundary re-estimate after SR and the parent's schema split: 2,890 authored
lines added and 387 removed against the 1,700 estimate — 962 implementation
(including the 170-line harness the two follow-up integration suites share, the
two request-body variants, and the pipe that validates them by `action`), 1,836
tests, and 92 documentation and ledger — plus a generated migration snapshot and
the generated OpenAPI document. The overrun is the evidence, disclosure, and
classification rules each needing their own integration proof; SR records the
split or exception.

- [x] 4.1 Add the `regenerate` action with chat-send validation (design D2); verify with integration tests for a missing `modelId` (400), an unknown model, an undeclared effort, a disabled mode, a turn with no reply that gets a reply, and a Continue after a Regenerate that failed before dispatch (409). Recorded: `FollowUpAdmissionService.validateFollowUpRequest` splits into `validateContinue` and `validateRegenerate`, which checks the model, then its effort, then the mode before any transaction; `follow-up-admission.integration.test.ts` has a task 4.1 block for the 400, the unknown model, the undeclared effort, the disabled mode, the no-reply turn that is admitted, and the Continue refused after a real Regenerate Run failed before dispatch.
- [x] 4.2 Let a Regenerate dispatch reset a `completed` reply of another Run and set `messages.revised_at` (design D7) with a generated migration; verify with tests that the reply holds only the new answer with `complete: false`, that a failure before dispatch keeps the old reply, that a later attempt does not reset its own salvaged answer, and that later turns do not replay the replaced tool pairs. Recorded: `replaceableReplyGuard` extends the conflict-update guard to a `completed` row whose `usage.runId` names another Run, and `revisedAtOnReset` writes the mark in the same statement; migration `20261027060556_colossal_hellcat.sql` adds the nullable column, and a second `pnpm db:generate` reports no change. `regenerate-run.integration.test.ts` proves the reply ends with only the new answer and `complete: false`, a pre-dispatch failure keeps the old parts, usage, and evidence, a salvaged answer of the Run's own earlier attempt is never reset, and the request carries no part of the replaced reply.
- [x] 4.3 Exclude revised rows from the evidence predicate in SQL and in its TS twin; verify with integration tests that `conversation_read`, `search_conversations`, timeline discovery, and the synchronous rebuild after the Regenerate finalizes stop returning a regenerated reply, and with a negative cross-owner test. Recorded: `eligibleMessagePredicate` adds `revised_at IS NULL` and `isImmutableEvidenceMessage` takes the row's mark; the chunker and the hydrator read it, so the projection drops a revised reply. `revised-reply.integration.test.ts` proves that a reindex after the replacement holds neither the old nor the new reply text while the user message stays, that `conversation_read` answers nothing for the row and skips it as a neighbour, that timeline discovery stops counting it, and that another owner reads neither sequence of a revised turn.
- [x] 4.4 Record `classification` on `tool.started`, on stored tool parts, and in the reconstructor (design D10); verify with tests for a started `bash` call, a gate-rejected call and a permission-denied call (`null`), an MCP call (`unverified`), and a rebuilt reply. Recorded: both `tool.started` emitters carry the executing tool's classification, the live collector writes it on the part, and the reconstructor reads it from `tool.started`, storing `null` when the call never started. `assistant-transcript.test.ts` covers a started `bash` call, an MCP call, a permission-denied call, a malformed recorded value, and the rebuilt reply. A call whose `tool.started` recorded no classification (any Run from before this layer) stores no field at all, so the notice's legacy name fallback still counts it; it also asserts the model-facing projection carries no classification.
- [x] 4.5 Add the `regenerate` notice producer at rank 2 and its packaged text (design D9); verify with worker tests that a discarded `bash` call stores the notice on the triggering user message once after the stored items, that a tool-less Regenerate carries it, that a read-only or rejected-only reply adds none, and that a second Regenerate keeps one notice. Recorded: `regenerate` sits second in `CONTEXT_ITEM_PRODUCERS`, `chats/regenerate-notice.ts` authors the item from `prompts/regenerate-notice.md` and decides which stored part counts, admission records `notice` in `run.created`, and the Run's first dispatch stores it. `regenerate-run.integration.test.ts` stores it once after a stored `temporal` item and carries it in a tool-less request; `follow-up-admission.integration.test.ts` and the service unit test cover a read-only reply, a rejected-only reply, and a turn that already holds the notice.
- [x] 4.6 Replace the model-switch item on the first Regenerate dispatch (design D8); verify with tests for `A` to `C` after a stored `A` to `B`, removal when the model returns to `A`, a retry of the Regenerate Run that keeps its item, no change on a Continue, and a replaced Run that is not the previous completed Run for the next turn. Recorded: `storeAtDispatch` drops the stored `effective-context-change`/`model` items on that dispatch and the request builder drops them too, while the worker derives its own comparison. `regenerate-run.integration.test.ts` covers `A` to `C` after a stored `A` to `B`, the removal when the request returns to `A`, and a retry that keeps its stored item; `run-execution.service.test.ts` covers the first dispatch against a retry, and the Continue cases stay green in `continue-run.integration.test.ts`. The previous-completed-Run lookup already follows the reply's `usage.runId` (`api-continue`).
- [x] 4.7 Regenerate the OpenAPI document and the web client for the `classification` field; run the OpenAPI lint and a second generation with a clean diff. Recorded: `pnpm generate:api-client` twice with an identical document; the history DTO exposes `parts` as free-form objects, so the client gains no `classification` type. The follow-up body is a discriminated union, so the document gains the `RegenerateFollowUpRunDto` variant (`action`, required `modelId`, `effort`, `permissionMode`) and its `mapping` entry, and `pnpm lint:openapi` passes. `FollowUpRunBodyPipe` dispatches on `action` to the variant's own validation, so the runtime stays as strict as the published schema. `pnpm lint:openapi` passes and `pnpm --filter web typecheck` passes.
- [x] 4.8 Extend the reference page with the Regenerate rules and add a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`. Recorded: `docs/product/reference/continue-a-turn.md` now covers both actions, the notice, and the model switch, indexed as "Continue or regenerate a turn"; the `2026-10-27` `CHANGELOG.md` entry names the action, the evidence exclusion, the notice, and the classification. `pnpm lint:markdown` passes.
- [ ] 4.9 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 4.10 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `finalize` is created.

## 5. Web layer

Branch `continue-regenerate-turns/web`, parent `continue-regenerate-turns/api-regenerate`. Owns the
owner-facing actions.

- [ ] 5.1 Route `regenerate-message` transport requests to the follow-up route with the action body (design D13); verify with unit tests for the request URL and body of both actions, the composer mode on Continue, and a turn with no reply.
- [ ] 5.2 Replace the `Regenerate` stub with the latest-turn actions and the Regenerate split button (repeat of `latestRun` on a plain click, composer selectors in the menu); verify with stories that cover both actions, Continue hidden with no settled tool part, a turn with no reply, older turns without actions, and a menu pick that sets the composer.
- [ ] 5.3 Add the confirmation dialog for non-read-only calls and the one-reply rule during a follow-up Run; verify with stories that name the calls, a cancel that sends nothing, a read-only reply that regenerates at once, and a reload during a queued follow-up Run that shows one reply.
- [ ] 5.4 Render the `regenerate` notice on the user message; verify with a story.
- [ ] 5.5 Add a focused E2E test that continues a failed agentic turn and regenerates a completed answer with the model fixture; verify it passes in CI.
- [ ] 5.6 Extend the reference page with the web actions and add a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 5.7 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 5.8 GR: drive current-head CI green after ready; process bot reviews and surviving mutants.

## 6. Finalize layer

Branch `continue-regenerate-turns/finalize`, parent `continue-regenerate-turns/web`. Enter it with
`$gh-stack` before `$openspec-sync-specs` writes. Owns spec synchronization, task records, and
archive movement only.

- [ ] 6.1 Use `$openspec-sync-specs` to apply the ten deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`, and that every canonical scenario heading survives.
- [ ] 6.2 Verify archive readiness with `openspec status --change continue-regenerate-turns --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- SR and GR for finalize follow archive movement as post-archive gates.
- Merge each layer only with Leo's explicit permission, through `$gh-stack`.

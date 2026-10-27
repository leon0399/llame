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

- [ ] 2.1 Add `runs.follow_up_action` and `runs.source_run_id` (design D3) with a generated Drizzle migration; verify the migration applies on a fresh database and the API integration suite's RLS checks still pass.
- [ ] 2.2 Add the follow-up admission service with the chat-row lock, the turn check before single-flight admission, and the action check after it (design D1), with no HTTP route; verify with service integration tests for the latest turn, an older turn (409), an archived Chat, a live Run (409), a stuck Run (expired, then admitted), another owner's Chat (404, no job read, nothing changed), and a chat send with the same message id that still gets 409.
- [ ] 2.3 Validate the request and apply the Continue check (design D2); verify with tests for `modelId` and `effort` on Continue (400), a disabled permission mode, a removed model, a `completed` Run (409), a turn with no reply (409), a reply of an older Run behind a seeded `follow_up_action = 'regenerate'` Run that failed before dispatch (409), and a stored `bypass` mode on the new Run while the old Run keeps `default`.
- [ ] 2.4 Compute the kept parts at admission, append `run.continued`, and record `replacesUsage` in `run.created` (design D4, D11); verify with unit tests for three settled steps plus an unfinished step, no settled tool part, and in-Run items after the last settled tool part.
- [ ] 2.5 Add `latestRun` to `ChatMessagesResponse`, read in the same transaction as the messages (design D12); verify with integration tests for a failed Run with no reply, a Chat with no Run (`null`), the follow-up action, the accepted mode, and another owner's Chat (not found).
- [ ] 2.6 Regenerate `apps/api/openapi.json` and the web client; run the OpenAPI lint and a second generation with a clean diff.
- [ ] 2.7 Add a dated `CHANGELOG.md` entry for `latestRun` on the history read; the reference page waits for the route in task 3.8, so no owner-facing doc describes a route that does not exist; verify with `pnpm lint:markdown`.
- [ ] 2.8 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 2.9 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `api-regenerate` is created.

## 3. API Continue worker layer

Branch `continue-regenerate-turns/api-continue`, parent `continue-regenerate-turns/api-follow-up`.
Owns the execution of a Continue Run and the follow-up rail rules.

- [ ] 3.1 Add `POST /api/v1/chats/:chatId/messages/:userMessageId/runs` with the `continue` action over the admission service, and seed the part collector and the in-Run region from `run.continued`, with the trigger index from the history rows (design D1, D5); verify with HTTP integration tests for the stream `start` frame, and worker tests that a Continue Run executes no kept tool, finalizes kept parts then new parts, keeps the kept parts when it fails after a new step, and changes nothing when it fails before dispatch.
- [ ] 3.2 Add `stepNumber` to `tool.requested`, a `toolCallId -> stepNumber` map in `run.continued`, and the step-grouped Continue projection with the live model-output serialization of kept results (design D5, D6); verify with unit tests for parallel calls in one step, two sequential steps with no text between them, the legacy fallback with no step numbers, kept in-Run items at their positions, reasoning that stays with its step, a kept non-`media://` image result with the not-retained placeholder, and kept results above 32,000 characters with no omission marker.
- [ ] 3.3 Add real-adapter wire tests for the Continue request: Anthropic with thinking and two parallel calls, Responses with `store` unset, and the Codex wire with `store: false`; verify each request ends with the kept tool results and carries the kept reasoning in its step.
- [ ] 3.4 Replay `run.continued` in the stream bridge, and rebuild from `run.continued` plus the attempt window with only the Run's own snapshot items; verify with tests that a resumed stream shows kept parts then new parts, and that a death after an in-Run snapshot finalizes each kept part and kept item once.
- [ ] 3.5 Count kept parts toward the compaction threshold and the window fit, never absorbed (design D5); verify with a test that kept parts that do not fit fail the Run with the context-incompatible error.
- [ ] 3.6 Make the accepted-turn producers treat earlier Runs of the triggering user message as earlier attempts, reuse the stored `prompt-imports` and `skill-activation` items through message-scoped lookups, count the kept parts' instructions bundles as seen, and read the previous completed Run through the reply's `usage.runId` (design D8); verify with tests for one `temporal` item per turn, an appended `tool-availability` change, a turn with an import marker and a `$skill` mention that stores no second item, a kept bundle that stays seen, and a Continue that adds no model-switch item.
- [ ] 3.7 Write the follow-up Run's usage with its own `runId` and `complete: false` when `replacesUsage` is set (design D11); verify with tests that a Continue reply's usage aggregates only the Continue Run, records `complete: false`, and that the effective-context action resolves the Continue Run's receipts.
- [ ] 3.8 Add a `docs/product/reference/` page for the follow-up route, its admission rules, and the Continue rules, and a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 3.9 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 3.10 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `web` is created.

## 4. API Regenerate layer

Branch `continue-regenerate-turns/api-regenerate`, parent `continue-regenerate-turns/api-continue`.
Owns the Regenerate action and its evidence and disclosure rules.

- [ ] 4.1 Add the `regenerate` action with chat-send validation (design D2); verify with integration tests for a missing `modelId` (400), an unknown model, an undeclared effort, a disabled mode, a turn with no reply that gets a reply, and a Continue after a Regenerate that failed before dispatch (409).
- [ ] 4.2 Let a Regenerate dispatch reset a `completed` reply of another Run and set `messages.revised_at` (design D7) with a generated migration; verify with tests that the reply holds only the new answer with `complete: false`, that a failure before dispatch keeps the old reply, that a later attempt does not reset its own salvaged answer, and that later turns do not replay the replaced tool pairs.
- [ ] 4.3 Exclude revised rows from the evidence predicate in SQL and in its TS twin; verify with integration tests that `conversation_read`, `search_conversations`, timeline discovery, and the synchronous rebuild after the Regenerate finalizes stop returning a regenerated reply, and with a negative cross-owner test.
- [ ] 4.4 Record `classification` on `tool.started`, on stored tool parts, and in the reconstructor (design D10); verify with tests for a started `bash` call, a gate-rejected call and a permission-denied call (`null`), an MCP call (`unverified`), and a rebuilt reply.
- [ ] 4.5 Add the `regenerate` notice producer at rank 2 and its packaged text (design D9); verify with worker tests that a discarded `bash` call stores the notice on the triggering user message once after the stored items, that a tool-less Regenerate carries it, that a read-only or rejected-only reply adds none, and that a second Regenerate keeps one notice.
- [ ] 4.6 Replace the model-switch item on the first Regenerate dispatch (design D8); verify with tests for `A` to `C` after a stored `A` to `B`, removal when the model returns to `A`, a retry of the Regenerate Run that keeps its item, no change on a Continue, and a replaced Run that is not the previous completed Run for the next turn.
- [ ] 4.7 Regenerate the OpenAPI document and the web client for the `classification` field; run the OpenAPI lint and a second generation with a clean diff.
- [ ] 4.8 Extend the reference page with the Regenerate rules and add a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
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

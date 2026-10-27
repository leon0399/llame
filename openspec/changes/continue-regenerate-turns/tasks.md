## 1. Proposal layer

Tracks issues #1047 and #1451. Delivery stack:

```text
master <- continue-regenerate-turns/proposal <- continue-regenerate-turns/api-continue <- continue-regenerate-turns/api-regenerate <- continue-regenerate-turns/web <- continue-regenerate-turns/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every stack operation and
`$openspec-apply-change` for implementation. Create each implementation layer only after proposal
approval. Every layer has a self-review (SR) checkpoint before draft -> ready and a GitHub review
(GR) checkpoint after ready; for finalize both follow archive movement as post-archive gates.

Layers, each with its branch, parent, ownership, authored-size estimate against its parent
(tests, specs, and docs included; generated output counted separately), exit evidence, and issue
responsibility:

- `continue-regenerate-turns/proposal` (parent `master`): this ledger, the proposal, the design,
  and nine delta specs. Estimated about 1,300 authored lines. Exit: the OpenSpec proposal, Product
  Markdown, and Any change rows, review rounds committed separately, and approval of the published
  revision. References the issues and closes none.
- `continue-regenerate-turns/api-continue` (parent `proposal`): the follow-up route with the
  `continue` action, the `runs` follow-up columns, the Continue boundary, the `run.continued`
  event, seeded collection, request assembly, stream replay, and finalization, and the follow-up
  rule for stored context items (design D1 to D6, D8 without the model-switch exception, D11).
  Estimated about 1,900 authored lines plus a generated migration snapshot and OpenAPI churn.
  Exit: the Workspace TypeScript, API DB/tenancy, API/generated client, Product Markdown, and Any
  change rows, and current-head CI green after ready. References #1047 and closes no issue.
- `continue-regenerate-turns/api-regenerate` (parent `api-continue`): the `regenerate` action, the
  reset of a `completed` reply, `messages.revised_at` and the evidence predicate, classification
  on stored tool parts, the Regenerate notice, and the model-switch rule of a follow-up Run
  (design D2, D7, D8 model-switch, D9, D10). Estimated about 1,700 authored lines plus a
  generated migration snapshot. Exit: the Workspace TypeScript, API DB/tenancy, API/generated
  client, Product Markdown, and Any change rows, and current-head CI green after ready. References
  #1451 and closes no issue.
- `continue-regenerate-turns/web` (parent `api-regenerate`): the latest-turn actions, the
  Regenerate split button and confirmation, the transport route, the notice display, stories, and
  a focused E2E test (design D12). Estimated about 1,800 authored lines. Exit: the Workspace
  TypeScript, Shared UI/stories, Cross-surface behavior, Product Markdown, and Any change rows,
  and current-head CI green after ready. Its PR body carries `Closes #1047` and `Closes #1451`,
  because owners can use both actions only when this layer merges.
- `continue-regenerate-turns/finalize` (parent `web`): canonical spec synchronization, task
  records, and archive movement only. Closes no issue.

Re-estimate each layer's authored size at its boundary and before publication; split a growing
concern or request a named exception before publishing an oversized layer.

- [ ] 1.1 [proposal] Run two review rounds on the proposal, design, and delta specs, each with two independent reviewers; verify each finding against the repository; commit each round separately.
- [ ] 1.2 [proposal] Verify that every MODIFIED block keeps master's requirement name, behavior, and every scenario heading, with only the edits that the proposal names, by a recorded script comparison against `openspec/specs`.
- [ ] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate continue-regenerate-turns --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record approval of the final revision.
- [ ] 1.4 [proposal] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head until CI passes and no actionable feedback stays unresolved.

## 2. API Continue layer

Branch `continue-regenerate-turns/api-continue`, parent `continue-regenerate-turns/proposal`.
Owns the follow-up route and the Continue action.

- [ ] 2.1 Add `runs.follow_up_action` and `runs.source_run_id` (design D3) with a generated Drizzle migration; verify the migration applies on a fresh database and the API integration suite's RLS checks still pass.
- [ ] 2.2 Add `POST /api/v1/chats/:chatId/messages/:userMessageId/runs` with the `continue` action: validation (design D2), the turn check after single-flight admission (design D1), and the stream answer; verify with integration tests for the latest turn, an older turn (409), a `completed` Run (409), a live Run (409), a stuck Run (expired, then admitted), `modelId` on Continue (400), and another owner's Chat (404, no job read, nothing changed).
- [ ] 2.3 Compute the kept parts at admission and append `run.continued` (design D4, D5); verify with unit tests for three settled steps plus an unfinished step, no settled tool part, and in-Run items after the last settled tool part.
- [ ] 2.4 Seed the part collector, the model request, and the in-Run region from `run.continued`, and keep the model and effort of the continued Run (design D5, D6); verify with a worker test that the first request carries the kept reasoning metadata and tool pairs after the trigger with no added user-role message, and that no kept tool executes.
- [ ] 2.5 Replay `run.continued` in the stream bridge and in rebuild-based finalization; verify with tests that a resumed stream shows kept parts then new parts, and that a second attempt after a worker death finalizes the kept parts once.
- [ ] 2.6 Make the accepted-turn context producers treat earlier Runs of the triggering user message as earlier attempts (design D8 without the model-switch exception), and count the kept parts' instructions bundles as seen; verify with tests for one `temporal` item per turn, an appended `tool-availability` change, and a kept bundle that stays seen.
- [ ] 2.7 Write the follow-up Run's usage with its own `runId` (design D11); verify with a test that a Continue reply's usage aggregates only the Continue Run.
- [ ] 2.8 Regenerate `apps/api/openapi.json`, run the OpenAPI lint, and confirm the generated web client stays unchanged (the route is tagged `streaming`).
- [ ] 2.9 Add a `docs/product/reference/` page for the follow-up route and the Continue rules, and a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 2.10 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 2.11 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `web` is created.

## 3. API Regenerate layer

Branch `continue-regenerate-turns/api-regenerate`, parent `continue-regenerate-turns/api-continue`.
Owns the Regenerate action and its evidence and disclosure rules.

- [ ] 3.1 Add the `regenerate` action with chat-send validation (design D2); verify with integration tests for a missing `modelId` (400), an unknown model, an undeclared effort, and a disabled mode.
- [ ] 3.2 Let a Regenerate dispatch reset a `completed` reply and set `messages.revised_at` (design D7) with a generated migration; verify with tests that the reply holds only the new answer, that a failure before dispatch keeps the old reply, and that a turn with no reply gets a reply.
- [ ] 3.3 Exclude revised rows from the evidence predicate in SQL and in its TS twin; verify with integration tests that `conversation_read`, `search_conversations`, and timeline discovery stop returning a regenerated reply, and with a negative cross-owner test.
- [ ] 3.4 Record `classification` on stored tool parts (design D10); verify with tests for a started `bash` call, a gate-rejected call (`null`), and an MCP call (`unverified`).
- [ ] 3.5 Add the Regenerate notice producer and its packaged text (design D9); verify with worker tests that a discarded `bash` call stores the notice as the first reply part and sends it after the trigger on each step, and that a read-only or rejected-only reply adds none.
- [ ] 3.6 Add the follow-up model-switch rule (design D8); verify with tests for `B` to `C`, `B` back to `A`, and no switch for the same model.
- [ ] 3.7 Update the reference page and add a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 3.8 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 3.9 GR: drive current-head CI green after ready; process bot reviews and surviving mutants before `finalize` is created.

## 4. Web layer

Branch `continue-regenerate-turns/web`, parent `continue-regenerate-turns/api-regenerate`. Owns
the owner-facing actions.

- [ ] 4.1 Route `regenerate-message` transport requests to the follow-up route with the action body (design D12); verify with unit tests for the request URL and body of both actions and of a turn with no reply.
- [ ] 4.2 Replace the `Regenerate` stub with the latest-turn actions and the Regenerate split button (repeat on a plain click, composer selectors in the menu); verify with stories that cover both actions, Continue hidden with no settled tool part, older turns without actions, and a menu pick that sets the composer.
- [ ] 4.3 Add the confirmation dialog for non-read-only calls; verify with a story that names the calls and a cancel that sends nothing.
- [ ] 4.4 Render the Regenerate notice in the reply; verify with a story.
- [ ] 4.5 Add a focused E2E test that continues a failed agentic turn and regenerates a completed answer with the model fixture; verify it passes in CI.
- [ ] 4.6 Update the reference page with the web actions and add a dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 4.7 SR: run the multi-agent code review, the `$simplify` pass, and the `$ponytail-review` pass on the draft PR diff; fix accepted findings; mark the PR ready.
- [ ] 4.8 GR: drive current-head CI green after ready; process bot reviews and surviving mutants.

## 5. Finalize layer

Branch `continue-regenerate-turns/finalize`, parent `continue-regenerate-turns/web`. Enter it with
`$gh-stack` before `$openspec-sync-specs` writes. Owns spec synchronization, task records, and
archive movement only.

- [ ] 5.1 Use `$openspec-sync-specs` to apply the nine deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`, and that every canonical scenario heading survives.
- [ ] 5.2 Verify archive readiness with `openspec status --change continue-regenerate-turns --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- SR and GR for finalize follow archive movement as post-archive gates.
- Merge each layer only with Leo's explicit permission, through `$gh-stack`.

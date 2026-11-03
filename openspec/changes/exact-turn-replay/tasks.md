Track [#1539](https://github.com/leon0399/llame/issues/1539),
[#599](https://github.com/leon0399/llame/issues/599), and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). The
follow-up [#1550](https://github.com/leon0399/llame/issues/1550) owns the
reasoning token estimate. Implementation waits for Leo's approval of the
published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- exact-turn-replay/proposal
  <- exact-turn-replay/seams
  <- exact-turn-replay/storage
  <- exact-turn-replay/responses-store
  <- exact-turn-replay/live-rendering
  <- exact-turn-replay/harness
  <- exact-turn-replay/replay
  <- exact-turn-replay/compaction
  <- exact-turn-replay/continue
  <- exact-turn-replay/finalize
```

| Layer             | Parent            | Ownership                                                                                                                                     | Authored estimate | Closes      |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------- |
| `proposal`        | `master`          | Proposal, design, deltas, this task list, and the amendment of `tool-result-artifacts`.                                                       | ~2,800            | none        |
| `seams`           | `proposal`        | The text-part seam in each model client, and provider metadata on text and tool parts, in event payloads, and out of every owner-facing sink. | ~1,600            | none        |
| `storage`         | `seams`           | `step` on each part with the Continue offset and copy, the model-only fields of refused calls, and `messages.parts` as `json`.                | ~1,000            | none        |
| `responses-store` | `storage`         | `store: false` on the `openai-responses` wire, with `forceReasoning` for entries that declare `reasoning`.                                    | ~250              | none        |
| `live-rendering`  | `responses-store` | Replayed results through the live builder, JSON kind included; the frame template and the `Artifact:` line deleted.                           | ~900              | none        |
| `harness`         | `live-rendering`  | The scripted model client emits whole steps through the production seams.                                                                     | ~600              | none        |
| `replay`          | `harness`         | The one projection for later turns: steps, refused calls, the model rule, provider metadata, no budget, and the prefix-equality test.         | ~2,000            | #1539, #599 |
| `compaction`      | `replay`          | The compaction request through the projection with reasoning, and the end of `ContextRequestKind`.                                            | ~800              | none        |
| `continue`        | `compaction`      | Continue Runs through the projection, and `run.continued` without its `steps` and `results` maps.                                             | ~800              | none        |
| `finalize`        | `continue`        | Spec sync, task records, and archive movement only.                                                                                           | ~1,600            | none        |

**Named budget exception: the proposal layer is about 2,800 authored lines.**
Measure it with `git diff --numstat origin/master` before publication. It adds
one capability with nine requirements, modifies sixteen requirements in eleven
capabilities, adds thirteen requirements to three, and removes one. Most
MODIFIED blocks are long canonical requirements that must be copied whole, and
nine are rewritten in full to Simplified Technical English. The `replay` layer
deletes the budget code and its tests in the same layer that replaces them,
because a projection that two code paths disagree on cannot ship. Re-measure it
at its boundary, and request a named exception before publication if it goes
over. Every other layer stays inside about 2,000 lines.

## 1. proposal

- [x] 1.1 Validate the change: `pnpm exec openspec validate exact-turn-replay --strict`, `pnpm exec openspec validate tool-result-artifacts --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/exact-turn-replay/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
  - Evidence: both `openspec validate --strict` runs pass; markdownlint, the link check, `pnpm format:check` over the repository, and `git diff --check` are clean on 3fdd6231.
- [x] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
  - Evidence: round 1 (spec consistency and feasibility reviewers; 13 P1, 15 P2; fixes in 52254f1b) and round 2 (4 P1, 20 P2; fixes in 3fdd6231). design.md "Revision history" records each round.
- [ ] 1.3 Obtain Leo's approval of the published revision, including A7 and A8 in proposal.md.

## 2. seams

- [ ] 2.1 Add a text-part seam to each model client (`openai`, `openai-codex`, `openai-completions`, `anthropic`, and the scripted and fake clients) that delivers the adapter's text part id and metadata in stream order. Start a new stored text part when the id changes. Forward the `tool-call` chunk metadata on every client, including a Chat Completions `thoughtSignature` (design A7). Verify that two Responses `message` items store two text parts, each with its item id.
- [ ] 2.2 Store the metadata once, on the text part or the tool call, in the live collector and in the run-event payloads, so the event-log rebuild keeps it. Keep it out of the chat DTO, the UI chunk stream, exports, search, public shares, logs, and telemetry. Verify "The metadata is never shown" and "Completed run removes opaque continuation state" with the DTO, stream, export, share, and log tests.
- [ ] 2.3 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.4 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused `apps/api` model-client, transcript, stream, and DTO tests, `pnpm format:check`, `git diff --check`.
- [ ] 2.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. storage

- [ ] 3.1 Record `step` on each stored text, reasoning, and tool part from the current SDK step number, with the Continue offset, on the live collector and on the event-log rebuild. Copy the step of a kept tool part stored without one from its `tool.requested` event at Continue admission (design D5). Verify "Two parallel calls record one step", "A Continue Run numbers its steps after the kept steps", "A Continue of an older Run keeps its steps", and "An old part keeps no step" in `assistant-transcript.test.ts` and the admission tests.
- [ ] 3.2 Store the SDK's error text and input of a call that the repair hook refused in model-only fields of the tool part and of the `tool.completed` payload, and keep the owner-facing error (design D3, proposal A8). Verify both scenarios of "A refused call replays as the live step sent it" at the part level, including the step-cap forced answer.
- [ ] 3.3 Change `messages.parts` from `jsonb` to `json` with a generated Drizzle migration, and move `hasVisibleText` to `json_array_elements` (design D13). Verify with an API integration test that a stored tool input `{"path", "oldText", "newText"}` reads back in that order, and that a row written before the migration still reads. Verify "A tool input keeps its member order" and "A reordered part replays as stored".
- [ ] 3.4 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.5 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused transcript, admission, and tool-gate tests, the migration integration test, `pnpm format:check`, `git diff --check`.
- [ ] 3.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. responses-store

- [ ] 4.1 Pin `store: false` as an invariant of the `openai-responses` client, and pass `forceReasoning: true` for an entry that declares `reasoning` (design D12). Verify each scenario of "The Responses wire stores no response and carries encrypted reasoning", and update `continue-wire.test.ts` to assert encrypted content and no `item_reference`.
- [ ] 4.2 Update the `openai-responses` operator documentation, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused model-client tests, `pnpm format:check`, `git diff --check`.
- [ ] 4.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. live-rendering

- [ ] 5.1 Render each replayed result through the live builder, with the output type of the live result, and delete `prompts/tool-output-untrusted.md` and the `Artifact:` line (design D3). Delete the tests that pin them; do not re-pin them. Verify each scenario of "Tool results replay in their live rendering", "One rendering function produces every model-facing tool result", and "Framing llame authors inside tool results is a packaged template".
- [ ] 5.2 Update `SPEC.md` §28.2, `docs/product/reference/tools/model-output.md`, and `docs/product/reference/locators/artifact.md`, and add a dated **BREAKING** `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused tool-observation and context-builder tests, `pnpm format:check`, `git diff --check`.
- [ ] 5.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. harness

- [ ] 6.1 Extend the scripted model client to emit a whole step through the production seams: parallel calls, text before and after a call, reasoning start and end with metadata, text and call metadata, and a refused call (design D14). Verify with focused harness tests that the stored parts match each scripted step.
- [ ] 6.2 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused harness tests, `pnpm format:check`, `git diff --check`.
- [ ] 6.3 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 7. replay

- [ ] 7.1 Build one projection from stored rows to model messages for later turns: steps from `step` with the consecutive rule for old parts, the SDK text and input of refused calls, `data-context` parts after the tool message of their step, and provider metadata under the model rule (design D5, D7, A7). Verify each scenario of "The calls of one step replay as one step", "A refused call replays as the live step sent it", and "Stored parts keep the provider metadata of the live step".
- [ ] 7.2 Apply the model rule to earlier reasoning from `usage.modelId` and `usage.status` (design D7). Verify each scenario of "Earlier reasoning replays only for the model that produced it", "Thinking survives into a later turn", "A model switch omits earlier blocks", and "A model switch replays blocks unchanged".
- [ ] 7.3 Delete the replay budget, payload clearing, the `input: {}` substitute, the omission marker, and the cleared `incomplete` outcome (design D2). Delete the tests that pin them; do not re-pin them. Verify "A long tool turn replays whole" with the numbers of the repro, both "after payload clearing" scenarios, and "Payload-cleared replay preserves incomplete search honesty".
- [ ] 7.4 Add the prefix-equality integration test (design D14). Verify "The next turn extends the previous request", "A model switch changes only the omitted parts", "Request-time media keeps the prefix", "A spilled result names its artifact once", and "A JSON result replays as a JSON output". Break the projection (for example, split one step) and confirm the test fails.
- [ ] 7.5 Verify the regression path: "A request that does not fit compacts or fails", and every `tool-calling`, `context-injection`, `media-attachments`, `durable-runs`, and `model-system-prompts` scenario this change modifies or adds for later turns.
- [ ] 7.6 Update `docs/product/reference/tools/edit.md`, and add a dated **BREAKING** `CHANGELOG.md` entry that names the `context_incompatible` risk for long older Chats. Verify `pnpm lint:markdown`.
- [ ] 7.7 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused context-builder, tool-observation, and run-execution tests, the new integration test, `pnpm format:check`, `git diff --check`.
- [ ] 7.8 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 7.9 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1539` and `Closes #599`.

## 8. compaction

- [ ] 8.1 Build the compaction request through the projection, with reasoning, and remove the `ContextRequestKind` split and its call sites (design D9). Verify "A compaction request extends the previous request", "A compaction request carries reasoning", and "Compaction and continuation share one projection".
- [ ] 8.2 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 8.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused compaction and run-execution tests, `pnpm format:check`, `git diff --check`.
- [ ] 8.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 8.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 9. continue

- [ ] 9.1 Build the Continue request through the projection, from the kept parts and their `step` (design D11). Remove the `steps` and `results` maps from `run.continued`. Verify each scenario of "Continue requests the next step of the same turn", "Continue and a later turn replay a reply the same way", and "Continue keeps the reasoning of a failed Run".
- [ ] 9.2 Update `docs/product/reference/continue-a-turn.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 9.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused Continue and regenerate tests, `pnpm format:check`, `git diff --check`.
- [ ] 9.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 9.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 10. finalize

- [ ] 10.1 Enter `exact-turn-replay/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, each MODIFIED requirement matches its delta with every canonical scenario kept, and the REMOVED requirement is gone.
- [ ] 10.2 Confirm archive readiness: `openspec status --change exact-turn-replay --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 10.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.

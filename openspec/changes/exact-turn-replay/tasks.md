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
  <- exact-turn-replay/fidelity
  <- exact-turn-replay/replay
  <- exact-turn-replay/continue
  <- exact-turn-replay/responses-store
  <- exact-turn-replay/finalize
```

| Layer             | Parent            | Ownership                                                                                                                                    | Authored estimate | Closes      |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------- |
| `proposal`        | `master`          | Proposal, design, deltas, this task list, and the amendment of `tool-result-artifacts`.                                                      | ~2,300            | none        |
| `fidelity`        | `proposal`        | Stored parts hold what the live step held: `step` on tool parts, provider metadata on text and tool parts, and `messages.parts` as `json`.   | ~500              | none        |
| `replay`          | `fidelity`        | The one projection for later turns and compaction: steps, live rendering, the model rule, no budget, no frame, and the prefix-equality test. | ~2,000            | #1539, #599 |
| `continue`        | `replay`          | Continue Runs through the projection, and `run.continued` without its `steps` and `results` maps.                                            | ~800              | none        |
| `responses-store` | `continue`        | `store: false` on the `openai-responses` wire.                                                                                               | ~200              | none        |
| `finalize`        | `responses-store` | Spec sync, task records, and archive movement only.                                                                                          | ~1,200            | none        |

**Named budget exception: the proposal layer is about 2,300 authored lines.**
It adds one capability, modifies thirteen requirements in nine capabilities,
and adds one requirement to a tenth.
Most MODIFIED blocks are long canonical requirements that must be copied whole,
and four of them are rewritten in full to Simplified Technical English. The
`replay` layer is at the budget because it deletes the budget code and its
tests in the same layer that replaces them; splitting would ship a projection
that two code paths disagree on. Every other layer stays inside about 2,000
lines.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate exact-turn-replay --strict`, `pnpm exec openspec validate tool-result-artifacts --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/exact-turn-replay/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
- [ ] 1.3 Obtain Leo's approval of the published revision, including A7 in proposal.md.

## 2. fidelity

- [ ] 2.1 Record `step` on each stored tool part from the `stepNumber` of its `tool.requested` event, on the live collector and on the event-log rebuild (design D5). Verify "Two parallel calls record one step" and "An old part keeps no step" in `assistant-transcript.test.ts`.
- [ ] 2.2 Keep the adapter's provider metadata on stored text parts and tool parts (call and result), and keep it out of the chat DTO, exports, search, and public shares (proposal A7). Verify "The metadata is never shown" with the DTO, export, and share tests.
- [ ] 2.3 Change `messages.parts` from `jsonb` to `json` with a generated Drizzle migration, and move `hasVisibleText` to `json_array_elements` (design D13). Verify with an API integration test that a stored tool input `{"path", "oldText", "newText"}` reads back in that order, and that a row written before the migration still reads. Verify "A tool input keeps its member order" and "A reordered part replays as stored".
- [ ] 2.4 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused `apps/api` transcript, DTO, and migration tests, `pnpm --filter api test:integration` for the migration test, `pnpm format:check`, `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. replay

- [ ] 3.1 Build one projection from stored rows to model messages: steps from `step` with the consecutive rule for old parts, the live tool output from the stored result, `data-context` parts after the tool message of their step, and provider metadata under the model rule (design D3, D5, D7). Verify each scenario of "The calls of one step replay as one step", "Tool results replay in their live rendering", and "Stored parts keep the provider metadata of the live step".
- [ ] 3.2 Apply the model rule to earlier reasoning from `usage.modelId` and `usage.status` (design D7). Verify each scenario of "Earlier reasoning replays only for the model that produced it", "Thinking survives into a later turn", "A model switch omits earlier blocks", and "A model switch replays blocks unchanged".
- [ ] 3.3 Delete the replay budget, payload clearing, the `input: {}` substitute, the omission marker, the cleared `incomplete` outcome, `prompts/tool-output-untrusted.md`, and the `Artifact:` line (design D2, D3). Delete the tests that pin them; do not re-pin them. Verify "A long tool turn replays whole" with the numbers of the repro, both "after payload clearing" scenarios, and "Payload-cleared replay preserves incomplete search honesty".
- [ ] 3.4 Build the compaction request through the projection, with reasoning, and remove the `ContextRequestKind` split (design D9). Verify "A compaction request extends the previous request", "A compaction request carries reasoning", and "Compaction and continuation share one projection".
- [ ] 3.5 Add the prefix-equality integration test (design D14). Verify "The next turn extends the previous request", "Request-time media keeps the prefix", "A spilled result names its artifact once", and "A JSON result replays as a JSON output". Break the projection (for example, split one step) and confirm the test fails.
- [ ] 3.6 Verify the regression path: "A request that does not fit compacts or fails", and every `tool-calling`, `context-injection`, `tool-result-rendering`, `media-attachments`, and `model-system-prompts` scenario this change modifies or adds for later turns.
- [ ] 3.7 Update `SPEC.md` §28.2, `docs/product/reference/tools/model-output.md`, `docs/product/reference/tools/edit.md`, `docs/product/reference/continue-a-turn.md`, and `docs/product/reference/locators/artifact.md`, and add a dated **BREAKING** `CHANGELOG.md` entry that names the `context_incompatible` risk for long older Chats. Verify `pnpm lint:markdown`.
- [ ] 3.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused `apps/api` context-builder, tool-observation, compaction, and run-execution tests, the new integration test, `pnpm format:check`, `git diff --check`.
- [ ] 3.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.10 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1539` and `Closes #599`.

## 4. continue

- [ ] 4.1 Build the Continue request through the projection, from the kept parts and their `step` (design D11). Remove the `steps` and `results` maps from `run.continued`. Verify each scenario of "Continue requests the next step of the same turn", "Continue and a later turn replay a reply the same way", and "Continue keeps the reasoning of a failed Run".
- [ ] 4.2 Verify that a Continue of a Run recorded before `step` existed groups its kept parts by the consecutive rule, in `continue-run.integration.test.ts`.
- [ ] 4.3 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.4 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused Continue and regenerate tests, `pnpm format:check`, `git diff --check`.
- [ ] 4.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. responses-store

- [ ] 5.1 Pin `store: false` as an invariant of the `openai-responses` client, and confirm that the adapter asks for `reasoning.encrypted_content` (design D12). Verify each scenario of "The Responses wire stores no response and carries encrypted reasoning", and update `continue-wire.test.ts` to assert encrypted content and no `item_reference`.
- [ ] 5.2 Update the `openai-responses` operator documentation, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, focused model-client tests, `pnpm format:check`, `git diff --check`.
- [ ] 5.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. finalize

- [ ] 6.1 Enter `exact-turn-replay/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, each MODIFIED requirement matches its delta with every canonical scenario kept, and the REMOVED requirement is gone.
- [ ] 6.2 Confirm archive readiness: `openspec status --change exact-turn-replay --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 6.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.

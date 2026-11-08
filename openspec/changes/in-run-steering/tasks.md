Track [#1622](https://github.com/leon0399/llame/issues/1622) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Parent tracking issue:
[#1612](https://github.com/leon0399/llame/issues/1612). Implementation waits for Leo's approval
of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- in-run-steering/proposal
  <- in-run-steering/queue
  <- in-run-steering/steer
  <- in-run-steering/interrupt
  <- in-run-steering/web
  <- in-run-steering/finalize
```

Each implementation layer ships one delivery mode end to end on the API, so every layer works on
its own: `queue` admits only `delivery: "queue"`, `steer` adds `steer`, and `interrupt` adds
`interrupt`. A mode that a layer does not yet ship gets 400.

| Layer       | Parent      | Ownership                                                                                                                                          | Authored estimate | Closes |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`  | `master`    | Proposal, design, deltas, and this task list.                                                                                                      | ~1,700            | none   |
| `queue`     | `proposal`  | The `chat_deliveries` table, `delivery: "queue"` admission, the deliveries API, live updates, promotion on completion, and the paused queue.       | ~1,700            | none   |
| `steer`     | `queue`     | Segments: step-boundary delivery, the delivery transaction, the reply split, final-answer continuation, per-segment cap, retry, usage, and replay. | ~2,000            | none   |
| `interrupt` | `steer`     | The run-control channel for interrupt and cancel, interrupt fates, call settlement, kept output, and the `interrupted` item.                       | ~1,800            | #207   |
| `web`       | `interrupt` | The split Send button, the pending stack, Stop and Esc, segment streams, transcript rows, and `DESIGN.md`.                                         | ~1,500            | #1622  |
| `finalize`  | `web`       | Spec sync, task records, and archive movement only.                                                                                                | ~1,500            | none   |

The `steer` layer is the riskiest for the review budget. Re-estimate it at its start, and split
promotion of a pending steer on a paused queue (task 3.6) into its own layer if it goes over.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate in-run-steering --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/in-run-steering/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
- [ ] 1.3 Obtain Leo's approval of the published revision.

## 2. queue

- [ ] 2.1 Add the `chat_deliveries` table with enabled and forced owner RLS, the pending index, the `llame_changes` trigger, and the nullable `messages.delivered_by_run_id` column in one generated migration (design D1). Verify "Another owner cannot see or change an item" and "Another owner cannot add an item" in an API integration test against real Postgres, with RLS active.
- [ ] 2.2 Accept `delivery` on `CreateMessageDto` (only `queue` in this layer) and store a pending item in the admission transaction when a Run is live (design D2). Verify "A send with a delivery mode becomes a pending item during an active Run" scenarios for `queue`, "A message with a delivery mode becomes a pending item", "A send without a delivery mode still gets 409", "An invalid pending item writes nothing", "A queue send to an idle Chat starts at once", "A retried send returns the stored item", and "An owner item names its producer" in `chats-messages.integration.test.ts`.
- [ ] 2.3 Add `GET` and `DELETE` under `/api/v1/chats/:chatId/deliveries` with conditional updates, and regenerate the OpenAPI document and client. Verify "Withdraw returns the text for an edit" and "A withdrawal that loses the race to delivery" (with a promoted queue item) in an integration test, and a clean second generation.
- [ ] 2.4 Promote the first pending queue item in the completing transaction with its stored settings, and leave the queue paused after a Run that does not complete (design D5). Verify "Three queue items run in order", "A queue item that a send cannot use stays pending", and the queue half of "A failed Run pauses the queue" in a worker integration test.
- [ ] 2.5 Send `chat.deliveries` on the live channel and regenerate `asyncapi.websocket.yaml` and `live-protocol.ts` (design D10). Verify "A second tab sees a new item" in `live-gateway.integration.test.ts` and the live protocol contract test.
- [ ] 2.6 Verify "A fork during a paused queue" in the fork integration test.
- [ ] 2.7 Update `SPEC.md` §9.3 for pending items and queue promotion, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused unit and integration tests above, `pnpm format:check`, `git diff --check`.
- [ ] 2.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. steer

- [ ] 3.1 Run each segment as its own `streamText` call inside the attempt, with a per-segment controller and a step-end query for pending steers (design D3). Verify "A steer during a tool call waits for the result", "A steer during a model response waits for the step end", and "A delivered message restarts the step count" with the scripted model client.
- [ ] 3.2 Add the delivery transaction: finalize the segment reply, insert the delivered message with `delivered_by_run_id`, mark items, append `run.delivered` (design D4). Verify "Two steers at one boundary", "The transcript order after a steer", "A crash before delivery keeps the item", "A superseded attempt cannot deliver", and "A delivered message executes in the active Run" in worker integration tests.
- [ ] 3.3 Check pending steers in the completing transaction under the chat-row lock (design D5). Verify "A steer during the final answer" and "A steer after completion starts a Run", including a Run with no tools.
- [ ] 3.4 Narrow crash recovery to the current segment: history through the latest delivered message, `hasMutation` over the events after the latest `run.delivered`, and settlers rebuilt from that window. Verify "A crash retry keeps earlier segments" and "A settled write in an earlier segment does not stop a retry".
- [ ] 3.5 Sum usage per segment, replay earlier-segment reasoning inside the Run, and keep the Run settings. Verify "Each segment reply sums only its own requests", "A later segment keeps the reasoning of an earlier segment", and "A steer sent with another model".
- [ ] 3.6 Accept `delivery: "steer"` and `PATCH` to `steer`; move pending steers to the head of the queue on a Run that does not complete; start a Run for a mode change on a paused item. Verify "A steer during a Run is accepted as a pending item", "Steer now changes a queue item", "A failed Run pauses the queue", and "Steer now on a paused item".
- [ ] 3.7 End the UI stream segment at `run.delivered` and resume from the latest delivery (design D9). Verify "A live client sees the delivery" and "A resume after a delivery replays only the current segment" in `run-stream-bridge.test.ts` and `chats.controller` tests.
- [ ] 3.8 Treat the Run of a delivered message as its Run for follow-up admission. Verify "Continue on a delivered message" and a Regenerate on a delivered message in follow-up admission integration tests.
- [ ] 3.9 Update `SPEC.md` §9.3–9.5 for segments and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.10 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 3.11 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.12 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. interrupt

- [ ] 4.1 Add the `llame_run_control` listener in each worker process and send cancel through it (design D6). Verify "A cancellation reaches a worker in another process", "A lost signal still cancels the Run", and every existing `run-cancellation` scenario in an integration test with the API and the worker in separate processes.
- [ ] 4.2 Add `interruptFate` to the tool registry, with `finish` for native `edit` and `write` and `cancel` for every other tool. Verify "A write finishes before the interrupt applies" and a registry test that every registered tool declares a fate.
- [ ] 4.3 Stop the segment on interrupt and settle open calls by fate with a per-call interrupt signal (design D7). Verify "An interrupt during a model response", "An interrupt takes the pending steers along", "An interrupt kills a long command", "Two calls of one step, one started", and "An interrupt reaches a dedicated worker".
- [ ] 4.4 Mark the cut reasoning part and omit it in the projection (design D8). Verify "The cut reasoning part never replays" in projection tests for the Responses and Messages wires.
- [ ] 4.5 Run the live Anthropic probe: a request that keeps a signed thinking block of an interrupted reply and drops the open block. Record the request shape and the answer in the PR body. Stop and revise the proposal if the provider rejects it.
- [ ] 4.6 Add the `interrupted` producer, its packaged template, and its precedence rank. Verify "The notice comes first", "A killed command is named", and "An interrupted item comes before the owner text".
- [ ] 4.7 Accept `delivery: "interrupt"` and `PATCH` to `interrupt`, with `NOTIFY` in the admission transaction. Verify the interrupt scenarios of the admission and action requirements.
- [ ] 4.8 Update `SPEC.md` §9.6, the run-cancellation operator notes, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.9 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 4.10 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.11 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. web

- [ ] 5.1 Add the split Send button with Steer, Interrupt, and Queue while a Run is active, with Enter and Mod+Enter (design D11). Verify "Enter steers during a Run" and "Queue is an explicit choice" in composer stories with interaction tests.
- [ ] 5.2 Add the pending stack with its row actions and edit flow. Verify "Edit puts the text back" and "A delivered item leaves the stack" in stories.
- [ ] 5.3 Make Stop and Esc interrupt when steers are pending. Verify "Esc twice stops everything" in a story and a focused product E2E test.
- [ ] 5.4 Adopt history at `run.delivered` and attach the next segment stream. Render delivered messages, the `interrupted` notice, and the paused label. Verify "A reload shows the segments" in `chat-page.stories.tsx`.
- [ ] 5.5 Add the split-button and pending-row patterns to `DESIGN.md`, and a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.6 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, Storybook story tests, the focused E2E test, `pnpm format:check`, `git diff --check`.
- [ ] 5.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. finalize

- [ ] 6.1 Enter `in-run-steering/finalize` with `$gh-stack` before `$openspec-sync-specs` writes canonical specs.
- [ ] 6.2 Sync the delta specs into `openspec/specs`, including the new `run-steering` capability. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 6.3 Confirm archive readiness: every task above is checked and `openspec status --change in-run-steering --json` reports all artifacts done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review and GitHub review of the finalize PR follow archive movement, under Ready-PR monitoring.

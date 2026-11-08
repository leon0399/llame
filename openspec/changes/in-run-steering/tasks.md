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
  <- in-run-steering/segments
  <- in-run-steering/steer
  <- in-run-steering/interrupt
  <- in-run-steering/web
  <- in-run-steering/finalize
```

Each implementation layer ships one delivery mode end to end on the API, so every layer works on
its own: `queue` admits only `delivery: "queue"`, `steer` adds `steer`, and `interrupt` adds
`interrupt`. A mode that a layer does not yet ship gets 400. `segments` builds the delivery
machinery and tests it with items that the test harness stores directly.

| Layer       | Parent      | Ownership                                                                                                                                        | Authored estimate | Closes |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| `proposal`  | `master`    | Proposal, design, deltas, and this task list.                                                                                                    | ~2,100            | none   |
| `queue`     | `proposal`  | The `chat_deliveries` table, `delivery: "queue"` admission, the deliveries API, live updates, promotion on completion, and the paused queue.     | ~1,800            | none   |
| `segments`  | `queue`     | Segment attempts: the step-end check, the delivery transaction, the moved Run message, retry and settler windows, and the completion check.      | ~2,000            | none   |
| `steer`     | `segments`  | `delivery: "steer"`, the steer-to-queue move, mode changes on paused items, the segment stream and resume, and follow-ups on delivered messages. | ~1,500            | none   |
| `interrupt` | `steer`     | The run-control channel for interrupt and cancel, interrupt fates, call settlement, kept output, and the `interrupted` item.                     | ~1,900            | #207   |
| `web`       | `interrupt` | The split Send button, the pending stack, Stop and Esc, segment streams, turn actions, transcript rows, and `DESIGN.md`.                         | ~1,600            | #1622  |
| `finalize`  | `web`       | Spec sync, task records, and archive movement only.                                                                                              | ~1,800            | none   |

**Named budget exception: the proposal layer is about 2,100 authored lines.** It adds one
capability with 37 requirements and modifies 11 requirements in 6 capabilities. Most MODIFIED
blocks are long canonical requirements that must be copied whole and rewritten in Simplified
Technical English. Measure it with `git diff --numstat origin/master` before publication.
`segments` and `interrupt` are closest to the budget; re-measure each at its boundary and request a
named exception before publication if it goes over.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate in-run-steering --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/in-run-steering/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
- [ ] 1.3 Obtain Leo's approval of the published revision.

## 2. queue

- [ ] 2.1 Add the `chat_deliveries` table with the composite Chat-owner key, enabled and forced owner RLS, and the pending index in a generated migration, and the `llame_changes` trigger in a hand-written migration (design D1). Verify "Another owner cannot see or change an item", "Another owner cannot add an item", and "The datastore refuses a mismatched owner" in an API integration test against real Postgres with RLS active.
- [ ] 2.2 Accept `delivery` on `CreateMessageDto` (only `queue` in this layer), look up an existing item first, and store a pending item when a Run is live (design D2). Verify "A send with a delivery mode becomes a pending item during a live Run" for `queue`, "A message with a delivery mode becomes a pending item", "A send without a delivery mode still gets 409", "An invalid pending item writes nothing", "A delivery send to a Chat with a stuck Run", "A queue send to an idle Chat starts at once", "A send to a paused queue goes first", "A retried send returns the stored item", "An owner item names its producer", and the durable-runs 409 scenarios qualified by "no `delivery` mode", in `chats-messages.integration.test.ts`.
- [ ] 2.3 Add `GET` and `DELETE` under `/api/v1/chats/:chatId/deliveries` with conditional updates, and regenerate the OpenAPI document and client. Verify "Withdraw returns the text for an edit" and "A withdrawal that loses the race to delivery" (with a promoted queue item) in an integration test, and a clean second generation.
- [ ] 2.4 Promote the first pending queue item in the completing transaction with its stored settings and its id, including after a completed follow-up Run (design D5). Verify "Three queue items run in order", "A queue item that a send cannot use stays pending", "A promoted item keeps its id", and the queue half of "A failed Run pauses the queue" in a worker integration test.
- [ ] 2.5 Send `chat.deliveries` on the live channel and regenerate `asyncapi.websocket.yaml` and `live-protocol.ts` (design D10). Verify "A second tab sees a new item" in `live-gateway.integration.test.ts` and the live protocol contract test.
- [ ] 2.6 Verify "A fork during a paused queue" in the fork integration test.
- [ ] 2.7 Update `SPEC.md` §9 (intro and §9.3) for pending items and queue promotion, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused unit and integration tests above, `pnpm format:check`, `git diff --check`.
- [ ] 2.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. segments

- [ ] 3.1 Add `stopWhenExtra` to `ModelStreamInput`, OR it into each client's `stopWhen`, and query pending `steer` and `interrupt` items at each step end; keep the `executeRun` signature with a result that drains every segment (design D3). Verify "A steer during a tool call waits for the result", "A steer during a model response waits for the step end", and "A steer after the cap gives a new budget" with the scripted model client and directly stored items.
- [ ] 3.2 Add the delivery transaction: close the segment reply with its status and published usage, insert the delivered message with a new id, mark items, move `runs.message_id`, write the new attempt id, and append `run.delivered` (design D4). Verify "Two steers at one boundary", "The transcript order after a steer", "A crash before delivery keeps the item", "A superseded attempt cannot deliver", "A live client sees the segment usage", "A reply that a steer closed is complete", and "A delivered message executes in the active Run".
- [ ] 3.3 Prepare each segment attempt from the Run's current message: compaction check, accepted-turn items, prompt imports, and `$skill` activations. Verify "A steer with a skill mention", "A long steered Run compacts at a segment start", "A steer sent with another model", and "A delivered message restarts the step count".
- [ ] 3.4 Check pending items in the completing transaction under the chat-row lock (design D5). Verify "A steer during the final answer" (with and without tools) and "A steer after completion starts a Run".
- [ ] 3.5 Narrow crash recovery and settlers to the current segment: the Run's current message for every attempt, `hasMutation` and the rebuild window after the latest `run.delivered`, and the finalizer through the moved `message_id`. Verify "A crash retry keeps earlier segments", "A settled write in an earlier segment does not stop a retry", "A queue retry re-executes the loop from the start", "A finalizer leaves the reply of an earlier segment", "A rebuild covers only the current segment", and "Step cap reached fails closed to answering".
- [ ] 3.6 Replay earlier-segment reasoning inside the Run. Verify "A later segment keeps the reasoning of an earlier segment" in projection tests.
- [ ] 3.7 Update `SPEC.md` §9.3–9.5 and §9.8 for segments, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 3.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. steer

- [ ] 4.1 Accept `delivery: "steer"` and `PATCH` to `steer`. Verify "A steer during a Run is accepted as a pending item", "Steer now changes a queue item", and "A retry after delivery starts no Run".
- [ ] 4.2 Move pending `steer` and `interrupt` items to the head of the queue in `markFinished` for every non-completed status, and start a Run for a mode change on a paused item. Verify "A failed Run pauses the queue" for every terminal writer and "Steer now on a paused item".
- [ ] 4.3 End the UI stream segment at `run.delivered` and resume after the latest delivery (design D9). Verify "A live client sees the delivery", "A resume after a delivery replays only the current segment", and "Resume identifies the active Run first" in `run-stream-bridge.test.ts` and the `chats.controller` tests.
- [ ] 4.4 Verify "Continue on a delivered message" and a Regenerate on a delivered message in follow-up admission integration tests.
- [ ] 4.5 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.6 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 4.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. interrupt

- [ ] 5.1 Add the `llame_run_control` listener in each process that consumes `runs`, store `userId` in the abort registry, and send cancel through the channel (design D6). Verify "A cancellation reaches a worker in another process", "A lost signal still cancels the Run", and the `run-cancellation` scenarios with two Nest application contexts that each own a registry.
- [ ] 5.2 Add `interruptFate` to the static registry and `cancel` to dynamic MCP bindings. Verify "A write finishes before the interrupt applies", "Workspace entry finishes", and a test that every registered tool and every MCP binding has a fate.
- [ ] 5.3 Stop the segment on interrupt, route the abort in `onError`, and settle open calls by fate with a per-call interrupt signal (design D7). Verify "An interrupt during a model response", "An interrupt takes the pending steers along", "An interrupt kills a long command", "Two calls of one step, one started", "A late tool result does not replace the settlement", "An interrupt during compaction", and "An interrupt reaches a dedicated worker".
- [ ] 5.4 Add `onReasoningEnd`, mark the open reasoning part, and apply the interrupted-reply reasoning rule in the projection (design D8). Verify "The cut reasoning part never replays" and "An interrupted reply keeps only reasoning with a later part" for the Responses and Messages wires.
- [ ] 5.5 Run the live Anthropic probe: a request that keeps a signed thinking block of an interrupted reply and drops the open block. Record the request shape and the answer in the PR body. Stop and amend the proposal if the provider rejects it.
- [ ] 5.6 Add the `interrupted` producer, its packaged template, and its first precedence rank. Verify "The notice comes first", "A killed command is named", and "An interrupted item comes before the owner text".
- [ ] 5.7 Accept `delivery: "interrupt"` and `PATCH` to `interrupt`, with `NOTIFY` in the admission transaction. Verify an admission test for `interrupt` and a mode-change test from `steer` to `interrupt`.
- [ ] 5.8 Update `SPEC.md` §9.6 and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.9 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 5.10 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.11 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. web

- [ ] 6.1 Add the split Send button with Steer, Interrupt, and Queue while a Run is active, with Enter and Mod+Enter (design D11). Verify "Enter steers during a Run", "Queue is an explicit choice", and "Interrupt from the Send menu" in composer stories with interaction tests.
- [ ] 6.2 Add the pending stack with its row actions and edit flow. Verify "Edit puts the text back" and "A delivered item leaves the stack" in stories.
- [ ] 6.3 Make Stop and Esc interrupt when steers are pending. Verify "Esc twice stops everything" in a story and a focused product E2E test.
- [ ] 6.4 Adopt history at `run.delivered`, attach the next segment stream, and place turn actions by `latestRun.messageId`. Render delivered messages, the `interrupted` notice, and the paused label. Verify "A reload shows the segments" and "A failed Run shows a paused queue" in `chat-page.stories.tsx`.
- [ ] 6.5 Add the split-button and pending-row patterns to `DESIGN.md`, and a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 6.6 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, Storybook story tests, the focused E2E test, `pnpm format:check`, `git diff --check`.
- [ ] 6.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 7. finalize

- [ ] 7.1 Enter `in-run-steering/finalize` with `$gh-stack` before `$openspec-sync-specs` writes canonical specs.
- [ ] 7.2 Sync the delta specs into `openspec/specs`, including the new `run-steering` capability. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 7.3 Confirm archive readiness: every task above is checked and `openspec status --change in-run-steering --json` reports all artifacts done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review and GitHub review of the finalize PR follow archive movement, under Ready-PR monitoring.

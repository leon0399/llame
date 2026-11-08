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
  <- in-run-steering/segment-prep
  <- in-run-steering/steer
  <- in-run-steering/run-control
  <- in-run-steering/interrupt
  <- in-run-steering/web
  <- in-run-steering/finalize
```

Each API layer ships one delivery mode end to end, so every layer works on its own: `queue` admits
only `delivery: "queue"`, `steer` adds `steer`, and `interrupt` adds `interrupt`. A mode that a
layer does not yet ship gets 400. `segments` and `segment-prep` build the delivery machinery and
test it with items that the test harness stores directly.

| Layer          | Parent         | Ownership                                                                                                                                        | Authored estimate | Closes |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| `proposal`     | `master`       | Proposal, design, deltas, and this task list.                                                                                                    | ~2,500            | none   |
| `queue`        | `proposal`     | The `chat_deliveries` table, `delivery: "queue"` admission, the deliveries API, live updates, promotion on completion, and the paused queue.     | ~2,000            | none   |
| `segments`     | `queue`        | The step-end check, the delivery transaction, the moved Run message, retry and settler windows, the completion check, and the salvage path.      | ~2,000            | none   |
| `segment-prep` | `segments`     | Per-segment preparation: first-dispatch detection, follow-up state, completeness, baselines, title, skills, imports, and reasoning replay.       | ~1,600            | none   |
| `steer`        | `segment-prep` | `delivery: "steer"`, the steer-to-queue move, mode changes on paused items, the segment stream and resume, and follow-ups on delivered messages. | ~1,600            | none   |
| `run-control`  | `steer`        | The run-control channel for every cancel path and for interrupt signals, with the owner-scope check.                                             | ~1,200            | #207   |
| `interrupt`    | `run-control`  | `delivery: "interrupt"`, interrupt fates, call settlement, kept output, and the `interrupted` item.                                              | ~1,800            | none   |
| `web`          | `interrupt`    | The split Send button, the pending stack, Stop and Esc, segment streams, turn actions, transcript rows, and `DESIGN.md`.                         | ~1,800            | #1622  |
| `finalize`     | `web`          | Spec sync, task records, and archive movement only.                                                                                              | ~2,000            | none   |

**Named budget exception: the proposal layer is about 2,500 authored lines.** It adds one
capability with 42 requirements and modifies 15 requirements in 10 capabilities. Most MODIFIED
blocks are long canonical requirements that must be copied whole and rewritten in Simplified
Technical English. Measure it with `git diff --numstat origin/master` before publication. Each
implementation layer is planned inside about 2,000 lines; `queue` and `segments` are at the limit.
Re-measure each at its boundary, and request a named exception before publication if it goes over.

## 1. proposal

- [x] 1.1 Validate the change: `pnpm exec openspec validate in-run-steering --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/in-run-steering/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
  - Evidence: on `ee56846a`, `openspec validate in-run-steering --strict` reports the change valid; markdownlint reports 0 issues; the link check, `pnpm format:check`, and `git diff --check` are clean.
- [x] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
  - Evidence: round 1 (spec consistency and feasibility reviewers; 22 P1, 24 P2; fixes in `6abedb4f`) and round 2 (8 P1, 22 P2, 6 P3; fixes in `ee56846a`). design.md "Revision history" records each round. Round 2 still changed substance, so the review has not converged; the GitHub review loop is the next round.
- [x] 1.3 Obtain Leo's approval of the published revision.
  - Evidence: Leo, in chat on 2026-11-08: "Spec is approved." This approves the published revision `9167d271`, including the bash-interrupt deviation and the accepted limits L1–L3.

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

- [ ] 3.1 Add `stopWhenExtra` to `ModelStreamInput`, OR it into each client's `stopWhen` (the scripted client included), and query pending `steer` and `interrupt` items and `cancel_requested_at` at each step end. Keep the `executeRun` signature with a result that drains every segment (design D3). Verify "A steer during a tool call waits for the result", "A steer during a model response waits for the step end", "A steer after the cap gives a new budget", and "A delivered message restarts the step count" with the scripted model client and directly stored items. Also verify that a step-end stop caused only by a recorded cancellation settles the Run `cancelled`.
- [ ] 3.2 Add the delivery transaction in Run-then-chat lock order, with the attempt and cancel fences: close the segment reply with its status and published usage, insert the delivered message with a new id, mark items, move `runs.message_id`, write the new attempt id, and append `run.delivered` (design D4). Verify "Two steers at one boundary", "The transcript order after a steer", "A crash before delivery keeps the item", "A superseded attempt cannot deliver", "A cancellation and a steer at one boundary", "A live client sees the segment usage", and "A delivered message executes in the active Run".
- [ ] 3.3 Check pending items in the completing transaction, continue the segment when the stopped item is gone, and continue after a salvage completion that delivers (design D3, D5). Verify "A steer during the final answer" (with and without tools), "A withdrawal after the step end", and a salvage case with a pending item.
- [ ] 3.4 Narrow crash recovery and settlers to the current segment: the Run's current message for every attempt, `hasMutation` and the rebuild window after the latest `run.delivered`, and the finalizer through the moved `message_id`. Verify "A crash retry keeps earlier segments", "A settled write in an earlier segment does not stop a retry", "A queue retry re-executes the loop from the start", "A finalizer leaves the reply of an earlier segment", "A rebuild covers only the current segment", "Step cap reached fails closed to answering", "A cancellation after a delivery leaves the earlier reply", and "A delivery does not restart the execution ceiling" with "A long steered Run reaches its budget".
- [ ] 3.5 Update `SPEC.md` §9.3–9.5 and §9.8 for segments, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 3.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. segment-prep

- [ ] 4.1 Detect a first dispatch per segment and read earlier-segment Runs through reply usage in baseline queries; skip compaction after the first segment (design D3). Verify "A steer with a skill mention", "A delivered steer activates its skill", "A delivered steer imports a file", "A segment start does not compact", and "A steer sent with another model".
- [ ] 4.2 Apply Continue and Regenerate state only to the first segment. Verify "A steer inside a Continue Run" and "A delivered message does not repeat the kept parts".
- [ ] 4.3 Count completeness by the attempts after the latest `run.delivered`, write first-epoch baselines at the first steer delivery (none when an interrupt closes the first segment), and title from the `run.created` message. Verify "A reply that a steer closed is complete", "Every request reported", "A reclaimed Run is incomplete", and "A steer in the first Run".
- [ ] 4.4 Replay earlier-segment reasoning inside the Run. Verify "A later segment keeps the reasoning of an earlier segment" in projection tests.
- [ ] 4.5 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.6 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 4.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. steer

- [ ] 5.1 Accept `delivery: "steer"` and `PATCH` to `steer`. Verify "A steer during a Run is accepted as a pending item", "Steer now changes a queue item", "A retry after delivery starts no Run", "An item id from another Chat is a duplicate", and "A steer after completion starts a Run".
- [ ] 5.2 Move pending `steer` and `interrupt` items to the head of the queue in `markFinished` under the chat-row lock for every non-completed status, route `cancelActiveRunsForMessage` through it, and start a Run for a mode change on a paused item. Verify "A failed Run pauses the queue" for every terminal writer and "Steer now on a paused item", including invalid settings.
- [ ] 5.3 End the UI stream segment at `run.delivered` and resume after the latest delivery through a start-sequence parameter (design D9). Verify "A live client sees the delivery", "A resume after a delivery replays only the current segment", and "Resume identifies the active Run first" in `run-stream-bridge.test.ts` and the `chats.controller` tests.
- [ ] 5.4 Verify "Continue on a delivered message" and "Regenerate on a delivered message" in follow-up admission integration tests.
- [ ] 5.5 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.6 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 5.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. run-control

- [ ] 6.1 Add the `llame_run_control` listener in each process that consumes `runs`, store `userId` in the abort registry, check the recorded state in the owner's scope before an abort, and send every cancel path through the channel (design D6). Verify "A cancellation reaches a worker in another process", "A lost signal still cancels the Run", and the `run-cancellation` scenarios with two Nest application contexts that each own a registry, plus chat deletion stopping a Run that executes in another process and a superseded Run.
- [ ] 6.2 Update `SPEC.md` §9.6 and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 6.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 6.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 7. interrupt

- [ ] 7.1 Add `interruptFate` to the static registry and `cancel` to dynamic MCP bindings. Verify "A write finishes before the interrupt applies", "Workspace entry finishes", and a test that every registered tool and every MCP binding has a fate.
- [ ] 7.2 Stop the segment on interrupt only while work is in flight, route the abort in `onError`, and settle open calls by fate with a per-call interrupt signal and recorded native results (design D7). Verify "An interrupt during a model response", "An interrupt takes the pending steers along", "An interrupt kills a long command", "Two calls of one step, one started", "A late tool result does not replace the settlement", "A withdrawal after an interrupt stopped work", a tool admission after the interrupt delivery that writes no attempt, "An interrupt during compaction", and "An interrupt reaches a dedicated worker".
- [ ] 7.3 Apply the interrupted-reply reasoning rule in the projection and mark the cut part (design D8). Verify "The cut reasoning part never replays" and "An interrupted reply keeps only reasoning with a later part" on the Responses, Messages, and Chat Completions wires.
- [ ] 7.4 Run the live Anthropic probe: a request that keeps a signed thinking block of an interrupted reply and drops the open block. Record the request shape and the answer in the PR body. Stop and amend the proposal if the provider rejects it.
- [ ] 7.5 Add the `interrupted` producer, its packaged template, and its first precedence rank. Verify "The notice comes first", "A killed command is named", and "An interrupted item comes before the owner text".
- [ ] 7.6 Accept `delivery: "interrupt"` and `PATCH` to `interrupt`, with `NOTIFY` in the admission transaction. Verify an admission test for `interrupt` and a mode-change test from `steer` to `interrupt`.
- [ ] 7.7 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 7.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 7.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 7.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 8. web

- [ ] 8.1 Add the split Send button with Steer, Interrupt, and Queue while a Run is active, with Enter and Mod+Enter, and send delivery modes through a plain `fetch` (design D11). Verify "Enter steers during a Run", "Queue is an explicit choice", "Interrupt from the Send menu", and a delivery send after the Run ended that attaches to the new Run in composer stories with interaction tests.
- [ ] 8.2 Add the pending stack with its row actions and edit flow. Verify "Edit puts the text back" and "A delivered item leaves the stack" in stories.
- [ ] 8.3 Make Stop and Esc interrupt when steers are pending. Verify "Esc twice stops everything" in a story and a focused product E2E test.
- [ ] 8.4 Adopt history at `run.delivered`, attach the next segment stream, and place turn actions by `latestRun.messageId`. Render delivered messages, the `interrupted` notice, and the paused label. Verify "A reload shows the segments" and "A failed Run shows a paused queue" in `chat-page.stories.tsx`.
- [ ] 8.5 Add the split-button and pending-row patterns to `DESIGN.md`, and a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 8.6 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, Storybook story tests, the focused E2E test, `pnpm format:check`, `git diff --check`.
- [ ] 8.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 8.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 9. finalize

- [ ] 9.1 Enter `in-run-steering/finalize` with `$gh-stack` before `$openspec-sync-specs` writes canonical specs.
- [ ] 9.2 Sync the delta specs into `openspec/specs`, including the new `run-steering` capability. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 9.3 Confirm archive readiness: every task above is checked and `openspec status --change in-run-steering --json` reports all artifacts done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review and GitHub review of the finalize PR follow archive movement, under Ready-PR monitoring.

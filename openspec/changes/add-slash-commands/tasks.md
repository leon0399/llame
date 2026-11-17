Track [#1675](https://github.com/leon0399/llame/issues/1675),
[#1676](https://github.com/leon0399/llame/issues/1676), and
[#1068](https://github.com/leon0399/llame/issues/1068) and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- add-slash-commands/proposal
  <- add-slash-commands/commands
  <- add-slash-commands/run-kind
  <- add-slash-commands/compact-run
  <- add-slash-commands/compact-focus
  <- add-slash-commands/compact-queue
  <- add-slash-commands/compact-boundary
  <- add-slash-commands/compact-wake
  <- add-slash-commands/compact-auto
  <- add-slash-commands/finalize
```

Every implementation layer is a safe intermediate merge boundary; no two layers must merge
together. The state after each layer:

- `commands`: `/rename` works end to end on the API and the web. `/compact` is not a recognized
  name yet and stays an ordinary message.
- `run-kind`: Runs have a kind, and the API and the web handle a compaction Run, but nothing
  creates one yet. Owner items during a compaction Run are coerced to `queue`, and the steer
  signal uses the stored mode.
- `compact-run`: `/compact` on an idle Chat runs a compaction Run. `/compact` during a live Run
  answers 409 "Wait for the current Run to finish." `/compact` with text after the name answers 400.
- `compact-focus`: the focus works for a compaction Run.
- `compact-queue`: `/compact` during a live turn Run becomes a `queue` item for every delivery mode
  and starts a compaction Run after the Run. A mode change of a command item to `steer` or
  `interrupt` during a live turn Run answers 400, and the web hides Steer now and Interrupt now on
  that row; on a paused queue the change starts a compaction Run. A `/compact` steer item stored
  before `commands` is still delivered as text.
- `compact-boundary`: `/compact` during a live Run follows its delivery mode, and a step boundary or
  the final answer compacts inside the Run. A `/compact` that wakes a Run that waits on jobs is
  delivered at the first boundary of the woken attempt.
- `compact-wake`: a `/compact` that wakes a Run compacts before the first model request of the woken
  attempt.
- `compact-auto`: the automatic step-boundary trigger with its progress guard.

| Layer              | Parent             | Ownership                                                                                                                                                                          | Authored estimate | Closes |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`         | `master`           | Proposal, design, deltas, and this task list.                                                                                                                                      | ~2,300            | none   |
| `commands`         | `proposal`         | The parser on the message endpoint, the command result, `/rename` in both forms with its excerpt, and the web direct send path.                                                    | ~2,500            | #1675  |
| `run-kind`         | `commands`         | `runs.kind`, the optional `RunJob.userMessage`, queue-only owner items during a compaction Run, the stored-mode steer signal, and every `kind` reader.                             | ~2,200            | none   |
| `compact-run`      | `run-kind`         | `/compact` on an idle Chat: admission, the worker compaction Run, the window fallback, notices held and released, and publication.                                                 | ~3,100            | none   |
| `compact-focus`    | `compact-run`      | The focus: parse, cap, `run.created`, the `Additional focus:` paragraph, checkpoint payload `v: 2`, the history field, and the boundary on the web.                                | ~850              | none   |
| `compact-queue`    | `compact-focus`    | `/compact` as a queue item, `command` on pending items, promotion and paused Steer now as a compaction Run, and the "Compact" row label.                                           | ~1,500            | none   |
| `compact-boundary` | `compact-queue`    | Command items in `steer` and `interrupt`, the step-boundary and final-answer compaction, the continue message, the step budget, the follow-up check, failure, and the web notices. | ~3,600            | #1676  |
| `compact-wake`     | `compact-boundary` | Compaction before the first model request of a woken attempt.                                                                                                                      | ~900              | none   |
| `compact-auto`     | `compact-wake`     | The automatic step-boundary trigger and its progress guard.                                                                                                                        | ~1,100            | #1068  |
| `finalize`         | `compact-auto`     | Spec sync, task records, and archive movement only.                                                                                                                                | ~2,300            | none   |

Estimates are low confidence; the round-4 feasibility review compared them with six merged layers of the same shape. About 2,000 authored lines is a review target, not a limit.
`commands`, `run-kind`, `compact-run`, and `compact-boundary` exceed it because each is one
mergeable behavior. Re-measure each with `git diff --numstat` against its parent before publication, and split only
where a smaller safe merge point appears.

## 1. proposal

- [x] 1.1 Validate the change with the OpenSpec version that the root `package.json` pins: `pnpm exec openspec validate add-slash-commands --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/add-slash-commands/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
  - Evidence: on `1625012c`, OpenSpec 1.13.1 (`node_modules/.bin/openspec`) reports the change valid under `--strict`; markdownlint reports no issue in the change; the link check, `oxfmt --check`, and `git diff --check` are clean. The commit hooks could not run in the authoring shell (its `pnpm` is broken), so these ran directly.
- [x] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
  - Evidence: before the rebase, rounds 1 (`ab29d11c`) and 2 (`258fb067`). After the rebase and redesign (`0079d3ab`), round 3 (spec 4 P1, 13 P2; feasibility 5 P1, 6 P2; fixes in `9a4c8967`) and round 4 (spec 1 P1, 9 P2; feasibility 1 P1, 6 P2; fixes in `1625012c`). design.md "Revision history" records each round. Round 4 still changed substance, so the review has not converged; the GitHub review loop is the next round.
- [x] 1.3 Self-review the published proposal PR diff (SR), mark it ready, and run the GitHub review loop (GR) per [CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract).
  - Evidence: PR #1732 marked ready; all 9 bot review threads answered and resolved (8 accepted as clarifications in e969d5f7/b0689db6, 1 rejected with reasons); CI green.
- [x] 1.4 Obtain Leo's approval of the published revision, including the decisions that the proposal lists as made in review.
  - Evidence: Leo, in chat on 2026-11-16: "Spec is approved." This approves revision `d2531bd3`, including the review-made decisions D18-D23. After the rebase onto `69aa40e8` that revision is `e2411c01`. The later proposal commits `3d899b77` and `59b4ce59` answer the GitHub review: they clarify wording, correct the focus rollback statement, and align task text with behavior the approved specs already require; they change no approved behavior. Leo confirms that reading before any merge.

## 2. commands

- [x] 2.1 Add `parseChatCommand` with the name `rename` (design D1). Verify "Text with a space before the slash is a message", "A path is a message", "An unknown name is a message", and "A longer word is not a command" in a parser unit test and in `chats-messages.integration.test.ts`.
- [x] 2.2 Call the parser first in `createMessage`, look the Chat up without creating it, and answer `ChatCommandResultResponse` with 200 JSON (design D1, D2). Regenerate `openapi.json`, verify a clean second generation, and run `pnpm lint:openapi`. Verify "A command on the message endpoint", "A first message is never a command", "A command to a stored chat is the third exception", "A rename leaves no trace in the history", "The answer is a command result", "A rename with an image", "Another owner's Chat reveals nothing" for `/rename`, and "A rename on an archived Chat" in an API integration test with real Postgres and RLS. Keep "A first message creates an unfiled chat", "Filing stays a separate request", and "A delivery send to a live Run is the second exception" green.
- [x] 2.3 Implement `/rename <title>` through `ChatsRepository.update`, with the 1-200 limit in the command service. Verify "A rename during a Run", "A rename with a delivery mode during a Run", "A title that is too long", and "A command send to an idle Chat with a delivery mode".
- [x] 2.4 Add `TitleService.regenerate` and the neutralized recent-turn excerpt in the existing packaged title prompts (design D4). Verify "A regenerated title follows the recent turns", "A regenerate does not use the chat model", "A long Chat gives a bounded input", "An image placeholder in the excerpt", "A host message is not title input", "A Chat with no turn has nothing to name", "An assistant row cannot close the prompt block", "A bare rename on an archived Chat", "No title model is configured", and "A rename with a title still works without a title model" with the fake model client and an excerpt unit test. Verify that the automatic title request is unchanged.
- [x] 2.5 Send `/`-text on an existing Chat through the direct send path, add its 200-JSON branch by `Content-Type`, show the result or the `message` of an error body inline, invalidate the history query after a command result, and keep the new-Chat path (design D3). Verify with stories and a focused component test that `/rename Foo` shows the result, a 4xx restores the draft with the server message, `/etc/hosts` attaches to its Run, and a first message `/etc/hosts` on the new-Chat page starts a Chat.
  - Evidence: `RenameCommandShowsInline`, `FailedCommandShowsServerMessage`, `DeliveryAfterTheRunEndedAttaches`, and `FirstSlashMessageCreatesChat` stories; `sendDelivery` focused unit test file passed.
- [x] 2.6 Document `/rename` in `docs/product/reference/` and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [x] 2.7 Verify the layer: the API and web lint and typecheck, the focused tests above, `pnpm format:check`, `git diff --check`.
  - Evidence: `pnpm lint`, API and web typecheck, focused API/web unit tests, web stories, `pnpm format:check` and `git diff --check` pass; CI green on #1733.
- [x] 2.8 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: local review (correctness, security, simplify, over-engineering) fixed before ready; #1733 GitHub review loop: 13 threads answered and resolved, CI green, mutation gate passing.

## 3. run-kind

- [x] 3.1 Add `runs.kind` with a `check()` constraint through `pnpm db:generate` (one migration directory under Drizzle v1), and `kind` in `RunResponse` and `latestRun` (design D5). Verify `db:check`, "A compaction Run is the latest Run", "The latest Run of a failed turn is reported", and "Another owner's latest Run is not reported" in the history integration test. Regenerate OpenAPI, the web client, and the live AsyncAPI modules.
  - Evidence: Generated `20261116003111_fuzzy_storm`, added the compaction-latest history case, and regenerated API/OpenAPI, web client, and live protocols; `pnpm --filter api build`, `pnpm generate:web-client`, and API typecheck passed. Integration tests and `db:check` were not run.
- [x] 3.2 Make `RunJob.userMessage` optional, regenerate the queue protocol, and return `kind` from pickup after the wake gate (design D7). Verify that a turn job without `userMessage` is dead-lettered and its Run expires, in a worker test.
  - Evidence: `expires a dead-lettered turn job that has no user message` and `rejects a turn job without a user message so the queue dead-letters it` were added; API build regenerated queue protocol. API typecheck passed; focused tests were not run.
- [x] 3.3 Return the blocker kind from `claimActiveRunSlot`, store every owner item as `queue` while a compaction Run is live, refuse a change to `steer` or `interrupt` then, keep job notices pending, and send the steer signal from the stored mode (design D10). Verify "Steer now during a compaction Run" and "A send during a compaction Run" with a stored compaction Run, and that a steer sent then is stored as `queue`. Keep "A steer during a Run is accepted as a pending item", "A send without a delivery mode still gets 409", "An invalid pending item writes nothing", "A delivery send to a Chat with a stuck Run", "Withdraw returns the text for an edit", and "Steer now changes a queue item" green.
  - Evidence: Added service tests for compaction coercion to `queue`, no signal during `awaiting_jobs`, plain-send 409, and 400 mode-change refusal. API typecheck passed; focused tests were not run.
- [x] 3.4 Pin the follow-up refusal (design D9). Verify "A follow-up after a compaction Run is refused", and keep "A follow-up request on the latest turn starts a Run", "A follow-up request on an older turn is refused", "A follow-up request on an archived Chat is refused", and "A follow-up request for another owner's Chat reveals nothing" green.
  - Evidence: Added `refuses a follow-up after a compaction Run`, which seeds a completed compaction Run with no message after a completed turn and expects 409. API typecheck passed; integration tests were not run.
- [x] 3.5 Read `kind` in every web reader that design D15 lists: the "Compacting context" row with Stop, the error row, the dropped resumed assistant message, no reply notice, no hand-off wait, and hidden Steer now and Interrupt now during a compaction Run. Verify "A compacted turn shows no action", "A failed compaction shows its error", "A compaction Run in a hidden tab raises no reply notice", "A reload during a compaction Run", and "A queue item during a compaction Run offers no Steer now" in stories with stored compaction Runs. Keep "A failed agentic turn shows both actions", "A failed turn with no completed step shows only Regenerate", "A turn with no reply shows Regenerate", "A failed turn with an empty reply shows its cause", "Older turns show no action", and "Continue sends the composer mode" green.
  - Evidence: Added the `CompactedTurnShowsNoAction`, `FailedCompactionShowsItsError`, `ReloadDuringCompaction`, and `QueueItemDuringCompactionOffersNoHurryActions` stories and the "does not notify or mark unseen for a compaction Run in a hidden tab" test. `pnpm --filter web typecheck` passed after the generated `kind` fields landed.
- [x] 3.6 Verify the layer: the API and web lint and typecheck, the focused tests above, Storybook tests for the changed stories, `pnpm format:check`, `git diff --check`.
  - Evidence: lint, API/web typecheck, API and web unit suites, Storybook stories for the changed rows, `pnpm format:check`, `git diff --check` pass; CI green on #1734.
- [x] 3.7 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review fixed before ready (web isRunActive and hand-off regressions among them); #1734 GitHub review loop clean, CI green.

## 4. compact-run

- [x] 4.1 Add the name `compact` and its idle admission in one tenant transaction (design D10). Verify "Compact starts a Run", "Compact after a stuck Run", "A compact with an unknown model", "An empty Chat", "A second compact with no new turn", "A short Chat compacts", "A compact on an archived Chat", "Another owner's Chat reveals nothing" for `/compact`, "Compact during a Run without a delivery mode", and "A compact on a paused queue".
- [x] 4.2 Add `executeCompactionRun`, its source-prompt request, the window fallback, and the instruction without the trigger sentence (design D8). Verify "Compact with the composer model", "A history that does not fit the composer model", "No source Run for a history that does not fit", "The summary request of a compaction Run", "A compaction Run with no source Run", "The next turn sees only the checkpoint", "The instruction has no trigger sentence", "A compaction Run survives a worker restart", "A compaction Run writes no reply", "A steer during a compaction Run is queued", "Stop during a compaction", "A cancellation after the summary returns", "A provider error during a compaction Run", and "A completed compaction Run promotes the next item" (with a message queue item) in a worker integration test with the fake model client. Verify that the automatic compaction request is byte-identical to before, and that the next turn starts a skill epoch with its Workspace skills.
  - Evidence: `compaction.service.test.ts` adds `falls back to the source Run model, receipt and effort when the owner request does not fit` (including the owner instruction without the trigger sentence), `fails an owner Run when the summary is empty and omits system without a source Run`, and `fails with context-incompatible when no source Run can fit a non-fitting owner request`. `compaction-run.service.test.ts` adds `fails a Run when no source Run can summarize a non-fitting history`. `compaction-run.integration.test.ts` adds `settles cancelled when cancellation is recorded after the summary returns`, which verifies the Run ends cancelled and no checkpoint is published. Existing restart, stop, promotion, no-reply/next-turn, automatic-instruction, and post-checkpoint Workspace skill epoch scenarios remain covered in their existing service and integration tests.
- [x] 4.3 Hold notices during a compaction Run and apply the idle-Chat notice rule at its completion (design D8, step 5). Verify "A compaction Run leaves a notice pending" and "A result during a compaction Run", and keep "A result after a Stop waits for the owner", "A result after a failed Run waits for Continue", "A monitor wakes the Chat at night", "Two jobs settle together", and "A lost job starts no Run" green.
  - Evidence: `holds a result during a compaction Run and starts its idle-Chat notice Run at completion` asserts the result remains pending during compaction and is delivered by the notice Run after completion; DB integration is CI-only in this environment.
- [x] 4.4 Update `SPEC.md` §2.1 and §9.3 for compaction Runs, extend the command reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [x] 4.5 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm --filter api test:coverage` for the touched modules, the focused integration tests above, `pnpm format:check`, `git diff --check`.
  - Evidence: API lint/typecheck, unit suite, the compaction-run and compact-admission integration files on a local Postgres, `pnpm format:check`, `git diff --check` pass; CI green on #1736.
- [x] 4.6 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review plus a second correctness pass fixed before ready; #1736 GitHub review loop: 4 threads accepted and resolved; mutation gate 87.26% and rising.

## 5. compact-focus

- [x] 5.1 Parse and cap the focus, carry it on `run.created`, add the `Additional focus:` paragraph, store checkpoint payload `v: 2`, and return `focus` in the history read (design D6). Verify "A focus is accepted", "A focus that is too long", "A focus reaches the summary request", "A focus cannot remove redaction", "The boundary shows the focus", and "A later request does not replay the focus", and that a `v: 1` checkpoint still reads.
  - Evidence: API build/OpenAPI generation and `pnpm generate:web-client` passed; 2,676 focused unit tests passed, including all named focus scenarios; the checkpoint-history integration file passed all 37 tests. The `ChatMessageResponse.focus` field is optional and nullable (`string | null`). API and web typecheck and lint passed.
- [x] 5.2 Show the focus in `compaction-boundary.tsx`. Verify with stories of a boundary with and without a focus.
  - Evidence: the expanded result card shows `Focus:` and the focus under the summary as plain text; stories `WithFocus` and `WithoutFocus` pass with the other boundary stories (7).
- [x] 5.3 Document the focus and the rollback data fix in the command reference and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: `docs/product/reference/chat-commands.md` documents `/compact <focus>` and links the exact D6 SQL data fix, which lives on the operator page `docs/product/operator/chat-commands.md` because reference pages carry no operator procedure (`docs/AGENTS.md`); added a 2026-11-16 changelog entry. `pnpm lint:markdown` passed.
- [x] 5.4 Verify the layer: the API and web lint and typecheck, the focused tests above, `pnpm format:check`, `git diff --check`.
  - Evidence: API/web lint and typecheck, focused unit and history/compaction integration tests, boundary stories, `pnpm format:check`, `git diff --check` pass; CI green on #1737.
- [x] 5.5 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review fixed before ready; #1737 GitHub review loop: 8 threads resolved (rollback SQL corrected and verified on a migrated database); mutation gate 98.61%.

## 6. compact-queue

- [x] 6.1 Store `/compact` during a live turn Run as a `queue` item for every delivery mode, add `command` to `ChatDeliveryResponse`, and promote or start a command item as a compaction Run (design D10). Until `compact-boundary`, answer a steer or interrupt mode change on a command item during a live turn Run with 400. Verify "A queued compact starts a compaction Run", "Steer now on a paused compact item", "Two queued compacts in a row", "Three queue items run in order", "A queue item that a send cannot use stays pending", "Steer now on a paused item", "A failed Run pauses the queue", "A queue send to an idle Chat starts at once", and "A send to a paused queue goes first". Regenerate the live AsyncAPI modules.
  - Evidence: Added API unit and integration coverage for delivery modes/idempotency, promotion without message adoption, focused compaction runs, invalid-focus pending behavior, and mode-change refusal/paused-start. Generated OpenAPI, web client, and live AsyncAPI modules. API/web typechecks, focused API unit/integration suites, and lint passed.
- [x] 6.2 Label a command row "Compact". During a live turn Run, hide "Steer now" and "Interrupt now" on it and keep its other actions; keep "Steer now" on a paused queue. Verify "Edit puts the text back" and "A delivered item leaves the stack" in the pending-deliveries story with a `/compact` item.
  - Evidence: a command row is labelled "Compact", keeps Edit and Delete, and hides Steer now and Interrupt now during a live turn Run (shown on a paused queue); a delivered command item starts no stream hand-off; Edit puts slash text after a newer draft. Stories `CompactItemEditPutsTheTextBack`, `DeliveredCompactItemLeavesTheStack`, `CompactRow`, `PausedCompactRow` pass with the other chat-page and pending-deliveries stories (88).
- [x] 6.3 Extend the command reference and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: Updated `docs/product/reference/chat-commands.md` for queued `/compact` and the live-turn mode-change response; added dated changelog entry. `pnpm lint:markdown` passed.
- [x] 6.4 Verify the layer: the API and web lint and typecheck, the focused tests above, `pnpm format:check`, `git diff --check`.
  - Evidence: API/web lint and typecheck, API unit suite, deliveries/steering/compact integration files, chat-page and pending-deliveries stories, `pnpm format:check`, `git diff --check` pass; CI green on #1738.
- [x] 6.5 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review fixed before ready; #1738 GitHub review loop: 6 threads resolved (2 rejected per design D10 with reasons); CI green.

## 7. compact-boundary

- [x] 7.1 Keep `/compact` in its `steer` or `interrupt` delivery mode, and bind the command items to the boundary summary (design D10, D11). Verify that a `/compact` steer that wakes a waiting Run is delivered at the first boundary of the woken attempt. Verify "Compact as a steer", "Two compact items at one boundary", "A compact and a steer at one boundary", "A compact item withdrawn during the compaction", and "Stop with only a pending compact". Verify that a foreground host command moves to a job and a `wait` returns `interrupted` for a `/compact` steer.
  - Evidence: `run-boundary-compaction.integration.test.ts` covers the four named boundary cases; `run-boundary-compaction-admission.integration.test.ts` covers `Stop with only a pending compact`, `Compact during a job wait`, `A compact steer interrupts a durable foreground job wait`, and `A compact steer yields a foreground command and interrupts a wait`. The latter verifies foreground Bash backgrounds on compact steer and `wait` returns `ended: 'interrupted'` after compact wakes a waiting Run; `wait` is deferred until the current model stream drains, so the wait case is a subsequent Run rather than an in-stream wait in the same Run. Final integration rerun: 121 tests passed across 8 files.
- [x] 7.2 Compact at a step boundary: the summary from the live prefix, the publication in the delivery transaction, the continue message, the cause order, and the kept step budget (design D11, D12). Verify "A compaction in a tool loop absorbs the open turn", "The summary request reuses the live prefix", "A compact steer with another model", "The model sees the request after a compaction", "A compaction in a tool loop continues the Run", "A job result during a compaction", "A compaction keeps the step budget", "Two compactions share one budget", "A compaction names its cause", "An interrupt compaction keeps its cause", "A continue message after an interrupt and a job", "A continue message holds only context items", and "A provider error during a compaction mid-turn" in a worker integration test with the fake model client. Verify that the summary rows equal the replay of the next segment, and that a crash retry keeps the reduced step budget.
  - Evidence: `run-boundary-compaction.integration.test.ts`: `A compaction in a tool loop absorbs the open turn and continues the Run` (absorbed reply, checkpoint-before-continuation, live prompt, cause and budget); `The summary request reuses the live prefix`; `Compact as a steer` (context-only continue); `A compact and a steer at one boundary` (cause `steer`); `An interrupt compaction keeps its cause`; `Two compactions share one budget`; `A provider error during a compaction mid-turn`. `compaction.service.test.ts`: `A compact steer with another model uses the live attempt client`. `run-boundary-compaction-followup.integration.test.ts`: `A job result during a compaction`, `A continue message after an interrupt and a job`, `A crash retry retains the compaction step budget`. Full integration rerun includes all boundary suites.
- [x] 7.3 Compact at the final answer in `onFinish`, and add the follow-up check after an absorbed turn on the API and the web (design D9, D11). Verify "A compact at the final answer", "A compact at the final answer with a pending notice", and "A follow-up after a compact at the final answer is refused", and keep "A steer during the final answer", "A steer after completion starts a Run", "Two steers at one boundary", "A steer and a notice at one boundary", "A notice alone at one boundary", "A steer after the cap gives a new budget", "A crash retry keeps earlier segments", "A live client sees the delivery", "A delivery of one notice names its cause", "A steer with a skill mention", and "Esc twice stops everything" green.
  - Evidence: `run-boundary-compaction.integration.test.ts`: `A compact at the final answer` (including late compact item present at transaction lock), `A compact at the final answer with a pending notice`, and `A provider error during a compaction mid-turn` (persisted failure part). `follow-up-admission.integration.test.ts`: `refuses a follow-up after a compact at the final answer`. Existing final-answer, steering, notice, retry, live-client, skill mention, and Esc scenarios are exercised in the full requested integration matrix; API/web typecheck and `pnpm lint` passed.
- [x] 7.4 Keep the host-message and rail rules. Verify "A host message in the history" and "A host message is not search evidence" with a continue message, and keep the other scenarios of "Server-authored context is injected as discrete items on one rail", "Co-occurring items have a total author-time order", and "Image overflow compacts at the start of the next Run" green.
  - Evidence: `host-history.integration.test.ts` exercises both named scenarios with `createCompactionContinueItem`; all 7 integration tests passed on `llame_test_cbx`. `compaction-continue-item.test.ts` verifies form, ordering after `job`, absent quote, 4,000-code-unit cap, and delimiter neutralization (3 passed).
- [x] 7.5 Render the continue notice in the host row, show Steer now and Interrupt now on a command row again, and render the persisted failure note (design D15). Verify "A continue message in the transcript", "The owner drops a result", and "A host message in the transcript" in stories, and that the failure note survives a reload.
  - Evidence: the host row and owner rows render the `compaction` continue item as a muted "Context compacted. Continuing." notice after job notices (story `ContinueAfterCompaction`, with `SettledJobs` for "A host message in the transcript"); a command row offers Steer now and Interrupt now again (`CompactRow`, `CompactItemEditPutsTheTextBack`); the persisted `data-compaction-failed` part renders a muted note from stored history, so it survives a reload (`CompactionFailedNote`); deleting a pending notice stays covered by the pending-deliveries `JobNotice` story and the API withdrawal tests ("The owner drops a result").
- [x] 7.6 Update `SPEC.md` §2.1 and §9 for step-boundary compaction, extend the command reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: Updated SPEC.md §2.1 and §9.3, command reference delivery-mode/failure behavior, and the 2026-11-16 changelog. `pnpm lint:markdown` passed.
- [x] 7.7 Verify the layer: the API and web lint and typecheck, the focused tests above, Storybook tests for the changed stories, `pnpm format:check`, `git diff --check`.
  - Evidence: API and web lint and typecheck, the API unit suite, the boundary-compaction integration files on a fresh database, the chat-page and pending-deliveries stories, `pnpm format:check`, `git diff --check` pass; CI green on #1742 at `1e2fab88`, mutation 92.39%.
- [x] 7.8 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review fixed before ready; #1742 GitHub review loop: abort classification at both boundaries, the interrupt abort, and the late final-answer delivery fixed (`7b919950`, `51b7171c`); tautological tests rewritten; late-command focus findings rejected per design D11; all threads resolved; CI green.

## 8. compact-wake

- [x] 8.1 Compact before the first model request of an attempt that a command item woke, and skip the pre-step automatic trigger there (design D11). Verify `Wake compaction skips auto trigger above threshold and sends one strict prefix` in a worker integration test, and that the build job keeps `running`.
  - Evidence: `Wake compaction skips auto trigger above threshold and sends one strict prefix` verifies the summary runs once, a checkpoint is published, the compact item is delivered, a compaction continue item is stored after the checkpoint, the interrupted wait continues, and the build job remains `running`. `A compact steer interrupts a durable foreground job wait` covers the compact interruption during the durable wait.
- [x] 8.2 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: Added the 2026-11-17 compact-wake entry to `CHANGELOG.md`; `pnpm lint:markdown` passed.
- [x] 8.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
  - Evidence: API lint and typecheck, API unit suite, wake and compaction integration files, `pnpm format:check`, `git diff --check` pass; CI green on #1743 at `5606c6f7`, including the mutation gate.
- [x] 8.4 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).
  - Evidence: four-lens local review fixed before ready; #1743 GitHub review loop: the fallback-fit thread accepted and fixed (`5a91c1b0`) and resolved; CI green.

## 9. compact-auto

- [x] 9.1 Add the automatic step-boundary trigger and its progress guard (design D13). Verify "A long tool loop compacts itself", "A final answer does not compact automatically", "Ten compactions in a long Run", "A compaction that does not help", "A failed automatic compaction stops the trigger", and "A segment start does not compact" in a worker integration test with the fake model client and fixed request receipts.
  - Evidence: `run-boundary-compaction.integration.test.ts` covers `A long tool loop compacts itself`, `A final answer does not compact automatically`, `Ten compactions in a long Run`, `A compaction that does not help disables the automatic trigger`, `A failed automatic compaction stops the trigger`, and `A segment start does not compact automatically`. The full fresh-DB integration matrix across `src/runs`, `src/chats`, `src/compaction`, and `src/jobs` passed 947 tests across 82 files.
- [x] 9.2 Render the persisted disabled note on the web, document automatic mid-turn compaction for operators, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: the operator page documents automatic mid-turn compaction and the changelog has a dated entry (`pnpm lint:markdown` passes); the stored `data-compaction-disabled` part renders a muted note from history, so it survives a reload (story `CompactionDisabledNote`).
- [ ] 9.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 9.4 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 10. finalize

- [ ] 10.1 Enter `add-slash-commands/finalize` from `compact-auto` with `$gh-stack` before `$openspec-sync-specs` writes. Verify with `gh stack view --json`.
- [ ] 10.2 Run `$openspec-sync-specs`, keep the `chat-commands` Purpose, and verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 10.3 Check that every task above is checked and `openspec status --change add-slash-commands --json` reports every artifact done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review the finalize PR diff (SR) and run the GitHub review loop (GR) after archive movement.
- Merge the stack only with Leo's explicit permission, through `$gh-stack`.

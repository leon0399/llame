Track [#1675](https://github.com/leon0399/llame/issues/1675) and
[#1676](https://github.com/leon0399/llame/issues/1676) and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- add-slash-commands/proposal
  <- add-slash-commands/commands
  <- add-slash-commands/commands-web
  <- add-slash-commands/run-kind
  <- add-slash-commands/compact-run
  <- add-slash-commands/compact-window
  <- add-slash-commands/compact-focus
  <- add-slash-commands/compact-web
  <- add-slash-commands/queued-commands
  <- add-slash-commands/finalize
```

Each layer works on its own:

- `commands` recognizes only `rename`; `/compact` stays an ordinary message until `compact-run`.
  Until `commands-web`, the web composer shows a send error for a command, because its transport
  expects a stream.
- `run-kind` tests compaction Runs that the test harness stores directly.
- Until `compact-window`, a compaction Run whose absorbed rows do not fit its model fails with the
  existing context error.
- Until `compact-focus`, `/compact` with text after the name answers 400.
- Until `compact-web`, a compaction Run shows on the web only through the refreshed history.
- Until `queued-commands`, `/compact` during a live Run answers 409 "Wait for the current Run to
  finish."

| Layer             | Parent            | Ownership                                                                                                                                  | Authored estimate | Closes |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| `proposal`        | `master`          | Proposal, design, deltas, and this task list.                                                                                              | ~1,500            | none   |
| `commands`        | `proposal`        | The API parser on the message endpoint, the command result, and `/rename` in both forms with its excerpt.                                  | ~1,500            | none   |
| `commands-web`    | `commands`        | The web direct send path for `/`-text on an existing Chat, the 200-JSON branch, and the inline result and error.                           | ~700              | #1675  |
| `run-kind`        | `commands-web`    | `runs.kind`, `kind` in Run responses, the optional `RunJob.userMessage`, and queue-only pending items during a compaction Run.             | ~1,100            | none   |
| `compact-run`     | `run-kind`        | `/compact` admission on an idle Chat, the worker compaction branch with its source-prompt request, the owner instruction, and publication. | ~1,900            | none   |
| `compact-window`  | `compact-run`     | The window fallback for absorbed rows that do not fit the Run model, and the failure without a source Run.                                 | ~400              | none   |
| `compact-focus`   | `compact-window`  | The focus: parse, cap, `run.created`, the `Additional focus:` paragraph, checkpoint payload `v: 2`, and the history field.                 | ~700              | none   |
| `compact-web`     | `compact-focus`   | The compaction Run row, Stop, the error row, `kind` in every web reader of `latestRun`, resume, notices, and the focus on the boundary.    | ~1,300            | none   |
| `queued-commands` | `compact-web`     | `/compact` as a queue item, the command-item guards, promotion to a compaction Run, and the pending row without Steer now.                 | ~1,100            | #1676  |
| `finalize`        | `queued-commands` | Spec sync, task records, and archive movement only.                                                                                        | ~1,500            | none   |

Estimates are low confidence; the round-2 feasibility review compared them with recent layers of the
same shape. Re-measure each layer with `git diff --numstat` against its parent before publication,
and request a named exception before publishing a layer over about 2,000 authored lines.
`compact-run` is at the limit: if it goes over, move publication's cancellation check and its tests
into `compact-window`.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate add-slash-commands --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/add-slash-commands/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
- [ ] 1.3 Self-review the published proposal PR diff (SR), mark it ready, and run the GitHub review loop (GR) per [CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract).
- [ ] 1.4 Obtain Leo's approval of the published revision, including the decisions that the proposal lists as made in review.

## 2. commands

- [ ] 2.1 Add `parseChatCommand` with the name `rename` (design D1). Verify "Text with a space before the slash is a message", "A path is a message", "An unknown name is a message", and "A longer word is not a command" in a parser unit test and in `chats-messages.integration.test.ts`.
- [ ] 2.2 Call the parser first in `createMessage`, look the Chat up without creating it, and answer `ChatCommandResultResponse` with 200 JSON (design D1, D2). Regenerate `openapi.json`, verify a clean second generation, and run `pnpm lint:openapi`. Verify "A command on the message endpoint", "A first message is never a command", "A command to a stored chat is the third exception", "A rename leaves no trace in the history", "The answer is a command result", "A rename with an image", "Another owner's Chat reveals nothing" for `/rename`, and "A rename on an archived Chat" in an API integration test with real Postgres and RLS. Keep "A first message creates an unfiled chat", "Filing stays a separate request", and "A delivery send to a live Run is the second exception" green.
- [ ] 2.3 Implement `/rename <title>` through `ChatsRepository.update`, with the 1-200 limit in the command service. Verify "A rename during a Run", "A rename with a delivery mode during a Run", "A title that is too long", and "A command send to an idle Chat with a delivery mode" in the integration test.
- [ ] 2.4 Add `TitleService.regenerate` and the neutralized recent-turn excerpt in the existing packaged title prompts (design D4). Verify "A regenerated title follows the recent turns", "A regenerate does not use the chat model", "A long Chat gives a bounded input", "An image placeholder in the excerpt", "A Chat with no turn has nothing to name", "An assistant row cannot close the prompt block", "A bare rename on an archived Chat", "No title model is configured", and "A rename with a title still works without a title model" with the fake model client and an excerpt unit test. Verify the automatic title request is unchanged.
- [ ] 2.5 Document `/rename` in `docs/product/reference/` and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.6 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 2.7 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 3. commands-web

- [ ] 3.1 Send `/`-text on an existing Chat through the direct send path, add its 200-JSON branch by `Content-Type`, show the result or the `message` of an error body inline, invalidate the history query after a command result, and keep the new-Chat path (design D3). Verify with stories and a focused component test that `/rename Foo` shows the result, a 4xx restores the draft with the server message, `/etc/hosts` attaches to its Run, and a first message `/etc/hosts` on the new-Chat page starts a Chat.
- [ ] 3.2 Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.3 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 3.4 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 4. run-kind

- [ ] 4.1 Add `runs.kind` in a generated migration and `kind` in `RunResponse` and `latestRun` (design D5). Verify `db:check`, "A compaction Run is the latest Run", "The latest Run of a failed turn is reported", and "Another owner's latest Run is not reported" in the history integration test. Regenerate OpenAPI, the web client, and the live AsyncAPI modules.
- [ ] 4.2 Make `RunJob.userMessage` optional, regenerate the queue protocol, and branch the worker on `runs.kind` (design D7). Verify that a turn job without `userMessage` is dead-lettered and its Run expires, in a worker test.
- [ ] 4.3 Store every pending item as `queue` while a compaction Run is live, refuse a mode change to `steer` or `interrupt` then, and skip steering delivery when a compaction Run completes (design D10). Verify "A steer during a compaction Run is queued", "Steer now during a compaction Run", and "A send during a compaction Run" with a stored compaction Run, and keep "A steer during a Run is accepted as a pending item", "A send without a delivery mode still gets 409", "An invalid pending item writes nothing", "A delivery send to a Chat with a stuck Run", "Withdraw returns the text for an edit", and "Steer now changes a queue item" green.
- [ ] 4.4 Pin the follow-up refusal (design D9). Verify "A follow-up after a compaction Run is refused" in the follow-up integration test, and keep "A follow-up request on the latest turn starts a Run", "A follow-up request on an older turn is refused", "A follow-up request on an archived Chat is refused", and "A follow-up request for another owner's Chat reveals nothing" green.
- [ ] 4.5 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 4.6 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 5. compact-run

- [ ] 5.1 Add the name `compact` to the parser and `/compact` admission in one tenant transaction (design D10, first two bullets). Verify "Compact starts a Run", "Compact after a stuck Run", "A compact with an unknown model", "An empty Chat", "A second compact with no new turn", "A short Chat compacts", "A compact on an archived Chat", "Another owner's Chat reveals nothing" for `/compact`, and "A compact on a paused queue".
- [ ] 5.2 Add `executeCompactionRun`, the source-prompt summary request, and the owner variant of the summary instruction (design D8). Verify "Compact with the composer model", "The summary request of a compaction Run", "A compaction Run with no source Run", "The next turn sees only the checkpoint", "The instruction has no trigger sentence", "A compaction Run survives a worker restart", "A compaction Run writes no reply", "Two queued compacts in a row", "Stop during a compaction", "A cancellation after the summary returns", "A provider error during a compaction Run", and "A completed compaction Run promotes the next item" (with a message queue item) in a worker integration test with the fake model client. Verify that the automatic compaction request is byte-identical to before, and that the next turn after a compaction Run starts a skill epoch with its Workspace skills.
- [ ] 5.3 Update `SPEC.md` §2.1 and §9.3 for compaction Runs, extend the command reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.4 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm --filter api test:coverage` for the touched modules, the focused integration tests above, `pnpm format:check`, `git diff --check`.
- [ ] 5.5 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 6. compact-window

- [ ] 6.1 Use the existing window variant when the absorbed rows do not fit the Run model, and fail the Run without a source Run (design D8, step 3). Verify "A history that does not fit the composer model" and "No source Run for a history that does not fit" in the worker integration test.
- [ ] 6.2 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 6.3 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 7. compact-focus

- [ ] 7.1 Parse and cap the focus, carry it on `run.created`, add the `Additional focus:` paragraph, store checkpoint payload `v: 2`, and return `focus` in the history read (design D6). Verify "A focus is accepted", "A focus that is too long", "A focus reaches the summary request", "A focus cannot remove redaction", "The boundary shows the focus", and "A later request does not replay the focus", and that a `v: 1` checkpoint still reads.
- [ ] 7.2 Document the focus and the rollback data fix in the command reference and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 7.3 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 7.4 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 8. compact-web

- [ ] 8.1 Read `latestRun.kind` in every reader that design D11 lists. Verify "A compacted turn shows no action", "A failed compaction shows its error", "A compaction Run in a hidden tab raises no reply notice", and "A queue item during a compaction Run offers no Steer now" in stories, and keep "A failed agentic turn shows both actions", "A failed turn with no completed step shows only Regenerate", "A turn with no reply shows Regenerate", "A failed turn with an empty reply shows its cause", "Older turns show no action", and "Continue sends the composer mode" green.
- [ ] 8.2 Add the "Compacting context" row with Stop, drop the resumed assistant message of a compaction Run, and refetch history when the Run ends. Verify "A reload during a compaction Run" and that Stop calls `cancelRun` in a story interaction test.
- [ ] 8.3 Show the focus in `compaction-boundary.tsx`. Verify with stories of a boundary with and without a focus.
- [ ] 8.4 Update `DESIGN.md` if a new pattern appears, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 8.5 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, Storybook tests for the changed stories, `pnpm format:check`, `git diff --check`.
- [ ] 8.6 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 9. queued-commands

- [ ] 9.1 Store `/compact` with a delivery mode during a live Run as a `queue` item, and add `command` to `ChatDeliveryResponse` (design D10). Verify "Compact during a Run", "Compact during a Run without a delivery mode", and "A compact command during a Run is a queue item", and keep "A queue send to an idle Chat starts at once" and "A send to a paused queue goes first" green in `chat-deliveries.integration.test.ts`. Regenerate the live AsyncAPI modules.
- [ ] 9.2 Refuse a mode change of a command item. Verify "A command item refuses Steer now", "A paused command item cannot start by a mode change", and "Steer now on a paused item".
- [ ] 9.3 Promote a command item to a compaction Run. Verify "A queued compact starts a compaction Run", "Three queue items run in order", "A queue item that a send cannot use stays pending", and "A failed Run pauses the queue" in the worker integration test.
- [ ] 9.4 Offer only delete and edit on a command row, and skip the hand-off wait for a promoted command item (design D11). Verify "A command item offers no Steer now", "Edit puts the text back", and "A delivered item leaves the stack" in the pending-deliveries story.
- [ ] 9.5 Update `SPEC.md` §9 for command items, extend the command reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 9.6 Verify the layer: the API and web lint and typecheck, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 9.7 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 10. finalize

- [ ] 10.1 Enter `add-slash-commands/finalize` from `queued-commands` with `$gh-stack` before `$openspec-sync-specs` writes. Verify with `gh stack view --json`.
- [ ] 10.2 Run `$openspec-sync-specs`, keep the `chat-commands` Purpose, and verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 10.3 Check that every task above is checked and `openspec status --change add-slash-commands --json` reports every artifact done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review the finalize PR diff (SR) and run the GitHub review loop (GR) after archive movement.
- Merge the stack only with Leo's explicit permission, through `$gh-stack`.

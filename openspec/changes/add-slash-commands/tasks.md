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
  <- add-slash-commands/compact-run
  <- add-slash-commands/compact-web
  <- add-slash-commands/queued-commands
  <- add-slash-commands/finalize
```

Each layer works on its own. Until `queued-commands`, `/compact` during a live Run answers 409 with
"Wait for the current Run to finish." Until `compact-web`, a compaction Run shows on the web only
through the refreshed history.

| Layer             | Parent            | Ownership                                                                                                                                    | Authored estimate | Closes |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`        | `master`          | Proposal, design, deltas, and this task list.                                                                                                | ~1,100            | none   |
| `commands`        | `proposal`        | The parser on both ingress paths, the command result, the web direct send path for `/`-text, and `/rename` in both forms.                    | ~1,500            | #1675  |
| `compact-run`     | `commands`        | `runs.kind`, the `RunJob` union, the worker compaction branch, the owner instruction and focus, `/compact` admission, and follow-up refusal. | ~1,900            | none   |
| `compact-web`     | `compact-run`     | The compaction Run row, Stop, the error row, `kind` in every web reader of `latestRun`, and the focus on the boundary.                       | ~900              | none   |
| `queued-commands` | `compact-web`     | `/compact` as a queue item, the mode guard, promotion to a compaction Run, and the pending row without Steer now.                            | ~800              | #1676  |
| `finalize`        | `queued-commands` | Spec sync, task records, and archive movement only.                                                                                          | ~1,000            | none   |

Estimates are low confidence. Re-measure each layer with `git diff --numstat` against its parent
before publication, and request a named exception before publishing a layer over about 2,000
authored lines. `compact-run` is at the limit: if it goes over, move the focus (task 3.5) into its
own layer above it.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate add-slash-commands --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/add-slash-commands/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately. Record each round in the design revision history.
- [ ] 1.3 Self-review the published proposal PR diff (SR), mark it ready, and run the GitHub review loop (GR) per [CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract).
- [ ] 1.4 Obtain Leo's approval of the published revision.

## 2. commands

- [ ] 2.1 Add `parseChatCommand` and `ChatCommandsService` (design D1). Verify "Text with a space before the slash is a message", "A path is a message", "An unknown name is a message", and "A longer word is not a command" in a unit test of the parser and in `chats-messages.integration.test.ts`.
- [ ] 2.2 Call the parser first in `createMessage` and in the `POST /api/v1/chats` admission, and answer `ChatCommandResultResponse` with 200 JSON (design D2). Regenerate `openapi.json` and the web client, and verify a clean second generation and `pnpm lint:openapi`. Verify "A command on the message endpoint", "A rename leaves no trace in the history", "The answer is a command result", "A rename with an image", and the `/rename` half of "Another owner's Chat reveals nothing", "A command for an absent Chat creates nothing", and "A command on an archived Chat" in an API integration test with real Postgres and RLS.
- [ ] 2.3 Implement `/rename <title>` through `ChatsRepository.update`. Verify "A rename during a Run" and "A title that is too long" in the integration test.
- [ ] 2.4 Add `TitleService.regenerate`, the recent-turn excerpt, and the packaged `titles/prompts/conversation.md` template (design D4). Verify "A regenerated title follows the recent turns", "A regenerate does not use the chat model", "No title model is configured", and "A rename with a title still works without a title model" with the fake model client; verify the excerpt bound and media placeholders in a unit test.
- [ ] 2.5 Send every `/`-text from the web composer through the direct send path, and show a command result or an error inline without an optimistic message (design D3). Verify with a story and a focused component test that `/rename Foo` shows the result, a 4xx restores the draft, and `/etc/hosts` attaches to its Run.
- [ ] 2.6 Document the commands in `docs/product/reference/` and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.7 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm --filter web lint`, `pnpm --filter web typecheck`, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 2.8 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 3. compact-run

- [ ] 3.1 Add `runs.kind` in a generated migration and `kind` in `RunResponse` and `latestRun` (design D5). Verify `db:check`, the RLS check of the new column in `chats-rls.integration.test.ts`, and "A compaction Run is the latest Run" and "Another owner's latest Run is not reported" in the history integration test. Regenerate OpenAPI and the web client.
- [ ] 3.2 Make `RunJob` a union by kind and regenerate the queue protocol (design D7). Verify that a job without `kind` still runs as a turn in a worker test.
- [ ] 3.3 Admit `/compact` on an idle Chat: validate the send settings, plan the absorbed rows, create the compaction Run with the message id as the Run id, and write `run.created` with the focus (design D6). Answer 409 "Wait for the current Run to finish." while a Run is live. Verify "Compact starts a Run", "A retried compact returns the same Run", "A compact with an unknown model", "An empty Chat", "A second compact with no new turn", "A short Chat compacts", "A command as the first message of a new Chat", and the `/compact` half of the three owner-scope scenarios.
- [ ] 3.4 Add `executeCompactionRun` (design D8). Verify "Compact with the composer model", "A history that does not fit the composer model", "The next turn sees only the checkpoint", "The instruction has no trigger sentence", "A send during a compaction Run", "A compaction Run survives a worker restart", "A compaction Run writes no reply", "Stop during a compaction", and "A provider error during a compaction Run" in a worker integration test with the fake model client. Record in the PR whether step 3 of design D8 used the attempt preparation or its fallback.
- [ ] 3.5 Add the focus: the `Additional focus:` paragraph, the checkpoint payload `v: 2`, and the history field. Verify "A focus is accepted", "A focus that is too long", "A focus reaches the summary request", "A focus cannot remove redaction", "The boundary shows the focus", and "A later request does not replay the focus".
- [ ] 3.6 Refuse a follow-up on an absorbed turn (design D9). Verify "Regenerate after a compact" in the follow-up integration test.
- [ ] 3.7 Update `SPEC.md` §2.1 and §9.3 for compaction Runs and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.8 Verify the layer: `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm --filter api test:coverage` for the touched modules, the focused integration tests above, `pnpm format:check`, `git diff --check`.
- [ ] 3.9 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 4. compact-web

- [ ] 4.1 Read `latestRun.kind` in `turn-action-rules.ts`, `history-adoption.ts`, the busy check in `deliveries.ts`, and the transcript (design D11). Verify "A compacted turn shows no action" and "A failed compaction shows its error" in stories, and keep the existing turn-action scenarios green.
- [ ] 4.2 Add the "Compacting context" row with Stop, and refetch history when the Run ends. Verify with a story and its interaction test that Stop calls `cancelRun`.
- [ ] 4.3 Show the focus in `compaction-boundary.tsx`. Verify with a story that shows a boundary with and without a focus.
- [ ] 4.4 Update `DESIGN.md` if a new pattern appears, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.5 Verify the layer: `pnpm --filter web lint`, `pnpm --filter web typecheck`, Storybook tests for the changed stories, `pnpm format:check`, `git diff --check`.
- [ ] 4.6 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 5. queued-commands

- [ ] 5.1 Store `/compact` during a live Run as a `queue` item for every `delivery` value, and add `command` to `ChatDeliveryResponse` (design D10). Verify "Compact during a Run", "Compact during a Run without a delivery mode", "A compact command during a Run is a queue item", "A command send to an idle Chat with a delivery mode", and the unchanged "A steer during a Run is accepted as a pending item", "A send without a delivery mode still gets 409", "A queue send to an idle Chat starts at once", and "A send to a paused queue goes first" in `chat-deliveries.integration.test.ts`.
- [ ] 5.2 Refuse a mode change of a command item. Verify "A command item refuses Steer now", "A paused command item cannot start by a mode change", "Steer now changes a queue item", and "Steer now on a paused item".
- [ ] 5.3 Promote a command item to a compaction Run. Verify "A queued compact starts a compaction Run", "A completed compaction Run promotes the next item", "Three queue items run in order", and "A queue item that a send cannot use stays pending" in the worker integration test.
- [ ] 5.4 Offer only delete and edit on a command row. Verify "A command item offers no Steer now", "Edit puts the text back", and "A delivered item leaves the stack" in the pending-deliveries story.
- [ ] 5.5 Update `SPEC.md` §9 for command items and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.6 Verify the layer: the API and web lint and typecheck, the focused tests above, `pnpm format:check`, `git diff --check`.
- [ ] 5.7 Self-review the draft PR diff against its parent (SR), mark it ready, and run the GitHub review loop (GR).

## 6. finalize

- [ ] 6.1 Enter `add-slash-commands/finalize` from `queued-commands` with `$gh-stack` before `$openspec-sync-specs` writes. Verify with `gh stack view --json`.
- [ ] 6.2 Run `$openspec-sync-specs`, add the `chat-commands` Purpose, and verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 6.3 Check that every task above is checked and `openspec status --change add-slash-commands --json` reports every artifact done.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after readiness is proved.
- Self-review the finalize PR diff (SR) and run the GitHub review loop (GR) after archive movement.
- Merge the stack only with Leo's explicit permission, through `$gh-stack`.

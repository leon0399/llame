Tracks [#1772](https://github.com/leon0399/llame/issues/1772); cutovers
[#1839](https://github.com/leon0399/llame/issues/1839) (manual model-role switching) and
[#1840](https://github.com/leon0399/llame/issues/1840) (automatic failover policy).

# Tasks

## 0. Delivery graph

```text
master <- model-roles/proposal <- model-roles/catalog <- model-roles/selection
       <- model-roles/selection-ux <- model-roles/switch-records <- model-roles/next-candidate
       <- model-roles/in-run-switch <- model-roles/failover-policy <- model-roles/finalize
```

| Section | Branch                        | Parent          | Owns                                                                                                                  | Closes       | Estimate (authored lines)      |
| ------- | ----------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------ |
| 1       | `model-roles/proposal`        | `master`        | this change and the ADRs                                                                                              | none         | ~3,400 (named exception below) |
| 2       | `model-roles/catalog`         | proposal        | `modelRoles` config, the `@` rule, the `defaults` renames, `free` billing, the role catalog                           | none         | ~1,500                         |
| 3       | `model-roles/selection`       | catalog         | the migration, the admission resolver, `selector` on every request with its web and E2E callers, pending-item readers | none         | ~2,600 (named exception below) |
| 4       | `model-roles/selection-ux`    | selection       | the hold read and return, forks, `/compact`, plain Regenerate, the picker                                             | none         | ~1,500                         |
| 5       | `model-roles/switch-records`  | selection-ux    | the `failover` cause and item, the `error` close, reasoning per reply, tool-call ids, the inspector, the web boundary | none         | ~1,800                         |
| 6       | `model-roles/next-candidate`  | switch-records  | Continue on next candidate for failed and waiting Runs, the hold write, effort after a switch, the web actions        | #1839        | ~1,800                         |
| 7       | `model-roles/in-run-switch`   | next-candidate  | the switch inside a live Run behind an injected decision, the new client, the switch-segment compaction check         | none         | ~1,600                         |
| 8       | `model-roles/failover-policy` | in-run-switch   | Run origin, the failover matrix, automatic switches, the paid gate, title roles                                       | #1840, #1772 | ~1,600                         |
| 9       | `model-roles/finalize`        | failover-policy | spec sync, archive, and ADR link updates                                                                              | none         | ~20                            |

- Safe merge boundaries: after each section. Section 3 is one boundary on purpose: the API refuses
  `modelId`, so the web senders and the E2E suites change in the same layer. Sections 3 and 4 ship
  roles that resolve to their primary. Section 5 adds the records with no caller. Section 6 completes
  the manual cutover. Section 7 ships the in-Run switch with a decision that never fires in
  production. Section 8 completes the automatic cutover.
- Named exceptions to the review target: the proposal restates two canonical blocks whole in STE,
  because they name the renamed keys. Section 3 is the atomic `modelId` rename. `RunsRepository.create`
  defaults the new columns, which removes about 77 fixture edits; the rest is DTO and fixture churn.
- Each layer uses `$gh-stack` for its branch and `$openspec-apply-change` for its tasks, and stops at
  the layer boundary for the gates in [CONTRIBUTING.md](../../../CONTRIBUTING.md).
- Generated churn (OpenAPI, the web client, the AsyncAPI websocket protocol, Drizzle snapshots) counts
  zero and is reported apart. Re-estimate at each boundary.

## 1. Proposal (`model-roles/proposal`)

- [ ] 1.1 Commit the proposal, design, delta specs, tasks, and the ADRs; verify with
      `pnpm exec openspec validate model-roles --strict`, `pnpm lint:markdown`,
      `pnpm format:check`, and `git diff --check`.
- [ ] 1.2 Run two review rounds with `$iterative-review-refinement`; record each round in design.md.
- [ ] 1.3 SR: self-review the PR diff against REVIEW_GUIDE.md.
- [ ] 1.4 GR: run the Ready-PR monitoring loop to a clean exit, and obtain Leo's approval of the
      published revision.

## 2. Catalog (`model-roles/catalog`)

- [ ] 2.1 Add `modelRoles` to `llame.config.schema.json`, `llame-config.ts`, and `config-loader.ts`
      with the candidate checks; verify the scenarios of `model-roles` "The operator declares model
      roles" and "Role candidates are validated at startup" in config-loader tests.
- [ ] 2.2 Refuse a `models[].id` that starts with `@`; verify "A model id with the role sign".
- [ ] 2.3 Rename `defaults.modelId` and `defaults.titleGenerationModelId` to `defaults.selector` and
      `defaults.titleGenerationSelector`; verify the `instance-config` scenarios "Default model must
      reference the catalog" and "The old default keys fail startup", and the `available-models`
      scenarios "Title generation uses separate configured model" and "Title model configuration
      failure does not break chat". A title role resolves to its primary in this layer.
- [ ] 2.4 Add `free` to the billing mode in the schema, the type, usage telemetry, and the web
      parser; verify "A free model boots", "A free model records free", and "A free model shows
      notional cost" (unit test plus the `message-usage` story).
- [ ] 2.5 Publish `roles` and `defaultSelector` in `GET /api/v1/models`, regenerate `openapi.json`
      and the web client, and move the web readers of `defaultModelId`; verify "The picker reads a
      role" and the modified "Authenticated executable models endpoint" scenarios.
- [ ] 2.6 Update the example config, `docs/product/operator/providers/routing.md` (roles and
      `free`), README, the glossary (`free` billing, Model selector), and a dated **Breaking**
      CHANGELOG entry for the key renames; verify `pnpm lint:markdown`.
- [ ] 2.7 SR, then GR with the Ready-PR monitoring loop.

## 3. Selection (`model-roles/selection`)

- [ ] 3.1 Migration with the RLS window of design D14, the `RunsRepository.create` defaults, and the
      queue-promotion and job-notice readers of `settings.selector`; verify "An old Chat keeps its
      model" and "A queue item survives the migration" against a seeded database, and that a second
      run changes nothing.
- [ ] 3.2 Split admission as design D3 and add the resolver; verify the scenarios of "A send names a
      selector or uses the stored selection", "A selector resolves to one model at admission", "A
      stored selection that no longer resolves uses the default", "An omitted effort follows one
      order", "A send effort is validated against the resolved model", the modified
      `available-models` effort scenarios, and `available-models` "Compaction uses triggering run
      model". Update the tests that pin the old error order.
- [ ] 3.3 Replace `modelId` with `selector` in the send, chat-creation, Regenerate, delivery, and
      `/compact` DTOs; publish `selector` on `latestRun`, `RunResponse`, and the delivery echo;
      regenerate OpenAPI, the web client, and the AsyncAPI websocket protocol; move the web senders
      (transport, creation, delivery, Regenerate, turn actions) and the E2E suites to `selector`.
      Verify `chat-creation` "A create request names a role", the `chat-commands` scenarios,
      `turn-actions` "The latest Run names its role", "Continue rejects an unknown candidate value",
      and "Continue keeps the model and the effort".
- [ ] 3.4 Write and return the selection with its revision; verify "Another device shows the same
      selection", "A refused send stores no selection", "A pick resets the stored effort", "A pick
      sent as a steer", and the negative isolation scenario "Another owner reads a Chat" in the API
      integration suite.
- [ ] 3.5 CHANGELOG entry for the API rename; verify `pnpm lint:markdown`.
- [ ] 3.6 SR, then GR with the Ready-PR monitoring loop.

## 4. Selection UX (`model-roles/selection-ux`)

- [ ] 4.1 Hold read and return; verify "A held Chat resolves to the held model", "The held model left
      the role", "An effort that only the held model declares", "The owner picks the role again",
      "The owner changes only the effort", "A send after the reset", "A long Run passes revertAt", and
      "A queue item after revertAt", with holds inserted by the test.
- [ ] 4.2 Pending items and notices with holds; verify "A queue item after a switch" and "A queue item
      with its own selector" with a hold written by the test, `run-steering` "A job item names its
      job", and `background-jobs` "A notice uses the hold of the Chat".
- [ ] 4.3 Forks and `/compact`; verify "A fork of a held Chat", "A shared fork gets no hold", and
      `chat-commands` "A compact on a held Chat".
- [ ] 4.4 Plain Regenerate sends no selector; verify `turn-actions` "Regenerate needs a model", "A
      plain click repeats the old settings", and "A menu choice sets the composer".
- [ ] 4.5 Web picker: roles, the stored selection, the hold display, and `selector` only after a
      pick; verify "A held Chat in the picker" and the modified "Web sends only with valid selected
      model" scenarios with stories and the Storybook MCP tests.
- [ ] 4.6 Owner docs for model selectors and holds; verify `pnpm lint:markdown`.
- [ ] 4.7 SR, then GR with the Ready-PR monitoring loop.

## 5. Switch records (`model-roles/switch-records`)

- [ ] 5.1 The `failover` cause in the model-change payload, `createModelChangeItem`, both payload
      guards, and the packaged template; verify `model-system-prompts` "A switch inside a Run has its
      own cause", "A failover item stops a second switch item", "A Regenerate of a switch turn", and
      `context-injection` "A Regenerate removes a failover item".
- [ ] 5.2 `DeliveryCause` `failover`, the `error` close with `complete: false`, and
      `model.switched` in `RunEventType`; verify `run-steering` "A model switch names its cause" and a
      test that a later settle of the Run leaves the closed reply unchanged.
- [ ] 5.3 Reasoning replay by the model of the reply; verify `reasoning-output` "A segment after a
      switch omits the reasoning of the earlier model" and the other scenarios of that requirement.
- [ ] 5.4 Tool-call id normalization at both assembly points; verify "A foreign id reaches another
      wire" and "Two ids map to the same value" in context-builder and compaction tests.
- [ ] 5.5 The effective-context inspector names each attempt's model, and the web boundary renders the
      `failover` item; verify with stories.
- [ ] 5.6 SR, then GR with the Ready-PR monitoring loop.

## 6. Next candidate (`model-roles/next-candidate`)

- [ ] 6.1 Continue with `candidate: "next"` in the admission transaction; verify "Continue on the next
      candidate", "A Run with an exact selector", "The last candidate fails", `turn-actions`
      "Continue on the next candidate of a cancelled Run is refused", "The failed reply keeps its usage
      after a switch", "Continue on the next candidate sends the failed reply as history", "Continue
      after a switch keeps the effort of the last segment", and `model-system-prompts` "A role moves
      to its next candidate".
- [ ] 6.2 `POST /api/v1/runs/:id/next-candidate` as design D7; verify "A weekly limit ends early",
      the negative isolation scenario "Another owner calls the action", "An exact selector in a quota
      wait", "A compaction Run in a quota wait", and `quota-wait` "Continue on next candidate wakes the Run".
- [ ] 6.3 Hold write and effort after a switch; verify "A usage limit sets the hold to the reset",
      "An auth failure sets a short hold", "The owner picked another selector", "The owner picked the
      same role during the Run", and the four scenarios of "The effort after a switch follows the
      selected effort".
- [ ] 6.4 An exact selector never switches; verify "An exact model is unavailable".
- [ ] 6.5 Web: the turn action, the failed-turn row, the quota-wait box action, and the paid label;
      verify "A paid next candidate", "A failed role turn offers the next candidate", "A failed turn
      with no completed step shows only Regenerate", "A role Run in a quota wait offers the next
      candidate", "A reload after a switch", and "The live view shows the switch" with stories, the
      Storybook MCP tests, and one focused product E2E for Continue on next candidate.
- [ ] 6.6 Owner docs for Continue on next candidate and a CHANGELOG entry; the PR carries
      `Closes #1839`. Verify `pnpm lint:markdown`.
- [ ] 6.7 SR, then GR with the Ready-PR monitoring loop.

## 7. In-Run switch (`model-roles/in-run-switch`)

- [ ] 7.1 Make `createClient` required, give `startDelivered` a client, and add the switch of design
      D6 at its three decision points behind an injected decision function; verify "The transcript
      after a switch", "The failed send is not kept", "Settled tool calls stay", "A steer that waits
      at the switch", "The new segment starts its own retry count", "A switch after an overload", and
      `tool-calling` "A model switch removes the failed send", with a test decision that switches.
- [ ] 7.2 The pre-step compaction check at a switch segment; verify `run-steering` "A switch to a
      smaller window compacts first".
- [ ] 7.3 SR, then GR with the Ready-PR monitoring loop.

## 8. Failover policy (`model-roles/failover-policy`)

- [ ] 8.1 `runs.origin` and its writers, with jobs that carry it; verify "A send starts an owner Run"
      and "A job notice inherits the origin".
- [ ] 8.2 The `failover` config and its merge; verify "An unknown origin fails startup", "A
      non-positive threshold fails startup", and "A role adds one cell".
- [ ] 8.3 The policy as the production decision; verify "A context overflow does not switch", "An
      agent Run fails over", "An owner Run with the cell off fails", "The default policy never
      switches", and "A compaction Run does not fail over", with `agent` Runs inserted by the test.
- [ ] 8.4 The `quota` cell; verify "A near reset waits", "A reset beyond the wait cap switches", "A
      far reset switches", `provider-failures` "A quota cell switches in place of the wait" and "A
      step-boundary compaction hits a usage limit", and "A restart enables quota failover".
- [ ] 8.5 The paid gate and the chain end; verify "A gated paid candidate is skipped", "The owner
      reaches a paid candidate", and "Every candidate failed".
- [ ] 8.6 Broken sends and compaction; verify "A broken stream after a tool call" and "A failed
      step-boundary compaction does not switch".
- [ ] 8.7 Title roles; verify "A title during an outage", "Every title candidate fails", and
      `provider-failures` "A title request hits a usage limit".
- [ ] 8.8 Example config with `agent × availability` on, `docs/product/operator/providers/routing.md`
      for the matrix, the glossary, and a CHANGELOG entry; the PR carries `Closes #1840` and
      `Closes #1772`. Verify `pnpm lint:markdown`.
- [ ] 8.9 SR, then GR with the Ready-PR monitoring loop.

## 9. Finalize (`model-roles/finalize`)

- [ ] 9.1 Enter `model-roles/finalize` with `$gh-stack` from the top of the stack before any spec
      write; verify `gh stack view --json` shows it on top.
- [ ] 9.2 Run `$openspec-sync-specs`, set the Purpose of `model-roles` and `model-failover`, update
      the `available-models` Purpose that names `modelId`, point the ADR links from the change to the
      archived change, and confirm `openspec status --change model-roles --json` reports every
      artifact done and every task above checked.
- [ ] 9.3 Verify `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`, then run `$openspec-archive-change`.

SR and GR of the finalize PR are post-archive gates under CONTRIBUTING.md, not tasks here.

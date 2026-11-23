Tracks [#1772](https://github.com/leon0399/llame/issues/1772); cutovers
[#1839](https://github.com/leon0399/llame/issues/1839) (manual model-role switching) and
[#1840](https://github.com/leon0399/llame/issues/1840) (automatic failover policy).

# Tasks

## 0. Delivery graph

```text
master <- model-roles/proposal <- model-roles/catalog <- model-roles/selection
       <- model-roles/switch <- model-roles/failover-policy <- model-roles/finalize
```

| Layer | Branch                        | Parent          | Owns                                                                                                                     | Closes       | Estimate (authored lines) |
| ----- | ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------- |
| 0     | `model-roles/proposal`        | `master`        | this change and two ADRs                                                                                                 | none         | ~1,900                    |
| 1     | `model-roles/catalog`         | proposal        | `modelRoles` config, the `@` rule, the `defaults` renames, `free` billing, the role catalog                              | none         | ~1,500                    |
| 2     | `model-roles/selection`       | catalog         | `selector` on requests, the Chat selection, the hold read, effort rules, pending items, forks, the migration, the picker | none         | ~2,200                    |
| 3     | `model-roles/switch`          | selection       | the switch segment, the switch item, tool-call ids, reasoning per reply, the hold write, Continue on next candidate      | #1839        | ~2,300                    |
| 4     | `model-roles/failover-policy` | switch          | Run origin, the failover matrix, automatic switches, the paid gate, title roles                                          | #1840, #1772 | ~1,600                    |
| 5     | `model-roles/finalize`        | failover-policy | spec sync and archive                                                                                                    | none         | ~0 authored               |

- Safe merge boundaries: after each layer. Layer 1 boots with roles that no send can name yet.
  Layer 2 ships roles that resolve to their primary. Layer 3 completes the manual cutover. Layer 4
  completes the automatic cutover.
- Layers 2 and 3 are the largest; layer 2 can split its web picker into its own layer at the layer
  boundary if the measured size exceeds the review target.
- Each layer uses `$gh-stack` for its branch and `$openspec-apply-change` for its tasks, and stops at
  the layer boundary for the gates in [CONTRIBUTING.md](../../../CONTRIBUTING.md).
- Generated churn (OpenAPI, the web client, the live protocol, Drizzle snapshots) counts zero and is
  reported apart.

## 1. Proposal (`model-roles/proposal`)

- [ ] 1.1 Commit the proposal, design, delta specs, tasks, and the two ADRs; verify with
      `pnpm exec openspec validate model-roles --strict`, `pnpm lint:markdown`,
      `pnpm format:check`, and `git diff --check`.
- [ ] 1.2 Run two review rounds with `$iterative-review-refinement`; record each round in design.md.
- [ ] 1.3 SR: self-review the PR diff against REVIEW_GUIDE.md before ready.
- [ ] 1.4 GR: run the Ready-PR monitoring loop to a clean exit, and obtain Leo's approval of the
      published revision.

## 2. Catalog (`model-roles/catalog`)

- [ ] 2.1 Add `modelRoles` to `llame.config.schema.json`, `llame-config.ts`, and `config-loader.ts`
      with the candidate checks; verify the scenarios of `model-roles` "The operator declares model
      roles" and "Role candidates are validated at startup" in config-loader tests.
- [ ] 2.2 Refuse a `models[].id` that starts with `@`; verify "A model id with the role sign".
- [ ] 2.3 Rename `defaults.modelId` and `defaults.titleGenerationModelId` to `defaults.selector` and
      `defaults.titleGenerationSelector`, which accept a role; verify the `instance-config`
      scenarios "Default model must reference the catalog" and "The old default keys fail startup".
      Title generation resolves a role to its primary in this layer.
- [ ] 2.4 Add `free` to the billing mode in the schema, the type, usage telemetry, and the web
      parser; verify "A free model boots", "A free model records free", and "A free model shows
      notional cost" (unit test plus the `message-usage` story).
- [ ] 2.5 Publish `roles` and `defaultSelector` in `GET /api/v1/models`, regenerate `openapi.json`
      and the web client; verify "The picker reads a role" and the modified "Authenticated
      executable models endpoint" scenarios in the models e2e-API test.
- [ ] 2.6 Update the example config, `docs/product/operator/providers/routing.md` (roles and
      `free`), README, and a dated **Breaking** CHANGELOG entry for the key renames; verify
      `pnpm lint:markdown`.
- [ ] 2.7 Add the glossary entry for `free` billing as shipped; verify `pnpm lint:markdown`.
- [ ] 2.8 SR, then GR with the Ready-PR monitoring loop.

## 3. Selection (`model-roles/selection`)

- [ ] 3.1 Migration: `chats.model_selection`, `runs.selector`, the backfill, and the pending-item
      and job settings rewrite; verify "An old Chat keeps its model" against a seeded database, and
      a second migration run changes nothing.
- [ ] 3.2 Replace `modelId` with `selector` in the send, chat-creation, Regenerate, delivery, and
      `/compact` DTOs, with one admission resolver; verify the `model-roles` scenarios of "A send
      names a selector or uses the stored selection" and "A selector resolves to one model at
      admission", the modified `available-models` effort scenarios, `chat-creation` "A create
      request names a role", and the `chat-commands` scenarios.
- [ ] 3.3 Write the selection in the Run-creating transaction and return it on the Chat read;
      verify "Another device shows the same selection", "A refused send stores no selection", and
      the negative isolation scenario "Another owner reads a Chat" in the API integration suite.
- [ ] 3.4 Effort and pick rules: verify "An omitted effort on a role send", "An effort that only the
      held model declares", "The owner picks the role again", and "The owner changes only the
      effort", with holds inserted by the test.
- [ ] 3.5 Hold read and return: verify "A held Chat resolves to the held model", "The held model left
      the role", "A send after the reset" (the cause-`model` item is staged), and "A long Run passes
      revertAt".
- [ ] 3.6 Pending items and forks: verify "A queue item after a switch" with a hold written by the
      test, "A fork of a held Chat", `chat-commands` "A compact on a held Chat", and "A shared fork gets no hold".
- [ ] 3.7 Plain Regenerate sends no selector; verify the modified `turn-actions` scenarios "Regenerate
      needs a model", "A plain click repeats the old settings", and "A menu choice sets the
      composer".
- [ ] 3.8 Web picker: roles, the stored selection, the hold display, and `selector` only after a
      pick; verify "A held Chat in the picker" and the modified "Web sends only with valid selected
      model" scenarios with stories and the Storybook MCP tests.
- [ ] 3.9 Update the operator and owner docs for selectors and the CHANGELOG entry for the API
      rename; verify `pnpm lint:markdown`.
- [ ] 3.10 SR, then GR with the Ready-PR monitoring loop.

## 4. Switch (`model-roles/switch`)

- [ ] 4.1 The switch primitive of design D6 with the packaged `failover` template and the
      `model.switched` event, plus the live protocol regeneration; verify "The transcript after a
      switch", "The failed send is not kept", "Settled tool calls stay", "A switch after an
      overload", "A reload after a switch", `model-system-prompts` "A switch inside a Run has its own
      cause", and `tool-calling` "A model switch removes the failed send" in worker integration
      tests that call the primitive directly.
- [ ] 4.2 Hold write and effort after a switch; verify "A usage limit sets the hold to the reset",
      "An auth failure sets a short hold", "The new model declares the selected level", and "The new
      model does not declare the selected level".
- [ ] 4.3 Reasoning replay by the model of the reply; verify `reasoning-output` "A segment after a
      switch omits the reasoning of the earlier model" and the unchanged scenarios of that
      requirement.
- [ ] 4.4 Tool-call id normalization in the context builder; verify "A foreign id reaches another
      wire" in a context-builder test, with a stored id that holds `.` and two ids that collide.
- [ ] 4.5 Continue on next candidate for a failed Run; verify "Continue on the next candidate", "A
      Run with an exact selector", "The last candidate fails", `turn-actions` "Continue rejects an
      unknown candidate value", "Continue on the next candidate of a cancelled Run is refused", "The
      failed reply keeps its usage after a switch", and `model-system-prompts` "A role moves to its
      next candidate".
- [ ] 4.6 The next-candidate action on a waiting Run; verify "A weekly limit ends early", the negative
      isolation scenario "Another owner calls the action", and `quota-wait` "The next-candidate
      action wakes the Run".
- [ ] 4.7 An exact selector never switches; verify "An exact model is unavailable".
- [ ] 4.8 Web: the turn action, the quota-wait box action, the paid label, and the transcript
      boundary; verify "A paid next candidate", "A failed role turn offers the next candidate", and
      "A waiting role Run offers the next candidate" with stories and the Storybook MCP tests, and one
      focused product E2E for Continue on next candidate.
- [ ] 4.9 Docs for owners (the next-candidate action and holds) and a CHANGELOG entry; the PR
      carries `Closes #1839`. Verify `pnpm lint:markdown`.
- [ ] 4.10 SR, then GR with the Ready-PR monitoring loop.

## 5. Failover policy (`model-roles/failover-policy`)

- [ ] 5.1 `runs.origin` and its writers; verify "A send starts an owner Run" and "A job notice
      inherits the origin".
- [ ] 5.2 The `failover` config and its merge; verify "An unknown origin fails startup", "A
      non-positive threshold fails startup", and "A role adds one cell".
- [ ] 5.3 The policy at the two terminal seams; verify "A context overflow does not switch", "An
      agent Run fails over", "An owner Run with the cell off fails", and "The default policy never
      switches", with `agent` Runs inserted by the test.
- [ ] 5.4 The `quota` cell; verify "A near reset waits", "A far reset switches", `provider-failures`
      "A quota cell switches in place of the wait", and "A restart enables quota failover".
- [ ] 5.5 The paid gate and the chain end; verify "A gated paid candidate is skipped", "The owner
      reaches a paid candidate", and "Every candidate failed".
- [ ] 5.6 Broken sends and compaction; verify "A broken stream after a tool call" and "A
      step-boundary compaction fails over".
- [ ] 5.7 Title roles; verify "A title during an outage" and "Every title candidate fails".
- [ ] 5.8 Example config with `agent × availability` on, `docs/product/operator/providers/routing.md`
      for the matrix, the glossary, and a CHANGELOG entry; the PR carries `Closes #1840` and
      `Closes #1772`. Verify `pnpm lint:markdown`.
- [ ] 5.9 SR, then GR with the Ready-PR monitoring loop.

## 6. Finalize (`model-roles/finalize`)

- [ ] 6.1 Enter `model-roles/finalize` with `$gh-stack` from the top of the stack before any spec
      write; verify `gh stack view --json` shows it on top.
- [ ] 6.2 Run `$openspec-sync-specs`, set the Purpose of `model-roles` and `model-failover`, and
      confirm `openspec status --change model-roles --json` reports every artifact done and every task
      above checked.
- [ ] 6.3 Verify `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`, then run `$openspec-archive-change`.

SR and GR of the finalize PR are post-archive gates under CONTRIBUTING.md, not tasks here.

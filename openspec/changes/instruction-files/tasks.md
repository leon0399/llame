Track [#975](https://github.com/leon0399/llame/issues/975) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#1029](https://github.com/leon0399/llame/issues/1029) (imports) is separate work, not a native blocker.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- instruction-files/proposal
         <- instruction-files/in-run-context-items
         <- instruction-files/producer
         <- instruction-files/finalize
```

- `proposal` owns only proposal, design, the delta specs, and this task list.
- `in-run-context-items` (parent `proposal`, estimated 1,000 authored lines): the rail carrier
  for items authored between model steps — staging, per-step message rebuild, storage on the
  assistant message, replay, publication, and the Run record. References #975.
- `producer` (parent `in-run-context-items`, estimated 1,700 authored lines): the
  `instructions` producer — candidate chains, walk, triggers, derived seen set, system-origin
  reads and audit, template, owner chip, docs. Its merge completes #975's acceptance, so its PR
  uses `Closes #975`. Split the web chip into its own layer if this one exceeds the budget.
- `finalize` owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `instruction-files/in-run-context-items`: the in-Run rail carrier

- [ ] 1.1 Add attempt-scoped in-Run item staging keyed by the triggering `toolCallId`
      (design D1, D11). Rebuild each step's message list in `prepareStep` from the attempt's
      stored parts plus staged items, emitting each item as one user-role text message
      directly after its tool-result message, on the triggering step's successor and every
      later step. Verify with a scripted multi-step model client that step 2 and step 3 each
      carry exactly one copy at the same position, that a step before the trigger carries
      none, and that the rebuild does not read the `messages` argument to decide placement
      (the test fails if the item appears twice on step 3).
- [ ] 1.2 Store in-Run items as `data-context` parts on the attempt's assistant message
      immediately after the triggering tool part, published only with the winning attempt.
      Verify a failed attempt publishes no part, a superseded attempt publishes none, and the
      winning attempt's assistant message carries the part after the tool part in stored order.
- [ ] 1.3 Map assistant-message `data-context` parts in `context-builder` to one user-role
      text message after the preceding tool-result message; leave `tool-observation-part`
      budgets untouched and make compaction's replacement builder ignore the part (design D1,
      D7). Verify replay order, that the pair budget is not charged for the item, that a
      compaction absorbing the message produces replacement records without it, and that a
      user-message `data-context` part replays exactly as before.
- [ ] 1.4 Append in-Run items to the Run context-item record after the final request's items in
      step order, with producer, form, and residency, committed with turn publication. Verify
      `GET /api/v1/runs/:id/context-items` returns them for the owner and 404 for another
      owner, and that a Run whose preparation fails records `null`.
- [ ] 1.5 Update `SPEC.md`'s context-rail lines for the second carrier and add a dated
      `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the
      focused integration files touched above, `pnpm format:check`, `pnpm lint:markdown`,
      `git diff --check`, and `pnpm exec openspec validate instruction-files --strict`; record
      the commands in the PR body.
- [ ] 1.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted
      findings, and rerun affected checks before marking ready.
- [ ] 1.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `producer` layer.

## 2. `instruction-files/producer`: the `instructions` producer

- [ ] 2.1 Implement candidate resolution: per directory, the first existing regular file of
      the base chain and, independently, of the local chain; follow a symlinked final component;
      skip directories and empty files; key results by canonical `realpath` (design D3). Verify
      `LLAME.md` replacing `AGENTS.md`, `AGENTS.override.md` beating `AGENTS.md`, base plus
      local from one directory, a symlinked `CLAUDE.md` collapsing to its target, and empty and
      directory candidates contributing nothing.
- [ ] 2.2 Implement the walk from the filesystem root down to the touched directory, with
      the touched directory being the canonical root for entry and the projected path's parent
      for file tools whether or not it exists (design D4). Verify entry at `repo/apps/api` yields
      `repo` then `repo/apps/api`, a read outside the Workspace yields that tree's chain, and no
      sibling or child directory is visited.
- [ ] 2.3 Wire the triggers: mark the touched directory during `enter_workspace` (establish or
      switch only), native `read`, `edit`, and `write` on local host paths regardless of call
      outcome but not on denial; drain the pending set in `prepareStep` into at most one bundle
      per step through the layer-1 interface; exclude `bash`, `kb://`, `skill://`, and web
      locators; exclude the model's own read of a candidate file from loading or marking that
      file (design D5). Verify each trigger and each exclusion, two touches in one step yielding
      one bundle, the same-step-no-load boundary matching the Workspace root cell, and that
      exit, same-root re-entry, and detach produce nothing.
- [ ] 2.4 Implement the accepted-turn trigger: when a Chat has a live binding and any file of
      the root chain is absent from effective context, stage the root bundle before the first
      request, ordered after the `workspace` item (design D5, D7). Verify a post-compaction turn
      re-establishes the chain, an unchanged epoch stages nothing, an unbound Chat stages
      nothing, and a binding that predates this change loads on its next turn.
- [ ] 2.5 Derive the seen set from effective history plus the attempt's staged and emitted
      items, keyed by canonical path, reset on transition compaction inside a Run (design D7).
      Verify a second touch in the epoch is silent, an owner fork inherits the set through
      copied history with no column read, a failed attempt leaves nothing seen, and a compacted
      item's file reloads on the next trigger.
- [ ] 2.6 Read each existing candidate through `runTool(nativeReadTool)` with origin
      `instructions` and `:raw`, after an executor-side existence probe that records no
      decision; drop denied and failed reads without naming them; require `read` in
      `tools.allowed` and a configured native executor (design D6). Verify the audit events and
      origin for an allowed read, a reject-rule denial recorded as a denied read and absent
      from the text, no events for missing candidates, bypass mode recorded as bypass, and a
      negative isolation test that owner B cannot read owner A's resulting activity or items.
- [ ] 2.7 Add the packaged template and payload: `<file path="…">` blocks in directory order,
      base before local, the scope and specificity sentence once, the rail precedence statement,
      reserved-delimiter neutralization of bodies, a 32 KiB per-file cut on a UTF-8 boundary
      with a line naming the path and omitted bytes, no aggregate cap, and private metadata
      listing loaded, truncated, and denied canonical paths (design D8). Verify rendering order,
      the truncation line and metadata for a 40 KiB file, a literal `</system-reminder>` in a
      body not closing the envelope, and that denied paths appear in metadata only.
- [ ] 2.8 Render the owner chip on the carrying message from the part's private metadata,
      marking truncated and denied paths, using shared primitives and semantic tokens per
      DESIGN.md; keep the text and metadata out of public shares, exports, and search
      projections (design D9). Verify with component tests and a story; run the Storybook story
      tests and return preview URLs; add an API test that a public share of a Chat with
      instructions items carries none of them.
- [ ] 2.9 Document the chains, walk, triggers, once-per-epoch rule, the walk-to-root
      tradeoff with the reject-rule remedy, and the chip in `docs/native-files.md`; update
      `SPEC.md`'s Workspace and context-rail lines; add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm --filter web lint`,
      `typecheck`, and `test:coverage`, the focused integration files touched above,
      `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body, which uses `Closes #975`.
- [ ] 2.10 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 2.11 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `finalize`.

## 3. `instruction-files/finalize`: spec sync and archive

- [ ] 3.1 After every implementation layer is published, verified, and checked, create only the
      finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify
      `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`; this layer contains no application fix and
      no shipping record.
- [ ] 3.2 Inspect `pnpm exec openspec status --change instruction-files --json` and this task
      list; stop if an artifact or earlier task is incomplete. Complete this task as part of
      `$openspec-archive-change`, preserving checked history, and verify strict specs/all
      validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.

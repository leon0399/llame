Track [#975](https://github.com/leon0399/llame/issues/975) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#1029](https://github.com/leon0399/llame/issues/1029) (imports) is separate work, not a native blocker.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- instruction-files/proposal
         <- instruction-files/in-run-context-items
         <- instruction-files/loading
         <- instruction-files/producer
         <- instruction-files/turn-load
         <- instruction-files/owner-chip
         <- instruction-files/knowledge
         <- instruction-files/finalize
```

- `proposal` (parent `master`, about 950 authored lines) owns only proposal, design, the delta
  specs, and this task list.
- `in-run-context-items` (parent `proposal`, estimated 1,100 authored lines): the rail carrier
  for items authored between model steps — staging, the widened model-client step callback,
  per-step remove-then-insert, the assistant collector part kind, storage on the assistant
  message, replay, publication, and the Run record. References #975.
- `loading` (parent `in-run-context-items`, about 1,200 authored lines): the building blocks,
  unwired — the executor-side probe, candidate chains, the walk, the paged candidate reader over
  an injected page reader, and the bundle template, payload, and seen-path extraction.
  References #975.
- `producer` (parent `loading`, about 1,750 authored lines): in-Run loading — the triggers, the
  derived seen set, the in-Run system-read helper and `instructions` origin, and the producer's
  registration with the carrier. References #975.
- `turn-load` (parent `producer`, about 800 authored lines): the accepted-turn root load staged
  after the `workspace` item, recomputed after transition compaction. References #975.
- `owner-chip` (parent `turn-load`, about 1,000 authored lines): the owner chip, the share
  exclusion test, operator docs, `SPEC.md`, and the changelog entry. References #975.
- `knowledge` (parent `owner-chip`, about 900 authored lines): `kb://` triggers, the
  Space-scoped walk, the owner-scoped Space probe, and logical locator labels and seen keys.
  Its merge completes #975's acceptance, so its PR uses `Closes #975`.
- The implementation was first planned as one `producer` layer (estimated 1,700 lines); the
  measured implementation was about 4,600 authored lines, so it is split along these
  responsibilities to stay within the review budget.
- `finalize` (parent `knowledge`, about 100 authored lines) owns only spec sync, checked task
  records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `instruction-files/in-run-context-items`: the in-Run rail carrier

- [x] 1.1 Widen the model-client step callback from `onStepStart(): void` to one that receives
      the step's live SDK messages and may return a `messages` override, wired in every provider
      client through the shared `prepareStep` (design D1). Add attempt-scoped in-Run item
      staging that binds each item to the current step's last tool call. On every later step,
      remove any earlier copy of each staged item by identity and insert it as one user-role
      text message directly after the tool-result message carrying that tool call. Verify with
      a scripted multi-step model client that step 2 and step 3 each carry exactly one copy at
      the same position, that a step before the trigger carries none, that provider metadata on
      the surrounding messages is untouched, and that the result is identical when the scripted
      client retains the previous override and when it discards it.
- [x] 1.2 Extend the assistant transcript collector and finish path so in-Run items are stored
      as `data-context` parts on the attempt's assistant message immediately after the last
      tool part of the triggering step, published only with the winning attempt and fenced like
      the tool parts (design D1). Verify a failed attempt publishes no part, a superseded attempt
      publishes none, recovery after a worker restart does not duplicate or drop one, and the
      winning attempt's assistant message carries the part after the tool parts in stored order.
- [x] 1.3 Map assistant-message `data-context` parts in `context-builder` to one user-role
      text message after the preceding tool-result message; leave `tool-observation-part`
      budgets untouched and make compaction's replacement builder ignore the part (design D1,
      D7). Verify replay order, that the pair budget is not charged for the item, that a
      compaction absorbing the message produces replacement records without it, that an item
      whose tool pair the replay budget omitted still replays at its stored position, and that a
      user-message `data-context` part replays exactly as before.
- [x] 1.4 Append in-Run items to the Run context-item record after the final request's items in
      step order, with producer, form, and residency, committed with turn publication. Verify
      `GET /api/v1/runs/:id/context-items` returns them for the owner and 404 for another
      owner, that the recorded text equals the stored part text exactly, that an item with empty
      text stays in the record with empty text, and that a Run whose preparation fails records
      `null`.
- [x] 1.5 Update `SPEC.md`'s context-rail lines for the second carrier and add a dated
      `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the
      focused integration files touched above, `pnpm format:check`, `pnpm lint:markdown`,
      `git diff --check`, and `pnpm exec openspec validate instruction-files --strict`; record
      the commands in the PR body.
- [ ] 1.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted
      findings, and rerun affected checks before marking ready.
- [ ] 1.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI
      and zero actionable unresolved feedback before adding the `loading` layer.

## 2. `instruction-files/loading`: probe, chains, walk, reader, and template

- [x] 2.1 Add an executor-side `stat` probe to the native-files module, outside the runner,
      that follows symlinks and returns existence, kind, size, and canonical path with no
      permission decision and no audit event (design D6). Implement candidate resolution on it:
      per directory, the first existing regular file of the base chain and, independently, of
      the local chain; skip non-regular entries, while an empty regular file is selected,
      contributes nothing, and suppresses later names; record the selected path and the
      canonical path (design D3, D8). Verify `LLAME.md` replacing `AGENTS.md`,
      `AGENTS.override.md` beating `AGENTS.md`, base plus local from one directory, a symlinked
      `apps/api/AGENTS.md` resolving to the repository root file's canonical path while keeping
      its selected path, an empty placeholder suppressing later names, a directory candidate
      skipped, and no audit row
      for any probe.
- [x] 2.2 Implement the walk from the filesystem root down to the touched directory, with
      the touched directory being the canonical root for entry, the projected path itself when
      it is an existing directory, and otherwise the projected path's parent whether or not it
      exists (design D4). Verify entry at `repo/apps/api` yields `repo` then `repo/apps/api`, a
      read of the directory `apps/api` includes `apps/api`, a read outside the Workspace yields
      that tree's chain, and no sibling or child directory is visited.
- [x] 2.3 Add the paged candidate reader over an injected page reader: bounded
      `:raw:<from>-<to>` pages of at most 2,000 lines, each starting after the last complete line
      collected, until the file ends, 32 KiB of UTF-8 is collected, or a page returns no new
      line; a continuation page past the end of the file ends collection, a denial on any page is
      a denied file, and any other failure a failed file (design D6). Verify with the real native `read`: a 20 KiB file read in two pages and returned whole,
      a 40 KiB file cut at 32 KiB on a UTF-8 boundary with the omitted count from the probed
      size, a file whose third line exceeds a result cut after two lines, a reject rule denied,
      and a missing file failed.
- [x] 2.4 Add the packaged template and payload: `<file path="…">` blocks labelled with the
      selected path in directory order, base before local, the scope and specificity sentence
      once, the rail precedence statement, reserved-delimiter neutralization of bodies, a
      32 KiB per-file cut on a UTF-8 boundary with a line naming the path and the omitted bytes
      from the probed size, no aggregate cap, the `files[].canonicalPath` payload, and private
      metadata listing loaded, truncated, and denied paths (design D8). Verify rendering order,
      the truncation line and metadata for a 40 KiB file, a symlinked file labelled with its
      selected path, a literal `</system-reminder>` in a body not closing the envelope, and that
      denied paths appear in metadata only.
- [x] 2.5 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused
      integration files touched above, `pnpm format:check`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body.
- [ ] 2.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 2.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `producer`.

## 3. `instruction-files/producer`: in-Run loading

- [x] 3.1 Wire the triggers: mark the touched directory during `enter_workspace` (establish or
      switch only), native `read`, `edit`, and `write` on local host paths regardless of call
      outcome but not on denial; drain the pending set in `prepareStep` into at most one bundle
      per step through the carrier interface; exclude `bash`, `knowledge_search`, `skill://`,
      and web locators; exclude the model's own read of a candidate file from loading or
      marking that file (design D5). Verify each trigger and each exclusion, two touches in one
      step yielding one bundle, two selected candidates resolving to one canonical path loaded
      once under the first path in walk order, the same-step-no-load boundary matching the
      Workspace root cell, and that exit, same-root re-entry, and detach produce nothing.
- [x] 3.2 Derive the seen set from the `files` payload of instructions items in messages after
      the compaction cutoff plus the attempt's staged and emitted items, keyed by canonical
      path, reset on transition compaction inside a Run (design D7). Verify a second touch in
      the epoch is silent, a symlink to an already-loaded file is silent, an owner fork inherits
      the set through copied history with no column read, a failed attempt leaves nothing seen,
      a denied file is not seen, and a compacted item's file reloads on the next trigger.
- [x] 3.3 Add an in-Run system-read helper on the worker closure that reserves an
      origin-tagged call, awaits ordered `tool.requested` persistence, invokes
      `runTool(nativeReadTool)`, records `tool.started`/`tool.completed`, and takes part in
      abort and finish settlement; extend the system-origin union with `instructions` so those
      events create no assistant tool part on the live, reconstructed, and recovered paths
      (design D6). Read each existing candidate through it with the layer-2 reader; drop denied
      and failed files without naming them; require `read` in `tools.allowed` and a configured
      native executor. Verify the audit events and origin for an allowed read, one audited read
      per page for a file longer than one read result, a reject-rule
      denial recorded as a denied read and absent from the text, no events for missing
      candidates, bypass mode recorded as bypass, no assistant tool part on any of the three
      paths, and a negative isolation test that owner B cannot read owner A's resulting activity
      or items.
- [x] 3.4 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused
      integration files touched above, `pnpm format:check`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body.
- [ ] 3.5 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 3.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `turn-load`.

## 4. `instruction-files/turn-load`: the accepted-turn root load

- [x] 4.1 Implement the accepted-turn trigger: after the attempt's binding re-check and not on
      a detaching attempt, when the Chat has a live binding and any file of the root chain is
      absent from effective context, stage the root bundle before the first request, ordered
      after the `workspace` item (design D5, D7). Verify a post-compaction turn re-establishes
      the chain, an unchanged epoch stages nothing, an unbound Chat stages nothing, a detaching
      attempt stages nothing, and a binding that predates this change loads on its next turn.
- [x] 4.2 Recompute the accepted-turn bundle against the rebuilt history after a transition
      compaction and replace the staged item (design D7). Verify a compaction that absorbs the
      root chain restages it before the rebuilt request.
- [x] 4.3 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused
      integration files touched above, `pnpm format:check`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body.
- [ ] 4.4 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 4.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `owner-chip`.

## 5. `instruction-files/owner-chip`: owner disclosure and docs

- [x] 5.1 Render the owner chip on the carrying message from the part's private metadata,
      marking truncated and denied paths, using shared primitives and semantic tokens per
      DESIGN.md; keep the text and metadata out of public shares, exports, and search
      projections (design D9). Verify with component tests and a story; run the Storybook story
      tests and return preview URLs; add an API test that a public share of a Chat with
      instructions items carries none of them.
- [x] 5.2 Document the chains, walk, triggers, once-per-epoch rule, the walk-to-root
      tradeoff with the reject-rule remedy, and the chip in `docs/native-files.md`; update
      `SPEC.md`'s Workspace and context-rail lines; add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm --filter web lint`,
      `typecheck`, and `test:coverage`, the focused integration files touched above,
      `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body, which uses `Refs #975`.
- [ ] 5.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 5.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `knowledge`.

## 6. `instruction-files/knowledge`: Knowledge locator loading

- [ ] 6.1 Wire the `kb://` trigger into the producer's pending set, project a Knowledge
      locator to its Space and touched directory, and resolve that Space under the Run owner's
      identity through the owner-scoped Knowledge resolver (design D12). Trigger only on a
      locator whose Space identifier is already the canonical lower-case form, and use that
      one spelling for grouping, labels, seen keys, and candidate page reads. Walk from the
      Space root down to the touched directory with the same chains, selection rules,
      empty-file suppression, and non-regular skipping; a symlinked candidate the Knowledge
      resolver refuses is not selected. Label and key each selected candidate by its logical
      `kb://<spaceId>/<relative path>` locator, exclude the model's own read of a candidate by
      comparing that locator within the same directory, and never put a host path in the text,
      payload, metadata, events, or chip. Verify the chain from the Space root down to the
      touched directory, that a file above the Space root is never loaded, that a locator
      naming another owner's Space, a missing Space, or an unavailable Space loads nothing and
      probes nothing, and that a symlinked candidate is skipped.
- [ ] 6.2 Split the gating: loading requires `read` in `tools.allowed`, plus a native executor
      for a host-path trigger or a configured `knowledge.root` for a `kb://` trigger, and
      `enter_workspace` for neither. Read Space candidates through the layer-3 in-Run system
      read helper with `kb://` locators and `:raw` pages under origin `instructions`, and order
      one item per step with host files first, then Knowledge files, each group from its
      broadest directory and base before local. Verify a `kb://`-only Run on a process without
      a native executor loads its chain, a step touching both a host path and a `kb://` locator
      produces exactly one item with the host file first, and a second touch in the epoch is
      silent.
- [ ] 6.3 Verify the negative isolation cases: a locator naming another owner's Space loads
      nothing, issues no candidate probe, and records no `instructions` event; a locator whose
      Space identifier contains an upper-case letter loads nothing and records no
      `instructions` event while the model's own read of that locator proceeds; the item text,
      payload, metadata, audit events, and owner chip contain no host path; a bundle holding a
      Space file carries the closed Knowledge untrusted-content notice exactly once and a
      host-only bundle carries none; and a `knowledge_search` hit loads nothing.
- [ ] 6.4 Document the Space-scoped walk, the logical labels, and the non-triggers in
      `docs/knowledge.md` and `docs/native-files.md`, update the `SPEC.md` sentence for
      Knowledge loading, and add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`,
      `typecheck`, and `unit`, the focused integration files touched above, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate instruction-files --strict`; record the commands in the PR
      body, which uses `Closes #975`.
- [ ] 6.5 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 6.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `finalize`.

## 7. `instruction-files/finalize`: spec sync and archive

- [ ] 7.1 After every implementation layer is published, verified, and checked, create only the
      finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify
      `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`; this layer contains no application fix and
      no shipping record.
- [ ] 7.2 Inspect `pnpm exec openspec status --change instruction-files --json` and this task
      list; stop if an artifact or earlier task is incomplete. Complete this task as part of
      `$openspec-archive-change`, preserving checked history, and verify strict specs/all
      validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.

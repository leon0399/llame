Track [#1029](https://github.com/leon0399/llame/issues/1029) (instruction and skill imports) and [#1142](https://github.com/leon0399/llame/issues/1142) (prompt imports) through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. Follow-ups [#1143](https://github.com/leon0399/llame/issues/1143) (paste confirmation) and [#1144](https://github.com/leon0399/llame/issues/1144) (aggregate cap) are separate work, not native blockers.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- import-markers/proposal
         <- import-markers/parser
         <- import-markers/instruction-imports
         <- import-markers/skill-imports
         <- import-markers/prompt-imports
         <- import-markers/prompt-import-chip
         <- import-markers/finalize
```

- `proposal` (parent `master`, about 1,100 authored lines) owns only proposal, design, the
  delta specs, and this task list.
- `parser` (parent `proposal`, about 600 authored lines): the marker grammar module and its
  runtime dependency, unwired. References #1029 and #1142.
- `instruction-imports` (parent `parser`, about 1,700 authored lines): import expansion in the
  instruction bundle, canonical admission, import-triggered chain loads, payload, template,
  and the instructions chip. References #1029.
- `skill-imports` (parent `instruction-imports`, about 700 authored lines): package-local
  imports in explicit activation. Its merge completes #1029's acceptance, so its PR uses
  `Closes #1029`.
- `prompt-imports` (parent `skill-imports`, about 1,800 authored lines): the accepted-turn
  stage, `prompt-import` origin, persisted item, recovery, bounds, and instruction triggers.
  References #1142.
- `prompt-import-chip` (parent `prompt-imports`, about 700 authored lines): the owner chip,
  web payload validation, owner reference docs, and isolation coverage. Its merge completes
  #1142's acceptance, so its PR uses `Closes #1142`.
- `finalize` (parent `prompt-import-chip`, about 150 authored lines) owns only spec sync,
  checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `import-markers/parser`: the marker grammar

- [ ] 1.1 Promote `mdast-util-from-markdown@2.0.2` to an `apps/api` runtime dependency and add
      a marker module that returns each marker's shape, target, and source offsets for a
      Markdown string, implementing the `import-markers` requirements (design D1). Verify with
      unit tests covering every scenario of the `import-markers` spec, plus a CRLF source,
      an angle-bracket destination containing spaces, a link whose title is `Import`, nested
      emphasis around a bare marker, an unclosed fence, and a 1 MiB input parsed under the
      unit-test timeout.
- [ ] 1.2 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR body.
- [ ] 1.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 1.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `instruction-imports`.

## 2. `import-markers/instruction-imports`: imports in instruction files

- [ ] 2.1 Extend the bundle collector to expand markers in each loaded body: same-store
      resolution, executor-side probing (including `~/`), the skip rules, 5 hops, depth-first
      placement after the importer, `importedBy` in the payload, and the seen key added before
      recursion (design D2). Verify with producer tests for the `instruction-files` scenarios
      on chains, cycles, the six-hop chain, a missing target with no audit event, a host
      importer's web and `kb://` targets staying literal, and a Knowledge importer staying in
      its Space.
- [ ] 2.2 Add the canonical-path admission before an import's first page, recorded with origin
      `instructions`, and verify a canonical reject denies an import whose resolved path is
      allowed, that `bypass` admits it, and that chain candidates keep their current
      single evaluation (design D3).
- [ ] 2.3 Make a loaded import a pending trigger resolved in the same bundle, restarting hop
      counting for chain files it loads (design D2, D4). Verify the two acceptance examples
      from the proposal: `/repo/AGENTS.md` importing `@foo/doc.md` yields
      `/repo/AGENTS.md`, `/repo/foo/doc.md`, `/repo/foo/AGENTS.md` in that order, and neither
      `foo/doc.md` importing `@AGENTS.md` nor a direct `@foo/AGENTS.md` injects
      `/repo/foo/AGENTS.md` twice; and that a later epoch after compaction reloads imports.
- [ ] 2.4 Render the `imported-by` block attribute and the inherited-scope clause in
      `apps/api/src/prompts/instructions.md`; render imports under their importer in the
      instructions chip and accept `importedBy` in the web history validator. Verify the
      template snapshot, the chip story, and that an item stored before this layer still
      renders.
- [ ] 2.5 Update `docs/product/reference/instruction-files.md` (replace "Imports are not
      supported"), `docs/product/operator/native-files.md`, `docs/product/operator/knowledge.md`,
      the `SPEC.md` instruction-file sentence, and add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused integration
      files touched above, `pnpm --filter web lint` and `typecheck`, Storybook tests for the
      chip, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR body.
- [ ] 2.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 2.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `skill-imports`.

## 3. `import-markers/skill-imports`: imports in activated skills

- [ ] 3.1 Expand markers in the frontmatter-stripped `SKILL.md` body against the package
      directory as `skill://<name>/<relative path>:raw` reads with origin `skill-activation`,
      canonical admission, 5 hops, and the literal rules; render imported files after the body
      in the same activation item and count them against the activation bounds, naming
      overflow in the existing bounded notice (design D5). Verify the `agent-skills` and
      `context-injection` activation scenarios, that a skill import triggers no instruction
      load, and that recovery replays a completed activation with its imports unchanged.
- [ ] 3.2 Update `docs/product/operator/skills.md` and `docs/product/reference/locators/skill.md`
      and add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and
      `test:coverage`, the focused integration files touched above, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR
      body, which uses `Closes #1029`.
- [ ] 3.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 3.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `prompt-imports`.

## 4. `import-markers/prompt-imports`: imports in the owner prompt

- [ ] 4.1 Add origin `prompt-import` to the system-origin union and validator and
      `prompt-imports` to the producer order after `skill-activation` (design D6, D8). Verify
      that system-origin `prompt-import` activity never becomes an assistant tool part live,
      after reconstruction from the event log, or after recovery, and the producer-order
      scenario of `context-injection`.
- [ ] 4.2 Add the accepted-turn prompt-import stage after explicit activation: resolution
      against the bound Workspace, probe before admission, one `read` per distinct target with
      selectors, the 8-target, 128 KiB, and 30 s bounds, and one persisted `prompt-imports`
      item with its template, precedence statement, neutralization, and not-imported lines
      (design D6, D7). Verify the `prompt-imports` scenarios, including the
      `@README.md:30-35` and `:outline` examples against a scripted web fixture, `ping @leo`
      and an e-mail address recording no audit event, and a denied read named as not imported.
- [ ] 4.3 Persist and recover through a repository mirroring the activation parts
      repository, so a retry or worker resumption reuses completed results and reads only
      unattempted targets (design D6). Verify with an integration test that fails an attempt
      after persistence and observes no second read on retry.
- [ ] 4.4 Pass admitted host and Knowledge prompt imports, derived from the persisted item,
      to the accepted-turn instruction load (design D4). Verify that a prompt import under
      `apps/api` stages `apps/api/AGENTS.md` before the first model request, that a retry
      stages the same load, and that denied, missing, web, and `skill://` targets stage none.
- [ ] 4.5 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused
      integration files touched above, `pnpm format:check`, `pnpm lint:markdown`,
      `git diff --check`, and `pnpm exec openspec validate import-markers --strict`; add a
      dated `CHANGELOG.md` entry; record the commands in the PR body.
- [ ] 4.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 4.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `prompt-import-chip`.

## 5. `import-markers/prompt-import-chip`: owner disclosure

- [ ] 5.1 Add the prompt-imports chip on the user message and its web history validation
      (design D9). Verify with a story and Storybook tests for imported, truncated, denied,
      failed, and omitted entries.
- [ ] 5.2 Verify the negative isolation cases with the API integration suite: another owner
      cannot read the item, its metadata, or the `prompt-import` audit events through any
      API; public shares, transcript exports, and search projections expose neither text nor
      metadata; a `kb://` target naming another owner's Space imports nothing and records no
      audit event.
- [ ] 5.3 Add `docs/product/reference/prompt-imports.md`, link it from
      `docs/product/reference/index.md` and `docs/product/reference/tools/read.md`, update the
      `SPEC.md` context-rail lines, and add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter web lint` and `typecheck`, the Storybook tests, the integration files
      touched above, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR
      body, which uses `Closes #1142`.
- [ ] 5.4 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 5.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `finalize`.

## 6. `import-markers/finalize`: spec sync and archive

- [ ] 6.1 After every implementation layer is published, verified, and checked, create only the
      finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify
      `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`; this layer contains no application fix and
      no shipping record.
- [ ] 6.2 Inspect `pnpm exec openspec status --change import-markers --json` and this task
      list; stop if an artifact or earlier task is incomplete. Complete this task as part of
      `$openspec-archive-change`, preserving checked history, and verify strict specs/all
      validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.

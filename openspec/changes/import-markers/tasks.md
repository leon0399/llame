Track [#1029](https://github.com/leon0399/llame/issues/1029) (instruction and skill imports) and [#1142](https://github.com/leon0399/llame/issues/1142) (prompt imports) through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. Follow-ups [#1143](https://github.com/leon0399/llame/issues/1143) (paste confirmation) and [#1144](https://github.com/leon0399/llame/issues/1144) (aggregate cap) are separate work, not native blockers.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- import-markers/proposal
         <- import-markers/parser
         <- import-markers/instruction-imports
         <- import-markers/import-admission
         <- import-markers/skill-imports
         <- import-markers/prompt-imports
         <- import-markers/prompt-import-triggers
         <- import-markers/prompt-import-chip
         <- import-markers/finalize
```

- `proposal` (parent `master`, about 1,700 authored lines after review round 1) owns only
  proposal, design, the delta specs, and this task list.
- `parser` (parent `proposal`, about 600 authored lines): the marker grammar module and its
  runtime dependency, unwired. References #1029 and #1142.
- `instruction-imports` (parent `parser`, about 1,600 authored lines): import expansion in
  the instruction bundle, import-triggered chain loads, payload, template, and the
  instructions chip. References #1029.
- `import-admission` (parent `instruction-imports`, about 800 authored lines): the
  canonical-path evaluation of instruction imports and its derived-decision record.
  References #1029.
- `skill-imports` (parent `import-admission`, about 700 authored lines): package-local
  imports in explicit activation. Its merge completes #1029's acceptance, so its PR uses
  `Closes #1029`.
- `prompt-imports` (parent `skill-imports`, about 1,800 authored lines): the accepted-turn
  stage after the binding re-check, `prompt-import` origin, the derived-decision sink for
  system reads, persisted item, recovery, and bounds. References #1142.
- `prompt-import-triggers` (parent `prompt-imports`, about 900 authored lines): instruction
  triggers from prompt imports, including the accepted-turn load without a binding and with
  a Knowledge world. References #1142.
- `prompt-import-chip` (parent `prompt-import-triggers`, about 700 authored lines): the owner
  chip, web payload validation, owner reference docs, and isolation coverage. Its merge
  completes #1142's acceptance, so its PR uses `Closes #1142`.
- `finalize` (parent `prompt-import-chip`, about 150 authored lines) owns only spec sync,
  checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `import-markers/parser`: the marker grammar

- [x] 1.1 Promote `mdast-util-from-markdown@2.0.2` to an `apps/api` runtime dependency and add
      a marker module that returns the distinct marker targets of a Markdown string in
      first-occurrence order, implementing the `import-markers` requirements (design D1). Verify with
      unit tests covering every scenario of the `import-markers` spec, plus a CRLF source,
      an angle-bracket destination containing spaces, `@pkg/__init__.py`,
      `@apps/api/__tests__/x.test.ts`, an escaped `\@`, an entity `&#64;`, `**leo**@example.com`, `see <@a.md> now`,
      `![x](@a.md)`, `[@a.md][r]`, `[r]: @a.md "import"`, a link whose title is `Import`, an unclosed fence, and pathological inputs (repeated
      `(@`, long punctuation runs, many unbalanced brackets) at 64 KiB complete in linear time.
- [x] 1.2 Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR body.
- [x] 1.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 1.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `instruction-imports`.
- [x] 1.5 Implement the delimited bare markers of the `import-markers` requirement "Delimited bare markers carry the whole locator" in the parser with unit tests for every new
      scenario plus pathological unterminated quotes at 64 KiB in linear time.

## 2. `import-markers/instruction-imports`: imports in instruction files

- [ ] 2.1 Extend the bundle collector to expand markers in each loaded body: same-store
      resolution with `~/` left literal, silent `read`-group pre-evaluation before every
      probe, denied targets sent through the audited `read` path without a filesystem probe
      regardless of existence, admitted-only probing, the skip rules, 5 hops counted from
      the nearest chain file, placement after the importer, `importedBy` in the payload and
      in the API's exact payload validator, an in-progress key added before descending and
      an epoch seen key added only when the import loads, and fail-closed skipping of any import
      whose canonical path differs from its resolved path
      until `import-admission` lands (design D2, D3). Verify with producer tests, including
      a symlinked import skipped as denied, a rejected existing and missing target reporting
      identically as denied after silent pre-evaluation without a probe, an admitted missing
      target staying literal with no audit, `@~/prefs.md` staying literal, the
      `instruction-files` scenarios on chains, cycles, the six-hop chain, a selector-bearing
      target left literal, a host importer's web and `kb://` targets staying literal, and a
      Knowledge importer staying in its Space.
- [ ] 2.2 Make a loaded import a trigger for its own directory, walked before the import's
      own markers, with chain files it loads restarting hop counting (design D2, D4). Verify
      the proposal's acceptance examples: `/repo/AGENTS.md` importing `@foo/doc.md` yields
      `/repo/AGENTS.md`, `/repo/foo/doc.md`, `/repo/foo/AGENTS.md` (a chain file, no
      `imported-by`), `foo/doc.md`'s `@AGENTS.md` stays literal, a direct `@foo/AGENTS.md`
      loads once as an import, an ordinary import crossing a directory keeps consuming hops
      (a sixth import across directories stays literal), and only a chain file loaded through
      an import's directory trigger restarts at hop zero; a later epoch after compaction
      reloads imports.
- [ ] 2.3 Render the `imported-by` block attribute and the inherited-scope clause in
      `apps/api/src/prompts/instructions.md`; render imports under their importer in the
      instructions chip and accept `importedBy` in the web history validator. Verify the
      template snapshot, the chip story, and that an item stored before this layer still
      renders.
- [ ] 2.4 Update `docs/product/reference/instruction-files.md` (replace "Imports are not
      supported"), `docs/product/operator/native-files.md`, `docs/product/operator/knowledge.md`,
      the `SPEC.md` instruction-file sentence, and add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused integration
      files touched above, `pnpm --filter web lint` and `typecheck`, Storybook tests for the
      chip, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR body.
- [ ] 2.5 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 2.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `import-admission`.

## 3. `import-markers/import-admission`: canonical-path admission of instruction imports

- [ ] 3.1 Add an `admitCanonical` capability to the in-Run attempt and accepted-turn contexts
      that evaluates the `read` group against an import's canonical path and records the
      result as a derived `canonical` decision on the import's first page call, replacing the
      fail-closed skip from 2.1; add a per-call derived-decision sink and a `derivedDecisions`
      field to the system read completion so accepted-turn pages record it too (design D3).
      Verify that a canonical reject denies an import whose resolved path is allowed
      (requested and completed, no started, chip marks it denied), that `bypass` admits and
      records both decisions, that an import whose canonical path equals its resolved path
      gets no extra decision, and that chain candidates keep their single evaluation.
- [ ] 3.2 Update `docs/product/reference/instruction-files.md`,
      `docs/product/operator/native-files.md`, `docs/product/reference/permission-modes.md`
      (bypass admits and records the new evaluation), and the bypass section of
      `docs/product/operator/tool-call-permissions.md` for the canonical rule and add a dated
      `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`,
      the focused integration files touched above, `pnpm format:check`, `pnpm lint:markdown`,
      `git diff --check`, and `pnpm exec openspec validate import-markers --strict`; record
      the commands in the PR body.
- [ ] 3.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 3.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `skill-imports`.

## 4. `import-markers/skill-imports`: imports in activated skills

- [ ] 4.1 Expand markers in the frontmatter-stripped `SKILL.md` body against the package
      directory as `skill://<name>/<relative path>:raw` reads with origin `skill-activation`
      and proactive-read admission, 5 hops, and the literal rules; render imported files after the body
      in the same activation item and count them against the activation output and work bounds, naming
      overflow in the existing bounded notice, which lists at most eight omitted import locators,
      each shortened to at most 256 characters, and counts the rest (design D5). Verify the `agent-skills` and
      `context-injection` activation scenarios, that a skill import triggers no instruction
      load, and that recovery replays a completed activation with its imports unchanged.
- [ ] 4.2 Update `docs/product/operator/skills.md` and `docs/product/reference/locators/skill.md`
      and add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and
      `test:coverage`, the focused integration files touched above, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR
      body, which uses `Closes #1029`.
- [ ] 4.3 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 4.4 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `prompt-imports`.

## 5. `import-markers/prompt-imports`: imports in the owner prompt

- [ ] 5.1 Add origin `prompt-import` to the system-origin union and validator and
      `prompt-imports` to the producer order after `skill-activation` (design D6, D8). Verify
      that system-origin `prompt-import` activity never becomes an assistant tool part live,
      after reconstruction from the event log, or after recovery, and the producer-order
      scenario of `context-injection`.
- [ ] 5.2 Add the prompt-import stage after the binding re-check and explicit activation,
      skipped on a detaching attempt through a new `detaching` flag on the Workspace
      preparation result: resolution against the bound Workspace, the 64-marker
      probe cap, silent `read`-group pre-evaluation before probing, the literal-path-first
      probe for admitted targets, one `read` per distinct target with selectors, the
      8-target, 128 KiB, and 30 s bounds, and one persisted `prompt-imports` item with its
      template, precedence statement, neutralization, not-imported lines, and per-target
      `admitted` and resolved path (design D6, D7). Verify the `prompt-imports` scenarios
      except those of _Admitted local imports trigger instruction loading_, the unbound-Chat
      trigger scenarios, and the chip and isolation scenarios (layers 6 and 7), including
      the `@README.md:30-35` and `:outline` examples against a scripted web fixture, nine
      prose tokens listing nothing as omitted, a 65th marker neither probed nor listed, an
      unprobed token dropped silently when the work bound fires, `ping @leo` and an e-mail
      address recording no audit event, a host target with no native executor staying prose,
      a rejected existing and missing absolute path reporting identically as denied after
      silent pre-evaluation without a filesystem probe, an admitted missing path staying
      prose with no audit, a denied read named as not imported, a detaching attempt importing
      nothing, and a detaching retry replaying an earlier attempt's persisted item without
      new reads.
- [ ] 5.3 Route `prompt-import` web reads through the system-read derived-decision sink added
      in 3.1, so every derived web decision is recorded in its completion audit (design D6). Verify a
      redirected web import records each hop decision, in `default` and in `bypass`.
- [ ] 5.4 Persist and recover through a repository mirroring the activation parts
      repository, so a retry or worker resumption reuses completed results and gives
      unfinished targets a fresh admission and read (design D6). Verify with an integration
      test that fails an attempt after persistence and observes no second read on retry, and
      one that resumes a started but unfinished read.
- [ ] 5.5 Add `docs/product/reference/prompt-imports.md`, link it from
      `docs/product/reference/index.md` and `docs/product/reference/tools/read.md`, update the
      `SPEC.md` context-rail lines, and add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused integration
      files touched above, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR
      body.
- [ ] 5.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 5.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `prompt-import-triggers`.

## 6. `import-markers/prompt-import-triggers`: instruction loads from prompt imports

- [ ] 6.1 Widen the accepted-turn instruction load: the Workspace root becomes optional, the
      turn context gains the Knowledge world, and the root load stays conditional on a
      binding, while prompt-import triggers are gated like in-Run triggers (design D4).
      Verify that a `kb://` prompt import loads its Space chain on a process with a Knowledge
      root and no native executor, and that an unbound Chat importing an absolute host file
      loads that directory's chain.
- [ ] 6.2 Derive prompt-import triggers from the persisted item's admitted targets and their
      resolved paths and pass them to the accepted-turn load (design D4). Verify that a
      prompt import under `apps/api` stages `apps/api/AGENTS.md` before the first model
      request, that an admitted import whose read failed still triggers, that a non-detaching
      retry stages the same load after the binding switched, that a detaching retry stages
      none, that denied, missing, web, and
      `skill://` targets stage none, and that a prompt import of an instruction file does
      not by itself load it.
- [ ] 6.3 Update `docs/product/reference/instruction-files.md` and
      `docs/product/reference/prompt-imports.md` for prompt-import triggers and
      add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and
      `test:coverage`, the focused integration files touched above, `pnpm format:check`,
      `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR body.
- [ ] 6.4 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 6.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `prompt-import-chip`.

## 7. `import-markers/prompt-import-chip`: owner disclosure

- [ ] 7.1 Add the prompt-imports chip on the user message and its web history validation
      (design D9). Verify with a story and Storybook tests for imported, truncated, denied,
      failed, and omitted entries.
- [ ] 7.2 Verify the negative isolation cases with the API integration suite: another owner
      cannot read the item, its metadata, or the `prompt-import` audit events through any
      API; public shares, transcript exports, and search projections expose neither text nor
      metadata; a `kb://` target naming another owner's Space imports nothing and records no
      audit event.
- [ ] 7.3 Extend `docs/product/reference/prompt-imports.md` with the owner chip and its
      visibility, and add a dated `CHANGELOG.md` entry. Run
      `pnpm --filter web lint` and `typecheck`, the Storybook tests, the integration files
      touched above, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and
      `pnpm exec openspec validate import-markers --strict`; record the commands in the PR
      body, which uses `Closes #1142`.
- [ ] 7.4 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix
      accepted findings, and rerun affected checks before marking ready.
- [ ] 7.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head
      CI and zero actionable unresolved feedback before creating `finalize`.
- [ ] 7.6 Document the delimited forms in docs/product/reference/prompt-imports.md,
      docs/product/reference/instruction-files.md, docs/product/reference/locators/skill.md,
      docs/product/operator/skills.md, docs/product/reference/tools/read.md, SPEC.md, and
      the CHANGELOG entries. That layer closes #1159.

## 8. `import-markers/finalize`: spec sync and archive

- [ ] 8.1 After every implementation layer is published, verified, and checked, create only the
      finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify
      `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`; this layer contains no application fix and
      no shipping record.
- [ ] 8.2 Inspect `pnpm exec openspec status --change import-markers --json` and this task
      list; stop if an artifact or earlier task is incomplete. Complete this task as part of
      `$openspec-archive-change`, preserving checked history, and verify strict specs/all
      validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.

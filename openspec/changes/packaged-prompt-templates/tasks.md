## 1. Proposal prerequisites

Delivery uses `$gh-stack` and, after proposal approval,
`$openspec-apply-change`. The intended stack is:

```text
master
  <- packaged-prompt-templates/proposal
  <- packaged-prompt-templates/engine
  <- packaged-prompt-templates/rail
  <- packaged-prompt-templates/instructions
  <- packaged-prompt-templates/notices
  <- packaged-prompt-templates/finalize
```

The proposal layer owns only these OpenSpec artifacts. Engine owns the shared
template engine extraction and the asset glob (#863, closed by its PR). Rail
owns the eleven producer bodies and the checkpoint body plus the authoring
convention. Instructions owns both summarization instructions and the title
prompt. Notices owns the four untrusted-content notices; its PR closes #864
and #862 after the complete change satisfies acceptance. Earlier layers
reference #862 and #864 without closing them. Finalize owns canonical spec
sync and archive. Implementation branches require approval of the reviewed
proposal; publication and merging require separate authority.

- [ ] 1.1 Link this change to #862, #863, and #864; verify the acceptance criteria reflect D1-D8 and that no operator configuration key is introduced.
- [ ] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [ ] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `prompt-loader.ts`, the producers, or `compaction.ts` since the proposal was written.

## 2. Engine layer

- [ ] 2.1 Move the Handlebars environment, compile cache, file read and normalization, value escaping, and core-scope projection out of `prompt-loader.ts` into one shared module the loader imports; verify `prompt-loader.test.ts`, `chat-default.test.ts`, `tool-descriptions.test.ts`, and `run-execution-tools.integration.test.ts` pass unmodified.
- [ ] 2.2 Add `loadPackagedTemplate(directory, name)` that reads `<directory>/prompts/<name>.md` at module initialization, normalizes it, compiles with `noEscape`, and returns a render function; verify with a throwaway template that it renders from `dist` after `pnpm --filter api build`, then delete the throwaway.
- [ ] 2.3 Widen `nest-cli.json` assets to `**/*.md`; verify the build output still contains `prompts/chat-default.md` and `prompts/tools/*.md` and that `prompt-built-runtime.contract.ts` passes.
- [ ] 2.4 Capture rendered system prompt and all seven tool descriptions for a fixed input before and after the extraction and include the byte comparison in the PR; verify the shared module has no import from `instance-config` allowlists.

## 3. Rail layer

- [ ] 3.1 Move `temporal`, `effective-context-change`, `recency-digest` delta and supersession, and `compaction` checkpoint bodies to `chats/prompts/*.md`, each rendered through one module-level template constant; verify `context-item-producers.test.ts`, `context-item-producers.behavior.test.ts`, `context-item-temporal.test.ts`, and `context-builder.test.ts` pass unmodified.
- [ ] 3.2 Move the `tool-availability` body to `chats/prompts/tool-availability.md`; verify `tool-availability-context-item.test.ts` passes unmodified.
- [ ] 3.3 Move the `skill-catalog` notice and snapshot and the three `skill-activation` bodies to `chats/prompts/*.md`, keeping the `<skill_instructions>` delimiter and path guidance as authored; verify `skill-catalog-item.test.ts`, `skill-activation-item.test.ts`, `skill-turn-state.test.ts`, and `activation-parts.repository.test.ts` pass unmodified.
- [ ] 3.4 Confirm producers still call `sanitizeAuthoredText` on the same values as before and pass llame-authored identifiers raw; verify the reserved-delimiter tests in the files above still pass and that no template uses `{{{ }}}`.
- [ ] 3.5 Add the packaged-template authoring convention (D2-D6) to `apps/api/AGENTS.md`; verify `pnpm lint:markdown` passes.

## 4. Instructions layer

- [ ] 4.1 Move `COMPACTION_INSTRUCTION` and `TRANSITION_COMPACTION_INSTRUCTION` to `compaction/prompts/instruction.md` and `instruction-transition.md` with the standing-context exclusion and headings inline; delete `COMPACTION_SECTION_HEADINGS` and `COMPACTION_MARKDOWN_SECTIONS`; verify `compaction.test.ts`, `compaction.service.test.ts`, and `compaction-context.integration.test.ts` pass, with the heading assertion reading the rendered instruction only.
- [ ] 4.2 Move `TITLE_SYSTEM_PROMPT` to `titles/prompts/system.md`; verify the title tests pass unmodified and the request still uses the packaged prompt rather than the chat model's effective prompt.

## 5. Notices layer

- [ ] 5.1 Move `UNTRUSTED_LABEL` and `CONVERSATION_HISTORY_NOTICE` (with its two halves) to `chats/prompts/tool-output-untrusted.md` and `conversation-history-notice.md`; verify `tool-observation-part.test.ts`, `tool-observation-part.behavior.test.ts`, `conversation-evidence.test.ts`, and `conversation-read.test.ts` pass unmodified.
- [ ] 5.2 Move `KNOWLEDGE_CONTENT_NOTICE` to `knowledge/prompts/content-notice.md` and `SKILL_PATH_INSTRUCTION` to `skills/prompts/path-instruction.md`; verify `knowledge-tools.test.ts`, `native-files.test.ts`, and the skill-target tests pass unmodified.
- [ ] 5.3 Search the touched modules for remaining model-facing string literals; verify only `renderToolObservationOmission` and tool-result error strings remain, and record that list in the PR body.
- [ ] 5.4 Verify the integrated change with the affected workspace lint, typecheck, and focused tests, `pnpm --filter api build`, strict OpenSpec validation, Markdown lint, formatting, and diff checks; add the `CHANGELOG.md` entry. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 6. Finalize layer

- [ ] 6.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `context-injection`, `model-system-prompts`, and `instance-config`; verify the added requirements appear in the canonical specs and unrelated scenarios are preserved, then run strict spec/all validation.
- [ ] 6.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 6.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.

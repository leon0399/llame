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
template engine extraction, the asset rule, and the lint and formatter
exemptions (#863, closed by its PR). Rail owns the ten producer bodies and the
checkpoint body plus the authoring convention. Instructions owns both
summarization instructions and both title prompts. Notices owns the tool-output
framing and the four closed result notices; its PR closes #864 and #862 after the complete change
satisfies acceptance. Earlier layers reference #862 and #864 without closing
them. Finalize owns canonical spec sync and archive. Implementation branches
require approval of the reviewed proposal; publication and merging require
separate authority.

- [x] 1.1 Link this change to #862, #863, and #864; verify the acceptance criteria reflect D1-D10 and that no operator configuration key is introduced.
- [x] 1.2 Review the complete draft with at least two independent reviewers and resolve verified substantive findings; run strict OpenSpec validation, Markdown lint, formatting, and diff checks, then obtain Leo's approval of the reviewed revision.
- [x] 1.3 Before implementation, inspect the current stack/base and reconcile any landed change to `prompt-loader.ts`, the producers, `compaction.ts`, `title.ts`, `tool-observation-part.ts`, or `search-conversations.ts` since the proposal was written.

## 2. Engine layer

- [x] 2.1 Move the Handlebars environment, compile cache, file read and normalization, and escaping helpers out of `prompt-loader.ts` into one shared module the loader imports, leaving the projection and validator in place; key the cache by source and escape regime or keep one map per regime; verify `apps/api/src/instance-config/prompt-loader.test.ts`, `apps/api/src/prompts/chat-default.test.ts`, and `apps/api/src/prompts/tool-descriptions.test.ts` pass unmodified under the unit project and `apps/api/src/chats/run-execution-tools.integration.test.ts` passes under `pnpm --filter api test:integration`.
- [x] 2.2 Add `loadPackagedTemplate(directory, name)` that reads `<directory>/prompts/<name>.md` at module initialization, normalizes it, compiles with `noEscape`, and returns a render function; verify with a unit test that a value containing `<&>"'` renders raw and that the same source compiled for the operator path still escapes.
- [x] 2.3 Add `**/prompts/**/*.md` to `nest-cli.json` assets; add `apps/api/src/chats/prompts/**`, `apps/api/src/compaction/prompts/**`, `apps/api/src/titles/prompts/**`, `apps/api/src/knowledge/prompts/**`, `apps/api/src/skills/prompts/**`, and `apps/api/src/tools/prompts/**` to `.markdownlint-cli2.jsonc` ignores and the same six in directory form to `.prettierignore`, with the same justification comment the `tools/` entries carry; prove the asset rule with a temporary fixture under one of those directories that the rail layer replaces with its first real template; verify the build output contains `prompts/chat-default.md` and `prompts/tools/*.md` and contains no `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `BASELINE.md`; verify `pnpm lint:markdown` still lints `apps/api/src/prompts/chat-default.md` and its MD033 override still applies, and `pnpm format:check` still covers it.
- [x] 2.4 Capture the rendered system prompt and all seven tool descriptions for a fixed input before and after the extraction and include the byte comparison in the PR; verify the shared module has no import from `instance-config` allowlists and `prompt-built-runtime.contract.ts` still passes.

## 3. Rail layer

- [x] 3.1 Move `temporal`, `effective-context-change`, `recency-digest` delta and supersession, and `compaction` checkpoint bodies to `apps/api/src/chats/prompts/*.md`, each rendered through one module-level template constant; delete `DIGEST_PRECEDENCE` and replace its import in `context-item-producers.behavior.test.ts` with the verbatim sentence as `context-builder.test.ts` does; add `chats/prompts` to `prompt-built-runtime.contract.ts`; verify `context-item-producers.test.ts`, `context-item-producers.behavior.test.ts`, `context-item-temporal.test.ts`, and `context-builder.test.ts` in `apps/api/src/chats/` pass with no other edit, and include the rendered-bytes diff for every variant in the PR.
- [x] 3.2 Move the `tool-availability` body to `apps/api/src/chats/prompts/tool-availability.md` as one file, deriving the `initial` boolean and the reason labels in the producer before rendering; verify `apps/api/src/chats/tool-availability-context-item.test.ts` passes unmodified for initial, all-groups, and single-group payloads.
- [x] 3.3 Move the `skill-catalog` notice and snapshot and the three `skill-activation` bodies to `apps/api/src/chats/prompts/*.md`, deriving pluralized and joined strings and failure labels in the producer, keeping each producer's own `<skill_instructions>` delimiter, path guidance, and precedence sentences as literal template text without copying between producers; verify `skill-catalog-item.test.ts`, `skill-activation-item.test.ts`, `skill-turn-state.test.ts`, and `activation-parts.repository.test.ts` in `apps/api/src/chats/` pass unmodified.
- [x] 3.4 Confirm producers still call `sanitizeAuthoredText` on the same values as before, pass grammar-safe identifiers and the two skill paths raw, keep every exported name's kind and arity, and supply no `user`, `chats`, `skills`, `model`, `context`, or `tools` value; verify the reserved-delimiter tests in the files above still pass and that no template uses `{{{ }}}`.
- [x] 3.5 Add the packaged-template authoring convention (D2-D6, D9, D10, and the `src/tools/prompts` versus `src/prompts/tools` trap) to `apps/api/AGENTS.md`; verify `pnpm lint:markdown` passes with the exemptions in place.

## 4. Instructions layer

- [ ] 4.1 Move `COMPACTION_INSTRUCTION` and `TRANSITION_COMPACTION_INSTRUCTION` to `apps/api/src/compaction/prompts/instruction.md` and `instruction-transition.md` with the exclusion and headings inline, keeping both exported names as strings; delete `COMPACTION_SECTION_HEADINGS`, `COMPACTION_MARKDOWN_SECTIONS`, and `STANDING_CONTEXT_EXCLUSION`, moving the exclusion's rationale comment beside the template constant; in `compaction.test.ts` remove the constant's import and identity assertion, keep the heading loop over the rendered instruction, and add a literal pin of the exclusion sentence naming `<system-reminder>` and `recency-digest` for both modes; add `compaction/prompts` to `prompt-built-runtime.contract.ts`; verify `compaction.test.ts`, `compaction.service.test.ts`, `compaction-context.integration.test.ts`, and `compactions.integration.test.ts` in `apps/api/src/compaction/` pass, and include the rendered-bytes diff in the PR.
- [ ] 4.2 Move `TITLE_SYSTEM_PROMPT` to `apps/api/src/titles/prompts/system.md` and `titleUserPrompt` to `apps/api/src/titles/prompts/user.md`, keeping the exported string and the `titleUserPrompt(text)` signature; add literal pins of both rendered texts; add `titles/prompts` to `prompt-built-runtime.contract.ts`; verify `apps/api/src/titles/title.test.ts`, `title.service.test.ts`, and `apps/api/src/testing/support.test.ts` pass and `fake-streaming-model-client.ts` still matches the title request by identity.

## 5. Notices layer

- [ ] 5.1 Move the whole `resultText` framing (untrusted label, `Outcome:` line, optional `Payload:` block) to `apps/api/src/chats/prompts/tool-output-untrusted.md` with `outcome`, `payload`, and a producer-derived `hasPayload` boolean (an empty-string body renders an empty block today) as values, neutralizing the rendered result as today, and add a literal pin for the empty-payload case; move `CONVERSATION_HISTORY_NOTICE` to `apps/api/src/chats/prompts/conversation-history-notice.md` and `SEARCH_CONVERSATIONS_CANONICAL_NOTICE` to `apps/api/src/tools/prompts/search-conversations-notice.md`, keeping the exported names as strings; delete `CONVERSATION_HISTORY_UNTRUSTED_NOTICE` and `CONVERSATION_HISTORY_AUTHORITY_NOTICE`; add literal pins for the two notices that lack one; add `tools/prompts` to `prompt-built-runtime.contract.ts`; verify `tool-observation-part.test.ts`, `tool-observation-part.behavior.test.ts`, `conversation-evidence.test.ts` in `apps/api/src/chats/` and `conversation-read.test.ts`, `search-conversations.test.ts` in `apps/api/src/tools/` pass, and include the rendered-bytes diff for output with and without a payload.
- [ ] 5.2 Move `KNOWLEDGE_CONTENT_NOTICE` to `apps/api/src/knowledge/prompts/content-notice.md` and `SKILL_PATH_INSTRUCTION` to `apps/api/src/skills/prompts/path-instruction.md`, keeping the exported names as strings; add literal pins; add `knowledge/prompts` and `skills/prompts` to `prompt-built-runtime.contract.ts`; verify `apps/api/src/knowledge/knowledge-tools.test.ts`, `apps/api/src/tools/native-files.test.ts`, and `apps/api/src/skills/skill-target.test.ts` pass.
- [ ] 5.3 Sweep `apps/api/src` and `packages/runtime-safety` for remaining model-facing string literals; verify the residue is exactly `renderToolObservationOmission`, result content composed by tool implementations, the permission layer, and result truncation (error messages, permission rejections, settlement and truncation notices), the closed reason-code label maps, and `CONTEXT_ITEM_PROVENANCE`, and record that list in the PR body.
- [ ] 5.4 Verify the integrated change with the affected workspace lint, typecheck, and focused tests, `pnpm --filter api build`, strict OpenSpec validation, Markdown lint, formatting, and diff checks; add the `CHANGELOG.md` entry. Publish only with authority, then complete self-review and the repository's ready-PR monitoring contract.

## 6. Finalize layer

- [ ] 6.1 After implementation and delivery gates pass, run `$openspec-sync-specs` for `context-injection`, `model-system-prompts`, `tool-calling`, and `instance-config`; verify the added requirements appear in the canonical specs and unrelated scenarios are preserved, then run strict spec/all validation.
- [ ] 6.2 Record completed implementation/verification tasks and run `$openspec-archive-change`; verify archived artifacts exist and the active change is absent.
- [ ] 6.3 Run strict spec/all validation, Markdown lint, formatting, and diff checks on the finalize layer; verify stack bases and tracking/publication state before handoff. Merge remains subject to Leo's explicit permission.

## Context

See proposal.md for motivation. The current state that shapes the approach:

- `apps/api/src/instance-config/prompt-loader.ts` (about 1300 lines) holds two things: the strict validator for operator prompt files (AST allowlist, gate keys, collection vocabularies, boot probes across the owner/chat/skills cross product, the `model`/`context`/`tools` projection) and the generic machinery every template needs (a private `Handlebars.create()` environment, a source-keyed compile cache, file read with CRLF-to-LF and trailing-whitespace normalization, `escapeForPrompt`/`promptValue`).
- Rail items are authored at worker request preparation (`run-execution.service.ts`, `skills/skill-activation.ts`, `chats/skill-turn-state.ts`) from their own payloads and persisted byte-exact into `messages.parts`; `activation-parts.repository.ts` re-authors an omission item from a reduced payload by calling the producer. Every rail producer has an exact-output test. Several producers derive view values before rendering: `tool-availability` branches on `payload.kind` and maps closed reason codes to labels; `skill-catalog` and `skill-activation` pluralize and join. The engine registers only `if`, `unless`, `each`, `with`, `lookup`, and `log`; there is no comparison helper.
- The instructions and notices are exported constants whose tests compare the constant to itself (`compaction.test.ts` asserts fragments with `toContain`; `conversation-read.test.ts`, `knowledge-tools.test.ts`, and `native-files.test.ts` compare payloads to the imported notice). `tool-observation-part.test.ts` is the exception: it duplicates `UNTRUSTED_LABEL` literally.
- Full-current compaction is already a cache-aligned continuation of the completed Run; transition compaction omits declarations by specification.
- `nest-cli.json` ships assets matching `prompts/**/*.md` under `sourceRoot: src`; `src` also holds `db/AGENTS.md`, its `CLAUDE.md`/`GEMINI.md` symlinks, and `search/chat/eval/BASELINE.md`. `.markdownlint-cli2.jsonc` and `.prettierignore` exempt only `apps/api/src/prompts/tools/`, with the recorded reason that formatters would rewrite provider-facing bytes; MD032 and MD033 would reject the list-after-block and `<skill_instructions>` shapes several bodies need.
- Reference harness: oh-my-pi (revision `042028fd`) addresses every prompt by direct file import, colocates module-owned prompts with the module (`packages/agent/src/compaction/prompts/`), uses flat per-file variables, and has no registry. Its engine renders unknown paths as empty and disables escaping; several of its reminders remain inline strings.

## Goals / Non-Goals

**Goals:**

- One engine for every template, two validation regimes: strict for replaceable files, none for packaged ones.
- Byte-identical output on every migrated surface. Where an exact-output test exists it passes unmodified; where a surface has only self-referential coverage, a literal pin is authored independently before the constant is deleted.
- Adding a model-facing body later means adding one `.md` file, one render call, and one literal pin.

**Non-Goals:**

- Operator overrides for any new surface.
- A surface registry, descriptor type, string ids, or index.
- Any post-render formatter (blank-line collapsing, table compaction) of the kind oh-my-pi applies; it would break byte identity.
- Changing what any body says. Wording changes are separate, producer-owned work.
- Tool-result payload text (error messages, permission rejections, settlement and truncation notices) and the `renderToolObservationOmission` sentinel.
- Compaction storage (#806, #865) and compaction request-path unification (#866).

## Decisions

**D1 Externalize everything llame authors for a model, override nothing new.** Alternative: mirror `tools.promptFiles` for the new surfaces. Rejected: every rail body carries content obligations from its capability (precedence statements, path guidance, the `<skill_instructions>` delimiter, the receipt-not-now temporal wording), and an operator replacement could silently violate them. Overrides for a surface become a later, per-surface decision once a use case exists.

**D2 Producer-owned values, nothing shared.** Each template renders from its producer's payload plus the view values the producer derives in the same module (booleans for closed kinds, labels for closed reason codes, pluralized or joined strings), because the engine has no comparison helper and the current bodies branch on codes and map them to labels. No shared projection is supplied: no render site has a model, anchor, or admitted catalog in hand, and threading one in would be speculative structure. `user.*`, `chats.*`, and `skills.*` stay on the two prefix surfaces; a rail item is frozen into `messages.parts`, so rendering personalization into one creates a second immutable copy of personal data in history (the #671 defect class), and the summarization instruction's job is to exclude those blocks. `model`, `context`, and `tools` are reserved names so a future shared value cannot collide with a producer's. The temporal item renders its own stored instant, not the prefix anchor. Alternative: the operator surfaces' full projection everywhere. Rejected for the retention reason and because nothing consumes it.

**D3 Colocation with a fixed convention.** `<module>/prompts/<surface-name>.md`, one file per rendered variant, named for the surface as the model sees it, referenced by one module-level constant beside the render function. `apps/api/src/prompts/` keeps only `chat-default.md` and `tools/*.md`, the replaceable defaults, so the directory split states which files an operator may replace. The build asset rule is `**/prompts/**/*.md`, not `**/*.md`, so `db/AGENTS.md` and `search/chat/eval/BASELINE.md` do not ship. `.markdownlint-cli2.jsonc` and `.prettierignore` gain `apps/api/src/**/prompts/**` with the same justification the existing `tools/` entries carry. Alternative: a central tree grouped by consumer surface as oh-my-pi's `coding-agent/src/prompts/` does. Rejected: `context-injection` already makes wording producer-owned, and oh-my-pi itself colocates module-owned prompts (compaction) while centralizing only shared surfaces.

**D4 Engine extraction, no validation for packaged files.** The environment, compile cache, file read and normalization, and escaping helpers move to one shared module; the operator loader imports it and keeps its projection and validator. The compile cache is keyed by source and escape regime, or split into one map per regime, because `noEscape` is baked in at compile time and one source-keyed map would return whichever compilation came first. Packaged files load at module initialization through `loadPackagedTemplate(directory, name)`, compile with `noEscape`, and render with no allowlist, probe, or strict mode. Alternative A: run packaged files through the strict validator with per-surface allowlists declared as data. Rejected as speculative structure: the allowlist exists to bound what an operator can reach, and no operator reaches these files; the exact-output tests catch a mistyped variable. Alternative B: Handlebars `strict: true` as a typo guard. Rejected: unverified interaction with `{{#if optional}}`, which most rail bodies use, for a guard the tests already provide.

**D5 Producers own neutralization; the engine escapes nothing.** Producers keep calling `sanitizeAuthoredText` on exactly the values they neutralize today (digest titles and excerpts, catalog descriptions, instruction bodies, the checkpoint summary, tool result text) and keep passing grammar-safe identifiers and the two published skill paths raw. Alternative: route every value through `escapeForPrompt` as the system prompt does. Rejected: `context-builder.test.ts` pins `"target<&>"'"` rendered raw in the model-change body; engine escaping would change those bytes and every test like it, for no boundary gain since developers author both sides.

**D6 Envelope stays in code.** `renderContextItem` keeps the `<system-reminder producer= form=>` envelope and `CONTEXT_ITEM_PROVENANCE`; templates are body-only. Alternative: author the envelope in each file as oh-my-pi does. Rejected: `producer` and `form` are rail identity with escaped attributes, and `context-injection` makes the envelope the rail's, not the producer's.

**D7 Headings live in the instruction template.** `COMPACTION_SECTION_HEADINGS` and `COMPACTION_MARKDOWN_SECTIONS` are deleted. `compaction.test.ts` keeps its independently authored heading list and loops it over the rendered instruction; the one sanctioned test edit removes the constant's import and its identity assertion. The same test gains a literal pin of the exclusion sentence naming `<system-reminder>` and `recency-digest`, which no test covers today although the canonical requirement calls it load-bearing.

**D8 Render sites do not move.** Every rail item still renders at worker request preparation; the repository re-author of the omission item keeps calling the producer, which renders from its module-level template, so no injection is needed. The checkpoint body renders where it does today (`buildCompactionReplacementHistory`); #865 measures what remains checkpoint-specific afterwards. Closed reason-code label maps (`TOOL_RECOVERY_REASON_LABELS`, the unavailable-reason labels, `FAILURE_LABELS`) stay in code as view values under D2.

**D9 Two bodies join the inventory; one class is excluded by name.** `titleUserPrompt` (the `<user>`-wrapped conversation text) and `SEARCH_CONVERSATIONS_CANONICAL_NOTICE` are the same kind of body as the rest and were missing from the first inventory; both move. The two conversation-history sentence constants are deleted, with the composed sentences duplicated in the conversation-history and search-result templates (two occurrences, under the rule of three). Tool-result payload text composed by tool implementations, the permission layer, and result truncation stays in code: it is result content, not a body llame authors for the model, and `tool-prompt-templates` already classes results outside templates.

## Risks / Trade-offs

- [Handlebars standalone-line whitespace shifts a newline and breaks byte identity] → Author each template from the current `join('\n')` output, not from prose intent; group-leading blank lines sit inside their conditional; inline ternaries stay on one line; the loader's trailing-whitespace normalization makes a file-final newline harmless. The exact-output tests are the gate and are not re-pinned.
- [A mistyped variable renders empty silently] → Every migrated surface has an exact-output test or gains a literal pin before its constant is deleted; a new surface must add one before it ships.
- [The engine extraction touches security-relevant allowlist code] → Its PR carries a before/after byte comparison for the system prompt and every tool description, and a review focused on whether any previously rejected construct is now accepted.
- [Markdownlint or Prettier rewrites template bytes] → Both ignore `apps/api/src/**/prompts/**` from the engine layer onward; the rail layer cannot pass `pnpm lint` otherwise.
- [Reviewers read packaged templates as bypassing `instance-config` validation] → The `instance-config` delta states the scope explicitly; the PR body points to it.
- [The residue sweep misreads intentional leftovers as misses] → The expected residue is named in tasks 5.3: the sentinel, tool-result payload text, the label maps, and the provenance constant.

## Migration Plan

Four implementation layers, strictly serial, one PR each, all byte-identical:

1. Engine extraction, asset rule, lint and formatter exemptions (#863).
2. Rail producers: ten bodies plus the checkpoint body (#864 layer 1). Adds the authoring convention to `apps/api/AGENTS.md`.
3. Summarization instructions and both title prompts (#864 layer 2).
4. Three untrusted-content notices, the search-result notice, and the skill path instruction (#864 layer 3).

No data migration, no config change, no rollback beyond reverting a layer; nothing persisted changes shape or bytes.

## Open Questions

None that change the specs, approach, or task breakdown.

## Context

See proposal.md for motivation. The current state that shapes the approach:

- `apps/api/src/instance-config/prompt-loader.ts` (about 1300 lines) holds two things: the strict validator for operator prompt files (AST allowlist, gate keys, collection vocabularies, boot probes across the owner/chat/skills cross product) and the generic machinery every template needs (a private `Handlebars.create()` environment, a source-keyed compile cache, file read with CRLF-to-LF and trailing-whitespace normalization, `escapeForPrompt`/`promptValue`, and the projection of `model`, `context`, and `tools.<id>`).
- Rail items are authored at worker request preparation (`run-execution.service.ts`, `skills/skill-activation.ts`, `chats/skill-turn-state.ts`) and persisted byte-exact into `messages.parts`; `activation-parts.repository.ts` re-authors an omission item from a reduced payload. Every producer has exact-output tests.
- Full-current compaction is already a cache-aligned continuation of the completed Run (same system string, schema-only tool declarations, persisted effort, replayed prefix, instruction as the trailing user message, `toolChoice: 'none'`). Transition compaction omits declarations by specification.
- `nest-cli.json` ships assets matching `prompts/**/*.md` only.
- Reference harness: oh-my-pi (revision `042028fd`) addresses every prompt by direct file import, colocates module-owned prompts with the module (`packages/agent/src/compaction/prompts/`), uses flat per-file variables, and has no registry. Its engine renders unknown paths as empty and disables escaping; several of its reminders remain inline strings.

## Goals / Non-Goals

**Goals:**

- One engine for every template, two validation regimes: strict for replaceable files, none for packaged ones.
- Byte-identical output on every migrated surface, proven by the existing exact-output tests without modification.
- Adding a model-facing body later means adding one `.md` file and one render call.

**Non-Goals:**

- Operator overrides for any new surface.
- A surface registry, descriptor type, string ids, or index.
- Any post-render formatter (blank-line collapsing, table compaction) of the kind oh-my-pi applies; it would break byte identity.
- Changing what any body says. Wording changes are separate, producer-owned work.
- Compaction storage (#806, #865) and compaction request-path unification (#866).

## Decisions

**D1 Externalize everything, override nothing new.** Alternative: mirror `tools.promptFiles` for the new surfaces. Rejected: every rail body carries content obligations from its capability (precedence statements, path guidance, the `<skill_instructions>` delimiter, the receipt-not-now temporal wording), and an operator replacement could silently violate them. Overrides for a surface become a later, per-surface decision once a use case exists.

**D2 Core-only shared context.** The shared context exposes `model.id`, `model.name`, `context.systemTime`, `context.systemTimezone`, and `tools.<id>` predicates where the render site has an admitted catalog. `user.*`, `chats.*`, and `skills.*` stay on the two prefix surfaces. Alternative: the full union everywhere. Rejected: a rail item is frozen into `messages.parts`, so rendering personalization into one creates a second immutable copy of personal data in history (the #671 defect class), and the summarization instruction's job is to exclude those blocks. Per-surface variables are named as each producer reads best, flat or nested; `model`, `context`, `tools` are reserved roots.

**D3 Colocation with a fixed convention.** `<module>/prompts/<surface-name>.md`, one file per rendered variant, named for the surface as the model sees it, referenced by one module-level constant beside the render function. `apps/api/src/prompts/` keeps only `chat-default.md` and `tools/*.md`, the replaceable defaults, so the directory split states which files an operator may replace. Alternative: a central tree grouped by consumer surface as oh-my-pi's `coding-agent/src/prompts/` does. Rejected: `context-injection` already makes wording producer-owned, and oh-my-pi itself colocates module-owned prompts (compaction) while centralizing only shared surfaces.

**D4 Engine extraction, no validation for packaged files.** The generic machinery moves to one shared module; the operator loader imports it. Packaged files load at module initialization through `loadPackagedTemplate(directory, name)`, compile with `noEscape`, and render with no allowlist, probe, or strict mode. Alternative A: run packaged files through the strict validator with per-surface allowlists declared as data. Rejected as speculative structure: the allowlist exists to bound what an operator can reach, and no operator reaches these files; the exact-output tests already catch a mistyped variable. Alternative B: Handlebars `strict: true` as a typo guard. Rejected: unverified interaction with `{{#if optional}}`, which most rail bodies use, for a guard the tests already provide.

**D5 Producers own neutralization; the engine escapes nothing.** Producers keep calling `sanitizeAuthoredText` on foreign values exactly where they do today and pass llame-authored identifiers raw. Alternative: route every value through `escapeForPrompt` as the system prompt does. Rejected: `context-builder.test.ts` pins `"target<&>"'"` rendered raw in the model-change body; engine escaping would change those bytes and every test like it, for no boundary gain since developers author both sides.

**D6 Envelope stays in code.** `renderContextItem` keeps the `<system-reminder producer= form=>` envelope and provenance; templates are body-only. Alternative: author the envelope in each file as oh-my-pi does. Rejected: `producer` and `form` are rail identity with escaped attributes, and `context-injection` makes the envelope the rail's, not the producer's.

**D7 Headings live in the instruction template.** `COMPACTION_SECTION_HEADINGS` and `COMPACTION_MARKDOWN_SECTIONS` are deleted. `compaction.test.ts` already asserts the rendered instruction against an independently authored list because iterating the implementation's array would shrink with it; the constant's only non-test consumer is the string it is interpolated into.

**D8 Render sites do not move.** Every rail item still renders at worker request preparation; the repository re-author of the omission item keeps calling the producer, which renders from its module-level template, so no injection is needed. The checkpoint body renders where it does today (`buildCompactionReplacementHistory`); #865 measures what remains checkpoint-specific afterwards.

## Risks / Trade-offs

- [Handlebars standalone-line whitespace shifts a newline and breaks byte identity] → Author each template from the current `join('\n')` output, not from prose intent; the exact-output tests are the gate and are not re-pinned.
- [A mistyped variable renders empty silently] → Every migrated surface has an exact-output test; a new surface must add one before it ships.
- [The engine extraction touches security-relevant allowlist code] → Its PR carries a before/after byte comparison for the system prompt and every tool description, and a review focused on whether any previously rejected construct is now accepted.
- [Reviewers read packaged templates as bypassing `instance-config` validation] → The `instance-config` delta states the scope explicitly; the PR body points to it.
- [A template edit between compaction and the next turn changes nothing here] → Not a risk in this change; the checkpoint still renders at compaction time.

## Migration Plan

Four implementation layers, strictly serial, one PR each, all byte-identical:

1. Engine extraction (#863).
2. Rail producers: eleven bodies plus the checkpoint body (#864 layer 1). Adds the authoring convention to `apps/api/AGENTS.md`.
3. Summarization instructions and title prompt (#864 layer 2).
4. Untrusted-content notices (#864 layer 3).

No data migration, no config change, no rollback beyond reverting a layer; nothing persisted changes shape or bytes.

## Open Questions

None that change the specs, approach, or task breakdown.

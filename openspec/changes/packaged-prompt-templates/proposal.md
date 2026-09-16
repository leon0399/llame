## Why

System prompts and llame-owned tool descriptions are packaged Handlebars files (`model-system-prompts`, `tool-prompt-templates`), but every other body llame authors for a model is a TypeScript string: ten context-item bodies and the compaction checkpoint, both compaction instructions, the title system and user prompts, the untrusted-output framing around every tool result, and the four closed result notices (prior-conversation, search-excerpt, Knowledge content, and the skill path instruction). Prose that shapes model behavior is reviewed as string concatenation, has no single rendering path, and lives beside the code that schedules it rather than as the artifact a reviewer reads. Moving it to files now, while the per-producer wording is still settling, costs one byte-identical migration; each later producer would otherwise add another inline string. This proposal owns issue #862 and its layers #863 and #864.

## What Changes

- Every body llame authors for a model, including the framing and closed notices it places inside tool results, renders from a packaged, module-owned Handlebars `.md` file colocated with its producer, through one shared engine. Result content composed by a tool implementation, the permission layer, or result truncation stays where it is. Rendered bytes are identical to today for every surface.
- Packaged templates are not configuration: no new key, no operator replacement, no boot-time validation, no probe. They compile without engine escaping; each producer keeps its existing neutralization of untrusted text. The strict validator and its allowlist remain exactly for the two operator-overridable surfaces.
- A template renders from its producer's own payload and the view values the producer derives from it (booleans, labels for closed reason codes, pluralized or joined strings). No template receives the prefix projections `user.*`, `chats.*`, or `skills.*`; `model`, `context`, and `tools` stay reserved names. The temporal item keeps rendering its own stored instant, never the prefix anchor.
- The rail envelope and provenance line stay rail-owned; templates are body-only. Each producer's precedence and framing sentences stay in that producer's template, as `context-injection` already requires. Exported names keep their kind and arity: a string constant stays a string rendered from its template, and `titleUserPrompt(text)` keeps its parameter.
- `COMPACTION_SECTION_HEADINGS`, `COMPACTION_MARKDOWN_SECTIONS`, and `STANDING_CONTEXT_EXCLUSION` are removed; the instruction templates carry the headings and the exclusion, and the independently authored test list remains the contract.
- The production build ships every colocated template through a `**/prompts/**/*.md` asset rule and the existing built-runtime contract renders one template per colocated directory from `dist`. Markdownlint and Prettier exempt each colocated `prompts/` directory by name, as they already exempt `apps/api/src/prompts/tools/`; `apps/api/src/prompts/chat-default.md` stays linted and formatted.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `context-injection`: producer item bodies are packaged, module-owned templates rendered at author time from the producer's own values; the prefix projections are never supplied to one; neutralization of untrusted text stays with the producer exactly as today; the envelope stays rail-owned.
- `model-system-prompts`: the full-current and transition summarization instructions and the title system and user prompts are packaged, module-owned templates; they are not configuration and are not receipted.
- `tool-calling`: the untrusted-output framing around tool results and the closed notices llame places inside results are packaged, module-owned templates; result content composed by tools, permissions, or truncation is not.
- `instance-config`: the prompt-file validation, allowlist, and escaping rules govern configured prompt files and the packaged defaults an operator may replace; packaged templates no configuration can replace are outside that requirement and are governed by the capability that renders them.

## Impact

- `apps/api/src/instance-config/prompt-loader.ts`: the Handlebars environment, compile cache, file read and normalization, and value-escaping helpers move to a shared engine module; the operator loader imports it and keeps its projection and validator. The cache is keyed by source and escape regime. Zero behavior change (#863).
- `apps/api/src/chats/`, `compaction/`, `titles/`, `knowledge/`, `skills/`, `tools/`: each `render*` function and text constant becomes a colocated `prompts/<surface>.md` plus one module-level constant and one render call (#864, three layers). `apps/api/src/instance-config/prompt-built-runtime.contract.ts` grows one import per colocated directory.
- `apps/api/nest-cli.json`: assets gain `**/prompts/**/*.md`; `.markdownlint-cli2.jsonc` gains one glob per colocated directory (`apps/api/src/chats/prompts/**`, `apps/api/src/compaction/prompts/**`, `apps/api/src/titles/prompts/**`, `apps/api/src/knowledge/prompts/**`, `apps/api/src/skills/prompts/**`, and `apps/api/src/tools/prompts/**`) and `.prettierignore` the same six in gitignore directory form (`apps/api/src/chats/prompts/` and so on).
- Tests: every existing exact-output assertion passes unmodified. Two sanctioned mechanical edits: `apps/api/src/compaction/compaction.test.ts` drops the import and identity assertion of the deleted heading constant; `apps/api/src/chats/context-item-producers.behavior.test.ts` replaces its `DIGEST_PRECEDENCE` import with the verbatim sentence, as `context-builder.test.ts` already does. The instructions and result notices gain literal, independently authored pins because their current tests compare the exported constant to itself; those pins replace the constant identity rather than adding coverage.
- Docs: `apps/api/AGENTS.md` records the authoring convention. No operator runbook changes; `docs/tool-prompts.md` is unaffected.
- Out of scope: operator overrides for any new surface (dropped from #228, closed as superseded); result content composed by tool implementations, the permission layer, and result truncation (error messages, permission rejections, settlement and truncation notices); the `renderToolObservationOmission` sentinel, which is parsed back by exact-bytes equality; closed reason-code label maps and the rail provenance constant, which stay in code as view values and rail identity; compaction storage (#806, #865); compaction request-path unification (#866).

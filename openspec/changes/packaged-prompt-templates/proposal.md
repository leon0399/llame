## Why

System prompts and llame-owned tool descriptions are packaged Handlebars files (`model-system-prompts`, `tool-prompt-templates`), but every other model-facing body is a TypeScript string: eleven context-item bodies, both compaction instructions, the title system prompt, and four untrusted-content notices. Prose that shapes model behavior is reviewed as string concatenation, has no single rendering path, and lives beside the code that schedules it rather than as the artifact a reviewer reads. Moving it to files now, while the per-producer wording is still settling, costs one byte-identical migration; each later producer would otherwise add another inline string. This proposal owns issue #862 and its layers #863 and #864.

## What Changes

- Every model-facing body in `apps/api` renders from a packaged, module-owned Handlebars `.md` file colocated with its producer, rendered through one shared engine. Rendered bytes are identical to today for every surface.
- Packaged templates are not configuration: no new key, no operator replacement, no boot-time validation, no probe. They compile without engine escaping; each producer keeps its existing neutralization of foreign values. The strict validator and its allowlist remain exactly for the two operator-overridable surfaces.
- The shared render context for packaged templates exposes only `model`, `context`, and admitted-tool predicates. Per-user personalization and per-chat digest values never reach a persisted-literal item or a summarization instruction.
- The rail envelope and provenance line stay rail-owned; templates are body-only. Each producer's precedence and framing sentences stay in that producer's template, as `context-injection` already requires.
- `COMPACTION_SECTION_HEADINGS` and its derived Markdown block are removed; the instruction template carries the headings and the independently authored test list remains the contract.
- The production build ships every colocated template; the worker renders from built output without the source tree.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `context-injection`: producer item bodies are packaged, module-owned templates rendered at author time from a core-only context; owner personalization and chat digest values are never rendered into a persisted-literal item; neutralization stays with the producer; the envelope stays rail-owned.
- `model-system-prompts`: the full-current and transition summarization instructions and the title system prompt are packaged, module-owned templates rendered from the same core-only context; they are not configuration and are not receipted.
- `instance-config`: the prompt-file validation, allowlist, and escaping rules govern configured prompt files and the packaged defaults an operator may replace; packaged templates no configuration can replace are outside that requirement.

## Impact

- `apps/api/src/instance-config/prompt-loader.ts`: the Handlebars environment, compile cache, file read and normalization, value escaping, and core-scope projection move to a shared engine module; the operator loader imports it. Zero behavior change (#863).
- `apps/api/src/chats/`, `compaction/`, `titles/`, `knowledge/`, `skills/`: each `render*` function and text constant becomes a colocated `prompts/<surface>.md` plus one module-level constant and one render call (#864, three layers).
- `apps/api/nest-cli.json`: assets glob widens from `prompts/**/*.md` to `**/*.md`.
- Tests: every existing exact-output test in the touched modules passes unmodified; that is the acceptance gate, not new coverage.
- Docs: `apps/api/AGENTS.md` records the authoring convention. No operator runbook changes; `docs/tool-prompts.md` is unaffected.
- Out of scope: operator overrides for any new surface (dropped from #228, closed as superseded), the `renderToolObservationOmission` sentinel and tool-result error strings, compaction storage (#806, #865), and compaction request-path unification (#866).

## Why

llame tells the model nothing about when "now" is. `apps/api/src/prompts/chat-default.md` contains no date, and `PROMPT_CONTEXT_PATHS` exposes no temporal path, so nothing in request assembly carries a clock. Three costs follow: relative expressions ("tomorrow", "how long ago") have no anchor and are answered from the training cutoff — wrong by construction and confidently so; absolute dates already in context are uninterpretable, which guts the shipped recency digest, whose per-entry `Last activity` dates cannot be placed without a reference point; and temporal planning degrades wherever sequencing or deadlines matter.

The naive fix — a live timestamp at the top of the system prompt — is worse than the problem: it changes every request, forfeiting prefix caching for the entire conversation. This change takes the affordable half: a value frozen for the life of a chat, honest about being frozen.

## What Changes

- **New renderable context namespace `context`**, exposing exactly two always-present scalar paths: `context.systemTime` (an absolute, offset-bearing timestamp) and `context.systemTimezone` (its IANA zone identifier).
- **The anchor instant is derived, not stored.** It is the chat's most recent compaction time, falling back to the chat's creation time. No migration, and no second source of truth that can drift from the compaction row that is supposed to drive it.
- **Lifecycle matches the recency digest exactly**: frozen per chat, re-resolved only at compaction. A model switch SHALL NOT refresh it — a switch is a provider boundary, not a context boundary, and moving the anchor there would change what the assistant believes about time as a side effect of an unrelated action.
- **`context` is unconditional — the first namespace that is.** `user` and `chats` are absent for some owners and are therefore gate-only subjects; the anchor is always computable, so it is always projected. A bare `{{#if context}}` is consequently rejected at boot as an unsupported construct, telling the operator the guard is unnecessary rather than silently compiling an always-true branch.
- **Rendering is server-local, not UTC.** Time is formatted in the instance's own timezone with an explicit IANA label and a numeric UTC offset. The offset is not decoration: it removes the model's dependency on carrying a timezone database and that date's DST rules, which is precisely where small models fail.
- **The packaged default prompt gains a start-framed line.** Phrasing states when the conversation began rather than asserting the present instant, so minute precision stays true indefinitely instead of rotting into a confident lie.
- **BREAKING (internal only)**: `renderSystemPromptTemplate` and `SystemPromptsService.render` take the anchor as a **required** parameter. Making it required is what enforces "always provided" structurally rather than by comment — the same discipline by which `resolveEffectiveContext` takes an already-rendered prompt to enforce "render, then hash". No operator-facing break: a prompt referencing no temporal path renders exactly as it does today.
- **`chats.compiledOn` is retained unchanged.** It records when the digest was compiled, which is a different instant from when the conversation began. This change makes it interpretable rather than replacing it.

## Capabilities

### New Capabilities

- `temporal-anchor`: what the anchor value means and how it behaves — its derivation from compaction/creation time, its frozen-until-compaction lifecycle, its server-local timezone basis and offset-bearing format, the requirement that rendered phrasing never assert the present instant, and the byte-stability guarantee that keeps snapshot reuse and prefix caching intact.

### Modified Capabilities

- `model-system-prompts`: the renderable allowlist gains `context.systemTime` and `context.systemTimezone`; the projection gains its first **unconditional** namespace, which the existing omission discipline (absent-or-empty values are dropped so conditionals over them behave) does not describe; and the boot-probe rule needs stating — the anchor adds no dimension to the existing `user` × `chats` cross product precisely because it cannot be absent, but every probe must now supply it.

## Impact

- **Code**: `apps/api/src/instance-config/prompt-loader.ts` (allowlist, projection, boot probe, render signature), `apps/api/src/system-prompts/system-prompts.service.ts` (required parameter), `apps/api/src/chats/chat-loop.service.ts` (derive the instant from the compaction already read in `buildTurnContextAndParts`), `apps/api/src/prompts/chat-default.md` (packaged default line).
- **Call sites**: the required parameter reaches every existing caller — `prompt-loader.test.ts`, `config-loader.test.ts`, `chat-default.test.ts`, `compaction-context.integration.test.ts`, and `prompt-built-runtime.contract.ts`. Mechanical, but most of the diff's line count.
- **No database changes.** No migration, no schema edit, no coordinated API/worker revision boundary.
- **Runtime**: one `Intl.DateTimeFormat` call per render. Node 22 ships full ICU, verified to produce correct offsets including half-hour zones.
- **Out of scope, tracked separately**: stored user timezone as a second reading (#454), request-derived timezone and GeoIP as a third (#455), and per-turn send-time stamping on the reminder rail (#408, blocked by this change and inheriting its format and timezone convention).

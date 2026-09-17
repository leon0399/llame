## Why

`createModelClient` decides which OpenAI **API surface** to talk to from the
operator-chosen provider _name_ (`nativeOpenAI: provider.id === 'openai'`). The
id is free-form and duplicable, so a label chosen for readability silently
changes which HTTP endpoint llame calls: a compatible endpoint named `openai` is
sent to `/responses`, while real OpenAI under any other name drops to Chat
Completions — where `@ai-sdk/openai` has no reasoning concept at all and
discards reasoning content parts outbound. This change delivers issue #339 at
layer L1 and issue #883 at layer L2 as one linear stack, and supersedes PR #648,
which folded #883's reasoning-part work into the same OpenAI split and is
`CONFLICTING` against `master`.

## What Changes

- Split the type. `type: "openai"` means the official OpenAI API on the
  **Responses** surface, where a `baseUrl` names a proxy in front of OpenAI
  rather than another vendor; a new `type: "openai-compatible"` means the
  **Chat Completions** surface at the operator's endpoint. `type` alone selects
  the surface: no host matching, no boot validation that a base URL "looks
  like" OpenAI, no reinterpretation of an existing configuration, and no
  warning.
- **BREAKING**: an existing `type: "openai"` provider whose `id` is not
  literally `openai` reaches Chat Completions today and reaches Responses after
  this change. Operators pointing an `openai` entry at a compatible endpoint
  must declare it as `type: "openai-compatible"`. There is no shim, no
  migration, and no warning.
- Delete `nativeOpenAI` and the `provider.id === 'openai'` check outright and
  route by `type`, always. The Codex transport, which used the deleted flag,
  stays on the Responses surface by construction (closes #339 in L1).
- Add `@ai-sdk/openai-compatible@2.0.75`, the newest release on the
  repository's v3 specification line, and a client for the new type. That
  adapter extracts `reasoning_content ?? reasoning` inbound and re-injects
  reasoning outbound on assistant messages, so reasoning becomes reachable on
  compatible backends without a llame-authored vendor parser, raw SSE parser,
  or tag extraction. Pass `supportsStructuredOutputs: true` at construction:
  its default silently degrades a JSON-schema response format to unconstrained
  `json_object`.
- Amend `reasoning-output`'s "Third-party compatibility remains best-effort"
  requirement: its clause that third-party compatible endpoints "SHALL remain
  on their existing execution path" is contradicted by the runtime adoption and
  is replaced, while its prohibition on llame-authored reasoning parsers is
  preserved.
- Reasoning parts (closes #883 in L2): when the adapter supplies a reasoning
  part id, each distinct id persists as its own `{ type: "reasoning" }` part,
  and adapters that supply none stay a single concatenated part; a heading glued
  onto a previous part is separated by a paragraph break at persist, render, and
  markdown export, including for reasoning persisted before part ids existed;
  consecutive persisted reasoning parts share one Thinking panel, with a tool or
  visible text part splitting panels so occurrence order is preserved; and the
  reasoning bound applies across the turn's reasoning instead of per part.
- Durable provider metadata on reasoning parts — the resolved half of #883 that
  this change owns: a reasoning part MAY carry opaque provider metadata, which
  persists with the part in the chat's message parts and is replayed to the
  provider on later requests for the same Chat, while never being rendered,
  exported, indexed, or included in a public share. No model-switch coercion
  rule is added: the provider drops or ignores blocks the target model cannot
  read, so llame passes them back unchanged.
- Documentation and changelog: the support matrix in `apps/api/AGENTS.md` beside
  the provider/model config contract, the operator-facing surface behavior in
  the README provider section, and a CHANGELOG entry carrying the breaking
  note. Both have been missing since #219.
- Verification gate: reasoning on the compatible path is accepted only after a
  bounded live smoke proves its request shape, its normalized stream output, and
  that a later request within the same turn carries the reasoning the adapter
  produced back to the backend — the outbound half a mock cannot prove. The
  smoke runs against a directly-billed reasoning-capable compatible endpoint.

## Capabilities

### New Capabilities

- `openai-provider-surfaces`: which OpenAI API surface a provider talks to —
  surface selection by `type` alone, reasoning normalization on both surfaces,
  and schema-constrained output that is not silently downgraded.

### Modified Capabilities

- `instance-config`: the provider-list requirement — the `type` enum split into
  `openai` and `openai-compatible`, the compatible variant shape, and the
  rebased duplicable-providers example.
- `reasoning-output`: the third-party compatibility amendment; reasoning part
  identity; the durable provider-metadata channel; distinct markdown blocks for
  glued summary headings; Thinking-panel grouping; the per-turn reasoning
  bound; the amended privacy requirements; and the compatible-surface evidence
  gate.

`available-models` is deliberately not modified. Its dispatch requirement
("Provider execution resolves through the configured provider") asserts that a
model client is selected by the provider's `type` and that an unrecognized
resolved type is an internal error rather than a fallback — still true after
this change; its `(this slice: openai → …)` parenthetical is slice scoping, not
an enumeration, and the surface each `type` now selects is specified by
`openai-provider-surfaces`. The precedent is direct: the `openai-codex` provider
change also added a provider type and amended `instance-config` only, leaving
`available-models` untouched.

## Non-goals

- Per-user BYOK (#37, #18): the credential stays an operator-level
  `providers[].key`.
- The Anthropic and `anthropic-compatible` adapters (#208). They ship in the
  sibling `anthropic-provider` change, which merges after this one and rebases
  its `instance-config` delta onto this change's merged wording.
- OpenRouter (#82), which explicitly refuses the generic compatible path.
- The AI SDK v4 specification-line migration (#882).
- OpenCode Go and Zen (#809, #808), both parked. The unfinished
  `openspec/changes/opencode-go-provider/` change is untouched by this work and
  must not be completed, staged, or deleted here.
- Tool-loop usage and cost accounting (#810); the effort-change
  cache-invalidation warning (#593); the unified compaction request path
  (#866).
- Producing provider metadata: this change owns the channel, its persistence,
  and its replay, not a producer and not provider-specific metadata semantics;
  the `anthropic-provider` change is the first producer.
- Model-switch coercion: the provider ignores or drops blocks the target model
  cannot read, so llame passes them back unchanged.
- Prefix rebinding and append-only message construction: the mitigation for a
  rewritten prefix belongs to the `anthropic-provider` change.

## Dependencies and delivery order

- Delivery stacks in branch order: `openai-compatible-provider/proposal`, then
  `/types`, `/reasoning-parts`, and `/finalize`. L1 (`/types`) closes #339; L2
  (`/reasoning-parts`) closes #883; `/finalize` syncs specs and archives and
  closes no issue.
- The sibling `anthropic-provider` change depends on this one: it expects the
  `openai` / `openai-compatible` split, the `@ai-sdk/provider` 3.0.15 → 3.0.16
  and `@ai-sdk/provider-utils` 4.0.46 → 4.0.51 bump, and no duplicate of either.
  Whichever change merges first owns the dependency bump.

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`providerType` enum,
  provider entry variants) and `apps/api/src/instance-config/llame-config.ts`
  (`ProviderConfig` union and loader normalization).
- `apps/api/src/models/model-client-factory.ts` (drop the id check, dispatch by
  `type`), `apps/api/src/models/openai-model-client.ts` (surface passed
  explicitly instead of `nativeOpenAI`), a client for the compatible type, and
  `apps/api/src/models/openai-codex-model-client.ts` (Responses by
  construction).
- `apps/api/package.json` and the lockfile (one new dependency).
- Reasoning parts: `apps/api/src/runs/assistant-transcript.ts` (per-part
  persistence, glue repair, per-turn bound),
  `apps/api/src/runs/run-execution.service.ts` and
  `apps/api/src/runs/run-stream-bridge.ts` (streamed reasoning parts), the
  persisted assistant message, and the web chat's reasoning rendering and
  markdown export.
- Focused configuration, dispatch, and reasoning tests; one bounded live proof;
  `apps/api/AGENTS.md`, the README provider section, and `CHANGELOG.md`.
- No database migration, no `models[]` schema change, and no new provider
  configuration surface beyond the added type.

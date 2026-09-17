## Why

`createModelClient` decides which OpenAI **wire API** a provider talks to
from the operator-chosen provider _name_ (`nativeOpenAI: provider.id ===
'openai'`, `model-client-factory.ts:68`). The id is free-form and duplicable,
so a label chosen for readability silently changes the HTTP endpoint llame
calls: a Chat Completions endpoint named `openai` is sent to `/responses`,
and real OpenAI under any other name drops to `openai.chat()`, where
`@ai-sdk/openai` has no reasoning concept at all and drops reasoning parts
outbound. Reasoning is therefore unreachable on every compatible endpoint
today.

Reasoning parts also persist without identity or provider metadata.
`openai-model-client.ts:300` forwards only `chunk.text`, discarding the part
id and the `itemId` / `reasoningEncryptedContent` metadata the Responses
path already returns whenever `store: false` is set, which the Codex client
sets unconditionally. Headed summaries glue into a `****` run, and a signed
or encrypted reasoning block cannot survive a worker restart.

This change delivers issue #339 at layer L1 and issue #883 at layers L2 and
L3 as one linear stack, and supersedes PR #648, which built #883's
part-identity work against the still-conflated dispatch and is `DIRTY`
against `master`. #648's identity rule is adopted here verbatim.

## What Changes

- **BREAKING: provider types name the wire API they speak.** `type:
"openai"` is deleted. `type: "openai-responses"` executes the Responses
  wire through `@ai-sdk/openai` at the entry's `baseUrl` (default
  `https://api.openai.com/v1`); `type: "openai-completions"` executes the
  Chat Completions wire through `@ai-sdk/openai-compatible` at the entry's
  required `baseUrl`. `openai-codex` is unchanged. This follows omp's `api`
  field (`openai-responses`, `openai-completions`, `openai-codex-responses`)
  and the AI SDK's own `.responses()` / `.chat()` split. `type` alone selects
  the wire: nothing is inferred from `id`, `baseUrl`, or host; nothing is
  rewritten at load time; an entry pointed at an endpoint that does not
  serve its declared wire fails at request time under the existing failure
  contract, never at boot. Every existing `type: "openai"` entry must be
  re-declared; there is no shim or migration.
- Delete `nativeOpenAI` and the `provider.id === 'openai'` check; the
  factory dispatches on `type` only, and every request an entry makes —
  streaming chat, forced-tool structured generation, compaction — uses the
  entry's declared wire. `generateToolBoundObject`'s hardcoded
  `openai.chat()` goes away with it. The Codex transport stays on Responses
  by construction. Closes #339 in L1.
- Add `@ai-sdk/openai-compatible@2.0.75`, the newest release on the
  repository's v3 specification line, and an `openai-completions` client.
  The adapter extracts `reasoning_content ?? reasoning` inbound and
  re-injects `reasoning_content` outbound on assistant messages, so
  reasoning becomes reachable on compatible backends with no llame-authored
  vendor parser, raw SSE parser, or tag extraction. Structured output stays
  the existing forced-tool-call path on both wires; the adapter's
  `supportsStructuredOutputs` option is left at its default because llame
  never sends a JSON-schema response format.
- Replay persisted reasoning text to the same Chat's later requests (L1).
  DeepSeek returns 400 when a request carries `tools` and any earlier
  assistant turn's `reasoning_content` is missing, and llame sends tools on
  every chat request, so the completions wire does not work past a chat's
  first turn without it. `context-builder.ts` gains a reasoning replay path
  — reversing its documented "never re-fed" invariant for this one reuse —
  and the Chat Completions adapter carries the text as `reasoning_content`.
  On the Responses wire a part is replayed only when it carries an `itemId`
  or encrypted content; the SDK skips the rest with a warning.
- Embedding model entries may reference either OpenAI wire type. The
  `/v1/embeddings` call is wire-independent, and refusing `openai-completions`
  would force a duplicate provider entry at the same `baseUrl` for exactly
  the local-model operator this change serves.
- Retype the shipped `apps/api/llame.config.json.example` entries (the
  commented `ollama` entry is the exact breaking pattern) and the E2E
  provider fixture `e2e/support/fixtures/llame.config.e2e.json`, whose mock
  server speaks Chat Completions only and would flip to Responses the moment
  the id check is deleted.
- Amend `reasoning-output`'s "Third-party compatibility remains best-effort"
  requirement: its clause that third-party endpoints "SHALL remain on their
  existing execution path" is replaced, while its prohibition on
  llame-authored reasoning parsers is preserved. Reasoning normalization on
  every wire is specified in `reasoning-output`, not in the new capability.
- Reasoning part identity (L2, from PR #648): a new persisted part starts
  when a text, tool, or other non-reasoning part intervenes, or when the
  adapter-supplied part id and the open part's id are both defined and
  differ. OpenAI Responses supplies `${itemId}:${summaryIndex}`, so each
  summary is its own part; `@ai-sdk/openai-compatible` supplies the constant
  `reasoning-0`, so a turn's uninterrupted reasoning stays one part. No
  boundary is invented for a transition no adapter emits.
- Glue repair (L2) happens at render and markdown export only. A heading
  glued onto the text before it (`**One****Two**`, or prose butting onto
  `**Heading**` that closes its line) is separated by a paragraph break when
  displayed or exported; mid-sentence emphasis after whitespace stays inline.
  Markdown export separates consecutive reasoning parts with a blank line
  instead of today's single newline. Persisted reasoning text is never
  rewritten: it is the text the provider signed or encrypted, and it is
  replayed byte-identically.
- Consecutive persisted reasoning parts share one Thinking panel (L2); a
  tool or visible text part splits panels so occurrence order is preserved.
- Delete `REASONING_PERSIST_MAX` (L2). It is already per-part today, so it
  bounds nothing a multi-part turn cares about, and truncating a block the
  provider signed invalidates that block on replay. `assistantParts()`, the
  unused one-part-per-turn helper, is deleted with it.
- Durable provider metadata on reasoning parts (L3): a reasoning part MAY
  carry opaque provider metadata; it persists with the part in
  `messages.parts`, is replayed with the part on later requests for the same
  Chat, and is never rendered, exported, indexed, or included in a public
  share. The first producer is the Responses path (`itemId`,
  `reasoningEncryptedContent`, read from the `reasoning-start` / `reasoning-end`
  stream parts, which `onChunk` never delivers); the Codex provider's
  "encrypted reasoning and reasoning-item identifiers SHALL remain transient"
  clause is amended accordingly. Closes #883 in L3.
- Documentation and changelog: the wire matrix in `apps/api/AGENTS.md`
  beside the provider/model config contract, the operator-facing behavior in
  the README provider section, and a CHANGELOG entry carrying the breaking
  note. Both have been missing since #219.
- Verification gate: reasoning on the completions wire is accepted only
  after a bounded live smoke proves its request shape, its normalized stream
  output, and that a later request within the same turn carries the
  reasoning the adapter produced back to the backend. The smoke runs against
  a directly-billed reasoning-capable Chat Completions endpoint.

## Capabilities

### New Capabilities

- `provider-api-selection`: the provider's `type` selects the wire API for
  every request that entry makes; nothing is inferred from `id`, `baseUrl`,
  or host; mismatches fail at request time.

### Modified Capabilities

- `instance-config`: the provider-list requirement — the `type` enum becomes
  `openai-responses` / `openai-completions` / `openai-codex`, the variant
  shapes, and the rebased examples; the embedding-catalog requirement —
  either OpenAI wire type may back embeddings.
- `available-models`: the dispatch requirement's parenthetical and its
  routing scenario name the retired `openai` type and "the OpenAI-compatible
  client"; both are restated against the wire types.
- `reasoning-output`: the third-party amendment; reasoning normalization on
  every wire; part identity; the durable provider-metadata channel; glue
  repair at render and export; Thinking-panel grouping; the amended privacy
  requirements; the completions-wire evidence gate.
- `subscription-access-openai-codex`: the "Preserve llame execution
  semantics" requirement no longer forbids persisting reasoning-item
  identifiers and encrypted reasoning; they become the durable provider
  metadata `reasoning-output` defines, under the same never-rendered,
  never-exported, never-indexed, never-shared boundary.
- `tool-calling` and `context-injection`: one requirement each asserts that
  persisted reasoning and provider metadata never replay. Both are amended
  so the tool projection stays free of provider reasoning and metadata while
  reasoning replay is governed by `reasoning-output` alone; every scenario
  name is kept.

## Non-goals

- Per-user BYOK (#37, #18): the credential stays an operator-level
  `providers[].key`.
- The Anthropic and `anthropic-compatible` adapters (#208). They ship in the
  sibling `anthropic-provider` change, which merges after this one and
  rebases its `instance-config` delta onto this change's merged wording and
  type names.
- OpenRouter (#82), which explicitly refuses the generic compatible path.
- The AI SDK v4 specification-line migration (#882). Pinning one more
  v3-line adapter enlarges that migration by one package; accepted.
- OpenCode Go and Zen (#809, #808), both parked. The unfinished
  `openspec/changes/opencode-go-provider/` change is untouched by this work
  and must not be completed, staged, or deleted here.
- Tool-loop usage and cost accounting (#810); the effort-change
  cache-invalidation warning (#593); the unified compaction request path
  (#866).
- Provider-specific metadata semantics: this change owns the channel, its
  persistence, and its replay, plus the Responses producer that already
  exists. It does not interpret the metadata.
- Model-switch coercion: the provider ignores or drops blocks the target
  model cannot read, so llame passes them back unchanged.
- Prefix rebinding and append-only message construction: the mitigation for
  a rewritten prefix belongs to the `anthropic-provider` change.
- A per-model wire override. One `baseUrl` is one server; a mixed proxy such
  as LiteLLM that serves Responses for some models and Chat Completions for
  others is declared twice. This is the known ceiling.
- Any boot-time diagnostic. None is added; none is forbidden.

## Dependencies and delivery order

- Delivery stacks in branch order: `openai-compatible-provider/proposal`,
  then `/types`, `/reasoning-parts`, `/reasoning-metadata`, and `/finalize`.
  L1 (`/types`) closes #339; L3 (`/reasoning-metadata`) closes #883;
  `/finalize` syncs specs and archives and closes no issue.
- Issue #339's title and body are amended before L1 publishes: the
  endpoint-derivation direction is rejected in favour of wire-named types,
  and its acceptance list is restated against them.
- The sibling `anthropic-provider` change (PR #885) depends on this one: it
  must adopt the `openai-responses` / `openai-completions` names, reproduce
  this change's two added `instance-config` scenarios in its own delta, and expect
  the `@ai-sdk/provider` 3.0.15 → 3.0.16 and `@ai-sdk/provider-utils`
  4.0.46 → 4.0.51 bump with no duplicate of either. Whichever change merges
  first owns the bump.

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`providerType`
  enum, provider entry variants), `apps/api/src/instance-config/llame-config.ts`
  (`ProviderConfig` union), and `apps/api/src/instance-config/config-loader.ts`
  (loader normalization; the embedding gate at `:1524`).
- `apps/api/src/models/model-client-factory.ts` (drop the id check, dispatch
  by `type`), `apps/api/src/models/openai-model-client.ts` (Responses client;
  `generateToolBoundObject` on the declared wire), a new
  `openai-completions` client, `apps/api/src/models/openai-codex-model-client.ts`
  (Responses by construction), and `apps/api/src/models/model-client.ts`
  (`onReasoningDelta` carries the part id and provider metadata).
- `apps/api/package.json` and the lockfile (one new dependency; a second
  resolved `@ai-sdk/provider` / `@ai-sdk/provider-utils` pair).
- `apps/api/llame.config.json.example`, `e2e/support/fixtures/llame.config.e2e.json`.
- Reasoning parts: `apps/api/src/runs/assistant-transcript.ts` (identity
  rule, cap and `assistantParts()` deleted, metadata on the part),
  `apps/api/src/runs/run-execution.service.ts` and
  `apps/api/src/runs/run-stream-bridge.ts` (part id and metadata through the
  event stream), `apps/api/src/chats/context-builder.ts` (reasoning replay
  with `providerOptions`), the web chat's reasoning rendering and grouping,
  `packages/ui` reasoning content, and `apps/web/lib/services/chat/chat-markdown.ts`.
- Focused configuration, dispatch, and reasoning tests; one bounded live
  proof; `apps/api/AGENTS.md`, the README provider section, and
  `CHANGELOG.md`.
- No database migration and no `models[]` schema change. `messages.parts`
  is untyped `jsonb`; the metadata field rides in the existing column.

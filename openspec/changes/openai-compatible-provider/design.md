## Context

See [proposal.md](proposal.md) for motivation and scope; the delta specs
under `specs/` are the behavior contract this design implements.

Today `providers[]` is discriminated by `type` and the schema's
`$defs.providerType` enum is strict-closed to `["openai", "openai-codex"]`
(`llame.config.schema.json:77-81`). `llame-config.ts:28-40` normalizes
entries into `OpenAIProviderConfig { id, type, key, baseUrl }` and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `model-client-factory.ts:42-68` switches on `provider.type`
with a `never` exhaustiveness default, and its `openai` case derives
`nativeOpenAI: provider.id === 'openai'`; `openai-model-client.ts:283-285`
selects `openai(model)` (Responses, with `reasoningSummary: 'auto'` at
`:256`) versus `openai.chat(model)` from that flag, while
`generateToolBoundObject` (`:318-329`) hardcodes `openai.chat()` for
structured generation on every provider. The Codex client builds the
Responses path with `nativeOpenAI: true` and `storeResponses: false`
(`openai-codex-model-client.ts:67,76`). `type` is already the dispatch
mechanism; only the wire within the `openai` case is inferred from an id.

Reasoning today: `AssistantPartCollectorImpl.reasoning()`
(`assistant-transcript.ts:101-109`) appends to the last part when it is a
reasoning part and otherwise pushes a new one, so a turn whose reasoning is
interrupted by a tool call already persists several reasoning parts.
`parts():137-158` truncates each reasoning part independently at
`REASONING_PERSIST_MAX` (24,000 characters), so a multi-part turn is already
bounded per part, not per turn. `assistantParts():414-441`, which does build
one concatenated part per turn, has no production caller. The web chat
renders one `Reasoning` panel per part (`chat-message-row.tsx`), markdown
export joins reasoning parts with a single newline (`chat-markdown.ts:14-28`)
— which is why a glued `**One****Two**` run survives into the export — and
`onReasoningDelta` is typed `(text: string) => void` (`model-client.ts:78`),
so the AI SDK's per-chunk reasoning id and `providerMetadata` are dropped at
`openai-model-client.ts:300`. `context-builder.ts:57-60` documents reasoning
as "PERSISTED for display … but NEVER re-fed to the model", and
`appendAssistantMessage:448-469` builds every assistant `ModelMessage` from
`partsToText` or tool observations only. `messages.parts` is untyped `jsonb`
(`db/schema/chats.ts:219`) with no part validator.

Embedding models are a separate path: `openai-embedding-backend.ts` builds
its own OpenAI client from the provider entry's `key`/`baseUrl`, and
`config-loader.ts:1524` gates embedding bindings to `provider.type ===
'openai'`. The installed AI SDK is `@ai-sdk/provider@3.0.15` /
`@ai-sdk/provider-utils@4.0.46`, exact-pinned by `ai@6.0.256`,
`@ai-sdk/openai@3.0.97`, `@ai-sdk/gateway`, `@ai-sdk/mcp`, and
`@ai-sdk/react`.

Prior art consulted for the wire decision: omp's `models.yml` separates
provider identity from wire protocol with an `api` field
(`openai-completions`, `openai-responses`, `openai-codex-responses`,
`anthropic-messages`, …) and routes its implicit `ollama` and `llama.cpp`
providers as `openai-responses`, LM Studio as `openai-completions`, and
LiteLLM per model. The AI SDK's OpenAI provider page documents `.responses()`
/ `.chat()` / `.completion()` on one package, a custom `baseURL` as ordinary
for Responses, and `forceReasoning` for "stealth reasoning models via a
custom baseURL". PR #648 carries the reasoning identity rule this design
adopts and the Hermes references it was ported from.

The sibling `anthropic-provider` change (PR #885) depends on this one. Its
design quotes the two shipped `reasoning-output` privacy requirements in its
D7 and expects this change to introduce the per-part provider-metadata
channel; its `instance-config` delta was written against this change's
earlier `openai` / `openai-compatible` wording and must be rebased onto the
wire-named types and this change's added scenario before it archives.

## Goals / Non-Goals

Goals:

- One declared wire per provider `type`, named after the wire, with no
  inference from `id`, `baseUrl`, or host and no rewriting of an entry.
- Every request an entry makes uses its declared wire, including structured
  generation and compaction.
- One client per wire under the existing `ModelClient` seam, with the Codex
  transport still on Responses by construction.
- Reasoning reachable on Chat Completions backends through the adapter's own
  normalization, with no llame-authored vendor handling.
- Reasoning parts with #648's identity rule, unglued display, grouped
  panels, no truncation, and durable provider metadata that is replayed
  byte-identically, with the Responses path as the first producer.
- Documentation that states which wire each type uses and where reasoning
  renders.

Non-goals:

- Interpreting provider metadata, model-switch coercion, prefix rebinding, or
  append-only message construction (see Risks; the mitigation belongs to
  `anthropic-provider`).
- A per-model wire override; a boot-time diagnostic; changing `models[]`,
  the run lifecycle, or cost accounting.
- The v4 AI SDK specification line (#882), the Anthropic adapters (#208),
  OpenRouter (#82), OpenCode Go/Zen (#808, #809), BYOK (#37, #18), tool-loop
  usage and cost accounting (#810), the effort-change cache warning (#593),
  and the unified compaction request path (#866).

## Decisions

### D1: Name the wire; never infer it

`type: "openai-responses"` executes the Responses wire through
`@ai-sdk/openai` at the entry's `baseUrl` (default OpenAI);
`type: "openai-completions"` executes the Chat Completions wire through
`@ai-sdk/openai-compatible` at the entry's required `baseUrl`. `type:
"openai"` is deleted. `nativeOpenAI` and the id check are deleted; the
factory routes by `type`, and the wire is a property of the client, not a
flag. Rationale: the id is free-form and duplicable, so an id-dependent wire
makes a readability choice silently change the endpoint — the bug #219
shipped. Naming the wire in the type makes the configuration answer the
question this issue is about by reading it, matches omp's `api` vocabulary
and the AI SDK's method names, and removes the need to explain what a bare
`openai` means.

The AI SDK fixes the matrix: `@ai-sdk/openai`'s Responses path has
reasoning summaries and encrypted reasoning; its Chat Completions path takes
reasoning request options but has no reasoning content, inbound or outbound; `@ai-sdk/openai-compatible` is Chat Completions only, with
`reasoning_content` in and out. Two of the four cells are dead, so two types
are the right count. What the type does not encode is the vendor: an
`openai-responses` entry may point at Ollama ≥ 0.13.3, vLLM, llama.cpp, or a
proxy, exactly as omp does; whether that server tolerates the fields llame
sends (`reasoningSummary: 'auto'`, `store`) is the operator's call and
surfaces at request time. Known ceiling on that cell: `@ai-sdk/openai`
recognizes reasoning models by id (`o*`, `gpt-5*` except `-chat`), so for a
local model id it drops `reasoning.effort` / `reasoning.summary` with a
warning and never requests encrypted content unless `forceReasoning: true`
is passed (`openai-responses-language-model.ts:178,351-368,411-416`). llame
does not set it in this change; the trigger is a real local Responses
deployment, and the natural hook is the catalog entry's `reasoning` object.

`@ai-sdk/open-responses` (1.0.42 on the v3 line, same provider/utils pair) is
the SDK's generic client for the openresponses.org spec and its docs
recommend it for self-hosted `/v1/responses` servers. It is not adopted here:
it passes effort/summary through for any model id, but its assistant-message
conversion handles only `text` and `tool-call`
(`convert-to-open-responses-input.ts:129-160`), so it never replays
reasoning, and its reasoning stream parts carry no item metadata
(`open-responses-language-model.ts:436-464`). For a local reasoning model it
therefore offers less than `openai-completions`, which replays
`reasoning_content`. If a local Responses server ever rejects
`@ai-sdk/openai`'s OpenAI-specific fields, it becomes a third type
(`open-responses`), not a change to these two.

Rejected: deriving the wire from the endpoint (the direction the original
issue proposed) — a host rule deciding the protocol is the same class of
invisible inference this change removes; a separate `surface` field on a
kept `openai` type — it would offer two dead combinations and keep the
ambiguous name; keeping `type: "openai"` as an alias for one wire — the
name is the ambiguity; a per-model wire override — one `baseUrl` is one
server, and a mixed LiteLLM proxy is declared twice (known ceiling).

**BREAKING.** Every existing `type: "openai"` entry fails boot as an
out-of-enum type until re-declared. There is no shim and no migration.

### D2: Configuration posture stays operator-owned

Boot validates shape only. It does not judge whether a `baseUrl` serves the
wire its `type` names, does not migrate or reinterpret an entry, and never
fails boot on a stale but well-formed entry; a mismatch surfaces on the
first request under the existing failure contract. Rationale: llame cannot
know every gateway's host or path layout, and a heuristic that is wrong
either blocks a working endpoint or reassures an operator about a broken
one — consistent with the existing posture that credentials and
reachability are never prevalidated at boot. No diagnostic is added; none is
prohibited, so a later `config check` that prints declared wires is not
foreclosed by spec text. Rejected: host allow-lists, boot warnings that
encode vendor knowledge llame does not own, and a spec clause banning
diagnostics outright.

### D3: Pin `@ai-sdk/openai-compatible@2.0.75`

It is the newest release on llame's v3 specification line (`ai-v6` dist-tag;
`3.x` moves to `@ai-sdk/provider@4`) and declares `@ai-sdk/provider@3.0.16` /
`@ai-sdk/provider-utils@4.0.51`, the same pair `@ai-sdk/anthropic@3.0.118` in
the sibling change declares. The result is not convergence: `ai@6.0.256`,
`@ai-sdk/openai@3.0.97`, `@ai-sdk/gateway`, `@ai-sdk/mcp`, and
and `@ai-sdk/mcp` exact-pin both 3.0.15 and 4.0.46, and `@ai-sdk/react`
pins provider-utils 4.0.46, so the lockfile carries both pairs. Accepted because the AI SDK's error classes use symbol-based
`isInstance()` markers and `apps/api/src` has no `instanceof` against
`@ai-sdk/provider` classes; the types layer verifies the resolved lockfile
rather than assuming. No zod change: all three peer on `^3.25.76 || ^4.1.8`,
and llame resolves 3.25.76 and 4.6.5 for them (a third resolution, 4.4.3,
belongs to `knip` alone). Rejected: the v4 line (#882) and an
unpinned range.

### D4: Structured output stays a forced tool call on both wires

llame never sends a JSON-schema response format. `generateToolBoundObject`
uses `generateText` with a forced `tool_choice`, chosen over
`response_format: json_schema` because tool calling is more widely
implemented across compatible backends (`openai-model-client.ts:310-317`).
Forced tool choice and `strict` tool schemas are identical between
`@ai-sdk/openai` and `@ai-sdk/openai-compatible`, so the path carries over;
`supportsStructuredOutputs` is left at its default because its only effect
is on a request llame does not make. The one change is that the helper's
hardcoded `openai.chat()` is replaced by the entry's declared wire, so an
`openai-responses` provider's title generation runs on Responses (D1: every
request follows the type). Known trap from omp's compat table: DeepSeek
rejects `tool_choice` while reasoning is on; `title.service.ts` already
catches the failure and falls back to free text. Rejected: a
`supportsStructuredOutputs` construction flag and a spec requirement for a
JSON-schema path that does not exist.

### D5: Reasoning on the completions wire comes from the adapter

`@ai-sdk/openai-compatible` extracts `reasoning_content ?? reasoning`
inbound (`openai-compatible-chat-language-model.ts:314-315,557`) and
re-injects `reasoning_content` outbound on assistant messages
(`convert-to-openai-compatible-chat-messages.ts:206`). `@ai-sdk/openai`'s
chat path has none of this: its assistant-message conversion switches only
on `text` and `tool-call`, its response assembly pushes only `text`,
`tool-call`, and `source`, and the package has zero occurrences of
`reasoning_content`. (This corrects the original issue body's claim that
upstream "hardcodes `reasoning: void 0`": it is a structural omission, which
is worse, because no flag switches it on.) This is why the type split ships
together with the runtime adoption rather than as routing alone: pointing
compatible operators at `.chat()` preserves the bug they hit. Rejected: a
llame-authored vendor parser, raw SSE parser, tag extraction, or middleware.

### D6: The `/v1/responses` survey, and what it changes

Survey taken 2026-09-17: Ollama advertises `/v1/responses` since v0.13.3
(non-stateful — no `previous_response_id`); llama.cpp documents the endpoint
and implements it by converting the request into Chat Completions; vLLM and
LM Studio list it in their OpenAI-compatibility docs; omp routes Ollama and
llama.cpp over it by default. What this changes: a local endpoint is a
legitimate `openai-responses` target, which is why D1 stopped calling that
type "official OpenAI". What it does not change: an older installation still
404s, the shims translate rather than implement, whether a translating
server tolerates `reasoningSummary: 'auto'` is unverified, and real OpenAI
under a name other than `openai` losing reasoning is untouched by any
provider-side adoption. Rejected: treating endpoint advertising as a
substitute for the declared type.

### D7: The accepted regression list

`@ai-sdk/openai-compatible` does not implement several things
`@ai-sdk/openai`'s chat path does. llame sends none of them on the
completions wire — `apps/api/src` has no match for any option name below
except `store`, which only the Responses path sends
(`openai-model-client.ts:250-262`, fixed to `false` by the Codex client) and
which exists there to obtain encrypted reasoning. They are recorded so the
documentation can say so:

- reasoning-model parameter handling (`max_tokens` → `max_completion_tokens`
  remapping; stripping temperature/logprobs/penalties). **The one real
  hazard**: an `openai-completions` provider pointed at a reasoning-capable
  OpenAI-shaped model can be rejected with an unsupported-parameter error
  where `.chat()` would have adapted the request. Loud, not silent.
- `logprobs`, `logit_bias`, `prediction`, `service_tier`, `store`,
  `safety_identifier`, `parallel_tool_calls`; `prompt_cache_key`,
  `prompt_cache_options`, `prompt_cache_retention`, and part-level
  prompt-cache breakpoints; web-search annotations and citations surfaced as
  `source` parts.
- `inputTokens.cacheWrite`: the compatible usage converter has no
  `cache_write_tokens` field. Inert for llame, whose cost formula reads only
  `cachedInputTokens` (`turn-telemetry.ts:142-152`).

Verified not regressed: forced tool choice and `strict` tool schemas (D4);
error schemas are structurally identical; cache-read usage is equivalent.

One endpoint-side rule is not a regression but shapes the stack: DeepSeek
documents that when a request carries `tools`, the `reasoning_content` of
**all previous turns** must be passed back or the API returns 400
(api-docs.deepseek.com/guides/thinking_mode, "Tool Calls"). llame sends tools
on every chat request that has not exhausted its step budget, so cross-turn
reasoning replay is a precondition for the completions wire to work against DeepSeek beyond a chat's first turn,
not an L3 refinement. The same-Chat replay of persisted reasoning **text**
therefore ships in L1 with the wire (D15); L3 adds the metadata. Rejected:
compensating for each gap with a llame-authored shim.

### D8: Reasoning part identity follows PR #648's rule

A new persisted reasoning part starts when (a) the last collected part is
not a reasoning part — a text, tool, or other part intervened — or (b) the
adapter-supplied part id and the open reasoning part's id are both defined
and differ. Otherwise the delta appends to the open part, and a defined id
becomes the open part's id. This is `isNewReasoningPart` from #648, with
the existing intervening-part split kept ahead of it.

Observed adapter behavior: `@ai-sdk/openai`'s Responses stream ids every
reasoning event `${item_id}:${summary_index}`
(`openai-responses-language-model.ts:2008-2050`), so each summary is its own
part; `@ai-sdk/openai-compatible` ids every reasoning event with the constant
`reasoning-0` (`openai-compatible-chat-language-model.ts:514-541`), so a
turn's uninterrupted reasoning stays one part and reasoning after a tool
call starts a new one by rule (a). Rationale: the id change is the only
boundary that corresponds to a transition that happened, and it is the same
boundary on live output, reconnect replay, and reloaded history. Rejected:
"one part per distinct id" alone, which would merge reasoning across a tool
call under a constant id and hoist it; an `undefined` ↔ defined transition
as a boundary (#648 review: "would invent a stream no adapter emits"); text
heuristics.

### D9: Glue repair happens at render and export, never at persist

A heading glued onto the text before it (`**One****Two**` with non-whitespace
on both sides, or prose butting onto a `**Heading**` whose closing `**` is
followed by a newline or end of text) is separated by a paragraph break when
reasoning is rendered in the Thinking panel or exported as markdown. This
covers reasoning persisted before part ids existed, which cannot be repaired
anywhere else. Mid-sentence and punctuation-adjacent emphasis (`the
**signature** field`, `Check (**signature**) next`) is left inline — the
matcher boundaries #648's review settled. Persisted text is never rewritten:
it is the text a provider signed or encrypted, and D15 replays it
byte-identically. Persist-side repair has no consumer once render and export
both repair — search and compaction already exclude reasoning. Markdown
export additionally separates consecutive reasoning parts with a blank line
(`chat-markdown.ts:14-28` joins them with a single newline today, which after
D8 would fuse two summaries into one paragraph that neither matcher touches).
Rejected: the persist-time `separateGluedReasoningBlocks` from #648 on
id-less parts, and splitting on any `**` pair.

### D10: Consecutive parts share one Thinking panel

Consecutive persisted reasoning parts group into one Thinking panel; a tool
or visible text part splits panels, so occurrence order is preserved and
reasoning is never hoisted above a tool. Rationale: the parts belong to one
visual thought until something else happens in the transcript; one panel per
part made a tool between two summaries read as interleaved glue, and one
panel per turn would merge across tool calls and misstate order. Rejected:
per-part and per-turn panels.

### D11: Delete the reasoning cap

`REASONING_PERSIST_MAX` is deleted, along with the unused `assistantParts()`.
Rationale: the cap is per part today, so a multi-part turn already persists
N × 24k and the stated purpose (bounding storage and context-read cost) is
not met; a per-turn total would truncate the tail of the turn, which under
D15 is a block the provider signed or encrypted and would reject on replay;
a 16k-token thinking budget is roughly 60k characters, so the truncation
would fire on ordinary use, not edge cases. Reasoning is excluded from
search, compaction, and public shares, so the storage is inert beyond the
row. Ceiling: an unbounded blob per turn; trigger for revisiting is a
measured context-build cost or table growth, at which point the bound goes
on whole parts, oldest first, dropped with their metadata rather than
truncated. Rejected: keeping the per-part cap, and a per-turn total.

### D12: Spec placement

`instance-config`'s provider-list requirement is edited in place: the enum
becomes `openai-responses` / `openai-completions` / `openai-codex`, both
OpenAI wire variants are defined with the same interpolation and keyless
semantics, `baseUrl` is required for `openai-completions`, and the
duplicable-providers and keyless examples are rebased. Its embedding-catalog
requirement is edited so either OpenAI wire type may back embeddings, with
every pre-existing scenario name kept. `available-models`' dispatch
requirement is restated because its parenthetical names the retired `openai`
type and its routing scenario's THEN clause names "the OpenAI-compatible
client" for that type; all three scenario names are kept. The new
`provider-api-selection` capability carries one rule — the type selects the
wire for every request the entry makes — because no shipped capability owns
wire selection and `available-models` owns catalog resolution, not
transport. `reasoning-output` carries the third-party amendment, reasoning
normalization on every wire (so one capability owns reasoning), part
identity, the metadata channel, render/export repair, panel grouping, the
amended privacy requirements, and the completions-wire evidence gate.
`subscription-access-openai-codex`'s "Preserve llame execution semantics" is
amended because it forbids persisting the reasoning-item identifiers and
encrypted reasoning D15 now persists. Three more capabilities assert, in five
requirements, that persisted reasoning never reaches a provider, so each is
amended to route reasoning replay through `reasoning-output` alone:
`tool-calling`'s "Tool observations survive into later turns as stored UI
parts" (its projection stays free of provider reasoning and metadata; its "never
replayed" scenario keeps its name — `openspec validate` refuses a MODIFIED
block that drops a shipped scenario name, so the name is diff-hygiene and
its clauses carry the narrowed boundary); `context-injection`'s "User-authored text
is neutralized before persistence" and "Stored parts cross a minimal SDK
conversion boundary" (the latter orders declared display-only parts omitted
at exactly the seam D16 writes to); and `model-system-prompts`' "A model
switch replaces the top-level prompt and preserves portable history", whose
reasoning exclusion covers the same-model continuation as well as a switch.
Every other scenario name is kept. Rejected: a vendor-named capability (`openai-provider-surfaces`) — every
shipped capability is behavior-named; folding wire selection into
`instance-config`, which is a configuration contract.

### D13: The live-smoke gate mirrors the native path's

Reasoning on the completions wire is accepted only after a bounded live
smoke proves its request shape, its normalized stream output, and — the half
a mock cannot prove — that a later request within the same turn carries the
prior assistant reasoning back to the endpoint. It runs against a
directly-billed reasoning-capable Chat Completions endpoint (a DeepSeek or
GLM key) and must not use OpenCode Go, which depends on this change. The
shipped native-path gate is the template. Prerequisite: the key exists before
L1 starts. Rejected: fixture-only evidence for a behavior that depends on what
the endpoint does with reasoning it receives back.

### D14: The `instance-config` delta is the base the sibling rebases onto

This change merges first, so its MODIFIED requirements reproduce master's
text with the split enum, and the sibling `anthropic-provider` rebases its
own delta onto the merged wording. All seven pre-existing provider-list
scenario names and all eight embedding-catalog scenario names are preserved
(the archive step refuses a delta that loses one), with two scenarios added
for the completions variant: its loading shape and its required `baseUrl`.
The sibling's delta as drafted in PR #885 lacks both added scenarios and still
names `openai` / `openai-compatible`; it must adopt all of them before it
archives, or it silently reverts this change at sync time. Rejected: writing
against the sibling's text, and waiting for the sibling.

### D15: Provider metadata is durable on the part and replayed for the same Chat

A reasoning part persists its provider metadata durably in `messages.parts`
and that metadata is replayed to the provider on later requests for the same
Chat, with the part's text byte-identical to what the provider produced. The
first producer already exists: `@ai-sdk/openai`'s Responses path attaches
`providerMetadata.openai = { itemId, reasoningEncryptedContent }` to the
`reasoning-start` and `reasoning-end` stream parts
(`openai-responses-language-model.ts:1408-1419,1848-1854,2021-2030`) and to
the assembled content parts (`:559-562`), and requests
`include: ['reasoning.encrypted_content']` whenever `store === false` on a
reasoning model (`:299-302`; every `gpt-5*` id except `-chat` variants
qualifies, `openai-language-model-capabilities.ts:37-39`), which the Codex
client sets unconditionally. The `reasoning-delta` part carries only
`itemId`, and `streamText`'s `onChunk` never sees `reasoning-start` /
`reasoning-end`, so the producer cannot be read at
`openai-model-client.ts:300` as today's callback stands: the client reads
reasoning from `fullStream`, correlating start/delta/end by part id, and
hands the end part's metadata to the collector with that id.

Replay is per wire, and reverses one documented invariant:
`context-builder.ts`'s `appendAssistantMessage` gains a path that emits
`{ type: 'reasoning', text, providerOptions? }` content parts ahead of the
assistant text and tool calls for the same Chat, and no longer returns early
for an assistant message that has only reasoning parts (`:455-458`). On the
Chat Completions wire the adapter carries the text as `reasoning_content`
with no metadata needed — this half ships in L1 because DeepSeek requires it
(D7). On the Responses wire the SDK carries a part that has an `itemId` as a
`reasoning` input item (encrypted content when present; an item reference to
the stored item otherwise) and skips a part without one with a warning
(`convert-to-openai-responses-input.ts:596-608,647-676`), so reasoning
persisted before this change and reasoning produced on the other wire are
omitted there rather than failing the request. Rationale: it is the substrate
for a reasoning-preservation mode two providers already support, a resumed
Run after a worker restart mid-turn needs the block on its first request,
DeepSeek makes the text half mandatory, and a later migration cannot backfill
data never stored. Rejected: run-scoped private state deleted at run
completion (forfeits continuity and the restart case), building the channel
with no producer (the Responses producer is present), and reading metadata
from `onFinish`'s assembled content instead of the stream (it arrives only
after the turn, too late for a restart mid-turn).

The metadata is opaque to llame: never rendered, exported, indexed, or
included in a public share; it changes neither the part's display text nor
its order. Because a part and its metadata re-enter the same Chat's provider
requests, the "excluded from later model context" clause of "Reasoning is an
ordered private assistant part" is narrowed for that one reuse; compaction
input, chat search, and public shares stay excluded, and state that is
genuinely run-scoped stays transient. No model-switch coercion rule is added:
llame passes blocks back unchanged and the provider ignores or drops the ones
the target model cannot read. No size bound is added (D11's ceiling applies).

### D16: Replay is a property of the request, not of the projection

`buildContext` serves both a Run's request and a compaction request
(`compaction.ts:320` passes `input.absorb` through the same
`appendAssistantMessage`), so "reasoning replays" and "reasoning is excluded
from compaction input" cannot both be properties of the projection. The
requirement is therefore written against the request kind: a request that
continues a Chat carries that Chat's reasoning parts; a request that asks a
model to summarize history does not. The implementation discriminates at
`buildContext`, not at each caller, so a third caller cannot inherit the
wrong default. Rejected: filtering in the compaction caller (the next caller
repeats the bug) and dropping the compaction exclusion (it would send
reasoning to be summarized into text that is no longer provider-authorized).

Known ceiling on the completions wire: a compacted DeepSeek chat replays
replacement records that carry `tool_calls` without `reasoning_content`,
which the vendor rule in D7 rejects with a 400. The L1 smoke exercises the
first post-compaction request so the ceiling is measured rather than
assumed; if it reproduces, the fix belongs to the compaction replacement
contract (#866 owns that path), not to this change.

### D17: Replay follows the Chat that stores the part

A copied Chat (`owner-chat-forks`) copies parts verbatim, including provider
metadata, and its requirement is that the fork's model-facing prefix equals
the source's at the copied boundary. Replay is therefore keyed on the Chat
that stores the part, not the Chat that produced it: a fork replays its own
copied parts, and the prefix matches. Consequence, accepted: a copied
`itemId` names an item produced under another Chat's Run. With `store: false`
the encrypted content travels with the part and the reference is not used; if
a provider rejects a copied item, it fails or is ignored under the existing
failure contract and llame does not rewrite or strip it. Rejected: keying on
the producing Chat (a fork would silently lose reasoning and break the
prefix-equality requirement) and stripping metadata during a fork (it
contradicts "copied rows are literal").

## Risks / Trade-offs

- [The breaking rename lands on every operator] → boot fails naming the
  entry and the out-of-enum `type`; the README, `apps/api/AGENTS.md`, the
  CHANGELOG, and the shipped example state the two replacement names.
- [An `openai-completions` provider is pointed at an OpenAI-shaped reasoning
  model and is rejected for an unsupported parameter] → loud and bounded at
  request time (D7); no llame shim adapts the request.
- [A translating runtime mishandles a Responses-only field] → recorded as
  unverified (D6); the operator declares that endpoint `openai-completions`.
- [Title generation on `openai-responses` moves from Chat Completions to
  Responses] → same forced tool call, verified on the live smoke; the
  existing free-text fallback covers a rejection (D4).
- [Reasoning part identity is dropped or changed by a future adapter] → the
  requirement states the rule in terms of the adapter's ids, so an adapter
  change is a spec-visible change, not a silent split (D8).
- [Glue repair splits legitimate emphasis] → the requirement names the glued
  shapes that must split and the inline cases that must not (D9); persisted
  text is untouched, so a wrong match is a display defect, not a data defect.
- [Unbounded reasoning per turn] → accepted with a named trigger (D11).
- [Delta drift against the sibling] → this delta is the base (D14); the
  finalize layer re-reads the canonical requirement after sync.
- [Dual `@ai-sdk/provider` versions in the lockfile] → accepted with the
  `isInstance()` argument; the types layer verifies the resolved lockfile
  (D3).
- [A replayed provider block is invalidated by a rewritten prefix] → a
  provider-issued thinking block stays valid only while the system prompt,
  tools, and preceding messages are unchanged, and llame is not append-only:
  compaction rewrites the prefix. The durable-metadata decision inherits that
  constraint. The mitigation belongs to the `anthropic-provider` change,
  which sets the provider's prefix-mismatch behaviour to drop rather than
  error. OpenAI documents no equivalent binding for its reasoning items, and
  does not deny one; the mitigation is scoped to the provider that documents
  the constraint.

## Migration Plan

Operator-visible and configuration-only: every `type: "openai"` entry is
re-declared as `openai-responses` (Responses wire; OpenAI, Codex-adjacent
proxies, Ollama ≥ 0.13.3, vLLM) or `openai-completions` (Chat Completions
wire; DeepSeek, GLM, LM Studio, older Ollama, most gateways). Boot fails
naming any entry left on the old name. No database migration, no `models[]`
change, and no data rewrite; reasoning parts persisted before this change
load unchanged and are repaired at display. Rollback is reverting the
configuration plus the release; historical runs keep their recorded models,
parts, and costs. The CHANGELOG records the breaking note.

## Revision history

- v3 (2026-09-18): Round 3 of independent review. Added the three capabilities
  whose requirements still forbade the replay this change introduces —
  `model-system-prompts`' model-switch requirement (its reasoning exclusion
  covers the same-model continuation) and `context-injection`'s SDK
  conversion boundary (which orders display-only parts omitted at the exact
  seam the replay writes to) — and renamed the one `tool-calling` scenario
  whose title now contradicted its body. Made replay a property of the
  request kind rather than the projection (D16), since compaction builds
  through the same `buildContext`, and recorded the post-compaction DeepSeek
  ceiling with a smoke step. Keyed replay on the Chat that stores the part so
  a copied Chat keeps prefix equality with its source (D17). Corrected D7's
  claim that llame sends none of the listed options (`store` is sent on the
  Responses wire), D3's dependency-pin and zod wording, the "no reasoning
  concept" and "tools on every request" phrasings, and two citation line
  ranges. Stated the embeddings exemption in `provider-api-selection`, fixed
  task 3.2's per-part encrypted-content assertion to per item, dropped an
  unobservable usage-metadata assertion from task 1.5, kept the
  `tool-calling` scenario name after `openspec validate` rejected renaming
  it, and added the #883
  amendment task (its per-turn-bound acceptance criterion is rejected by D11)
  with the model-switch criterion restored.
- v2 (2026-09-18): Round 2 of independent review. Renamed the types after the
  wire they speak (`openai-responses` / `openai-completions`) and dropped the
  "official OpenAI vs proxy" claim, following omp's `api` field and the AI
  SDK's `.responses()` / `.chat()` split; recorded why
  `@ai-sdk/open-responses` is not adopted and the `forceReasoning` ceiling
  (D1). Corrected the reasoning baseline — parts already split on an
  intervening part and the cap is already per part — so the cap is deleted
  rather than rebounded (D11) and glue repair moved to render and export,
  where it cannot invalidate a signed block (D9). Adopted PR #648's identity
  rule verbatim, including the constant `reasoning-0` the compatible adapter
  emits (D8). Named the Responses path as the existing metadata producer and
  the `fullStream` seam that carries it, since `onChunk` never delivers
  `reasoning-start` / `reasoning-end` (D15); moved same-Chat reasoning text
  replay into the types layer because DeepSeek rejects a request with `tools`
  whose earlier turns dropped `reasoning_content` (D7). Deleted D4's
  `supportsStructuredOutputs` decision and its requirement: llame uses forced
  tool calls, so the option guards a request it never sends. Added the deltas
  this change falsified without one — `available-models`,
  `subscription-access-openai-codex`, `tool-calling`, `context-injection` —
  renamed the capability to `provider-api-selection`, extended the embedding
  gate to both wire types, and added the config example, E2E fixture, and
  sibling-citation corrections. Split the stack into `types`,
  `reasoning-parts`, `reasoning-metadata`, `finalize`.
- v1 (2026-09-17): Initial proposal: `openai` / `openai-compatible` type
  split, `@ai-sdk/openai-compatible` adoption, reasoning part identity, and a
  durable per-part provider-metadata channel with no present producer.

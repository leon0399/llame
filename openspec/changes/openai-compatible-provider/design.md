## Context

See [proposal.md](proposal.md) for motivation and scope; the specs at
`specs/openai-provider-surfaces/spec.md`, `specs/instance-config/spec.md`, and
`specs/reasoning-output/spec.md` are the behavior contract this design
implements.

Today `providers[]` is discriminated by `type` and the schema's
`$defs.providerType` enum is strict-closed to `["openai", "openai-codex"]`.
`llame-config.ts` normalizes entries into
`OpenAIProviderConfig { id, type, key, baseUrl }` and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `model-client-factory.ts` switches on `provider.type`, and its
`openai` case derives `nativeOpenAI: provider.id === 'openai'`;
`openai-model-client.ts` then selects `openai(model)` (Responses, with
`reasoningSummary: 'auto'`) versus `openai.chat(model)` from that flag, and the
Codex client builds the same Responses path with `nativeOpenAI: true` over its
fixed base URL. The factory's `default` branch is a `never` exhaustiveness
guard — an unrecognized resolved type is an internal error, never a fallback —
so `type` is already the dispatch mechanism; only the surface within the
`openai` case is inferred from an id.

Reasoning is persisted as one concatenated `{ type: "reasoning", text }` part
per turn: `assistant-transcript.ts` caps it at `REASONING_PERSIST_MAX`
(24,000 characters) in both `parts()` and `assistantParts()`, the web chat
renders one `Reasoning` panel per reasoning part (`chat-message-row.tsx`), and
markdown export joins reasoning parts with a single newline (`chat-markdown.ts`)
— which is why a glued `**One****Two**` run survives into the export. Embedding
models are a separate path: `openai-embedding-backend.ts` builds its own
OpenAI client from the provider entry's `key`/`baseUrl`, and the loader gates
embedding bindings to `provider.type === 'openai'`, so the model-client surface
split does not reach it. The installed AI SDK is `@ai-sdk/provider@3.0.15` /
`@ai-sdk/provider-utils@4.0.46`.

The sibling `anthropic-provider` change depends on this one and wrote its
`instance-config` delta against this change's post-merge wording; it also quotes
the same two shipped `reasoning-output` requirements in its own D8 and recorded
the same question as its Q1, which D15 now answers. Its proposal describes this
change as introducing the per-reasoning-part provider-metadata channel from
issue #883, and that is what lands here: per-part **identity** (one durable part
per adapter-supplied id) plus the durable metadata channel D15 specifies, whose
first producer is that change.

## Goals / Non-Goals

Goals:

- One declared surface per provider `type`, no inference from `id`, `baseUrl`,
  or host, and no silent rewriting of a mismatched entry.
- One client per surface under the existing `ModelClient` seam, with the Codex
  transport still on Responses by construction.
- Reasoning reachable on compatible backends through the adapter's own
  normalization, with no llame-authored vendor handling.
- Reasoning parts with adapter-derived identity, unglued markdown, grouped
  panels, a bound that holds across a turn, and the durable provider-metadata
  channel other provider changes build on.
- Documentation that states which surface each type uses and where reasoning
  renders.

Non-goals:

- Producing provider metadata: this change owns the channel, its persistence,
  and its replay, not a producer, and adds no provider-specific metadata
  semantics.
- Model-switch coercion: the provider ignores or drops blocks the target model
  cannot read, so no coercion rule is added.
- Prefix rebinding or append-only message construction: that mitigation belongs
  to the `anthropic-provider` change (see Risks).
- Changing `models[]`, the embedding catalog's provider gate, the run
  lifecycle, or cost accounting.
- The v4 AI SDK specification line (#882), the Anthropic adapters (#208),
  OpenRouter (#82), OpenCode Go/Zen (#808, #809), BYOK (#37, #18), tool-loop
  usage and cost accounting (#810), the effort-change cache warning (#593), and
  the unified compaction request path (#866).

## Decisions

### D1: Split the types; never infer the surface

`type: "openai"` means the official OpenAI API on the Responses surface, where
a `baseUrl` names a proxy in front of OpenAI; `type: "openai-compatible"` means
the Chat Completions surface at the operator's endpoint. `nativeOpenAI` and the
`provider.id === 'openai'` check are deleted; the factory routes by `type`, and
the surface is passed explicitly to the client. Rationale: the id is free-form
and duplicable, so an id-dependent surface makes a readability choice silently
change the HTTP endpoint llame calls — the bug #219 shipped. Explicit wiring
makes the surface testable from configuration alone and makes a misconfigured
entry fail at request time instead of being silently retargeted.

Prior art agrees. Across OpenCode v1 and v2, kimi-code, and jcode, the wire
protocol is catalogue-declared with a config override on top, and **no**
surveyed harness derives it from the request host; jcode's host sniffing only
toggles a correlation header. In llame the operator's `providers[]`/`models[]`
_is_ the catalogue, so declaring the type is the declaration.

Rejected: deriving the surface from the endpoint (the direction the original
issue proposed) — a host rule deciding the protocol is the same class of
invisible inference this change removes; host/shape allow-lists; and
reinterpreting an existing entry at load time.

**BREAKING.** An existing `type: "openai"` provider whose `id` is not literally
`openai` reaches Chat Completions today and reaches Responses after this
change. Operators with a compatible endpoint must set
`type: "openai-compatible"`. There is no shim, no migration, and no warning.

### D2: Configuration posture stays operator-owned

Boot validates shape only. It does not judge whether a base URL serves the
surface its `type` names, does not warn about a mismatch, and does not migrate
or reinterpret an entry. Rationale: llame cannot know every gateway's host or
path layout, and a heuristic that is wrong either blocks a working endpoint or
reassures an operator about a broken one — consistent with the existing posture
that credentials and reachability are never prevalidated at boot. Rejected:
host allow-lists and boot warnings, which encode vendor knowledge llame does
not own.

### D3: Pin `@ai-sdk/openai-compatible@2.0.75`

It is the newest release on llame's v3 specification line and declares
`@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51` against llame's
current 3.0.15 / 4.0.46 — same-major bumps, and `@ai-sdk/anthropic@3.0.118` in
the sibling change wants the identical pair, so the two changes converge
instead of fighting over the lockfile. Whichever change merges first owns the
bump. No zod change is needed: all three peer on `^3.25.76 || ^4.1.8`, and
llame resolves 3.25.76 and 4.6.5. Rejected: the v4 specification line (#882,
explicitly out of scope) and an unpinned range, which would let the adapter
drift onto a line llame has not validated.

### D4: Pass `supportsStructuredOutputs: true`

The compatible client is constructed with that option set. Its default is
`false`, which silently degrades a JSON-schema response format to unconstrained
`json_object` — a silent weakening of a caller's output contract, in a change
whose whole point is removing silent behavior changes. Rejected: accepting the
default and inheriting the degradation.

### D5: Reasoning on the compatible surface comes from the adapter

`@ai-sdk/openai-compatible` extracts `reasoning_content ?? reasoning` inbound
and re-injects `reasoning_content` outbound on assistant messages, natively.
`@ai-sdk/openai`'s chat path has no reasoning concept at all: its
assistant-message conversion switches only on `text` and `tool-call`, so
reasoning parts are silently dropped outbound, and its response assembly pushes
only `text`, `tool-call`, and `source`. Measured: zero occurrences of
`reasoning_content` in that package. (This corrects the original issue body's
claim that upstream "hardcodes `reasoning: void 0`" — it is a structural
omission, which is worse, because no flag switches it on.) This is why the type
split must ship together with the runtime adoption rather than as routing
alone: pointing compatible operators at `.chat()` preserves the bug they
actually hit. Rejected: a llame-authored vendor-specific reasoning parser, raw
SSE parser, tag extraction, or middleware — the adapter normalizes; llame does
not.

### D6: The `/v1/responses` survey, and what it does not change

Survey taken 2026-09-17, as the original issue asked for: Ollama advertises
`/v1/responses` since v0.13.3 (non-stateful only — no
`previous_response_id`); llama.cpp documents the endpoint and implements it by
**converting the request into Chat Completions**; vLLM lists it in its
OpenAI-compatible server docs; LM Studio lists it in its OpenAI-compatibility
docs.

What this changes: direction 1's blast radius is version-gated rather than
categorical, so a compatible endpoint named `openai` does not universally 404.
What it does not change: an older installation still 404s; the shims translate
rather than implement, and whether a translating server tolerates the
Responses-only field llame sends on the native path (`reasoningSummary: 'auto'`)
is unverified; and the survey says nothing about direction 2 — real
OpenAI under a name other than `openai` silently losing reasoning — which is
untouched by any provider-side adoption. Rejected: treating endpoint
advertising as a substitute for the declared type, which would leave the
failure mode depending on which runtime version an operator happens to run.

### D7: The accepted regression list, with the one that becomes a 400

`@ai-sdk/openai-compatible` does not implement several things `@ai-sdk/openai`'s
chat path does. llame uses none of them today; they are recorded so the
documentation can say so:

- reasoning-model parameter handling (`max_tokens` → `max_completion_tokens`
  remapping, and stripping temperature/logprobs/penalties). **This is the one
  real hazard**: a compatible-typed provider pointed at a reasoning-capable
  OpenAI-shaped model can now be rejected with an unsupported-parameter error
  where `.chat()` would have adapted the request. It is a loud failure, not
  silent corruption.
- `logprobs`, `logit_bias`, `prediction`, `service_tier`, `store`,
  `safety_identifier`, `parallel_tool_calls`.
- `prompt_cache_key`, `prompt_cache_options`, `prompt_cache_retention`, and
  part-level prompt-cache breakpoints.
- web-search annotations and citations surfaced as `source` parts.

Not regressed and verified: forced tool choice and `strict` tool schemas are
identical between the packages, so `generateToolBoundObject` is unaffected;
error schemas are structurally identical; cached-token usage reporting is
equivalent. Rejected: compensating for each gap with a llame-authored shim,
which would grow a per-vendor compatibility layer in a codebase whose
configuration is meant to stay the only place a surface is declared (D1, D2).

### D8: Reasoning part identity is the adapter's, or absent

When the adapter supplies a reasoning part id, each distinct id persists as its
own `{ type: "reasoning" }` part in order; OpenAI Responses supplies
`${itemId}:${summaryIndex}`, so each summary is its own part. Chat Completions
and OpenAI-compatible backends supply none and stay one concatenated part.
Rationale: the adapter's identity is the only boundary that corresponds to a
transition that actually happened, and it is the same boundary on live output,
reconnect replay, and reloaded history. Rejected: inventing a boundary from
text heuristics, which would split on a transition no adapter emits and would
show different parts live and after reload; and merging all ids into one part,
which loses the panel boundary #883 exists to restore.

### D9: Glue repair happens at persist, render, and export

A heading glued onto a previous part (`**One****Two**`, or prose butting onto
`**Heading**`) is separated by a paragraph break wherever reasoning is
persisted, rendered, or exported as markdown, including for reasoning persisted
before part ids existed. Mid-sentence emphasis after whitespace
(`the **signature** field`) is left inline. Rationale: concatenating headed
summaries produces a `****` run that markdown parses as neither bold nor a
heading (vercel/ai#6742), and repairing only in the renderer would leave
persisted text and the markdown export broken; history written before ids
existed cannot be repaired at persist time at all. Rejected: renderer-only
repair, and splitting on any `**` pair — the latter breaks ordinary emphasis.

### D10: Consecutive parts share one Thinking panel

Consecutive persisted reasoning parts group into one Thinking panel; a tool or
visible text part splits panels, so occurrence order is preserved and reasoning
is never hoisted above a tool. Rationale: the parts belong to one visual
thought until something else happens in the transcript; one panel per part (the
pre-change behavior) made a tool between two summaries read as interleaved
glue, and one panel per turn would merge across tool calls and misstate order.
Rejected: per-part panels and per-turn panels.

### D11: The reasoning bound applies across the turn

`REASONING_PERSIST_MAX` bounds one concatenated part today. Once a turn can
hold N parts it would bound N × 24k, defeating its stated purpose of bounding
storage and the per-turn context-read cost. The bound therefore applies to the
turn's reasoning as a whole. Rejected: the per-part bound (the defect #648's
review found and never resolved) and removing the bound altogether.

### D12: Spec placement

`instance-config`'s provider-list requirement is edited in place: the enum
clause splits `openai` from `openai-compatible`, the compatible variant shape
is defined with the same interpolation and keyless semantics as `openai`, and
the duplicable-providers example no longer shows a local endpoint as
`type: "openai"`. The new `openai-provider-surfaces` capability carries the
execution contract (surface selection, reasoning normalization,
schema-constrained output). `reasoning-output` carries the third-party
amendment, part identity, markdown blocks, panel grouping, the per-turn bound,
and the compatible-surface evidence gate.

`available-models` is not modified: its dispatch requirement is still
satisfied, its `(this slice: openai → …)` parenthetical is scoping rather than
an enumeration, and the `openai-codex` provider change — which also added a
type — amended `instance-config` only. The embedding catalog is untouched: the
embedding backend is not surface-routed, its provider-type gate stays `openai`,
and the sibling change extends the embedding restriction to its new types.
Rejected: an `available-models` delta that would restate a requirement that has
not changed and duplicate the surface contract, and folding execution behavior
into `instance-config`, which is a configuration contract.

### D13: The live-smoke gate mirrors the native path's

Reasoning on the compatible path is accepted only after a bounded live smoke
proves its request shape, its normalized stream output, and — the half a mock
cannot prove — that a later request within the same turn carries the prior
assistant reasoning back to the endpoint. It runs against a directly-billed
reasoning-capable compatible endpoint (a DeepSeek or GLM key) and must not use
OpenCode Go, which depends on this change. The shipped native-path gate
("a bounded live smoke [that] proves its request shape and normalized stream
output", with a zero-reasoning response still a success) is the template.
Rejected: fixture-only evidence for a behavior that depends on what the
endpoint does with reasoning it receives back, and borrowing evidence from a
provider that cannot be smoke-tested independently of this change.

### D14: The `instance-config` delta is written against today's master text

This change merges first, so its MODIFIED requirement reproduces the
requirement from master with the split enum and is the post-merge base the
sibling `anthropic-provider` change rebases its own delta onto. All seven
pre-existing scenario names are preserved verbatim (the archive step refuses a
delta that loses one), with the duplicable-providers example rebased and one
scenario added for the compatible variant's loading shape. Rejected: writing
against the sibling's post-merge text (it would revert this split at archive
time) and waiting for the sibling to be finalized first (it would stall the
stack for no design gain).

### D15: Provider metadata is durable on the part and replayed for the same Chat

A reasoning part persists its provider metadata durably in `messages.parts`, and
that metadata is replayed to the provider on later requests for the same Chat.
Rationale: it is the substrate for a reasoning-preservation mode that Anthropic
already supports, so the durable shape is designed for where the system is
going rather than for the current turn's needs. Rejected: run-scoped private
state deleted at run completion — reversible and spec-free, but it forfeits
cross-turn reasoning continuity and a later migration cannot backfill data
never stored.

The metadata is opaque to llame: it is never rendered, exported, indexed, or
included in a public share, and it changes neither the part's display text nor
its order. This change owns the channel only, and the `anthropic-provider`
change is its first producer. Because a part and its metadata re-enter the same
Chat's provider requests, the "excluded from later model context" clause of
"Reasoning is an ordered private assistant part" is narrowed for that one
reuse; compaction input, chat search, and public shares stay excluded, and
state that is genuinely run-scoped stays transient. No model-switch coercion
rule is added: llame passes blocks back unchanged and the provider ignores or
drops the ones the target model cannot read. Within-turn round-trip remains
required as well: the provider rejects a continuation whose earlier thinking
block in the same turn lost its signature, so a tool continuation must carry it
regardless of how long the block survives.

## Risks / Trade-offs

- [The breaking change lands on an operator with a compatible endpoint named
  `openai`] → documented in the README, `apps/api/AGENTS.md`, and the
  CHANGELOG, with the required `type: "openai-compatible"` stated plainly; no
  silent fallback masks it, by design (D1).
- [A compatible provider is pointed at an OpenAI-shaped reasoning model and is
  rejected for an unsupported parameter] → the failure is loud and bounded at
  request time (D7); no llame shim adapts the request, keeping the surface
  honest.
- [A translating runtime (Ollama, llama.cpp) mishandles a Responses-only field]
  → the survey records it as unverified rather than assumed (D6), and the type
  declaration lets an operator route that endpoint to `openai-compatible`
  instead.
- [Reasoning part identity is dropped by a future adapter] → the requirement
  asserts only that identity follows the adapter and that absent identity stays
  one part, so a change in the adapter's behavior is a spec-visible change
  rather than a silent split (D8).
- [Glue repair splits legitimate emphasis] → the requirement names the two
  glued shapes that must split and the mid-sentence case that must not (D9),
  and both are covered by scenarios.
- [Delta drift against the sibling change] → this delta is the base the sibling
  rebases onto (D14), and the finalize layer re-reads the canonical requirement
  after sync instead of assuming it.
- [Dependency convergence fails] → the adapter's declared `@ai-sdk/provider` /
  `@ai-sdk/provider-utils` pair matches the sibling's requirement, and the
  types layer verifies the resolved lockfile rather than assuming (D3).
- [A replayed provider block is invalidated by a rewritten prefix] → a
  provider-issued thinking block "stays valid only while the top-level `system`
  prompt, the `tools`, and the messages before it are unchanged", and llame is
  not append-only: compaction rewrites the prefix. The durable-metadata
  decision inherits that constraint, so a replayed block can be one the
  provider no longer accepts. The mitigation belongs to the `anthropic-provider`
  change, which sets the provider's prefix-mismatch behaviour to drop rather
  than error; append-only message construction would remove the constraint
  entirely.

## Migration Plan

Operator-visible and configuration-only: an entry whose endpoint serves the
Chat Completions wire format must be re-declared as
`type: "openai-compatible"`; entries that keep `type: "openai"` start using the
Responses surface. No database migration, no `models[]` change, and no data
rewrite. Rollback is reverting the configuration plus the release; historical
runs keep their recorded models, parts, and costs. The CHANGELOG records the
breaking note.

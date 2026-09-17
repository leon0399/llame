## Context

See [proposal.md](proposal.md) for motivation and scope; the specs at
`specs/anthropic-messages-provider/spec.md` and `specs/instance-config/spec.md`
are the behavior contract this design implements.

Today `providers[]` is discriminated by `type` and the schema's `$defs.providerType`
enum is strict-closed to `["openai", "openai-codex"]`; its own description calls
Anthropic a follow-up. `llame-config.ts` normalizes entries into
`OpenAIProviderConfig { id, type, key, baseUrl }` and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `model-client-factory.ts` switches on `provider.type` and its
`default` branch is a `never` exhaustiveness guard — an unrecognized resolved
type is an internal error, never a fallback — while each provider type owns a
client module (`openai-model-client.ts`, `openai-codex-model-client.ts`). The
factory's `openai` case currently derives `nativeOpenAI` from
`provider.id === 'openai'`; `openai-compatible-provider` deletes that
discriminant, which is exactly why the Anthropic types must not reintroduce any
form of inference from `id` or `baseUrl`.

Cost flows from the catalog entry through `toTokenPrice(model.pricingUsdPer1M)`
to `ModelClient.pricing`, and `calculateCostUsd` in
`apps/api/src/chats/turn-telemetry.ts` computes
`uncachedInput × input + cachedInput × (cachedInput ?? input) + output × output`
per million tokens, returning `costUsd: null` when no price is carried. The
installed AI SDK is `@ai-sdk/provider@3.0.15` / `@ai-sdk/provider-utils@4.0.46`;
`openai-compatible-provider` bumps that pair to 3.0.16 / 4.0.51.

Two shipped `reasoning-output` requirements still describe reasoning as
display-only private text with no durable continuation state; the
`openai-compatible-provider` change amends them to admit opaque provider metadata
on a reasoning part, and this change depends on that amendment and writes no
`reasoning-output` delta of its own. The requirements are quoted in D7 because
that amendment is why the Anthropic signature may outlive its turn at all.

## Goals / Non-Goals

Goals:

- Two provider types, one client module, one dispatch case each, under the
  existing `ModelClient` seam and run lifecycle.
- Configuration behavior that stays operator-owned: shape validation only, no
  vendor heuristics, no credential or reachability prevalidation.
- Cost accounting that reports the cache-write spend the provider actually bills.
- No new effort vocabulary, no new configuration shape for reasoning, and no
  fallback designed for structured output.

Non-goals:

- Defining the metadata channel or amending `reasoning-output`: both belong to
  `openai-compatible-provider`, and this change only produces the metadata.
- A llame-owned thinking-pruning or signature-coercion policy: the provider owns
  both decisions.
- Any per-part cache plumbing: llame places no cache breakpoints and budgets none.
- The v4 AI SDK line (#882), the subscription path (#754), OpenRouter (#82),
  OpenCode Go/Zen (#808, #809), BYOK (#37, #18), tool-loop usage/cost accounting
  (#810), and the effort-change cache warning (#593).
- Changing `models[]`, the run lifecycle, or frontend rendering.

## Decisions

### D1: Two types, `anthropic` and `anthropic-compatible`, with no inference

`type` is the only discriminator, mirroring change 1's `openai` /
`openai-compatible` split. Rationale: the configuration is the contract, so an
operator who points an entry at a gateway states that intent once, and a
misconfigured entry fails visibly at request time instead of being silently
retargeted. Rejected: a single `anthropic` type that infers a gateway from a
non-Anthropic host, which reintroduces exactly the inference bug change 1
deletes; and collapsing native and compatible, which makes the destination
untestable from configuration alone.

### D2: The configuration posture stays operator-owned

Boot validates shape only (`anthropic-compatible` requires `baseUrl`). It does
not judge whether a URL serves the Messages API, does not warn about a mismatch,
and does not migrate or reinterpret a stale entry. Rationale: llame cannot know
every gateway's host or path layout, and a heuristic that is wrong either blocks
a working endpoint or reassures an operator about a broken one. Rejected:
host/shape allow-lists and boot warnings, which encode vendor knowledge llame
does not own and contradict the existing behavior that provider credentials and
reachability are never prevalidated at boot.

### D3: Variant shapes and credential semantics mirror the `openai` variant

`anthropic` accepts `{ id, type, key?, baseUrl? }` — `baseUrl` meaning Anthropic
behind a proxy — and `anthropic-compatible` requires `{ id, type, key?, baseUrl }`.
Keys use the existing `{env:…}` / `{path:…}` interpolation, and an empty
resolution means keyless under the existing semantics, exactly as the `openai`
variant already does. Rationale: one interpolation contract for all provider
types; a gateway that injects its own credentials, or a proxy fronting Anthropic,
must not be forced to invent a dummy secret, and the keyless client construction
precedent (#162) already exists in the OpenAI client. Rejected: requiring `key`
on both new variants (breaks keyless gateways and contradicts the no-speculative
gating posture), and inventing separate field names for the compatible type.

### D4: Pin `@ai-sdk/anthropic@3.0.118`

It is the newest release on the repository's v3 specification line (3.0.119 and
3.0.120 do not exist), and it declares `@ai-sdk/provider@3.0.16` and
`@ai-sdk/provider-utils@4.0.51` — the pair change 1 already bumps to, so the two
changes converge instead of fighting over the lockfile. It peers on zod
`^3.25.76 || ^4.1.8`, and llame resolves both 3.25.76 and 4.6.5, so no zod change
is needed. Rejected: adopting the v4 specification line (#882, explicitly out of
scope), and an unpinned/floating range, which would let the adapter drift onto a
specification line llame has not validated.

### D5: Request-level cache control, placed by Anthropic, for both types

Set `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` at the top
level of the call, the same channel llame already uses for
`providerOptions.openai` reasoning options. The adapter emits `cache_control` as
a top-level request-body field and Anthropic places the breakpoint on the last
cacheable block itself, so llame places no breakpoints, counts none, and needs no
part-level cache plumbing; the adapter's `MAX_CACHE_BREAKPOINTS = 4` never comes
into play. The cache lifetime stays the provider default (5 minutes); the 1-hour
bucket costs more per write and has no current requirement. The same option is
sent for both types: a gateway that ignores it loses caching, and one that
rejects it fails at request time — consistent with D2, no speculative gating.

Rationale, recorded once: a stable prefix is otherwise re-paid in full every
turn. With the documented structure — cache reads at 0.1× input and a 5-minute
cache write at 1.25× input — a 50k-token prefix over 20 turns costs
`20 × 50k = 1,000k` input-token-equivalents uncached, versus
`1.25 × 50k (write) + 19 × 0.1 × 50k (reads) = 157.5k` cached, about 6× less.
Confidence is moderate on the exact ratios and high on the order of magnitude.

Rejected: authoring part-level breakpoints and budgeting them (a second,
llame-owned placement policy that duplicates provider logic); exposing the 1-hour
lifetime; enabling the option for one type only; and omitting caching, which
makes every cached-turn cost estimate wrong.

### D6: Cache-write pricing is an optional additive field, consumed in cost

Add `cacheWrite` to `ModelPricingUsdPer1M` (today `{ input, cachedInput, output }`),
carry it through `toTokenPrice`, and price provider-reported cache-creation
tokens at that rate in cost computation, falling back to the entry's `input` rate
when absent — the same fallback shape as `cachedInput`. `@ai-sdk/anthropic`
populates the count from `cache_creation_input_tokens`, a real, always-present
field, unlike the OpenAI packages where it is absent or speculative. Leaving the
field out and reporting `costUsd: null` is unacceptable: the number exists, is
billed, and is the largest line on a cached turn; silent under-reporting is the
worst option. The field is optional, so no existing configuration becomes invalid
and nothing must change for a model that does not declare it; only a declaring
model's computed cost changes, which the changelog records. The public model DTO
mirrors the field so the published price stays inspectable, which keeps the
public and configuration price shapes identical. Rejected: a required field
(breaking, and unavailable for many third-party entries), deriving a write rate
as a fixed multiple of input (an invented constant that silently misprices every
model), and exposing it server-only (the first divergence between the two price
shapes).

### D7: Signatures are durable per-part metadata and are replayed unmodified

The client surfaces thinking and redacted thinking as reasoning parts through the
existing normalized-reasoning path (no new rendering work), persists each block's
provider-issued signature — and its redacted payload, where present — as opaque
provider metadata on that same part through the per-reasoning-part channel
`openai-compatible-provider` introduces for #883, and replays the blocks on later
requests for the same chat.

Anthropic's documented tiers decide the replay posture, verbatim: "**Required:**
within a tool-use turn, pass thinking blocks back. **Recommended:** across turns,
pass everything back. **Allowed:** outside tool use, omit prior turns'
thinking." llame follows the recommendation and passes everything back, because
the documented filtering then does the work: "You don't need to prune old
thinking yourself… the API automatically filters them, keeps the blocks needed to
preserve the model's reasoning, and bills input tokens only for the blocks
actually shown to Claude." On a model switch the blocks are still replayed
unchanged, since "A thinking block is readable only by the model that produced it
or a newer one, and the API ignores or drops the blocks the target model can't
read." Blocks are replayed complete and unmodified, and the consecutive thinking
blocks of the latest assistant message keep their order and bytes: a modified
block is rejected with a 400.

Rationale: the signature is a property of the part that carries it, and both
OpenCode generations independently persist it on the durable part and reattach it
on follow-up requests. Durable metadata is also the substrate Anthropic's
reasoning-preservation mode builds on, so this is the shape the system is going
toward. Rejected: run-scoped private state that dies with the run (the shipped
`reasoning-output` requirement's old shape, which the sibling change amends away,
and which cannot replay across turns); llame-side pruning (duplicates provider
logic and risks dropping blocks the provider still needs); coercing a signed
block to plain text or stripping it on a model switch (the provider already
resolves readability, so llame-side rewriting only converts a working request
into a rejected one).

### D8: Prefix binding is handled by an explicit drop instruction

Anthropic's rule, verbatim: a block "stays valid only while the top-level
`system` prompt, the `tools`, and the messages before it are unchanged. If any of
them changes, that block and every later thinking block are invalid, and the API
rejects the request with a 400 error or drops the invalid blocks, whichever you
choose." Enforcement is default-on for accounts created on or after 2026-08-31 and
opt-in on older accounts through `thinking.block_binding.prefix_mismatch_behavior`.
llame is not append-only — compaction rewrites the prefix, and it can do so
mid-run — so the client sets that behavior explicitly to drop rather than error
and never inherits the account default.

Rationale: a compaction must never convert a working chat into a failed run, and
the behavior must not depend on when the operator's account was created. Rejected:
inheriting the account default (silently errors on some accounts); pruning
thinking blocks llame-side before sending (llame cannot reproduce the provider's
binding rules, so it would drop blocks the provider still accepts); and surfacing
the 400 as a normal run failure (turns a routine compaction into a broken chat).

### D9: Effort maps onto the adapter's thinking option

llame's existing `effort` is one opaque token gated by `resolveEffortSelection`,
which throws `EffortNotAvailableError` (422) when a model declares no `reasoning`
config. The client maps the declared token onto
`providerOptions.anthropic.thinking`, whose option accepts
`{ type: 'adaptive' | 'enabled' | 'disabled' }` with optional `budgetTokens`.
Rationale: the operator-declared vocabulary stays the only vocabulary, and the
existing refusal behavior stays intact. Rejected: adding a `budgetTokens` or
thinking-mode configuration field (a new shape for one provider's option), and
translating declared values into a llame-owned `low`/`medium`/`high` scale.

### D10: Structured output uses the native forced tool choice — no fallback

Issue #208 asked whether the forced-tool-choice mechanism `generateToolBoundObject`
depends on exists for Anthropic, "or design a fallback". It does: the adapter's
`anthropic-prepare-tools.ts` maps `{ type: 'tool', toolName }` to Anthropic's
native `{ type: 'tool', name }`. Rejected: a prompt-injected schema or
text-parsing fallback, which would add a second, weaker generation path for a
capability the adapter already provides.

### D11: Failure boundaries are request-time, bounded, and sanitized

Authentication failures, invalid or unknown models, rate limits, and unsupported
options fail the affected request under the existing run contract, keeping
already-recorded parts and tool effects and never substituting another provider,
credential, or type. Diagnostics follow the existing sanitization contract: no
resolved credentials, no upstream response bodies, no authorization headers.
Rejected: boot probes or credential prevalidation (already rejected system-wide),
automatic retry against another provider (silent substitution), and echoing an
upstream error body to make failures "more debuggable".

### D12: Spec placement

`instance-config`'s provider-list requirement is extended in place: the `type`
enum, the two variant shapes, and the embedding restriction that already names
`openai-codex`. The existing "Unsupported provider type fails at boot" scenario
must change its example from `"anthropic"` (now valid) to a type still outside
the enum; the existing "Subscription provider cannot back embeddings" scenario is
extended rather than duplicated, and the separate embedding-catalog requirement
needs no delta because its clause "`whose type supports embeddings (openai)`"
already rejects both new types at boot.

`available-models` is not modified: its dispatch requirement is still satisfied,
and the `openai-codex` type did not amend it either — its `(this slice: …)`
parenthetical is scoping, not an enumeration. `reasoning-output` is not modified
per D7. The cache-write price field needs no `instance-config` model-catalog
delta because that requirement permits `pricingUsdPer1M` without enumerating its
subfields; the field's behavior is specified in
`anthropic-messages-provider`'s "Cache-write usage is reported and priced".
Rejected: a parallel embedding requirement or a duplicated provider scenario per
type, both of which would fragment one contract across several places.

### D13: The instance-config delta is written against change 1's rewritten text

`openai-compatible-provider` merges first and rewrites the enum clause to split
`openai` from `openai-compatible`. This delta's MODIFIED requirement reproduces
the requirement from that post-merge base, not from today's master text, so a
reviewer does not see the compatible clause dropped. The reproduced scenarios are
rebased the same way (for example the duplicable-providers example no longer
shows a local endpoint as `type: "openai"`). Rejected: writing against today's
master wording (would revert change 1's split at archive time) and waiting for
change 1's artifacts to exist before drafting (would stall the stack for no
design gain). The finalize layer verifies the rebase against the merged text
instead of assuming it.

### D14: Three delivery layers, with #208 closed by the compatible layer

The native layer proves the adapter end to end (streaming, tools, thinking,
caching, cost, failures); the compatible layer adds the second type and the
gateway-specific verification on top; the finalize layer syncs specs and archives.
Rationale: #208's acceptance is about the adapter, but closing it before the
compatible type ships would advertise a type the build cannot execute, and the
compatible path is where an operator gateway can diverge from Anthropic. Rejected:
one combined layer (closes #208 on unproven gateway behavior) and a separate
issue for the compatible type (the brief/settled scope ships both here).

## Risks / Trade-offs

- [Gateways implement the Messages wire format imperfectly] → failures surface at
  request time with bounded diagnostics; the compatible layer carries a live-proof
  task, and the configuration posture deliberately does not speculate about it.
- [A gateway ignores or rejects cache control] → ignoring loses caching without
  failing the run; rejecting fails at request time. Documented rather than gated.
- [Thinking signatures are provider-side state that can break continuations or
  fail after a prefix rewrite] → the drop-on-prefix-mismatch instruction (D8) is
  set explicitly, block order and bytes are preserved on replay, and both the
  within-turn and post-compaction paths carry fixture-covered scenarios.
- [A model declares a wrong `cacheWrite` rate] → cost is only as right as the
  operator's declaration, exactly like `input`/`output`; absent rates fall back to
  input rather than to null, and previously persisted costs are never recomputed
  ("Past cost remains persisted").
- [Delta drift against change 1] → D13 plus a finalize rebase check that reads
  back the amended requirement from the canonical spec after sync.
- [Dependency convergence fails] → the adapter's declared
  `@ai-sdk/provider`/`@ai-sdk/provider-utils` pair matches change 1's bumps; the
  native layer verifies the resolved lockfile rather than assuming.

## Migration Plan

Additive and configuration-only: existing entries and models are untouched;
operators add an `anthropic` or `anthropic-compatible` provider and model entries
that reference it. No database migration and no schema change. Rollback is
removal of the added entries plus a restart; historical runs keep their recorded
model ids and generated-time costs, and queued work naming a removed model
follows the existing unavailable-model contract. The changelog records the
cache-write cost visibility change and the two new provider types.

Because thinking blocks are now persisted and replayed, the migration also
inherits the sibling change's reasoning-metadata amendment: a chat whose history
predates it simply holds no signed blocks to replay, and the first Anthropic turn
on that chat starts persisting them. Nothing prunes or rewrites existing history.

---
summary: "Per-model request settings: providerOptions composition, store: false, output limits, Anthropic thinking and caching defaults, and cache-write pricing"
read_when:
  - you set providerOptions, maxOutputTokens, or pricing on a model entry
  - a provider rejects a request option or a model's thinking or caching behaves unexpectedly
---

# Model request settings

Settings on a `models[]` entry that shape each provider request. They are
server-only and never returned by `GET /api/v1/models`. Wire selection itself
is in [provider routing](routing.md).

## Provider options

`models[].providerOptions` is a server-only free-form object of provider-native
request options for the adapter the model's resolved wire selects, keyed as that
adapter documents them (`reasoningSummary` on the Responses wire,
`reasoningEffort` on Chat Completions, `thinking`/`effort`/`cacheControl` on
the Messages wire); llame places it under the wire's provider-options namespace
itself (`openai` on the Responses wire, `anthropic` on Messages, and on Chat
Completions the configured provider name camel-cased, so `openaiCompletions`
for `openai-completions` and `opencodeGo` for OpenCode Go). Boot validates shape only — the value must be an object, and
`{env:...}`/`{path:...}` syntax in any string value at any depth fails startup
before any token resolves — so the object is not a credential channel and its
contents are never redacted. Every request composes four layers, highest
first: client invariants (the `openai-responses` wire always sends
`store: false`, and a model that declares `reasoning` also sends
`forceReasoning: true`; the Codex client always sends
`reasoningSummary: 'auto'`; the Messages client always sends
`sendReasoning: true` and, on every request that carries adaptive thinking,
the drop-on-prefix-mismatch instruction), the Run's resolved effort when the
model declares `reasoning`, the entry's object, then per-request defaults (the
Responses client defaults `reasoningSummary: 'auto'` on streaming and
compaction and sends none on structured generation; the Messages client
defaults adaptive thinking with summarized display when the model declares
`reasoning`, and the request-level ephemeral cache control on every request).
Objects merge recursively key by key,
while arrays and scalars replace the value beneath them; `null` at any depth
removes a default but never an invariant. Keys that
would change what the request is rather than how the model answers are
stripped before composition: `conversation`, `previousResponseId`,
`instructions`, `systemMessageMode`, and `allowedTools` on the Responses wire
(both `openai-responses` and `openai-codex`); `model`, `max_tokens`, and
`tool_choice` on the Chat Completions wire; `fallbacks`, `mcpServers`,
`container`, and `thinking.blockBinding` on the Messages wire. The adapter
decides the rest at request time: a value it recognizes and rejects fails that
request under the existing failure contract, and an unrecognized key is dropped
by the Responses and Anthropic adapters or forwarded into the request body by
`openai-completions`.

## Stored responses on the Responses wire

The `openai-responses` wire sends `store: false` on every request, so the
provider keeps no response for later retrieval through the API and no request
depends on a provider-side item: an entry's `"store": true` is not sent, and a
later turn sends a stored reasoning part back as an item carrying its
encrypted content, never as a reference to a stored item. A stored reasoning
part that carries an item id and no encrypted content — one stored before this
change — is omitted from the request. This does not change
the provider's own data-retention policy, and an endpoint at another `baseUrl`
follows its own. `store: false` makes the adapter ask for
`reasoning.encrypted_content` on a model it treats as a reasoning model —
every model entry that declares `reasoning`, whatever its model id. A declared
entry whose model id the adapter would not treat as reasoning on its own also
sends the system prompt with the `developer` role, as the adapter does for its
own reasoning models. A model entry that declares no `reasoning` keeps the
adapter's own model-id rule, so `gpt-4.1` asks for no encrypted reasoning
content.

## Output limit

`models[].maxOutputTokens` is an optional positive integer (or whole-value
interpolation token, like `contextWindowTokens`, validated after resolution —
a non-positive or non-integer value fails startup naming the model id and the
field) sent as every request's `maxOutputTokens` setting; absent, the
adapter's own default applies. The
Responses adapter sends it as `max_output_tokens`; the Chat Completions
adapter sends it as `max_tokens` with no `max_completion_tokens` remapping, so
declaring it on an entry fronting a model that requires `max_completion_tokens`
is rejected by that model. The Messages wire requires `max_tokens` on every
request, so the Anthropic adapter fills it from its own model-id table when
the entry declares no limit — 128k for the recognized current models and for
any unrecognized `claude-` id, 64k or 32k for the 4.5 and older 4.x rows, and
4096 for the Claude 3 Haiku, Claude 2, and Claude Instant rows and for any id
that does not contain `claude-`, such as a gateway-served `glm-5` — with
thinking tokens counted against it, and it warns when an unrecognized
`claude-` id takes the 128k branch. A declared limit makes the adapter add a
manual thinking budget to it silently. An adapter may adjust the value as it
documents — for example lowering one above a ceiling it knows for a recognized
model, warned only when the entry declared the limit —
and the warnings it emits surface in the Run. This field caps provider output;
the top-level `runs.maxOutputTokens` remains an admission reserve and does not.
Like `providerOptions`, it is server-only and never returned by
`GET /api/v1/models`.

## Anthropic thinking and caching

The `anthropic-messages` wire owns thinking and caching defaults, and both are
`providerOptions` defaults rather than fixed behavior. When a model entry
declares `reasoning`, the client asks for adaptive thinking with summarized
display, so the owner's effort governs thinking depth and the provider's
summaries stay visible as reasoning parts; `{ "thinking": { "display": null } }`
keeps adaptive thinking but drops the display, a budget-only model gets manual
thinking through `{ "thinking": { "type": "enabled", "budgetTokens": N } }`,
and `{ "thinking": { "type": "disabled" } }` turns it off. Two documented
ceilings follow. First, the drop-on-prefix-mismatch instruction llame sets for
you is carried only on the adaptive shape the pinned adapter emits, so an entry
that declares no `reasoning` sends no thinking configuration and no
instruction, and an operator override to a manual-budget or disabled shape
gives the instruction up for that model: on a model that thinks by default, a
compaction or prompt-receipt change can then be rejected by the provider under
the account's own default enforcement. The remedy is to declare `reasoning`
for such a model. Second, the adapter's effort option is a closed enumeration
of the provider's levels (`low`, `medium`, `high`, `xhigh`, `max`), so an
effort level outside it fails that request at the adapter before any call — a
gateway whose vocabulary is not Anthropic's cannot be driven through this
option — while an operator `effort` on an entry that declares no `reasoning`
is forwarded as written. The adapter may also lower `xhigh`/`max` to `high`
with a warning when thinking is disabled on a model it knows rejects that
combination; the Run surfaces the warning and nothing is retried or rewritten.
Prompt caching is the other default: every request carries the top-level
ephemeral cache control with the provider's 5-minute lifetime, the provider
places and moves the breakpoint itself, and llame authors no block-level
breakpoints. Replace the default with the provider's longer lifetime or remove
it with `cacheControl: null` for a gateway that rejects the option; a gateway
that ignores it simply serves the request without caching.

## Cache-write pricing

`models[].pricingUsdPer1M.cacheWrite` is an optional per-million rate for the
provider's cache-creation tokens. On a wire whose usage reports cache creation
(Anthropic Messages), the adapter's input total already includes them, so cost prices them at that rate when the entry declares one and at the
entry's input rate when it does not, which leaves the computed cost identical
to the result before the field existed. The count is provider-reported and
never inferred or backfilled: a turn that reports none records zero, an
endpoint whose cache-read plus cache-write counts exceed its input total is
bounded to a zero uncached term rather than a negative cost, and a model entry
with no `pricingUsdPer1M` keeps its unknown-cost contract (`costUsd: null`).
The web usage panel shows the count as an `of which cache write` row beneath
Input, the way cached input is shown.

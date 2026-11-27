---
summary: "Per-model request settings: providerOptions composition, store: false, output limits, Anthropic thinking and caching defaults, and cache-write pricing"
read_when:
  - you set providerOptions, maxOutputTokens, or pricing on a model entry
  - a provider rejects a request option or a model's thinking or caching behaves unexpectedly
---

# Model request settings

Settings on a `models[]` entry shape each provider request.
`providerOptions` and `maxOutputTokens` are server-only. They are never returned by
`GET /api/v1/models`. The endpoint does return declared pricing rates, including
`cacheWrite`. See [provider routing](routing.md) for wire selection.

## Provider options

`models[].providerOptions` is a server-only free-form object of provider-native
request options. The model's resolved wire selects the adapter. Use option names
from that adapter's documentation. Examples include `reasoningSummary` on the
Responses wire, `reasoningEffort` on Chat Completions, and
`thinking`/`effort`/`cacheControl` on the Messages wire.

llame places the options under the wire's provider-options namespace. It uses
`openai` on the Responses wire and `anthropic` on Messages. On Chat Completions,
llame camel-cases the configured provider name. For example, it uses
`openaiCompletions` for `openai-completions` and `opencodeGo` for OpenCode Go.

Boot validates only the shape. The value must be an object. Any string value at
any depth that uses `{env:...}` or `{path:...}` syntax fails startup before
token resolution. The object is not a credential channel. llame never redacts
its contents.

Every request composes four layers, in order of highest priority:

1. Client invariants.
2. The Run's resolved effort, when the model declares `reasoning`.
3. The entry's object.
4. Per-request defaults.

Client invariants include these settings:

- The `openai-responses` wire always sends `store: false`.
- A model that declares `reasoning` also sends `forceReasoning: true`.
- The Codex client always sends `reasoningSummary: 'auto'`.
- The Messages client always sends `sendReasoning: true`.
- On every request with adaptive thinking, the Messages client sends the
  drop-on-prefix-mismatch instruction.

Per-request defaults include these settings:

- The Responses client defaults `reasoningSummary: 'auto'` on streaming and
  compaction. It sends no `reasoningSummary` on structured generation.
- When the model declares `reasoning`, the Messages client defaults to adaptive
  thinking with summarized display.
- The Messages client applies request-level ephemeral cache control to every
  request.

Objects merge recursively, key by key. Arrays and scalars replace the value
beneath them. At any depth, `null` removes a default but never an invariant.
Before composition, llame strips keys that would change the request rather than
how the model answers.

- Responses wire keys: `conversation`, `previousResponseId`, `instructions`,
  `systemMessageMode`, and `allowedTools`. This applies to both
  `openai-responses` and `openai-codex`.
- Chat Completions wire keys: `model`, `max_tokens`, and `tool_choice`.
- Messages wire keys: `fallbacks`, `mcpServers`, `container`, and
  `thinking.blockBinding`.

At request time, the adapter handles the remaining options. A recognized but
rejected value fails that request under the existing failure contract. The
Responses and Anthropic adapters drop unrecognized keys. The
`openai-completions` adapter forwards unrecognized keys into the request body.

## Stored responses on the Responses wire

The `openai-responses` wire sends `store: false` on every request. The provider
keeps no response for later retrieval through the API. No request depends on a
provider-side item. The wire does not send an entry's `"store": true`.

Later turns send stored reasoning parts back as items with encrypted content.
They never send references to stored items. A stored reasoning part that has an
item id but no encrypted content was stored before this change. The adapter
omits that part from the request.

This setting does not change the provider's data-retention policy. An endpoint
at another `baseUrl` follows its own policy.

`store: false` makes the adapter request `reasoning.encrypted_content` for a
model it treats as a reasoning model. The adapter treats every model entry
that declares `reasoning` as a reasoning model, regardless of its model id.

A declared entry whose model id the adapter would not otherwise treat as a
reasoning model also sends the system prompt with the `developer` role. The
adapter does this for its own reasoning models. A model entry without
`reasoning` keeps the adapter's own model-id rule. For example, `gpt-4.1`
requests no encrypted reasoning content.

## Output limit

`models[].maxOutputTokens` accepts an optional positive integer or whole-value
interpolation token, like `contextWindowTokens`. llame validates the resolved
value. A non-positive or non-integer value fails startup and names the model id
and field. llame sends the value as each request's `maxOutputTokens` setting.
When the field is absent, the adapter's own default applies.

The Responses adapter sends the setting as `max_output_tokens`. The Chat
Completions adapter sends it as `max_tokens` without remapping it to
`max_completion_tokens`. A model that requires `max_completion_tokens` rejects
an entry that declares this setting.

The Messages wire requires `max_tokens` on every request. If the entry declares
no limit, the Anthropic adapter fills it from its own model-id table. It uses
128k for recognized current models and unrecognized `claude-` ids. It uses 64k
or 32k for the 4.5 and older 4.x rows. It uses 4096 for the Claude 3 Haiku,
Claude 2, and Claude Instant rows. It also uses 4096 for ids without
`claude-`, such as a gateway-served `glm-5`. Thinking tokens count against the
limit. The adapter warns when an unrecognized `claude-` id takes the 128k
branch.

When an entry declares a limit, the adapter silently adds a manual thinking
budget. The adapter may adjust the value as its documentation describes. For
example, it may lower a value above a ceiling it knows for a recognized model.
It warns only when the entry declared the limit. The Run surfaces these
warnings. This field caps provider output. The top-level
`runs.maxOutputTokens` remains an admission reserve and does not cap output.
Like `providerOptions`, this field is server-only. It is never returned by
`GET /api/v1/models`.

## Anthropic thinking and caching

The `anthropic-messages` wire owns thinking and caching defaults. Both are
`providerOptions` defaults, not fixed behavior. When a model entry declares
`reasoning`, the client asks for adaptive thinking with summarized display.
The owner's effort governs thinking depth. The provider's summaries stay
visible as reasoning parts.

An operator can set `{ "thinking": { "display": null } }` to keep adaptive
thinking but drop its display. A budget-only model gets manual thinking through
`{ "thinking": { "type": "enabled", "budgetTokens": N } }`. An operator can
turn thinking off with `{ "thinking": { "type": "disabled" } }`.

Two documented ceilings apply. First, llame's drop-on-prefix-mismatch
instruction is carried only on the adaptive shape emitted by the pinned
adapter. An entry that declares no `reasoning` sends no thinking configuration
and no instruction. An operator override to a manual-budget or disabled shape
also gives up the instruction for that model.

On a model that thinks by default, the provider can then reject a compaction or
prompt-receipt change under the account's own default enforcement. Declare
`reasoning` for such a model to avoid this.

Second, the adapter's effort option uses a closed enumeration of the provider's
levels: `low`, `medium`, `high`, `xhigh`, and `max`. A level outside that
enumeration fails the request at the adapter before any call. A gateway whose
vocabulary differs from Anthropic's cannot use this option. However, the
adapter forwards an operator `effort` unchanged when the entry declares no
`reasoning`.

When thinking is disabled on a model that the adapter knows rejects that
combination, the adapter may lower `xhigh` or `max` to `high` with a warning.
The Run surfaces the warning. llame does not retry or rewrite the request.

Prompt caching is the other default. Every request carries top-level ephemeral
cache control with the provider's 5-minute lifetime. The provider places and
moves the breakpoint. llame authors no block-level breakpoints. Replace the
default with the provider's longer lifetime, or set `cacheControl: null` to
remove it for a gateway that rejects the option. A gateway that ignores the
option serves the request without caching.

## Cache-write pricing

`models[].pricingUsdPer1M.cacheWrite` is an optional rate per million provider
cache-creation tokens. Anthropic Messages and OpenAI Responses report cache
creation. Chat Completions reports none.

On a wire that reports cache creation, the adapter's input total already
includes those tokens. When the entry declares a cache-write rate, cost uses
that rate for cache-creation tokens. Otherwise, cost uses the entry's input
rate. The latter leaves computed cost identical to the result before this
field existed.

The adapter uses provider-reported counts. It never infers or backfills them.
A turn that reports no count records zero. If an endpoint reports cache-read
plus cache-write counts above its input total, llame bounds the uncached term
to zero rather than allowing a negative cost. A model entry without
`pricingUsdPer1M` keeps its unknown-cost contract (`costUsd: null`).

The web usage panel shows the count in an `of which cache write` row beneath
Input, as it does for cached input.

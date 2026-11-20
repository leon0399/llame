---
summary: "Sharing a provider account across model kinds and selecting each model's wire"
read_when:
  - you are configuring providers and model catalogues
  - a model fails startup because its wire cannot be resolved
---

# Provider accounts and model wires

Declare credentials, headers, and an API base once on a provider. Each entry in
`models`, `embeddingModels`, `decisionModels`, or `rerankModels` references that
provider and may set `wire`. Startup resolves the wire before accepting work;
this performs no network discovery or model eligibility check.

| Provider type  | Chat default         | Other default kinds                                          | Default API base                      |
| -------------- | -------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `openai`       | `openai-responses`   | `openai-embeddings`                                          | `https://api.openai.com/v1`           |
| `anthropic`    | `anthropic-messages` | None                                                         | `https://api.anthropic.com/v1`        |
| `openrouter`   | `openai-completions` | `openai-embeddings`, `openrouter-decisions`, `cohere-rerank` | `https://openrouter.ai/api/v1`        |
| `opencode-zen` | Exact model metadata | `system-one`                                                 | `https://opencode.ai/zen/v1`          |
| `opencode-go`  | Exact model metadata | None                                                         | Fixed `https://opencode.ai/zen/go/v1` |

OpenCode routes use exact `(provider type, providerModelId)` entries from a
bundled snapshot of [OpenCode's model catalog](https://github.com/anomalyco/opencode/blob/cdd0585e048b08d85df1f854b7deb3fa52b8dac4/packages/core/src/models-dev/snapshot.txt).
The importer normalizes the model's first declared API to llame's wire names:
`anthropic-messages`, `openai-responses`, or `openai-completions`.
No prefix, suffix, or sibling-provider inference is performed.
For example, Go `minimax-m3` selects Messages while `minimax-m3.1-flash`
selects Chat Completions.

Unknown models and entries recorded as `null` require an explicit supported
`wire`. The current unsupported protocol is Google's native Generate Content,
tracked in [#1741](https://github.com/leon0399/llame/issues/1741); those entries
stay `null` until its adapter ships. The importer rejects any newly encountered
protocol so it gets a support decision and tracking issue instead of a guessed wire.
The snapshot supplies protocol metadata only: it does not enable models,
change credential destinations, or promise subscription eligibility.
Startup makes no catalog request, and the snapshot does not refresh itself.
To import a newer reviewed OpenCode snapshot, run from the repository root:

```bash
node apps/api/scripts/update-provider-model-wires.mts <full-opencode-commit-sha>
```

Commit the generated `apps/api/src/instance-config/provider-model-wires.json`
with its source URL and SHA-256. An explicit model `wire` always takes
precedence, including when a provider route changes before the next release.

Explicit endpoint profiles remain available: `openai-responses`,
`openai-completions`, `anthropic-messages`, `system-one`, and `cohere-rerank`.
They default to their named wire; both OpenAI profiles also support embeddings.
`openai-codex` remains a separate fixed subscription transport and cannot be
selected by another account's wire override.

## One OpenCode Go account, different native APIs

Claude and GPT models can share one `opencode-go` provider and API key.
No per-model `wire` is needed for these models present in the snapshot:

```jsonc
{
  "providers": [
    { "id": "go", "type": "opencode-go", "key": "{env:OPENCODE_API_KEY}" },
  ],
  "models": [
    {
      "id": "claude",
      "provider": "go",
      "providerModelId": "claude-haiku-5-5",
      "contextWindowTokens": 200000,
    },
    {
      "id": "gpt",
      "provider": "go",
      "providerModelId": "gpt-5.6-luna",
      "contextWindowTokens": 200000,
    },
    {
      "id": "glm",
      "provider": "go",
      "providerModelId": "glm-5.3-flash",
      "contextWindowTokens": 200000,
    },
  ],
}
```

The selected model determines the request protocol and path:

| Model              | Wire               | Request URL                                      | Credential header         |
| ------------------ | ------------------ | ------------------------------------------------ | ------------------------- |
| `claude-haiku-5-5` | Anthropic Messages | `https://opencode.ai/zen/go/v1/messages`         | `x-api-key`               |
| `gpt-5.6-luna`     | OpenAI Responses   | `https://opencode.ai/zen/go/v1/responses`        | `Authorization: Bearer …` |
| `glm-5.3-flash`    | Chat Completions   | `https://opencode.ai/zen/go/v1/chat/completions` | `Authorization: Bearer …` |

All three use the same resolved account key and retain Go's session headers
and redirect rejection. The model names illustrate routing; substitute models
and context limits your subscription supports. Routing does not grant access
to a model, and these examples do not attest to live provider availability.

For OpenCode Zen, change the provider's `type` to `opencode-zen` and choose
model identifiers in its own catalog. Zen uses `https://opencode.ai/zen/v1`;
a model being listed for Zen does not make it known to Go.

Messages requests require an output limit. Without `maxOutputTokens`, the
Anthropic adapter defaults non-Claude identifiers to 4,096 output tokens,
including thinking. This affects Go `minimax-m3` and `qwen3.8-flash`, for
example, even though the previous Completions route sent no output cap.
Declare `models[].maxOutputTokens` at a limit the provider supports when
using these models for long answers, compaction, or large tool arguments.
Routing metadata selects the wire only; it does not import token limits.

## One OpenRouter account

This fragment demonstrates all four catalogues. Substitute model identifiers
and context limits supported by your account; the gateway decides availability.

```jsonc
{
  "providers": [
    { "id": "router", "type": "openrouter", "key": "{env:OPENROUTER_API_KEY}" },
  ],
  "models": [
    {
      "id": "chat",
      "provider": "router",
      "providerModelId": "anthropic/claude-sonnet-4.6",
      "contextWindowTokens": 200000,
    },
  ],
  "embeddingModels": [
    {
      "id": "embed",
      "provider": "router",
      "providerModelId": "openai/text-embedding-3-small",
      "dimensions": 1536,
    },
  ],
  "decisionModels": [
    { "id": "decide", "provider": "router", "providerModelId": "system-one" },
  ],
  "rerankModels": [
    { "id": "rank", "provider": "router", "providerModelId": "rerank" },
  ],
}
```

Chat calls use `/chat/completions`, embeddings `/embeddings`, and reranking
`/rerank` under the configured API base. A decision model's resolved wire picks
its endpoint, never the provider type. `openrouter-decisions` uses the sibling
`/alpha/decisions` endpoint: `/api/v1` becomes `/api/alpha/decisions`, and a
base without a trailing `/v1` gets `/alpha/decisions` appended. `system-one`
appends `/systemone` to the API base, so `"wire": "system-one"` on an
`openrouter` decision model posts to `/api/v1/systemone` from the same
account.

## Explicit overrides and failures

Set `wire` on the model, not on a duplicate provider. Chat permits
`openai-responses`, `openai-completions`, or `anthropic-messages`. Embeddings
permit `openai-embeddings`, decisions `system-one` or
`openrouter-decisions`, and rerankers
`cohere-rerank`. An explicit supported wire can describe a custom gateway's
extra kind; Go remains chat-only and Zen chat-or-decision-only. An unsupported
kind/wire pair or missing model metadata fails startup naming the model's
`.wire` field. A decision model also requires a nonblank account key.

The override never changes the account's base URL. Provider options follow
the resolved adapter's namespace and existing precedence. A provider that
rejects the selected protocol fails the request; llame does not retry another
wire or account. The normalized server configuration contains the selected
wire; the public model catalogue does not expose account routing metadata.

Credentials keep their existing interpolation and redaction rules. Static
account headers also reach embeddings and ranking requests. Headers containing
`{session:id}` are omitted for those calls because they have no Chat identity;
Chat, title generation, and compaction retain their existing identity rules.

## Diagnosing failed model requests

A failed Run records the model request's failure class in `error.code` and its
`run.failed` event. Existing context incompatibility codes remain unchanged.
The class survives credential redaction; messages keep their wire-specific bounds.
Eligible model requests retry within the same Run attempt: after the initial
send, llame makes up to 10 retries with full jitter (500 ms exponential base,
capped at 8 s). Short provider delay hints and authoritative reset instants up
to 60 s are honored. Long rate-limit hints fail the request, long delay hints
for other failures are ignored. A step request with a classified quota or rate
limit and an authoritative reset more than 60 s away can wait durably within
`runs.quotaWaitMaxSeconds` (eight days by default), without occupying a worker.
The deadline sends again after reset plus 60 s and up to 18 s of jitter. Stop
cancels the wait; other deliveries remain pending. A missing or over-cap reset
fails the request. Side calls do not park a Run.

Completed tool calls are never replayed. Buffered title and summary requests
discard failed output before retrying. A durable `model.retrying` event records
the failure class, retry number, and delay; the owner sees a retry line.
The first-token timeout defaults to 300 s and includes response headers and
metadata until content begins. After content begins, 300 s without a stream
part fails the request. A first-token timeout is `first_token_timeout`; a
broken stream is `stream_broken`. `model_stream_idle` has been removed.
For a non-streaming structured request, the first-token deadline covers the
complete send. A deadline expiry aborts that send and follows the same bounded
`first_token_timeout` retry policy.

| Failure class                               | Operator action                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `quota_exhausted`                           | Check the account's usage window or spend cap. `error.resetsAt`, when present, is the provider's reset instant in Unix milliseconds. |
| `billing`                                   | Restore credits or model entitlement; waiting does not clear the rejection.                                                          |
| `rate_limited`                              | Reduce request pressure or honor the provider's stated delay.                                                                        |
| `overloaded`, `server_error`, `unreachable` | Check provider health and connectivity.                                                                                              |
| `first_token_timeout`, `stream_broken`      | Check whether the provider can finish a response within the stream windows.                                                          |
| `model_not_found`                           | Correct the provider model identifier or endpoint.                                                                                   |
| `auth`                                      | Check the configured credential and its permissions.                                                                                 |
| `context_overflow`                          | Check the model's context limit and compaction settings.                                                                             |
| `invalid_request`                           | Check model options against the selected wire.                                                                                       |
| `content_policy`                            | Inspect the provider's rejection without changing credentials or routes.                                                             |
| `unknown`                                   | Use the bounded failure message; llame recognized no more specific class.                                                            |

This classification does not infer a reset from calendar rules or provider prose.
A bare `Retry-After` is a delay hint. Codex resets name an exhausted usage window;
Anthropic and OpenAI resets name an exhausted request or token bucket; OpenRouter
budget resets come from its structured budget metadata. OpenCode Go's typed usage
limit can supply a reset through `Retry-After` on any of its supported wires.

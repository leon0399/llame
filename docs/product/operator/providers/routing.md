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

| Provider type  | Chat default         | Other default kinds                                | Default API base                      |
| -------------- | -------------------- | -------------------------------------------------- | ------------------------------------- |
| `openai`       | `openai-responses`   | `openai-embeddings`                                | `https://api.openai.com/v1`           |
| `anthropic`    | `anthropic-messages` | None                                               | `https://api.anthropic.com/v1`        |
| `openrouter`   | `openai-completions` | `openai-embeddings`, `system-one`, `cohere-rerank` | `https://openrouter.ai/api/v1`        |
| `opencode-zen` | Known family         | `system-one`                                       | `https://opencode.ai/zen/v1`          |
| `opencode-go`  | Known family         | None                                               | Fixed `https://opencode.ai/zen/go/v1` |

OpenCode family defaults select Messages for `claude-*`, `union-alpha`, and
`qwen*`; Responses for `gpt-*`, `grok-*`, and `muse-spark-*`; and Completions
for `glm-*`, `kimi-*`, `deepseek-*`, and `minimax-*`. Go has three pins ahead
of those defaults: `deepseek-v4-flash` selects Responses, and `qwen3.5-plus`
and `qwen3.6-plus` select Completions. Unknown families require an explicit
wire. These rules choose a protocol, not subscription eligibility.

Explicit endpoint profiles remain available: `openai-responses`,
`openai-completions`, `anthropic-messages`, `system-one`, and `cohere-rerank`.
They default to their named wire; both OpenAI profiles also support embeddings.
`openai-codex` remains a separate fixed subscription transport and cannot be
selected by another account's wire override.

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
    { "id": "decide", "provider": "router", "model": "system-one" },
  ],
  "rerankModels": [{ "id": "rank", "provider": "router", "model": "rerank" }],
}
```

Chat calls use `/chat/completions`, embeddings `/embeddings`, and reranking
`/rerank` under the configured API base. OpenRouter decisions use the sibling
`/alpha/decisions` endpoint: `/api/v1` becomes `/api/alpha/decisions`. A custom
base without a trailing `/v1` gets `/alpha/decisions` appended. Other decision
profiles append `/systemone` to their API base.

## Explicit overrides and failures

Set `wire` on the model, not on a duplicate provider. Chat permits
`openai-responses`, `openai-completions`, or `anthropic-messages`. Embeddings
permit `openai-embeddings`, decisions `system-one`, and rerankers
`cohere-rerank`. An explicit supported wire can describe a custom gateway's
extra kind; Go remains chat-only and Zen chat-or-decision-only. An unsupported
kind/wire pair or missing family default fails startup naming the model's
`.wire` field. A decision model also requires a nonblank account key.

The override never changes the account's base URL. Provider options follow
the resolved adapter's namespace and existing precedence. A provider that
rejects the selected protocol fails the request; llame does not retry another
wire or account. The normalized server configuration contains the selected
wire; the public model catalogue does not expose account routing metadata.

Credentials keep their existing interpolation and redaction rules. Static
account headers also reach embeddings and ranking requests. Headers containing
`{session:id}` are omitted for those calls because they have no Chat identity;
chat, title generation, and compaction retain their existing identity rules.

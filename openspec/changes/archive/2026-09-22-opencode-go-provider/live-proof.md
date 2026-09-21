# Live proof — `opencode-go`

Bounded run against the real gateway with an operator subscription key, as
task 3.8 requires. No credential, workspace, or account value is printed here;
the `Authorization` header was redacted at capture time and every other header
is reproduced verbatim.

## Setup

| Fact     | Value                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Date     | 2026-09-22                                                                                             |
| Endpoint | `https://opencode.ai/zen/go/v1` (every request: `/chat/completions`)                                   |
| Models   | `glm-5.3-flash`; `grok-4.6` and one undeclared id for the failure cases                                |
| Client   | `apps/api/dist/models/opencode-go-model-client.js` from `pnpm --filter api build` on this layer's head |
| Versions | `ai@6.0.256`, `@ai-sdk/openai-compatible@2.0.75`, `@ai-sdk/provider-utils@4.0.51`, node 22             |
| Chat id  | a synthetic v4 UUID, `3f2a9c11-…-6a1c2d3e4f50`, used for every lane                                    |

The built client was driven directly, so what follows is the shipped
composition — the completions module, the Go base URL, the fixed headers, the
session renderer, and the redirect-rejecting `fetch` — not a test double.

## Observations

### Destination and identity

Every one of the twelve requests went to
`https://opencode.ai/zen/go/v1/chat/completions`, and the client reported
`provider: "opencode-go"` with `model: "system:opencode-go:glm-5.3-flash"`.

### Headers

Streaming request:

```text
user-agent: llame/0.0.1 ai-sdk/provider-utils/4.0.51 runtime/node.js/22
x-opencode-client: llame
x-opencode-session: 3f2a9c11-…-6a1c2d3e4f50
```

Structured request (the title path):

```text
user-agent: llame/0.0.1 ai/6.0.256 ai-sdk/provider-utils/4.0.51 runtime/node.js/22
x-opencode-client: llame
x-opencode-session: title:3f2a9c11-…-6a1c2d3e4f50
```

This is design D6's claim observed on the wire: llame's product token leads
both values, and on the structured path the SDK's own `ai/6.0.256` follows it
rather than replacing it. No `x-opencode-request`, `x-opencode-project`,
`X-Session-Id`, or `x-session-affinity` was sent on any request.

Session values across the whole run: eleven requests carried the Chat's id
verbatim, one carried `title:<id>` — the title request. The compaction request
carried the same value as the turn.

### Streaming text

`llame live proof ok`, with usage `{ inputTokens: 22, outputTokens: 59 }`.

### Authorized tool round trip

A `get_weather` tool was offered and called; the model answered
`It's 11°C and overcast in Riga.` over two steps, with the tool call recorded
in step one and the answer in step two.

### Cancellation

Aborting mid-stream settled as `DOMException: This operation was aborted`; no
further request was issued.

### Title generation

`generateObject` returned `{ title: "Proof Run: OpenCode Go Gateway" }` on the
`title` lane.

### Compaction

A summarization request on the `main` lane returned a one-sentence summary and
carried the turn's own session value, which is the point of sharing the lane.

### Prefix reuse

A ~860-token prefix was sent, then re-sent with a follow-up question; the model
answered from the prefix (`The token was **ZK-42**.`). The gateway reported
`prompt_tokens_details.cached_tokens: 0` on both requests, so **no cache reuse
was observed in this window**. Later requests also carried
`prompt_tokens_details.cache_write_tokens: null`. llame records the usage the
gateway reports and neither requests nor infers caching (D8), so this is a
successful request either way; it is recorded because the design cites the
gateway's session-keyed caching as the header's purpose, and this run does not
demonstrate it.

## Failure shapes observed

Each was captured from the error the client delivered to `onError` — the value
the run loop records as the failure message.

| Case                                     | Class          | Status | Message                                                                                                |
| ---------------------------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `grok-4.6` on the Chat Completions route | `RetryError`   | —      | `Failed after 3 attempts. Last error: Upstream request failed: Endpoint is unavailable.`               |
| Invalid credential                       | `APICallError` | 401    | `Invalid API key.` (body `{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}`) |
| Undeclared model id                      | `APICallError` | 400    | `Upstream request failed: Model is unavailable.`                                                       |

Three things follow, and the runbook records them:

1. **The route ceiling surfaces as an upstream-unavailable message, not as a
   format-gate message.** The design predicted the gateway's
   "not supported for format" text from its open-source handler; what this
   gateway returned for `grok-4.6` on `/chat/completions` today is
   `Upstream request failed: Endpoint is unavailable.`, retried three times by
   the SDK before surfacing. The remedy is unchanged — that model needs the
   `/responses` route, which is #904 — but an operator matching on the message
   text will see this one.
2. **Retries are the SDK's.** The `RetryError` names three attempts; llame
   added no retry of its own and fell back to no other provider, wire, or
   model.
3. **The parsed message is what surfaces.** The 401 body carried the gateway's
   envelope and the failure message was its `error.message` alone. No
   credential, header, or request body reached the message.

No usage-limit rejection occurred during this run, so the 429 /
`GoUsageLimitError` shape remains unobserved; the runbook states it as the
gateway's documented behavior rather than as something llame has seen.

## Catalogue note

`GET /zen/go/v1/models` returned 33 models, including `glm-5.3-flash`,
`deepseek-v4.1-flash`, and `grok-4.6`. Each entry carries only
`{ id, object, created, owned_by }` — no context window, no output cap, no
pricing. The example configuration's `contextWindowTokens` is therefore an
operator-declared value, which is exactly the posture D10 describes: the
catalogue is operator-declared, and a fetched catalogue is #903.

# Anthropic Messages live proof

Date: 2026-09-20T22:33:51+02:00

## Runtime

- Endpoint: first-party Anthropic Messages API through the configured default `https://api.anthropic.com/v1` endpoint.
- Adaptive workload: `claude-sonnet-5`, the lowest-cost model available to the credential that supports adaptive thinking and effort.
- Lowest-cost workload: `claude-haiku-4-5-20251001`, used for the entry without a reasoning declaration, native structured title generation, and cancellation.
- Compatibility probe: `claude-sonnet-4-6`, limited to one short request needed to check the proposal's `display` risk.
- SDK: `ai@6.0.256`, `@ai-sdk/anthropic@3.0.118`; the Anthropic adapter resolves `@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51`.
- Credential: loaded from the ignored local environment file through `{env:ANTHROPIC_API_KEY}`. No credential or resolved value was printed or recorded.

## Method

A one-off Vitest integration harness booted the real Nest application against a provisioned Postgres database and the temporary operator configuration. It used the authenticated chat HTTP surface, the real Run loop, the configured model clients, the built-in `search_conversations` tool, durable message/run/compaction repositories, and the run cancellation endpoint. The harness was removed after the evidence below was recorded.

## Outcomes

- Streaming text completed through the chat surface; the measured proof turn streamed 316 text characters.
- Adaptive thinking with `effort: "max"` produced 499 visible summarized-reasoning characters. The persisted reasoning part retained Anthropic provider metadata.
- The authorized `search_conversations` call completed and persisted an `output-available` tool result before the model's final answer.
- Native structured output returned a schema-valid title through `generateObject`; the asynchronous title path also persisted a generated chat title using the configured Haiku title model.
- The Haiku entry declared no reasoning vocabulary and completed with no reasoning stream or persisted reasoning part. Because Haiku 4.5 does not support adaptive thinking, the successful request also proves that llame sent no default adaptive-thinking configuration for that entry.
- The first cacheable Sonnet request persisted 8,710 cache-write tokens and a `$0.029959` total cost. At the configured `$2.50/MTok` cache-write rate, those tokens contributed `$0.021775`; pricing them at the `$2.00/MTok` input-rate fallback would have contributed `$0.017420`, a `$0.004355` difference. A reused prefix subsequently reported 10,501 cache-read tokens.
- Compaction rewrote the prefix through a durable row with `uptoSeq: 2`; the next Sonnet turn completed under the adaptive drop-on-prefix-mismatch instruction.
- A live Haiku request reached `running_model`, was cancelled through `PATCH /api/v1/runs/:id`, and settled durably as `cancelled`.
- The minimal Sonnet 4.6 adaptive request completed with the client's default `display: "summarized"`; the first-party API accepted `display` on that generation at proof time.

The focused live harness passed in 52.01 seconds. No provider failure required a proposal revision.

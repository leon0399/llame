## Native OpenAI live spike — 2026-07-15

The probe used `openai(model)` with `providerOptions.openai.reasoningSummary = "auto"`, configured provider credentials/base URL, and a maximum of 900 output tokens. It sent two deliberately hard mathematical prompts to each model and recorded only chunk types and usage.

| Model                        | Attempts | Observed result                                                                                                                         |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `system:openai:gpt-5.4-mini` | 2        | Both completed with text chunks only and `reasoningTokens: 0`. Inconclusive, not a failure.                                             |
| `system:openai:gpt-5.5`      | 1        | Completed with `reasoning-start`, `reasoning-delta`, and `reasoning-end`; 437 displayable reasoning characters and 49 reasoning tokens. |

This proves the native OpenAI Responses request shape used by this change. It does not establish extraction behavior for OpenRouter, Hugging Face, or another compatible endpoint.

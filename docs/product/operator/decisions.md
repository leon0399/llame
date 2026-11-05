---
summary: "Enabling the experimental System One decision lane: the system-one provider type, the decisions block, its model ids and pricing, the rerank modes, and what a failure means"
read_when:
  - you are wiring a Jev / System One decision endpoint into llame
  - you are enabling shadow or live reranking of web_search or grep results
  - a decision call failed and you need to know whether the output changed
---

# Decisions

**Experimental.** A decision model answers typed questions over one state in a
single forward pass and returns probabilities instead of generated text. This
lane lets a tool rank its own candidates by asking one yes/no question per
candidate. Nothing is enabled by default: without a `decisions` block no client
is built, no request is sent, and every tool keeps its canonical order.

The lane is a **side call**. Its tokens and cost are logged on one
`decision.completed` line, never folded into a Run's message usage, exactly as
title generation and hosted search are excluded.

## Enabling

Two pieces: a provider entry of type `system-one`, and the `decisions` block
naming it.

```jsonc
{
  "providers": [
    {
      "id": "opencode-decisions",
      "type": "system-one",
      "key": "{env:OPENCODE_API_KEY}",
      "baseUrl": "https://opencode.ai/zen/v1",
    },
  ],
  "decisions": {
    "provider": "opencode-decisions",
    "model": "jev-1.13",
    "pricingUsdPer1M": { "input": 0.042 },
    "rerank": { "webSearch": "off", "grep": "off" },
  },
}
```

`type: "system-one"` posts to `{baseUrl}/systemone` with a bearer `key`. Both
`key` and `baseUrl` are required and must resolve nonblank; an entry that
interpolates to empty fails startup naming the entry and the field. The type
never serves a `models[]` entry — a `models[]` entry that names one fails with
"is a System One decision provider, not a model client".

Routes verified on 2026-11-05 (same request and response JSON on each):

| Route      | `baseUrl`                      | Model ids                                   |
| ---------- | ------------------------------ | ------------------------------------------- |
| OpenCode   | `https://opencode.ai/zen/v1`   | `jev-1.13`, `jev-1.13-free`                 |
| OpenRouter | `https://openrouter.ai/api/v1` | `typesafe/jev-1.14`, `~typesafe/jev-latest` |
| TypeSafe   | `https://api.typesafe.ai/v1`   | `jev-latest`, `jev-1.14.0`                  |

An alias is not a revision: the response reports the model that answered, and
that id is what the log line records. Pin a versioned id when thresholds are
tuned.

## Rerank modes

`rerank.webSearch` and `rerank.grep` accept `off` (default), `shadow`, or `on`.

- `off` never calls the decision model.
- `shadow` computes and logs the order and leaves the tool output unchanged.
- `on` applies the order before the inline cap and the artifact are built.

A rerank only reorders candidates; it never adds or drops one, so the result
count and the `left out` notice are unchanged.

## Cost and failure

`pricingUsdPer1M.input` is the fallback price for a wire that reports no
`usage.cost` (the native TypeSafe wire). A reported cost always wins, and an
unpriced, unreported call logs `costUsd: null`.

A decision call never fails the tool call that asked. A timeout (10 s per
attempt, 3 attempts on 408/429/5xx and transport errors, `retry-after` honoured
up to 5 s), an exhausted retry, or a bad key leaves those candidates
**unjudged**, and they keep their canonical order. A malformed response — a
missing answer, an answer of the wrong type, or a probability outside `[0, 1]`
— makes the whole call `unavailable` and changes nothing.

**Unavailable is not a negative judgment.** A model that could not answer says
nothing about relevance; never read a failed call as "irrelevant".

Requests carry at most 48 questions (one per candidate) with at most 4 in
flight; a larger batch is chunked and the answers merged. A failed chunk leaves
only its own candidates unjudged.

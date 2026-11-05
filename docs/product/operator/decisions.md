---
summary: "Enabling the experimental System One decision lane: the system-one provider type, the decision-model catalogue, the per-tool rerank blocks for web_search and grep, pricing, and what a failure means"
read_when:
  - you are wiring a Jev / System One decision endpoint into llame
  - you are enabling shadow or live reranking of web_search or grep results
  - a decision call failed and you need to know whether the output changed
---

# Decisions

**Experimental.** A decision model answers typed questions over one state in a
single forward pass and returns probabilities instead of generated text. This
lane lets a tool rank its own candidates by asking one yes/no question per
candidate. Nothing is enabled by default: without a `decisions` catalogue no
client is built, no tool has a rerank setting, and every tool keeps its
canonical order.

Two layers, and they do not overlap. `decisions` is a **catalogue** of decision
models: it says which providers and model ids exist. Each **tool** decides for
itself whether it reranks and which catalogue entry judges it, through its own
`rerank` block (`webSearch.rerank`, `tools.grep.rerank`).

The lane is a **side call**. Its tokens and cost are logged on one
`decision.completed` line, never folded into a Run's message usage, exactly as
title generation and hosted search are excluded.

## 1. A provider of type `system-one`

`type: "system-one"` posts to `{baseUrl}/systemone` with a bearer `key`. Both
`key` and `baseUrl` are required and must resolve nonblank; an entry that
interpolates to empty fails startup naming the entry and the field. The type
never serves a `models[]` entry — a `models[]` entry that names one fails with
"is a System One decision provider, not a model client".

```jsonc
{
  "providers": [
    {
      "id": "openrouter-decisions",
      "type": "system-one",
      "key": "{env:OPENROUTER_API_KEY}",
      "baseUrl": "https://openrouter.ai/api/v1",
    },
  ],
}
```

Routes verified on 2026-11-05 (same request and response JSON on each):

| Route      | `baseUrl`                      | Model ids                                   |
| ---------- | ------------------------------ | ------------------------------------------- |
| OpenRouter | `https://openrouter.ai/api/v1` | `typesafe/jev-1.14`, `~typesafe/jev-latest` |
| OpenCode   | `https://opencode.ai/zen/v1`   | `jev-1.13`, `jev-1.13-free`                 |
| TypeSafe   | `https://api.typesafe.ai/v1`   | `jev-latest`, `jev-1.14.0`                  |

An alias is not a revision: the response reports the model that answered, and
that id is what the log line records. Pin a versioned id when thresholds are
tuned.

## 2. The decision-model catalogue

```jsonc
{
  "decisions": {
    "models": [
      {
        "id": "jev-openrouter",
        "provider": "openrouter-decisions",
        "model": "~typesafe/jev-latest",
        "pricingUsdPer1M": { "input": 0.042 },
      },
    ],
  },
}
```

| Field             | Meaning                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Unique catalogue id. A tool's `rerank.model` names it; a duplicate fails startup.                                                                                      |
| `provider`        | A `providers[].id` of type `system-one`. An unknown id, or any other type, fails startup.                                                                              |
| `model`           | Model id sent verbatim on the wire.                                                                                                                                    |
| `pricingUsdPer1M` | Fallback input price for a wire that reports no `usage.cost` (the native TypeSafe wire). A reported cost always wins; output tokens are free on every Jev route today. |

One client is built per catalogue id at boot and reused, so two entries on two
routes never share an endpoint, and one entry can be a cheaper model for one
tool. An absent `decisions` block — or an empty `models` list — means no client
exists at all.

## 3. A tool opts in

A tool's rerank block names a mode and a catalogue id. **Absent means off**;
there is no `off` value, so removing the block is how a tool stops reranking.

```jsonc
{
  "webSearch": {
    "engines": [/* … */],
    "chain": ["brave"],
    "rerank": { "mode": "shadow", "model": "jev-openrouter" },
  },
  "tools": {
    "grep": {
      "rerank": { "mode": "shadow", "model": "jev-openrouter" },
    },
  },
}
```

- `shadow` computes and logs the order and leaves the tool output unchanged.
- `on` applies the order before the inline cap and the artifact are built.

A `rerank.model` the catalogue does not define fails startup naming the path
(`webSearch.rerank.model`, `tools.grep.rerank.model`), so a typo cannot silently
rank with nothing.

What each tool ranks:

- **`web_search`** ranks its merged result list before any cap: one card per
  result, `[k] title — host — snippet`, asking whether the result helps answer
  the call's `objective` (or, without one, its query). Only `kind: "results"`
  output is ranked — a grounded answer is one text, not a candidate set.
- **`grep`** ranks whole file runs after the walk: one card per run (its path
  plus up to three matching lines), asking whether the file likely holds what
  the call's `objective` (or its patterns) look for. A term-overlap prefilter
  keeps at most 48 runs for the request.

A rerank only reorders candidates; it never adds or drops one, so the result
count, every warning, and the `left out` notice are unchanged. `shadow` records
the would-be order, the model that answered, probabilities, latency, and cost
beside the result for the owner's UI; the model never reads that field.

## Cost and failure

A decision call never fails the tool call that asked. A timeout (10 s per
attempt, 3 attempts on 408/429/5xx and transport errors, `retry-after` honoured
up to 5 s), an exhausted retry, a bad key, or a rerank naming a catalogue id
with no client leaves those candidates **unjudged**, and they keep their
canonical order. A malformed response — a missing answer, an answer of the
wrong type, or a probability outside `[0, 1]` — makes the whole call
`unavailable` and changes nothing.

**Unavailable is not a negative judgment.** A model that could not answer says
nothing about relevance; never read a failed call as "irrelevant".

Requests carry at most 48 questions (one per candidate) with at most 4 in
flight; a larger batch is chunked and the answers merged. A failed chunk leaves
only its own candidates unjudged.

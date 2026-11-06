---
summary: "Enabling decision-model ranking: the system-one provider type, the decisionModels[] catalogue, the per-tool rerank block for web_search and grep, what naming a model discloses, and what a failure means"
read_when:
  - you are wiring a Jev / System One decision endpoint into llame
  - you are enabling ranking of web_search or grep results
  - a decision call failed and you need to know whether the output changed
---

# Decisions

A decision model answers typed questions over one state in a single forward
pass and returns probabilities instead of generated text. A tool uses it to
rank its own candidates by asking one yes/no question per candidate. Nothing is
enabled by default: without a `decisionModels[]` catalogue no client is built,
no tool can name a model, and every tool keeps its canonical order.

Two layers, and they do not overlap. `decisionModels[]` is a **catalogue** of
decision models: it says which providers and model ids exist. Each **tool**
decides for itself whether it ranks and which catalogue entry judges it,
through its own `rerank` block (`webSearch.rerank`, `tools.grep.rerank`).

A decision call is a **side call**. Its tokens and cost are written to one
structured `decision.completed` log line and never folded into a Run's message
usage, cost, measured context, reasoning count, or completeness, exactly as
title generation and hosted search are excluded.

## 1. A provider of type `system-one`

`type: "system-one"` posts to `{baseUrl}/systemone` with a bearer `key`. Both
`key` and `baseUrl` are required and must resolve nonblank; an entry that
interpolates to empty fails startup naming the entry and the field. The type
never serves a `models[]` or `embeddingModels[]` entry, and
`GET /api/v1/models` never lists a decision model.

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
that id is what the log line records. Pin a versioned id when you compare
results over time.

## 2. The decision-model catalogue

```jsonc
{
  "decisionModels": [
    {
      "id": "jev-openrouter",
      "provider": "openrouter-decisions",
      "model": "~typesafe/jev-latest",
    },
  ],
}
```

| Field      | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `id`       | Unique catalogue id. A tool's `rerank.model` names it; a duplicate fails startup.         |
| `provider` | A `providers[].id` of type `system-one`. An unknown id, or any other type, fails startup. |
| `model`    | Model id sent verbatim on the wire.                                                       |

There is no price field. A request's cost is the cost the wire reports; a wire
that reports none is recorded as unknown, never as zero.

One client is built per catalogue id at boot, so two entries on two routes never
share an endpoint. An absent or empty `decisionModels[]` array means no client
exists at all, and every call names an id outside the catalogue.

## 3. A tool opts in

A tool's rerank block names one catalogue id. **Presence enables ranking**:
there is no `mode` and no `off` value, so removing the block is how a tool
stops ranking.

```jsonc
{
  "webSearch": {
    "engines": [/* … */],
    "chain": ["brave"],
    "rerank": { "model": "jev-openrouter" },
  },
  "tools": {
    "grep": {
      "rerank": { "model": "jev-openrouter" },
    },
  },
}
```

A `rerank.model` the catalogue does not define fails startup naming the path
(`webSearch.rerank.model`, `tools.grep.rerank.model`), so a typo cannot silently
rank with nothing.

### What naming a model discloses

Naming a model is the operator's declaration, for everything that tool admits.
llame sends the candidate cards of every ranked call to the endpoint of that
model's provider: host files, and also `kb://` Knowledge findings and
`machine://` findings when the tool admits them. llame adds no per-source
consent prompt and no data-class gate, and ranking never widens what a tool may
read: a finding that read admission refuses never becomes a card. Name a model
only on a provider you accept that disclosure for.

The one protection is exact-key replacement: complete occurrences of the
decision provider's own resolved `key` in the query, objective, and candidate
text are replaced with `[REDACTED]` before a request is sent, and the ranked
tools apply the same replacement to their returned text and locators. This is
not a secret detector; it removes that one configured key and nothing else.

### What each tool ranks

- **`web_search`** ranks every `results` outcome, whatever engine produced it:
  one card per result, asking whether the result helps answer the call's
  `objective` (or, without one, its query). A grounded `answer` is one text,
  not a candidate set, so it is never ranked.
- **`grep`** takes an optional `objective`. It ranks whole file runs after the
  walk, only when the result cannot fit inline: one card per run (its path plus
  up to three matching lines), asking whether the file likely holds what the
  objective (or its patterns) look for.

Ranking only reorders candidates; it never adds or drops one, so match counts,
warnings, and stop reasons are unchanged, and the inline part and the full
artifact share one order. A result that already fits inline is not judged.
The owner's UI can show the applied order, scores, answering model, latency, and
cost beside a result; the model never reads that record.

## Cost and failure

A decision call never fails the tool call that asked. Each attempt times out
after 10 seconds; transient failures (408, 429, 5xx, transport errors) are
retried up to 3 attempts in total, with `retry-after` honoured up to 5 seconds.
An exhausted retry, a bad key, or a rank naming a catalogue id with no client
leaves those candidates **unjudged**, and they keep their canonical order. A
malformed response — a missing answer, an answer of the wrong type, a
probability outside `[0, 1]`, invalid usage, or a served model id that contains
the key — makes that whole request unavailable: its cards stay unjudged and its
tokens and cost are not counted.

**Unavailable is not a negative judgment.** A model that could not answer says
nothing about relevance. There is no fallback to a chat model.

A request carries at most 256 cards with their yes/no questions; a larger batch
is split into several requests sent at once, each carrying only its own cards.
A failed request leaves only its own cards unjudged, and the call is
unavailable only when every request failed.

The tool's own deadline and the Run's cancellation also stop every request and
every retry wait. Those are not ranking failures: the tool reports its timeout
or cancellation as it does for any other work.

Each call writes one `decision.completed` line with `tool`, `model` (the first
accepted response's served id, or `null`), `cards`, `requests`, `judged`,
`inputTokens`, `outputTokens`, `costUsd`, and `latencyMs`. Tokens and cost sum
the accepted responses only; `costUsd` is `null` when any accepted response
reports no cost or none was accepted.

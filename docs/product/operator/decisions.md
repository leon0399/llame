---
summary: "Enabling rank models: the system-one and cohere-rerank provider types, the decisionModels[] and rerankModels[] catalogues, the per-tool rerank block for web_search and grep, what naming a model discloses, cost, and what a failure means"
read_when:
  - you are wiring a Jev / System One decision endpoint into llame
  - you are wiring a Cohere, OpenRouter, Jina, or Infinity rerank endpoint into llame
  - you are enabling ranking of web_search or grep results
  - a decision call failed and you need to know whether the output changed
behavior:
  - ../reference/tools/web-search.md
  - ../reference/tools/grep.md
---

# Decisions

A decision model answers typed questions over one state in a single forward
pass and returns probabilities instead of generated text. A tool uses it to
rank its own candidates by asking one yes/no question per candidate. A
conventional **rerank model** (a Cohere-style cross-encoder) fills the same seat
and returns one relevance score per candidate. Nothing is enabled by default:
without either `decisionModels[]` or `rerankModels[]` no client is built, no
tool can name a model, and every tool keeps its canonical order.

Two layers, and they do not overlap. `decisionModels[]` and `rerankModels[]`
are **catalogues** of rank models: they say which providers and model ids
exist. Each **tool**
decides for itself whether it ranks and which catalogue entry judges it,
through its own `rerank` block (`webSearch.rerank`, `tools.grep.rerank`).

A decision call is a **side call**. Its tokens and cost are written to one
structured `decision.completed` log line and never folded into a Run's message
usage, cost, measured context, reasoning count, or completeness, exactly as
title generation and hosted search are excluded.

## 1. A provider of type `system-one`

`type: "system-one"` posts to `{baseUrl}/systemone` with a bearer `key`. Both
`key` and `baseUrl` are required and must resolve nonblank; an entry that
interpolates to empty fails startup naming the entry and the field. Optional
`maxConcurrentRequests` bounds the attempts in flight to this provider (default
4; see [Cost and failure](#cost-and-failure)). The type never serves a
`models[]` or `embeddingModels[]` entry, and `GET /api/v1/models` never lists a
decision model.

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
| `limits`   | Optional token ceilings of this model on this route; see below.                           |

There is no price field. A request's cost is the cost the wire reports; a wire
that reports none is recorded as unknown, never as zero.

One client is built per catalogue id at boot, so two entries on two routes never
share an endpoint. An absent or empty `decisionModels[]` array means no client
exists at all, and every call names an id outside the catalogue.

### Limits

`limits` states what one request to this model may hold, in the vendor's own
tokens. Each field is a positive integer or a whole-value `{env:…}` /
`{path:…}` token.

| Field                      | Meaning                                              | Default                                     |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `perQuestionContextTokens` | State plus the largest single question.              | 8,192                                       |
| `perRequestContextTokens`  | State plus every question.                           | 32,768, or the per-question limit if larger |
| `maxQuestionsPerRequest`   | Questions in one request; above 32 it has no effect. | none                                        |

Declaring a per-question limit above the per-request one fails startup. The
names follow TypeSafe's `per_question_context` and `per_request_context`.

```jsonc
{
  "decisionModels": [
    {
      "id": "jev",
      "provider": "openrouter-decisions",
      "model": "typesafe/jev-1.14",
      "limits": {
        "perQuestionContextTokens": 32768,
        "perRequestContextTokens": 65536,
      },
    },
  ],
}
```

The defaults fit hosted members such as Jev. **A small self-hosted model must
declare its limits:** 32 grep cards fit the defaults and overflow a 512- or
1,024-token checkpoint. llame has no tokenizer for these models, so it
estimates tokens as the UTF-8 bytes of the serialized state and questions,
divided by 3 and rounded up. A server that reserves a fixed budget for the
question inside its window, such as Laya (760 state tokens of 1,024 on the
multilingual checkpoint), needs the state budget plus a typical question
declared, not the raw window.

Declared limits are the guard. A server that cuts an oversized state and
reports it (`usage.truncated: true` or `usage.state_tokens_dropped` above 0)
gets that request marked unavailable as a backstop; a server that cuts
silently, or one run with `LAYA_JEV_STRICT=1`, returns degraded answers for a
request sized above its real window.

## 3. A provider of type `cohere-rerank`

`type: "cohere-rerank"` speaks the Cohere v2 rerank wire: `POST {baseUrl}/rerank`
with `model`, `query`, and `documents`, answered by `results` holding an
`index` and a `relevance_score` for every document.

- `baseUrl` is optional and defaults to `https://api.cohere.com/v2`. A
  `baseUrl` that is present but resolves blank fails startup naming the field;
  it never falls back to the default.
- `key` is optional. A `key` that is absent or resolves blank makes the entry
  **keyless**, which is valid only with an explicit `baseUrl`. A keyless entry
  on the default Cohere URL fails startup naming `key`.
- A keyless entry sends no `Authorization` header, and llame never reads
  `COHERE_API_KEY` from the environment. An operator `headers` entry named
  `Authorization` is still sent.
- `accountId` is rejected. The type has an empty default header map, and an
  authored `{session:id}` fails startup naming the provider and the header,
  because a rank call has no Chat.
- The type never serves a `models[]` or `embeddingModels[]` entry, and
  `GET /api/v1/models` never lists a rerank model.

| Route      | `baseUrl`                      | Model ids                                     | Status                               |
| ---------- | ------------------------------ | --------------------------------------------- | ------------------------------------ |
| OpenRouter | `https://openrouter.ai/api/v1` | `cohere/rerank-5-fast`, `cohere/rerank-5-pro` | Probed live (2026-11-07)             |
| Cohere     | `https://api.cohere.com/v2`    | the model id Cohere serves                    | Compatible by wire shape, not probed |
| Jina       | `https://api.jina.ai/v1`       | the model id Jina serves                      | Compatible by wire shape, not probed |
| Infinity   | the server's own URL           | the model id the server serves                | Compatible by wire shape, not probed |

Only OpenRouter was exercised against the live service. The others answer the
same `results[{ index, relevance_score }]` shape according to their published
clients; treat them as compatible, not verified. Voyage and TEI use other shapes
and are not supported.

Self-hosting needs no key: point `baseUrl` at the server and leave `key` out.

```jsonc
{
  "providers": [
    {
      "id": "local-rerank",
      "type": "cohere-rerank",
      "baseUrl": "http://infinity:7997",
    },
  ],
}
```

## 4. The rerank-model catalogue

`rerankModels[]` is a sibling of `decisionModels[]`. A tool's `rerank.model`
may name an id from either catalogue, so an id is unique across both: a blank
or repeated id fails startup naming the array-index paths (for example
`decisionModels[0].id` and `rerankModels[1].id`) and never the value. `id`,
`provider`, and `model` accept `{env:…}` and `{path:…}` and must resolve
nonblank. `provider` must name a `cohere-rerank` provider. `model` is sent
verbatim.

```jsonc
{
  "providers": [
    {
      "id": "openrouter-rerank",
      "type": "cohere-rerank",
      "key": "{env:OPENROUTER_API_KEY}",
      "baseUrl": "https://openrouter.ai/api/v1",
    },
  ],
  "rerankModels": [
    {
      "id": "rr-fast",
      "provider": "openrouter-rerank",
      "model": "cohere/rerank-5-fast",
    },
  ],
}
```

The probability a decision model returns and the relevance score a reranker
returns are different quantities. Both are stored as `display.rerank.scores`;
a tool only sorts within one call, and nothing compares scores across backends.
The reranker scores the objective (else the query) against the cards' texts,
with the same key protection and card bound as a decision call. It carries no
rubric. A request carries at most 1,000 cards; a larger call is split into
requests sent at once, each with only its own cards. A request is accepted only
when every card gets one finite score, and an unaccepted request leaves only its
own cards unjudged, as a decision request does.

## 5. A tool opts in

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

A `rerank.model` that neither `decisionModels[]` nor `rerankModels[]` defines
fails startup naming the path (`webSearch.rerank.model`,
`tools.grep.rerank.model`), so a typo cannot silently rank with nothing.

### What naming a model discloses

Naming a model is the operator's declaration, for everything that tool admits.
llame sends the candidate cards of every ranked call to the endpoint of that
model's provider: host files, and also `kb://` Knowledge findings and
`machine://` findings when the tool admits them. llame adds no per-source
consent prompt and no data-class gate, and ranking never widens what a tool may
read: a finding that read admission refuses never becomes a card. Name a model
only on a provider you accept that disclosure for.

The one protection is exact-key replacement: complete occurrences of the
rank provider's own resolved `key` in the query, objective, and candidate
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

A rank call (decision or rerank) never fails the tool call that asked. Each attempt times out
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

A decision call judges at most its first 256 cards; the rest keep their
canonical order unjudged. Those cards fill requests in canonical order, each as
full as the model's limits and a 32-card bound allow. A card that alone exceeds
a limit travels alone, cut to the longest prefix that fits; when not even one
character of a card fits beside the shared state, the call is unavailable with
the reason `state_too_large`. A rerank request carries at most 1,000 cards, and
a larger rerank batch is split into requests sent at once. A failed request
leaves only its own cards unjudged, and the call is unavailable only when every
request failed.

Attempts to one `system-one` provider share `maxConcurrentRequests` slots,
default 4, first come first served. Every catalogue entry and every call on that
provider id shares them, a retry wait holds none, and a cancelled call leaves
the queue at once. The bound is per process and per provider id: several worker
processes, or two provider ids pointing at one server, multiply the load on
that server. Raise it only as far as the server tolerates. A call's
`latencyMs` includes the time its requests waited for a slot.

A rerank response must score every card of its request exactly once, with a
finite score. A skipped, repeated, or out-of-range index, a malformed body, a
body over 1 MiB, or a served model id that contains the key makes that request
unavailable. An attempt timeout is retried like any other transient failure.

**Rerank cost.** A rerank request's cost is the `usage.cost` the wire reports
(OpenRouter does; Cohere reports billed search units, not cost), else it is
unknown, never zero and never computed from a price. Its token count is
`usage.total_tokens`, else `usage.prompt_tokens`. `outputTokens` is `0`. A
rerank call writes no Run usage record: like a decision call it is a side call
(tracked in [#1592](https://github.com/leon0399/llame/issues/1592)).

The tool's own deadline and the Run's cancellation also stop every request and
every retry wait. Those are not ranking failures: the tool reports its timeout
or cancellation as it does for any other work.

Each call writes one `decision.completed` line with `tool`, `model` (the first
accepted response's served id, or `null`), `cards`, `requests`, `judged`,
`inputTokens`, `outputTokens`, `costUsd`, and `latencyMs`. Tokens and cost sum
the accepted responses only; `costUsd` is `null` when any accepted response
reports no cost or none was accepted, and a rerank call's `inputTokens` is
`null` when any accepted response reports no count.

## Evaluating a model on labeled cases

`apps/api/fixtures/ranking` holds hand-labeled cases of at most 40 cards: a
synthetic retry search, real walks for `tenant-db.service.ts` and the permission
evaluator, and an RLS / `SECURITY DEFINER` web search. Two commands compare
models on them:

```sh
pnpm --filter api ranking:record [model-id ...]
pnpm --filter api ranking:eval
```

`ranking:record` judges every case with each named `decisionModels[].id` or
`rerankModels[].id` (all of
them without arguments) using the keys of your operator config, and writes
`fixtures/ranking/answers/<case>.<model>.json`. `ranking:eval` makes no model
call: it prints nDCG@5, MRR, latency, and cost for the canonical order and for
every recorded answer. Without recorded answers it prints the canonical baseline
only. Cards are small and few, so this measures ordering quality, not batching
of large walks.

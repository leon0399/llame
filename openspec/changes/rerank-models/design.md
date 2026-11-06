# Design

## Context

The rank seat shipped in `decision-rerank`: a tool builds cards, the decision
service judges them, and the tool sorts by score. The service contract is
`judgeCandidates({ model, objective?, query, cards, cardBound, rubric,
abortSignal? })`, which returns `answered` with a score per judged card, or
`unavailable`. Tools never see which backend answered.

## Decisions

Recorded in a grilling session with Leo on 2026-11-07.

### D1. One wire, Cohere v2 `/rerank`

Cohere, OpenRouter, Jina, and Infinity answer `results[{ index,
relevance_score }]` at `{baseUrl}/rerank`. Voyage (`data[...]`) and TEI (a
bare array) need other clients and are left to #1607. The provider type is
named after the wire, `cohere-rerank`, so a Jina or Infinity entry does not
read as Cohere-only, and a future Cohere chat wire keeps its own name.

### D2. A separate catalog with one id namespace

`rerankModels[]` is a sibling of `embeddingModels[]` and `decisionModels[]`.
The `rerank.model` reference resolves against both catalogs, so an id must be
unique across both. Issue #1605 tracks collapsing providers into one entry per
vendor account.

### D3. The AI SDK client, with the `meta` fill

`rerank()` from `ai` 6 and `@ai-sdk/cohere` 3.0.55 build the request and parse
`results`. `@ai-sdk/cohere` requires `meta` in the response, which OpenRouter
and Infinity omit. The client's fetch wrapper adds `meta: null` to a
successful JSON body that lacks it. The SDK reads nothing from `meta`, so the
fill changes no result. Remove the fill when vercel/ai#24699 ships in the
pinned line.

The SDK is used for one attempt only (`maxRetries: 0`). Its own retry loop
honours `retry-after` up to 60 seconds, retries 409, and never retries an
attempt timeout, so the attempt loop, backoff, and `retry-after` cap reuse the
decision client's helpers. The same fetch wrapper caps the body at 1 MiB and
removes `Authorization` for a keyless entry; the client always passes an
explicit `apiKey`, so `@ai-sdk/cohere` never reads `COHERE_API_KEY`. The SDK
checks only that `index` and `relevance_score` are numbers, so index
validation is llame's.

### D4. Requests: 1,000 cards, sent together, all-or-nothing

Cohere caps a request at 1,000 documents; OpenRouter accepted 1,001 in a live
probe on 2026-11-07, so 1,000 is the binding bound. Cohere bills per search
unit (one query and up to 100 documents), so a larger request costs no more
than several smaller ones. A request is accepted only when every card index
receives one finite score; anything else makes that request unavailable,
like a malformed decision answer. Attempt timeout, retry, `retry-after`,
cancellation, and one log line per call reuse the decision-lane rules.

### D5. Scores, not probabilities

`relevance_score` is stored in `display.rerank.scores` as received. Scores
from different backends are not comparable, and nothing compares them: a tool
only sorts within one call. A combination of backends is out of scope.

### D6. Credentials and keyless entries

`key` and `baseUrl` are optional. A key that resolves blank marks the entry
keyless, which is valid only with an explicit `baseUrl` (a self-hosted
Infinity). A keyless entry on the default Cohere URL fails startup naming
`key`. The resolved key joins the protected-value set, and the decision lane's
key protection applies to it (cards, query, presentation).

### D7. Usage and cost

The wire may report `usage.total_tokens`, `usage.prompt_tokens`, and
`usage.cost`. A response count is `total_tokens`, else `prompt_tokens`. The
call's `inputTokens` and cost are sums over accepted responses, or `null`
when any accepted response lacks one, the decision lane's cost rule;
`outputTokens` is `0`. There is no price fallback and no Run-usage record (#1592).

## Risks / Trade-offs

- [The `meta` fill depends on an SDK internal] -> one test pins that an
  OpenRouter-shaped body ranks; a SDK bump that changes parsing fails it.
- [Jina and Infinity shapes were checked against their published clients,
  not live] -> the operator doc states that OpenRouter and Cohere were probed
  live; the others are documented as compatible, not measured.
- [Weak card evidence] -> the `permission-evaluator` fixture stays weak for
  every backend (nDCG@5 0–0.39); excerpt selection is #1606.

## Migration Plan

Additive configuration; no database change. Rolling back means removing the
`cohere-rerank` providers and `rerankModels[]` before running older code.

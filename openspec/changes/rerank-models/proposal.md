# Proposal

## Why

`grep` and `web_search` rank their results through a System One decision
model (change `decision-rerank`). Conventional cross-encoder rerankers
(Cohere Rerank 5, Jina, self-hosted Infinity) do the same job: they score each
card against the query on its own. On the four labeled ranking fixtures,
`cohere/rerank-5-fast` ties `jev-1.13` and `jev-1.14` on three cases at about
one sixth of the cost per call ($0.00002–0.00005), with similar latency
(370–880 ms). Operators should be able to put either kind of model in the
same `rerank` seat.

Issue [#1434](https://github.com/leon0399/llame/issues/1434) asks for this
backend. Measurements are recorded on the experiment branch
`experiment/rerank-models`.

## What Changes

- New provider type `cohere-rerank`: the Cohere v2 `/rerank` wire. It serves
  Cohere, OpenRouter, Jina, and Infinity. `key` and `baseUrl` are optional;
  `baseUrl` defaults to `https://api.cohere.com/v2`, and a keyless entry must
  set `baseUrl`.
- New top-level catalog `rerankModels[]` of `{ id, provider, model }`, beside
  `decisionModels[]`. Ids are unique across both catalogs.
- `webSearch.rerank.model` and `tools.grep.rerank.model` name an id in either
  catalog. Tools, cards, ordering, failure output, and `display.rerank` are
  unchanged: both kinds return one score per card.
- Requests go through the AI SDK `rerank()` function and `@ai-sdk/cohere`. A
  response without Cohere's `meta` field (OpenRouter, Infinity) is accepted;
  the upstream fix is [vercel/ai#24699](https://github.com/vercel/ai/issues/24699).
- One request carries at most 1,000 cards. A larger call becomes several
  requests sent at the same time. Scores are pointwise, so splitting changes
  no score (measured: maximum difference 0.00000 on 40 cards, split and
  reversed).
- `ranking:record` and `ranking:eval` accept rerank models.
- Cost is the wire's reported `usage.cost`, else `null`. No price fallback and
  no Run-usage ledger; the ledger is
  [#1592](https://github.com/leon0399/llame/issues/1592).

## Capabilities

### New Capabilities

- `rerank-models`: the `cohere-rerank` wire, the `rerankModels[]` catalog,
  request bounds, scores, usage, and the rule that a rank call served by a
  rerank model follows the decision-lane rules for failure, cancellation,
  logging, and secrecy.

### Modified Capabilities

- `instance-config`: the provider type set and shape, the two `rerank`
  model references, and the rule that chat and embedding models cannot name a
  rank provider.
- `provider-request-headers`: `cohere-rerank` has an empty default header map
  and refuses `{session:id}`, as `system-one` does.

## Impact

- `apps/api`: `instance-config` (schema, types, loader), `decisions`
  (rerank client and the rank seat), `models/model-client-factory.ts` (guard),
  `ranking` record/eval, operator documentation and the config example.
- New dependency `@ai-sdk/cohere@3.0.55`, the release whose
  `@ai-sdk/provider` and `@ai-sdk/provider-utils` versions match the pinned
  ones.
- No database, API, or UI change.
- Issues: closes [#1434](https://github.com/leon0399/llame/issues/1434) on the
  implementation layer. [#1436](https://github.com/leon0399/llame/issues/1436)
  closes as not planned: decision models fill the "cheap model judges
  relevance" role, and a listwise LLM ranker would need sliding-window
  merging that pointwise backends do not. Follow-ups:
  [#1605](https://github.com/leon0399/llame/issues/1605) (one provider entry
  per vendor account), [#1606](https://github.com/leon0399/llame/issues/1606)
  (objective-aware grep excerpts),
  [#1607](https://github.com/leon0399/llame/issues/1607) (Voyage and TEI
  wires).
